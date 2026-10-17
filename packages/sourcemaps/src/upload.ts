import { promises as fs } from 'fs';
import { basename } from 'path';
import { authHeaders, Credentials, resolveHost } from './credentials';

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface SourceMapUpload {
  /** Path of the .map file on disk */
  sourcemapPath: string;
  /** Full URL the minified file is served from, or a `~/` path for any host */
  minifiedUrl: string;
}

export interface UploadOptions {
  credentials: Credentials;
  release: string;
  dist?: string;
  /** Defaults to the DSN's host, else https://www.larabug.com */
  host?: string;
  /** Retries after the first attempt, for network errors, 408, 429 and 5xx. Defaults to 3. */
  retries?: number;
  /** Delay before the first retry in ms, doubled for each one after. Defaults to 1000. */
  retryDelay?: number;
  /** Per request, in ms. Defaults to 60000. */
  timeout?: number;
  /** Uploads in flight at once. Defaults to 4. */
  concurrency?: number;
  /** Report what would be uploaded without sending anything. */
  dryRun?: boolean;
  logger?: Logger;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export type UploadOutcome = 'created' | 'replaced' | 'dry-run' | 'failed';

export interface UploadResult {
  sourcemapPath: string;
  minifiedUrl: string;
  outcome: UploadOutcome;
  status?: number;
  error?: string;
  attempts: number;
}

export interface UploadReport {
  endpoint: string;
  release: string;
  results: UploadResult[];
  uploaded: number;
  failed: number;
  ok: boolean;
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

const MAX_RETRY_AFTER_MS = 30000;

export function sourcemapsEndpoint(credentials: Credentials, host?: string): string {
  return `${resolveHost(credentials, host)}/api/sourcemaps`;
}

/**
 * Uploads each source map to `POST /api/sourcemaps` as multipart form data:
 * `release`, `minified_url`, `sourcemap` and, when given, `dist`. Never throws
 * for a failed upload; the report says what happened to every file, and the
 * caller decides whether a failure should fail the build.
 */
export async function uploadSourceMaps(
  files: SourceMapUpload[],
  options: UploadOptions
): Promise<UploadReport> {
  const endpoint = sourcemapsEndpoint(options.credentials, options.host);
  const logger = options.logger ?? silentLogger;
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const results: UploadResult[] = new Array(files.length);

  // A refused credential is refused for every file: stop rather than send the
  // rest of the build to be refused one by one.
  let refusal: string | null = null;

  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const index = next++;
      const file = files[index];

      if (refusal) {
        results[index] = { ...file, outcome: 'failed', error: refusal, attempts: 0 };
        continue;
      }

      const result = await uploadOne(file, endpoint, options);
      results[index] = result;

      if (result.status === 401 || result.status === 403) {
        refusal = result.error ?? 'LaraBug refused the credentials';
      }

      if (result.outcome === 'failed') {
        logger.error(`${file.minifiedUrl}: ${result.error}`);
      } else {
        logger.info(
          `${result.outcome === 'dry-run' ? 'would upload' : result.outcome} ${file.minifiedUrl}`
        );
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));

  const failed = results.filter((result) => result.outcome === 'failed').length;

  return {
    endpoint,
    release: options.release,
    results,
    uploaded: results.length - failed,
    failed,
    ok: failed === 0,
  };
}

async function uploadOne(
  file: SourceMapUpload,
  endpoint: string,
  options: UploadOptions
): Promise<UploadResult> {
  let content: string;
  try {
    content = await fs.readFile(file.sourcemapPath, 'utf8');
    assertSourceMap(content);
  } catch (error) {
    return { ...file, outcome: 'failed', error: describe(error), attempts: 0 };
  }

  if (options.dryRun) {
    return { ...file, outcome: 'dry-run', attempts: 0 };
  }

  const send = options.fetch ?? globalThis.fetch;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const retries = Math.max(0, options.retries ?? 3);
  const retryDelay = Math.max(0, options.retryDelay ?? 1000);
  const timeout = options.timeout ?? 60000;

  let attempts = 0;
  let lastError = '';
  let lastStatus: number | undefined;
  // Set by a 429 or 503 that says how long to wait, for the next attempt only.
  let wait: number | undefined;

  while (attempts <= retries) {
    if (attempts > 0) {
      await sleep(wait ?? retryDelay * 2 ** (attempts - 1));
    }
    attempts++;
    wait = undefined;

    try {
      const response = await send(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'larabug-sourcemaps',
          ...authHeaders(options.credentials),
        },
        body: formFor(file, content, options),
        signal: AbortSignal.timeout(timeout),
      });

      lastStatus = response.status;

      if (response.status === 201 || response.status === 200) {
        return {
          ...file,
          outcome: response.status === 201 ? 'created' : 'replaced',
          status: response.status,
          attempts,
        };
      }

      lastError = await explain(response);

      if (!isRetryable(response.status)) {
        break;
      }

      wait = retryAfter(response);
    } catch (error) {
      lastStatus = undefined;
      lastError = describe(error);
    }
  }

  return { ...file, outcome: 'failed', status: lastStatus, error: lastError, attempts };
}

function formFor(file: SourceMapUpload, content: string, options: UploadOptions): FormData {
  const form = new FormData();
  form.append('release', options.release);
  form.append('minified_url', file.minifiedUrl);
  if (options.dist) {
    form.append('dist', options.dist);
  }
  // The ingest route checks a project named in the request against the key;
  // a login key needs it to know which project is meant.
  if (options.credentials.projectKey) {
    form.append('project', options.credentials.projectKey);
  }
  form.append(
    'sourcemap',
    new Blob([content], { type: 'application/json' }),
    basename(file.sourcemapPath)
  );

  return form;
}

function assertSourceMap(content: string): void {
  let map: unknown;
  try {
    map = JSON.parse(content);
  } catch {
    throw new Error('not a source map: the file is not valid JSON');
  }

  const looksRight =
    map !== null &&
    typeof map === 'object' &&
    (typeof (map as { mappings?: unknown }).mappings === 'string' ||
      Array.isArray((map as { sections?: unknown }).sections));

  if (!looksRight) {
    throw new Error('not a source map: it has no mappings');
  }
}

function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function retryAfter(response: Response): number | undefined {
  const header = response.headers?.get?.('retry-after');
  const seconds = header ? Number(header) : NaN;

  return Number.isFinite(seconds) && seconds >= 0
    ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
    : undefined;
}

async function explain(response: Response): Promise<string> {
  const reasons: Record<number, string> = {
    401: 'LaraBug did not accept the key (401). Check LARABUG_KEY or the key option.',
    403: 'The key may not upload source maps for this project (403).',
    413: 'The source map is larger than LaraBug accepts (413).',
    422: 'LaraBug rejected the source map as invalid (422).',
  };

  let detail = '';
  try {
    const text = await response.text();
    try {
      const body = JSON.parse(text) as { message?: unknown; error?: unknown };
      detail = String(body.message ?? body.error ?? '');
    } catch {
      detail = text.slice(0, 200);
    }
  } catch {
    // No body to read.
  }

  const reason = reasons[response.status] ?? `LaraBug answered ${response.status}.`;

  return detail ? `${reason} ${detail}` : reason;
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof Error ? `${error.message} (${cause.message})` : error.message;
  }

  return String(error);
}

/** `GET /api/sourcemaps/releases/{release}`: what LaraBug holds for a release. */
export async function listSourceMaps(
  release: string,
  options: { credentials: Credentials; host?: string; fetch?: typeof fetch; timeout?: number }
): Promise<unknown> {
  const send = options.fetch ?? globalThis.fetch;
  const url = `${sourcemapsEndpoint(options.credentials, options.host)}/releases/${encodeURIComponent(release)}`;
  const query = options.credentials.projectKey
    ? `?project=${encodeURIComponent(options.credentials.projectKey)}`
    : '';

  const response = await send(url + query, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'larabug-sourcemaps',
      ...authHeaders(options.credentials),
    },
    signal: AbortSignal.timeout(options.timeout ?? 30000),
  });

  if (!response.ok) {
    throw new Error(await explain(response));
  }

  return response.json();
}
