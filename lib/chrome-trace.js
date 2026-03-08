'use strict';

function toChromeTraceFormat(trace) {
  const events = [];
  const pid = 1;
  const tid = 1;

  events.push({
    cat: 'request',
    name: `${trace.method} ${trace.path}`,
    ph: 'X',
    ts: trace.startTime * 1000,
    dur: trace.duration * 1000,
    pid,
    tid,
    args: {
      requestId: trace.requestId,
      status: trace.status,
    },
  });

  if (trace.steps && trace.steps.length) {
    for (const step of trace.steps) {
      const event = {
        cat: 'step',
        name: step.name,
        ph: 'X',
        ts: step.start * 1000,
        dur: step.duration * 1000,
        pid,
        tid: tid + 1,
        args: {},
      };
      if (step.error) {
        event.args.error = step.error;
      }
      if (step.type) {
        event.args.type = step.type;
      }
      events.push(event);
    }
  }

  return { traceEvents: events };
}

function toChromeTraceJson(trace) {
  return JSON.stringify(toChromeTraceFormat(trace));
}

module.exports = { toChromeTraceFormat, toChromeTraceJson };
