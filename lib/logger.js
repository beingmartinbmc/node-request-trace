'use strict';

function formatTrace(trace) {
  const lines = [`TRACE ${trace.method} ${trace.path} ${trace.duration}ms (${trace.status})`];
  for (const step of trace.steps) {
    lines.push(`  ${step.name}: ${step.duration}ms${step.error ? ' [ERROR: ' + step.error + ']' : ''}`);
  }
  return lines.join('\n');
}

function createPinoIntegration(pinoLogger) {
  return {
    onTrace(trace) {
      const data = {
        requestId: trace.requestId,
        method: trace.method,
        path: trace.path,
        duration: trace.duration,
        status: trace.status,
        steps: trace.steps.map(s => ({ name: s.name, duration: s.duration })),
      };
      if (trace._slow) {
        pinoLogger.warn(data, 'Slow request detected');
      } else {
        pinoLogger.info(data, 'Request trace');
      }
    },
  };
}

function createWinstonIntegration(winstonLogger) {
  return {
    onTrace(trace) {
      const meta = {
        requestId: trace.requestId,
        method: trace.method,
        path: trace.path,
        duration: trace.duration,
        status: trace.status,
        steps: trace.steps.map(s => ({ name: s.name, duration: s.duration })),
      };
      if (trace._slow) {
        winstonLogger.warn('Slow request detected', meta);
      } else {
        winstonLogger.info('Request trace', meta);
      }
    },
  };
}

function createConsoleIntegration() {
  return {
    onTrace(trace) {
      if (trace._slow) {
        console.warn('[SLOW] ' + formatTrace(trace));
      } else {
        console.log(formatTrace(trace));
      }
    },
  };
}

module.exports = {
  formatTrace,
  createPinoIntegration,
  createWinstonIntegration,
  createConsoleIntegration,
};
