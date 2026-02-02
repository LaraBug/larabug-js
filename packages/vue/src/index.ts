import { init as browserInit, BrowserClient, LaraBugOptions } from '@larabug/browser';

export { LaraBugVuePlugin } from './plugin';
export { useLaraBug, useLaraBugUser, useLaraBugContext, useLaraBugTag } from './composables';
export * from '@larabug/browser';

let vueClient: BrowserClient | null = null;

/**
 * Initialize LaraBug for Vue
 * Automatically sets framework tag to 'vue'
 * 
 * Note: For full Vue integration (component info, lifecycle tracking),
 * use the LaraBugVuePlugin with your Vue app instance.
 */
export function init(options: LaraBugOptions): BrowserClient {
  vueClient = browserInit(options);
  
  // Set framework tag globally for all errors
  vueClient.setTag('framework', 'vue');
  
  return vueClient;
}

/**
 * Get the current Vue client instance
 */
export function getCurrentClient(): BrowserClient | null {
  return vueClient;
}

// Default export
export default {
  init,
  getCurrentClient,
  captureException: (error: Error, context?: Record<string, any>) => {
    if (vueClient) vueClient.captureException(error, context);
  },
  captureMessage: (message: string, level?: 'error' | 'warning' | 'info') => {
    if (vueClient) vueClient.captureMessage(message, level);
  },
  setUser: (user: any) => {
    if (vueClient) vueClient.setUser(user);
  },
  setContext: (key: string, value: any) => {
    if (vueClient) vueClient.setContext(key, value);
  },
  setTag: (key: string, value: string) => {
    if (vueClient) vueClient.setTag(key, value);
  },
};
