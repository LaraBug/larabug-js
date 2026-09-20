/**
 * Playground for the LaraBug JavaScript SDK.
 *
 * Boots two servers on loopback so the demo has the same shape as a real
 * deployment, where the site and the ingest endpoint are different origins:
 *
 *   SITE   http://127.0.0.1:5175  serves the demo page and the built UMD bundle
 *   INGEST http://127.0.0.1:5176  stands in for LaraBug's POST /api/log
 *
 * The ingest server records every request the SDK makes and streams it back to
 * the page over SSE, so the page can show what was actually reported rather
 * than what it hoped would be reported. It can also be switched into the
 * failure modes the real API produces (402 quota, 429 throttle, 5xx, 401), so
 * the SDK's rate limiter, circuit breaker and cooldown handling are visible.
 *
 * No dependencies, no build step, nothing outside loopback.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, 'public');
// Defaults to this checkout's build. BUNDLE_PATH points it at another one,
// which is how you compare two branches' SDKs against the same page.
const bundlePath = process.env.BUNDLE_PATH
  ? resolve(process.env.BUNDLE_PATH)
  : resolve(here, '../packages/browser/dist/index.umd.js');

const SITE_PORT = Number(process.env.SITE_PORT ?? 5175);
const INGEST_PORT = Number(process.env.INGEST_PORT ?? 5176);
const SITE_ORIGIN = `http://127.0.0.1:${SITE_PORT}`;
const INGEST_ORIGIN = `http://127.0.0.1:${INGEST_PORT}`;

/**
 * Response modes the ingest server can be put into. `status` is what POST
 * /api/log answers with, `retryAfter` is the Retry-After header in seconds
 * (null sends none at all, which is what the app does for an expired trial).
 */
const MODES = {
  ok: { status: 200, retryAfter: null, label: 'Accepting events (200)' },
  quota: { status: 402, retryAfter: 60, label: 'Quota exceeded (402 + Retry-After: 60)' },
  'quota-silent': { status: 402, retryAfter: null, label: 'Trial expired (402, no Retry-After)' },
  throttled: { status: 429, retryAfter: 30, label: 'Throttled (429 + Retry-After: 30)' },
  'server-error': { status: 500, retryAfter: null, label: 'Server error (500)' },
  unauthorized: { status: 401, retryAfter: null, label: 'Bad credentials (401)' },
};

const state = {
  mode: 'ok',
  /** Whether the ingest server lets the browser read Retry-After. */
  exposeRetryAfter: true,
  received: [],
  nextId: 1,
};

/** Connected SSE clients, so the page updates the moment a request lands. */
const listeners = new Set();

function broadcast(event) {
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of listeners) {
    res.write(frame);
  }
}

function corsHeaders() {
  const headers = {
    // Mirrors larabug-app's config/cors.php, which allows every origin and
    // header on api/*.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '600',
  };

  // Retry-After is not a CORS-safelisted response header. Unless the server
  // names it here, browser JavaScript cannot read it on a cross-origin
  // response, and the SDK's cooldown handling silently sees nothing.
  if (state.exposeRetryAfter) {
    headers['Access-Control-Expose-Headers'] = 'Retry-After, X-LaraBug-Disable-Capture';
  }

  return headers;
}

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    ...corsHeaders(),
    ...extraHeaders,
  });
  res.end(payload);
}

function readBody(req, limitBytes = 5 * 1024 * 1024) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        rejectPromise(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rejectPromise);
  });
}

/**
 * Pull out the handful of fields the page wants to show up front. The full
 * payload is kept alongside it so nothing is hidden.
 */
function summarise(payload) {
  const exception = payload?.exception;
  const frames = exception?.stacktrace ?? [];

  return {
    type: payload?.type ?? null,
    project: payload?.project ?? null,
    level: payload?.level ?? null,
    message: payload?.message ?? null,
    exceptionType: exception?.type ?? null,
    topFrames: frames.slice(0, 3).map((frame) => ({
      function: frame.function ?? '<anonymous>',
      filename: frame.filename ?? 'unknown',
      lineno: frame.lineno ?? 0,
    })),
    frameCount: frames.length,
    breadcrumbCount: payload?.breadcrumbs?.length ?? 0,
    environment: payload?.environment ?? null,
    release: payload?.release ?? null,
    url: payload?.request?.url ?? null,
    user: payload?.user ?? null,
    context: payload?.context ?? null,
    tags: payload?.extra?.tags ?? null,
  };
}

function handleLog(req, res, raw) {
  const mode = MODES[state.mode];
  const authorization = req.headers['authorization'] ?? null;

  let payload = null;
  let parseError = null;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    parseError = String(error);
  }

  const record = {
    id: state.nextId++,
    at: new Date().toISOString(),
    mode: state.mode,
    answeredWith: mode.status,
    retryAfter: mode.retryAfter,
    bytes: Buffer.byteLength(raw),
    authorization: authorization ? `${authorization.slice(0, 14)}…` : null,
    hasBearer: typeof authorization === 'string' && authorization.startsWith('Bearer '),
    parseError,
    summary: parseError ? null : summarise(payload),
    payload,
  };

  state.received.push(record);
  broadcast({ kind: 'event', record });

  const headers = {};
  if (mode.retryAfter !== null) {
    headers['Retry-After'] = String(mode.retryAfter);
  }

  if (mode.status === 200) {
    sendJson(res, 200, { status: 'ok', id: record.id }, headers);
    return;
  }

  sendJson(res, mode.status, { error: mode.label }, headers);
}

const ingestServer = createServer(async (req, res) => {
  const url = new URL(req.url, INGEST_ORIGIN);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/log') {
    try {
      handleLog(req, res, await readBody(req));
    } catch (error) {
      sendJson(res, 413, { error: String(error) });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/__stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...corsHeaders(),
    });
    res.write(`data: ${JSON.stringify({ kind: 'hello', state: publicState() })}\n\n`);
    listeners.add(res);
    req.on('close', () => listeners.delete(res));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/__state') {
    sendJson(res, 200, publicState());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/__mode') {
    const body = JSON.parse((await readBody(req)) || '{}');
    if (body.mode && !(body.mode in MODES)) {
      sendJson(res, 422, { error: `Unknown mode: ${body.mode}` });
      return;
    }
    if (body.mode) state.mode = body.mode;
    if (typeof body.exposeRetryAfter === 'boolean') state.exposeRetryAfter = body.exposeRetryAfter;
    broadcast({ kind: 'state', state: publicState() });
    sendJson(res, 200, publicState());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/__reset') {
    state.received = [];
    state.nextId = 1;
    broadcast({ kind: 'reset', state: publicState() });
    sendJson(res, 200, publicState());
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

function publicState() {
  return {
    mode: state.mode,
    modeLabel: MODES[state.mode].label,
    exposeRetryAfter: state.exposeRetryAfter,
    modes: Object.fromEntries(Object.entries(MODES).map(([key, m]) => [key, m.label])),
    receivedCount: state.received.length,
  };
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

async function serveFile(res, path) {
  const body = await readFile(path);
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extname(path)] ?? 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const siteServer = createServer(async (req, res) => {
  const url = new URL(req.url, SITE_ORIGIN);

  // The demo loads the SDK exactly the way a plain site would: one script tag
  // pointing at the UMD bundle rollup produces.
  if (url.pathname === '/sdk/larabug.umd.js' || url.pathname === '/sdk/larabug.umd.js.map') {
    const path = url.pathname.endsWith('.map') ? `${bundlePath}.map` : bundlePath;
    try {
      await serveFile(res, path);
    } catch {
      const message = 'The browser bundle is missing. Run `npm run build` from the repository root first.';
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.js'] });
      res.end(`document.body.innerHTML = ${JSON.stringify(`<pre class="fatal">${message}</pre>`)};`);
    }
    return;
  }

  if (url.pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.js'], 'Cache-Control': 'no-store' });
    res.end(`window.__PLAYGROUND__ = ${JSON.stringify({ ingestOrigin: INGEST_ORIGIN })};`);
    return;
  }

  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const path = join(publicDir, normalize(requested));

  // Refuse anything that escapes the public directory.
  if (!path.startsWith(publicDir)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    await serveFile(res, path);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
});

try {
  await stat(bundlePath);
} catch {
  console.warn('! packages/browser/dist/index.umd.js is missing. Run `npm run build` first.\n');
}

siteServer.listen(SITE_PORT, '127.0.0.1', () => {
  console.log(`  demo site     ${SITE_ORIGIN}`);
});

ingestServer.listen(INGEST_PORT, '127.0.0.1', () => {
  console.log(`  fake ingest   ${INGEST_ORIGIN}/api/log`);
  console.log('\n  Open the demo site and start throwing errors. Ctrl-C to stop.\n');
});
