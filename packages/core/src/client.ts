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
    return {
      key: options.key,
      endpoint: options.endpoint || 'https://api.larabug.com',
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
    };
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
      extra: {
        tags: this.tags,
      },
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

    const url = `${this.options.endpoint}/errors`;
    const payload = JSON.stringify(processedEvent);

    // Use sendBeacon if available for better reliability
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(url, blob);
    } else {
      // Fallback to fetch
      this.sendViaFetch(url, payload);
    }
  }

  /**
   * Send via fetch API
   */
  private async sendViaFetch(url: string, payload: string): Promise<void> {
    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-LaraBug-Key': this.options.key,
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
