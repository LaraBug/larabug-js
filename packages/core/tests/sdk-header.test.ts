import { BaseLaraBugClient, SDK_HEADER, SDK_VERSION, sdkHeaderValue, sdkToken } from '../src';
import { readFileSync } from 'fs';
import { join } from 'path';

const coreVersion = (
  JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8')) as { version: string }
).version;

let fetchMock: jest.Mock;

function headerSent(call = 0): string {
  return fetchMock.mock.calls[call][1].headers[SDK_HEADER];
}

beforeEach(() => {
  fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  (globalThis as any).fetch = fetchMock;
});

afterEach(() => {
  delete (globalThis as any).fetch;
});

describe('the SDK version', () => {
  it('is the version of @larabug/core', () => {
    expect(SDK_VERSION).toBe(coreVersion);
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('the X-LaraBug-Sdk header, in Node', () => {
  it('names the SDK, its version and the runtime on every report', () => {
    const client = new BaseLaraBugClient({ ingest_key: 'lbi_abc123', transport: { retries: 1 } });

    client.captureException(new Error('first'));
    client.captureMessage('second');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(headerSent(0)).toBe(`larabug-js/${coreVersion} node`);
    expect(headerSent(1)).toBe(`larabug-js/${coreVersion} node`);
  });

  it('is sent alongside the credentials, with a login key too', () => {
    new BaseLaraBugClient({ login_key: 'login', project_key: 'project' }).captureMessage('hi');

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe('Bearer login');
    expect(headers[SDK_HEADER]).toMatch(/^larabug-js\/\d+\.\d+\.\d+\S* node$/);
  });

  it('ends with the framework a framework package named', () => {
    const client = new BaseLaraBugClient({ ingest_key: 'lbi_abc123' });
    client.setFramework('vue', '3.5.13');

    client.captureMessage('hi');

    expect(headerSent()).toBe(`larabug-js/${SDK_VERSION} node vue/3.5.13`);
  });

  it('keeps only the last framework named', () => {
    const client = new BaseLaraBugClient({ ingest_key: 'lbi_abc123' });
    client.setFramework('vue', '3.5.13');
    client.setFramework('inertia');

    client.captureMessage('hi');

    expect(headerSent()).toBe(`larabug-js/${SDK_VERSION} node inertia`);
  });

  it('cannot be broken by a framework version with spaces or line breaks', () => {
    const client = new BaseLaraBugClient({ ingest_key: 'lbi_abc123' });
    client.setFramework('vue', '3.5.13\r\nX-Evil: 1 ');

    client.captureMessage('hi');

    expect(headerSent()).toBe(`larabug-js/${SDK_VERSION} node vue/3.5.13X-Evil1`);
  });
});

describe('sdkHeaderValue', () => {
  it('is space separated product tokens', () => {
    expect(sdkHeaderValue('browser', sdkToken('react', '18.3.1'))).toBe(
      `larabug-js/${SDK_VERSION} browser react/18.3.1`
    );
    expect(sdkHeaderValue('node')).toBe(`larabug-js/${SDK_VERSION} node`);
  });
});
