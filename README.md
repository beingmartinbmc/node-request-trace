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
- **Framework Support** — Express.js, Fastify, and Koa
- **UI Dashboard** — Built-in real-time visualization at `/trace/ui`
- **HTTP API** — JSON endpoints for trace retrieval and statistics
- **Slow Request Detection** — Configurable threshold with automatic flagging
- **Sampling** — Configurable rate to reduce overhead in production
- **Logging** — Pino, Winston, console, and custom logger integration
- **Security** — Automatic sensitive header redaction, body logging disabled by default
- **Zero Dependencies** — Uses only Node.js built-ins
- **Minimal Overhead** — Adds <1ms per request

## Architecture

The library has three core components:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Trace Engine    │────▶│  Trace Storage   │────▶│  UI Dashboard   │
│                  │     │                  │     │                  │
│  AsyncLocal-     │     │  In-memory store │     │  Real-time viz  │
│  Storage context │     │  with eviction   │     │  at /trace/ui   │
│  + step tracking │     │  and retention   │     │                  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

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
  autoTrack: false,         // auto-track Express middleware execution times
  sensitiveHeaders: null,   // custom list of headers to redact (string[])
});
```

| Option | Default | Description |
|---|---|---|
| `slowThreshold` | `200` | Duration in ms above which a request is flagged slow |
| `samplingRate` | `1` | Fraction of requests to trace (`1` = 100%, `0.1` = 10%) |
| `maxTraces` | `1000` | Maximum traces held in memory; oldest evicted when full |
| `retentionSeconds` | `300` | Traces older than this are automatically evicted |
| `autoTrack` | `false` | Automatically track Express middleware execution times |
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

### `trace.sanitizeHeaders(headers)`

Returns a copy of headers with sensitive values replaced by `[REDACTED]`.

### `trace.destroy()`

Clean up storage intervals and clear all stored traces.

## HTTP Endpoints

Mount with `app.use(trace.routes())` to enable these endpoints:

| Endpoint | Description |
|---|---|
| `GET /trace/ui` | Interactive dashboard UI |
| `GET /trace/recent` | Last 50 traces as JSON |
| `GET /trace/slow` | Traces exceeding `slowThreshold` |
| `GET /trace/stats` | Aggregate statistics |
| `GET /trace/:requestId` | Single trace by request ID |

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

### Request Timeline Visualization
Each request displays a waterfall timeline of its steps:

```
authMiddleware  |████|                              12ms
validateInput   |██|                                 5ms
dbQuery         |██████████████████████████████|   210ms
paymentService  |██████████|                        45ms
responseRender  |████████|                          30ms
```

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
