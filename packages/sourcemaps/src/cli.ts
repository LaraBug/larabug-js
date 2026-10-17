import { resolve } from 'path';
import { parseArgs } from 'util';
import { Credentials, CredentialsError, keyFromEnv, parseCredentials } from './credentials';
import { loadEnv } from './env';
import { findSourceMaps, removeFiles } from './files';
import { detectRelease } from './release';
import { minifiedUrl } from './url';
import { listSourceMaps, Logger, silentLogger, uploadSourceMaps } from './upload';

const USAGE = `Usage: larabug-sourcemaps <command> [options]

Commands:
  upload    Upload every <script>.map in a directory
  list      List the source maps LaraBug holds for a release

Options:
  --dir <path>           Directory with the built files (upload, required)
  --url-prefix <prefix>  Where that directory is served from: a full URL, or a
                         path such as "~/build" that matches any host (default "~/")
  --release <release>    Defaults to LARABUG_RELEASE, then the current git commit
  --key <key>            Ingest key or DSN. Defaults to LARABUG_KEY, LARABUG_DSN
                         or VITE_LARABUG_DSN, from the environment or .env
  --host <url>           Defaults to the DSN's host, else https://www.larabug.com
  --dist <dist>          Sent as the optional dist field
  --include <glob>       Only these files, relative to --dir (repeatable)
  --exclude <glob>       Skip these files, relative to --dir (repeatable)
  --remove-source-maps   Delete the .map files afterwards, uploaded or not
  --retries <n>          Retries per file on network errors and 5xx (default 3)
  --dry-run              Show what would be uploaded, send nothing
  --silent               Print errors only
  -h, --help             Show this help`;

export async function run(
  argv: string[],
  io: { cwd?: string; logger?: Logger; fetch?: typeof fetch } = {}
): Promise<number> {
  const cwd = io.cwd ?? process.cwd();
  const consoleLogger: Logger = {
    info: (message) => console.log(`[larabug] ${message}`),
    warn: (message) => console.warn(`[larabug] ${message}`),
    error: (message) => console.error(`[larabug] ${message}`),
  };

  let args: ReturnType<typeof parse>;
  try {
    args = parse(argv);
  } catch (error) {
    consoleLogger.error((error as Error).message);
    console.error(USAGE);
    return 2;
  }

  const { values, positionals } = args;
  const command = positionals[0];

  if (values.help || !command) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }

  const base = io.logger ?? consoleLogger;
  const logger: Logger = values.silent ? { ...silentLogger, error: base.error } : base;
  const env = loadEnv(cwd);

  let credentials: Credentials;
  try {
    const key = values.key ?? keyFromEnv(env);
    if (!key) {
      throw new CredentialsError(
        "No key. Pass --key, or set LARABUG_KEY to your project's ingest key or DSN."
      );
    }
    credentials = parseCredentials(key);
  } catch (error) {
    if (!(error instanceof CredentialsError) || !values['dry-run']) {
      logger.error((error as Error).message);
      return 1;
    }
    // A dry run shows what would go out even before a key is set up.
    logger.warn(`${(error as Error).message} Continuing, since this is a dry run.`);
    credentials = { type: 'ingest', ingestKey: '' };
  }

  const host = values.host ?? env.LARABUG_HOST;
  const release = detectRelease({ release: values.release, cwd, env })?.release;
  if (!release) {
    logger.error(
      'No release. Pass --release, or set LARABUG_RELEASE, or run inside a git checkout.'
    );
    return 1;
  }

  if (command === 'list') {
    try {
      console.log(
        JSON.stringify(
          await listSourceMaps(release, { credentials, host, fetch: io.fetch }),
          null,
          2
        )
      );
      return 0;
    } catch (error) {
      logger.error((error as Error).message);
      return 1;
    }
  }

  if (command !== 'upload') {
    logger.error(`Unknown command "${command}".`);
    console.error(USAGE);
    return 2;
  }

  if (!values.dir) {
    logger.error('upload needs --dir, the directory with the built files.');
    return 2;
  }

  const dir = resolve(cwd, values.dir);
  let maps;
  try {
    maps = await findSourceMaps(dir, { include: values.include, exclude: values.exclude });
  } catch (error) {
    logger.error(`Could not read ${dir}: ${(error as Error).message}`);
    return 1;
  }

  if (maps.length === 0) {
    logger.warn(`No source maps found in ${dir}.`);
    return 0;
  }

  logger.info(
    `${values['dry-run'] ? 'Dry run: ' : ''}uploading ${maps.length} source map(s) for release ${release}`
  );

  const report = await uploadSourceMaps(
    maps.map((map) => ({
      sourcemapPath: map.sourcemapPath,
      minifiedUrl: minifiedUrl(values['url-prefix'], map.minifiedPath),
    })),
    {
      credentials,
      release,
      dist: values.dist,
      host,
      retries: values.retries !== undefined ? Number(values.retries) : undefined,
      dryRun: values['dry-run'],
      logger,
      fetch: io.fetch,
    }
  );

  if (values['remove-source-maps']) {
    const removed = await removeFiles(maps.map((map) => map.sourcemapPath));
    logger.info(`removed ${removed} source map(s) from ${dir}`);
  }

  if (!report.ok) {
    logger.error(`${report.failed} of ${report.results.length} source map(s) failed to upload.`);
    return 1;
  }

  return 0;
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      dir: { type: 'string' },
      'url-prefix': { type: 'string' },
      release: { type: 'string' },
      key: { type: 'string' },
      host: { type: 'string' },
      dist: { type: 'string' },
      include: { type: 'string', multiple: true },
      exclude: { type: 'string', multiple: true },
      'remove-source-maps': { type: 'boolean' },
      retries: { type: 'string' },
      'dry-run': { type: 'boolean' },
      silent: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
}
