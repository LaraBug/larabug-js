/**
 * Playground driver.
 *
 * Everything the playground itself does over the network uses references
 * captured before LaraBug.init() runs. The SDK wraps window.fetch and the
 * console to collect breadcrumbs, so without this the feed would fill up with
 * the playground's own control traffic and the breadcrumb demo would be a lie.
 */
const nativeFetch = window.fetch.bind(window);

const ingestOrigin = window.__PLAYGROUND__.ingestOrigin;

const el = {
  endpoint: document.getElementById('endpoint'),
  dsn: document.getElementById('dsn'),
  boot: document.getElementById('boot'),
  bootState: document.getElementById('boot-state'),
  mode: document.getElementById('mode'),
  exposeRetryAfter: document.getElementById('expose-retry-after'),
  events: document.getElementById('events'),
  feedHint: document.getElementById('feed-hint'),
  showRaw: document.getElementById('show-raw'),
  clear: document.getElementById('clear'),
  tallyAttempted: document.getElementById('tally-attempted'),
  tallyReceived: document.getElementById('tally-received'),
};

el.endpoint.value = `${ingestOrigin}/api/log`;

let started = false;
let attempted = 0;
let received = 0;

/** Count every call into the SDK, so drops are visible against what arrived. */
function attempt(times = 1) {
  attempted += times;
  el.tallyAttempted.textContent = String(attempted);
}

function requireClient() {
  if (!started) {
    el.bootState.textContent = 'initialise the SDK first';
    el.bootState.className = 'status failed';
    return false;
  }
  return true;
}

el.boot.addEventListener('click', () => {
  const dsn = el.dsn.value.trim();
  const endpoint = el.endpoint.value.trim();

  try {
    // init() installs global handlers and wraps console, fetch and XHR. It is
    // not idempotent, so the playground only ever calls it once per page load.
    window.LaraBug.init({
      ...(dsn ? { dsn } : { endpoint, login_key: 'playground-login-key', project_key: 'playground-project' }),
      environment: 'playground',
      release: 'playground@0.0.0',
      // The transport retries on its own; one retry keeps the demo readable.
      transport: { retries: 2 },
    });

    started = true;
    el.boot.disabled = true;
    el.endpoint.disabled = true;
    el.dsn.disabled = true;
    el.bootState.textContent = dsn ? 'initialised from DSN' : `initialised, posting to ${endpoint}`;
    el.bootState.className = 'status ready';
  } catch (error) {
    el.bootState.textContent = String(error && error.message ? error.message : error);
    el.bootState.className = 'status failed';
  }
});

/* ------------------------------------------------------------------ *
 * Fake ingest server controls
 * ------------------------------------------------------------------ */

async function postControl(path, body) {
  const response = await nativeFetch(`${ingestOrigin}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return response.json();
}

el.mode.addEventListener('change', () => postControl('/__mode', { mode: el.mode.value }));

el.exposeRetryAfter.addEventListener('change', () =>
  postControl('/__mode', { exposeRetryAfter: el.exposeRetryAfter.checked })
);

el.clear.addEventListener('click', async () => {
  await postControl('/__reset');
  el.events.replaceChildren();
  el.feedHint.textContent = 'Nothing yet. Initialise the SDK and press a button.';
  received = 0;
  attempted = 0;
  el.tallyReceived.textContent = '0';
  el.tallyAttempted.textContent = '0';
  el.feedHint.hidden = false;
});

el.showRaw.addEventListener('change', () => {
  for (const pre of el.events.querySelectorAll('pre.raw')) {
    pre.hidden = !el.showRaw.checked;
  }
});

function fillModes(state) {
  if (el.mode.options.length > 0) return;
  for (const [value, label] of Object.entries(state.modes)) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    el.mode.append(option);
  }
  el.mode.value = state.mode;
  el.exposeRetryAfter.checked = state.exposeRetryAfter;
}

/* ------------------------------------------------------------------ *
 * Scenarios
 * ------------------------------------------------------------------ */

const scenarios = {
  /** window.onerror: the classic "cannot read property of null". */
  'uncaught-type-error'() {
    if (!requireClient()) return;
    attempt();
    const config = null;
    // eslint-disable-next-line no-unused-expressions
    config.apiKey.trim();
  },

  /** Thrown off the call stack, so nothing in user code can catch it. */
  'async-throw'() {
    if (!requireClient()) return;
    attempt();
    setTimeout(() => {
      throw new RangeError('Checkout total fell outside the allowed range');
    }, 0);
  },

  /** window.onunhandledrejection. */
  'unhandled-rejection'() {
    if (!requireClient()) return;
    attempt();
    Promise.reject(new Error('POST /api/checkout failed after 3 attempts'));
  },

  /** Rejecting with a plain value: the SDK has to synthesise an Error. */
  'thrown-string'() {
    if (!requireClient()) return;
    attempt();
    Promise.reject('session expired');
  },

  'capture-exception'() {
    if (!requireClient()) return;
    attempt();
    window.LaraBug.captureException(new TypeError('Cart total is not a number'), {
      cart_id: 'cart_9f2b',
      line_items: 3,
      currency: 'EUR',
    });
  },

  'capture-message'() {
    if (!requireClient()) return;
    attempt();
    window.LaraBug.captureMessage('Payment provider took 8.4s to respond', 'warning');
  },

  'set-user'() {
    if (!requireClient()) return;
    attempt();
    window.LaraBug.setUser({ id: 4127, email: 'demo@larabug-app.test', name: 'Demo User' });
    window.LaraBug.setTag('checkout_step', 'payment');
    window.LaraBug.captureException(new Error('Payment intent was already captured'));
  },

  /**
   * Secrets in several shapes at once. Everything reaching the server should
   * come back as [FILTERED]; the raw payload view is there to check.
   */
  sensitive() {
    if (!requireClient()) return;
    attempt();
    window.LaraBug.setContext('request', {
      url: 'https://shop.test/checkout?access_token=tok_live_51H8sPl&plan=pro',
      headers: { authorization: 'Bearer sk_live_51H8sPlKz', 'x-request-id': 'req_882' },
      body: { email: 'demo@larabug-app.test', password: 'hunter2', card_number: '4242424242424242' },
    });
    window.LaraBug.captureException(
      new Error('Charge declined for https://shop.test/pay?api_key=sk_live_51H8sPlKz')
    );
  },

  /** Console, fetch and navigation breadcrumbs, then the error they led to. */
  async breadcrumbs() {
    if (!requireClient()) return;
    console.info('Loading checkout');
    console.warn('Coupon SPRING24 has expired');

    // Goes through the wrapped fetch on purpose, to produce an http breadcrumb.
    try {
      await window.fetch(`${ingestOrigin}/__state?token=tok_live_should_be_filtered`);
    } catch {
      // The breadcrumb is the point; a failure here is fine.
    }

    // Query strings rather than paths, so a reload still lands on this page.
    history.pushState({}, '', '/?step=payment');
    history.pushState({}, '', '/?step=confirm');

    attempt();
    window.LaraBug.captureException(new Error('Confirm step rendered without a payment method'));
  },

  /** Same error five times inside the dedupe window: one should get through. */
  duplicates() {
    if (!requireClient()) return;
    for (let i = 0; i < 5; i++) {
      attempt();
      window.LaraBug.captureException(new Error('Widget failed to mount'));
    }
  },

  /** 120 distinct errors against a default cap of 100 per minute. */
  flood() {
    if (!requireClient()) return;
    for (let i = 0; i < 120; i++) {
      attempt();
      window.LaraBug.captureException(new Error(`Row ${i} failed to render`));
    }
  },

  /**
   * The transport posts with `keepalive: true`, which browsers cap at 64 KiB
   * of request body. This pushes a payload past that cap on purpose.
   */
  'large-payload'() {
    if (!requireClient()) return;
    const blob = 'x'.repeat(4096);
    const wide = {};
    for (let i = 0; i < 40; i++) {
      wide[`field_${i}`] = blob;
    }
    attempt();
    window.LaraBug.captureException(new Error('Order import failed'), { imported_rows: wide });
  },
};

for (const button of document.querySelectorAll('[data-scenario]')) {
  button.addEventListener('click', () => {
    const scenario = scenarios[button.dataset.scenario];
    // Scenarios that throw on purpose must reach window.onerror rather than
    // this listener, so they are run off the stack.
    setTimeout(scenario, 0);
  });
}

/* ------------------------------------------------------------------ *
 * Live feed of what the server received
 * ------------------------------------------------------------------ */

function badgeClassFor(status) {
  if (status >= 200 && status < 300) return 'badge ok';
  if (status === 402 || status === 429) return 'badge warn';
  return 'badge bad';
}

function describeValue(value) {
  return JSON.stringify(value, null, 2) ?? String(value);
}

/** Render the parts of a payload most worth eyeballing, secrets included. */
function renderEvent(record) {
  const item = document.createElement('li');
  item.className = 'event';

  const head = document.createElement('div');
  head.className = 'event-head';

  const status = document.createElement('span');
  status.className = badgeClassFor(record.answeredWith);
  status.textContent = `${record.answeredWith}${record.retryAfter === null ? '' : ` · Retry-After ${record.retryAfter}s`}`;
  head.append(status);

  const title = document.createElement('span');
  title.className = 'event-title';
  const summary = record.summary;
  title.textContent = summary
    ? `${summary.exceptionType ?? summary.level ?? 'event'}: ${summary.message ?? '(no message)'}`
    : 'Unparseable payload';
  head.append(title);
  item.append(head);

  const meta = document.createElement('div');
  meta.className = 'event-meta';
  const bits = [
    `#${record.id}`,
    new Date(record.at).toLocaleTimeString(),
    `${(record.bytes / 1024).toFixed(1)} KiB`,
  ];
  if (summary) {
    bits.push(`type=${summary.type ?? '?'}`);
    bits.push(`project=${summary.project ?? '?'}`);
    bits.push(`${summary.frameCount} frames`);
    bits.push(`${summary.breadcrumbCount} breadcrumbs`);
  }
  bits.push(record.hasBearer ? 'Bearer token sent' : 'no Authorization header');
  meta.textContent = bits.join(' · ');
  item.append(meta);

  if (summary && summary.topFrames.length > 0) {
    const frames = document.createElement('div');
    frames.className = 'frames';
    frames.textContent = summary.topFrames
      .map((frame) => `at ${frame.function} (${frame.filename}:${frame.lineno})`)
      .join('\n');
    item.append(frames);
  }

  if (summary && summary.user) {
    const user = document.createElement('div');
    user.className = 'kv';
    user.textContent = `user: ${describeValue(summary.user)}`;
    item.append(user);
  }

  if (summary && summary.context && Object.keys(summary.context).length > 0) {
    const context = document.createElement('div');
    context.className = 'kv';
    context.textContent = `context: ${describeValue(summary.context)}`;
    item.append(context);
  }

  const raw = document.createElement('pre');
  raw.className = 'raw';
  raw.hidden = !el.showRaw.checked;
  raw.textContent = describeValue(record.payload ?? record.parseError);
  item.append(raw);

  el.feedHint.hidden = true;
  el.events.prepend(item);

  received += 1;
  el.tallyReceived.textContent = String(received);
}

function connect() {
  const stream = new EventSource(`${ingestOrigin}/__stream`);

  stream.addEventListener('message', (message) => {
    const frame = JSON.parse(message.data);
    if (frame.kind === 'hello' || frame.kind === 'state') {
      fillModes(frame.state);
      return;
    }
    if (frame.kind === 'event') {
      renderEvent(frame.record);
    }
  });

  stream.addEventListener('error', () => {
    el.feedHint.hidden = false;
    el.feedHint.textContent = 'Lost the connection to the ingest server. Is it still running?';
  });
}

connect();
