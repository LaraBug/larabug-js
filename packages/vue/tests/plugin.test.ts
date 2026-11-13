/**
 * @jest-environment jsdom
 */
import { createApp, defineComponent, h, ref } from 'vue';
import type { App } from 'vue';
import { init, LaraBugVuePlugin, useLaraBugContext, useLaraBugTag } from '../src';

type Handler = (err: unknown, instance: unknown, info: string) => void;

function fakeApp(errorHandler?: Handler): App & { config: { errorHandler?: Handler } } {
  return {
    version: '3.5.13',
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

describe('the X-LaraBug-Sdk header', () => {
  it("names Vue and the app's Vue version", () => {
    const app = fakeApp();
    (LaraBugVuePlugin.install as (app: App) => void)(app);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    app.config.errorHandler?.(new Error('render broke'), null, 'render function');

    expect(fetchMock.mock.calls[0][1].headers['X-LaraBug-Sdk']).toMatch(
      /^larabug-js\/\d+\.\d+\.\d+\S* browser vue\/3\.5\.13$/
    );
    jest.restoreAllMocks();
  });
});

describe('useLaraBugTag', () => {
  it('takes a plain string as well as a ref, and so does useLaraBugContext', () => {
    const setTag = jest.fn();
    const setContext = jest.fn();
    const tag = ref('first');

    const Child = defineComponent({
      setup() {
        useLaraBugTag('page', 'dashboard');
        useLaraBugTag('tab', tag);
        useLaraBugContext('count', 3);
        useLaraBugContext('form', { value: 'not a ref' });
        return () => h('div');
      },
    });

    const app = createApp(Child);
    app.provide('larabug', { setTag, setContext });
    app.mount(document.createElement('div'));

    expect(setTag).toHaveBeenCalledWith('page', 'dashboard');
    expect(setTag).toHaveBeenCalledWith('tab', 'first');
    expect(setContext).toHaveBeenCalledWith('count', 3);
    expect(setContext).toHaveBeenCalledWith('form', { value: 'not a ref' });
    app.unmount();
  });
});
