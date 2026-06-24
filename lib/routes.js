'use strict';

const { getDashboardHtml } = require('./dashboard');
const { toChromeTraceFormat } = require('./chrome-trace');
const { toSpeedscope } = require('./speedscope');
const { toShareableHtml } = require('./snapshot');
const { toMarkdown } = require('./markdown');
const { diffTraces } = require('./diff');
const { buildTimeline, renderTimeline } = require('./timeline');

function createRouter(tracer) {
  return function traceRouter(req, res, next) {
    const url = parseUrl(req);

    if (url === '/trace/ui') {
      return serveUi(tracer, req, res);
    }

    if (url === '/trace/recent') {
      return serveJson(res, tracer.storage.getRecent(50));
    }

    if (url === '/trace/slow') {
      return serveJson(res, tracer.storage.getSlow(tracer.config.slowThreshold, 50));
    }

    if (url === '/trace/stats') {
      return serveJson(res, getStats(tracer));
    }

    const timelineMatch = url.match(/^\/trace\/([a-zA-Z0-9_]+)\/timeline$/);
    if (timelineMatch) {
      const trace = tracer.storage.get(timelineMatch[1]);
      if (trace) {
        return serveJson(res, {
          ...buildTimeline(trace),
          text: renderTimeline(trace),
        });
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Trace not found' }));
    }

    const chromeMatch = url.match(/^\/trace\/([a-zA-Z0-9_]+)\/chrome$/);
    if (chromeMatch) {
      const trace = tracer.storage.get(chromeMatch[1]);
      if (trace) {
        return serveJson(res, toChromeTraceFormat(trace));
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Trace not found' }));
    }

    const speedscopeMatch = url.match(/^\/trace\/([a-zA-Z0-9_]+)\/speedscope$/);
    if (speedscopeMatch) {
      const trace = tracer.storage.get(speedscopeMatch[1]);
      if (trace) {
        return serveJson(res, toSpeedscope(trace));
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Trace not found' }));
    }

    const markdownMatch = url.match(/^\/trace\/([a-zA-Z0-9_]+)\/markdown$/);
    if (markdownMatch) {
      const trace = tracer.storage.get(markdownMatch[1]);
      if (trace) {
        res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
        return res.end(toMarkdown(trace, { slowThreshold: tracer.config.slowThreshold }));
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Trace not found' }));
    }

    const snapshotMatch = url.match(/^\/trace\/([a-zA-Z0-9_]+)\/snapshot$/);
    if (snapshotMatch) {
      const trace = tracer.storage.get(snapshotMatch[1]);
      if (trace) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `attachment; filename="${snapshotMatch[1]}.html"`,
        });
        return res.end(toShareableHtml(trace));
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Trace not found' }));
    }

    const diffMatch = url.match(/^\/trace\/diff\/([a-zA-Z0-9_]+)\/([a-zA-Z0-9_]+)$/);
    if (diffMatch) {
      const a = tracer.storage.get(diffMatch[1]);
      const b = tracer.storage.get(diffMatch[2]);
      if (a && b) {
        return serveJson(res, diffTraces(a, b));
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Trace not found' }));
    }

    const singleMatch = url.match(/^\/trace\/([a-zA-Z0-9_]+)$/);
    if (singleMatch) {
      const trace = tracer.storage.get(singleMatch[1]);
      if (trace) {
        return serveJson(res, trace);
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Trace not found' }));
    }

    if (typeof next === 'function') {
      return next();
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  };
}

function parseUrl(req) {
  const raw = req.url || req.path || '/';
  return raw.split('?')[0];
}

function serveJson(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function serveUi(tracer, req, res) {
  const html = getDashboardHtml(tracer.config);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function getStats(tracer) {
  const traces = tracer.storage.getAll();
  const total = traces.length;
  if (total === 0) {
    return { totalRequests: 0, avgLatency: 0, slowRequests: 0, errorRate: 0, requestsPerSec: 0 };
  }

  const now = Date.now();
  const windowMs = 60000;
  let sumDuration = 0;
  let slowCount = 0;
  let errorCount = 0;
  let recentCount = 0;

  for (const t of traces) {
    sumDuration += t.duration;
    if (t.duration >= tracer.config.slowThreshold) slowCount++;
    if (t.status >= 400) errorCount++;
    if (now - t.startTime <= windowMs) recentCount++;
  }

  return {
    totalRequests: total,
    avgLatency: Math.round(sumDuration / total),
    slowRequests: slowCount,
    errorRate: parseFloat(((errorCount / total) * 100).toFixed(1)),
    requestsPerSec: parseFloat((recentCount / (windowMs / 1000)).toFixed(2)),
  };
}

module.exports = { createRouter, getStats };
