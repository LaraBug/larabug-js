/**
 * Configuration options for LaraBug client
 *
 * Every field is optional and every field is validated at construction time.
 * Options reach the SDK from places that are not TypeScript (a Blade template,
 * a `.env` file read by a server-side package, a hand-written script tag), so
 * a missing or wrong-typed value turns reporting off and says so once. It
 * never throws: see `BaseLaraBugClient`.
 */
export interface LaraBugOptions {
  /**
   * Your project's ingest key, from the project's settings (prefixed `lbi_`).
   *
   * Write-only and scoped to the one project, which makes it the only
   * credential that is safe to render into a page every visitor can read.
   * Sufficient on its own: it identifies the project, so `project_key` is not
   * needed alongside it.
   */
  ingest_key?: string;

  /**
   * Your LaraBug login key (the account api_token, from your profile).
   *
   * Account-wide, so it must never appear in browser JavaScript. Kept for the
   * SDKs already deployed with it, and only usable together with
   * `project_key`. Prefer `ingest_key` for anything a browser loads.
   *
   * @deprecated Use `ingest_key` (or a `dsn`, which now carries one).
   */
  login_key?: string;

  /** Your LaraBug project key (from project settings) */
  project_key?: string;

  /** API endpoint URL */
  endpoint?: string;

  /**
   * DSN string (format: https://key:project_key@host/path) - overrides
   * individual keys.
   *
   * The first field is a project ingest key on a DSN issued today, and an
   * account login key on an older one. The SDK tells them apart by the `lbi_`
   * prefix, so the same option accepts either.
   */
  dsn?: string;

  /** Release version for tracking deployments */
  release?: string;

  /** Environment name (e.g., production, staging) */
  environment?: string;

  /** Whether to report errors in the current environment */
  enabled?: boolean;

  /** Sample rate for error reporting (0.0 to 1.0) */
  sampleRate?: number;

  /** Maximum breadcrumbs to capture */
  maxBreadcrumbs?: number;

  /** Custom user context */
  user?: User | null;

  /** Additional context data */
  context?: Record<string, any>;

  /** Error filtering callback */
  beforeSend?: (event: ErrorEvent) => ErrorEvent | null;

  /** Transport options */
  transport?: TransportOptions;

  /** Verify SSL certificates (defaults to true) */
  verifySSL?: boolean;

  /**
   * Additional object key patterns the data filter should treat as sensitive.
   * Matched case-insensitively against keys via substring. Merged with the
   * SDK's default blacklist (password, token, secret, auth, cookie, etc.).
   *
   * Mirrors the PHP SDK's `larabug.blacklist` config key.
   */
  blacklist?: string[];

  /**
   * Additional query-string parameter names to filter in URLs. Merged with
   * the default list (token, access_token, refresh_token, api_key, ...).
   */
  urlBlacklist?: string[];

  /**
   * Hard cap on events emitted per minute from this client. Any event above
   * this budget is dropped, not queued. Defaults to 100.
   */
  maxEventsPerMinute?: number;

  /**
   * Window (in ms) during which two identical events are treated as a
   * duplicate and suppressed. Defaults to 5000.
   */
  dedupeWindowMs?: number;
}

/**
 * Whether a client is reporting, and why it isn't when it isn't.
 *
 * A client that cannot report is inert rather than broken, so nothing else
 * signals the problem. This is how code asks.
 */
export interface LaraBugClientStatus {
  /** True when the client has a usable credential and reporting is enabled. */
  active: boolean;

  /**
   * Why the client is inert, in a sentence fit to show a developer. Null
   * while `active` is true.
   */
  reason: string | null;
}

/**
 * User information
 */
export interface User {
  id?: string | number;
  email?: string;
  name?: string;
  [key: string]: any;
}

/**
 * Breadcrumb for tracking user actions
 */
export interface Breadcrumb {
  type: 'navigation' | 'http' | 'user' | 'console' | 'error' | 'default';
  category?: string;
  message?: string;
  data?: Record<string, any>;
  level?: 'debug' | 'info' | 'warning' | 'error';
  timestamp: number;
}

/**
 * Stack frame information
 */
export interface StackFrame {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
}

/**
 * Error event that gets sent to LaraBug
 */
export interface ErrorEvent {
  message: string;
  exception?: {
    type: string;
    value: string;
    stacktrace: StackFrame[];
  };
  level: 'error' | 'warning' | 'info';
  timestamp: number;
  environment?: string;
  release?: string;
  user?: User;
  context?: Record<string, any>;
  breadcrumbs?: Breadcrumb[];
  request?: RequestInfo;
  extra?: Record<string, any>;
}

/**
 * HTTP request information
 */
export interface RequestInfo {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  data?: any;
  query_string?: string;
}

/**
 * Transport configuration
 */
export interface TransportOptions {
  /** Request timeout in milliseconds */
  timeout?: number;

  /** Number of retry attempts */
  retries?: number;

  /** Custom headers */
  headers?: Record<string, string>;
}

/**
 * LaraBug client interface
 */
export interface LaraBugClient {
  /** Capture an exception */
  captureException(error: Error, context?: Record<string, any>): void;

  /** Capture a message */
  captureMessage(message: string, level?: 'error' | 'warning' | 'info'): void;

  /** Add a breadcrumb */
  addBreadcrumb(breadcrumb: Omit<Breadcrumb, 'timestamp'>): void;

  /** Set user context */
  setUser(user: User | null): void;

  /** Set custom context */
  setContext(key: string, value: any): void;

  /** Set a tag */
  setTag(key: string, value: string): void;

  /** Clear breadcrumbs */
  clearBreadcrumbs(): void;

  /** Get current options */
  getOptions(): LaraBugOptions;

  /** Whether this client will actually report anything */
  isActive(): boolean;

  /** Whether this client is reporting, and why not when it isn't */
  getStatus(): LaraBugClientStatus;
}
