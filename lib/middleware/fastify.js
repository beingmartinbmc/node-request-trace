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
      request._tracePhaseStart = Date.now();

      runWithTrace(trace, () => {
        hookDone();
      });
    });

    if (tracer.config.autoTrack) {
      fastify.addHook('preParsing', (request, reply, payload, hookDone) => {
        _recordPhase(request, 'onRequest');
        hookDone(null, payload);
      });

      fastify.addHook('preValidation', (request, reply, hookDone) => {
        _recordPhase(request, 'preParsing');
        hookDone();
      });

      fastify.addHook('preHandler', (request, reply, hookDone) => {
        _recordPhase(request, 'preValidation');
        hookDone();
      });

      fastify.addHook('onSend', (request, reply, payload, hookDone) => {
        _recordPhase(request, 'handler');
        hookDone(null, payload);
      });
    }

    fastify.addHook('onResponse', (request, reply, hookDone) => {
      const trace = request._trace;
      if (trace) {
        if (tracer.config.autoTrack) {
          _recordPhase(request, 'onSend');
        }
        finalizeTrace(trace, reply.statusCode);
        tracer._onTraceComplete(trace);
      }
      hookDone();
    });

    done();
  };
}

function _recordPhase(request, phaseName) {
  const trace = request._trace;
  if (!trace || !request._tracePhaseStart) return;

  const now = Date.now();
  const duration = now - request._tracePhaseStart;
  if (duration > 0) {
    trace.steps.push({
      name: phaseName,
      start: request._tracePhaseStart,
      duration,
      type: 'lifecycle',
    });
  }
  request._tracePhaseStart = now;
}

module.exports = fastifyPlugin;
