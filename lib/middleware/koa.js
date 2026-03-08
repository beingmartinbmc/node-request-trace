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

function instrumentKoa(app, tracer) {
  if (!app || typeof app.use !== 'function') return app;
  if (app._traceInstrumented) return app;

  const originalUse = app.use.bind(app);
  let mwIndex = 0;

  app.use = function instrumentedUse(fn) {
    if (!tracer.config.autoTrack) {
      return originalUse(fn);
    }

    const name = fn.name || fn._name || `middleware_${mwIndex++}`;

    const wrapped = async function (ctx, next) {
      const trace = ctx._trace;
      const start = Date.now();
      try {
        await fn(ctx, next);
      } finally {
        if (trace) {
          trace.steps.push({
            name,
            start,
            duration: Date.now() - start,
            type: 'middleware',
          });
        }
      }
    };

    return originalUse(wrapped);
  };

  app._traceInstrumented = true;
  return app;
}

module.exports = koaMiddleware;
module.exports.instrumentKoa = instrumentKoa;
