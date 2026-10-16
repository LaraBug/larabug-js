# @larabug/vite

A Vite plugin that makes JavaScript errors in LaraBug readable. On `vite build` it writes hidden source maps, uploads them to LaraBug under the build's release, and deletes them from the output so visitors never get them. The same release goes into your bundle, and `@larabug/browser` sends it with every error, so LaraBug knows which maps to apply.

`vite dev` is untouched.

## Installation

```bash
npm install --save-dev @larabug/vite
```

## Usage

Add the plugin to `vite.config.js`. In a Laravel app it goes next to `laravel-vite-plugin`.

```js
import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import larabug from '@larabug/vite';

export default defineConfig({
  plugins: [
    laravel({ input: ['resources/js/app.js'] }),
    larabug(),
  ],
});
```

Then give the build your project's key in `.env`. The ingest key and the DSN from your project settings both work.

```dotenv
LARABUG_KEY=lbi_...
```

The plugin also reads `LARABUG_DSN` and `VITE_LARABUG_DSN`, so an app that already exposes its DSN to the browser needs nothing new. Variables from the environment win over `.env`, the same way Vite handles its own.

Nothing changes in your SDK setup. `LaraBug.init()` picks up the injected release when you don't pass one.

```js
import * as LaraBug from '@larabug/browser';

LaraBug.init({ dsn: import.meta.env.VITE_LARABUG_DSN });
```

## The release

The plugin picks the first of these that exists.

1. The `release` option.
2. `LARABUG_RELEASE`, or `VITE_LARABUG_RELEASE`.
3. The commit being built, from `git rev-parse HEAD`.
4. A commit SHA your CI exposes, such as `GITHUB_SHA` or `CI_COMMIT_SHA`.
5. The build time plus a hash of the built code, for example `20261016214328-3f9a1c0b7d2e`.

It ends up in the bundle as `__LARABUG_RELEASE__` and as `import.meta.env.VITE_LARABUG_RELEASE`. Read the second one if your own code needs the release.

Laravel runs `vite build && vite build --ssr` as two processes. With a git commit or `LARABUG_RELEASE` both builds share a release. With the time based fallback they don't, so set `LARABUG_RELEASE` in a deploy that has no `.git` directory.

## Where LaraBug expects the files

Each map goes up with the URL of the script it belongs to. The plugin builds that URL from Vite's `base`.

| Vite `base` | Script | Uploaded as |
| --- | --- | --- |
| `/build/` (laravel-vite-plugin) | `assets/app-D4wpJuT4.js` | `~/build/assets/app-D4wpJuT4.js` |
| `https://cdn.example.com/build/` | `assets/app-D4wpJuT4.js` | `https://cdn.example.com/build/assets/app-D4wpJuT4.js` |
| `/` | `assets/app-D4wpJuT4.js` | `~/assets/app-D4wpJuT4.js` |

A path that starts with `~/` matches on any host, so one upload covers production, staging and every preview domain. When `ASSET_URL` points `laravel-vite-plugin` at a CDN, the uploads use the full CDN URL instead.

A relative `base` such as `./` says nothing about where the files end up. The plugin then assumes the site root and warns you. Pass `base` to say where they really are.

## Options

```js
larabug({
  key: process.env.LARABUG_KEY,
  release: process.env.LARABUG_RELEASE,
  exclude: ['assets/vendor-*.js'],
  failOnError: process.env.CI === 'true',
});
```

| Option | Default | What it does |
| --- | --- | --- |
| `key` | `LARABUG_KEY`, `LARABUG_DSN`, `VITE_LARABUG_DSN` | Ingest key (`lbi_...`) or DSN. |
| `host` | `LARABUG_HOST`, the DSN's host, `https://www.larabug.com` | Where to upload. |
| `release` | See above | The release to upload under and inject. |
| `base` | Vite's `base` | Where the built files are served from. A full URL, or a path such as `/build/`. |
| `include` | every script | Globs or regular expressions, matched against the output path such as `assets/app-D4wpJuT4.js`. |
| `exclude` | nothing | Same format as `include`. Wins over it. |
| `removeSourceMaps` | `true` | Delete every `.map` file the build wrote, after uploading. |
| `retries` | `3` | Retries per file after network errors, 408, 429 and 5xx, waiting 1s, 2s, 4s. |
| `dryRun` | `false` | List what would go up and send nothing. Maps are still removed unless `removeSourceMaps` is `false`. |
| `silent` | `false` | Print errors only. |
| `failOnError` | `false` | Stop the build when an upload fails or there is no key. |

## Source map settings

When your config doesn't mention `build.sourcemap`, the plugin sets it to `'hidden'`. Vite then writes the maps but leaves the `//# sourceMappingURL` comment out of the scripts, so browsers don't request them.

If you set `build.sourcemap` yourself, the plugin leaves it alone. With `true` the comment stays in the scripts. Once the maps are removed, devtools reports a missing file there, which is harmless. With `false` or `'inline'` there are no map files, and the plugin warns that it has nothing to upload.

## When an upload fails

A failed upload never fails your build unless you set `failOnError`. The plugin prints which files failed and why, and deploys carry on with unreadable stack traces for that release. LaraBug refusing the key stops the remaining uploads straight away, because every other file would be refused too.

The maps are deleted whether the upload worked or not. Keeping them would put them on your public disk.

## SSR

The server bundle of an SSR build, such as Inertia's `bootstrap/ssr/ssr.js`, is never uploaded, and the plugin doesn't switch on source maps for it. The release is still injected into your own code there.

An SSR build keeps `node_modules` external, so the SDK can't read the injected value on the server. Pass it yourself if you report from SSR.

```js
LaraBug.init({ dsn, release: import.meta.env.VITE_LARABUG_RELEASE });
```

## Other bundlers

Webpack, Laravel Mix and anything else can use the command line uploader in [`@larabug/sourcemaps`](../sourcemaps). It shares its upload code with this plugin.

## License

MIT
