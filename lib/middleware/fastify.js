'use strict';

const { createTrace, runWithTrace, finalizeTrace } = require('../trace-engine');

function fastifyPlugin(tracer) {
  return function plugin(fastify, opts, done) {
    fastify.addHook('onRequest', (request, reply, hookDone) => {
      if (!tracer._shouldSample()) {
        return hookDone();
      }

      const trace = createTrace({
        method: request.method,
        url: request.url,
        headers: request.headers,
      });

      reply.header('X-Request-ID', trace.requestId);
      request._trace = trace;

      runWithTrace(trace, () => {
        hookDone();
      });
    });

    fastify.addHook('onResponse', (request, reply, hookDone) => {
      const trace = request._trace;
      if (trace) {
        finalizeTrace(trace, reply.statusCode);
        tracer._onTraceComplete(trace);
      }
      hookDone();
    });

    done();
  };
}

module.exports = fastifyPlugin;
