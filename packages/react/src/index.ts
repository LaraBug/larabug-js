import { init as browserInit, BrowserClient, LaraBugOptions } from '@larabug/browser';

export { ErrorBoundary } from './ErrorBoundary';
export { useLaraBugUser, useLaraBugContext, useLaraBugTag } from './hooks';
export * from '@larabug/browser';

let reactClient: BrowserClient | null = null;

/**
 * Initialize LaraBug for React
 * Automatically sets framework tag to 'react'
 */
export function init(options: LaraBugOptions = {}): BrowserClient {
  reactClient = browserInit(options);
  
  // Set framework tag globally for all errors
  reactClient.setTag('framework', 'react');
  
  return reactClient;
}

/**
 * Get the current React client instance
 */
export function getCurrentClient(): BrowserClient | null {
  return reactClient;
}

// Default export
export default {
  init,
  getCurrentClient,
  captureException: (error: Error, context?: Record<string, any>) => {
    if (reactClient) reactClient.captureException(error, context);
  },
  captureMessage: (message: string, level?: 'error' | 'warning' | 'info') => {
    if (reactClient) reactClient.captureMessage(message, level);
  },
  setUser: (user: any) => {
    if (reactClient) reactClient.setUser(user);
  },
  setContext: (key: string, value: any) => {
    if (reactClient) reactClient.setContext(key, value);
  },
  setTag: (key: string, value: string) => {
    if (reactClient) reactClient.setTag(key, value);
  },
};
