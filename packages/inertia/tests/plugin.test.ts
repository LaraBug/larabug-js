/**
 * @jest-environment jsdom
 */
import { getCurrentClient, init } from '@larabug/browser';
import { createInertiaLaraBugPlugin } from '../src';

// The router dispatches `inertia:<name>` events on document; this stands in
// for it and lets each test fire an event with the shape a given Inertia
// version sends.
const listeners = new Map<string, Array<(event: CustomEvent) => void>>();

jest.mock(
  '@inertiajs/core',
  () => ({
    router: {
      on: (name: string, callback: (event: CustomEvent) => void) => {
        listeners.set(name, [...(listeners.get(name) ?? []), callback]);
        return () => undefined;
      },
    },
  }),
  { virtual: true }
);

function fire(name: string, detail: unknown): void {
  (listeners.get(name) ?? []).forEach((callback) => callback({ detail } as CustomEvent));
}

let fetchMock: jest.Mock;

function sentEvents(): Array<Record<string, any>> {
  return fetchMock.mock.calls.map((call) => JSON.parse(call[1].body as string));
}

beforeEach(() => {
  listeners.clear();
  fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  (globalThis as any).fetch = fetchMock;
  init({ ingest_key: 'lbi_abc123' });
  createInertiaLaraBugPlugin().install();
});

afterEach(() => {
  delete (globalThis as any).fetch;
});

describe('on Inertia v3', () => {
  it('turns a failed validation into a breadcrumb with only the field names', () => {
    expect(() =>
      fire('error', {
        errors: { email: 'The email is wrong: me@example.com' },
        page: {},
        visitId: '1',
      })
    ).not.toThrow();

    expect(fetchMock).not.toHaveBeenCalled();
    getCurrentClient()?.captureMessage('after');
    const [event] = sentEvents();
    const crumb = event.breadcrumbs.find((b: any) => b.message === 'Validation failed');
    expect(crumb.data).toEqual({ fields: ['email'] });
    expect(JSON.stringify(event)).not.toContain('me@example.com');
  });

  it('records a network error and an HTTP exception as breadcrumbs', () => {
    fire('networkError', { error: new Error('Failed to fetch') });
    fire('httpException', { response: { status: 500, data: '<html>secret</html>', headers: {} } });
    getCurrentClient()?.captureMessage('after');
    const [event] = sentEvents();

    expect(event.breadcrumbs.find((b: any) => b.message === 'Network error').data).toEqual({
      error: 'Failed to fetch',
    });
    expect(
      event.breadcrumbs.find((b: any) => b.message === 'Invalid Inertia response').data
    ).toEqual({ status: 500 });
    expect(JSON.stringify(event)).not.toContain('secret');
  });

  it('reads navigation events, whose visit url is a URL', () => {
    fire('start', { visit: { url: new URL('https://app.test/orders?token=abc'), method: 'get' } });
    fire('navigate', {
      page: { component: 'Orders/Index', url: '/orders', props: {} },
      type: 'visit',
    });
    getCurrentClient()?.captureMessage('after');
    const [event] = sentEvents();

    expect(
      event.breadcrumbs.find((b: any) => b.message === 'Navigation started').data.url
    ).toContain('https://app.test/orders');
    expect(
      event.breadcrumbs.find((b: any) => b.message === 'Navigation started').data.url
    ).not.toContain('abc');
    expect(event.context.page).toMatchObject({ component: 'Orders/Index', url: '/orders' });
  });
});

describe('on Inertia v1 and v2', () => {
  it('reports an exception event', () => {
    fire('exception', { exception: new TypeError('response handling broke') });

    const [event] = sentEvents();
    expect(event.exception.type).toBe('TypeError');
    expect(event.context.mechanism).toBe('inertia-exception');
  });

  it('records an invalid response as a breadcrumb', () => {
    fire('invalid', { response: { status: 419 } });
    getCurrentClient()?.captureMessage('after');
    expect(
      sentEvents()[0].breadcrumbs.find((b: any) => b.message === 'Invalid Inertia response').data
    ).toEqual({
      status: 419,
    });
  });
});

describe('an event shape the plugin does not know', () => {
  it('never throws into the page', () => {
    for (const name of [
      'navigate',
      'start',
      'finish',
      'progress',
      'error',
      'exception',
      'invalid',
      'networkError',
      'httpException',
    ]) {
      expect(() => fire(name, undefined)).not.toThrow();
      expect(() => fire(name, { visit: null, page: 42, errors: 'x' })).not.toThrow();
    }
  });
});
