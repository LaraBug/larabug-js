import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { listSourceMaps, parseCredentials, uploadSourceMaps, UploadOptions } from '../src';
import { deadHost, LaraBugServer } from './support/larabug-server';

const map = JSON.stringify({
  version: 3,
  file: 'app-D4wpJuT4.js',
  sources: ['app.js'],
  names: [],
  mappings: 'AAAA',
});

let server: LaraBugServer;
let dir: string;
let sleeps: number[];

function mapFile(name: string, content = map): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

function options(overrides: Partial<UploadOptions> = {}): UploadOptions {
  return {
    credentials: parseCredentials('lbi_abc123'),
    release: 'abc123',
    host: server.host,
    retryDelay: 10,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...overrides,
  };
}

beforeEach(async () => {
  server = await new LaraBugServer().start();
  dir = mkdtempSync(join(tmpdir(), 'larabug-upload-'));
  sleeps = [];
});

afterEach(async () => {
  await server.stop();
});

describe('an upload', () => {
  it('posts the release, the minified URL and the map as multipart form data', async () => {
    const path = mapFile('app-D4wpJuT4.js.map');

    const report = await uploadSourceMaps(
      [{ sourcemapPath: path, minifiedUrl: '~/build/assets/app-D4wpJuT4.js' }],
      options()
    );

    expect(report.ok).toBe(true);
    expect(report.endpoint).toBe(`${server.host}/api/sourcemaps`);
    expect(server.requests).toHaveLength(1);

    const [request] = server.requests;
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/api/sourcemaps');
    expect(request.headers['x-larabug-ingest-key']).toBe('lbi_abc123');
    expect(request.headers.authorization).toBeUndefined();
    expect(request.headers.accept).toBe('application/json');
    expect(request.fields).toEqual({
      release: 'abc123',
      minified_url: '~/build/assets/app-D4wpJuT4.js',
    });
    expect(request.sourcemap).toEqual({
      filename: 'app-D4wpJuT4.js.map',
      type: 'application/json',
      content: map,
    });
  });

  it('sends dist only when there is one', async () => {
    await uploadSourceMaps(
      [{ sourcemapPath: mapFile('a.js.map'), minifiedUrl: '~/a.js' }],
      options({ dist: 'web' })
    );

    expect(server.requests[0].fields.dist).toBe('web');
  });

  it('authenticates a legacy DSN with its bearer token and names the project', async () => {
    const credentials = parseCredentials(
      `http://login-token:project-key@${server.host.slice('http://'.length)}/api/log`
    );

    await uploadSourceMaps(
      [{ sourcemapPath: mapFile('a.js.map'), minifiedUrl: '~/a.js' }],
      options({ credentials, host: undefined })
    );

    const [request] = server.requests;
    expect(request.headers.authorization).toBe('Bearer login-token');
    expect(request.headers['x-larabug-ingest-key']).toBeUndefined();
    expect(request.fields.project).toBe('project-key');
  });

  it('tells a created map from a replaced one', async () => {
    server.respondWith({ status: 201 }, { status: 200 });

    const report = await uploadSourceMaps(
      [
        { sourcemapPath: mapFile('a.js.map'), minifiedUrl: '~/a.js' },
        { sourcemapPath: mapFile('b.js.map'), minifiedUrl: '~/b.js' },
      ],
      options({ concurrency: 1 })
    );

    expect(report.results.map((result) => result.outcome)).toEqual(['created', 'replaced']);
    expect(report.uploaded).toBe(2);
  });
});

describe('retries', () => {
  it('back off exponentially through server errors', async () => {
    server.respondWith({ status: 503 }, { status: 500 }, { status: 201 });

    const report = await uploadSourceMaps(
      [{ sourcemapPath: mapFile('a.js.map'), minifiedUrl: '~/a.js' }],
      options()
    );

    expect(report.ok).toBe(true);
    expect(report.results[0].attempts).toBe(3);
    expect(server.requests).toHaveLength(3);
    expect(sleeps).toEqual([10, 20]);
  });

  it('wait as long as a 429 asks', async () => {
    server.respondWith({ status: 429, headers: { 'retry-after': '2' } }, { status: 201 });

    await uploadSourceMaps(
      [{ sourcemapPath: mapFile('a.js.map'), minifiedUrl: '~/a.js' }],
      options()
    );

    expect(sleeps).toEqual([2000]);
  });

  it('give up after the configured number', async () => {
    server.respondWith({ status: 502 }, { status: 502 }, { status: 502 });

    const report = await uploadSourceMaps(
      [{ sourcemapPath: mapFile('a.js.map'), minifiedUrl: '~/a.js' }],
      options({ retries: 2 })
    );

    expect(report.ok).toBe(false);
    expect(report.results[0]).toMatchObject({ outcome: 'failed', status: 502, attempts: 3 });
    expect(server.requests).toHaveLength(3);
  });

  it('cover a host that cannot be reached', async () => {
    const report = await uploadSourceMaps(
      [{ sourcemapPath: mapFile('a.js.map'), minifiedUrl: '~/a.js' }],
      options({ host: await deadHost(), retries: 1 })
    );

    expect(report.results[0]).toMatchObject({ outcome: 'failed', attempts: 2 });
    expect(report.results[0].error).toBeTruthy();
    expect(sleeps).toEqual([10]);
  });

  it.each([
    [413, 'larger than LaraBug accepts'],
    [422, 'invalid'],
  ])('are not made for a %i', async (status, reason) => {
    server.respondWith({ status, body: { message: 'server says no' } });

    const report = await uploadSourceMaps(
      [{ sourcemapPath: mapFile('a.js.map'), minifiedUrl: '~/a.js' }],
      options()
    );

    expect(server.requests).toHaveLength(1);
    expect(report.results[0].status).toBe(status);
    expect(report.results[0].error).toContain(reason);
    expect(report.results[0].error).toContain('server says no');
  });
});

describe('a refused key', () => {
  it('stops the remaining uploads', async () => {
    server.respondWith({ status: 401, body: { error: 'Invalid ingest key.' } });

    const report = await uploadSourceMaps(
      ['a', 'b', 'c'].map((name) => ({
        sourcemapPath: mapFile(`${name}.js.map`),
        minifiedUrl: `~/${name}.js`,
      })),
      options({ concurrency: 1 })
    );

    expect(server.requests).toHaveLength(1);
    expect(report.failed).toBe(3);
    expect(report.results[2]).toMatchObject({ outcome: 'failed', attempts: 0 });
    expect(report.results[2].error).toContain('Invalid ingest key.');
  });
});

describe('a file that is not a source map', () => {
  it('is reported without being sent', async () => {
    const report = await uploadSourceMaps(
      [{ sourcemapPath: mapFile('a.js.map', '<html>'), minifiedUrl: '~/a.js' }],
      options()
    );

    expect(server.requests).toHaveLength(0);
    expect(report.results[0].error).toContain('not a source map');
  });
});

describe('a dry run', () => {
  it('sends nothing and reports what would have gone', async () => {
    const report = await uploadSourceMaps(
      [{ sourcemapPath: mapFile('a.js.map'), minifiedUrl: '~/a.js' }],
      options({ dryRun: true })
    );

    expect(server.requests).toHaveLength(0);
    expect(report.ok).toBe(true);
    expect(report.results[0].outcome).toBe('dry-run');
  });
});

describe('listing a release', () => {
  it('asks the releases endpoint with the same credentials', async () => {
    server.respondWith({ status: 200, body: { data: [{ minified_url: '~/a.js' }] } });

    const body = await listSourceMaps('abc 123', {
      credentials: parseCredentials('lbi_abc123'),
      host: server.host,
    });

    expect(body).toEqual({ data: [{ minified_url: '~/a.js' }] });
    expect(server.requests[0]).toMatchObject({
      method: 'GET',
      path: '/api/sourcemaps/releases/abc%20123',
    });
    expect(server.requests[0].headers['x-larabug-ingest-key']).toBe('lbi_abc123');
  });
});
