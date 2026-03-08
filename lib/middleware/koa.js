'use strict';

const { createTrace, runWithTrace, finalizeTrace } = require('../trace-engine');

function koaMiddleware(tracer) {
  return async function traceMiddleware(ctx, next) {
    if (!tracer._shouldSample()) {
      return next();
    }

    const trace = createTrace({
      method: ctx.method,
      url: ctx.url,
      path: ctx.path,
      headers: ctx.headers,
    });

    ctx.set('X-Request-ID', trace.requestId);
    ctx._trace = trace;

    await new Promise((resolve, reject) => {
      runWithTrace(trace, async () => {
        try {
          await next();
          finalizeTrace(trace, ctx.status);
          tracer._onTraceComplete(trace);
          resolve();
        } catch (err) {
          finalizeTrace(trace, ctx.status || 500);
          tracer._onTraceComplete(trace);
          reject(err);
        }
      });
    });
  };
}

module.exports = koaMiddleware;
