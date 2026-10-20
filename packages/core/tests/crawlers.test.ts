import { BaseLaraBugClient, KNOWN_CRAWLERS, LaraBugOptions } from '../src';

const GOOGLEBOT =
  'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/153.0.8010.52 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const GOOGLE_OTHER =
  'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/153.0.8010.52 Mobile Safari/537.36 (compatible; GoogleOther)';

const CRAWLERS: Record<string, string> = {
  'Googlebot on desktop':
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/153.0.8010.52 Safari/537.36',
  'Google-InspectionTool':
    'Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)',
  'AdsBot-Google': 'AdsBot-Google (+http://www.google.com/adsbot.html)',
  'Mediapartners-Google': 'Mediapartners-Google',
  'Storebot-Google':
    'Mozilla/5.0 (X11; Linux x86_64; Storebot-Google/1.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.88 Safari/537.36',
  bingbot:
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
  'Yahoo Slurp': 'Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)',
  DuckDuckBot: 'DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)',
  Baiduspider: 'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)',
  YandexBot: 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
  Applebot:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
  facebookexternalhit: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  Twitterbot: 'Twitterbot/1.0',
  LinkedInBot: 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
  Pinterestbot: 'Mozilla/5.0 (compatible; Pinterestbot/1.0; +http://www.pinterest.com/bot.html)',
  AhrefsBot: 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
  SemrushBot: 'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)',
  MJ12bot: 'Mozilla/5.0 (compatible; MJ12bot/v1.4.8; http://mj12bot.com/)',
  PetalBot:
    'Mozilla/5.0 (Linux; Android 7.0;) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; PetalBot;+https://webmaster.petalsearch.com/site/petalbot)',
  Bytespider:
    'Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)',
  GPTBot:
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
  ClaudeBot:
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  PerplexityBot:
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  CCBot: 'CCBot/2.0 (https://commoncrawl.org/faq/)',
  HeadlessChrome:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36',
  Lighthouse:
    'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
  'an unlisted bot': 'Mozilla/5.0 (compatible; ExampleBot/1.0; +https://example.test/bot)',
  'an unlisted crawler': 'Mozilla/5.0 (compatible; Example-Crawler; +https://example.test)',
  'an unlisted spider': 'example spider 2.0',
};

const BROWSERS: Record<string, string> = {
  'Chrome on Windows':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  'Chrome on macOS':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  'Chrome on Android':
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  'Chrome on iOS':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1',
  'Safari on macOS':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  'Safari on iPhone':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  'Safari on iPad':
    'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  'Firefox on Windows': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0',
  'Firefox on Linux': 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0',
  'Firefox on Android': 'Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0',
  'Edge on Windows':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  'Samsung Internet':
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  'Chrome on a Cubot phone':
    'Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
};

const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

function visit(navigator: Partial<Navigator> | undefined): void {
  Object.defineProperty(globalThis, 'navigator', { value: navigator, configurable: true });
}

function client(options: LaraBugOptions = {}): BaseLaraBugClient {
  return new BaseLaraBugClient({ ingest_key: 'lbi_abc123', ...options });
}

let fetchMock: jest.Mock;
let warnMock: jest.SpyInstance;

beforeEach(() => {
  fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  (globalThis as any).fetch = fetchMock;
  warnMock = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  if (original) {
    Object.defineProperty(globalThis, 'navigator', original);
  }
  delete (globalThis as any).fetch;
  jest.restoreAllMocks();
});

describe('the known crawler pattern', () => {
  it.each(Object.entries(CRAWLERS))('matches %s', (_, userAgent) => {
    expect(KNOWN_CRAWLERS.test(userAgent)).toBe(true);
  });

  it.each(Object.entries(BROWSERS))('does not match %s', (_, userAgent) => {
    expect(KNOWN_CRAWLERS.test(userAgent)).toBe(false);
  });
});

describe('a client visited by a crawler', () => {
  it.each([
    ['Googlebot', GOOGLEBOT],
    ['GoogleOther', GOOGLE_OTHER],
  ])('is inert for %s', (_, userAgent) => {
    visit({ userAgent });

    const status = client().getStatus();

    expect(status.active).toBe(false);
    expect(status.reason).toMatch(/known crawler/);
  });

  it('sends nothing', () => {
    visit({ userAgent: GOOGLEBOT });
    const bot = client();

    bot.captureException(new Error('HttpNetworkError: Network error'));
    bot.captureMessage('nor this');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps no breadcrumbs', () => {
    visit({ userAgent: GOOGLEBOT });
    const bot = client();

    bot.addBreadcrumb({ type: 'http', message: 'deferred props request' });

    // Nothing is ever sent from here, so the buffer is all there is to look at.
    expect((bot as any).breadcrumbs).toEqual([]);
  });

  it('does not warn about it', () => {
    visit({ userAgent: GOOGLEBOT });

    client();

    expect(warnMock).not.toHaveBeenCalled();
  });

  it('still warns about missing credentials, which matter in Lighthouse too', () => {
    visit({ userAgent: CRAWLERS.Lighthouse });

    const status = new BaseLaraBugClient({}).getStatus();

    expect(status.reason).toMatch(/no usable credentials/);
    expect(warnMock).toHaveBeenCalledTimes(1);
  });

  it('reports with ignoreBots off', () => {
    visit({ userAgent: GOOGLEBOT });
    const bot = client({ ignoreBots: false });

    bot.captureException(new Error('reported anyway'));

    expect(bot.isActive()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('a client visited by a person', () => {
  it.each(Object.entries(BROWSERS))('reports from %s', (_, userAgent) => {
    visit({ userAgent, webdriver: false });
    const person = client();

    person.captureException(new Error('a real bug'));

    expect(person.isActive()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports outside a browser, where there is no navigator', () => {
    visit(undefined);

    expect(client().isActive()).toBe(true);
  });
});

describe('ignoreUserAgents', () => {
  const MONITOR = 'Mozilla/5.0 (compatible; UptimeWatch 3.1)';

  it('ignores a string anywhere in the user agent, whatever its case', () => {
    visit({ userAgent: MONITOR });

    expect(client({ ignoreUserAgents: ['uptimewatch'] }).getStatus()).toEqual({
      active: false,
      reason: 'the user agent matches ignoreUserAgents',
    });
  });

  it('ignores a matching RegExp, every time even when it is global', () => {
    visit({ userAgent: MONITOR });
    const pattern = /UptimeWatch \d/g;

    expect(client({ ignoreUserAgents: [pattern] }).isActive()).toBe(false);
    expect(client({ ignoreUserAgents: [pattern] }).isActive()).toBe(false);
  });

  it('applies with ignoreBots off', () => {
    visit({ userAgent: MONITOR });

    expect(client({ ignoreBots: false, ignoreUserAgents: ['UptimeWatch'] }).isActive()).toBe(false);
  });

  it('leaves other visitors alone', () => {
    visit({ userAgent: BROWSERS['Chrome on Windows'] });

    expect(client({ ignoreUserAgents: ['UptimeWatch', /Pingdom/i, ''] }).isActive()).toBe(true);
  });

  it('skips entries that are neither a string nor a RegExp', () => {
    visit({ userAgent: MONITOR });

    const options = { ignoreUserAgents: [42, null, 'UptimeWatch'] } as unknown as LaraBugOptions;

    expect(client(options).isActive()).toBe(false);
  });
});

describe('a browser driven by automation', () => {
  it('is inert when navigator.webdriver is true', () => {
    visit({ userAgent: BROWSERS['Chrome on macOS'], webdriver: true });
    const driven = client();

    driven.captureException(new Error('from a test run'));

    expect(driven.getStatus().reason).toMatch(/navigator\.webdriver/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports with ignoreWebdriver off', () => {
    visit({ userAgent: BROWSERS['Chrome on macOS'], webdriver: true });

    expect(client({ ignoreWebdriver: false }).isActive()).toBe(true);
  });

  it('is not covered by ignoreBots, which is about the user agent', () => {
    visit({ userAgent: BROWSERS['Chrome on macOS'], webdriver: true });

    expect(client({ ignoreBots: false }).isActive()).toBe(false);
  });
});
