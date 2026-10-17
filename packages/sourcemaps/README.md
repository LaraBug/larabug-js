# @larabug/sourcemaps

Uploads source maps to LaraBug so stack traces from minified bundles point at your original code. Use it from the command line after any build, or from Node. Vite users want [`@larabug/vite`](../vite), which runs this same uploader for you.

## Command line

```bash
npx @larabug/sourcemaps upload --release "$(git rev-parse HEAD)" --dir public/build --url-prefix "~/build"
```

This finds every `<script>.map` under `--dir` whose script sits beside it, and uploads it with the URL the script is served from. `--url-prefix` says where `--dir` lives on your site. A full URL such as `https://cdn.example.com/build` pins one host, and a path starting with `~/` matches any host. With the command above, `public/build/assets/app.js.map` goes up as the map for `~/build/assets/app.js`.

The key comes from `--key`, or else from `LARABUG_KEY`, `LARABUG_DSN` or `VITE_LARABUG_DSN` in the environment or in `.env`. It can be your project's ingest key or its DSN.

```
larabug-sourcemaps upload [options]
  --dir <path>           Directory with the built files (required)
  --url-prefix <prefix>  Where that directory is served from (default "~/")
  --release <release>    Defaults to LARABUG_RELEASE, then the current git commit
  --key <key>            Ingest key or DSN
  --host <url>           Defaults to the DSN's host, else https://www.larabug.com
  --dist <dist>          Sent as the optional dist field
  --include <glob>       Only these files, relative to --dir (repeatable)
  --exclude <glob>       Skip these files, relative to --dir (repeatable)
  --remove-source-maps   Delete the .map files afterwards, uploaded or not
  --retries <n>          Retries per file on network errors and 5xx (default 3)
  --dry-run              Show what would be uploaded, send nothing
  --silent               Print errors only

larabug-sourcemaps list --release <release>
  Prints the source maps LaraBug holds for a release.
```

The command exits with 1 when any upload fails. Append `|| true` if a failed upload shouldn't stop your deploy.

## Webpack and Laravel Mix

Two things have to line up. The bundle must carry the release, and the maps must be uploaded under that same release. `@larabug/browser` reads the release from a global called `__LARABUG_RELEASE__`, which webpack's `DefinePlugin` can fill in.

```js
// webpack.config.js
const { execSync } = require('child_process');
const webpack = require('webpack');

const release = process.env.LARABUG_RELEASE || execSync('git rev-parse HEAD').toString().trim();

module.exports = {
  mode: 'production',
  devtool: 'hidden-source-map',
  plugins: [new webpack.DefinePlugin({ __LARABUG_RELEASE__: JSON.stringify(release) })],
};
```

`hidden-source-map` writes the maps without adding a `sourceMappingURL` comment to the scripts. Upload them after the build with the same release, and remove them so they aren't served.

```bash
npx webpack
npx @larabug/sourcemaps upload --release "$(git rev-parse HEAD)" --dir public/js --url-prefix "~/js" --remove-source-maps
```

Laravel Mix takes the same settings through `webpackConfig`.

```js
// webpack.mix.js
const { execSync } = require('child_process');

const release = process.env.LARABUG_RELEASE || execSync('git rev-parse HEAD').toString().trim();

mix.js('resources/js/app.js', 'public/js')
  .webpackConfig((webpack) => ({
    devtool: 'hidden-source-map',
    plugins: [new webpack.DefinePlugin({ __LARABUG_RELEASE__: JSON.stringify(release) })],
  }));
```

With a plain `<script>` tag and no bundler, set the global before the SDK loads.

```html
<script>window.__LARABUG_RELEASE__ = '{{ config('app.version') }}';</script>
```

## Node

```js
import { findSourceMaps, minifiedUrl, parseCredentials, uploadSourceMaps } from '@larabug/sourcemaps';

const maps = await findSourceMaps('public/build');

const report = await uploadSourceMaps(
  maps.map((map) => ({ sourcemapPath: map.sourcemapPath, minifiedUrl: minifiedUrl('~/build', map.minifiedPath) })),
  { credentials: parseCredentials(process.env.LARABUG_KEY), release: 'v1.4.0' }
);

if (!report.ok) {
  console.error(report.results.filter((result) => result.outcome === 'failed'));
}
```

`uploadSourceMaps` doesn't throw when an upload fails. Each entry in `report.results` says whether its map was `created`, `replaced` or `failed`, and why.

## What gets sent

Every map is a `POST /api/sourcemaps` with multipart fields `release`, `minified_url`, `sourcemap` and, when you pass one, `dist`. It authenticates the way the browser SDK does. An ingest key goes in the `X-LaraBug-Ingest-Key` header. A legacy DSN sends its login key as a bearer token and names its project in a `project` field.

Network errors, 408, 429 and 5xx responses are retried with exponential backoff, and a `Retry-After` header is honoured up to 30 seconds. A 413 or 422 is reported without a retry. A 401 or 403 stops the remaining uploads.

## License

MIT
