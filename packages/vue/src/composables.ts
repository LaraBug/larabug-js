import { inject, onMounted, onUnmounted, watch, Ref } from 'vue';
import { BrowserClient } from '@larabug/browser';
import { User } from '@larabug/core';

/**
 * Get the LaraBug client instance
 */
export function useLaraBug(): BrowserClient {
  const client = inject<BrowserClient>('larabug');
  
  if (!client) {
    throw new Error('LaraBug plugin not installed. Did you forget to app.use(LaraBugVuePlugin)?');
  }
  
  return client;
}

/**
 * Composable to set user context
 * 
 * @example
 * ```ts
 * import { useLaraBugUser } from '@larabug/vue';
 * 
 * export default {
 *   setup() {
 *     useLaraBugUser({ id: 1, email: 'user@example.com' });
 *   }
 * }
 * ```
 */
export function useLaraBugUser(user: User | Ref<User | null>): void {
  const client = useLaraBug();
  
  if ('value' in user) {
    // Reactive ref
    watch(user, (newUser) => {
      client.setUser(newUser);
    }, { immediate: true });
    
    onUnmounted(() => {
      client.setUser(null);
    });
  } else {
    // Plain object
    onMounted(() => {
      client.setUser(user);
    });
    
    onUnmounted(() => {
      client.setUser(null);
    });
  }
}

/**
 * Composable to set context data
 * 
 * @example
 * ```ts
 * import { useLaraBugContext } from '@larabug/vue';
 * 
 * export default {
 *   setup() {
 *     useLaraBugContext('feature', { enabled: true });
 *   }
 * }
 * ```
 */
export function useLaraBugContext(key: string, value: any | Ref<any>): void {
  const client = useLaraBug();
  
  if ('value' in value) {
    // Reactive ref
    watch(value, (newValue) => {
      client.setContext(key, newValue);
    }, { immediate: true });
  } else {
    // Plain value
    onMounted(() => {
      client.setContext(key, value);
    });
  }
}

/**
 * Composable to set a tag
 * 
 * @example
 * ```ts
 * import { useLaraBugTag } from '@larabug/vue';
 * 
 * export default {
 *   setup() {
 *     useLaraBugTag('page', 'dashboard');
 *   }
 * }
 * ```
 */
export function useLaraBugTag(key: string, value: string | Ref<string>): void {
  const client = useLaraBug();
  
  if ('value' in value) {
    // Reactive ref
    watch(value, (newValue) => {
      client.setTag(key, newValue);
    }, { immediate: true });
  } else {
    // Plain value
    onMounted(() => {
      client.setTag(key, value);
    });
  }
}
