/**
 * Normalises where minified files are served from into the form LaraBug
 * matches `minified_url` against: a full URL, or a `~/` path that matches on
 * any host. Always ends in a slash.
 *
 *   "https://cdn.test/build"  ->  "https://cdn.test/build/"
 *   "//cdn.test/build/"       ->  "https://cdn.test/build/"
 *   "/build/"                 ->  "~/build/"
 *   "~/build"                 ->  "~/build/"
 *   "build", "./build", ""    ->  "~/build/", "~/build/", "~/"
 */
export function normalizeUrlPrefix(prefix: string | undefined): string {
  let value = (prefix ?? '').trim();

  if (value.startsWith('//')) {
    value = `https:${value}`;
  }

  if (!/^https?:\/\//i.test(value)) {
    value = `~/${value.replace(/^~/, '').replace(/^(\.\/|\/)+/, '')}`;
  }

  return value.endsWith('/') ? value : `${value}/`;
}

/** The `minified_url` of a file at `minifiedPath` relative to where `prefix` points. */
export function minifiedUrl(prefix: string | undefined, minifiedPath: string): string {
  return normalizeUrlPrefix(prefix) + minifiedPath.replace(/\\/g, '/').replace(/^\/+/, '');
}
