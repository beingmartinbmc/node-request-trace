# node-request-trace

[![CI](https://github.com/beingmartinbmc/node-request-trace/actions/workflows/ci.yml/badge.svg)](https://github.com/beingmartinbmc/node-request-trace/actions/workflows/ci.yml)
[![Coverage: 100%](https://img.shields.io/badge/coverage-100%25-brightgreen)](https://github.com/beingmartinbmc/node-request-trace)
[![Node >= 16](https://img.shields.io/badge/node-%3E%3D16-blue)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](./LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](./package.json)

Request tracing and performance visualization library for Node.js. Inspect the full execution lifecycle of API requests, detect performance bottlenecks, identify slow middleware or async operations, and debug production issues quickly.

## Features

- **Request Tracing** — Full lifecycle tracking with async context propagation via `AsyncLocalStorage`
- **Step Tracking** — Manual instrumentation for DB calls, service calls, async operations
- **Automatic Middleware Instrumentation** — Auto-capture middleware timing for Express, Fastify lifecycle phases, and Koa
- **HTTP Client Tracing** — Auto-instrument outgoing `http`, `https`, and `fetch` requests
- **Framework Support** — Express.js, Fastify, and Koa
- **UI Dashboard** — Built-in real-time visualization at `/trace/ui` with Waterfall, Timeline, and Flamegraph views
- **CLI Tool** — Inspect traces from the terminal with `npx node-request-trace`
- **Chrome Trace Export** — Export traces to `chrome://tracing` format for performance engineers
- **HTTP API** — JSON endpoints for trace retrieval and statistics
- **Slow Request Detection** — Configurable threshold with automatic flagging
- **Sampling** — Configurable rate to reduce overhead in production
- **Logging** — Pino, Winston, console, and custom logger integration
- **Security** — Automatic sensitive header redaction, body logging disabled by default
- **Zero Dependencies** — Uses only Node.js built-ins
- **Minimal Overhead** — Adds <1ms per request

## Architecture

The library has three core components:

| Trace Engine | → | Trace Storage | → | UI Dashboard |
|:---:|:---:|:---:|:---:|:---:|
| AsyncLocalStorage context | | In-memory store | | Real-time visualization |
| + step tracking | | with eviction & retention | | at `/trace/ui` |

## Installation

```bash
npm install node-request-trace
```

## Quick Start (Express)

```js
const express = require("express");
const trace = require("node-request-trace");

trace.init({
  slowThreshold: 200,
  samplingRate: 1,
  maxTraces: 1000,
});

const app = express();

app.use(trace.middleware());
app.use(trace.routes());

app.get("/checkout", async (req, res) => {
  await trace.step("dbQuery", async () => {
    await db.findUser(1);
  });

  await trace.step("paymentService", async () => {
    await payments.charge(amount);
  });

  res.send("done");
});

app.listen(3000);
// Dashboard: http://localhost:3000/trace/ui
```

## Core Concepts

### Request Trace

A trace represents the complete lifecycle of a single HTTP request:

```json
{
  "requestId": "req_a1b2c3d4e5f6",
  "method": "GET",
  "path": "/checkout",
  "startTime": 1700000000000,
  "duration": 340,
  "status": 200,
  "steps": [
    { "name": "authMiddleware", "start": 1700000000002, "duration": 12 },
    { "name": "validateInput", "start": 1700000000014, "duration": 5 },
    { "name": "dbQuery", "start": 1700000000019, "duration": 210 },
    { "name": "paymentService", "start": 1700000000229, "duration": 45 },
    { "name": "responseRender", "start": 1700000000274, "duration": 30 }
  ]
}
```

### Trace Step

Each operation performed during request execution is recorded as a step with its name, start time, and duration. Use `trace.step()` to instrument any operation:

```js
await trace.step("dbQuery", async () => {
  return await db.query("SELECT * FROM users WHERE id = ?", [id]);
});
```

Steps are recorded even if they throw — the error is captured and the exception is re-thrown so your error handling works normally.

### Async Context Tracking

Tracing persists across all asynchronous operations using Node.js `AsyncLocalStorage`. This means `trace.current()` and `trace.step()` work correctly inside:

- async/await
- Promises
- setTimeout / setInterval
- Callbacks

```js
app.get("/api", async (req, res) => {
  // trace.current() returns the active trace anywhere in the call stack
  const currentTrace = trace.current();
  console.log(currentTrace.requestId);

  await trace.step("nestedWork", async () => {
    // Still has access to the same trace context
    await someAsyncFunction();
  });

  res.send("ok");
});
```

## Configuration

```js
trace.init({
  slowThreshold: 200,      // ms — requests above this are flagged slow
  samplingRate: 1,          // 0-1 — fraction of requests to trace (0.1 = 10%)
  maxTraces: 1000,          // max traces kept in memory
  retentionSeconds: 300,    // auto-evict traces older than this (seconds)
  autoTrack: false,         // auto-track middleware execution times
  traceOutgoing: false,     // auto-trace outgoing http/https/fetch requests
  sensitiveHeaders: null,   // custom list of headers to redact (string[])
});
```

| Option | Default | Description |
|---|---|---|
| `slowThreshold` | `200` | Duration in ms above which a request is flagged slow |
| `samplingRate` | `1` | Fraction of requests to trace (`1` = 100%, `0.1` = 10%) |
| `maxTraces` | `1000` | Maximum traces held in memory; oldest evicted when full |
| `retentionSeconds` | `300` | Traces older than this are automatically evicted |
| `autoTrack` | `false` | Auto-instrument middleware for Express, Fastify lifecycle, Koa |
| `traceOutgoing` | `false` | Auto-trace outgoing `http`, `https`, and `fetch` requests |
| `sensitiveHeaders` | `null` | Custom array of header names to redact (overrides defaults) |

## API Reference

### `trace.init(options)`

Initialize the tracer with configuration. Can be called multiple times to reconfigure. Auto-initializes with defaults if you call `middleware()` without calling `init()` first.

### `trace.middleware()`

Returns Express/Connect middleware that intercepts incoming requests. Attaches a trace to each request, captures timing, and finalizes on response end.

### `trace.fastifyPlugin()`

Returns a Fastify plugin. Register with:

```js
fastify.register(trace.fastifyPlugin());
```

### `trace.koaMiddleware()`

Returns Koa middleware.

### `trace.routes()`

Returns middleware that serves the trace HTTP endpoints and the UI dashboard. Mount it in your app:

```js
app.use(trace.routes());
```

### `trace.step(name, fn)`

Track an async operation within the current request. Returns the value from `fn`. If `fn` throws, the error is recorded in the step and re-thrown.

```js
const user = await trace.step("dbQuery", async () => {
  return await db.findUser(id);
});
```

### `trace.current()`

Returns the current request trace object, or `null` if called outside a traced request. Works across async boundaries.

### `trace.useLogger(type, logger)`

Attach a logger for trace output. Returns `this` for chaining.

### `trace.instrumentKoa(app)`

Patches `app.use()` on a Koa instance to automatically wrap each middleware with timing. Requires `autoTrack: true`.

```js
const app = new Koa();
trace.instrumentKoa(app); // patches app.use()
app.use(authMiddleware);   // automatically timed
app.use(validateInput);    // automatically timed
```

### `trace.enableHttpTracing()`

Manually enable outgoing HTTP client tracing. Monkey-patches `http.request`, `http.get`, `https.request`, `https.get`, and `globalThis.fetch`. Alternatively, set `traceOutgoing: true` in `init()`.

### `trace.disableHttpTracing()`

Restore original HTTP functions and stop tracing outgoing requests.

### `trace.isHttpTracingEnabled()`

Returns `true` if outgoing HTTP tracing is currently active.

### `trace.exportChromeTrace(trace)`

Convert a trace object to [Chrome Trace Event Format](https://docs.google.com/document/d/1CvAClvFfyA5R-PhYUmn5OOQtYMH4h6I0nSsKchNAySU). Returns a `{ traceEvents: [...] }` object.

### `trace.exportChromeTraceJson(trace)`

Same as above but returns a JSON string ready for file export.

### `trace.sanitizeHeaders(headers)`

Returns a copy of headers with sensitive values replaced by `[REDACTED]`.

### `trace.destroy()`

Clean up storage intervals, clear all stored traces, and disable HTTP tracing.

## HTTP Endpoints

Mount with `app.use(trace.routes())` to enable these endpoints:

| Endpoint | Description |
|---|---|
| `GET /trace/ui` | Interactive dashboard UI |
| `GET /trace/recent` | Last 50 traces as JSON |
| `GET /trace/slow` | Traces exceeding `slowThreshold` |
| `GET /trace/stats` | Aggregate statistics |
| `GET /trace/:requestId` | Single trace by request ID |
| `GET /trace/:requestId/chrome` | Chrome Trace Event Format export |

### Example: `/trace/stats` response

```json
{
  "totalRequests": 1024,
  "avgLatency": 85,
  "slowRequests": 14,
  "errorRate": 2.1,
  "requestsPerSec": 12.5
}
```

### Example: `/trace/:requestId` response

```json
{
  "requestId": "req_a1b2c3d4e5f6",
  "method": "GET",
  "path": "/checkout",
  "startTime": 1700000000000,
  "duration": 340,
  "status": 200,
  "steps": [
    { "name": "auth", "start": 1700000000002, "duration": 12 },
    { "name": "dbQuery", "start": 1700000000014, "duration": 210 }
  ]
}
```

## UI Dashboard

Accessible at `/trace/ui`. The dashboard provides:

### Overview Metrics
- **Requests/sec** — Current throughput
- **Avg Latency** — Mean response time
- **Slow Requests** — Count exceeding threshold
- **Error Rate** — Percentage of 4xx/5xx responses

### Recent Requests Table
Sortable table showing request ID, method, path, duration, status, and timestamp. Click any row to view the full trace detail.

### Request Detail with View Modes

Click any request to see its full detail with three visualization modes:

**Waterfall** — Bars proportional to step duration (default):
```
authMiddleware  |████|                              12ms
validateInput   |██|                                 5ms
dbQuery         |██████████████████████████████|   210ms
paymentService  |██████████|                        45ms
responseRender  |████████|                          30ms
```

**Timeline** — Time-proportional positioning showing when each step started and how long it ran:
```
|-------------- request 340ms ----------------|
auth        |██|
validation    |█|
dbQuery         |████████████████████████|
payment                                   |████|
render                                          |██|
0ms                                          340ms
```

**Flamegraph** — Compact stacked view showing step durations as proportional blocks:
```
[auth][val][      dbQuery        ][payment][render]
0ms                                           340ms
```

Each detail view also includes a **⬇ Chrome Trace** export button.

### Slow Requests View
Filtered view showing only requests exceeding the configured `slowThreshold`.

### Real-Time Feed
Live-updating view of incoming requests, auto-refreshing every 3 seconds.

## Slow Request Detection

Requests exceeding the configured `slowThreshold` are automatically flagged:

```js
trace.init({ slowThreshold: 200 }); // flag requests > 200ms
```

Slow requests are:
- Marked with `_slow: true` on the trace object
- Logged at `warn` level (when a logger is attached)
- Filterable via `GET /trace/slow`
- Highlighted in the dashboard UI

## Sampling

In production, trace a subset of requests to minimize overhead:

```js
trace.init({ samplingRate: 0.1 }); // trace 10% of requests
```

Un-sampled requests pass through with zero overhead — the middleware calls `next()` immediately.

## Request Correlation

Every traced request gets an `X-Request-ID` response header:

- If the incoming request has `X-Request-ID`, it is **reused**
- Otherwise, a new ID is **generated** (format: `req_<16 hex chars>`)

This enables correlation across microservices by forwarding the header.

## Trace Storage

Traces are stored in memory with configurable limits:

```js
trace.init({
  maxTraces: 500,         // evict oldest when full
  retentionSeconds: 120,  // auto-evict after 2 minutes
});
```

A background cleanup runs periodically to evict expired traces without blocking the event loop.

## Framework Examples

### Express

```js
const express = require("express");
const trace = require("node-request-trace");

trace.init();
const app = express();

app.use(trace.middleware());
app.use(trace.routes());

app.get("/checkout", async (req, res) => {
  await trace.step("dbQuery", async () => {
    await db.findUser(1);
  });
  res.json({ message: "done" });
});

app.listen(3000);
```

### Fastify

```js
const fastify = require("fastify")();
const trace = require("node-request-trace");

trace.init();
fastify.register(trace.fastifyPlugin());

fastify.get("/api", async (request, reply) => {
  await trace.step("work", async () => { /* ... */ });
  return { ok: true };
});

fastify.listen({ port: 3000 });
```

### Koa

```js
const Koa = require("koa");
const trace = require("node-request-trace");

trace.init();
const app = new Koa();

app.use(trace.koaMiddleware());

app.use(async (ctx) => {
  await trace.step("work", async () => { /* ... */ });
  ctx.body = "done";
});

app.listen(3000);
```

## Automatic Middleware Instrumentation

Enable `autoTrack: true` to automatically capture middleware timing without manual `trace.step()` calls.

### Express

Express middleware layers are automatically wrapped to record each middleware's execution time:

```js
trace.init({ autoTrack: true });
app.use(trace.middleware());
```

Example trace output:
```
authMiddleware: 12ms
validateInput: 5ms
handler: 210ms
```

### Fastify

Fastify lifecycle phases are automatically timed:

```js
trace.init({ autoTrack: true });
fastify.register(trace.fastifyPlugin());
```

Records: `onRequest`, `preParsing`, `preValidation`, `handler`, `onSend` — each as a step with `type: "lifecycle"`.

### Koa

Patch the Koa app to wrap each `app.use()` call with timing:

```js
trace.init({ autoTrack: true });
const app = new Koa();
trace.instrumentKoa(app);

app.use(authMiddleware);   // auto-timed as "authMiddleware"
app.use(validateInput);    // auto-timed as "validateInput"
app.use(trace.koaMiddleware());
```

Each middleware is recorded as a step with `type: "middleware"`.

## HTTP Client Tracing

Automatically capture outgoing HTTP requests as trace steps:

```js
trace.init({ traceOutgoing: true });
```

Or enable/disable manually:

```js
trace.enableHttpTracing();
// ... make requests ...
trace.disableHttpTracing();
```

Instruments `http.request`, `http.get`, `https.request`, `https.get`, and `globalThis.fetch` (Node 18+).

Example trace with outgoing calls:
```
GET /checkout
├─ dbQuery                    210ms
├─ HTTP POST stripe.com/v1    180ms  [http-outgoing]
├─ redis.get                   5ms
└─ HTTP GET cdn.example.com    45ms  [http-outgoing]
```

Outgoing steps are recorded with `type: "http-outgoing"` and include the method, host, and path.

## CLI Tool

Inspect traces from the terminal without the UI dashboard:

```bash
# Show aggregate statistics
npx node-request-trace stats http://localhost:3000

# List recent traces
npx node-request-trace recent http://localhost:3000

# List slow traces
npx node-request-trace slow http://localhost:3000

# Inspect a single trace with timeline + flamegraph
npx node-request-trace inspect http://localhost:3000 req_a1b2c3d4

# Live tail incoming requests
npx node-request-trace tail http://localhost:3000

# Export trace as Chrome Trace Event JSON
npx node-request-trace export http://localhost:3000 req_a1b2c3d4 > trace.json
```

The CLI uses ANSI colors and renders waterfall bars, flamegraph blocks, and formatted tables directly in the terminal.

## Chrome Trace Export

Export any trace in [Chrome Trace Event Format](https://docs.google.com/document/d/1CvAClvFfyA5R-PhYUmn5OOQtYMH4h6I0nSsKchNAySU) for analysis in `chrome://tracing` or other performance tools.

### Via HTTP endpoint

```bash
curl http://localhost:3000/trace/req_a1b2c3d4/chrome > trace.json
```

### Via API

```js
const traceData = tracer.storage.get("req_a1b2c3d4");
const chromeTrace = trace.exportChromeTrace(traceData);
// or as JSON string
const json = trace.exportChromeTraceJson(traceData);
```

### Via Dashboard

Click the **⬇ Chrome Trace** button in any trace detail view to download the file.

### Via CLI

```bash
npx node-request-trace export http://localhost:3000 req_a1b2c3d4 > trace.json
```

Open the exported file in `chrome://tracing` to see a full timeline visualization with request and step events on separate threads.

## Logging Integration

```js
// Pino
const pino = require("pino")();
trace.useLogger("pino", pino);

// Winston
const winston = require("winston");
const logger = winston.createLogger({ /* ... */ });
trace.useLogger("winston", logger);

// Console — logs to stdout/stderr
trace.useLogger("console");

// Custom logger
trace.useLogger({
  onTrace(trace) {
    myLogger.log(trace);
  },
});
```

Example console output:

```
TRACE GET /checkout 340ms (200)
  authMiddleware: 12ms
  validateInput: 5ms
  dbQuery: 210ms
  paymentService: 45ms
  responseRender: 30ms
```

Slow requests log at `warn` level:

```
[SLOW] TRACE GET /checkout 340ms (200)
  dbQuery: 210ms
```

## Security

The library avoids logging sensitive data by default:

- **Body logging is disabled** — request/response bodies are never captured
- **Sensitive headers are redacted** — the following headers are replaced with `[REDACTED]`:
  - `Authorization`
  - `Cookie` / `Set-Cookie`
  - `X-API-Key`
  - `X-Auth-Token`
  - `Proxy-Authorization`

Customize the redaction list:

```js
trace.init({
  sensitiveHeaders: ["Authorization", "X-Custom-Secret"],
});

// Or use the utility directly
const safe = trace.sanitizeHeaders(req.headers);
```

## Performance

The library is designed for minimal impact:

- **<1ms overhead** per request when tracing is active
- **Zero overhead** for un-sampled requests (sampling short-circuits immediately)
- **Non-blocking** background cleanup for trace eviction
- **No external dependencies** — only Node.js built-ins (`async_hooks`, `crypto`)
- **Efficient in-memory storage** using `Map` with O(1) lookups

## Running the Example

```bash
npm run example
# Server at http://localhost:3000
# Dashboard at http://localhost:3000/trace/ui
#
# Try:
#   curl http://localhost:3000/checkout
#   curl http://localhost:3000/fast
#   curl http://localhost:3000/error
```

## Running Tests

```bash
npm test                 # run tests
npm run test:coverage    # run with 100% coverage enforcement
```

## License

MIT
