import type { ErrorEvent } from './types';

export interface RateLimiterOptions {
  /** Max events per minute the SDK is allowed to emit. Default: 100. */
  maxEventsPerMinute?: number;

  /** Dedupe window in milliseconds. Identical events within this window are dropped. Default: 5000. */
  dedupeWindowMs?: number;

  /** Consecutive transport failures before the circuit breaker trips. Default: 5. */
  circuitBreakerThreshold?: number;

  /** Cooldown while the breaker is open, in milliseconds. Default: 60000. */
  circuitBreakerCooldownMs?: number;
}

export interface RetryDecision {
  shouldRetry: boolean;
  delayMs: number;
}

/**
 * Runtime guardrails around the transport layer:
 *   - Deduplicates identical error events inside a short window.
 *   - Enforces a per-minute cap (prevents tight loops from DDoSing ingest).
 *   - Opens a circuit breaker after repeated transport failures.
 *   - Honors server-imposed cooldowns (Retry-After, X-LaraBug-Disable-Capture).
 *   - Hands out exponential-backoff retry decisions for transient failures.
 *
 * The class has no I/O of its own — it's a pure decision engine that the
 * transport consults. That makes it trivial to test and keeps the client
 * flow easy to follow.
 */
export class RateLimiter {
  private readonly maxEventsPerMinute: number;
  private readonly dedupeWindowMs: number;
  private readonly breakerThreshold: number;
  private readonly breakerCooldownMs: number;

  /** Sliding-window timestamps for the per-minute cap. */
  private sentTimestamps: number[] = [];

  /** Map of event fingerprint → last-emitted timestamp, for dedupe. */
  private lastSeen: Map<string, number> = new Map();

  /** Counter of consecutive transport failures. Resets on success. */
  private consecutiveFailures = 0;

  /**
   * If set, capture is disabled until this epoch-ms. Populated by the circuit
   * breaker or by server-sent Retry-After / X-LaraBug-Disable-Capture headers.
   */
  private disabledUntil: number | null = null;

  /** Counter of events dropped while disabled — surfaced via getStats(). */
  private droppedEvents = 0;

  constructor(options: RateLimiterOptions = {}) {
    this.maxEventsPerMinute = options.maxEventsPerMinute ?? 100;
    this.dedupeWindowMs = options.dedupeWindowMs ?? 5000;
    this.breakerThreshold = options.circuitBreakerThreshold ?? 5;
    this.breakerCooldownMs = options.circuitBreakerCooldownMs ?? 60_000;
  }

  /**
   * Should this event be sent?  Returns false if:
   *   - the circuit breaker is open, or
   *   - the per-minute cap is exceeded, or
   *   - the same event was emitted within the dedupe window.
   *
   * On `true` the emission is recorded internally; callers can treat the
   * decision as consumed.
   */
  shouldSend(event: ErrorEvent): boolean {
    const now = Date.now();

    if (this.disabledUntil !== null) {
      if (now < this.disabledUntil) {
        this.droppedEvents++;
        return false;
      }
      // Cooldown elapsed — clear the flag but keep failure count so the
      // breaker re-opens quickly if the transport is still broken.
      this.disabledUntil = null;
    }

    // Sliding-window rate limit.
    this.sentTimestamps = this.sentTimestamps.filter((ts) => now - ts < 60_000);
    if (this.sentTimestamps.length >= this.maxEventsPerMinute) {
      this.droppedEvents++;
      return false;
    }

    // Dedupe.
    const fingerprint = this.fingerprintOf(event);
    const lastSeenAt = this.lastSeen.get(fingerprint);
    if (lastSeenAt !== undefined && now - lastSeenAt < this.dedupeWindowMs) {
      this.droppedEvents++;
      return false;
    }

    this.lastSeen.set(fingerprint, now);
    this.sentTimestamps.push(now);

    // Garbage-collect the dedupe map occasionally so it doesn't grow unbounded.
    if (this.lastSeen.size > 256) {
      const cutoff = now - this.dedupeWindowMs;
      for (const [key, ts] of this.lastSeen) {
        if (ts < cutoff) this.lastSeen.delete(key);
      }
    }

    return true;
  }

  /** Call after a successful transport send. Resets the failure counter. */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
  }

  /**
   * Call after a transport failure. Optionally pass the server response so
   * headers like Retry-After and X-LaraBug-Disable-Capture can be honored.
   * Returns a retry decision for transient failures.
   */
  recordFailure(response?: Response | null): RetryDecision {
    this.consecutiveFailures++;

    const cooldownFromHeaders = this.extractCooldownFromHeaders(response);
    if (cooldownFromHeaders !== null) {
      this.disabledUntil = Date.now() + cooldownFromHeaders;
      return { shouldRetry: false, delayMs: 0 };
    }

    if (this.consecutiveFailures >= this.breakerThreshold) {
      this.disabledUntil = Date.now() + this.breakerCooldownMs;
      return { shouldRetry: false, delayMs: 0 };
    }

    // Exponential backoff with full jitter (AWS pattern). Base 250ms, cap 10s.
    const exp = Math.min(10_000, 250 * 2 ** (this.consecutiveFailures - 1));
    const delayMs = Math.floor(Math.random() * exp);
    return { shouldRetry: true, delayMs };
  }

  /** True when a caller-forced delay should short-circuit the retry loop. */
  isDisabled(): boolean {
    if (this.disabledUntil === null) return false;
    if (Date.now() >= this.disabledUntil) {
      this.disabledUntil = null;
      return false;
    }
    return true;
  }

  /**
   * Whether a particular HTTP status code is considered retryable.
   * 408 Request Timeout, 425 Too Early, 429 Too Many Requests, 500, 502-504.
   */
  isRetryableStatus(status: number): boolean {
    return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 504);
  }

  getStats(): { droppedEvents: number; consecutiveFailures: number; disabledUntil: number | null } {
    return {
      droppedEvents: this.droppedEvents,
      consecutiveFailures: this.consecutiveFailures,
      disabledUntil: this.disabledUntil,
    };
  }

  /** Build a stable fingerprint for dedupe. */
  private fingerprintOf(event: ErrorEvent): string {
    const type = event.exception?.type ?? event.level ?? 'message';
    const message = event.exception?.value ?? event.message ?? '';
    const firstFrame = event.exception?.stacktrace?.[0];
    const loc = firstFrame
      ? `${firstFrame.filename ?? '?'}:${firstFrame.lineno ?? '?'}:${firstFrame.colno ?? '?'}`
      : '';
    return `${type}|${message}|${loc}`;
  }

  /** Read Retry-After and X-LaraBug-Disable-Capture from the response, if any. */
  private extractCooldownFromHeaders(response?: Response | null): number | null {
    if (!response || typeof response.headers?.get !== 'function') {
      return null;
    }

    // Custom SDK kill-switch — value is seconds.
    const killSwitch = response.headers.get('X-LaraBug-Disable-Capture');
    if (killSwitch) {
      const seconds = parseInt(killSwitch, 10);
      if (!isNaN(seconds) && seconds > 0) {
        return seconds * 1000;
      }
    }

    // Standard Retry-After — can be seconds or an HTTP date.
    const retryAfter = response.headers.get('Retry-After');
    if (retryAfter) {
      const asSeconds = parseInt(retryAfter, 10);
      if (!isNaN(asSeconds) && asSeconds > 0) {
        return asSeconds * 1000;
      }
      const asDate = Date.parse(retryAfter);
      if (!isNaN(asDate)) {
        const delta = asDate - Date.now();
        return delta > 0 ? delta : null;
      }
    }

    return null;
  }
}
