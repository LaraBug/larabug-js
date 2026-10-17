import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import {
  createFileFilter,
  CredentialsError,
  detectRelease,
  fallbackRelease,
  FALLBACK_RELEASE_LENGTH,
  findSourceMaps,
  keyFromEnv,
  loadEnv,
  minifiedUrl,
  normalizeUrlPrefix,
  parseCredentials,
  parseEnv,
  removeFiles,
  resolveHost,
} from '../src';

describe('credentials', () => {
  it('read an ingest key on its own', () => {
    expect(parseCredentials('lbi_abc123')).toEqual({ type: 'ingest', ingestKey: 'lbi_abc123' });
  });

  it('read an ingest DSN, with its host', () => {
    expect(parseCredentials('https://lbi_abc123:project-key@larabug.test/api/log')).toEqual({
      type: 'ingest',
      ingestKey: 'lbi_abc123',
      projectKey: 'project-key',
      host: 'https://larabug.test',
    });
  });

  it('read a legacy DSN', () => {
    expect(parseCredentials('https://token:project-key@www.larabug.com/api/log')).toMatchObject({
      type: 'login',
      loginKey: 'token',
      projectKey: 'project-key',
    });
  });

  it('refuse anything else', () => {
    expect(() => parseCredentials('some-login-token')).toThrow(CredentialsError);
    expect(() => parseCredentials('https://token@www.larabug.com/api/log')).toThrow(
      CredentialsError
    );
  });

  it('come from the environment in a fixed order', () => {
    expect(keyFromEnv({ VITE_LARABUG_DSN: 'dsn', LARABUG_KEY: 'key' })).toBe('key');
    expect(keyFromEnv({ VITE_LARABUG_DSN: 'dsn', LARABUG_KEY: ' ' })).toBe('dsn');
    expect(keyFromEnv({})).toBeUndefined();
  });

  it('point at an explicit host first, then the DSN host, then LaraBug', () => {
    const fromDsn = parseCredentials('https://lbi_abc:p@self-hosted.test/api/log');

    expect(resolveHost(fromDsn, 'https://other.test/')).toBe('https://other.test');
    expect(resolveHost(fromDsn)).toBe('https://self-hosted.test');
    expect(resolveHost(parseCredentials('lbi_abc'))).toBe('https://www.larabug.com');
  });
});

describe('minified URLs', () => {
  it.each([
    ['/build/', '~/build/'],
    ['/build', '~/build/'],
    ['~/build', '~/build/'],
    ['./', '~/'],
    ['', '~/'],
    [undefined, '~/'],
    ['build', '~/build/'],
    ['https://cdn.test/build', 'https://cdn.test/build/'],
    ['//cdn.test/build/', 'https://cdn.test/build/'],
  ])('normalise the prefix %p to %p', (prefix, expected) => {
    expect(normalizeUrlPrefix(prefix)).toBe(expected);
  });

  it('join the prefix and the file', () => {
    expect(minifiedUrl('/build/', 'assets/app-D4wpJuT4.js')).toBe('~/build/assets/app-D4wpJuT4.js');
    expect(minifiedUrl('https://cdn.test/', '/assets/app.js')).toBe(
      'https://cdn.test/assets/app.js'
    );
  });
});

describe('release detection', () => {
  const outsideGit = mkdtempSync(join(tmpdir(), 'larabug-nogit-'));

  it('prefers the option, then LARABUG_RELEASE', () => {
    expect(
      detectRelease({ release: 'v1', env: { LARABUG_RELEASE: 'v2' }, cwd: outsideGit })
    ).toEqual({
      release: 'v1',
      source: 'option',
    });
    expect(detectRelease({ env: { LARABUG_RELEASE: 'v2' }, cwd: outsideGit })).toEqual({
      release: 'v2',
      source: 'env',
    });
  });

  it('uses the commit of a git checkout', () => {
    const detected = detectRelease({ env: {}, cwd: resolve(__dirname, '..') });

    expect(detected?.source).toBe('git');
    expect(detected?.release).toMatch(/^[0-9a-f]{40}$/);
  });

  it('falls back to a commit SHA that CI exposes', () => {
    expect(detectRelease({ env: { GITHUB_SHA: 'ABCDEF1234567' }, cwd: outsideGit })).toEqual({
      release: 'abcdef1234567',
      source: 'ci',
    });
  });

  it('gives up without any of them', () => {
    expect(detectRelease({ env: {}, cwd: outsideGit })).toBeNull();
  });

  it('builds a fallback from the time and a hash of the build', () => {
    const release = fallbackRelease(['chunk one', 'chunk two'], new Date('2026-10-16T21:43:28Z'));

    expect(release).toMatch(/^20261016214328-[0-9a-f]{12}$/);
    expect(release).toHaveLength(FALLBACK_RELEASE_LENGTH);
    expect(fallbackRelease(['other chunk'], new Date('2026-10-16T21:43:28Z'))).not.toBe(release);
  });
});

describe('.env files', () => {
  it('parse quoting, comments and export', () => {
    expect(
      parseEnv(
        [
          '# comment',
          'LARABUG_KEY=lbi_abc # inline comment',
          'export LARABUG_HOST="https://larabug.test"',
          "SINGLE='a # b'",
          'EMPTY=',
        ].join('\n')
      )
    ).toEqual({
      LARABUG_KEY: 'lbi_abc',
      LARABUG_HOST: 'https://larabug.test',
      SINGLE: 'a # b',
      EMPTY: '',
    });
  });

  it('load like Vite does: mode files over base files, the process over all', () => {
    const dir = mkdtempSync(join(tmpdir(), 'larabug-env-'));
    writeFileSync(
      join(dir, '.env'),
      'A=base\nB=base\nC=base\nLARABUG_DSN=https://lbi_x@h.test/api/log\nVITE_LARABUG_DSN="${LARABUG_DSN}"\n'
    );
    writeFileSync(join(dir, '.env.production'), 'B=mode\nC=mode\n');
    process.env.C = 'process';

    try {
      const env = loadEnv(dir, 'production');

      expect(env.A).toBe('base');
      expect(env.B).toBe('mode');
      expect(env.C).toBe('process');
      expect(env.VITE_LARABUG_DSN).toBe('https://lbi_x@h.test/api/log');
    } finally {
      delete process.env.C;
    }
  });
});

describe('files', () => {
  it('filter on globs and regular expressions, with exclude winning', () => {
    const accepts = createFileFilter(['assets/**', /legacy\.js$/], 'assets/vendor-*.js');

    expect(accepts('assets/app-1.js')).toBe(true);
    expect(accepts('legacy.js')).toBe(true);
    expect(accepts('assets/vendor-2.js')).toBe(false);
    expect(accepts('other/app.js')).toBe(false);
    expect(createFileFilter()('anything.js')).toBe(true);
  });

  it('find maps that sit beside their script, and remove them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'larabug-find-'));
    mkdirSync(join(dir, 'assets'));
    for (const name of [
      'assets/app.js',
      'assets/app.js.map',
      'assets/app.css',
      'assets/app.css.map',
      'orphan.js.map',
    ]) {
      writeFileSync(join(dir, name), '{}');
    }

    const maps = await findSourceMaps(dir);

    expect(maps).toEqual([
      { sourcemapPath: join(dir, 'assets/app.js.map'), minifiedPath: 'assets/app.js' },
    ]);
    expect(await findSourceMaps(dir, { exclude: 'assets/**' })).toEqual([]);

    expect(await removeFiles([maps[0].sourcemapPath, join(dir, 'already-gone.map')])).toBe(1);
    expect(existsSync(join(dir, 'assets/app.js.map'))).toBe(false);
  });
});
