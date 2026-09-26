/**
 * The browser build gets imported into server-side renders and into build-time
 * prerenders. There is nothing to instrument there, and nothing to break.
 */
import { init } from '../src';

describe('init without a DOM', () => {
  it('does not throw', () => {
    expect(typeof window).toBe('undefined');
    expect(() => init({ ingest_key: 'lbi_abc123' })).not.toThrow();
  });

  it('still returns a client that can report', () => {
    const client = init({ ingest_key: 'lbi_abc123' });

    expect(client.isActive()).toBe(true);
  });

  it('does not throw without credentials either', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(() => init({})).not.toThrow();

    warn.mockRestore();
  });
});
