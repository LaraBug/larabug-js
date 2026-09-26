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

/**
 * Prefix of a project's write-only ingest key. The server distinguishes an
 * ingest key from an account api_token by this prefix alone, everywhere both
 * can arrive, so the SDK can classify a credential the same way without
 * having to be told which kind it was handed.
 */
const INGEST_KEY_PREFIX = 'lbi_';

const DEFAULT_ENDPOINT = 'https://www.larabug.com/api/log';

/**
 * Option readers. Options arrive from places that are not TypeScript, so
 * nothing here trusts a declared type: a wrong-typed value falls back to the
 * default rather than reaching code that would throw on it later.
 */
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

/** Say something to the developer without assuming a console exists. */
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
 * Construction cannot throw, for any input. An error tracker is installed
 * before the code it watches, so a constructor that throws takes out every
 * module after it in the bundle: one missing key becomes a page with no
 * JavaScript at all. A client that cannot report is therefore inert instead,
 * warns once, and reports why through `isActive()` / `getStatus()`.
 *
 * Errors belonging to the host application are not swallowed: those still
 * reach the host's own handlers, and the instrumentation in @larabug/browser
 * rethrows everything it observes.
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
      // normalizeOptions reads every value defensively, so arriving here means
      // the options object itself misbehaved: a throwing getter, a revoked
      // proxy. Reporting goes off and the page carries on regardless.
      normalized = this.normalizeOptions({});
      status = { active: false, reason: 'the options object could not be read' };
      failure = error;
    }

    this.options = normalized;
    this.status = status;

    // One warning, only when the caller did not ask for silence. A client that
    // was deliberately turned off with `enabled: false` says nothing.
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

    // A DSN that parses replaces the credentials rather than topping them up:
    // it is one value that carries all of them.
    if (dsn) {
      const parsed = this.parseDsn(dsn);
      if (parsed) {
        login_key = parsed.credential;
        project_key = parsed.project_key;
        endpoint = parsed.endpoint;
        ingest_key = '';
      }
    }

    // The panel hands out a DSN whose first field is the project's ingest key,
    // and the workaround before this option existed was to paste that key into
    // login_key by hand. Both land here, and the prefix says what the value
    // really is, so it goes out as an ingest key rather than as a bearer token.
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
   * Whether this client can report, and why not when it cannot.
   *
   * Two credentials reach the ingest route: a project's ingest key on its own,
   * which identifies the project and authorises nothing else, or the older
   * account login key paired with a project key. Anything else is a
   * misconfiguration, and a misconfiguration turns reporting off.
   */
  private resolveStatus(options: Required<LaraBugOptions>): LaraBugClientStatus {
    // Asked for first, answered first: a caller who turned reporting off does
    // not need to hear about the keys they therefore did not have to supply.
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
   * The first field is a project ingest key on a DSN issued today and an
   * account login key on an older one; normalizeOptions decides which by its
   * prefix. An ingest key names its project on its own, so the second field
   * is optional for one.
   *
   * Returns null for a DSN it cannot use, leaving any explicitly passed keys
   * to stand on their own.
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

  /**
   * Whether this client will actually report anything.
   *
   * False when it has no usable credentials, or when reporting was turned off
   * on purpose. `getStatus()` says which.
   */
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
   * Protected because @larabug/browser overrides it. It was private on both
   * classes, which at runtime still let the subclass shadow this one while
   * telling TypeScript the two were unrelated.
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

    // Wrap event with project key and type (matching PHP SDK format). The
    // project is omitted when we don't have one: an ingest key already names
    // the project server-side, and an empty `project` would only be a field
    // the server has to decide to ignore.
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
   * Credentials and headers for an ingest request.
   *
   * The ingest key goes in a header of its own, which is where the server
   * looks first. The account login key goes in the Authorization header it
   * always used, and only when there is one: `Bearer undefined` is worse than
   * no header at all. Caller-supplied headers win over both, which is what
   * kept the header workaround working before `ingest_key` existed.
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
