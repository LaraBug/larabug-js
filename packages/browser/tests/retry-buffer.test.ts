/**
 * @jest-environment jsdom
 */
import { init, FILTERED, LaraBugOptions } from '../src';
import { RetryBuffer } from '../src/retry-buffer';

const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'] as const;

let originals: {
  console: Record<string, any>;
  fetch: typeof window.fetch;
  open: typeof XMLHttpRequest.prototype.open;
  send: typeof XMLHttpRequest.prototype.send;
  pushState: typeof window.history.pushState;
};

let fetchMock: jest.Mock;
let installedListeners: Array<[string, any]>;
let online: jest.SpyInstance;

function response(status: number, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name] ?? null },
  };
}

function start(options: LaraBugOptions = {}) {
  // One attempt each, so the in-memory retry does not get in the way.
  return init({ ingest_key: 'lbi_abc123', transport: { retries: 1 }, ...options });
}

/** Let pending sends settle, and run the timers due by then. */
async function settle(ms = 0): Promise<void> {
  await jest.advanceTimersByTimeAsync(ms);
}

function queueKey(): string | undefined {
  return Object.keys(localStorage).find(
    (key) => key.startsWith('larabug:retry:') && !key.endsWith(':lock')
  );
}

function kept(): Array<{ id: string; t: number; n: number; at: number; body: string }> {
  const key = queueKey();
  return key ? JSON.parse(localStorage.getItem(key) as string) : [];
}

function sentBodies(): string[] {
  return fetchMock.mock.calls.map(([, request]) => request.body);
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-11-12T10:00:00Z') });
  localStorage.clear();

  fetchMock = jest.fn().mockResolvedValue(response(200));
  window.fetch = fetchMock as unknown as typeof window.fetch;
  online = jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);

  installedListeners = [];
  const addEventListener = window.addEventListener.bind(window);
  jest
    .spyOn(window, 'addEventListener')
    .mockImplementation((type: string, listener: any, options?: any) => {
      installedListeners.push([type, listener]);
      addEventListener(type, listener, options);
    });

  originals = {
    console: consoleMethods.reduce<Record<string, any>>((carry, method) => {
      carry[method] = console[method];
      return carry;
    }, {}),
    fetch: window.fetch,
    open: XMLHttpRequest.prototype.open,
    send: XMLHttpRequest.prototype.send,
    pushState: window.history.pushState,
  };
});

afterEach(() => {
  installedListeners.forEach(([type, listener]) => window.removeEventListener(type, listener));
  consoleMethods.forEach((method) => {
    console[method] = originals.console[method];
  });
  window.fetch = originals.fetch;
  XMLHttpRequest.prototype.open = originals.open;
  XMLHttpRequest.prototype.send = originals.send;
  window.history.pushState = originals.pushState;
  delete (globalThis as any).__larabugClient;
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('a report the server could not take', () => {
  it('is kept on a 5xx, exactly as it was sent, after filtering', async () => {
    fetchMock.mockResolvedValue(response(503));

    start().captureException(new Error('boom'), { password: 'hunter2' });
    await settle();

    expect(kept()).toHaveLength(1);
    expect(kept()[0].body).toBe(sentBodies()[0]);
    expect(JSON.parse(kept()[0].body).context.password).toBe(FILTERED);
    expect(localStorage.getItem(queueKey() as string)).not.toContain('lbi_abc123');
  });

  it('keeps the time it happened through localStorage, and is sent with it later', async () => {
    fetchMock.mockResolvedValueOnce(response(503)).mockResolvedValue(response(200));
    const capturedAt = new Date().toISOString();

    start().captureException(new Error('boom'));
    await settle();

    expect(JSON.parse(kept()[0].body).occurred_at).toBe(capturedAt);

    // The next page, two minutes on.
    await settle(120_000);
    start();
    await settle(1_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(sentBodies()[1]).occurred_at).toBe(capturedAt);
    expect(kept()).toHaveLength(0);
  });

  it('is kept on a status from a proxy in front of a server that is down', async () => {
    fetchMock.mockResolvedValue(response(522));

    start().captureException(new Error('boom'));
    await settle();

    expect(kept()).toHaveLength(1);
  });

  it('is kept on a network failure, without logging it', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    start().captureException(new Error('boom'));
    await settle();

    expect(kept()).toHaveLength(1);
    expect(error).not.toHaveBeenCalledWith('LaraBug: Failed to send error', expect.anything());
  });

  it('is kept on a 429, and retried with backoff', async () => {
    fetchMock.mockResolvedValueOnce(response(429)).mockResolvedValue(response(200));

    start().captureException(new Error('boom'));
    await settle();

    expect(kept()).toHaveLength(1);
    expect(kept()[0].at).toBeGreaterThan(Date.now());

    await settle(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await settle(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(kept()).toHaveLength(0);
  });

  it.each([400, 401, 403, 404, 413, 422])('is dropped on a %i', async (status) => {
    fetchMock.mockResolvedValue(response(status));

    start().captureException(new Error('boom'));
    await settle();

    expect(queueKey()).toBeUndefined();
  });

  it('waits for Retry-After, and so does a report captured in the meantime', async () => {
    fetchMock
      .mockResolvedValueOnce(response(503, { 'Retry-After': '120' }))
      .mockResolvedValue(response(200));
    const client = start();

    client.captureException(new Error('first'));
    await settle();
    client.captureException(new Error('second'));
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(kept()).toHaveLength(2);
    kept().forEach((entry) => expect(entry.at).toBeGreaterThanOrEqual(Date.now() + 119_000));

    await settle(118_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await settle(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(kept()).toHaveLength(0);
  });

  it('is dropped while the server asks for no reports at all', async () => {
    fetchMock.mockResolvedValue(response(503, { 'X-LaraBug-Disable-Capture': '60' }));

    start().captureException(new Error('boom'));
    await settle();

    expect(queueKey()).toBeUndefined();
  });

  it('is not even tried while the browser is offline, and goes out once it is back', async () => {
    online.mockReturnValue(false);

    start().captureException(new Error('boom'));
    await settle(60_000);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(kept()).toHaveLength(1);

    online.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sentBodies()[0]).message).toBe('boom');
    expect(kept()).toHaveLength(0);
  });

  it('goes out right after the next report that does', async () => {
    fetchMock.mockResolvedValueOnce(response(500)).mockResolvedValue(response(200));
    const client = start();

    client.captureException(new Error('kept'));
    await settle();
    client.captureException(new Error('sent'));
    await settle();

    expect(sentBodies().map((body) => JSON.parse(body).message)).toEqual(['kept', 'sent', 'kept']);
    expect(kept()).toHaveLength(0);
  });

  it('is sent by the next page load once it falls due, by one tab only', async () => {
    let answer!: (value: unknown) => void;
    fetchMock
      .mockResolvedValueOnce(response(502))
      .mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    start().captureException(new Error('from the last page'));
    await settle();

    // The next page: a new client over the same storage. The first one's timer
    // is still around and falls due at the same moment, standing in for a
    // second tab, while the retry is still waiting for the server.
    start();
    await settle(20_000);

    expect(sentBodies().map((body) => JSON.parse(body).message)).toEqual([
      'from the last page',
      'from the last page',
    ]);

    answer(response(200));
    await settle(60_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(kept()).toHaveLength(0);
  });

  it('is left to the tab that holds the lock, until the lock expires', async () => {
    online.mockReturnValue(false);
    start().captureException(new Error('boom'));
    localStorage.setItem(`${queueKey()}:lock`, `another-tab ${Date.now() + 30_000}`);

    online.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await settle(10_000);
    expect(fetchMock).not.toHaveBeenCalled();

    await settle(25_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(kept()).toHaveLength(0);
  });

  it('is kept in memory when localStorage cannot be written', async () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    online.mockReturnValue(false);

    expect(() => start().captureException(new Error('boom'))).not.toThrow();
    await settle();
    expect(queueKey()).toBeUndefined();

    online.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('is never thrown into the page, whatever is in storage', async () => {
    fetchMock.mockResolvedValue(response(503));
    const client = start();
    client.captureException(new Error('boom'));
    await settle();
    localStorage.setItem(queueKey() as string, '{not json');

    client.captureException(new Error('again'));
    await settle();
    window.dispatchEvent(new Event('online'));
    await settle(60_000);

    expect(kept().map((entry) => JSON.parse(entry.body).message)).toEqual(['again']);
  });
});

describe('without the retry buffer', () => {
  it('drops a report the server could not take, as before', async () => {
    fetchMock.mockResolvedValue(response(503));

    start({ retryBuffer: false }).captureException(new Error('boom'));
    await settle(60_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(queueKey()).toBeUndefined();
  });

  it('is off for an inert client', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    online.mockReturnValue(false);

    init({}).captureException(new Error('boom'));
    await settle();

    expect(queueKey()).toBeUndefined();
  });
});

describe('the bounds of the retry buffer', () => {
  function buffer(limits: Partial<{ maxReports: number; maxBytes: number; maxAgeMs: number }>) {
    const send = jest.fn();
    return new RetryBuffer(
      send,
      { enabled: true, maxReports: 50, maxBytes: 500_000, maxAgeMs: 86_400_000, ...limits },
      'scope'
    );
  }

  function keep(target: RetryBuffer, body: string) {
    target.defer(body, 0, 0);
    jest.advanceTimersByTime(1);
  }

  it('drops the oldest past the most reports', () => {
    const target = buffer({ maxReports: 2 });
    ['a', 'b', 'c'].forEach((body) => keep(target, body));

    expect(kept().map((entry) => entry.body)).toEqual(['b', 'c']);
  });

  it('drops the oldest past the most bytes', () => {
    const target = buffer({ maxBytes: 10 });
    ['aaaa', 'bbbb', 'cccc'].forEach((body) => keep(target, body));

    expect(kept().map((entry) => entry.body)).toEqual(['bbbb', 'cccc']);
  });

  it('keeps no report bigger than the whole buffer', () => {
    keep(buffer({ maxBytes: 3 }), 'abcd');

    expect(kept()).toEqual([]);
  });

  it('drops what is too old', () => {
    const target = buffer({ maxAgeMs: 60_000 });
    keep(target, 'old');
    jest.advanceTimersByTime(60_000);
    keep(target, 'new');

    expect(kept().map((entry) => entry.body)).toEqual(['new']);
  });

  it('keeps the queues of two projects apart', () => {
    new RetryBuffer(
      jest.fn(),
      { enabled: true, maxReports: 50, maxBytes: 500_000, maxAgeMs: 86_400_000 },
      'one'
    ).defer('a', 0, 0);
    new RetryBuffer(
      jest.fn(),
      { enabled: true, maxReports: 50, maxBytes: 500_000, maxAgeMs: 86_400_000 },
      'two'
    ).defer('b', 0, 0);

    expect(
      Object.keys(localStorage).filter((key) => key.startsWith('larabug:retry:'))
    ).toHaveLength(2);
  });
});
