/**
 * @jest-environment jsdom
 */
import { version as reactVersion } from 'react';
import { init } from '../src';

let fetchMock: jest.Mock;
const originalFetch = window.fetch;

beforeEach(() => {
  fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  window.fetch = fetchMock as unknown as typeof window.fetch;
});

afterEach(() => {
  window.fetch = originalFetch;
});

describe('the X-LaraBug-Sdk header', () => {
  it("names React and the app's React version", () => {
    init({ ingest_key: 'lbi_abc123' }).captureMessage('hi');

    expect(reactVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(fetchMock.mock.calls[0][1].headers['X-LaraBug-Sdk']).toMatch(
      new RegExp(
        `^larabug-js/\\d+\\.\\d+\\.\\d+\\S* browser react/${reactVersion.replace(/\./g, '\\.')}$`
      )
    );
  });
});
