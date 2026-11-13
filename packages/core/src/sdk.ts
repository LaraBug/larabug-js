/**
 * Replaced with the version in package.json when the package is built (see
 * rollup.config.mjs), and defined by jest.config.js for the tests. Read
 * through `typeof` so that a build that missed the replacement still loads.
 */
declare const __LARABUG_CORE_VERSION__: unknown;

/** The header every request to LaraBug names the SDK in. */
export const SDK_HEADER = 'X-LaraBug-Sdk';

/** The version of @larabug/core, which is the version of the JavaScript SDK. */
export const SDK_VERSION: string =
  typeof __LARABUG_CORE_VERSION__ === 'string' ? __LARABUG_CORE_VERSION__ : '0.0.0';

export type SdkRuntime = 'browser' | 'node' | 'unknown';

/**
 * Where the SDK runs. A page has a window and a document; Node (and runtimes
 * that pass for it, such as Bun) has `process.versions.node`.
 */
export function sdkRuntime(): SdkRuntime {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    return 'browser';
  }

  // Through globalThis, so the browser build needs no Node types.
  const process = (globalThis as { process?: { versions?: { node?: unknown } } }).process;

  return typeof process?.versions?.node === 'string' ? 'node' : 'unknown';
}

/**
 * One product token, `name/version` or `name` without a version. A header value
 * cannot hold a space, a slash in the wrong place or a line break, and fetch
 * throws on the last, so anything outside letters, digits and `.+-_~` is
 * dropped rather than trusted.
 */
export function sdkToken(name: string, version?: string | null): string {
  const clean = (value: unknown) => String(value ?? '').replace(/[^A-Za-z0-9.+\-_~]/g, '');
  const product = clean(name);
  const release = clean(version);

  return release ? `${product}/${release}` : product;
}

/**
 * The value of `X-LaraBug-Sdk`: space separated product tokens, the SDK and
 * its version first, then the runtime, then whatever framework or tool sent
 * the request. For example `larabug-js/0.4.2 browser vue/3.5.13`.
 */
export function sdkHeaderValue(
  runtime: string = sdkRuntime(),
  ...tokens: Array<string | null | undefined>
): string {
  return [sdkToken('larabug-js', SDK_VERSION), sdkToken(runtime), ...tokens]
    .filter((token): token is string => typeof token === 'string' && token !== '')
    .join(' ');
}
