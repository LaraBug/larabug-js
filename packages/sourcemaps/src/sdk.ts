/**
 * Replaced with package versions when the package is built (see
 * rollup.config.mjs), and defined by jest.config.js for the tests: the version
 * of @larabug/core this package was released with, and its own.
 */
declare const __LARABUG_CORE_VERSION__: unknown;
declare const __LARABUG_SOURCEMAPS_VERSION__: unknown;

/** The header every request to LaraBug names the SDK in. */
export const SDK_HEADER = 'X-LaraBug-Sdk';

/** The JavaScript SDK release this package belongs to. */
export const SDK_VERSION: string =
  typeof __LARABUG_CORE_VERSION__ === 'string' ? __LARABUG_CORE_VERSION__ : '0.0.0';

export const SOURCEMAPS_VERSION: string =
  typeof __LARABUG_SOURCEMAPS_VERSION__ === 'string' ? __LARABUG_SOURCEMAPS_VERSION__ : '0.0.0';

/**
 * The value of `X-LaraBug-Sdk` for a request from Node: the SDK and its
 * version, `node`, then the tool that sent it, `sourcemaps/0.1.1` unless told
 * otherwise. For example `larabug-js/0.4.2 node sourcemaps/0.1.1`.
 */
export function sdkHeaderValue(client = `sourcemaps/${SOURCEMAPS_VERSION}`): string {
  return `larabug-js/${SDK_VERSION} node ${client}`;
}
