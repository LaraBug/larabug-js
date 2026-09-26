/**
 * @jest-environment jsdom
 */
import { init, getCurrentClient } from '../src';
import { LaraBugOptions } from '@larabug/core';

const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'] as const;

let originals: {
  console: Record<string, any>;
  fetch: typeof window.fetch;
  open: typeof XMLHttpRequest.prototype.open;
  send: typeof XMLHttpRequest.prototype.send;
  pushState: typeof window.history.pushState;
};

let fetchMock: jest.Mock;
let warnMock: jest.Mock;

// jsdom hands the whole file one window, so listeners are tracked and removed
// after each test: a client from an earlier test would otherwise answer here.
let installedListeners: Array<[string, any]>;

beforeEach(() => {
  fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  window.fetch = fetchMock as unknown as typeof window.fetch;

  // Silenced before the originals are captured, so the assertions about which
  // globals the SDK leaves alone compare against this, not the real warn.
  warnMock = jest.spyOn(console, 'warn').mockImplementation(() => undefined) as unknown as jest.Mock;

  installedListeners = [];
  const addEventListener = window.addEventListener.bind(window);
  jest.spyOn(window, 'addEventListener').mockImplementation((type: string, listener: any, options?: any) => {
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
  jest.restoreAllMocks();
});

describe('init', () => {
  it('never throws, whatever it is handed', () => {
    expect(() => init()).not.toThrow();
    expect(() => init({})).not.toThrow();
    expect(() => init(null as unknown as LaraBugOptions)).not.toThrow();
    expect(() => init({ login_key: 'no project key' })).not.toThrow();
    expect(() => init({ dsn: 'not a url' })).not.toThrow();
  });

  it('returns a client that reports its own state', () => {
    expect(init({}).isActive()).toBe(false);
    expect(init({ ingest_key: 'lbi_abc123' }).isActive()).toBe(true);
    expect(getCurrentClient()?.isActive()).toBe(true);
  });
});

describe('a client with no usable credentials', () => {
  it('leaves the console alone', () => {
    init({});

    consoleMethods.forEach((method) => {
      expect(console[method]).toBe(originals.console[method]);
    });
  });

  it('leaves fetch, XHR and history alone', () => {
    init({});

    expect(window.fetch).toBe(originals.fetch);
    expect(XMLHttpRequest.prototype.open).toBe(originals.open);
    expect(XMLHttpRequest.prototype.send).toBe(originals.send);
    expect(window.history.pushState).toBe(originals.pushState);
  });

  it('sends nothing when the page throws', () => {
    init({});

    window.dispatchEvent(new ErrorEvent('error', { message: 'page broke', filename: 'app.js' }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('warns once, and only about itself', () => {
    init({});

    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock.mock.calls[0][0]).toContain('[LaraBug]');
  });
});

describe('a client with an ingest key', () => {
  it('instruments the page', () => {
    init({ ingest_key: 'lbi_abc123' });

    expect(console.log).not.toBe(originals.console.log);
    expect(window.fetch).not.toBe(originals.fetch);
    expect(XMLHttpRequest.prototype.open).not.toBe(originals.open);
  });

  it('says nothing on the way up', () => {
    init({ ingest_key: 'lbi_abc123' });

    expect(warnMock).not.toHaveBeenCalled();
  });

  it('reports a page error with the ingest header and no bearer token', () => {
    init({ ingest_key: 'lbi_abc123' });

    window.dispatchEvent(
      new ErrorEvent('error', { message: 'page broke', filename: 'app.js', lineno: 1, colno: 2 })
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['X-LaraBug-Ingest-Key']).toBe('lbi_abc123');
    expect(headers).not.toHaveProperty('Authorization');
  });

  it('does not swallow the host application\'s own fetch failures', async () => {
    init({ ingest_key: 'lbi_abc123' });

    const failure = new Error('the host app\'s request failed');
    fetchMock.mockRejectedValueOnce(failure);

    await expect(window.fetch('https://example.test/host-request')).rejects.toBe(failure);
  });

  it('still calls through to the original console method', () => {
    const log = jest.fn();
    console.log = log;
    originals.console.log = log;

    init({ ingest_key: 'lbi_abc123' });
    console.log('host message');

    expect(log).toHaveBeenCalledWith('host message');
  });
});

describe('instrumentation that cannot be installed', () => {
  it('does not stop init, and does not stop the other steps', () => {
    (window.addEventListener as unknown as jest.Mock).mockImplementation(() => {
      throw new Error('addEventListener is unavailable');
    });

    expect(() => init({ ingest_key: 'lbi_abc123' })).not.toThrow();

    expect(console.log).not.toBe(originals.console.log);
    expect(warnMock.mock.calls.some((call) => String(call[0]).includes('Could not instrument'))).toBe(
      true
    );
  });
});
