import {
  LaraBugOptions,
  LaraBugClient,
  ErrorEvent,
  Breadcrumb,
  User,
  StackFrame,
} from './types';

/**
 * Core LaraBug client implementation
 */
export class BaseLaraBugClient implements LaraBugClient {
  private options: Required<LaraBugOptions>;
  private breadcrumbs: Breadcrumb[] = [];
  private user: User | null = null;
  private context: Record<string, any> = {};
  private tags: Record<string, string> = {};

  constructor(options: LaraBugOptions) {
    this.options = this.normalizeOptions(options);
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
        retries: options.transport?.retries || 3,
        headers: options.transport?.headers || {},
      },
      verifySSL: options.verifySSL !== false,
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
    if (!this.shouldSend()) {
      return;
    }

    const event = this.buildErrorEvent(error, context);
    this.sendEvent(event);
  }

  /**
   * Capture a message
   */
  captureMessage(message: string, level: 'error' | 'warning' | 'info' = 'info'): void {
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

  /**
   * Send event to LaraBug API
   */
  private sendEvent(event: ErrorEvent): void {
    // Apply beforeSend hook
    const processedEvent = this.options.beforeSend(event);
    if (!processedEvent) {
      return;
    }

    const url = `${this.options.endpoint}`;
    
    // Wrap event with project key and type (matching PHP SDK format)
    const payload = JSON.stringify({
      type: 'javascript_error',
      project: this.options.project_key,
      ...processedEvent,
    });

    // Use sendBeacon if available for better reliability
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      // Note: sendBeacon doesn't support custom headers, so we use fetch instead
      this.sendViaFetch(url, payload);
    } else {
      // Fallback to fetch
      this.sendViaFetch(url, payload);
    }
  }

  /**
   * Send via fetch API (matching PHP SDK authentication)
   */
  private async sendViaFetch(url: string, payload: string): Promise<void> {
    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.options.login_key}`,
          ...this.options.transport.headers,
        },
        body: payload,
        // Don't wait for response to avoid blocking
        keepalive: true,
      });
    } catch (error) {
      // Silently fail - we don't want to throw errors from error reporting
      if (console && console.error) {
        console.error('LaraBug: Failed to send error', error);
      }
    }
  }
}
