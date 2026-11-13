/**
 * Replaced with the version in package.json when the package is built (see
 * rollup.config.mjs), and defined by jest.config.js for the tests.
 */
declare const __LARABUG_VITE_VERSION__: unknown;

export const VITE_PLUGIN_VERSION: string =
  typeof __LARABUG_VITE_VERSION__ === 'string' ? __LARABUG_VITE_VERSION__ : '0.0.0';

/**
 * How the plugin names itself in the `X-LaraBug-Sdk` header, after
 * `larabug-js/<version> node`. Not `vite/`, which would read as Vite's own
 * version.
 */
export const VITE_PLUGIN_TOKEN = `vite-plugin/${VITE_PLUGIN_VERSION}`;
