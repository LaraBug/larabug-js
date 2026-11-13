/**
 * @jest-environment jsdom
 */
import { init, SDK_HEADER } from '../src';
import { readFileSync } from 'fs';
import { join } from 'path';

const coreVersion = (
  JSON.parse(readFileSync(join(__dirname, '../../core/package.json'), 'utf8')) as {
    version: string;
  }
).version;

let fetchMock: jest.Mock;
const originalFetch = window.fetch;

function response(status: number) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null } };
}

function headersSent(): string[] {
  return fetchMock.mock.calls.map(([, request]) => request.headers[SDK_HEADER]);
}

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  fetchMock = jest.fn().mockResolvedValue(response(200));
  window.fetch = fetchMock as unknown as typeof window.fetch;
  jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});

afterEach(() => {
  window.fetch = originalFetch;
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the X-LaraBug-Sdk header, in a browser', () => {
  it('names the SDK, its version and the browser', async () => {
    init({ ingest_key: 'lbi_abc123' }).captureException(new Error('boom'));
    await jest.advanceTimersByTimeAsync(0);

    expect(headersSent()).toEqual([`larabug-js/${coreVersion} browser`]);
    expect(headersSent()[0]).toMatch(/^larabug-js\/\d+\.\d+\.\d+\S* browser$/);
  });

  it('goes out on a report the retry buffer sends later, framework included', async () => {
    fetchMock.mockResolvedValueOnce(response(503)).mockResolvedValue(response(200));
    const client = init({ ingest_key: 'lbi_abc123', transport: { retries: 1 } });

    client.captureException(new Error('boom'));
    await jest.advanceTimersByTimeAsync(0);
    client.setFramework('vue', '3.5.13');

    // The buffer sends what it kept once the backoff is over.
    await jest.advanceTimersByTimeAsync(60_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
    expect(headersSent()).toEqual([
      `larabug-js/${coreVersion} browser`,
      `larabug-js/${coreVersion} browser vue/3.5.13`,
    ]);
  });
});
