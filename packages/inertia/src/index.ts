import { init as browserInit, BrowserClient, LaraBugOptions } from '@larabug/browser';

export { createInertiaLaraBugPlugin, setUserFromInertia, attachLaravelContext } from './plugin';
export * from '@larabug/browser';

let inertiaClient: BrowserClient | null = null;

/**
 * Initialize LaraBug for Inertia.js
 * Automatically sets framework tag to 'inertia'
 * 
 * Note: For full Inertia integration (navigation tracking, Laravel context),
 * use the createInertiaLaraBugPlugin() with your Inertia router.
 */
export function init(options: LaraBugOptions): BrowserClient {
  inertiaClient = browserInit(options);
  
  // Set framework tag globally for all errors
  inertiaClient.setTag('framework', 'inertia');
  
  return inertiaClient;
}

/**
 * Get the current Inertia client instance
 */
export function getCurrentClient(): BrowserClient | null {
  return inertiaClient;
}

// Default export
export default {
  init,
  getCurrentClient,
  captureException: (error: Error, context?: Record<string, any>) => {
    if (inertiaClient) inertiaClient.captureException(error, context);
  },
  captureMessage: (message: string, level?: 'error' | 'warning' | 'info') => {
    if (inertiaClient) inertiaClient.captureMessage(message, level);
  },
  setUser: (user: any) => {
    if (inertiaClient) inertiaClient.setUser(user);
  },
  setContext: (key: string, value: any) => {
    if (inertiaClient) inertiaClient.setContext(key, value);
  },
  setTag: (key: string, value: string) => {
    if (inertiaClient) inertiaClient.setTag(key, value);
  },
};
