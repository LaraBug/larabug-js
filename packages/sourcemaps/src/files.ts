import { promises as fs } from 'fs';
import { join, relative, sep } from 'path';
import picomatch from 'picomatch';

export type FilterPattern = string | RegExp | Array<string | RegExp>;

export interface SourceMapFile {
  /** Absolute path of the .map file on disk */
  sourcemapPath: string;
  /** Path of the minified file relative to the output directory, with forward slashes */
  minifiedPath: string;
}

const MINIFIED_SCRIPT = /\.[cm]?js$/;

/**
 * Matches the minified file's path relative to the output directory, such as
 * `assets/app-D4wpJuT4.js`. Globs or regular expressions; no include means
 * every file, and exclude always wins.
 */
export function createFileFilter(
  include?: FilterPattern,
  exclude?: FilterPattern
): (path: string) => boolean {
  const matcher = (pattern: FilterPattern | undefined) => {
    const patterns = pattern === undefined ? [] : Array.isArray(pattern) ? pattern : [pattern];

    return patterns.map((entry) =>
      entry instanceof RegExp ? (path: string) => entry.test(path) : picomatch(entry, { dot: true })
    );
  };

  const includes = matcher(include);
  const excludes = matcher(exclude);

  return (path) =>
    (includes.length === 0 || includes.some((test) => test(path))) &&
    !excludes.some((test) => test(path));
}

/**
 * Every `<script>.map` under `dir` whose script sits beside it. For bundlers
 * other than Vite, which can hand over the files directly.
 */
export async function findSourceMaps(
  dir: string,
  options: { include?: FilterPattern; exclude?: FilterPattern } = {}
): Promise<SourceMapFile[]> {
  const accepts = createFileFilter(options.include, options.exclude);
  const found: SourceMapFile[] = [];

  const walk = async (current: string): Promise<void> => {
    const entries = await fs.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const path = join(current, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') {
          await walk(path);
        }
        continue;
      }

      if (!entry.name.endsWith('.map')) {
        continue;
      }

      const minified = path.slice(0, -'.map'.length);
      const minifiedPath = relative(dir, minified).split(sep).join('/');

      if (MINIFIED_SCRIPT.test(minified) && (await exists(minified)) && accepts(minifiedPath)) {
        found.push({ sourcemapPath: path, minifiedPath });
      }
    }
  };

  await walk(dir);

  return found.sort((a, b) => a.minifiedPath.localeCompare(b.minifiedPath));
}

/** Deletes the files, ignoring any that are already gone. Returns how many were removed. */
export async function removeFiles(paths: string[]): Promise<number> {
  let removed = 0;

  for (const path of new Set(paths)) {
    try {
      await fs.unlink(path);
      removed++;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return removed;
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}
