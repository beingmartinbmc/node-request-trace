'use strict';

const { getDashboardHtml } = require('./dashboard');

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
