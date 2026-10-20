/**
 * @jest-environment jsdom
 */
import type { App } from 'vue';
import { init, LaraBugVuePlugin } from '../src';

type Handler = (err: unknown, instance: unknown, info: string) => void;

function fakeApp(errorHandler?: Handler): App & { config: { errorHandler?: Handler } } {
  return {
    config: { globalProperties: {}, errorHandler },
    mixin: jest.fn(),
    provide: jest.fn(),
  } as unknown as App & { config: { errorHandler?: Handler } };
}

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  window.fetch = fetchMock as unknown as typeof window.fetch;
  init({ ingest_key: 'lbi_abc123' });
});

describe('the Vue error handler', () => {
  it('reports the error and still prints it, as Vue would without a handler', () => {
    const app = fakeApp();
    (LaraBugVuePlugin.install as (app: App) => void)(app);
    const print = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error('render broke');

    app.config.errorHandler?.(error, null, 'render function');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(print).toHaveBeenCalledWith(error);
    print.mockRestore();
  });

  it('reports nothing for a crawler, and still prints the error', () => {
    jest.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
    );
    init({ ingest_key: 'lbi_abc123' });
    const app = fakeApp();
    (LaraBugVuePlugin.install as (app: App) => void)(app);
    const print = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error('render broke');

    app.config.errorHandler?.(error, null, 'render function');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(print).toHaveBeenCalledWith(error);
    jest.restoreAllMocks();
  });

  it('leaves printing to a handler the app already had', () => {
    const own = jest.fn();
    const app = fakeApp(own);
    (LaraBugVuePlugin.install as (app: App) => void)(app);
    const print = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error('render broke');

    app.config.errorHandler?.(error, null, 'render function');

    expect(own).toHaveBeenCalledWith(error, null, 'render function');
    expect(print).not.toHaveBeenCalled();
    print.mockRestore();
  });

  it('prints nothing with logErrors off', () => {
    const app = fakeApp();
    (LaraBugVuePlugin.install as (app: App, options: object) => void)(app, { logErrors: false });
    const print = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    app.config.errorHandler?.(new Error('render broke'), null, 'render function');

    expect(print).not.toHaveBeenCalled();
    print.mockRestore();
  });
});
