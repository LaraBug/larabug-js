import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import type { Plugin, ResolvedConfig } from 'vite';
import {
  createFileFilter,
  Credentials,
  detectRelease,
  fallbackRelease,
  FALLBACK_RELEASE_LENGTH,
  FilterPattern,
  keyFromEnv,
  loadEnv,
  Logger,
  minifiedUrl,
  parseCredentials,
  removeFiles,
  SourceMapUpload,
  uploadSourceMaps,
} from '@larabug/sourcemaps';
import { cveScanPayload, sendCveScan } from './cve-scan';
import { findLockfile, readLockfile } from './lockfile';

export interface LaraBugViteOptions {
  /**
   * Your project's ingest key (`lbi_...`) or DSN. Defaults to `LARABUG_KEY`,
   * `LARABUG_DSN` or `VITE_LARABUG_DSN`, from the environment or `.env`.
   */
  key?: string;

  /** Defaults to `LARABUG_HOST`, then the DSN's host, then https://www.larabug.com */
  host?: string;

  /**
   * Defaults to `LARABUG_RELEASE` (or `VITE_LARABUG_RELEASE`), then the git
   * commit being built, then the build time and a hash of the build.
   */
  release?: string;

  /**
   * Where the built files are served from, when Vite's `base` does not say: a
   * full URL (a CDN), or a path such as `/build/`, which matches any host.
   * Defaults to Vite's `base`.
   */
  base?: string;

  /** Scripts to upload maps for, matched against their output path (`assets/app-D4wpJuT4.js`) */
  include?: FilterPattern;

  /** Scripts to leave out, matched like `include` */
  exclude?: FilterPattern;

  /** Delete the .map files after uploading, so they are not served publicly. Defaults to true. */
  removeSourceMaps?: boolean;

  /** Retries per file on network errors, 408, 429 and 5xx. Defaults to 3. */
  retries?: number;

  /** Log what would be uploaded without sending anything */
  dryRun?: boolean;

  /** Print errors only */
  silent?: boolean;

  /** Fail the build when an upload fails. Defaults to false. */
  failOnError?: boolean;

  /**
   * Send the project's lockfile to LaraBug after each build, to be checked for
   * known vulnerabilities. Never fails the build. Defaults to true.
   */
  cveScan?: boolean;
}

/**
 * Stands in for the release in the bundle while it is being built, for a
 * fallback release that depends on the built code. It is exactly as long as
 * the release that replaces it, so no column in any source map moves.
 */
export const RELEASE_PLACEHOLDER = '__larabug_release_pending__';

interface PluginContextLike {
  environment?: { name: string; config?: { consumer?: string } };
  error(message: string): never;
}

/**
 * Builds with hidden source maps, uploads them to LaraBug with the build's
 * release, and removes them from the output. The same release is injected as
 * `__LARABUG_RELEASE__` and `import.meta.env.VITE_LARABUG_RELEASE`, which
 * `@larabug/browser` reads by default, so every error names the build it came
 * from. Only `vite build` is affected, and SSR bundles are never uploaded.
 * After the client build it also sends the project's lockfile to LaraBug to be
 * checked for known vulnerabilities.
 */
export function larabug(options: LaraBugViteOptions = {}): Plugin {
  let config: ResolvedConfig;
  let root = process.cwd();
  let command = 'build';
  let mode = 'production';
  let env: Record<string, string> = {};
  let release: string | null = null;
  let logger: Logger;
  let warnedAboutBase = false;
  let scanned = false;
  const accepts = createFileFilter(options.include, options.exclude);

  const isServerBuild = (context: PluginContextLike): boolean => {
    const environment = context.environment;
    if (environment?.config?.consumer) {
      return environment.config.consumer === 'server';
    }

    return Boolean(config.build.ssr);
  };

  return {
    name: 'larabug',
    apply: 'build',

    config(userConfig, configEnv) {
      ({ command, mode } = configEnv);
      root = resolve(userConfig.root ?? process.cwd());
      const envDir =
        typeof userConfig.envDir === 'string' ? resolve(root, userConfig.envDir) : root;
      env = loadEnv(envDir, mode);

      release =
        detectRelease({
          release: options.release,
          cwd: root,
          env: { ...env, LARABUG_RELEASE: env.LARABUG_RELEASE || env.VITE_LARABUG_RELEASE },
        })?.release ?? null;

      const injected = JSON.stringify(release ?? RELEASE_PLACEHOLDER);
      const isSsrBuild =
        (configEnv as { isSsrBuild?: boolean }).isSsrBuild ?? Boolean(userConfig.build?.ssr);

      return {
        define: {
          __LARABUG_RELEASE__: injected,
          'import.meta.env.VITE_LARABUG_RELEASE': injected,
        },
        // 'hidden' writes the maps but leaves the sourceMappingURL comment out
        // of the scripts, so browsers never ask for them.
        build:
          userConfig.build?.sourcemap === undefined && !isSsrBuild ? { sourcemap: 'hidden' } : {},
      };
    },

    configResolved(resolved) {
      config = resolved;

      const prefix = '[larabug]';
      const quiet = options.silent === true;
      logger = {
        info: (message) => !quiet && resolved.logger.info(`${prefix} ${message}`),
        warn: (message) => !quiet && resolved.logger.warn(`${prefix} ${message}`),
        error: (message) => resolved.logger.error(`${prefix} ${message}`),
      };

      const sourcemap = resolved.build.sourcemap;
      if (!resolved.build.ssr && (sourcemap === false || sourcemap === 'inline')) {
        logger.warn(
          `build.sourcemap is ${JSON.stringify(sourcemap)}, so there are no .map files to upload. ` +
            "Remove the setting (the plugin then uses 'hidden'), or set it to 'hidden' or true."
        );
      }
    },

    generateBundle: {
      // Before other plugins compress or copy the chunks.
      order: 'pre',
      handler(_output, bundle) {
        if (release === null) {
          const chunks = Object.values(bundle)
            .filter((file) => file.type === 'chunk')
            .sort((a, b) => a.fileName.localeCompare(b.fileName))
            .map((chunk) => (chunk.type === 'chunk' ? chunk.code : ''));

          release = fallbackRelease(chunks);
          if (release.length !== FALLBACK_RELEASE_LENGTH) {
            this.error('the fallback release does not fit its placeholder');
          }
        }

        for (const file of Object.values(bundle)) {
          if (file.type === 'chunk' && file.code.includes(RELEASE_PLACEHOLDER)) {
            file.code = file.code.split(RELEASE_PLACEHOLDER).join(release);
          }
        }
      },
    },

    async writeBundle(output, bundle) {
      if (isServerBuild(this as unknown as PluginContextLike)) {
        return;
      }

      // Runs alongside the upload, and never fails it or the build.
      const scanning = scanDependencies();

      const dir = output.dir ?? (output.file ? dirname(output.file) : config.build.outDir);
      const prefix = options.base ?? config.base;

      if (!warnedAboutBase && options.base === undefined && !/^(https?:)?\/\/|^\//.test(prefix)) {
        warnedAboutBase = true;
        logger.warn(
          `Vite's base is ${JSON.stringify(prefix)}, a relative path, so maps are matched as if the files ` +
            "were served from the site root. Pass the plugin's base option if they are not."
        );
      }

      const uploads: SourceMapUpload[] = [];
      const maps = new Set<string>();

      for (const file of Object.values(bundle)) {
        if (file.fileName.endsWith('.map')) {
          maps.add(join(dir, file.fileName));
        }

        if (file.type !== 'chunk') {
          continue;
        }

        const mapFileName =
          (file as { sourcemapFileName?: string | null }).sourcemapFileName ??
          `${file.fileName}.map`;
        const sourcemapPath = join(dir, mapFileName);

        if (existsSync(sourcemapPath)) {
          maps.add(sourcemapPath);

          if (accepts(file.fileName)) {
            uploads.push({ sourcemapPath, minifiedUrl: minifiedUrl(prefix, file.fileName) });
          }
        }
      }

      const fail = (message: string, level: 'warn' | 'error' = 'error'): void => {
        if (options.failOnError) {
          (this as unknown as PluginContextLike).error(`[larabug] ${message}`);
        }
        logger[level](`${message} The build carries on; set failOnError to stop it instead.`);
      };

      try {
        if (uploads.length > 0) {
          await upload(uploads, fail);
        }
      } finally {
        if (options.removeSourceMaps !== false && maps.size > 0) {
          const removed = await removeFiles([...maps]);
          logger.info(`removed ${removed} source map(s) from ${dir}`);
        }
        await scanning;
      }
    },
  };

  /** Once per build. Every failure is one warning; a build without a key skips it quietly. */
  async function scanDependencies(): Promise<void> {
    if (options.cveScan === false || command !== 'build' || scanned) {
      return;
    }
    scanned = true;

    let credentials: Credentials;
    try {
      // The source map upload already reports a missing or unusable key.
      credentials = parseCredentials(options.key ?? keyFromEnv(env) ?? '');
    } catch {
      return;
    }

    try {
      const path = findLockfile(root);
      if (!path) {
        logger.info('no package-lock.json, pnpm-lock.yaml or yarn.lock found, so no CVE scan');
        return;
      }

      const lock = readLockfile(path);

      if (options.dryRun) {
        logger.info(
          `dry run: would send ${lock.packages.length} package(s) from ${lock.lockfile} for a CVE scan`
        );
        return;
      }

      const outcome = await sendCveScan(cveScanPayload(lock, credentials, mode), {
        credentials,
        host: options.host ?? env.LARABUG_HOST,
      });

      logger.info(
        outcome === 'unchanged'
          ? `${lock.lockfile} is unchanged since the last CVE scan`
          : `sent ${lock.packages.length} package(s) from ${lock.lockfile} for a CVE scan`
      );
    } catch (error) {
      // fetch's errors may come from another realm, where instanceof fails.
      const { message, cause } = (error ?? {}) as {
        message?: unknown;
        cause?: { message?: unknown };
      };
      const reason = `${message ?? error}${cause?.message ? ` (${cause.message})` : ''}`;
      logger.warn(`CVE scan skipped, the build carries on: ${reason}`);
    }
  }

  async function upload(
    uploads: SourceMapUpload[],
    fail: (message: string, level?: 'warn' | 'error') => void
  ): Promise<void> {
    const key = options.key ?? keyFromEnv(env);
    let credentials: Credentials;

    try {
      if (!key) {
        throw new Error(
          "No LaraBug key, so no source maps were uploaded. Set LARABUG_KEY to your project's ingest key or DSN."
        );
      }
      credentials = parseCredentials(key);
    } catch (error) {
      if (options.dryRun) {
        logger.warn(`${(error as Error).message} Continuing, since this is a dry run.`);
        credentials = { type: 'ingest', ingestKey: '' };
      } else {
        // A build without a key is usually a local one, not a broken deploy.
        fail((error as Error).message, key ? 'error' : 'warn');
        return;
      }
    }

    logger.info(
      `${options.dryRun ? 'dry run: ' : ''}uploading ${uploads.length} source map(s) for release ${release}`
    );

    const report = await uploadSourceMaps(uploads, {
      credentials,
      release: release as string,
      host: options.host ?? env.LARABUG_HOST,
      retries: options.retries,
      dryRun: options.dryRun,
      logger: { ...logger, info: () => undefined },
    });

    if (!report.ok) {
      fail(`${report.failed} of ${report.results.length} source map(s) failed to upload.`);
    } else if (!options.dryRun) {
      logger.info(`uploaded ${report.uploaded} source map(s) to ${report.endpoint}`);
    } else {
      report.results.forEach((result) => logger.info(`would upload ${result.minifiedUrl}`));
    }
  }
}

export default larabug;
