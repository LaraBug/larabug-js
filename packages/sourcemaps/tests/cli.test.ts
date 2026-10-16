import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { run } from '../src/cli';
import { Logger } from '../src';
import { LaraBugServer } from './support/larabug-server';

const map = JSON.stringify({ version: 3, sources: ['app.js'], names: [], mappings: 'AAAA' });

let server: LaraBugServer;
let cwd: string;
let messages: string[];

const logger: Logger = {
  info: (message) => messages.push(`info: ${message}`),
  warn: (message) => messages.push(`warn: ${message}`),
  error: (message) => messages.push(`error: ${message}`),
};

beforeEach(async () => {
  server = await new LaraBugServer().start();
  messages = [];

  // A Laravel app after `vite build`.
  cwd = mkdtempSync(join(tmpdir(), 'larabug-cli-'));
  mkdirSync(join(cwd, 'public/build/assets'), { recursive: true });
  writeFileSync(join(cwd, 'public/build/assets/app-D4wpJuT4.js'), 'console.log(1)');
  writeFileSync(join(cwd, 'public/build/assets/app-D4wpJuT4.js.map'), map);
  writeFileSync(join(cwd, '.env'), 'LARABUG_KEY=lbi_from_env\n');
});

afterEach(async () => {
  await server.stop();
});

function cli(...args: string[]): Promise<number> {
  return run(args, { cwd, logger });
}

describe('larabug-sourcemaps upload', () => {
  it('uploads every map under --dir with the URL prefix in front', async () => {
    const code = await cli(
      'upload',
      '--release',
      'v1',
      '--dir',
      'public/build',
      '--url-prefix',
      '~/build',
      '--host',
      server.host
    );

    expect(code).toBe(0);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].headers['x-larabug-ingest-key']).toBe('lbi_from_env');
    expect(server.requests[0].fields).toEqual({
      release: 'v1',
      minified_url: '~/build/assets/app-D4wpJuT4.js',
    });
    expect(existsSync(join(cwd, 'public/build/assets/app-D4wpJuT4.js.map'))).toBe(true);
  });

  it('removes the maps when asked', async () => {
    await cli(
      'upload',
      '--release',
      'v1',
      '--dir',
      'public/build',
      '--host',
      server.host,
      '--remove-source-maps'
    );

    expect(existsSync(join(cwd, 'public/build/assets/app-D4wpJuT4.js.map'))).toBe(false);
  });

  it('exits non-zero when an upload fails', async () => {
    server.respondWith({ status: 422 });

    const code = await cli(
      'upload',
      '--release',
      'v1',
      '--dir',
      'public/build',
      '--host',
      server.host
    );

    expect(code).toBe(1);
    expect(messages.some((message) => message.startsWith('error:'))).toBe(true);
  });

  it('sends nothing on a dry run, even without a key', async () => {
    writeFileSync(join(cwd, '.env'), '');

    const code = await cli(
      'upload',
      '--release',
      'v1',
      '--dir',
      'public/build',
      '--host',
      server.host,
      '--dry-run'
    );

    expect(code).toBe(0);
    expect(server.requests).toHaveLength(0);
    expect(messages).toContain('info: would upload ~/assets/app-D4wpJuT4.js');
  });

  it('refuses to run without a key', async () => {
    writeFileSync(join(cwd, '.env'), '');

    expect(
      await cli('upload', '--release', 'v1', '--dir', 'public/build', '--host', server.host)
    ).toBe(1);
    expect(server.requests).toHaveLength(0);
  });

  it('needs --dir', async () => {
    expect(await cli('upload', '--release', 'v1', '--host', server.host)).toBe(2);
  });
});

describe('larabug-sourcemaps list', () => {
  it('asks for the release', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    server.respondWith({ status: 200, body: { data: [] } });

    expect(await cli('list', '--release', 'v1', '--host', server.host)).toBe(0);
    expect(server.requests[0].path).toBe('/api/sourcemaps/releases/v1');

    log.mockRestore();
  });
});
