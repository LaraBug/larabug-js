import { router } from '@inertiajs/core';
import { getCurrentClient } from '@larabug/browser';
import { LaraBugOptions } from '@larabug/core';

export interface InertiaLaraBugOptions {
  /** Track page visits as breadcrumbs */
  trackPageVisits?: boolean;
  
  /** Track Inertia errors */
  trackErrors?: boolean;
  
  /** Track navigation events */
  trackNavigations?: boolean;
  
  /** Include request data in error context */
  includeRequestData?: boolean;
}

/**
 * Create Inertia.js plugin for LaraBug
 * 
 * Automatically captures Inertia navigation, errors, and request data
 * 
 * @example
 * ```ts
 * import { createInertiaApp } from '@inertiajs/vue3';
 * import { createInertiaLaraBugPlugin } from '@larabug/inertia';
 * 
 * createInertiaApp({
 *   resolve: name => require(`./Pages/${name}`),
 *   setup({ el, App, props, plugin }) {
 *     createApp({ render: () => h(App, props) })
 *       .use(plugin)
 *       .use(createInertiaLaraBugPlugin({
 *         trackPageVisits: true,
 *         trackErrors: true,
 *       }))
 *       .mount(el);
 *   },
 * });
 * ```
 */
export function createInertiaLaraBugPlugin(options: InertiaLaraBugOptions = {}) {
  const {
    trackPageVisits = true,
    trackErrors = true,
    trackNavigations = true,
    includeRequestData = true,
  } = options;

  return {
    install() {
      const client = getCurrentClient();

      if (!client) {
        console.warn('[LaraBug] Client not initialized. Call init() before using Inertia plugin.');
        return;
      }

      // Track page visits
      if (trackPageVisits) {
        router.on('navigate', (event) => {
          client.addBreadcrumb({
            type: 'navigation',
            category: 'inertia',
            message: 'Page visit',
            data: {
              component: event.detail.page.component,
              url: event.detail.page.url,
              method: 'visit',
            },
          });

          // Set page context
          client.setContext('page', {
            component: event.detail.page.component,
            url: event.detail.page.url,
            props: includeRequestData ? event.detail.page.props : undefined,
          });
        });
      }

      // Track navigation start
      if (trackNavigations) {
        router.on('start', (event) => {
          client.addBreadcrumb({
            type: 'navigation',
            category: 'inertia',
            message: 'Navigation started',
            data: {
              url: event.detail.visit.url.toString(),
              method: event.detail.visit.method,
            },
          });
        });

        router.on('progress', (event) => {
          client.addBreadcrumb({
            type: 'default',
            category: 'inertia',
            message: 'Navigation progress',
            data: {
              percentage: event.detail.progress?.percentage,
            },
            level: 'debug',
          });
        });

        router.on('finish', (event) => {
          client.addBreadcrumb({
            type: 'default',
            category: 'inertia',
            message: 'Navigation finished',
            data: {
              url: event.detail.visit.url.toString(),
            },
            level: 'debug',
          });
        });
      }

      // Track errors
      if (trackErrors) {
        router.on('error', (event) => {
          const error = new Error('Inertia request failed');
          
          client.captureException(error, {
            mechanism: 'inertia-error',
            url: event.detail.visit.url.toString(),
            method: event.detail.visit.method,
            errors: event.detail.errors,
          });
        });

        router.on('exception', (event) => {
          client.captureException(event.detail.exception, {
            mechanism: 'inertia-exception',
            url: event.detail.visit.url.toString(),
            method: event.detail.visit.method,
          });
        });
      }

      // Track invalid visits
      router.on('invalid', (event) => {
        client.addBreadcrumb({
          type: 'error',
          category: 'inertia',
          message: 'Invalid Inertia response',
          data: {
            response: event.detail.response,
          },
          level: 'warning',
        });
      });
    },
  };
}

/**
 * Set user from Inertia shared data
 * 
 * @example
 * ```ts
 * import { usePage } from '@inertiajs/vue3';
 * import { setUserFromInertia } from '@larabug/inertia';
 * 
 * const page = usePage();
 * setUserFromInertia(page.props.auth?.user);
 * ```
 */
export function setUserFromInertia(user: any): void {
  const client = getCurrentClient();
  
  if (client && user) {
    client.setUser({
      id: user.id,
      email: user.email,
      name: user.name,
      ...user,
    });
  }
}

/**
 * Attach Laravel session data to error context
 * 
 * @example
 * ```ts
 * import { usePage } from '@inertiajs/vue3';
 * import { attachLaravelContext } from '@larabug/inertia';
 * 
 * const page = usePage();
 * attachLaravelContext(page.props);
 * ```
 */
export function attachLaravelContext(props: any): void {
  const client = getCurrentClient();
  
  if (client) {
    // Attach Laravel-specific context
    if (props.errors) {
      client.setContext('validation', props.errors);
    }

    if (props.flash) {
      client.setContext('flash', props.flash);
    }

    if (props.auth) {
      client.setContext('auth', {
        authenticated: !!props.auth.user,
      });
    }
  }
}
