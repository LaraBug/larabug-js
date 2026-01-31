import { useEffect } from 'react';
import { getCurrentClient } from '@larabug/browser';
import { User } from '@larabug/core';

/**
 * Hook to set user context
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   useLaraBugUser({ id: 1, email: 'user@example.com' });
 *   return <div>...</div>;
 * }
 * ```
 */
export function useLaraBugUser(user: User | null): void {
  useEffect(() => {
    const client = getCurrentClient();
    if (client) {
      client.setUser(user);
    }

    // Cleanup
    return () => {
      const client = getCurrentClient();
      if (client) {
        client.setUser(null);
      }
    };
  }, [user]);
}

/**
 * Hook to set context data
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   useLaraBugContext('feature', { enabled: true });
 *   return <div>...</div>;
 * }
 * ```
 */
export function useLaraBugContext(key: string, value: any): void {
  useEffect(() => {
    const client = getCurrentClient();
    if (client) {
      client.setContext(key, value);
    }
  }, [key, value]);
}

/**
 * Hook to set a tag
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   useLaraBugTag('page', 'dashboard');
 *   return <div>...</div>;
 * }
 * ```
 */
export function useLaraBugTag(key: string, value: string): void {
  useEffect(() => {
    const client = getCurrentClient();
    if (client) {
      client.setTag(key, value);
    }
  }, [key, value]);
}
