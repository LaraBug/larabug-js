import { App, Plugin } from 'vue';
import { init, BrowserClient } from '@larabug/browser';
import { LaraBugOptions } from '@larabug/core';

export interface VueLaraBugOptions extends LaraBugOptions {
  /** Attach Vue instance info to errors */
  attachProps?: boolean;
  
  /** Track lifecycle hooks as breadcrumbs */
  trackLifecycleHooks?: boolean;
  
  /** Custom error handler */
  logErrors?: boolean;
}

/**
 * Vue 3 plugin for LaraBug
 * 
 * Automatically captures Vue errors and integrates with Vue's error handling
 * 
 * @example
 * ```ts
 * import { createApp } from 'vue';
 * import { LaraBugVuePlugin } from '@larabug/vue';
 * 
 * const app = createApp(App);
 * app.use(LaraBugVuePlugin, {
 *   key: 'your-larabug-key',
 *   environment: 'production',
 * });
 * ```
 */
export const LaraBugVuePlugin: Plugin = {
  install(app: App, options: VueLaraBugOptions) {
    const {
      attachProps = true,
      trackLifecycleHooks = false,
      logErrors = true,
      ...larabugOptions
    } = options;

    // Initialize LaraBug client
    const client = init(larabugOptions);

    // Store client on app
    app.config.globalProperties.$larabug = client;

    // Setup Vue error handler
    const originalErrorHandler = app.config.errorHandler;

    app.config.errorHandler = (err: unknown, instance, info) => {
      const error = err instanceof Error ? err : new Error(String(err));

      // Build context from Vue component
      const context: Record<string, any> = {
        mechanism: 'vue-error-handler',
        info,
      };

      if (instance && attachProps) {
        context.componentName = instance.$options?.name || instance.$options?.__name || 'anonymous';
        context.propsData = instance.$props;
      }

      // Capture error
      client.captureException(error, context);

      // Call original error handler
      if (originalErrorHandler) {
        originalErrorHandler(err, instance, info);
      }

      // Log to console in development
      if (logErrors && process.env.NODE_ENV !== 'production') {
        console.error('[LaraBug] Error captured:', error);
      }
    };

    // Setup Vue warning handler
    const originalWarnHandler = app.config.warnHandler;

    app.config.warnHandler = (msg, instance, trace) => {
      client.addBreadcrumb({
        type: 'default',
        category: 'vue-warning',
        message: msg,
        level: 'warning',
        data: {
          componentName: instance?.$options?.name || 'anonymous',
          trace,
        },
      });

      // Call original warning handler
      if (originalWarnHandler) {
        originalWarnHandler(msg, instance, trace);
      }
    };

    // Track lifecycle hooks as breadcrumbs
    if (trackLifecycleHooks) {
      app.mixin({
        beforeMount() {
          client.addBreadcrumb({
            type: 'default',
            category: 'vue-lifecycle',
            message: 'Component beforeMount',
            data: {
              componentName: this.$options?.name || 'anonymous',
            },
          });
        },
        mounted() {
          client.addBreadcrumb({
            type: 'default',
            category: 'vue-lifecycle',
            message: 'Component mounted',
            data: {
              componentName: this.$options?.name || 'anonymous',
            },
          });
        },
        beforeUnmount() {
          client.addBreadcrumb({
            type: 'default',
            category: 'vue-lifecycle',
            message: 'Component beforeUnmount',
            data: {
              componentName: this.$options?.name || 'anonymous',
            },
          });
        },
      });
    }

    // Provide client for injection
    app.provide('larabug', client);
  },
};

// Type augmentation for Vue 3
declare module '@vue/runtime-core' {
  interface ComponentCustomProperties {
    $larabug: BrowserClient;
  }
}
