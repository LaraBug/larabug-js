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
        console.error(
          '[LaraBug] Client not initialized. Call LaraBug.init() before using the Inertia plugin.'
        );
        return;
      }

      // Ensure framework tag is set
      client.setTag('framework', 'inertia');

      // Inertia renamed and reshaped its events between versions (v1/v2 send
      // `exception` and `invalid`, v3 sends `networkError` and
      // `httpException`), so every listener is subscribed by name and reads
      // its event defensively. A listener that throws would land in the
      // page's error handler and be reported as the app's own error.
      const on = (name: string, handler: (detail: Record<string, any>) => void) => {
        (router.on as unknown as (name: string, cb: (event: CustomEvent) => void) => void)(
          name,
          (event) => {
            try {
              handler((event?.detail ?? {}) as Record<string, any>);
            } catch {
              // An event shape this version does not know. Skip it.
            }
          }
        );
      };

      const visitUrl = (visit: any): string | undefined =>
        visit?.url ? dataFilter.filterUrl(String(visit.url)) : undefined;

      // Track page visits
      if (trackPageVisits) {
        on('navigate', ({ page }) => {
          const url = page?.url ? dataFilter.filterUrl(String(page.url)) : undefined;

          client.addBreadcrumb({
            type: 'navigation',
            category: 'inertia',
            message: 'Page visit',
            data: {
              component: page?.component,
              url,
              method: 'visit',
            },
          });

          // Set page context. Props are only included when the caller has
          // explicitly opted in, and even then they're filtered first.
          client.setContext('page', {
            component: page?.component,
            url,
            props: includeRequestData && page?.props ? dataFilter.filter(page.props) : undefined,
          });
        });
      }

      // Track navigation start
      if (trackNavigations) {
        on('start', ({ visit }) => {
          client.addBreadcrumb({
            type: 'navigation',
            category: 'inertia',
            message: 'Navigation started',
            data: {
              url: visitUrl(visit),
              method: visit?.method,
            },
          });
        });

        on('progress', ({ progress }) => {
          client.addBreadcrumb({
            type: 'default',
            category: 'inertia',
            message: 'Navigation progress',
            data: {
              percentage: progress?.percentage,
            },
            level: 'debug',
          });
        });

        on('finish', ({ visit }) => {
          client.addBreadcrumb({
            type: 'default',
            category: 'inertia',
            message: 'Navigation finished',
            data: {
              url: visitUrl(visit),
            },
            level: 'debug',
          });
        });
      }

      if (trackErrors) {
        // A failed validation is the visitor's mistake, not a bug, so it is a
        // breadcrumb rather than an issue. Only the field names are kept: the
        // messages can echo back what was typed.
        on('error', ({ errors }) => {
          client.addBreadcrumb({
            type: 'default',
            category: 'inertia',
            message: 'Validation failed',
            data: {
              fields: errors && typeof errors === 'object' ? Object.keys(errors) : [],
            },
            level: 'warning',
          });
        });

        // v1 and v2: an unexpected error while making the request.
        on('exception', ({ exception }) => {
          if (exception instanceof Error) {
            client.captureException(exception, { mechanism: 'inertia-exception' });
          }
        });

        // v3: the request never got an answer. The visitor is offline or the
        // connection dropped, which is worth knowing next to a later error but
        // is not a bug in the app.
        on('networkError', ({ error }) => {
          client.addBreadcrumb({
            type: 'http',
            category: 'inertia',
            message: 'Network error',
            data: { error: error instanceof Error ? error.message : String(error) },
            level: 'error',
          });
        });
      }

      // A response that is not an Inertia page: v1/v2 call it `invalid`, v3
      // `httpException`. The server side reports its own failures, so this
      // is a breadcrumb. Response bodies are NOT attached unless
      // includeRequestData is on, since they typically carry the raw HTML the
      // server returned, CSRF tokens and user data included.
      const invalidResponse = ({ response }: Record<string, any>) => {
        client.addBreadcrumb({
          type: 'error',
          category: 'inertia',
          message: 'Invalid Inertia response',
          data: {
            status: typeof response?.status === 'number' ? response.status : undefined,
            ...(includeRequestData && response ? { response: dataFilter.filter(response) } : {}),
          },
          level: 'warning',
        });
      };

      on('invalid', invalidResponse);
      on('httpException', invalidResponse);
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
