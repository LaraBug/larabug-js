/**
 * @jest-environment jsdom
 */
import { init } from '../src';

const GOOGLEBOT =
  'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/153.0.8010.52 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const CHROME =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

let fetchMock: jest.Mock;
let installedListeners: Array<[string, any]>;
let originals: {
  log: typeof console.log;
  fetch: typeof window.fetch;
  open: typeof XMLHttpRequest.prototype.open;
  pushState: typeof window.history.pushState;
};

function visit(userAgent: string, webdriver = false): void {
  jest.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  Object.defineProperty(window.navigator, 'webdriver', { value: webdriver, configurable: true });
}

function rejectUnhandled(reason: unknown): void {
  const event = new Event('unhandledrejection') as Event & { reason: unknown };
  event.reason = reason;
  window.dispatchEvent(event);
}

beforeEach(() => {
  fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  window.fetch = fetchMock as unknown as typeof window.fetch;
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);

  installedListeners = [];
  const addEventListener = window.addEventListener.bind(window);
  jest.spyOn(window, 'addEventListener').mockImplementation((type: string, listener: any, options?: any) => {
    installedListeners.push([type, listener]);
    addEventListener(type, listener, options);
  });

  originals = {
    log: console.log,
    fetch: window.fetch,
    open: XMLHttpRequest.prototype.open,
    pushState: window.history.pushState,
  };
});

afterEach(() => {
  installedListeners.forEach(([type, listener]) => window.removeEventListener(type, listener));
  console.log = originals.log;
  window.fetch = originals.fetch;
  XMLHttpRequest.prototype.open = originals.open;
  window.history.pushState = originals.pushState;
  delete (window.navigator as any).webdriver;
  delete (globalThis as any).__larabugClient;
  jest.restoreAllMocks();
});

describe('init for Googlebot', () => {
  it('installs no handlers and patches nothing', () => {
    visit(GOOGLEBOT);

    init({ ingest_key: 'lbi_abc123' });

    expect(installedListeners).toEqual([]);
    expect(console.log).toBe(originals.log);
    expect(window.fetch).toBe(originals.fetch);
    expect(XMLHttpRequest.prototype.open).toBe(originals.open);
    expect(window.history.pushState).toBe(originals.pushState);
  });

  it('sends nothing for page errors or unhandled rejections', () => {
    visit(GOOGLEBOT);

    init({ ingest_key: 'lbi_abc123' });
    window.dispatchEvent(new ErrorEvent('error', { message: 'page broke', filename: 'app.js' }));
    rejectUnhandled(new Error('HttpNetworkError: Network error'));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports as usual with ignoreBots off', () => {
    visit(GOOGLEBOT);

    init({ ingest_key: 'lbi_abc123', ignoreBots: false });
    rejectUnhandled(new Error('HttpNetworkError: Network error'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('init in a browser driven by webdriver', () => {
  it('installs no handlers and sends nothing', () => {
    visit(CHROME, true);

    init({ ingest_key: 'lbi_abc123' });
    rejectUnhandled(new Error('from a test run'));

    expect(installedListeners).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('init for a person on mobile Chrome', () => {
  it('installs its handlers and reports an unhandled rejection', () => {
    visit(CHROME);

    init({ ingest_key: 'lbi_abc123' });
    rejectUnhandled(new Error('a real bug'));

    expect(installedListeners.map(([type]) => type)).toEqual(
      expect.arrayContaining(['error', 'unhandledrejection'])
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
