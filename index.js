'use strict';

const { createTrace, currentTrace, runWithTrace, finalizeTrace, addStep } = require('./lib/trace-engine');
const TraceStorage = require('./lib/trace-storage');
const expressMiddleware = require('./lib/middleware/express');
const fastifyPlugin = require('./lib/middleware/fastify');
const koaMiddleware = require('./lib/middleware/koa');
const { instrumentKoa } = require('./lib/middleware/koa');
const { createRouter } = require('./lib/routes');
const { createPinoIntegration, createWinstonIntegration, createConsoleIntegration } = require('./lib/logger');
const { sanitizeHeaders } = require('./lib/security');
const { enableHttpTracing, disableHttpTracing, isEnabled: isHttpTracingEnabled } = require('./lib/http-tracer');
const { toChromeTraceFormat, toChromeTraceJson } = require('./lib/chrome-trace');

const DEFAULT_CONFIG = {
  slowThreshold: 200,
  samplingRate: 1,
  maxTraces: 1000,
  retentionSeconds: 300,
  autoTrack: false,
  traceOutgoing: false,
  logBody: false,
  sensitiveHeaders: null,
};

class RequestTracer {
  constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.storage = null;
    this._logger = null;
    this._initialized = false;
  }

  init(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.storage = new TraceStorage({
      maxTraces: this.config.maxTraces,
      retentionSeconds: this.config.retentionSeconds,
    });
    this.storage.startCleanup();
    this._initialized = true;

    if (this.config.traceOutgoing) {
      enableHttpTracing();
    }

    return this;
  }

  middleware(framework) {
    this._ensureInit();
    if (framework === 'koa') {
      return koaMiddleware(this);
    }
    return expressMiddleware(this);
  }

  fastifyPlugin() {
    this._ensureInit();
    return fastifyPlugin(this);
  }

  koaMiddleware() {
    this._ensureInit();
    return koaMiddleware(this);
  }

  instrumentKoa(app) {
    this._ensureInit();
    return instrumentKoa(app, this);
  }

  routes() {
    this._ensureInit();
    return createRouter(this);
  }

  current() {
    return currentTrace();
  }

  async step(name, fn) {
    return addStep(name, fn);
  }

  useLogger(type, loggerInstance) {
    if (type === 'pino') {
      this._logger = createPinoIntegration(loggerInstance);
    } else if (type === 'winston') {
      this._logger = createWinstonIntegration(loggerInstance);
    } else if (type === 'console') {
      this._logger = createConsoleIntegration();
    } else if (typeof type === 'object' && typeof type.onTrace === 'function') {
      this._logger = type;
    }
    return this;
  }

  enableHttpTracing() {
    enableHttpTracing();
    return this;
  }

  disableHttpTracing() {
    disableHttpTracing();
    return this;
  }

  isHttpTracingEnabled() {
    return isHttpTracingEnabled();
  }

  exportChromeTrace(trace) {
    return toChromeTraceFormat(trace);
  }

  exportChromeTraceJson(trace) {
    return toChromeTraceJson(trace);
  }

  sanitizeHeaders(headers) {
    return sanitizeHeaders(headers, this.config.sensitiveHeaders);
  }

  destroy() {
    if (this.storage) {
      this.storage.stopCleanup();
      this.storage.clear();
    }
    disableHttpTracing();
    this._initialized = false;
  }

  _shouldSample() {
    if (this.config.samplingRate >= 1) return true;
    return Math.random() < this.config.samplingRate;
  }

  _onTraceComplete(trace) {
    if (!this.storage) return;

    if (trace.duration >= this.config.slowThreshold) {
      trace._slow = true;
    }

    this.storage.store(trace);

    if (this._logger && typeof this._logger.onTrace === 'function') {
      try {
        this._logger.onTrace(trace);
      } catch (_) { /* don't crash on logger errors */ }
    }
  }

  _ensureInit() {
    if (!this._initialized) {
      this.init();
    }
  }
}

const instance = new RequestTracer();

module.exports = instance;
module.exports.RequestTracer = RequestTracer;
