<a href="https://www.larabug.com" target="_blank"><img width="150" src=".github/assets/logo.png" alt="LaraBug"></a>

# LaraBug JavaScript SDK

Official JavaScript SDK for [larabug.com](https://www.larabug.com). Ships frontend error tracking for vanilla JavaScript, TypeScript, React, Vue 3, and Inertia.js.

[![License](https://img.shields.io/npm/l/@larabug/core?color=blue)](LICENSE)
[![@larabug/core](https://img.shields.io/npm/v/@larabug/core?label=%40larabug%2Fcore)](https://www.npmjs.com/package/@larabug/core)
[![@larabug/browser](https://img.shields.io/npm/v/@larabug/browser?label=%40larabug%2Fbrowser)](https://www.npmjs.com/package/@larabug/browser)
[![@larabug/react](https://img.shields.io/npm/v/@larabug/react?label=%40larabug%2Freact)](https://www.npmjs.com/package/@larabug/react)
[![@larabug/vue](https://img.shields.io/npm/v/@larabug/vue?label=%40larabug%2Fvue)](https://www.npmjs.com/package/@larabug/vue)
[![@larabug/inertia](https://img.shields.io/npm/v/@larabug/inertia?label=%40larabug%2Finertia)](https://www.npmjs.com/package/@larabug/inertia)
[![@larabug/vite](https://img.shields.io/npm/v/@larabug/vite?label=%40larabug%2Fvite)](https://www.npmjs.com/package/@larabug/vite)
[![@larabug/sourcemaps](https://img.shields.io/npm/v/@larabug/sourcemaps?label=%40larabug%2Fsourcemaps)](https://www.npmjs.com/package/@larabug/sourcemaps)

## Installation

Install the package that matches your stack.

```bash
# Vanilla JavaScript / TypeScript
npm install @larabug/browser

# React
npm install @larabug/react

# Vue 3
npm install @larabug/vue

# Inertia.js (use alongside @larabug/vue or @larabug/react)
npm install @larabug/inertia

# Source maps, for Vite builds
npm install --save-dev @larabug/vite

# Source maps, for any other bundler
npm install --save-dev @larabug/sourcemaps
```

## Getting started

```js
import * as LaraBug from '@larabug/browser';

LaraBug.init({
  ingest_key: 'lbi_...', // from your project settings at larabug.com
  environment: 'production',
});
```

The ingest key is write only and scoped to a single project, which makes it the only credential that is safe to put in a page your visitors can read. The `dsn` in your project settings carries the same key, so you can pass that instead. The older account `login_key` together with `project_key` keeps working for existing installs, but it is account wide and does not belong in browser JavaScript.

Initialising never throws. A client without usable credentials warns once, stays inert and leaves the rest of the page running, which matters because the SDK loads before the code it watches. Ask the client when you need to know:

```js
const client = LaraBug.init({ ingest_key: window.LB_INGEST_KEY });

client.isActive();  // false when nothing will be reported
client.getStatus(); // { active: false, reason: 'no usable credentials. ...' }
```

## Source maps

Production bundles are minified, so a raw stack trace points at line 1, column 48213 of `app-D4wpJuT4.js`. Upload your source maps and LaraBug shows the original file, line and function instead.

With Vite, add [`@larabug/vite`](packages/vite) to your config and set `LARABUG_KEY` in `.env`.

```js
// vite.config.js
import laravel from 'laravel-vite-plugin';
import larabug from '@larabug/vite';

export default {
  plugins: [laravel({ input: ['resources/js/app.js'] }), larabug()],
};
```

Every `vite build` then uploads its maps under the current git commit, removes them from `public/build`, and puts the commit in your bundle. The SDK sends it as the `release` of every error, so LaraBug knows which maps belong to which error.

For webpack, Laravel Mix or any other bundler, run the uploader from [`@larabug/sourcemaps`](packages/sourcemaps) after the build.

```bash
npx @larabug/sourcemaps upload --release "$(git rev-parse HEAD)" --dir public/js --url-prefix "~/js"
```

That README shows how to inject the release with webpack's `DefinePlugin`.

## Documentation

Full documentation — configuration, framework integrations, data filtering, source maps — lives at **[larabug.com/docs](https://www.larabug.com/docs)**.

## Related

- [LaraBug Laravel SDK](https://github.com/LaraBug/LaraBug) — Laravel error and queue job tracking for Laravel.

## License

The LaraBug JavaScript SDK is open source software licensed under the [MIT license](http://opensource.org/licenses/MIT).
