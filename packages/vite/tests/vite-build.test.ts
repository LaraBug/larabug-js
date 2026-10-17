import { execFile, execSync } from 'child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { LaraBugServer } from '../../sourcemaps/tests/support/larabug-server';

/**
 * Real `vite build`s of a Laravel app, with laravel-vite-plugin, against a
 * stand-in LaraBug host on 127.0.0.1.
 */

const packages = resolve(__dirname, '../..');
const buildScript = join(__dirname, 'support/build.mjs');
const pluginEntry = join(packages, 'vite/dist/index.mjs');

let server: LaraBugServer;
let app: string;

function laravelApp(): string {
  const root = mkdtempSync(join(tmpdir(), 'larabug-laravel-'));
  const write = (path: string, content: string) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  };

  write('package.json', '{"name":"app","private":true,"type":"module"}');
  // A dependency reading the release the way @larabug/core does, from a real
  // node_modules directory, which is where the SDK lives in an app.
  write(
    'node_modules/sdk/package.json',
    '{"name":"sdk","version":"1.0.0","type":"module","main":"index.js"}'
  );
  write(
    'node_modules/sdk/index.js',
    'export function release() { return typeof __LARABUG_RELEASE__ === "string" ? __LARABUG_RELEASE__ : "none"; }'
  );
  write(
    'resources/js/app.js',
    [
      'import { release } from "sdk";',
      'export function save() { throw new Error("from " + release() + " " + import.meta.env.VITE_LARABUG_RELEASE); }',
      'window.save = save;',
      'import("./pages/dashboard.js").then((page) => page.mount());',
    ].join('\n')
  );
  write('resources/js/pages/dashboard.js', 'export function mount() { return document.title; }');
  write('resources/js/ssr.js', 'export default () => import.meta.env.VITE_LARABUG_RELEASE;');

  return root;
}

function viteBuild(
  options: Record<string, unknown>,
  env: Record<string, string>,
  ssr = false
): Promise<string> {
  const childEnv: Record<string, string | undefined> = { ...process.env, ...env };
  for (const name of [
    'LARABUG_KEY',
    'LARABUG_DSN',
    'VITE_LARABUG_DSN',
    'GITHUB_SHA',
    'CI_COMMIT_SHA',
  ]) {
    if (!(name in env)) {
      delete childEnv[name];
    }
  }
  if (!('LARABUG_RELEASE' in env)) {
    delete childEnv.LARABUG_RELEASE;
  }

  return new Promise((resolvePromise, reject) => {
    execFile(
      process.execPath,
      [buildScript, pluginEntry, JSON.stringify(options), ssr ? 'ssr' : ''],
      { cwd: app, env: childEnv },
      (error, stdout, stderr) =>
        error
          ? reject(new Error(`${error.message}\n${stdout}\n${stderr}`))
          : resolvePromise(stdout + stderr)
    );
  });
}

function filesIn(dir: string): string[] {
  return readdirSync(join(app, dir), { recursive: true }).map(String).sort();
}

function manifest(): Record<string, { file: string }> {
  return JSON.parse(readFileSync(join(app, 'public/build/manifest.json'), 'utf8'));
}

beforeAll(() => {
  execSync('npx rollup -c --silent', { cwd: join(packages, 'sourcemaps'), stdio: 'ignore' });
  execSync('npx rollup -c --silent', { cwd: join(packages, 'vite'), stdio: 'ignore' });
}, 120000);

beforeEach(async () => {
  server = await new LaraBugServer().start();
  app = laravelApp();
});

afterEach(async () => {
  await server.stop();
});

jest.setTimeout(60000);

describe('vite build with laravel-vite-plugin', () => {
  it('uploads a map for every chunk under /build/, then removes them all', async () => {
    await viteBuild(
      {},
      { LARABUG_KEY: 'lbi_e2e', LARABUG_HOST: server.host, LARABUG_RELEASE: 'e2e-release' }
    );

    const entry = manifest()['resources/js/app.js'].file;
    expect(entry).toMatch(/^assets\/app-[\w-]+\.js$/);

    const uploaded = server.requests.map((request) => request.fields.minified_url).sort();
    expect(uploaded).toHaveLength(2);
    expect(uploaded).toContain(`~/build/${entry}`);
    expect(uploaded.some((url) => /^~\/build\/assets\/dashboard-[\w-]+\.js$/.test(url))).toBe(true);

    for (const request of server.requests) {
      expect(request.path).toBe('/api/sourcemaps');
      expect(request.headers['x-larabug-ingest-key']).toBe('lbi_e2e');
      expect(request.fields.release).toBe('e2e-release');
      expect(JSON.parse(request.sourcemap!.content).mappings).toEqual(expect.any(String));
    }

    const appMap = server.requests.find(
      (request) => request.fields.minified_url === `~/build/${entry}`
    )!;
    expect(JSON.parse(appMap.sourcemap!.content).sources).toEqual(
      expect.arrayContaining([expect.stringContaining('resources/js/app.js')])
    );

    expect(filesIn('public/build').filter((file) => file.endsWith('.map'))).toEqual([]);

    const code = readFileSync(join(app, 'public/build', entry), 'utf8');
    expect(code).not.toContain('sourceMappingURL');
    // Once from the dependency, once from import.meta.env.
    expect(code.split('e2e-release').length - 1).toBe(2);
  });

  it('stamps the bundle with a fallback release when there is no commit, and uploads under it', async () => {
    await viteBuild({}, { LARABUG_KEY: 'lbi_e2e', LARABUG_HOST: server.host });

    const release = server.requests[0].fields.release;
    expect(release).toMatch(/^\d{14}-[0-9a-f]{12}$/);
    expect(new Set(server.requests.map((request) => request.fields.release))).toEqual(
      new Set([release])
    );

    const code = readFileSync(
      join(app, 'public/build', manifest()['resources/js/app.js'].file),
      'utf8'
    );
    expect(code).toContain(release);
    expect(code).not.toContain('__larabug_release_pending__');
  });

  // An SSR build leaves node_modules external, so only app code sees the define.
  it('uploads nothing for the SSR bundle, which still carries the release', async () => {
    await viteBuild(
      {},
      { LARABUG_KEY: 'lbi_e2e', LARABUG_HOST: server.host, LARABUG_RELEASE: 'e2e-release' },
      true
    );

    expect(server.requests).toHaveLength(0);
    expect(filesIn('bootstrap/ssr').filter((file) => file.endsWith('.map'))).toEqual([]);
    expect(readFileSync(join(app, 'bootstrap/ssr/ssr.js'), 'utf8')).toContain('e2e-release');
  });

  it('does not fail the build when LaraBug cannot be reached', async () => {
    const output = await viteBuild(
      { retries: 0 },
      { LARABUG_KEY: 'lbi_e2e', LARABUG_HOST: 'http://127.0.0.1:9', LARABUG_RELEASE: 'e2e-release' }
    );

    expect(output).toContain('failed to upload');
    expect(filesIn('public/build').filter((file) => file.endsWith('.map'))).toEqual([]);
  });

  it('fails the build when LaraBug cannot be reached and failOnError is set', async () => {
    await expect(
      viteBuild(
        { retries: 0, failOnError: true },
        {
          LARABUG_KEY: 'lbi_e2e',
          LARABUG_HOST: 'http://127.0.0.1:9',
          LARABUG_RELEASE: 'e2e-release',
        }
      )
    ).rejects.toThrow('failed to upload');
  });
});
