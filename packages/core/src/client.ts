import {
  LaraBugOptions,
  LaraBugClient,
  LaraBugClientStatus,
  ErrorEvent,
  Breadcrumb,
  User,
  StackFrame,
  RequestInfo,
  TransportOptions,
} from './types';
import { DataFilter } from './data-filter';
import { RateLimiter } from './rate-limiter';

/**
 * Re-entry guard shared across all client instances. If any part of the
 * capture pipeline throws (DataFilter, beforeSend, transport), the inner
 * throwable must never bubble back into capture — otherwise Laravel/React/Vue's
 * error handlers would feed it right back to us and we'd recurse until the
 * stack blew up. Mirrors the pattern added to the PHP SDK in 3.7.0.
 */
let __captureInFlight = false;

const INGEST_KEY_PREFIX = 'lbi_';

const DEFAULT_ENDPOINT = 'https://www.larabug.com/api/log';

// Options arrive from places that are not TypeScript, so nothing below trusts
// a declared type.
function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asObject<T>(value: unknown, fallback: T): T {
  return value !== null && typeof value === 'object' ? (value as T) : fallback;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function warn(message: string, detail?: unknown): void {
  if (typeof console === 'undefined' || !console.warn) {
    return;
  }

  if (detail === undefined) {
    console.warn(message);
  } else {
    console.warn(message, detail);
  }
}

/**
 * Core LaraBug client implementation
 *
 * Construction cannot throw, for any input. The SDK is installed before the
 * code it watches, so a throwing constructor takes out every module after it
 * in the host's bundle. A client that cannot report is inert instead, warns
 * once, and says why through `isActive()` / `getStatus()`.
 */
export class BaseLaraBugClient implements LaraBugClient {
  private options: Required<LaraBugOptions>;
  private status: LaraBugClientStatus;
  private breadcrumbs: Breadcrumb[] = [];
  private user: User | null = null;
  private context: Record<string, any> = {};
  private tags: Record<string, string> = {};
  private dataFilter: DataFilter;
  private rateLimiter: RateLimiter;

  constructor(options: LaraBugOptions = {}) {
    let normalized: Required<LaraBugOptions>;
    let status: LaraBugClientStatus;
    let failure: unknown;

    try {
      normalized = this.normalizeOptions(options);
      status = this.resolveStatus(normalized);
    } catch (error) {
      // normalizeOptions reads every value defensively, so reaching here means
      // the options object itself misbehaved: a throwing getter, a dead proxy.
      normalized = this.normalizeOptions({});
      status = { active: false, reason: 'the options object could not be read' };
      failure = error;
    }

    this.options = normalized;
    this.status = status;

    // Silent when the caller asked for silence with `enabled: false`.
    if (!status.active && status.reason !== null && normalized.enabled) {
      warn(
        `[LaraBug] Error reporting is off: ${status.reason}. ` +
          'The SDK is inert; the rest of the page is unaffected.',
        failure
      );
    }

    this.dataFilter = new DataFilter({
      blacklist: this.options.blacklist,
      urlBlacklist: this.options.urlBlacklist,
    });
    this.rateLimiter = new RateLimiter({
      maxEventsPerMinute: this.options.maxEventsPerMinute,
      dedupeWindowMs: this.options.dedupeWindowMs,
    });
  }

  private normalizeOptions(options: LaraBugOptions): Required<LaraBugOptions> {
    const given = asObject<LaraBugOptions>(options, {});

    let login_key = asText(given.login_key);
    let ingest_key = asText(given.ingest_key);
    let project_key = asText(given.project_key);
    let endpoint = asText(given.endpoint) || DEFAULT_ENDPOINT;
    const dsn = asText(given.dsn);

    // A DSN that parses replaces the credentials rather than topping them up.
    if (dsn) {
      const parsed = this.parseDsn(dsn);
      if (parsed) {
        login_key = parsed.credential;
        project_key = parsed.project_key;
        endpoint = parsed.endpoint;
        ingest_key = '';
      }
    }

    // The panel's DSN carries the ingest key in the field that used to hold the
    // login key, and so does a key pasted in by hand. The prefix is what the
    // server tells them apart by, so an ingest key never goes out as a bearer.
    if (!ingest_key && login_key.startsWith(INGEST_KEY_PREFIX)) {
      ingest_key = login_key;
      login_key = '';
    }

    const transport = asObject<TransportOptions>(given.transport, {});

    return {
      login_key,
      ingest_key,
      project_key,
      endpoint,
      dsn,
      release: asText(given.release),
      environment: asText(given.environment) || 'production',
      enabled: given.enabled !== false,
      sampleRate: asNumber(given.sampleRate, 1.0),
      maxBreadcrumbs: asNumber(given.maxBreadcrumbs, 100) || 100,
      user: asObject<User | null>(given.user, null),
      context: asObject<Record<string, any>>(given.context, {}),
      beforeSend: typeof given.beforeSend === 'function' ? given.beforeSend : (event) => event,
      transport: {
        timeout: asNumber(transport.timeout, 10000) || 10000,
        retries: asNumber(transport.retries, 3),
        headers: asObject<Record<string, string>>(transport.headers, {}),
      },
      verifySSL: given.verifySSL !== false,
      blacklist: asStringList(given.blacklist),
      urlBlacklist: asStringList(given.urlBlacklist),
      maxEventsPerMinute: asNumber(given.maxEventsPerMinute, 100),
      dedupeWindowMs: asNumber(given.dedupeWindowMs, 5000),
    };
  }

  /**
   * Two credentials reach the ingest route: a project's ingest key on its own,
   * or the older account login key paired with a project key.
   */
  private resolveStatus(options: Required<LaraBugOptions>): LaraBugClientStatus {
    // Before the credentials, so that a caller who turned reporting off is not
    // told about keys they therefore did not have to supply.
    if (!options.enabled) {
      return { active: false, reason: 'the enabled option is false' };
    }

    if (!options.ingest_key && !(options.login_key && options.project_key)) {
      return {
        active: false,
        reason:
          'no usable credentials. Pass ingest_key (your project\'s key, the one safe to put in a ' +
          'browser), or dsn, or both login_key and project_key',
      };
    }

    return { active: true, reason: null };
  }

  /**
   * Parse DSN string (format: https://credential:project_key@host/path)
   *
   * An ingest key names its project on its own, so the second field is optional
   * for one. Returns null for a DSN it cannot use, leaving explicitly passed
   * keys to stand.
   */
  private parseDsn(dsn: string): { credential: string; project_key: string; endpoint: string } | null {
    try {
      const url = new URL(dsn);
      const credential = url.username;
      const project_key = url.password;

      if (!credential) {
        warn('[LaraBug] Ignoring a DSN with no key in it. Expected: https://key:project_key@host/path');
        return null;
      }

      if (!credential.startsWith(INGEST_KEY_PREFIX) && !project_key) {
        warn(
          '[LaraBug] Ignoring a DSN with no project key in it. Expected: ' +
            'https://login_key:project_key@host/path'
        );
        return null;
      }

      return {
        credential,
        project_key,
        endpoint: `${url.protocol}//${url.host}${url.pathname}`,
      };
    } catch (error) {
      warn('[LaraBug] Ignoring an unparseable DSN. Expected: https://key:project_key@host/path', error);
      return null;
    }
  }

  /**
   * Capture an exception
   */
  captureException(error: Error, context?: Record<string, any>): void {
    if (__captureInFlight) {
      return;
    }
    __captureInFlight = true;
    try {
      if (!this.shouldSend()) {
        return;
      }

      const event = this.buildErrorEvent(error, context);
      this.sendEvent(event);
    } catch (inner) {
      // Never rethrow — that would route the error back into Laravel/React/Vue's
      // handler and feed it straight back to capture, causing infinite recursion.
      if (typeof console !== 'undefined' && console.error) {
        console.error('LaraBug: capture failed', inner);
      }
    } finally {
      __captureInFlight = false;
    }
  }

  /**
   * Capture a message
   */
  captureMessage(message: string, level: 'error' | 'warning' | 'info' = 'info'): void {
    if (__captureInFlight) {
      return;
    }
    __captureInFlight = true;
    try {
      if (!this.shouldSend()) {
        return;
      }

      const event: ErrorEvent = {
        message,
        level,
        timestamp: Date.now(),
        environment: this.options.environment,
        release: this.options.release,
        user: this.user || undefined,
        context: { ...this.context, ...this.options.context },
        breadcrumbs: [...this.breadcrumbs],
        extra: { tags: this.tags },
      };

      this.sendEvent(event);
    } catch (inner) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('LaraBug: capture failed', inner);
      }
    } finally {
      __captureInFlight = false;
    }
  }

  /**
   * Add a breadcrumb
   */
  addBreadcrumb(breadcrumb: Omit<Breadcrumb, 'timestamp'>): void {
    const fullBreadcrumb: Breadcrumb = {
      ...breadcrumb,
      timestamp: Date.now(),
    };

    this.breadcrumbs.push(fullBreadcrumb);

    // Keep only the last N breadcrumbs
    if (this.breadcrumbs.length > this.options.maxBreadcrumbs) {
      this.breadcrumbs = this.breadcrumbs.slice(-this.options.maxBreadcrumbs);
    }
  }

  /**
   * Set user context
   */
  setUser(user: User | null): void {
    this.user = user;
  }

  /**
   * Set custom context
   */
  setContext(key: string, value: any): void {
    this.context[key] = value;
  }

  /**
   * Set a tag
   */
  setTag(key: string, value: string): void {
    this.tags[key] = value;
  }

  /**
   * Clear breadcrumbs
   */
  clearBreadcrumbs(): void {
    this.breadcrumbs = [];
  }

  /**
   * Get current options
   */
  getOptions(): LaraBugOptions {
    return { ...this.options };
  }

  /** Whether this client will actually report anything. `getStatus()` says why not. */
  isActive(): boolean {
    return this.status.active;
  }

  /** Whether this client is reporting, and why not when it isn't. */
  getStatus(): LaraBugClientStatus {
    return { ...this.status };
  }

  /**
   * Build an error event from an exception
   */
  private buildErrorEvent(error: Error, context?: Record<string, any>): ErrorEvent {
    const stacktrace = this.parseStackTrace(error);

    return {
      message: error.message || 'Unknown error',
      exception: {
        type: error.name || 'Error',
        value: error.message || '',
        stacktrace,
      },
      level: 'error',
      timestamp: Date.now(),
      environment: this.options.environment,
      release: this.options.release,
      user: this.user || undefined,
      context: { ...this.context, ...this.options.context, ...context },
      breadcrumbs: [...this.breadcrumbs],
      request: this.captureRequestInfo(),
      extra: {
        tags: this.tags,
      },
    };
  }

  /**
   * Capture current request information
   *
   * Protected, not private: @larabug/browser overrides it, and private on both
   * let the subclass shadow this at runtime while TypeScript saw no relation.
   */
  protected captureRequestInfo(): RequestInfo | undefined {
    if (typeof window === 'undefined') {
      return undefined;
    }

    return {
      url: window.location.href,
      method: 'GET', // Browser context is always GET for page loads
      query_string: window.location.search,
    };
  }

  /**
   * Parse error stack trace
   */
  private parseStackTrace(error: Error): StackFrame[] {
    if (!error.stack) {
      return [];
    }

    const frames: StackFrame[] = [];
    const lines = error.stack.split('\n').slice(1); // Skip the first line (error message)

    for (const line of lines) {
      const frame = this.parseStackLine(line);
      if (frame) {
        frames.push(frame);
      }
    }

    return frames;
  }

  /**
   * Parse a single stack trace line
   */
  private parseStackLine(line: string): StackFrame | null {
    // Match patterns like:
    // at functionName (filename:line:column)
    // at filename:line:column
    const chromePattern = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/;
    const match = line.match(chromePattern);

    if (match) {
      return {
        function: match[1] || '<anonymous>',
        filename: match[2],
        lineno: parseInt(match[3], 10),
        colno: parseInt(match[4], 10),
        in_app: !this.isThirdPartyCode(match[2]),
      };
    }

    return null;
  }

  /**
   * Check if code is from third-party library
   */
  private isThirdPartyCode(filename: string): boolean {
    return filename.includes('node_modules') || filename.includes('vendor');
  }

  /**
   * Check if we should send this event
   */
  private shouldSend(): boolean {
    if (!this.status.active) {
      return false;
    }

    if (this.options.sampleRate < 1.0 && Math.random() > this.options.sampleRate) {
      return false;
    }

    return true;
  }

  /** Run an event through the DataFilter before it leaves the SDK. */
  private filterEvent(event: ErrorEvent): ErrorEvent {
    return {
      ...event,
      message: this.dataFilter.filterMessage(event.message),
      context: event.context ? this.dataFilter.filter(event.context) : undefined,
      user: event.user ? this.dataFilter.filter(event.user) : undefined,
      extra: event.extra ? this.dataFilter.filter(event.extra) : undefined,
      breadcrumbs: event.breadcrumbs
        ? event.breadcrumbs.map((b) => ({
            ...b,
            message: b.message ? this.dataFilter.filterMessage(b.message) : undefined,
            data: b.data ? (this.dataFilter.filter(b.data) as Record<string, any>) : undefined,
          }))
        : undefined,
      request: event.request
        ? {
            ...event.request,
            url: event.request.url ? this.dataFilter.filterUrl(event.request.url) : undefined,
            query_string: event.request.query_string
              ? this.dataFilter.filterUrl(`?${event.request.query_string}`).slice(1)
              : undefined,
            headers: event.request.headers
              ? (this.dataFilter.filter(event.request.headers) as Record<string, string>)
              : undefined,
            data: event.request.data ? this.dataFilter.filter(event.request.data) : undefined,
          }
        : undefined,
      exception: event.exception
        ? {
            ...event.exception,
            value: this.dataFilter.filterMessage(event.exception.value),
          }
        : undefined,
    };
  }

  /**
   * Send event to LaraBug API
   */
  private sendEvent(event: ErrorEvent): void {
    // Filter first so beforeSend only ever sees safe data.
    const filtered = this.filterEvent(event);

    // beforeSend hook — user can mutate or drop the event.
    let processedEvent: ErrorEvent | null;
    try {
      processedEvent = this.options.beforeSend(filtered);
    } catch (e) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('LaraBug: beforeSend threw — dropping event', e);
      }
      return;
    }
    if (!processedEvent) {
      return;
    }

    // Dedupe + rate limit + circuit breaker check.
    if (!this.rateLimiter.shouldSend(processedEvent)) {
      return;
    }

    const url = `${this.options.endpoint}`;

    // Wrap event with project key and type (matching PHP SDK format). An ingest
    // key already names the project server-side, so the field is omitted then.
    const payload = JSON.stringify({
      type: 'javascript_error',
      ...(this.options.project_key ? { project: this.options.project_key } : {}),
      ...processedEvent,
    });

    // Fire and forget with retry. We intentionally do not `await` this so
    // the caller's stack unwinds immediately — the retry loop happens in
    // the background and can't block rendering.
    void this.sendViaFetch(url, payload);
  }

  /**
   * Credentials and headers for an ingest request. Authorization is sent only
   * when there is a login key, because `Bearer undefined` is worse than no
   * header, and caller-supplied headers win over both credentials.
   */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (this.options.ingest_key) {
      headers['X-LaraBug-Ingest-Key'] = this.options.ingest_key;
    }

    if (this.options.login_key) {
      headers['Authorization'] = `Bearer ${this.options.login_key}`;
    }

    return { ...headers, ...this.options.transport.headers };
  }

  /**
   * Send via fetch API with retry + backoff
   */
  private async sendViaFetch(url: string, payload: string, attempt = 0): Promise<void> {
    if (this.rateLimiter.isDisabled()) {
      return;
    }

    const maxAttempts = Math.max(1, this.options.transport.retries || 1);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: payload,
        keepalive: true,
      });

      if (response.ok) {
        this.rateLimiter.recordSuccess();
        return;
      }

      // Non-2xx. Decide whether to retry.
      if (!this.rateLimiter.isRetryableStatus(response.status)) {
        // Permanent failure (4xx other than throttling). Don't retry, don't
        // hammer the server. Just silently drop so we don't create a log
        // feedback loop.
        this.rateLimiter.recordSuccess();
        return;
      }

      const decision = this.rateLimiter.recordFailure(response);
      if (decision.shouldRetry && attempt + 1 < maxAttempts) {
        await this.wait(decision.delayMs);
        return this.sendViaFetch(url, payload, attempt + 1);
      }
    } catch (error) {
      const decision = this.rateLimiter.recordFailure(null);
      if (decision.shouldRetry && attempt + 1 < maxAttempts) {
        await this.wait(decision.delayMs);
        return this.sendViaFetch(url, payload, attempt + 1);
      }

      // Final failure. Log once and stop — do NOT throw.
      if (typeof console !== 'undefined' && console.error) {
        console.error('LaraBug: Failed to send error', error);
      }
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
