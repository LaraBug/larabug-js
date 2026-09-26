import { BaseLaraBugClient, LaraBugOptions } from '../src';

describe('construction never throws', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('accepts no options at all', () => {
    expect(() => new BaseLaraBugClient()).not.toThrow();
    expect(() => new BaseLaraBugClient({})).not.toThrow();
  });

  it('accepts missing credentials', () => {
    expect(() => new BaseLaraBugClient({ project_key: 'project-only' })).not.toThrow();
    expect(() => new BaseLaraBugClient({ login_key: 'login-only' })).not.toThrow();
    expect(() => new BaseLaraBugClient({ login_key: '', project_key: '' })).not.toThrow();
  });

  it('accepts null and undefined where an options object was expected', () => {
    expect(() => new BaseLaraBugClient(undefined as unknown as LaraBugOptions)).not.toThrow();
    expect(() => new BaseLaraBugClient(null as unknown as LaraBugOptions)).not.toThrow();
    expect(() => new BaseLaraBugClient('nonsense' as unknown as LaraBugOptions)).not.toThrow();
  });

  it('accepts values of the wrong type, as a .env round trip produces', () => {
    const wrong = {
      login_key: 42,
      project_key: true,
      ingest_key: [],
      endpoint: {},
      dsn: 7,
      sampleRate: '0.5',
      maxBreadcrumbs: 'lots',
      enabled: 'false',
      blacklist: 'password',
      urlBlacklist: { 0: 'token' },
      transport: 'yes',
      beforeSend: 'not a function',
      context: 'none',
      user: 'nobody',
    } as unknown as LaraBugOptions;

    expect(() => new BaseLaraBugClient(wrong)).not.toThrow();

    const options = new BaseLaraBugClient(wrong).getOptions();
    expect(options.endpoint).toBe('https://www.larabug.com/api/log');
    expect(options.sampleRate).toBe(1.0);
    expect(options.maxBreadcrumbs).toBe(100);
    expect(options.blacklist).toEqual([]);
    expect(typeof options.beforeSend).toBe('function');
  });

  it('accepts an options object that throws while being read', () => {
    const hostile = {
      get login_key(): string {
        throw new Error('exploding getter');
      },
    } as unknown as LaraBugOptions;

    let client!: BaseLaraBugClient;
    expect(() => {
      client = new BaseLaraBugClient(hostile);
    }).not.toThrow();

    expect(client.isActive()).toBe(false);
    expect(client.getStatus().reason).toMatch(/could not be read/);
  });

  it('accepts a DSN it cannot parse', () => {
    expect(() => new BaseLaraBugClient({ dsn: 'not a url' })).not.toThrow();
    expect(() => new BaseLaraBugClient({ dsn: 'https://host/api/log' })).not.toThrow();
    expect(() => new BaseLaraBugClient({ dsn: 'https://login-key-only@host/api/log' })).not.toThrow();
  });

  it('falls back to explicit keys when the DSN is unusable', () => {
    const client = new BaseLaraBugClient({
      dsn: 'not a url',
      ingest_key: 'lbi_fallback',
    });

    expect(client.isActive()).toBe(true);
  });
});

describe('a client that cannot report says so', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('is inert, and reports why', () => {
    const client = new BaseLaraBugClient({});

    expect(client.isActive()).toBe(false);
    expect(client.getStatus()).toEqual({
      active: false,
      reason: expect.stringContaining('no usable credentials'),
    });
  });

  it('warns exactly once, naming the option to pass', () => {
    new BaseLaraBugClient({});

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('ingest_key');
    expect(warn.mock.calls[0][0]).toContain('inert');
  });

  it('stays quiet when it has what it needs', () => {
    const client = new BaseLaraBugClient({ ingest_key: 'lbi_quiet' });

    expect(client.isActive()).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('stays quiet when the caller turned reporting off on purpose', () => {
    const client = new BaseLaraBugClient({ enabled: false });

    expect(client.isActive()).toBe(false);
    expect(client.getStatus().reason).toMatch(/enabled option is false/);
    expect(warn).not.toHaveBeenCalled();
  });

  it('reports the flag rather than the keys when reporting is off and keys are missing too', () => {
    const client = new BaseLaraBugClient({ enabled: false, login_key: 'incomplete' });

    expect(client.getStatus().reason).toMatch(/enabled option is false/);
    expect(warn).not.toHaveBeenCalled();
  });

  it('is inactive when reporting is off even with a perfectly good key', () => {
    const client = new BaseLaraBugClient({ ingest_key: 'lbi_ok', enabled: false });

    expect(client.isActive()).toBe(false);
    expect(client.getStatus().reason).toMatch(/enabled option is false/);
  });

  it('accepts every call on the client interface without complaint', () => {
    const client = new BaseLaraBugClient({});

    expect(() => {
      client.captureException(new Error('nowhere to send this'));
      client.captureMessage('nor this');
      client.addBreadcrumb({ type: 'default', message: 'crumb' });
      client.setUser({ id: 1 });
      client.setContext('key', 'value');
      client.setTag('framework', 'none');
      client.clearBreadcrumbs();
      client.getOptions();
    }).not.toThrow();
  });
});
