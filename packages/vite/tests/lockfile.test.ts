import { createHash } from 'crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { findLockfile, LockedPackage, parseLockfile, readLockfile } from '../src/lockfile';

/**
 * The fixtures are real lockfiles, written by npm 11, yarn 1.22 and 4.5, and
 * pnpm 7, 8 and 9 for one app: three dependencies, `debug` bringing its own
 * `ms`, and two dev dependencies where `is-odd` brings its own `is-number`.
 */
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

const app = (devKnown: boolean): LockedPackage[] => [
  { name: '@sindresorhus/is', version: '4.6.0', dev: false },
  { name: 'debug', version: '2.6.9', dev: false },
  { name: 'is-number', version: '6.0.0', dev: devKnown },
  { name: 'is-number', version: '7.0.0', dev: devKnown },
  { name: 'is-odd', version: '3.0.1', dev: devKnown },
  { name: 'ms', version: '2.0.0', dev: false },
  { name: 'ms', version: '2.1.3', dev: false },
];

describe('parsing', () => {
  it.each([
    ['package-lock.json', 'package-lock-v1.json'],
    ['package-lock.json', 'package-lock-v2.json'],
    ['package-lock.json', 'package-lock-v3.json'],
    ['pnpm-lock.yaml', 'pnpm-lock-v5.yaml'],
    ['pnpm-lock.yaml', 'pnpm-lock-v6.yaml'],
    ['pnpm-lock.yaml', 'pnpm-lock-v9.yaml'],
  ])('reads every package and whether it is dev only from %s (%s)', (lockfile, name) => {
    expect(parseLockfile(lockfile, fixture(name))).toEqual(app(true));
  });

  it.each(['yarn-v1.lock', 'yarn-berry.lock'])(
    'reads every package from yarn.lock (%s), none of them marked dev',
    (name) => {
      expect(parseLockfile('yarn.lock', fixture(name))).toEqual(app(false));
    }
  );

  it('keeps every version of a name, and each pair once', () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'app' },
        'node_modules/ms': { version: '2.1.3' },
        'node_modules/debug/node_modules/ms': { version: '2.0.0' },
        'node_modules/send/node_modules/ms': { version: '2.0.0', dev: true },
        'node_modules/eslint/node_modules/ms': { version: '2.1.3', dev: true },
        'node_modules/jest/node_modules/semver': { version: '7.6.0', dev: true },
        'node_modules/vite/node_modules/semver': { version: '7.6.0', dev: true },
      },
    });

    // A pair is dev only when every copy of it is.
    expect(parseLockfile('package-lock.json', lock)).toEqual([
      { name: 'ms', version: '2.0.0', dev: false },
      { name: 'ms', version: '2.1.3', dev: false },
      { name: 'semver', version: '7.6.0', dev: true },
    ]);
  });

  it('names scoped packages by their scope and name in every format', () => {
    const lockfiles: [string, string][] = [
      ['package-lock.json', 'package-lock-v1.json'],
      ['package-lock.json', 'package-lock-v3.json'],
      ['yarn.lock', 'yarn-v1.lock'],
      ['yarn.lock', 'yarn-berry.lock'],
      ['pnpm-lock.yaml', 'pnpm-lock-v5.yaml'],
      ['pnpm-lock.yaml', 'pnpm-lock-v9.yaml'],
    ];

    for (const [lockfile, name] of lockfiles) {
      expect(parseLockfile(lockfile, fixture(name))[0]).toEqual({
        name: '@sindresorhus/is',
        version: '4.6.0',
        dev: false,
      });
    }
  });

  describe('package-lock.json', () => {
    it('skips the project, its workspaces and links, and names aliases by the real package', () => {
      const lock = JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { name: 'app', version: '1.0.0' },
          'packages/ui': { name: '@app/ui', version: '1.0.0' },
          'node_modules/@app/ui': { resolved: 'packages/ui', link: true },
          'node_modules/string-width-cjs': { name: 'string-width', version: '4.2.3' },
          'node_modules/@scope/pkg/node_modules/@scope/dep': { version: '1.0.0' },
        },
      });

      expect(parseLockfile('package-lock.json', lock)).toEqual([
        { name: '@scope/dep', version: '1.0.0', dev: false },
        { name: 'string-width', version: '4.2.3', dev: false },
      ]);
    });

    it('reads aliases and skips local and git dependencies in v1', () => {
      const lock = JSON.stringify({
        lockfileVersion: 1,
        dependencies: {
          'string-width-cjs': { version: 'npm:string-width@4.2.3' },
          local: { version: 'file:../local' },
          forked: { version: 'git+https://github.com/someone/forked.git#abc123' },
          lodash: { version: '4.17.21', dev: true },
        },
      });

      expect(parseLockfile('package-lock.json', lock)).toEqual([
        { name: 'lodash', version: '4.17.21', dev: true },
        { name: 'string-width', version: '4.2.3', dev: false },
      ]);
    });
  });

  describe('yarn.lock', () => {
    it('reads v1 entries that several ranges resolve to, and aliases', () => {
      const lock = [
        '# yarn lockfile v1',
        '',
        '"@babel/code-frame@^7.0.0", "@babel/code-frame@^7.22.13":',
        '  version "7.24.7"',
        '  dependencies:',
        '    "@babel/highlight" "^7.24.7"',
        '',
        '"string-width-cjs@npm:string-width@^4.2.0":',
        '  version "4.2.3"',
        '',
      ].join('\n');

      expect(parseLockfile('yarn.lock', lock)).toEqual([
        { name: '@babel/code-frame', version: '7.24.7', dev: false },
        { name: 'string-width', version: '4.2.3', dev: false },
      ]);
    });

    it('reads berry resolutions, behind aliases and patches, and skips workspaces', () => {
      const lock = [
        '__metadata:',
        '  version: 8',
        '',
        '"app@workspace:.":',
        '  version: 0.0.0-use.local',
        '  resolution: "app@workspace:."',
        '  linkType: soft',
        '',
        '"resolve@npm:^1.22.4":',
        '  version: 1.22.8',
        '  resolution: "resolve@npm:1.22.8"',
        '  linkType: hard',
        '',
        '"resolve@patch:resolve@npm%3A^1.22.4#optional!builtin<compat/resolve>":',
        '  version: 1.22.8',
        '  resolution: "resolve@patch:resolve@npm%3A1.22.8#optional!builtin<compat/resolve>::version=1.22.8&hash=c3c19d"',
        '  linkType: hard',
        '',
        '"string-width-cjs@npm:string-width@^4.2.0":',
        '  version: 4.2.3',
        '  resolution: "string-width@npm:4.2.3"',
        '  linkType: hard',
      ].join('\n');

      expect(parseLockfile('yarn.lock', lock)).toEqual([
        { name: 'resolve', version: '1.22.8', dev: false },
        { name: 'string-width', version: '4.2.3', dev: false },
      ]);
    });
  });

  describe('pnpm-lock.yaml', () => {
    it('follows peer suffixes, aliases and workspace links to tell production from dev in 9.0', () => {
      const lock = [
        "lockfileVersion: '9.0'",
        '',
        'importers:',
        '',
        '  .:',
        '    dependencies:',
        '      ui:',
        '        specifier: workspace:*',
        '        version: link:packages/ui',
        '      string-width-cjs:',
        '        specifier: npm:string-width@^4.2.0',
        '        version: string-width@4.2.3',
        '    devDependencies:',
        '      vitest:',
        '        specifier: ^2.0.0',
        '        version: 2.0.5',
        '',
        '  packages/ui:',
        '    dependencies:',
        "      '@inertiajs/react':",
        '        specifier: ^1.2.0',
        '        version: 1.2.0(react@18.3.1)',
        '',
        'packages:',
        '',
        "  '@inertiajs/react@1.2.0':",
        '    resolution: {integrity: sha512-abc}',
        '    peerDependencies:',
        "      react: '*'",
        '',
        '  react@18.3.1:',
        '    resolution: {integrity: sha512-abc}',
        '',
        '  string-width@4.2.3:',
        '    resolution: {integrity: sha512-abc}',
        '',
        '  vitest@2.0.5:',
        '    resolution: {integrity: sha512-abc}',
        '',
        'snapshots:',
        '',
        "  '@inertiajs/react@1.2.0(react@18.3.1)':",
        '    dependencies:',
        '      react: 18.3.1',
        '',
        '  react@18.3.1: {}',
        '',
        '  string-width@4.2.3: {}',
        '',
        '  vitest@2.0.5: {}',
      ].join('\n');

      expect(parseLockfile('pnpm-lock.yaml', lock)).toEqual([
        { name: '@inertiajs/react', version: '1.2.0', dev: false },
        { name: 'react', version: '18.3.1', dev: false },
        { name: 'string-width', version: '4.2.3', dev: false },
        { name: 'vitest', version: '2.0.5', dev: true },
      ]);
    });

    it('strips peer suffixes from 5.x and 6.0 keys', () => {
      const v5 = [
        'lockfileVersion: 5.4',
        'packages:',
        '  /@inertiajs/react/1.2.0_react@18.3.1:',
        '    dev: false',
      ].join('\n');
      const v6 = [
        "lockfileVersion: '6.0'",
        'packages:',
        '  /@inertiajs/react@1.2.0(react@18.3.1):',
        '    dev: true',
      ].join('\n');

      expect(parseLockfile('pnpm-lock.yaml', v5)).toEqual([
        { name: '@inertiajs/react', version: '1.2.0', dev: false },
      ]);
      expect(parseLockfile('pnpm-lock.yaml', v6)).toEqual([
        { name: '@inertiajs/react', version: '1.2.0', dev: true },
      ]);
    });
  });

  it.each([
    ['package-lock.json', '{"lockfileVersion": 3, "packages": '],
    ['package-lock.json', '{"lockfileVersion": 3, "packages": {"": {}}}'],
    ['pnpm-lock.yaml', '<<<<<<< HEAD\nconflict\n'],
    ['yarn.lock', ''],
  ])('throws on a %s it can not read packages from', (lockfile, content) => {
    expect(() => parseLockfile(lockfile, content)).toThrow();
  });
});

describe('finding the lockfile', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'larabug-lockfile-'));
  });

  it('prefers package-lock.json, then pnpm-lock.yaml, then yarn.lock', () => {
    writeFileSync(join(root, 'yarn.lock'), '');
    expect(findLockfile(root)).toBe(join(root, 'yarn.lock'));

    writeFileSync(join(root, 'pnpm-lock.yaml'), '');
    expect(findLockfile(root)).toBe(join(root, 'pnpm-lock.yaml'));

    writeFileSync(join(root, 'package-lock.json'), '');
    expect(findLockfile(root)).toBe(join(root, 'package-lock.json'));
  });

  it('looks in the nearest parent that has one, such as a monorepo root', () => {
    const app = join(root, 'apps/web');
    mkdirSync(app, { recursive: true });
    writeFileSync(join(root, 'pnpm-lock.yaml'), '');

    expect(findLockfile(app)).toBe(join(root, 'pnpm-lock.yaml'));

    writeFileSync(join(app, 'yarn.lock'), '');
    expect(findLockfile(app)).toBe(join(app, 'yarn.lock'));
  });

  it('is null when no directory up to the root has one', () => {
    // The temporary directory is outside any project.
    expect(findLockfile(root)).toBeNull();
  });

  it('hashes the raw file', () => {
    const content = fixture('package-lock-v3.json');
    writeFileSync(join(root, 'package-lock.json'), content);

    expect(readLockfile(join(root, 'package-lock.json'))).toEqual({
      lockfile: 'package-lock.json',
      contentHash: createHash('sha256').update(content).digest('hex'),
      packages: app(true),
    });
  });
});
