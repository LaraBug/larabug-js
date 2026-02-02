/**
 * Configuration options for LaraBug client
 */
export interface LaraBugOptions {
  /** Your LaraBug login key (from profile) */
  login_key?: string;

  /** Your LaraBug project key (from project settings) */
  project_key?: string;

  /** API endpoint URL */
  endpoint?: string;

  /** DSN string (format: https://login_key:project_key@host/path) - overrides individual keys */
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
  user?: User;

  /** Additional context data */
  context?: Record<string, any>;

  /** Error filtering callback */
  beforeSend?: (event: ErrorEvent) => ErrorEvent | null;

  /** Transport options */
  transport?: TransportOptions;

  /** Verify SSL certificates (defaults to true) */
  verifySSL?: boolean;
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
}
