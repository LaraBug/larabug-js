/**
 * Default blacklist of key patterns. Any object key that contains one of
 * these substrings (case-insensitive) has its value replaced with [FILTERED].
 *
 * Mirrors the default list in LaraBug/src/Filters/DataFilter.php so the PHP
 * and JavaScript SDKs filter the same shape of data out of the box.
 */
export const DEFAULT_BLACKLIST: readonly string[] = [
  'password',
  'passwd',
  'secret',
  'token',
  'auth',
  'authorization',
  'cookie',
  'session',
  'api_key',
  'apikey',
  'access_key',
  'access_token',
  'refresh_token',
  'private_key',
  'credit_card',
  'card_number',
  'cardnumber',
  'cvv',
  'cvc',
  'iban',
  'ssn',
  'social_security',
];

/**
 * Default blacklist of query-string parameter names. URLs with matching
 * params have their values replaced before being recorded or transmitted.
 *
 * This is a JavaScript-specific extension of the PHP SDK's data filter —
 * the PHP SDK doesn't see URL query strings in the same way, because it
 * captures server-side request state directly.
 */
export const DEFAULT_URL_BLACKLIST: readonly string[] = [
  'token',
  'access_token',
  'refresh_token',
  'api_key',
  'apikey',
  'auth',
  'authorization',
  'password',
  'secret',
  'code',
  'signature',
  'sig',
];

/** Replacement marker used in place of filtered values. Matches PHP SDK. */
export const FILTERED: string = '[FILTERED]';

/** Maximum depth the recursive filter will descend into nested structures. */
const MAX_DEPTH = 8;

/** Hard cap on per-string size, in characters, after which strings are truncated. */
const MAX_STRING_LENGTH = 8 * 1024;

export interface DataFilterOptions {
  /**
   * Extra key patterns the filter should treat as sensitive. Merged with
   * DEFAULT_BLACKLIST unless `replaceDefaults` is true.
   */
  blacklist?: string[];

  /**
   * Extra query-string parameter names to filter in URLs. Merged with
   * DEFAULT_URL_BLACKLIST.
   */
  urlBlacklist?: string[];

  /**
   * When true, ignores the built-in DEFAULT_BLACKLIST and uses only the
   * caller-provided `blacklist`. The URL blacklist is never replaced;
   * it's always additive.
   */
  replaceDefaults?: boolean;
}

/**
 * Deep-filters objects, arrays, strings, and URLs before they leave the SDK.
 *
 * Rules:
 *   - Object keys matching any blacklist pattern have their value set to [FILTERED].
 *   - String values that look like URLs get their query parameters filtered.
 *   - Strings longer than MAX_STRING_LENGTH are truncated with a `…[truncated]` suffix.
 *   - Circular references, functions, Symbols, DOM nodes, Window, Events, and
 *     HTMLElement instances are replaced with a placeholder rather than serialized.
 *   - Nested depth is capped at MAX_DEPTH; deeper structures become `[MaxDepth]`.
 *
 * Public API matches LaraBug's PHP DataFilter class:
 *   - `filter(value)` — recursive key-based masking (equivalent to
 *     PHP's `filterVariables`).
 *   - `filterUrl(url)` — strips sensitive query parameters.
 *   - `filterMessage(message)` — rewrites URLs inside a free-text string.
 */
export class DataFilter {
  private readonly blacklist: string[];
  private readonly urlBlacklist: string[];

  constructor(options: DataFilterOptions = {}) {
    const base = options.replaceDefaults ? [] : [...DEFAULT_BLACKLIST];
    this.blacklist = [...base, ...(options.blacklist ?? [])].map((k) => k.toLowerCase());
    this.urlBlacklist = [...DEFAULT_URL_BLACKLIST, ...(options.urlBlacklist ?? [])].map((k) =>
      k.toLowerCase()
    );
  }

  /** Filter any value. Returns a safe copy. The original is never mutated. */
  filter<T>(value: T): T {
    const seen = new WeakSet<object>();
    return this.walk(value, 0, seen) as T;
  }

  /**
   * Filter a URL's query string. Parameters whose name matches the URL
   * blacklist have their value replaced with [FILTERED]. Base URL is
   * untouched. Returns the original string on parse failures.
   */
  filterUrl(url: string): string {
    if (!url || typeof url !== 'string') {
      return url;
    }

    const queryIndex = url.indexOf('?');
    if (queryIndex === -1) {
      return url;
    }

    const base = url.slice(0, queryIndex);
    const rawQuery = url.slice(queryIndex + 1);

    const parts = rawQuery.split('&').map((part) => {
      const eq = part.indexOf('=');
      if (eq === -1) {
        return part;
      }
      const rawKey = part.slice(0, eq);
      const decodedKey = this.safeDecode(rawKey).toLowerCase();
      if (this.matchesUrlKey(decodedKey)) {
        return `${rawKey}=${encodeURIComponent(FILTERED)}`;
      }
      return part;
    });

    return `${base}?${parts.join('&')}`;
  }

  /** Filter a free-form message. URL substrings are rewritten via filterUrl. */
  filterMessage(message: string): string {
    if (!message) return message;
    return message.replace(/https?:\/\/[^\s"')<>]+/gi, (match) => this.filterUrl(match));
  }

  /** True when the key matches a blacklist pattern. Case-insensitive substring. */
  shouldFilter(key: string): boolean {
    return this.matchesKey(key);
  }

  private walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
    if (depth > MAX_DEPTH) {
      return '[MaxDepth]';
    }

    if (value === null || value === undefined) {
      return value;
    }

    const t = typeof value;

    if (t === 'string') {
      const str = value as string;
      const trimmed =
        str.length > MAX_STRING_LENGTH ? `${str.slice(0, MAX_STRING_LENGTH)}…[truncated]` : str;
      return this.filterMessage(trimmed);
    }

    if (t === 'number' || t === 'boolean' || t === 'bigint') {
      return value;
    }

    if (t === 'function' || t === 'symbol') {
      return `[${t}]`;
    }

    // Built-in safe types
    if (value instanceof Date) return value.toISOString();
    if (value instanceof RegExp) return value.toString();
    if (value instanceof Error) {
      return {
        name: value.name,
        message: this.walk(value.message, depth + 1, seen),
        stack: value.stack,
      };
    }

    // DOM / browser types — don't serialize.
    if (typeof globalThis !== 'undefined') {
      const g = globalThis as any;
      if (g.HTMLElement && value instanceof g.HTMLElement) return '[HTMLElement]';
      if (g.Node && value instanceof g.Node) return '[Node]';
      if (g.Window && value instanceof g.Window) return '[Window]';
      if (g.Event && value instanceof g.Event) return `[Event:${(value as Event).type}]`;
    }

    // Arrays
    if (Array.isArray(value)) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
      return value.map((item) => this.walk(item, depth + 1, seen));
    }

    // Plain-ish objects
    if (t === 'object') {
      if (seen.has(value as object)) return '[Circular]';
      seen.add(value as object);

      const result: Record<string, unknown> = {};
      for (const key of Object.keys(value as object)) {
        if (this.matchesKey(key)) {
          result[key] = FILTERED;
          continue;
        }
        result[key] = this.walk((value as Record<string, unknown>)[key], depth + 1, seen);
      }
      return result;
    }

    return value;
  }

  private matchesKey(key: string): boolean {
    const lower = key.toLowerCase();
    for (const pattern of this.blacklist) {
      if (lower.includes(pattern)) {
        return true;
      }
    }
    return false;
  }

  private matchesUrlKey(key: string): boolean {
    for (const pattern of this.urlBlacklist) {
      if (key === pattern || key.includes(pattern)) {
        return true;
      }
    }
    return false;
  }

  private safeDecode(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
}
