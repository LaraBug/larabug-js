import { router } from '@inertiajs/core';
import { getCurrentClient } from '@larabug/browser';
import { LaraBugOptions, DataFilter } from '@larabug/core';

export interface InertiaLaraBugOptions {
  /** Track page visits as breadcrumbs */
  trackPageVisits?: boolean;

  /** Track Inertia errors */
  trackErrors?: boolean;

  /** Track navigation events */
  trackNavigations?: boolean;

  /**
   * Include Inertia page.props in the error context. Defaults to **false**
   * because page props regularly contain authenticated user data, CSRF
   * tokens, session flash, and other sensitive payloads. When you opt in,
   * the props go through the LaraBug data filter before being attached, but
   * the safest default is to leave them off and rely on setUserFromInertia
   * / attachLaravelContext for the specific bits you want.
   */
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
    includeRequestData = false,
  } = options;

  // Local DataFilter for any Inertia-specific data we attach. Uses the
  // default blacklist — users can extend it globally on the LaraBug client.
  const dataFilter = new DataFilter();

  return {
    install() {
      const client = getCurrentClient();

      if (!client) {
        console.error('[LaraBug] Client not initialized. Call LaraBug.init() before using the Inertia plugin.');
        return;
      }

      // Ensure framework tag is set
      client.setTag('framework', 'inertia');

      // Track page visits
      if (trackPageVisits) {
        router.on('navigate', (event) => {
          client.addBreadcrumb({
            type: 'navigation',
            category: 'inertia',
            message: 'Page visit',
            data: {
              component: event.detail.page.component,
              url: dataFilter.filterUrl(event.detail.page.url),
              method: 'visit',
            },
          });

          // Set page context. Props are only included when the caller has
          // explicitly opted in, and even then they're filtered first.
          client.setContext('page', {
            component: event.detail.page.component,
            url: dataFilter.filterUrl(event.detail.page.url),
            props: includeRequestData ? dataFilter.filter(event.detail.page.props) : undefined,
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
              url: dataFilter.filterUrl(event.detail.visit.url.toString()),
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
              url: dataFilter.filterUrl(event.detail.visit.url.toString()),
            },
            level: 'debug',
          });
        });
      }

      // Track errors. The errors object from Inertia is run through the
      // DataFilter so any field names matching the blacklist are filtered
      // before being attached to the exception context.
      if (trackErrors) {
        router.on('error', (event) => {
          const error = new Error('Inertia request failed');

          client.captureException(error, {
            mechanism: 'inertia-error',
            url: dataFilter.filterUrl(event.detail.visit.url.toString()),
            method: event.detail.visit.method,
            errors: dataFilter.filter(event.detail.errors),
          });
        });

        router.on('exception', (event) => {
          client.captureException(event.detail.exception, {
            mechanism: 'inertia-exception',
            url: dataFilter.filterUrl(event.detail.visit.url.toString()),
            method: event.detail.visit.method,
          });
        });
      }

      // Track invalid visits. Responses are NOT attached to the breadcrumb
      // unless includeRequestData is on — they typically contain the raw
      // HTML the server returned, which can carry CSRF tokens and user data.
      router.on('invalid', (event) => {
        client.addBreadcrumb({
          type: 'error',
          category: 'inertia',
          message: 'Invalid Inertia response',
          data: includeRequestData
            ? { response: dataFilter.filter(event.detail.response) }
            : undefined,
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
    // Route the user object through the DataFilter so any password/token-ish
    // fields the app happens to put on its user model don't leak out.
    const filtered = new DataFilter().filter({
      id: user.id,
      email: user.email,
      name: user.name,
      ...user,
    });
    client.setUser(filtered as any);
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
