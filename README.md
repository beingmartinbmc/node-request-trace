# node-request-trace

Request tracing and performance visualization library for Node.js. Inspect the full execution lifecycle of API requests, detect bottlenecks, and debug production issues quickly.

## Features

- **Request Tracing** — Full lifecycle tracking with async context propagation
- **Step Tracking** — Manual instrumentation for DB calls, service calls, etc.
- **Framework Support** — Express.js, Fastify, and Koa
- **UI Dashboard** — Built-in real-time visualization at `/trace/ui`
- **HTTP API** — JSON endpoints for trace data
- **Slow Detection** — Configurable threshold alerts
- **Sampling** — Reduce overhead in production
- **Logging** — Pino, Winston, and console integration
- **Security** — Automatic sensitive header redaction

## Installation

```bash
npm install node-request-trace
```

## Quick Start (Express)

```js
const express = require("express");
const trace = require("node-request-trace");

trace.init({
  slowThreshold: 200,  // ms
  samplingRate: 1,      // 1 = 100%
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

## Configuration

```js
trace.init({
  slowThreshold: 200,      // ms — requests above this are flagged slow
  samplingRate: 1,          // 0-1 — fraction of requests to trace
  maxTraces: 1000,          // max traces kept in memory
  retentionSeconds: 300,    // auto-evict traces older than this
  autoTrack: false,         // auto-track middleware execution (Express)
  sensitiveHeaders: null,   // custom list of headers to redact
});
```

## API

### `trace.init(options)`
Initialize the tracer with configuration.

### `trace.middleware()`
Returns Express/Connect middleware. For Koa, use `trace.koaMiddleware()`.

### `trace.fastifyPlugin()`
Returns a Fastify plugin. Register with `fastify.register(trace.fastifyPlugin())`.

### `trace.koaMiddleware()`
Returns Koa middleware.

### `trace.routes()`
Returns a middleware that serves trace HTTP endpoints and the UI dashboard.

### `trace.step(name, fn)`
Track an async operation within the current request trace.

```js
await trace.step("dbQuery", async () => {
  return await db.query("SELECT ...");
});
```

### `trace.current()`
Get the current request trace (works across async boundaries via `AsyncLocalStorage`).

### `trace.useLogger(type, logger)`
Attach a logger. Types: `'pino'`, `'winston'`, `'console'`, or a custom `{ onTrace(trace) }` object.

### `trace.sanitizeHeaders(headers)`
Returns a copy of headers with sensitive values redacted.

### `trace.destroy()`
Clean up storage and intervals.

## HTTP Endpoints

| Endpoint | Description |
|---|---|
| `GET /trace/ui` | Dashboard UI |
| `GET /trace/recent` | Recent traces (JSON) |
| `GET /trace/slow` | Slow traces (JSON) |
| `GET /trace/stats` | Aggregate statistics (JSON) |
| `GET /trace/:requestId` | Single trace by ID (JSON) |

## Fastify Usage

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

## Koa Usage

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

// Console
trace.useLogger("console");

// Custom
trace.useLogger({
  onTrace(trace) {
    myLogger.log(trace);
  }
});
```

## Request Correlation

The library automatically generates a unique `X-Request-ID` header for each request. If the incoming request already has an `X-Request-ID` header, it will be reused.

## Running the Example

```bash
npm run example
# Then visit http://localhost:3000/trace/ui
```

## Running Tests

```bash
npm test
```

## License

MIT
