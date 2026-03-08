'use strict';

const { createTrace, runWithTrace, finalizeTrace, addStep } = require('../trace-engine');

function expressMiddleware(tracer) {
  return function traceMiddleware(req, res, next) {
    if (!tracer._shouldSample()) {
      return next();
    }

    const trace = createTrace(req);
    res.setHeader('X-Request-ID', trace.requestId);
    req._trace = trace;

    runWithTrace(trace, () => {
      const originalEnd = res.end;
      res.end = function (...args) {
        finalizeTrace(trace, res.statusCode);
        tracer._onTraceComplete(trace);
        res.end = originalEnd;
        return res.end(...args);
      };

      if (tracer.config.autoTrack) {
        _patchExpressMiddleware(req, res, next, tracer);
      } else {
        next();
      }
    });
  };
}

function _patchExpressMiddleware(req, res, next, tracer) {
  const app = req.app;
  if (!app || !app._router) {
    return next();
  }

  const originalHandle = app._router.handle;
  let stepIndex = 0;

  app._router.handle = function (req2, res2, done) {
    const layers = this.stack || [];

    const wrappedLayers = layers.map((layer) => {
      if (layer._traceWrapped) return layer;

      const origHandle = layer.handle;
      const layerName = layer.name || layer.route?.path || `middleware_${stepIndex++}`;

      if (origHandle.length === 4) {
        layer.handle = function (err, r, s, n) {
          const start = Date.now();
          const cb = function (...cbArgs) {
            const trace = r._trace;
            if (trace) {
              trace.steps.push({ name: layerName, start, duration: Date.now() - start });
            }
            return n(...cbArgs);
          };
          return origHandle.call(this, err, r, s, cb);
        };
      } else {
        layer.handle = function (r, s, n) {
          const start = Date.now();
          const cb = function (...cbArgs) {
            const trace = r._trace;
            if (trace) {
              trace.steps.push({ name: layerName, start, duration: Date.now() - start });
            }
            return n(...cbArgs);
          };
          return origHandle.call(this, r, s, cb);
        };
      }
      layer._traceWrapped = true;
      return layer;
    });

    app._router.handle = originalHandle;
    return originalHandle.call(this, req2, res2, done);
  };

  next();
}

module.exports = expressMiddleware;
