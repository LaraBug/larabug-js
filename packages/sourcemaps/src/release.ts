import { execFileSync } from 'child_process';
import { createHash } from 'crypto';

export const RELEASE_ENV_VAR = 'LARABUG_RELEASE';

// Commit SHAs that CI and hosting platforms expose, for builds that run
// without a .git directory (Docker images, tarball deploys).
const COMMIT_ENV_VARS = [
  'GITHUB_SHA',
  'CI_COMMIT_SHA',
  'BITBUCKET_COMMIT',
  'CIRCLE_SHA1',
  'VERCEL_GIT_COMMIT_SHA',
  'COMMIT_REF',
  'SOURCE_VERSION',
  'FORGE_DEPLOY_COMMIT',
];

export interface DetectedRelease {
  release: string;
  source: 'option' | 'env' | 'git' | 'ci';
}

/**
 * The release a build belongs to: an explicit value, else `LARABUG_RELEASE`,
 * else the commit being built. Null when none of them is available; the caller
 * then falls back to `fallbackRelease()`.
 */
export function detectRelease(
  options: { release?: string; cwd?: string; env?: Record<string, string | undefined> } = {}
): DetectedRelease | null {
  const env = options.env ?? process.env;

  if (options.release && options.release.trim() !== '') {
    return { release: options.release.trim(), source: 'option' };
  }

  const fromEnv = env[RELEASE_ENV_VAR];
  if (fromEnv && fromEnv.trim() !== '') {
    return { release: fromEnv.trim(), source: 'env' };
  }

  const sha = gitCommitSha(options.cwd);
  if (sha) {
    return { release: sha, source: 'git' };
  }

  for (const name of COMMIT_ENV_VARS) {
    const value = env[name];
    if (value && /^[0-9a-f]{7,64}$/i.test(value.trim())) {
      return { release: value.trim().toLowerCase(), source: 'ci' };
    }
  }

  return null;
}

export function gitCommitSha(cwd?: string): string | null {
  try {
    const output = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();

    return /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(output) ? output : null;
  } catch {
    return null;
  }
}

/** Every fallback release is exactly this long: `YYYYMMDDHHmmss-` and 12 hex digits. */
export const FALLBACK_RELEASE_LENGTH = 27;

/**
 * A release for a build that has no commit to name it after: the build time
 * and a hash of what was built, so two builds never share one.
 */
export function fallbackRelease(
  contents: Iterable<string | Uint8Array>,
  now: Date = new Date()
): string {
  const hash = createHash('sha256');
  for (const content of contents) {
    hash.update(content);
  }

  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);

  return `${stamp}-${hash.digest('hex').slice(0, 12)}`;
}
