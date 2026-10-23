import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';

export interface LockedPackage {
  name: string;
  version: string;
  dev: boolean;
}

export interface Lockfile {
  /** The file name, such as `package-lock.json` */
  lockfile: string;
  /** sha256 of the raw file, in hex */
  contentHash: string;
  packages: LockedPackage[];
}

/** Checked in this order in each directory; the first one found wins. */
export const LOCKFILE_NAMES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'];

/** The lockfile in `dir` or the nearest parent that has one. */
export function findLockfile(dir: string): string | null {
  let current = resolve(dir);

  for (;;) {
    for (const name of LOCKFILE_NAMES) {
      const path = join(current, name);
      if (existsSync(path)) {
        return path;
      }
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/** Throws when the file cannot be read or parsed. */
export function readLockfile(path: string): Lockfile {
  const raw = readFileSync(path);
  const lockfile = basename(path);

  return {
    lockfile,
    contentHash: createHash('sha256').update(raw).digest('hex'),
    packages: parseLockfile(lockfile, raw.toString('utf8')),
  };
}

/**
 * The installed packages a lockfile names: unique pairs of name and version,
 * sorted. A pair is `dev` only when every copy of it is. yarn.lock does not
 * record what is dev only, so its packages are never marked as such.
 */
export function parseLockfile(lockfile: string, content: string): LockedPackage[] {
  const packages = new Packages();

  if (lockfile === 'package-lock.json') {
    parsePackageLock(JSON.parse(content), packages);
  } else if (lockfile === 'pnpm-lock.yaml') {
    parsePnpmLock(parseIndented(content), packages);
  } else if (lockfile === 'yarn.lock') {
    parseYarnLock(parseIndented(content), packages);
  } else {
    throw new Error(`${lockfile} is not a lockfile this plugin reads`);
  }

  if (packages.size === 0) {
    throw new Error(`${lockfile} names no packages`);
  }

  return packages.list();
}

class Packages {
  private byKey = new Map<string, LockedPackage>();

  get size(): number {
    return this.byKey.size;
  }

  /** Versions that are not plain semver (git, file: and link: specs) can not be matched to advisories. */
  add(name: string | undefined, version: string | undefined, dev: boolean): void {
    if (!name || !version || !/^\d+\.\d+\.\d+/.test(version)) {
      return;
    }

    const key = `${name}@${version}`;
    const existing = this.byKey.get(key);
    if (existing) {
      existing.dev = existing.dev && dev;
    } else {
      this.byKey.set(key, { name, version, dev });
    }
  }

  list(): LockedPackage[] {
    return [...this.byKey.values()].sort((a, b) =>
      a.name === b.name ? compare(a.version, b.version) : compare(a.name, b.name)
    );
  }
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `name@version` with an optional scope, split at the `@` that is not the scope's. */
function splitSpec(spec: string): { name: string; rest: string } {
  const at = spec.indexOf('@', 1);

  return at === -1
    ? { name: spec, rest: '' }
    : { name: spec.slice(0, at), rest: spec.slice(at + 1) };
}

type Json = Record<string, any>;

function parsePackageLock(lock: Json, packages: Packages): void {
  if (lock.packages && typeof lock.packages === 'object') {
    // v2 and v3: a flat map keyed by install path. Paths outside node_modules
    // are the project and its workspaces.
    for (const [path, entry] of Object.entries<Json>(lock.packages)) {
      const at = path.lastIndexOf('node_modules/');
      if (path === '' || at === -1 || entry.link) {
        continue;
      }

      // `name` is set when the package is installed under an alias.
      packages.add(
        entry.name ?? path.slice(at + 'node_modules/'.length),
        entry.version,
        entry.dev === true
      );
    }

    return;
  }

  // v1: a tree of `dependencies`, keyed by name.
  const walk = (dependencies: Json | undefined): void => {
    for (const [name, entry] of Object.entries<Json>(dependencies ?? {})) {
      const version = String(entry.version ?? '');

      if (version.startsWith('npm:')) {
        const alias = splitSpec(version.slice('npm:'.length));
        packages.add(alias.name, alias.rest, entry.dev === true);
      } else {
        packages.add(name, version, entry.dev === true);
      }

      walk(entry.dependencies);
    }
  };

  walk(lock.dependencies);
}

function parseYarnLock(lock: Tree, packages: Packages): void {
  const berry = '__metadata' in lock;

  for (const [key, entry] of Object.entries(lock)) {
    if (typeof entry === 'string' || key === '__metadata') {
      continue;
    }

    const version = asString(entry.version);

    if (berry) {
      // Workspaces, link: and portal: entries are the project's own code.
      if (entry.linkType === 'soft') {
        continue;
      }
      // `resolution` names the real package, also behind an alias or a patch.
      packages.add(splitSpec(asString(entry.resolution)).name, version, false);
      continue;
    }

    // v1: the key lists every range resolved to this entry, `a@^1, a@^1.2`.
    const spec = splitSpec(unquote(key.split(/,\s*/)[0]));
    const name = spec.rest.startsWith('npm:')
      ? splitSpec(spec.rest.slice('npm:'.length)).name
      : spec.name;
    packages.add(name, version, false);
  }
}

function parsePnpmLock(lock: Tree, packages: Packages): void {
  const lockfileVersion = parseFloat(asString(lock.lockfileVersion));
  const entries = asTree(lock.packages);
  // 9.0 dropped the `dev` flag, so what production code reaches is worked out
  // from the importers through the snapshots.
  const production = lockfileVersion >= 9 ? reachableFromImporters(lock) : null;

  for (const [key, value] of Object.entries(entries)) {
    const entry = asTree(value);
    let name = asString(entry.name);
    let version = asString(entry.version);

    if (!name || !version) {
      // Peer suffixes: `(react@18.2.0)` since 6.0, `_react@18.2.0` before.
      const path = key.replace(/^\//, '').replace(/\(.*$/, '');

      if (lockfileVersion < 6) {
        const segments = path.split('/');
        const scoped = segments[0].startsWith('@');
        name = scoped ? `${segments[0]}/${segments[1]}` : segments[0];
        version = (segments[scoped ? 2 : 1] ?? '').replace(/_.*$/, '');
      } else {
        ({ name, rest: version } = splitSpec(path));
      }
    }

    const dev = production ? !production.has(key.replace(/\(.*$/, '')) : entry.dev === 'true';
    packages.add(name, version, dev);
  }
}

/** Keys of `packages:` that a production dependency of any importer leads to. */
function reachableFromImporters(lock: Tree): Set<string> {
  const snapshots = asTree(lock.snapshots);
  const reached = new Set<string>();
  const queue: string[] = [];

  const visit = (name: string, version: string): void => {
    // A version is a plain one, an alias such as `string-width@4.2.3`, or a
    // `link:` to a workspace, which is not a package.
    if (version.startsWith('link:')) {
      return;
    }
    const key = /^\d/.test(version) ? `${name}@${version}` : version;
    if (!reached.has(key)) {
      reached.add(key);
      queue.push(key);
    }
  };

  for (const importer of Object.values(asTree(lock.importers))) {
    for (const section of ['dependencies', 'optionalDependencies']) {
      for (const [name, dependency] of Object.entries(asTree(asTree(importer)[section]))) {
        visit(name, asString(asTree(dependency).version));
      }
    }
  }

  while (queue.length > 0) {
    const snapshot = asTree(snapshots[queue.shift() as string]);
    for (const section of ['dependencies', 'optionalDependencies']) {
      for (const [name, version] of Object.entries(asTree(snapshot[section]))) {
        visit(name, asString(version));
      }
    }
  }

  return new Set([...reached].map((key) => key.replace(/\(.*$/, '')));
}

type Tree = { [key: string]: string | Tree };

function asTree(value: string | Tree | undefined): Tree {
  return value && typeof value === 'object' ? value : {};
}

function asString(value: string | Tree | undefined): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Reads the block mappings that yarn.lock (both formats) and pnpm-lock.yaml are
 * made of, by indentation: `key:` opens a mapping, `key: value` (YAML) and
 * `key value` (yarn v1) set a scalar. Flow collections such as
 * `{integrity: ...}` stay strings; nothing here needs to look inside them.
 */
export function parseIndented(source: string): Tree {
  const root: Tree = {};
  const stack: { indent: number; node: Tree }[] = [{ indent: -1, node: root }];

  for (const raw of source.split(/\r?\n/)) {
    const content = raw.trim();
    if (content === '' || content.startsWith('#')) {
      continue;
    }

    const indent = raw.length - raw.trimStart().length;
    while (stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].node;
    const { key, value } = splitLine(content);

    if (value === null) {
      const child: Tree = {};
      parent[key] = child;
      stack.push({ indent, node: child });
    } else {
      parent[key] = value;
    }
  }

  return root;
}

function splitLine(line: string): { key: string; value: string | null } {
  let quote: string | null = null;
  let space = -1;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (quote) {
      if (char === '\\' && quote === '"') {
        i++;
      } else if (char === quote) {
        quote = null;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ':' && (i === line.length - 1 || line[i + 1] === ' ')) {
      const value = line.slice(i + 1).trim();
      return { key: unquote(line.slice(0, i)), value: value === '' ? null : unquote(value) };
    } else if (char === ' ' && space === -1) {
      space = i;
    }
  }

  return space === -1
    ? { key: unquote(line), value: '' }
    : { key: unquote(line.slice(0, space)), value: unquote(line.slice(space + 1).trim()) };
}

/** Strips the quotes around a whole scalar; anything else is returned as is. */
function unquote(value: string): string {
  const text = value.trim();

  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }

  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {
      // Several quoted strings, such as yarn v1's `"a@^1", "a@^1.2"`.
      return text;
    }
  }

  return text;
}
