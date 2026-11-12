import { BaseLaraBugClient } from '../src';

let fetchMock: jest.Mock;

function sentBody(): Record<string, any> {
  expect(fetchMock).toHaveBeenCalledTimes(1);

  return JSON.parse(fetchMock.mock.calls[0][1].body as string);
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-11-12T08:15:30.250Z') });
  fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  (globalThis as any).fetch = fetchMock;
});

afterEach(() => {
  jest.useRealTimers();
  delete (globalThis as any).fetch;
});

describe('occurred_at', () => {
  it('goes out at the top level of an error event, as the moment of capture', () => {
    new BaseLaraBugClient({ ingest_key: 'lbi_abc123' }).captureException(new Error('boom'));

    const body = sentBody();
    expect(body.occurred_at).toBe('2026-11-12T08:15:30.250Z');
    expect(body.exception.occurred_at).toBeUndefined();
  });

  it('goes out on a message event too', () => {
    new BaseLaraBugClient({ ingest_key: 'lbi_abc123' }).captureMessage('hello');

    expect(sentBody().occurred_at).toBe('2026-11-12T08:15:30.250Z');
  });

  it('is ISO 8601 with an offset the server can read', () => {
    new BaseLaraBugClient({ ingest_key: 'lbi_abc123' }).captureException(new Error('boom'));

    expect(sentBody().occurred_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
    );
  });
});
