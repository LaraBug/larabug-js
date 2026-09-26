import { BrowserClient } from './client';
import { LaraBugOptions } from '@larabug/core';

export { BrowserClient } from './client';
export * from '@larabug/core';

let globalClient: BrowserClient | null = null;

/**
 * Initialize LaraBug for the browser
 *
 * Never throws, whatever it is handed. A client that has no usable credentials
 * warns once and comes back inert, so a missing key costs you error reporting
 * and nothing else on the page. Ask the returned client with `isActive()`, or
 * `getStatus()` for the reason.
 */
export function init(options: LaraBugOptions = {}): BrowserClient {
  globalClient = new BrowserClient(options);
  return globalClient;
}

/**
 * Get the current client instance
 */
export function getCurrentClient(): BrowserClient | null {
  return globalClient;
}

/**
 * Capture an exception
 */
export function captureException(error: Error, context?: Record<string, any>): void {
  if (globalClient) {
    globalClient.captureException(error, context);
  }
}

/**
 * Capture a message
 */
export function captureMessage(message: string, level?: 'error' | 'warning' | 'info'): void {
  if (globalClient) {
    globalClient.captureMessage(message, level);
  }
}

/**
 * Set user context
 */
export function setUser(user: any): void {
  if (globalClient) {
    globalClient.setUser(user);
  }
}

/**
 * Set custom context
 */
export function setContext(key: string, value: any): void {
  if (globalClient) {
    globalClient.setContext(key, value);
  }
}

/**
 * Set a tag
 */
export function setTag(key: string, value: string): void {
  if (globalClient) {
    globalClient.setTag(key, value);
  }
}

// Default export
export default { init, captureException, captureMessage, setUser, setContext, setTag, getCurrentClient };
