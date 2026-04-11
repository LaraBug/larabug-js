import {
  LaraBugOptions,
  LaraBugClient,
  ErrorEvent,
  Breadcrumb,
  User,
  StackFrame,
  RequestInfo,
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

/**
 * Core LaraBug client implementation
 */
export class BaseLaraBugClient implements LaraBugClient {
  private options: Required<LaraBugOptions>;
  private breadcrumbs: Breadcrumb[] = [];
  private user: User | null = null;
  private context: Record<string, any> = {};
  private tags: Record<string, string> = {};
  private dataFilter: DataFilter;
  private rateLimiter: RateLimiter;

  constructor(options: LaraBugOptions) {
    this.options = this.normalizeOptions(options);
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
    let login_key = options.login_key || '';
    let project_key = options.project_key || '';
    let endpoint = options.endpoint || 'https://www.larabug.com/api/log';

    // Parse DSN if provided (takes precedence)
    if (options.dsn) {
      const parsed = this.parseDsn(options.dsn);
      if (parsed) {
        login_key = parsed.login_key;
        project_key = parsed.project_key;
        endpoint = parsed.endpoint;
      }
    }

    if (!login_key || !project_key) {
      throw new Error('LaraBug: login_key and project_key are required. Use dsn or provide both keys.');
    }

    return {
      login_key,
      project_key,
      endpoint,
      dsn: options.dsn || '',
      release: options.release || '',
      environment: options.environment || 'production',
      enabled: options.enabled !== false,
      sampleRate: options.sampleRate ?? 1.0,
      maxBreadcrumbs: options.maxBreadcrumbs || 100,
      user: options.user || null,
      context: options.context || {},
      beforeSend: options.beforeSend || ((event) => event),
      transport: {
        timeout: options.transport?.timeout || 10000,
        retries: options.transport?.retries ?? 3,
        headers: options.transport?.headers || {},
      },
      verifySSL: options.verifySSL !== false,
      blacklist: options.blacklist || [],
      urlBlacklist: options.urlBlacklist || [],
      maxEventsPerMinute: options.maxEventsPerMinute ?? 100,
      dedupeWindowMs: options.dedupeWindowMs ?? 5000,
    };
  }

  /**
   * Parse DSN string (format: https://login_key:project_key@host/path)
   */
  private parseDsn(dsn: string): { login_key: string; project_key: string; endpoint: string } | null {
    try {
      const url = new URL(dsn);
      const login_key = url.username;
      const project_key = url.password;

      if (!login_key || !project_key) {
        throw new Error('DSN must contain both login_key and project_key');
      }

      return {
        login_key,
        project_key,
        endpoint: `${url.protocol}//${url.host}${url.pathname}`,
      };
    } catch (error) {
      console.error('LaraBug: Invalid DSN format. Expected: https://login_key:project_key@host/path', error);
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
   */
  private captureRequestInfo(): RequestInfo | undefined {
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
    if (!this.options.enabled) {
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

    // Wrap event with project key and type (matching PHP SDK format)
    const payload = JSON.stringify({
      type: 'javascript_error',
      project: this.options.project_key,
      ...processedEvent,
    });

    // Fire and forget with retry. We intentionally do not `await` this so
    // the caller's stack unwinds immediately — the retry loop happens in
    // the background and can't block rendering.
    void this.sendViaFetch(url, payload);
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
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.options.login_key}`,
          ...this.options.transport.headers,
        },
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
