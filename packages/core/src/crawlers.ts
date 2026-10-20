/**
 * Crawlers and headless renderers that run a site's JavaScript. Their errors
 * are almost never actionable: Google's renderer, for one, cuts off requests a
 * few milliseconds after the page loads, so every follow-up XHR fails. Matched
 * case-insensitively against `navigator.userAgent`. `Lighthouse` covers
 * `Chrome-Lighthouse` too.
 */
export const KNOWN_CRAWLERS: RegExp = new RegExp(
  [
    'Googlebot',
    'GoogleOther',
    'Google-InspectionTool',
    'AdsBot-Google',
    'Mediapartners-Google',
    'Storebot-Google',
    'bingbot',
    'Slurp',
    'DuckDuckBot',
    'Baiduspider',
    'YandexBot',
    'Applebot',
    'facebookexternalhit',
    'Twitterbot',
    'LinkedInBot',
    'Pinterestbot',
    'AhrefsBot',
    'SemrushBot',
    'MJ12bot',
    'PetalBot',
    'Bytespider',
    'GPTBot',
    'ClaudeBot',
    'PerplexityBot',
    'CCBot',
    'HeadlessChrome',
    'Lighthouse',
    // Any other crawler that names itself one: `bot`, `crawler` or `spider` as
    // a word of its own, or ending a product token (`ExampleBot/1.0`,
    // `compatible; ExampleBot;`). Not a bare substring, which would take in a
    // phone like the Cubot.
    '\\b(?:bot|crawler|spider)\\b',
    '(?:bot|crawler|spider)[/;]',
  ].join('|'),
  'i'
);

export interface CrawlerOptions {
  ignoreBots: boolean;
  ignoreWebdriver: boolean;
  ignoreUserAgents: Array<string | RegExp>;
}

function readNavigator(): { userAgent: string; webdriver: boolean } {
  try {
    const nav = (globalThis as { navigator?: Navigator }).navigator;

    return {
      userAgent: typeof nav?.userAgent === 'string' ? nav.userAgent : '',
      webdriver: nav?.webdriver === true,
    };
  } catch {
    return { userAgent: '', webdriver: false };
  }
}

function matches(userAgent: string, pattern: string | RegExp): boolean {
  if (typeof pattern === 'string') {
    return pattern !== '' && userAgent.toLowerCase().includes(pattern.toLowerCase());
  }

  // A global or sticky pattern keeps its lastIndex between calls.
  pattern.lastIndex = 0;

  return pattern.test(userAgent);
}

/**
 * Why the current visitor is one the SDK should not report on, or null for a
 * person. Outside a browser there is no visitor to judge, so null as well.
 */
export function ignoredVisitorReason(options: CrawlerOptions): string | null {
  const { userAgent, webdriver } = readNavigator();

  if (userAgent && options.ignoreUserAgents.some((pattern) => matches(userAgent, pattern))) {
    return 'the user agent matches ignoreUserAgents';
  }

  if (options.ignoreBots && userAgent && KNOWN_CRAWLERS.test(userAgent)) {
    return 'the user agent is a known crawler (turn this off with ignoreBots: false)';
  }

  if (options.ignoreWebdriver && webdriver) {
    return 'navigator.webdriver is true (turn this off with ignoreWebdriver: false)';
  }

  return null;
}
