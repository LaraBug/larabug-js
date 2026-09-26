import { BaseLaraBugClient, LaraBugOptions } from '../src';

type SentRequest = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, any>;
};

let fetchMock: jest.Mock;

function sent(): SentRequest {
  expect(fetchMock).toHaveBeenCalledTimes(1);

  const [url, init] = fetchMock.mock.calls[0];

  return {
    url,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(init.body as string),
  };
}

function capture(options: LaraBugOptions): SentRequest {
  const client = new BaseLaraBugClient(options);

  expect(client.isActive()).toBe(true);

  client.captureException(new Error('boom'));

  return sent();
}

beforeEach(() => {
  fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  (globalThis as any).fetch = fetchMock;
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as any).fetch;
});

describe('an ingest key on its own', () => {
  it('is enough to build a working client', () => {
    const client = new BaseLaraBugClient({ ingest_key: 'lbi_abc123' });

    expect(client.isActive()).toBe(true);
    expect(client.getStatus().reason).toBeNull();
  });

  it('goes out in the header the ingest route reads first', () => {
    const request = capture({ ingest_key: 'lbi_abc123' });

    expect(request.headers['X-LaraBug-Ingest-Key']).toBe('lbi_abc123');
  });

  it('sends no bearer token at all', () => {
    const request = capture({ ingest_key: 'lbi_abc123' });

    expect(request.headers).not.toHaveProperty('Authorization');
    expect(JSON.stringify(request.headers)).not.toContain('Bearer');
  });

  it('names no project, because the key already does', () => {
    const request = capture({ ingest_key: 'lbi_abc123' });

    expect(request.body).not.toHaveProperty('project');
    expect(request.body.type).toBe('javascript_error');
  });

  it('posts to the default endpoint', () => {
    const request = capture({ ingest_key: 'lbi_abc123' });

    expect(request.url).toBe('https://www.larabug.com/api/log');
  });
});

describe('the deployed login key and project key pair', () => {
  it('keeps working, unchanged', () => {
    const request = capture({ login_key: 'account-token', project_key: 'project-key' });

    expect(request.headers['Authorization']).toBe('Bearer account-token');
    expect(request.body.project).toBe('project-key');
    expect(request.headers).not.toHaveProperty('X-LaraBug-Ingest-Key');
  });

  it('is not enough on its own without the project key', () => {
    const client = new BaseLaraBugClient({ login_key: 'account-token' });

    expect(client.isActive()).toBe(false);

    client.captureException(new Error('boom'));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('can be sent alongside an ingest key, and the server prefers the ingest key', () => {
    const request = capture({
      login_key: 'account-token',
      project_key: 'project-key',
      ingest_key: 'lbi_abc123',
    });

    expect(request.headers['X-LaraBug-Ingest-Key']).toBe('lbi_abc123');
    expect(request.headers['Authorization']).toBe('Bearer account-token');
  });
});

describe('an ingest key passed as the login_key, as the panel DSN and the old workaround both do', () => {
  it('is recognised by its prefix and sent as an ingest key, not as a bearer token', () => {
    const request = capture({ login_key: 'lbi_pasted_in_the_wrong_field' });

    expect(request.headers['X-LaraBug-Ingest-Key']).toBe('lbi_pasted_in_the_wrong_field');
    expect(request.headers).not.toHaveProperty('Authorization');
  });

  it('is enough on its own, with no project key beside it', () => {
    const client = new BaseLaraBugClient({ login_key: 'lbi_pasted_in_the_wrong_field' });

    expect(client.isActive()).toBe(true);
  });
});

describe('a DSN', () => {
  it('carrying an ingest key sends it as one', () => {
    const request = capture({ dsn: 'https://lbi_from_dsn:project-key@larabug.test/api/log' });

    expect(request.headers['X-LaraBug-Ingest-Key']).toBe('lbi_from_dsn');
    expect(request.headers).not.toHaveProperty('Authorization');
    expect(request.url).toBe('https://larabug.test/api/log');
    expect(request.body.project).toBe('project-key');
  });

  it('carrying an ingest key needs no project key beside it', () => {
    const request = capture({ dsn: 'https://lbi_from_dsn@larabug.test/api/log' });

    expect(request.headers['X-LaraBug-Ingest-Key']).toBe('lbi_from_dsn');
    expect(request.body).not.toHaveProperty('project');
  });

  it('carrying a login key still sends a bearer token', () => {
    const request = capture({ dsn: 'https://account-token:project-key@larabug.test/api/log' });

    expect(request.headers['Authorization']).toBe('Bearer account-token');
    expect(request.headers).not.toHaveProperty('X-LaraBug-Ingest-Key');
    expect(request.body.project).toBe('project-key');
  });

  it('takes precedence over keys passed beside it', () => {
    const request = capture({
      dsn: 'https://lbi_from_dsn@larabug.test/api/log',
      login_key: 'ignored',
      project_key: 'ignored',
    });

    expect(request.headers['X-LaraBug-Ingest-Key']).toBe('lbi_from_dsn');
    expect(request.headers).not.toHaveProperty('Authorization');
    expect(request.body).not.toHaveProperty('project');
  });
});

describe('the headers a request goes out with', () => {
  it('never carries an empty bearer token', () => {
    const request = capture({ ingest_key: 'lbi_abc123' });

    expect(JSON.stringify(request.headers)).not.toContain('undefined');
  });

  it('still lets the caller add and override headers', () => {
    const request = capture({
      ingest_key: 'lbi_abc123',
      transport: {
        headers: {
          'X-LaraBug-Ingest-Key': 'lbi_set_by_hand',
          'X-Site': 'tallieu',
        },
      },
    });

    expect(request.headers['X-LaraBug-Ingest-Key']).toBe('lbi_set_by_hand');
    expect(request.headers['X-Site']).toBe('tallieu');
    expect(request.headers['Content-Type']).toBe('application/json');
  });
});

describe('a client with nothing to authenticate with', () => {
  it('sends nothing, rather than sending an unauthenticated request', () => {
    const client = new BaseLaraBugClient({});

    client.captureException(new Error('boom'));
    client.captureMessage('boom');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
