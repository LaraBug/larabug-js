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

describe('capturing without a DOM', () => {
  it('sends the event without request info instead of failing', () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    (globalThis as any).fetch = fetchMock;
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    init({ ingest_key: 'lbi_abc123' }).captureException(new Error('during a server-side render'));

    expect(error).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).request).toBeUndefined();

    error.mockRestore();
    delete (globalThis as any).fetch;
  });
});
