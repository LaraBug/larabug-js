<p align="center">
    <a href="https://www.larabug.com" target="_blank"><img width="150" src=".github/assets/logo.png" alt="LaraBug"></a>
</p>

# LaraBug JavaScript SDK

Official JavaScript SDK for [larabug.com](https://www.larabug.com). Ships frontend error tracking for vanilla JavaScript, TypeScript, React, Vue 3, and Inertia.js.

[![License](https://img.shields.io/npm/l/@larabug/core?color=blue)](LICENSE)
[![@larabug/core](https://img.shields.io/npm/v/@larabug/core?label=%40larabug%2Fcore)](https://www.npmjs.com/package/@larabug/core)
[![@larabug/browser](https://img.shields.io/npm/v/@larabug/browser?label=%40larabug%2Fbrowser)](https://www.npmjs.com/package/@larabug/browser)
[![@larabug/react](https://img.shields.io/npm/v/@larabug/react?label=%40larabug%2Freact)](https://www.npmjs.com/package/@larabug/react)
[![@larabug/vue](https://img.shields.io/npm/v/@larabug/vue?label=%40larabug%2Fvue)](https://www.npmjs.com/package/@larabug/vue)
[![@larabug/inertia](https://img.shields.io/npm/v/@larabug/inertia?label=%40larabug%2Finertia)](https://www.npmjs.com/package/@larabug/inertia)

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
```

All packages require an `LB_DSN` (or separate `login_key` + `project_key`) from your project at [larabug.com](https://www.larabug.com).

## Documentation

Full documentation — configuration, framework integrations, data filtering, source maps — lives at **[larabug.com/docs](https://www.larabug.com/docs)**.

## Related

- [LaraBug Laravel SDK](https://github.com/LaraBug/LaraBug) — Laravel error and queue job tracking for Laravel.

## License

The LaraBug JavaScript SDK is open source software licensed under the [MIT license](http://opensource.org/licenses/MIT).
