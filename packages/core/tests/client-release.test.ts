import { BaseLaraBugClient } from '../src';

let fetchMock: jest.Mock;

function sentBody(): Record<string, any> {
  expect(fetchMock).toHaveBeenCalledTimes(1);

  return JSON.parse(fetchMock.mock.calls[0][1].body as string);
}

beforeEach(() => {
  fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  (globalThis as any).fetch = fetchMock;
});

afterEach(() => {
  delete (globalThis as any).fetch;
  delete (globalThis as any).__LARABUG_RELEASE__;
});

describe('release', () => {
  it('goes out at the top level of an error event', () => {
    new BaseLaraBugClient({ ingest_key: 'lbi_abc123', release: 'abc123' }).captureException(
      new Error('boom')
    );

    expect(sentBody().release).toBe('abc123');
  });

  it('goes out on a message event too', () => {
    new BaseLaraBugClient({ ingest_key: 'lbi_abc123', release: 'abc123' }).captureMessage('hello');

    expect(sentBody().release).toBe('abc123');
  });

  it('defaults to the release the build injected', () => {
    (globalThis as any).__LARABUG_RELEASE__ = 'from-the-build';

    const client = new BaseLaraBugClient({ ingest_key: 'lbi_abc123' });
    client.captureException(new Error('boom'));

    expect(client.getOptions().release).toBe('from-the-build');
    expect(sentBody().release).toBe('from-the-build');
  });

  it('prefers the option over the injected release', () => {
    (globalThis as any).__LARABUG_RELEASE__ = 'from-the-build';

    new BaseLaraBugClient({ ingest_key: 'lbi_abc123', release: 'explicit' }).captureException(
      new Error('boom')
    );

    expect(sentBody().release).toBe('explicit');
  });

  it('is an empty string when nothing provides one', () => {
    new BaseLaraBugClient({ ingest_key: 'lbi_abc123' }).captureException(new Error('boom'));

    expect(sentBody().release).toBe('');
  });

  it('ignores an injected value that is not a string', () => {
    (globalThis as any).__LARABUG_RELEASE__ = { id: 'nope' };

    expect(new BaseLaraBugClient({ ingest_key: 'lbi_abc123' }).getOptions().release).toBe('');
  });
});

describe('stack frames on an event', () => {
  it('carry filename, lineno, colno and function', () => {
    const error = new Error('boom');
    error.stack = 'Error: boom\n    at save (https://app.test/build/assets/app-D4wpJuT4.js:1:2345)';

    new BaseLaraBugClient({ ingest_key: 'lbi_abc123' }).captureException(error);

    expect(sentBody().exception.stacktrace).toEqual([
      {
        function: 'save',
        filename: 'https://app.test/build/assets/app-D4wpJuT4.js',
        lineno: 1,
        colno: 2345,
        in_app: true,
      },
    ]);
  });
});
