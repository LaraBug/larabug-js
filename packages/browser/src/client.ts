import { BaseLaraBugClient, LaraBugOptions, RequestInfo, DataFilter } from '@larabug/core';

/**
 * Browser-specific LaraBug client with automatic instrumentation
 */
export class BrowserClient extends BaseLaraBugClient {
  private installed = false;
  private breadcrumbFilter: DataFilter;

  constructor(options: LaraBugOptions) {
    super(options);
    // A separate DataFilter instance for breadcrumbs. Same default blacklist
    // as the core filter, but applied *before* breadcrumbs are pushed into
    // the buffer — so even if the SDK is later reconfigured, the breadcrumbs
    // already in memory are safe.
    this.breadcrumbFilter = new DataFilter({
      blacklist: options.blacklist,
      urlBlacklist: options.urlBlacklist,
    });
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
   * Instrument console methods to capture as breadcrumbs. Arguments run
   * through the DataFilter before being stored so free-text secrets logged
   * by the host app (tokens, passwords, raw API responses) never reach
   * the ingest endpoint.
   */
  private instrumentConsole(): void {
    const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'] as const;

    consoleMethods.forEach((method) => {
      const original = console[method];
      console[method] = (...args: any[]) => {
        try {
          const filteredArgs = this.breadcrumbFilter.filter(args);
          const message = (filteredArgs as any[])
            .map((arg) => (typeof arg === 'string' ? arg : this.safeStringify(arg)))
            .join(' ');

          this.addBreadcrumb({
            type: 'console',
            category: 'console',
            message: this.breadcrumbFilter.filterMessage(message),
            level: method === 'error' ? 'error' : method === 'warn' ? 'warning' : 'info',
            data: { arguments: filteredArgs as any[] },
          });
        } catch {
          // If filtering throws, drop the breadcrumb entirely. We never
          // fall back to logging unfiltered data.
        }

        original.apply(console, args);
      };
    });
  }

  private safeStringify(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return '[Unserializable]';
    }
  }

  /**
   * Instrument fetch API
   */
  private instrumentFetch(): void {
    if (!window.fetch) {
      return;
    }

    const originalFetch = window.fetch;

    const filter = this.breadcrumbFilter;
    const self = this;

    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const [resource, options] = args;
      const rawUrl = typeof resource === 'string' ? resource : resource.url;
      const url = filter.filterUrl(rawUrl);
      const method = options?.method || 'GET';

      const startTime = Date.now();

      try {
        const response = await originalFetch(...args);
        const duration = Date.now() - startTime;

        self.addBreadcrumb({
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

        self.addBreadcrumb({
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
    const filter = this.breadcrumbFilter;

    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      ...rest: any[]
    ) {
      // @ts-ignore
      this.__larabug = {
        method,
        url: filter.filterUrl(url.toString()),
        startTime: Date.now(),
      };
      return originalOpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function (...args: any[]) {
      const client = (globalThis as any).__larabugClient as BrowserClient;

      if (this.__larabug && client) {
        this.addEventListener('load', function () {
          const duration = Date.now() - this.__larabug!.startTime;

          client.addBreadcrumb({
            type: 'http',
            category: 'xhr',
            data: {
              url: this.__larabug!.url,
              method: this.__larabug!.method,
              status_code: this.status,
              duration,
            },
            level: this.status >= 400 ? 'error' : 'info',
          });
        });

        this.addEventListener('error', function () {
          const duration = Date.now() - this.__larabug!.startTime;

          client.addBreadcrumb({
            type: 'http',
            category: 'xhr',
            data: {
              url: this.__larabug!.url,
              method: this.__larabug!.method,
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
   * Capture navigation breadcrumbs. All URLs — including document.referrer,
   * which frequently carries session tokens from third-party sites — are
   * routed through the DataFilter before being recorded.
   */
  private captureNavigation(): void {
    const filter = this.breadcrumbFilter;

    // Capture initial page load
    this.addBreadcrumb({
      type: 'navigation',
      category: 'navigation',
      message: 'Page loaded',
      data: {
        from: filter.filterUrl(document.referrer),
        to: filter.filterUrl(window.location.href),
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
            data: {
              from: filter.filterUrl(from),
              to: filter.filterUrl(to),
            },
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
          from: filter.filterUrl(event.oldURL),
          to: filter.filterUrl(event.newURL),
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
export {}; // Make this a module

declare global {
  interface XMLHttpRequest {
    __larabug?: {
      method: string;
      url: string;
      startTime: number;
    };
  }
}
