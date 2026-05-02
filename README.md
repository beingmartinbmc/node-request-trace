# node-request-trace

[![CI](https://github.com/beingmartinbmc/node-request-trace/actions/workflows/ci.yml/badge.svg)](https://github.com/beingmartinbmc/node-request-trace/actions/workflows/ci.yml)
[![Coverage: >=90%](https://img.shields.io/badge/coverage-%3E%3D90%25-brightgreen)](https://github.com/beingmartinbmc/node-request-trace)
[![Node >= 16](https://img.shields.io/badge/node-%3E%3D16-blue)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](./LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](./package.json)

Debug any Node.js request like a timeline.

`node-request-trace` shows what happened inside a request, where the time went, and which step caused the slowdown, without asking you to adopt OpenTelemetry, run a collector, or wire up a tracing backend.

```txt
GET /checkout 340ms (200)
requestId: req_a1b2c3d4e5f6
bottleneck: dbQuery 210ms (61.8%)
coverage: 302ms traced (88.8%), 38ms uninstrumented
0ms |------------------------------------------------| 340ms
|- authMiddleware           ## 12ms
|- validateInput              # 5ms
|- dbQuery                    ############################## 210ms
`- paymentService                                             ###### 45ms
```

## Why This Exists

OpenTelemetry is powerful, standard, and absolutely worth using for large production observability stacks. It is also a lot when you just want to answer one local question:

> Why was this request slow?

`node-request-trace` is for that moment. Add middleware, wrap important work in `trace.step()`, and immediately get request timelines, bottleneck detection, outgoing HTTP tracing, a browser dashboard, Chrome trace export, and terminal-friendly reports.

## The Pitch

```js
const express = require("express");
const trace = require("node-request-trace");

trace.init({
  slowThreshold: 200,
  traceOutgoing: true,
});

const app = express();

app.use(trace.middleware());
app.use(trace.routes());

app.get("/checkout", async (req, res) => {
  await trace.step("loadUser", () => users.find(req.query.userId));
  await trace.step("chargeCard", () => payments.charge(req.body));
  res.json({ ok: true });
});

app.listen(3000);
```

Now open the dashboard:

```bash
open http://localhost:3000/trace/ui
```

Or inspect the same request from the terminal:

```bash
npx node-request-trace timeline http://localhost:3000 req_a1b2c3d4e5f6
```

## What You Get

- Request timelines with bottleneck, traced coverage, and uninstrumented gap detection.
- Async context propagation through `AsyncLocalStorage`.
- Manual `trace.step()` spans for database calls, service calls, queues, cache reads, and any async work.
- Automatic Express, Fastify, and Koa middleware/lifecycle timing.
- Outgoing `http`, `https`, and `fetch` tracing.
- Built-in dashboard at `/trace/ui`.
- CLI for stats, recent traces, slow traces, timeline reports, tailing, and exports.
- Chrome Trace Event export for `chrome://tracing`.
- Sampling, slow request detection, retention limits, and in-memory eviction.
- Header redaction by default and no request body capture.
- Zero runtime dependencies.

## When To Use It

Use `node-request-trace` when you want a lightweight developer experience:

- You are debugging slow Node.js API requests.
- You want copy-pasteable trace output for PRs, issues, and incident notes.
- You do not want to run a collector, agent, backend, or dashboard service.
- You want local tracing now and can move to OpenTelemetry later if needed.

Use OpenTelemetry when you need distributed traces across many services, vendor integration, long-term retention, metrics/log correlation, or organization-wide observability standards.

## Ecosystem

`node-request-trace` is part of a small Node.js observability ecosystem you can adopt independently or together:

- [`node-actuator-lite`](https://github.com/beingmartinbmc/node-actuator-lite) — Spring Boot-style `/actuator/health`, `/info`, `/metrics`, `/env`, `/threaddump`, `/heapdump`, and `/prometheus` endpoints.
- [`node-eventloop-watchdog`](https://github.com/beingmartinbmc/node-eventloop-watchdog) — Detects event-loop stalls, captures stack traces and hotspots, and triggers recovery.
- **`node-request-trace`** — Per-request timelines, browser dashboard, and CLI without OpenTelemetry.

When all three are installed:

- `node-eventloop-watchdog` automatically registers `/actuator/eventloop`, `/actuator/eventloop/history`, `/actuator/eventloop/hotspots`, and `/actuator/eventloop/metrics` under `node-actuator-lite`.
- Event-loop block events include the active request id, route, and method captured by this tracer via `getCurrentRequestContext()`.

Runnable example: [`node-actuator-lite/examples/ecosystem`](https://github.com/beingmartinbmc/node-actuator-lite/tree/main/examples/ecosystem).

> **Quickest setup:** Use [`node-observability-lite`](https://github.com/beingmartinbmc/node-observability-lite) to wire the three packages together with production-safe presets in one line.
>
> ```js
> const observability = require('node-observability-lite');
> observability.express(app, {
>   preset: 'production',
>   auth: req => req.get('authorization') === `Bearer ${process.env.OPS_TOKEN}`,
> });
> ```

## Installation

```bash
npm install node-request-trace
```

The package supports Node.js 16 and newer. It has optional peer support for Express, Fastify, and Koa, but no runtime dependencies of its own.

## Quick Start

### Express

```js
const express = require("express");
const trace = require("node-request-trace");

trace.init({
  slowThreshold: 200,
  samplingRate: 1,
  traceOutgoing: true,
});

const app = express();

app.use(trace.middleware());
app.use(trace.routes());

app.get("/api/order/:id", async (req, res) => {
  const order = await trace.step("db.order.find", () => db.orders.find(req.params.id));
  const quote = await trace.step("shipping.quote", () => shipping.quote(order));
  res.json({ order, quote });
});

app.listen(3000);
```

### Fastify

```js
const fastify = require("fastify")();
const trace = require("node-request-trace");

trace.init({ autoTrack: true });

fastify.register(trace.fastifyPlugin());

fastify.get("/api", async () => {
  await trace.step("work", async () => {
    // Your code here.
  });
  return { ok: true };
});
```

### Koa

```js
const Koa = require("koa");
const trace = require("node-request-trace");

trace.init({ autoTrack: true });

const app = new Koa();
trace.instrumentKoa(app);

app.use(trace.koaMiddleware());
app.use(async (ctx) => {
  await trace.step("work", async () => {
    // Your code here.
  });
  ctx.body = { ok: true };
});
```

## Timeline Reports

Timeline reports are the main developer experience.

```js
const report = trace.timeline(savedTrace);

console.log(report.summary.bottleneck);
console.log(trace.renderTimeline(savedTrace, { width: 80 }));
```

Structured reports include:

- `steps`: normalized request steps sorted by start time.
- `summary.bottleneck`: the slowest step.
- `summary.topSteps`: the top five slowest steps.
- `summary.coveredDuration`: time covered by recorded steps.
- `summary.uninstrumentedDuration`: request time not explained by recorded steps.
- `summary.coveragePercent`: how much of the request timeline is explained.
- `summary.gaps`: idle or uninstrumented windows between steps.
- `summary.errorCount`: number of failed steps.

This makes it easy to answer:

- Did the database cause the slowdown?
- Did middleware run before the handler?
- How much of the request is still a blind spot?
- Which step should I optimize first?

## Manual Instrumentation

Use `trace.step(name, fn)` around any async operation you care about.

```js
const user = await trace.step("db.user.findById", async () => {
  return db.users.findById(userId);
});
```

Steps are recorded whether they succeed or fail. If the wrapped function throws, the error is attached to the step and then re-thrown so your application behavior stays the same.

## Automatic Instrumentation

### Middleware Timing

Enable `autoTrack` to capture framework lifecycle and middleware timing.

```js
trace.init({ autoTrack: true });
```

Express records middleware layers. Fastify records lifecycle phases such as `onRequest`, `preParsing`, `preValidation`, `handler`, and `onSend`. Koa wraps `app.use()` middleware after `trace.instrumentKoa(app)`.

### Outgoing HTTP

Enable outgoing HTTP tracing to automatically capture calls made with Node's `http`, `https`, and global `fetch`.

```js
trace.init({ traceOutgoing: true });
```

Or toggle it manually:

```js
trace.enableHttpTracing();
trace.disableHttpTracing();
```

Outgoing calls are added as `http-outgoing` steps:

```txt
HTTP POST api.stripe.com/v1/charges 180ms [http-outgoing]
HTTP GET cdn.example.com/assets      45ms [http-outgoing]
```

## Dashboard

Mount `trace.routes()` and visit `/trace/ui`.

```js
app.use(trace.routes());
```

The dashboard includes:

- Recent request table.
- Slow request view.
- Live feed.
- Request detail view.
- Waterfall, timeline, and flamegraph modes.
- Chrome trace export button.

## CLI

The CLI talks to any app that has `trace.routes()` mounted.

```bash
npx node-request-trace stats http://localhost:3000
npx node-request-trace recent http://localhost:3000
npx node-request-trace slow http://localhost:3000
npx node-request-trace inspect http://localhost:3000 req_a1b2c3d4
npx node-request-trace timeline http://localhost:3000 req_a1b2c3d4
npx node-request-trace tail http://localhost:3000
npx node-request-trace export http://localhost:3000 req_a1b2c3d4 > trace.json
```

Use `timeline` when you want the fastest answer. Use `inspect` when you want the fuller detail view. Use `export` when you want to load the trace in `chrome://tracing`.

## HTTP API

| Endpoint | Description |
|---|---|
| `GET /trace/ui` | Browser dashboard |
| `GET /trace/recent` | Last 50 traces |
| `GET /trace/slow` | Slow traces using `slowThreshold` |
| `GET /trace/stats` | Aggregate latency, error, and throughput stats |
| `GET /trace/:requestId` | Raw trace JSON |
| `GET /trace/:requestId/timeline` | Timeline report plus ASCII rendering |
| `GET /trace/:requestId/chrome` | Chrome Trace Event JSON |

Example timeline response:

```json
{
  "requestId": "req_a1b2c3d4e5f6",
  "method": "GET",
  "path": "/checkout",
  "totalDuration": 340,
  "stepCount": 4,
  "summary": {
    "bottleneck": { "name": "dbQuery", "duration": 210, "percentOfRequest": 61.8 },
    "coveredDuration": 302,
    "uninstrumentedDuration": 38,
    "coveragePercent": 88.8,
    "errorCount": 0
  },
  "text": "GET /checkout 340ms (200)\\n..."
}
```

## API Reference

### `trace.init(options)`

Initializes tracing. Calling it again replaces the current configuration and storage.

```js
trace.init({
  slowThreshold: 200,
  samplingRate: 1,
  maxTraces: 1000,
  retentionSeconds: 300,
  autoTrack: false,
  traceOutgoing: false,
  sensitiveHeaders: null,
});
```

### `trace.middleware(framework)`

Returns Express-compatible middleware by default. Pass `"koa"` to get Koa middleware.

### `trace.fastifyPlugin()`

Returns a Fastify plugin.

### `trace.koaMiddleware()`

Returns Koa middleware.

### `trace.instrumentKoa(app)`

Patches `app.use()` so Koa middleware can be timed automatically when `autoTrack` is enabled.

### `trace.routes()`

Returns middleware that serves the dashboard and JSON endpoints.

### `trace.step(name, fn)`

Records an async step on the current request trace and returns the wrapped function's result.

### `trace.current()`

Returns the active request trace or `null` outside a traced request.

### `trace.timeline(trace)`

Builds a structured timeline report.

### `trace.renderTimeline(trace, options)`

Builds an ASCII request timeline. Use `options.width` to control the chart width.

### `trace.useLogger(type, logger)`

Supports `"console"`, `"pino"`, `"winston"`, or a custom `{ onTrace(trace) {} }` integration.

### `trace.enableHttpTracing()`

Patches outgoing `http`, `https`, and `fetch` calls.

### `trace.disableHttpTracing()`

Restores the original outgoing HTTP functions.

### `trace.exportChromeTrace(trace)`

Returns Chrome Trace Event Format data.

### `trace.exportChromeTraceJson(trace)`

Returns Chrome Trace Event Format as a JSON string.

### `trace.sanitizeHeaders(headers)`

Redacts sensitive headers using the configured list.

### `trace.destroy()`

Stops cleanup timers, clears stored traces, disables HTTP tracing, and resets the tracer.

## Configuration

| Option | Default | Description |
|---|---:|---|
| `slowThreshold` | `200` | Duration in ms above which a request is marked slow |
| `samplingRate` | `1` | Fraction of requests to trace, from `0` to `1` |
| `maxTraces` | `1000` | Maximum number of traces stored in memory |
| `retentionSeconds` | `300` | How long traces stay in memory |
| `autoTrack` | `false` | Enables framework middleware/lifecycle timing |
| `traceOutgoing` | `false` | Enables outgoing HTTP and fetch tracing |
| `sensitiveHeaders` | `null` | Custom sensitive header list |

## Dev vs Prod

In development, run with full sampling and rich instrumentation:

```js
trace.init({
  samplingRate: 1,
  autoTrack: true,
  traceOutgoing: true,
});
```

In production, keep the footprint smaller:

```js
trace.init({
  samplingRate: 0.05,
  slowThreshold: 500,
  maxTraces: 500,
  retentionSeconds: 120,
});
```

This library stores traces in memory. It is intentionally lightweight and local-first. For long-term retention or cross-service distributed tracing, export the data or use a full observability platform.

## Security

`node-request-trace` avoids sensitive data by default:

- Request and response bodies are not captured.
- Sensitive headers are redacted.
- The default redaction list includes `Authorization`, `Cookie`, `Set-Cookie`, `X-API-Key`, `X-Auth-Token`, and `Proxy-Authorization`.

Customize header redaction:

```js
trace.init({
  sensitiveHeaders: ["authorization", "x-internal-secret"],
});
```

## Performance

The library is designed to stay small:

- No runtime dependencies.
- In-memory `Map` storage with bounded retention.
- Optional sampling.
- Background cleanup timers use `unref()` when available.
- Unsampled requests skip tracing immediately.

## OpenTelemetry Comparison

| Tool | Best For | Tradeoff |
|---|---|---|
| OpenTelemetry | Standards-based distributed tracing across services | More setup and infrastructure |
| Logging libraries | Simple event logs | No request timeline or latency attribution |
| `node-request-trace` | Local-first request timelines and debugging | In-memory, not a full observability backend |

The goal is not to replace OpenTelemetry everywhere. The goal is to make request-level debugging fast, visual, and easy to adopt.

## Running The Example

```bash
npm run example
```

Then try:

```bash
curl http://localhost:3000/checkout
curl http://localhost:3000/fast
curl http://localhost:3000/error
open http://localhost:3000/trace/ui
```

## Testing

```bash
npm test
npm run test:coverage
```

Coverage is enforced at 90% across lines, functions, branches, and statements.

## Release

The repository includes GitHub Actions for CI and release:

- CI runs lint, typecheck, package build, and coverage on Node 20 and 22.
- Release publishes to npm on `v*.*.*` tags and creates a GitHub release.

## License

MIT
