const INGEST_KEY_PREFIX = 'lbi_';

export const DEFAULT_HOST = 'https://www.larabug.com';

/** The variables a key is read from, first one set wins. */
export const KEY_ENV_VARS = ['LARABUG_KEY', 'LARABUG_DSN', 'VITE_LARABUG_DSN'];

/**
 * The credentials an upload authenticates with: the same ones the browser SDK
 * sends to the ingest route.
 */
export type Credentials =
  | { type: 'ingest'; ingestKey: string; projectKey?: string; host?: string }
  | { type: 'login'; loginKey: string; projectKey: string; host?: string };

export class CredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialsError';
  }
}

/**
 * Reads a project's ingest key (`lbi_...`) or a DSN
 * (`https://key:project_key@host/api/log`). A DSN also names the host.
 */
export function parseCredentials(key: string): Credentials {
  const value = key.trim();

  if (/^https?:\/\//i.test(value)) {
    return parseDsn(value);
  }

  if (value.startsWith(INGEST_KEY_PREFIX)) {
    return { type: 'ingest', ingestKey: value };
  }

  throw new CredentialsError(
    'The key is neither an ingest key (lbi_...) nor a DSN. Copy either from your project settings on LaraBug.'
  );
}

function parseDsn(dsn: string): Credentials {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new CredentialsError(
      'The DSN is not a valid URL. Expected https://key:project_key@host/api/log'
    );
  }

  const credential = decodeURIComponent(url.username);
  const projectKey = decodeURIComponent(url.password);
  const host = url.origin;

  if (credential.startsWith(INGEST_KEY_PREFIX)) {
    return { type: 'ingest', ingestKey: credential, projectKey: projectKey || undefined, host };
  }

  if (credential && projectKey) {
    return { type: 'login', loginKey: credential, projectKey, host };
  }

  throw new CredentialsError(
    'The DSN carries no usable key. Expected https://key:project_key@host/api/log'
  );
}

/** Headers that authenticate a request, exactly as the ingest route reads them. */
export function authHeaders(credentials: Credentials): Record<string, string> {
  return credentials.type === 'ingest'
    ? { 'X-LaraBug-Ingest-Key': credentials.ingestKey }
    : { Authorization: `Bearer ${credentials.loginKey}` };
}

export function keyFromEnv(env: Record<string, string | undefined>): string | undefined {
  for (const name of KEY_ENV_VARS) {
    const value = env[name];
    if (value && value.trim() !== '') {
      return value.trim();
    }
  }

  return undefined;
}

/** An explicit host, else the DSN's host, else LaraBug's. No trailing slash. */
export function resolveHost(credentials: Credentials | null, host?: string): string {
  return (host || credentials?.host || DEFAULT_HOST).replace(/\/+$/, '');
}
