# Playground

A small demo site that exercises the built SDK in a real browser and shows what it reported.

The point is to be able to prove the SDK works without standing up the LaraBug stack and without
reading the source. It loads `packages/browser/dist/index.umd.js` from a single `<script>` tag, the
way a plain site would, and posts to a fake ingest server that records every request.

## Running it

```bash
npm install
npm run build        # the playground serves the built UMD bundle, not the TypeScript
npm run playground
```

Then open http://127.0.0.1:5175.

Two servers come up on loopback:

| Address                    | What it is                                                       |
| -------------------------- | ---------------------------------------------------------------- |
| `http://127.0.0.1:5175`    | the demo site, serving the page and the built bundle             |
| `http://127.0.0.1:5176`    | a stand in for LaraBug's `POST /api/log`                         |

They are deliberately different origins, because that is the shape of a real install: the site is
one host, the ingest endpoint is another. Anything the SDK gets wrong about CORS shows up here
rather than in production.

Ports can be changed with `SITE_PORT` and `INGEST_PORT`.

## What you can do

Press a button, watch the right hand column. Every request the SDK makes is shown with the status
it got back, the parsed event, and (behind the "Raw payload" toggle) the exact JSON body.

**Errors the SDK catches on its own.** An uncaught `TypeError`, a throw from inside `setTimeout`, an
unhandled promise rejection, and a rejection with a non `Error` value. None of these are reported by
the page; they arrive through the SDK's global handlers.

**Errors you report yourself.** `captureException` with context, `captureMessage`, and `setUser` plus
`setTag` followed by a throw.

**Data handling.** One button puts secrets into the context, the headers, the request body and the
error message at once. Everything that arrives should read `[FILTERED]`. Another leaves a trail of
console, fetch and navigation breadcrumbs before throwing, so you can see the breadcrumbs attached
to the event.

**Guardrails.** Throwing the same error five times should produce one request (dedupe). Throwing 120
distinct errors should produce 100 (the per minute cap). The counters under the buttons show calls
made against requests that landed, so the drops are visible. A large payload button pushes the body
past the 64 KiB cap browsers apply to `keepalive` requests.

## Making the server misbehave

The response mode dropdown changes what `POST /api/log` answers with, matching what the v4 app
actually returns:

| Mode             | Response                                    | Where it comes from in the app          |
| ---------------- | ------------------------------------------- | --------------------------------------- |
| `ok`             | `200`                                       | the happy path                          |
| `quota`          | `402` with `Retry-After: 60`                | `hasExceededLimitFor`, metered stream   |
| `quota-silent`   | `402` with no `Retry-After`                 | expired trial, `hasActiveAccess`        |
| `throttled`      | `429` with `Retry-After: 30`                | rate limiting in front of the endpoint  |
| `server-error`   | `500`                                       | transport failure, retries and breaker  |
| `unauthorized`   | `401`                                       | a bad or revoked login key              |

There is also a checkbox for `Access-Control-Expose-Headers`. Turn it off and the server still sends
`Retry-After`, but browser JavaScript cannot read it, because `Retry-After` is not a CORS safelisted
response header. That is worth knowing: the SDK's cooldown handling depends on reading that header
cross origin, and the app has to name it in `exposed_headers` for the SDK to see it at all.

## Pointing at a local LaraBug install

Paste a project DSN into the DSN field before pressing "Initialise SDK" and the SDK will post there
instead. Use a local install, for example `https://login_key:project_key@larabug-app.test/api/log`.
The live feed stays wired to the fake ingest server, so once you switch to a real DSN you read the
results in that install's panel instead.

Nothing in the playground points at a hosted environment, and the endpoint field is prefilled with
loopback so the SDK's own default (`https://www.larabug.com/api/log`) is never used.
