import { BaseLaraBugClient, LaraBugOptions, RequestInfo } from '@larabug/core';

/**
 * Browser-specific LaraBug client with automatic instrumentation
 */
export class BrowserClient extends BaseLaraBugClient {
  private installed = false;

  constructor(options: LaraBugOptions) {
    super(options);
    this.install();
  }

  /**
   * Install browser instrumentation
   */
  private install(): void {
    if (this.installed) {
      return;
    }

    this.installGlobalErrorHandler();
    this.installUnhandledRejectionHandler();
    this.instrumentConsole();
    this.instrumentFetch();
    this.instrumentXHR();
    this.captureNavigation();

    this.installed = true;
  }

  /**
   * Capture global errors
   */
  private installGlobalErrorHandler(): void {
    window.addEventListener('error', (event: ErrorEvent) => {
      // Ignore if error is from a script
      if (event.filename) {
        const error = new Error(event.message);
        error.name = 'Error';
        // @ts-ignore
        error.stack = `Error: ${event.message}\n    at ${event.filename}:${event.lineno}:${event.colno}`;

        this.captureException(error, {
          handled: false,
          mechanism: 'onerror',
        });
      } else if (event.error) {
        this.captureException(event.error, {
          handled: false,
          mechanism: 'onerror',
        });
      }
    });
  }

  /**
   * Capture unhandled promise rejections
   */
  private installUnhandledRejectionHandler(): void {
    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
      const error = event.reason instanceof Error 
        ? event.reason 
        : new Error(String(event.reason));

      this.captureException(error, {
        handled: false,
        mechanism: 'onunhandledrejection',
      });
    });
  }

  /**
   * Instrument console methods to capture as breadcrumbs
   */
  private instrumentConsole(): void {
    const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'] as const;

    consoleMethods.forEach((method) => {
      const original = console[method];
      console[method] = (...args: any[]) => {
        this.addBreadcrumb({
          type: 'console',
          category: 'console',
          message: args.map(arg => String(arg)).join(' '),
          level: method === 'error' ? 'error' : method === 'warn' ? 'warning' : 'info',
          data: { arguments: args },
        });

        original.apply(console, args);
      };
    });
  }

  /**
   * Instrument fetch API
   */
  private instrumentFetch(): void {
    if (!window.fetch) {
      return;
    }

    const originalFetch = window.fetch;

    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const [resource, options] = args;
      const url = typeof resource === 'string' ? resource : resource.url;
      const method = options?.method || 'GET';

      const startTime = Date.now();

      try {
        const response = await originalFetch(...args);
        const duration = Date.now() - startTime;

        this.addBreadcrumb({
          type: 'http',
          category: 'fetch',
          data: {
            url,
            method,
            status_code: response.status,
            duration,
          },
          level: response.ok ? 'info' : 'error',
        });

        return response;
      } catch (error) {
        const duration = Date.now() - startTime;

        this.addBreadcrumb({
          type: 'http',
          category: 'fetch',
          data: {
            url,
            method,
            duration,
            error: String(error),
          },
          level: 'error',
        });

        throw error;
      }
    };
  }

  /**
   * Instrument XMLHttpRequest
   */
  private instrumentXHR(): void {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(
      method: string,
      url: string | URL,
      ...rest: any[]
    ) {
      // @ts-ignore
      this.__larabug = { method, url: url.toString(), startTime: Date.now() };
      return originalOpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function(...args: any[]) {
      const client = (globalThis as any).__larabugClient as BrowserClient;

      if (this.__larabug && client) {
        this.addEventListener('load', function() {
          const duration = Date.now() - this.__larabug.startTime;

          client.addBreadcrumb({
            type: 'http',
            category: 'xhr',
            data: {
              url: this.__larabug.url,
              method: this.__larabug.method,
              status_code: this.status,
              duration,
            },
            level: this.status >= 400 ? 'error' : 'info',
          });
        });

        this.addEventListener('error', function() {
          const duration = Date.now() - this.__larabug.startTime;

          client.addBreadcrumb({
            type: 'http',
            category: 'xhr',
            data: {
              url: this.__larabug.url,
              method: this.__larabug.method,
              duration,
            },
            level: 'error',
          });
        });
      }

      return originalSend.apply(this, args);
    };

    // Store client reference for XHR callbacks
    (globalThis as any).__larabugClient = this;
  }

  /**
   * Capture navigation breadcrumbs
   */
  private captureNavigation(): void {
    // Capture initial page load
    this.addBreadcrumb({
      type: 'navigation',
      category: 'navigation',
      message: 'Page loaded',
      data: {
        from: document.referrer,
        to: window.location.href,
      },
    });

    // Capture navigation events
    if (window.history && window.history.pushState) {
      const originalPushState = window.history.pushState;
      window.history.pushState = (...args: any[]) => {
        const from = window.location.href;
        const result = originalPushState.apply(window.history, args);
        const to = window.location.href;

        if (from !== to) {
          this.addBreadcrumb({
            type: 'navigation',
            category: 'navigation',
            message: 'Navigation',
            data: { from, to },
          });
        }

        return result;
      };
    }

    // Capture hash changes
    window.addEventListener('hashchange', (event) => {
      this.addBreadcrumb({
        type: 'navigation',
        category: 'navigation',
        message: 'Hash changed',
        data: {
          from: event.oldURL,
          to: event.newURL,
        },
      });
    });
  }

  /**
   * Capture current request information
   */
  private captureRequestInfo(): RequestInfo {
    return {
      url: window.location.href,
      method: 'GET',
      headers: {},
      query_string: window.location.search,
    };
  }
}

// Extend XMLHttpRequest type
declare global {
  interface XMLHttpRequest {
    __larabug?: {
      method: string;
      url: string;
      startTime: number;
    };
  }
}
