import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { larabug, LaraBugViteOptions, RELEASE_PLACEHOLDER } from '../src';
import { LaraBugServer } from '../../sourcemaps/tests/support/larabug-server';

const map = JSON.stringify({ version: 3, sources: ['app.js'], names: [], mappings: 'AAAA' });

let server: LaraBugServer;
let root: string;
let outDir: string;
let logs: string[];

type Plugin = ReturnType<typeof larabug>;
type UserConfig = {
  define?: Record<string, string>;
  build?: { sourcemap?: boolean | 'hidden' | 'inline'; ssr?: string | boolean };
};

type Bundle = Record<
  string,
  { type: 'chunk' | 'asset'; fileName: string; code?: string; source?: string }
>;

function handler(hook: unknown): (...args: any[]) => any {
  return typeof hook === 'function' ? (hook as any) : (hook as { handler: any }).handler;
}

/** Runs the plugin through the hooks Vite calls for one build. */
async function buildWith(
  options: LaraBugViteOptions,
  {
    userConfig = {},
    base = '/build/',
    files = ['assets/app-D4wpJuT4.js', 'assets/vendor-B9x8.js'],
    environment,
    contextError = (message: string) => {
      throw new Error(message);
    },
  }: {
    userConfig?: UserConfig;
    base?: string;
    files?: string[];
    environment?: { name: string; config: { consumer: string } };
    contextError?: (message: string) => never;
  } = {}
): Promise<{ plugin: Plugin; returnedConfig: UserConfig; bundle: Bundle }> {
  const plugin = larabug({ host: server.host, ...options });
  const returnedConfig = await handler(plugin.config)(
    { root, ...userConfig },
    { command: 'build', mode: 'production' }
  );

  handler(plugin.configResolved)({
    base,
    build: {
      outDir,
      ssr: userConfig.build?.ssr ?? false,
      sourcemap: userConfig.build?.sourcemap ?? returnedConfig.build?.sourcemap,
    },
    logger: {
      info: (message: string) => logs.push(`info ${message}`),
      warn: (message: string) => logs.push(`warn ${message}`),
      error: (message: string) => logs.push(`error ${message}`),
    },
  });

  const bundle: Bundle = {};
  for (const file of files) {
    mkdirSync(join(outDir, file, '..'), { recursive: true });
    writeFileSync(join(outDir, file), 'code');
    writeFileSync(join(outDir, `${file}.map`), map);
    bundle[file] = { type: 'chunk', fileName: file, code: 'code' };
    bundle[`${file}.map`] = { type: 'asset', fileName: `${file}.map`, source: map };
  }

  const context = { environment, error: contextError };
  handler(plugin.generateBundle).call(context, {}, bundle);
  await handler(plugin.writeBundle).call(context, { dir: outDir }, bundle);

  return { plugin, returnedConfig, bundle };
}

beforeEach(async () => {
  server = await new LaraBugServer().start();
  root = mkdtempSync(join(tmpdir(), 'larabug-vite-'));
  outDir = join(root, 'public/build');
  logs = [];
});

afterEach(async () => {
  await server.stop();
});

describe('the release', () => {
  it('is injected as __LARABUG_RELEASE__ and import.meta.env.VITE_LARABUG_RELEASE', async () => {
    const { returnedConfig } = await buildWith({ key: 'lbi_abc', release: 'v1.2.3' });

    expect(returnedConfig.define).toEqual({
      __LARABUG_RELEASE__: '"v1.2.3"',
      'import.meta.env.VITE_LARABUG_RELEASE': '"v1.2.3"',
    });
  });

  it('comes from LARABUG_RELEASE in .env when no option sets it', async () => {
    writeFileSync(join(root, '.env'), 'LARABUG_RELEASE=from-dotenv\n');

    const { returnedConfig } = await buildWith({ key: 'lbi_abc' });

    expect(returnedConfig.define?.__LARABUG_RELEASE__).toBe('"from-dotenv"');
  });

  it('is the git commit inside a checkout', async () => {
    const plugin = larabug();
    const returned = handler(plugin.config)(
      { root: resolve(__dirname, '..') },
      { command: 'build', mode: 'production' }
    );

    expect(returned.define.__LARABUG_RELEASE__).toMatch(/^"[0-9a-f]{40}"$/);
  });

  it('falls back to a placeholder that the build replaces with a release of the same length', async () => {
    const plugin = larabug();
    const returned = handler(plugin.config)({ root }, { command: 'build', mode: 'production' });
    expect(returned.define.__LARABUG_RELEASE__).toBe(JSON.stringify(RELEASE_PLACEHOLDER));

    const bundle: Bundle = {
      'assets/app.js': {
        type: 'chunk',
        fileName: 'assets/app.js',
        code: `a("${RELEASE_PLACEHOLDER}");b("${RELEASE_PLACEHOLDER}")`,
      },
    };
    handler(plugin.generateBundle).call({ error: () => undefined }, {}, bundle);

    const code = bundle['assets/app.js'].code as string;
    const release = code.slice(3, 3 + RELEASE_PLACEHOLDER.length);
    expect(release).toMatch(/^\d{14}-[0-9a-f]{12}$/);
    expect(code).toBe(`a("${release}");b("${release}")`);
  });
});

describe('source maps', () => {
  it('are switched to hidden when the app has not configured them', async () => {
    const { returnedConfig } = await buildWith({ key: 'lbi_abc', release: 'v1' });

    expect(returnedConfig.build).toEqual({ sourcemap: 'hidden' });
  });

  it('are left as configured', async () => {
    const { returnedConfig } = await buildWith(
      { key: 'lbi_abc', release: 'v1' },
      { userConfig: { build: { sourcemap: true } } }
    );

    expect(returnedConfig.build).toEqual({});
  });

  it('come with a warning when they are turned off', async () => {
    await buildWith(
      { key: 'lbi_abc', release: 'v1' },
      { userConfig: { build: { sourcemap: false } }, files: [] }
    );

    expect(
      logs.some((line) => line.startsWith('warn') && line.includes('build.sourcemap is false'))
    ).toBe(true);
  });
});

describe('the upload', () => {
  it("sends every map with its release and a ~/ URL under Vite's base", async () => {
    await buildWith({ key: 'lbi_abc', release: 'v1' });

    expect(server.requests.map((request) => request.fields)).toEqual(
      expect.arrayContaining([
        { release: 'v1', minified_url: '~/build/assets/app-D4wpJuT4.js' },
        { release: 'v1', minified_url: '~/build/assets/vendor-B9x8.js' },
      ])
    );
    expect(server.requests[0].headers['x-larabug-ingest-key']).toBe('lbi_abc');
    expect(server.requests[0].sourcemap?.content).toBe(map);
  });

  it("uses a full URL when Vite's base is one", async () => {
    await buildWith(
      { key: 'lbi_abc', release: 'v1' },
      { base: 'https://cdn.test/build/', files: ['assets/app.js'] }
    );

    expect(server.requests[0].fields.minified_url).toBe('https://cdn.test/build/assets/app.js');
  });

  it("uses the base option over Vite's", async () => {
    await buildWith(
      { key: 'lbi_abc', release: 'v1', base: '/static/' },
      { files: ['assets/app.js'] }
    );

    expect(server.requests[0].fields.minified_url).toBe('~/static/assets/app.js');
  });

  it('honours include and exclude', async () => {
    await buildWith({ key: 'lbi_abc', release: 'v1', exclude: 'assets/vendor-*.js' });

    expect(server.requests.map((request) => request.fields.minified_url)).toEqual([
      '~/build/assets/app-D4wpJuT4.js',
    ]);
  });

  it('reads the key from VITE_LARABUG_DSN, host included', async () => {
    writeFileSync(
      join(root, '.env'),
      `VITE_LARABUG_DSN=${server.host.replace('://', '://lbi_from_dsn:project@')}/api/log\n`
    );

    const plugin = larabug({ release: 'v1' });
    handler(plugin.config)({ root }, { command: 'build', mode: 'production' });
    handler(plugin.configResolved)({
      base: '/build/',
      build: { outDir },
      logger: { info() {}, warn() {}, error() {} },
    });
    mkdirSync(join(outDir, 'assets'), { recursive: true });
    writeFileSync(join(outDir, 'assets/app.js.map'), map);
    await handler(plugin.writeBundle).call(
      {},
      { dir: outDir },
      { 'assets/app.js': { type: 'chunk', fileName: 'assets/app.js' } }
    );

    expect(server.requests[0].headers['x-larabug-ingest-key']).toBe('lbi_from_dsn');
    expect(server.requests[0].fields.project).toBe('project');
  });

  it('skips the server bundle of an SSR build', async () => {
    await buildWith(
      { key: 'lbi_abc', release: 'v1' },
      { environment: { name: 'ssr', config: { consumer: 'server' } } }
    );

    expect(server.requests).toHaveLength(0);
    expect(existsSync(join(outDir, 'assets/app-D4wpJuT4.js.map'))).toBe(true);
  });

  it('does not switch on source maps for an SSR build', async () => {
    const { returnedConfig } = await buildWith(
      { key: 'lbi_abc', release: 'v1' },
      { userConfig: { build: { ssr: 'resources/js/ssr.js' } }, files: [] }
    );

    expect(returnedConfig.build).toEqual({});
  });
});

describe('removing the maps', () => {
  it('happens after the upload by default', async () => {
    await buildWith({ key: 'lbi_abc', release: 'v1' });

    expect(server.requests).toHaveLength(2);
    expect(existsSync(join(outDir, 'assets/app-D4wpJuT4.js.map'))).toBe(false);
    expect(existsSync(join(outDir, 'assets/app-D4wpJuT4.js'))).toBe(true);
  });

  it('happens even when the upload failed', async () => {
    server.respondWith(
      { status: 500 },
      { status: 500 },
      { status: 500 },
      { status: 500 },
      { status: 500 }
    );

    await buildWith({ key: 'lbi_abc', release: 'v1', retries: 0 });

    expect(existsSync(join(outDir, 'assets/app-D4wpJuT4.js.map'))).toBe(false);
  });

  it('can be turned off', async () => {
    await buildWith({ key: 'lbi_abc', release: 'v1', removeSourceMaps: false });

    expect(existsSync(join(outDir, 'assets/app-D4wpJuT4.js.map'))).toBe(true);
  });
});

describe('a failed upload', () => {
  it('does not fail the build by default', async () => {
    server.respondWith({ status: 422 }, { status: 422 });

    await expect(buildWith({ key: 'lbi_abc', release: 'v1' })).resolves.toBeDefined();
    expect(logs.some((line) => line.startsWith('error') && line.includes('failed to upload'))).toBe(
      true
    );
  });

  it('fails the build with failOnError', async () => {
    server.respondWith({ status: 422 }, { status: 422 });

    await expect(buildWith({ key: 'lbi_abc', release: 'v1', failOnError: true })).rejects.toThrow(
      'failed to upload'
    );
    expect(existsSync(join(outDir, 'assets/app-D4wpJuT4.js.map'))).toBe(false);
  });

  it('includes a missing key', async () => {
    await expect(buildWith({ release: 'v1', failOnError: true })).rejects.toThrow('No LaraBug key');
    await expect(buildWith({ release: 'v1' })).resolves.toBeDefined();
  });
});

describe('a dry run', () => {
  it('sends nothing and lists what it would have sent', async () => {
    await buildWith({ key: 'lbi_abc', release: 'v1', dryRun: true });

    expect(server.requests).toHaveLength(0);
    expect(logs).toContain('info [larabug] would upload ~/build/assets/app-D4wpJuT4.js');
  });
});

describe('silent', () => {
  it('prints errors only', async () => {
    server.respondWith({ status: 422 });

    await buildWith({ key: 'lbi_abc', release: 'v1', silent: true }, { files: ['assets/app.js'] });

    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((line) => line.startsWith('error'))).toBe(true);
  });
});
