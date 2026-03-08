'use strict';

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

async function run() {
  console.log('\n🧪 node-request-trace test suite\n');

  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✅ ${t.name}`);
    } catch (err) {
      failed++;
      console.log(`  ❌ ${t.name}`);
      console.log(`     ${err.message}`);
      if (err.stack) console.log(`     ${err.stack.split('\n')[1]}`);
    }
  }

  console.log(`\n  ${passed} passed, ${failed} failed, ${tests.length} total\n`);
  process.exit(failed > 0 ? 1 : 0);
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function assertDeepEqual(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// =========================================================================
// trace-engine.js
// =========================================================================
const engine = require('../lib/trace-engine');

test('engine: createTrace generates requestId starting with req_', () => {
  const trace = engine.createTrace({ method: 'GET', url: '/test', headers: {} });
  assert(trace.requestId.startsWith('req_'), 'requestId should start with req_');
  assertEqual(trace.method, 'GET');
  assertEqual(trace.path, '/test');
  assert(trace.startTime > 0);
  assertEqual(trace.duration, 0);
  assertEqual(trace.status, 0);
  assert(Array.isArray(trace.steps));
  assertEqual(trace.steps.length, 0);
});

test('engine: createTrace reuses X-Request-ID header', () => {
  const trace = engine.createTrace({ method: 'POST', url: '/foo', headers: { 'x-request-id': 'custom-123' } });
  assertEqual(trace.requestId, 'custom-123');
  assertEqual(trace.method, 'POST');
});

test('engine: createTrace with no headers falls back to generated ID', () => {
  const trace = engine.createTrace({ method: 'GET', url: '/noheaders' });
  assert(trace.requestId.startsWith('req_'), 'should generate requestId when no headers');
});

test('engine: createTrace with null headers falls back to generated ID', () => {
  const trace = engine.createTrace({ method: 'GET', url: '/x', headers: null });
  assert(trace.requestId.startsWith('req_'), 'should generate requestId when headers is null');
});

test('engine: createTrace with no method defaults to UNKNOWN', () => {
  const trace = engine.createTrace({ url: '/nomethod', headers: {} });
  assertEqual(trace.method, 'UNKNOWN');
});

test('engine: createTrace with path fallback when no url', () => {
  const trace = engine.createTrace({ method: 'GET', path: '/pathonly', headers: {} });
  assertEqual(trace.path, '/pathonly');
});

test('engine: createTrace defaults path to / when no url or path', () => {
  const trace = engine.createTrace({ method: 'GET', headers: {} });
  assertEqual(trace.path, '/');
});

test('engine: generateRequestId produces unique IDs', () => {
  const id1 = engine.generateRequestId();
  const id2 = engine.generateRequestId();
  assert(id1 !== id2, 'IDs should be unique');
  assert(id1.startsWith('req_'));
});

test('engine: runWithTrace + currentTrace propagates context', async () => {
  const trace = engine.createTrace({ method: 'GET', url: '/ctx', headers: {} });
  let captured = null;
  await engine.runWithTrace(trace, () => {
    captured = engine.currentTrace();
  });
  assertEqual(captured.requestId, trace.requestId);
});

test('engine: currentTrace returns null outside async context', () => {
  const result = engine.currentTrace();
  assertEqual(result, null);
});

test('engine: addStep records step timing', async () => {
  const trace = engine.createTrace({ method: 'GET', url: '/step', headers: {} });
  await engine.runWithTrace(trace, async () => {
    const result = await engine.addStep('testStep', async () => {
      await new Promise(r => setTimeout(r, 10));
      return 42;
    });
    assertEqual(result, 42);
  });
  assertEqual(trace.steps.length, 1);
  assertEqual(trace.steps[0].name, 'testStep');
  assert(trace.steps[0].duration >= 5);
});

test('engine: addStep records error on throw and rethrows', async () => {
  const trace = engine.createTrace({ method: 'GET', url: '/err', headers: {} });
  let threw = false;
  await engine.runWithTrace(trace, async () => {
    try {
      await engine.addStep('failStep', async () => { throw new Error('boom'); });
    } catch (e) {
      threw = true;
      assertEqual(e.message, 'boom');
    }
  });
  assert(threw, 'should have thrown');
  assertEqual(trace.steps.length, 1);
  assertEqual(trace.steps[0].name, 'failStep');
  assertEqual(trace.steps[0].error, 'boom');
  assert(trace.steps[0].duration >= 0);
});

test('engine: addStep success without active trace still returns result', async () => {
  const result = await engine.addStep('orphan', async () => 99);
  assertEqual(result, 99);
});

test('engine: addStep error without active trace still throws', async () => {
  let threw = false;
  try {
    await engine.addStep('orphanFail', async () => { throw new Error('no-ctx'); });
  } catch (e) {
    threw = true;
    assertEqual(e.message, 'no-ctx');
  }
  assert(threw);
});

test('engine: finalizeTrace sets duration and status', () => {
  const trace = engine.createTrace({ method: 'GET', url: '/fin', headers: {} });
  trace.startTime = Date.now() - 100;
  engine.finalizeTrace(trace, 201);
  assert(trace.duration >= 90);
  assertEqual(trace.status, 201);
});

test('engine: finalizeTrace defaults status to 0 when falsy', () => {
  const trace = engine.createTrace({ method: 'GET', url: '/fin2', headers: {} });
  trace.startTime = Date.now() - 5;
  const returned = engine.finalizeTrace(trace, 0);
  assertEqual(trace.status, 0);
  assertEqual(returned, trace);
});

test('engine: finalizeTrace with undefined statusCode defaults to 0', () => {
  const trace = engine.createTrace({ method: 'GET', url: '/fin3', headers: {} });
  trace.startTime = Date.now();
  engine.finalizeTrace(trace);
  assertEqual(trace.status, 0);
});

test('engine: asyncLocalStorage is exported', () => {
  assert(engine.asyncLocalStorage != null);
});

// =========================================================================
// trace-storage.js
// =========================================================================
const TraceStorage = require('../lib/trace-storage');

test('storage: constructor uses defaults when no options', () => {
  const s = new TraceStorage();
  assertEqual(s.maxTraces, 1000);
  assertEqual(s.retentionSeconds, 300);
  assertEqual(s.size, 0);
  assertEqual(s._cleanupInterval, null);
});

test('storage: constructor with custom options', () => {
  const s = new TraceStorage({ maxTraces: 50, retentionSeconds: 60 });
  assertEqual(s.maxTraces, 50);
  assertEqual(s.retentionSeconds, 60);
});

test('storage: store and get', () => {
  const s = new TraceStorage({ maxTraces: 100 });
  const t = { requestId: 'r1', startTime: Date.now(), duration: 50, steps: [] };
  s.store(t);
  assertEqual(s.size, 1);
  assertEqual(s.get('r1').requestId, 'r1');
});

test('storage: get returns null for unknown ID', () => {
  const s = new TraceStorage();
  assertEqual(s.get('nonexistent'), null);
});

test('storage: getRecent returns in reverse order', () => {
  const s = new TraceStorage({ maxTraces: 100 });
  s.store({ requestId: 'a', startTime: Date.now(), duration: 10, steps: [] });
  s.store({ requestId: 'b', startTime: Date.now(), duration: 20, steps: [] });
  s.store({ requestId: 'c', startTime: Date.now(), duration: 30, steps: [] });
  const recent = s.getRecent(2);
  assertEqual(recent.length, 2);
  assertEqual(recent[0].requestId, 'c');
  assertEqual(recent[1].requestId, 'b');
});

test('storage: getRecent uses default limit', () => {
  const s = new TraceStorage({ maxTraces: 100 });
  for (let i = 0; i < 5; i++) s.store({ requestId: `d${i}`, startTime: Date.now(), duration: 10, steps: [] });
  const recent = s.getRecent();
  assertEqual(recent.length, 5);
});

test('storage: getRecent skips entries deleted from map', () => {
  const s = new TraceStorage({ maxTraces: 100 });
  s.store({ requestId: 'aa', startTime: Date.now(), duration: 10, steps: [] });
  s.store({ requestId: 'bb', startTime: Date.now(), duration: 10, steps: [] });
  s.traces.delete('aa');
  const recent = s.getRecent(10);
  assertEqual(recent.length, 1);
  assertEqual(recent[0].requestId, 'bb');
});

test('storage: getSlow filters by threshold', () => {
  const s = new TraceStorage({ maxTraces: 100 });
  s.store({ requestId: 'fast', startTime: Date.now(), duration: 50, steps: [] });
  s.store({ requestId: 'slow1', startTime: Date.now(), duration: 300, steps: [] });
  s.store({ requestId: 'slow2', startTime: Date.now(), duration: 250, steps: [] });
  const slow = s.getSlow(200);
  assertEqual(slow.length, 2);
});

test('storage: getSlow uses default limit', () => {
  const s = new TraceStorage({ maxTraces: 100 });
  s.store({ requestId: 's1', startTime: Date.now(), duration: 500, steps: [] });
  const slow = s.getSlow(100);
  assertEqual(slow.length, 1);
});

test('storage: getSlow respects limit cap', () => {
  const s = new TraceStorage({ maxTraces: 100 });
  for (let i = 0; i < 10; i++) s.store({ requestId: `sl${i}`, startTime: Date.now(), duration: 500, steps: [] });
  const slow = s.getSlow(100, 3);
  assertEqual(slow.length, 3);
});

test('storage: getSlow skips traces not in map', () => {
  const s = new TraceStorage({ maxTraces: 100 });
  s.store({ requestId: 'g1', startTime: Date.now(), duration: 500, steps: [] });
  s.store({ requestId: 'g2', startTime: Date.now(), duration: 500, steps: [] });
  s.traces.delete('g2');
  const slow = s.getSlow(100);
  assertEqual(slow.length, 1);
});

test('storage: getSlow skips traces below threshold', () => {
  const s = new TraceStorage({ maxTraces: 100 });
  s.store({ requestId: 'f1', startTime: Date.now(), duration: 10, steps: [] });
  const slow = s.getSlow(100);
  assertEqual(slow.length, 0);
});

test('storage: evicts oldest when at capacity', () => {
  const s = new TraceStorage({ maxTraces: 2 });
  s.store({ requestId: 'x1', startTime: Date.now(), duration: 10, steps: [] });
  s.store({ requestId: 'x2', startTime: Date.now(), duration: 20, steps: [] });
  s.store({ requestId: 'x3', startTime: Date.now(), duration: 30, steps: [] });
  assertEqual(s.size, 2);
  assertEqual(s.get('x1'), null);
  assert(s.get('x2') !== null);
  assert(s.get('x3') !== null);
});

test('storage: evicts expired traces', () => {
  const s = new TraceStorage({ maxTraces: 100, retentionSeconds: 1 });
  s.store({ requestId: 'old', startTime: Date.now() - 2000, duration: 10, steps: [] });
  s.store({ requestId: 'new', startTime: Date.now(), duration: 10, steps: [] });
  s._evictExpired();
  assertEqual(s.size, 1);
  assertEqual(s.get('old'), null);
  assert(s.get('new') !== null);
});

test('storage: _evictExpired removes entries missing from map', () => {
  const s = new TraceStorage({ maxTraces: 100, retentionSeconds: 300 });
  s.store({ requestId: 'e1', startTime: Date.now(), duration: 10, steps: [] });
  s.store({ requestId: 'e2', startTime: Date.now(), duration: 10, steps: [] });
  s.traces.delete('e1');
  s._evictExpired();
  assertEqual(s.order.length, 1);
  assertEqual(s.order[0], 'e2');
});

test('storage: clear removes all', () => {
  const s = new TraceStorage({ maxTraces: 100 });
  s.store({ requestId: 'z1', startTime: Date.now(), duration: 10, steps: [] });
  s.clear();
  assertEqual(s.size, 0);
  assertEqual(s.order.length, 0);
});

test('storage: getAll returns all traces', () => {
  const s = new TraceStorage({ maxTraces: 100 });
  s.store({ requestId: 'ga1', startTime: Date.now(), duration: 10, steps: [] });
  s.store({ requestId: 'ga2', startTime: Date.now(), duration: 20, steps: [] });
  const all = s.getAll();
  assertEqual(all.length, 2);
});

test('storage: startCleanup starts interval', () => {
  const s = new TraceStorage({ maxTraces: 100 });
  s.startCleanup(60000);
  assert(s._cleanupInterval !== null);
  s.stopCleanup();
  assertEqual(s._cleanupInterval, null);
});

test('storage: startCleanup uses default interval', () => {
  const s = new TraceStorage({ maxTraces: 100 });
  s.startCleanup();
  assert(s._cleanupInterval !== null);
  s.stopCleanup();
});

test('storage: startCleanup is idempotent', () => {
  const s = new TraceStorage({ maxTraces: 100 });
  s.startCleanup(60000);
  const first = s._cleanupInterval;
  s.startCleanup(60000);
  assertEqual(s._cleanupInterval, first);
  s.stopCleanup();
});

test('storage: stopCleanup when no interval is a no-op', () => {
  const s = new TraceStorage();
  s.stopCleanup();
  assertEqual(s._cleanupInterval, null);
});

test('storage: _evictOldest handles empty order gracefully', () => {
  const s = new TraceStorage({ maxTraces: 0 });
  s._evictOldest();
  assertEqual(s.size, 0);
});

// =========================================================================
// security.js
// =========================================================================
const { sanitizeHeaders: sanitize, DEFAULT_SENSITIVE_HEADERS } = require('../lib/security');

test('security: sanitizeHeaders redacts default sensitive headers', () => {
  const result = sanitize({
    'authorization': 'Bearer token',
    'content-type': 'application/json',
    'cookie': 'session=abc',
    'set-cookie': 'foo=bar',
    'x-api-key': 'key123',
    'x-auth-token': 'tok',
    'proxy-authorization': 'basic xyz',
    'x-custom': 'value',
  });
  assertEqual(result['authorization'], '[REDACTED]');
  assertEqual(result['cookie'], '[REDACTED]');
  assertEqual(result['set-cookie'], '[REDACTED]');
  assertEqual(result['x-api-key'], '[REDACTED]');
  assertEqual(result['x-auth-token'], '[REDACTED]');
  assertEqual(result['proxy-authorization'], '[REDACTED]');
  assertEqual(result['content-type'], 'application/json');
  assertEqual(result['x-custom'], 'value');
});

test('security: sanitizeHeaders with custom list', () => {
  const result = sanitize({ 'x-secret': '123', 'x-ok': 'yes' }, ['x-secret']);
  assertEqual(result['x-secret'], '[REDACTED]');
  assertEqual(result['x-ok'], 'yes');
});

test('security: sanitizeHeaders returns empty object for null headers', () => {
  assertDeepEqual(sanitize(null), {});
});

test('security: sanitizeHeaders returns empty object for undefined headers', () => {
  assertDeepEqual(sanitize(undefined), {});
});

test('security: DEFAULT_SENSITIVE_HEADERS is exported and has entries', () => {
  assert(Array.isArray(DEFAULT_SENSITIVE_HEADERS));
  assert(DEFAULT_SENSITIVE_HEADERS.length > 0);
});

// =========================================================================
// logger.js
// =========================================================================
const {
  formatTrace,
  createPinoIntegration,
  createWinstonIntegration,
  createConsoleIntegration,
} = require('../lib/logger');

test('logger: formatTrace with steps (no errors)', () => {
  const trace = {
    method: 'GET', path: '/test', duration: 100, status: 200,
    steps: [{ name: 'db', duration: 50 }, { name: 'cache', duration: 10 }],
  };
  const output = formatTrace(trace);
  assert(output.includes('TRACE GET /test 100ms (200)'));
  assert(output.includes('db: 50ms'));
  assert(output.includes('cache: 10ms'));
  assert(!output.includes('[ERROR'));
});

test('logger: formatTrace with step that has error', () => {
  const trace = {
    method: 'POST', path: '/err', duration: 50, status: 500,
    steps: [{ name: 'fail', duration: 10, error: 'oops' }],
  };
  const output = formatTrace(trace);
  assert(output.includes('fail: 10ms [ERROR: oops]'));
});

test('logger: formatTrace with no steps', () => {
  const trace = { method: 'GET', path: '/', duration: 5, status: 200, steps: [] };
  const output = formatTrace(trace);
  assertEqual(output, 'TRACE GET / 5ms (200)');
});

test('logger: createPinoIntegration logs info for normal trace', () => {
  const calls = [];
  const mockPino = {
    info(data, msg) { calls.push({ level: 'info', data, msg }); },
    warn(data, msg) { calls.push({ level: 'warn', data, msg }); },
  };
  const integration = createPinoIntegration(mockPino);
  integration.onTrace({
    requestId: 'p1', method: 'GET', path: '/', duration: 10, status: 200,
    steps: [{ name: 's1', duration: 5 }],
  });
  assertEqual(calls.length, 1);
  assertEqual(calls[0].level, 'info');
  assertEqual(calls[0].msg, 'Request trace');
  assertEqual(calls[0].data.requestId, 'p1');
});

test('logger: createPinoIntegration logs warn for slow trace', () => {
  const calls = [];
  const mockPino = {
    info(data, msg) { calls.push({ level: 'info', data, msg }); },
    warn(data, msg) { calls.push({ level: 'warn', data, msg }); },
  };
  const integration = createPinoIntegration(mockPino);
  integration.onTrace({
    requestId: 'p2', method: 'GET', path: '/', duration: 300, status: 200,
    steps: [], _slow: true,
  });
  assertEqual(calls.length, 1);
  assertEqual(calls[0].level, 'warn');
  assertEqual(calls[0].msg, 'Slow request detected');
});

test('logger: createWinstonIntegration logs info for normal trace', () => {
  const calls = [];
  const mockWinston = {
    info(msg, meta) { calls.push({ level: 'info', msg, meta }); },
    warn(msg, meta) { calls.push({ level: 'warn', msg, meta }); },
  };
  const integration = createWinstonIntegration(mockWinston);
  integration.onTrace({
    requestId: 'w1', method: 'POST', path: '/login', duration: 50, status: 200,
    steps: [{ name: 'auth', duration: 20 }],
  });
  assertEqual(calls.length, 1);
  assertEqual(calls[0].level, 'info');
  assertEqual(calls[0].msg, 'Request trace');
  assertEqual(calls[0].meta.requestId, 'w1');
});

test('logger: createWinstonIntegration logs warn for slow trace', () => {
  const calls = [];
  const mockWinston = {
    info(msg, meta) { calls.push({ level: 'info', msg, meta }); },
    warn(msg, meta) { calls.push({ level: 'warn', msg, meta }); },
  };
  const integration = createWinstonIntegration(mockWinston);
  integration.onTrace({
    requestId: 'w2', method: 'GET', path: '/', duration: 500, status: 200,
    steps: [], _slow: true,
  });
  assertEqual(calls.length, 1);
  assertEqual(calls[0].level, 'warn');
  assertEqual(calls[0].msg, 'Slow request detected');
});

test('logger: createConsoleIntegration logs normal trace', () => {
  const origLog = console.log;
  const logged = [];
  console.log = (...args) => logged.push(args.join(' '));
  const integration = createConsoleIntegration();
  integration.onTrace({ method: 'GET', path: '/t', duration: 50, status: 200, steps: [] });
  console.log = origLog;
  assertEqual(logged.length, 1);
  assert(logged[0].includes('TRACE GET /t 50ms'));
});

test('logger: createConsoleIntegration warns for slow trace', () => {
  const origWarn = console.warn;
  const warned = [];
  console.warn = (...args) => warned.push(args.join(' '));
  const integration = createConsoleIntegration();
  integration.onTrace({ method: 'GET', path: '/s', duration: 300, status: 200, steps: [], _slow: true });
  console.warn = origWarn;
  assertEqual(warned.length, 1);
  assert(warned[0].includes('[SLOW]'));
});

// =========================================================================
// dashboard.js
// =========================================================================
const { getDashboardHtml } = require('../lib/dashboard');

test('dashboard: returns valid HTML with config', () => {
  const html = getDashboardHtml({ slowThreshold: 200 });
  assert(html.includes('<!DOCTYPE html>'));
  assert(html.includes('Request Trace'));
  assert(html.includes('/trace/recent'));
  assert(html.includes('/trace/stats'));
  assert(html.includes('/trace/slow'));
  assert(html.includes('const SLOW = 200'));
});

test('dashboard: uses default slowThreshold when falsy', () => {
  const html = getDashboardHtml({});
  assert(html.includes('const SLOW = 200'));
});

// =========================================================================
// routes.js
// =========================================================================
const { createRouter, getStats } = require('../lib/routes');

function mockRes() {
  const r = { _status: 0, _headers: {}, _body: '' };
  r.writeHead = (code, headers) => { r._status = code; Object.assign(r._headers, headers || {}); };
  r.end = (data) => { r._body = data || ''; };
  r.statusCode = 200;
  return r;
}

function makeTracer(opts = {}) {
  const { RequestTracer } = require('../index');
  const t = new RequestTracer();
  t.init(opts);
  return t;
}

test('routes: /trace/recent returns JSON array', () => {
  const t = makeTracer();
  t.storage.store({ requestId: 'rr1', startTime: Date.now(), duration: 30, status: 200, steps: [], method: 'GET', path: '/x' });
  const router = createRouter(t);
  const res = mockRes();
  router({ url: '/trace/recent' }, res);
  assertEqual(res._status, 200);
  assertEqual(res._headers['Content-Type'], 'application/json');
  const data = JSON.parse(res._body);
  assertEqual(data.length, 1);
  assertEqual(data[0].requestId, 'rr1');
  t.destroy();
});

test('routes: /trace/slow returns slow traces', () => {
  const t = makeTracer({ slowThreshold: 100 });
  t.storage.store({ requestId: 'rs1', startTime: Date.now(), duration: 200, status: 200, steps: [] });
  t.storage.store({ requestId: 'rs2', startTime: Date.now(), duration: 50, status: 200, steps: [] });
  const router = createRouter(t);
  const res = mockRes();
  router({ url: '/trace/slow' }, res);
  const data = JSON.parse(res._body);
  assertEqual(data.length, 1);
  assertEqual(data[0].requestId, 'rs1');
  t.destroy();
});

test('routes: /trace/stats returns stats object', () => {
  const t = makeTracer({ slowThreshold: 100 });
  t.storage.store({ requestId: 'st1', startTime: Date.now(), duration: 200, status: 200, steps: [] });
  t.storage.store({ requestId: 'st2', startTime: Date.now(), duration: 50, status: 500, steps: [] });
  const router = createRouter(t);
  const res = mockRes();
  router({ url: '/trace/stats' }, res);
  const data = JSON.parse(res._body);
  assertEqual(data.totalRequests, 2);
  assert(data.avgLatency > 0);
  assertEqual(data.slowRequests, 1);
  assert(data.errorRate > 0);
  assert(data.requestsPerSec >= 0);
  t.destroy();
});

test('routes: /trace/stats returns zeros when no traces', () => {
  const t = makeTracer();
  const router = createRouter(t);
  const res = mockRes();
  router({ url: '/trace/stats' }, res);
  const data = JSON.parse(res._body);
  assertEqual(data.totalRequests, 0);
  assertEqual(data.avgLatency, 0);
  assertEqual(data.slowRequests, 0);
  assertEqual(data.errorRate, 0);
  assertEqual(data.requestsPerSec, 0);
  t.destroy();
});

test('routes: /trace/stats counts old traces outside window', () => {
  const t = makeTracer({ slowThreshold: 100 });
  t.storage.store({ requestId: 'old1', startTime: Date.now() - 120000, duration: 50, status: 200, steps: [] });
  const router = createRouter(t);
  const res = mockRes();
  router({ url: '/trace/stats' }, res);
  const data = JSON.parse(res._body);
  assertEqual(data.totalRequests, 1);
  assertEqual(data.requestsPerSec, 0);
  t.destroy();
});

test('routes: /trace/ui returns HTML', () => {
  const t = makeTracer();
  const router = createRouter(t);
  const res = mockRes();
  router({ url: '/trace/ui' }, res);
  assertEqual(res._status, 200);
  assert(res._headers['Content-Type'].includes('text/html'));
  assert(res._body.includes('<!DOCTYPE html>'));
  t.destroy();
});

test('routes: /trace/:requestId returns trace when found', () => {
  const t = makeTracer();
  t.storage.store({ requestId: 'abc123', startTime: Date.now(), duration: 30, status: 200, steps: [] });
  const router = createRouter(t);
  const res = mockRes();
  router({ url: '/trace/abc123' }, res);
  assertEqual(res._status, 200);
  const data = JSON.parse(res._body);
  assertEqual(data.requestId, 'abc123');
  t.destroy();
});

test('routes: /trace/:requestId returns 404 when not found', () => {
  const t = makeTracer();
  const router = createRouter(t);
  const res = mockRes();
  router({ url: '/trace/nonexistent' }, res);
  assertEqual(res._status, 404);
  const data = JSON.parse(res._body);
  assertEqual(data.error, 'Trace not found');
  t.destroy();
});

test('routes: unknown route calls next() when available', () => {
  const t = makeTracer();
  const router = createRouter(t);
  const res = mockRes();
  let nextCalled = false;
  router({ url: '/other/path' }, res, () => { nextCalled = true; });
  assert(nextCalled, 'next() should be called');
  t.destroy();
});

test('routes: unknown route returns 404 when no next()', () => {
  const t = makeTracer();
  const router = createRouter(t);
  const res = mockRes();
  router({ url: '/other/path' }, res);
  assertEqual(res._status, 404);
  const data = JSON.parse(res._body);
  assertEqual(data.error, 'Not found');
  t.destroy();
});

test('routes: parseUrl strips query string', () => {
  const t = makeTracer();
  t.storage.store({ requestId: 'qs1', startTime: Date.now(), duration: 10, status: 200, steps: [] });
  const router = createRouter(t);
  const res = mockRes();
  router({ url: '/trace/recent?limit=5' }, res);
  assertEqual(res._status, 200);
  t.destroy();
});

test('routes: parseUrl uses req.path fallback', () => {
  const t = makeTracer();
  const router = createRouter(t);
  const res = mockRes();
  let nextCalled = false;
  router({ path: '/unknown' }, res, () => { nextCalled = true; });
  assert(nextCalled);
  t.destroy();
});

test('routes: parseUrl defaults to / when no url or path', () => {
  const t = makeTracer();
  const router = createRouter(t);
  const res = mockRes();
  let nextCalled = false;
  router({}, res, () => { nextCalled = true; });
  assert(nextCalled);
  t.destroy();
});

test('routes: /trace/:requestId with underscores in ID', () => {
  const t = makeTracer();
  t.storage.store({ requestId: 'req_abc123', startTime: Date.now(), duration: 10, status: 200, steps: [] });
  const router = createRouter(t);
  const res = mockRes();
  router({ url: '/trace/req_abc123' }, res);
  assertEqual(res._status, 200);
  const data = JSON.parse(res._body);
  assertEqual(data.requestId, 'req_abc123');
  t.destroy();
});

// =========================================================================
// middleware/express.js
// =========================================================================
const expressMiddleware = require('../lib/middleware/express');

test('express-mw: skips tracing when sampling rejects', () => {
  const t = makeTracer({ samplingRate: 0 });
  const mw = expressMiddleware(t);
  let nextCalled = false;
  mw({ headers: {}, method: 'GET', url: '/' }, {}, () => { nextCalled = true; });
  assert(nextCalled);
  t.destroy();
});

test('express-mw: creates trace, sets header, finalizes on res.end', () => {
  const t = makeTracer({ samplingRate: 1 });
  const mw = expressMiddleware(t);
  const req = { headers: {}, method: 'GET', url: '/test' };
  let headerSet = null;
  let endCalled = false;
  const res = {
    statusCode: 200,
    setHeader(k, v) { headerSet = { k, v }; },
    end() { endCalled = true; },
  };
  let nextFn;
  mw(req, res, () => {
    assert(req._trace != null, 'trace should be attached to req');
    assert(headerSet != null && headerSet.k === 'X-Request-ID');
    res.end();
  });
  assert(endCalled);
  assertEqual(t.storage.size, 1);
  t.destroy();
});

test('express-mw: res.end passes through arguments', () => {
  const t = makeTracer();
  const mw = expressMiddleware(t);
  const req = { headers: {}, method: 'GET', url: '/pass' };
  let receivedArgs = null;
  const res = {
    statusCode: 200,
    setHeader() {},
    end(...args) { receivedArgs = args; },
  };
  mw(req, res, () => { res.end('body', 'utf8'); });
  assertEqual(receivedArgs[0], 'body');
  assertEqual(receivedArgs[1], 'utf8');
  t.destroy();
});

test('express-mw: autoTrack with no app calls next()', () => {
  const t = makeTracer({ autoTrack: true });
  const mw = expressMiddleware(t);
  const req = { headers: {}, method: 'GET', url: '/noapp' };
  const res = { statusCode: 200, setHeader() {}, end() {} };
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  assert(nextCalled);
  t.destroy();
});

test('express-mw: autoTrack with app but no _router calls next()', () => {
  const t = makeTracer({ autoTrack: true });
  const mw = expressMiddleware(t);
  const req = { headers: {}, method: 'GET', url: '/nortr', app: {} };
  const res = { statusCode: 200, setHeader() {}, end() {} };
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  assert(nextCalled);
  t.destroy();
});

test('express-mw: autoTrack patches and invokes 3-arg handler via patched handle', () => {
  const t = makeTracer({ autoTrack: true });
  const mw = expressMiddleware(t);

  let layerHandlerCalled = false;
  const layer = {
    name: 'myMiddleware',
    handle: function (r, s, n) { layerHandlerCalled = true; n(); },
  };

  const fakeRouter = {
    stack: [layer],
    handle: function (req2, res2, done) {
      for (const l of this.stack) l.handle(req2, res2, done);
    },
  };

  const req = { headers: {}, method: 'GET', url: '/auto', app: { _router: fakeRouter } };
  const res = { statusCode: 200, setHeader() {}, end() {} };
  mw(req, res, () => {
    // The patched handle is now installed; call it to trigger lines 42-81
    req.app._router.handle(req, res, () => {});
  });
  assert(layerHandlerCalled, 'original layer handler should have been called');
  assert(req._trace.steps.length >= 1, 'step should be recorded');
  assertEqual(req._trace.steps[0].name, 'myMiddleware');
  t.destroy();
});

test('express-mw: autoTrack patches and invokes 4-arg error handler via patched handle', () => {
  const t = makeTracer({ autoTrack: true });
  const mw = expressMiddleware(t);

  let errHandlerCalled = false;
  const layer = {
    name: 'errHandler',
    handle: function (err, r, s, n) { errHandlerCalled = true; n(); },
  };

  const fakeRouter = {
    stack: [layer],
    handle: function (req2, res2, done) {
      for (const l of this.stack) {
        if (l.handle.length === 4) l.handle(new Error('test'), req2, res2, done);
        else l.handle(req2, res2, done);
      }
    },
  };

  const req = { headers: {}, method: 'GET', url: '/err', app: { _router: fakeRouter } };
  const res = { statusCode: 200, setHeader() {}, end() {} };
  mw(req, res, () => {
    req.app._router.handle(req, res, () => {});
  });
  assert(errHandlerCalled, 'error handler should have been called');
  assert(req._trace.steps.length >= 1);
  assertEqual(req._trace.steps[0].name, 'errHandler');
  t.destroy();
});

test('express-mw: autoTrack skips already-wrapped layers via patched handle', () => {
  const t = makeTracer({ autoTrack: true });
  const mw = expressMiddleware(t);

  let handlerCalled = false;
  const layer = {
    name: 'wrapped',
    _traceWrapped: true,
    handle: function (r, s, n) { handlerCalled = true; n(); },
  };

  const fakeRouter = {
    stack: [layer],
    handle: function (req2, res2, done) {
      for (const l of this.stack) l.handle(req2, res2, done);
    },
  };

  const req = { headers: {}, method: 'GET', url: '/skip', app: { _router: fakeRouter } };
  const res = { statusCode: 200, setHeader() {}, end() {} };
  mw(req, res, () => {
    req.app._router.handle(req, res, () => {});
  });
  assert(handlerCalled, 'wrapped layer handler should still be called');
  // Already-wrapped layer should NOT add a new step
  assertEqual(req._trace.steps.length, 0);
  t.destroy();
});

test('express-mw: autoTrack layer with route path as name via patched handle', () => {
  const t = makeTracer({ autoTrack: true });
  const mw = expressMiddleware(t);

  const layer = {
    route: { path: '/checkout' },
    handle: function (r, s, n) { n(); },
  };

  const fakeRouter = {
    stack: [layer],
    handle: function (req2, res2, done) {
      for (const l of this.stack) l.handle(req2, res2, done);
    },
  };

  const req = { headers: {}, method: 'GET', url: '/route', app: { _router: fakeRouter } };
  const res = { statusCode: 200, setHeader() {}, end() {} };
  mw(req, res, () => {
    req.app._router.handle(req, res, () => {});
  });
  assertEqual(req._trace.steps[0].name, '/checkout');
  t.destroy();
});

test('express-mw: autoTrack layer with no name uses index fallback via patched handle', () => {
  const t = makeTracer({ autoTrack: true });
  const mw = expressMiddleware(t);

  const layer = {
    handle: function (r, s, n) { n(); },
  };
  Object.defineProperty(layer.handle, 'name', { value: '' });
  Object.defineProperty(layer, 'name', { value: '' });

  const fakeRouter = {
    stack: [layer],
    handle: function (req2, res2, done) {
      for (const l of this.stack) l.handle(req2, res2, done);
    },
  };

  const req = { headers: {}, method: 'GET', url: '/idx', app: { _router: fakeRouter } };
  const res = { statusCode: 200, setHeader() {}, end() {} };
  mw(req, res, () => {
    req.app._router.handle(req, res, () => {});
  });
  assert(req._trace.steps[0].name.startsWith('middleware_'));
  t.destroy();
});

test('express-mw: autoTrack restores original handle after patched invocation', () => {
  const t = makeTracer({ autoTrack: true });
  const mw = expressMiddleware(t);

  const layer = {
    name: 'myLayer',
    handle: function (r, s, n) { n(); },
  };

  const origHandleFn = function (req2, res2, done) {
    for (const l of this.stack) l.handle(req2, res2, done);
  };

  const fakeRouter = {
    stack: [layer],
    handle: origHandleFn,
  };

  const req = { headers: {}, method: 'GET', url: '/step', app: { _router: fakeRouter } };
  const res = { statusCode: 200, setHeader() {}, end() {} };
  mw(req, res, () => {
    // Handle is patched right now
    assert(req.app._router.handle !== origHandleFn, 'handle should be patched');
    req.app._router.handle(req, res, () => {});
    // After invocation, handle should be restored
    assertEqual(req.app._router.handle, origHandleFn);
  });
  t.destroy();
});

test('express-mw: autoTrack 3-arg callback works without trace on req', () => {
  const t = makeTracer({ autoTrack: true });
  const mw = expressMiddleware(t);

  const layer = {
    name: 'noTraceLayer',
    handle: function (r, s, n) {
      delete r._trace;
      n();
    },
  };

  const fakeRouter = {
    stack: [layer],
    handle: function (req2, res2, done) {
      for (const l of this.stack) l.handle(req2, res2, done);
    },
  };

  const req = { headers: {}, method: 'GET', url: '/nop', app: { _router: fakeRouter } };
  const res = { statusCode: 200, setHeader() {}, end() {} };
  let doneCalled = false;
  mw(req, res, () => {
    req.app._router.handle(req, res, () => { doneCalled = true; });
  });
  assert(doneCalled);
  t.destroy();
});

test('express-mw: autoTrack 4-arg callback works without trace on req', () => {
  const t = makeTracer({ autoTrack: true });
  const mw = expressMiddleware(t);

  const layer = {
    name: 'errNoTrace',
    handle: function (err, r, s, n) {
      delete r._trace;
      n();
    },
  };

  const fakeRouter = {
    stack: [layer],
    handle: function (req2, res2, done) {
      for (const l of this.stack) {
        if (l.handle.length === 4) l.handle(new Error('e'), req2, res2, done);
        else l.handle(req2, res2, done);
      }
    },
  };

  const req = { headers: {}, method: 'GET', url: '/errnot', app: { _router: fakeRouter } };
  const res = { statusCode: 200, setHeader() {}, end() {} };
  let doneCalled = false;
  mw(req, res, () => {
    req.app._router.handle(req, res, () => { doneCalled = true; });
  });
  assert(doneCalled);
  t.destroy();
});

test('express-mw: autoTrack patched handle with empty stack', () => {
  const t = makeTracer({ autoTrack: true });
  const mw = expressMiddleware(t);

  const fakeRouter = {
    handle: function (req2, res2, done) { done(); },
  };

  const req = { headers: {}, method: 'GET', url: '/empty', app: { _router: fakeRouter } };
  const res = { statusCode: 200, setHeader() {}, end() {} };
  let doneCalled = false;
  mw(req, res, () => {
    req.app._router.handle(req, res, () => { doneCalled = true; });
  });
  assert(doneCalled);
  assertEqual(req._trace.steps.length, 0);
  t.destroy();
});

// =========================================================================
// middleware/fastify.js
// =========================================================================
const fastifyPluginFn = require('../lib/middleware/fastify');

test('fastify-mw: registers hooks and calls done()', () => {
  const t = makeTracer();
  const plugin = fastifyPluginFn(t);
  const hooks = {};
  const fakeFastify = {
    addHook(name, fn) { hooks[name] = fn; },
  };
  let doneCalled = false;
  plugin(fakeFastify, {}, () => { doneCalled = true; });
  assert(doneCalled);
  assert(typeof hooks.onRequest === 'function');
  assert(typeof hooks.onResponse === 'function');
  t.destroy();
});

test('fastify-mw: onRequest creates trace when sampled', () => {
  const t = makeTracer({ samplingRate: 1 });
  const plugin = fastifyPluginFn(t);
  const hooks = {};
  const fakeFastify = { addHook(name, fn) { hooks[name] = fn; } };
  plugin(fakeFastify, {}, () => {});

  const request = { method: 'GET', url: '/fast', headers: {} };
  let headerVal = null;
  const reply = { header(k, v) { headerVal = v; }, statusCode: 200 };
  let hookDoneCalled = false;
  hooks.onRequest(request, reply, () => { hookDoneCalled = true; });
  assert(hookDoneCalled);
  assert(request._trace != null);
  assert(headerVal != null);
  t.destroy();
});

test('fastify-mw: onRequest skips when not sampled', () => {
  const t = makeTracer({ samplingRate: 0 });
  const plugin = fastifyPluginFn(t);
  const hooks = {};
  const fakeFastify = { addHook(name, fn) { hooks[name] = fn; } };
  plugin(fakeFastify, {}, () => {});

  const request = { method: 'GET', url: '/skip', headers: {} };
  const reply = { header() {} };
  let hookDoneCalled = false;
  hooks.onRequest(request, reply, () => { hookDoneCalled = true; });
  assert(hookDoneCalled);
  assertEqual(request._trace, undefined);
  t.destroy();
});

test('fastify-mw: onResponse finalizes trace when present', () => {
  const t = makeTracer();
  const plugin = fastifyPluginFn(t);
  const hooks = {};
  const fakeFastify = { addHook(name, fn) { hooks[name] = fn; } };
  plugin(fakeFastify, {}, () => {});

  const trace = engine.createTrace({ method: 'GET', url: '/done', headers: {} });
  const request = { _trace: trace };
  const reply = { statusCode: 200 };
  let hookDoneCalled = false;
  hooks.onResponse(request, reply, () => { hookDoneCalled = true; });
  assert(hookDoneCalled);
  assert(trace.duration >= 0);
  assertEqual(trace.status, 200);
  assertEqual(t.storage.size, 1);
  t.destroy();
});

test('fastify-mw: onResponse handles missing trace gracefully', () => {
  const t = makeTracer();
  const plugin = fastifyPluginFn(t);
  const hooks = {};
  const fakeFastify = { addHook(name, fn) { hooks[name] = fn; } };
  plugin(fakeFastify, {}, () => {});

  const request = {};
  const reply = { statusCode: 200 };
  let hookDoneCalled = false;
  hooks.onResponse(request, reply, () => { hookDoneCalled = true; });
  assert(hookDoneCalled);
  assertEqual(t.storage.size, 0);
  t.destroy();
});

// =========================================================================
// middleware/koa.js
// =========================================================================
const koaMiddlewareFn = require('../lib/middleware/koa');

test('koa-mw: skips tracing when sampling rejects', async () => {
  const t = makeTracer({ samplingRate: 0 });
  const mw = koaMiddlewareFn(t);
  let nextCalled = false;
  await mw({ method: 'GET', url: '/', path: '/', headers: {}, set() {} }, async () => { nextCalled = true; });
  assert(nextCalled);
  t.destroy();
});

test('koa-mw: creates trace and finalizes on success', async () => {
  const t = makeTracer({ samplingRate: 1 });
  const mw = koaMiddlewareFn(t);
  let headerSet = null;
  const ctx = {
    method: 'GET', url: '/koa', path: '/koa', headers: {}, status: 200,
    set(k, v) { headerSet = { k, v }; },
  };
  await mw(ctx, async () => {});
  assert(headerSet != null);
  assertEqual(headerSet.k, 'X-Request-ID');
  assert(ctx._trace != null);
  assertEqual(ctx._trace.status, 200);
  assertEqual(t.storage.size, 1);
  t.destroy();
});

test('koa-mw: finalizes and rethrows on error in next()', async () => {
  const t = makeTracer({ samplingRate: 1 });
  const mw = koaMiddlewareFn(t);
  const ctx = {
    method: 'POST', url: '/fail', path: '/fail', headers: {}, status: 0,
    set() {},
  };
  let threw = false;
  try {
    await mw(ctx, async () => { throw new Error('koa-err'); });
  } catch (e) {
    threw = true;
    assertEqual(e.message, 'koa-err');
  }
  assert(threw);
  assert(ctx._trace != null);
  assertEqual(ctx._trace.status, 500);
  assertEqual(t.storage.size, 1);
  t.destroy();
});

test('koa-mw: uses ctx.status when non-zero on error', async () => {
  const t = makeTracer({ samplingRate: 1 });
  const mw = koaMiddlewareFn(t);
  const ctx = {
    method: 'POST', url: '/err', path: '/err', headers: {}, status: 422,
    set() {},
  };
  try {
    await mw(ctx, async () => { throw new Error('validation'); });
  } catch (e) {}
  assertEqual(ctx._trace.status, 422);
  t.destroy();
});

// =========================================================================
// index.js (RequestTracer)
// =========================================================================
const { RequestTracer: RT } = require('../index');

test('api: constructor sets defaults', () => {
  const t = new RT();
  assertEqual(t.config.slowThreshold, 200);
  assertEqual(t.storage, null);
  assertEqual(t._logger, null);
  assertEqual(t._initialized, false);
});

test('api: init returns this', () => {
  const t = new RT();
  const ret = t.init();
  assertEqual(ret, t);
  assert(t._initialized);
  assert(t.storage != null);
  t.destroy();
});

test('api: init with custom options merges with defaults', () => {
  const t = new RT();
  t.init({ slowThreshold: 500, maxTraces: 50, retentionSeconds: 60 });
  assertEqual(t.config.slowThreshold, 500);
  assertEqual(t.config.maxTraces, 50);
  assertEqual(t.config.retentionSeconds, 60);
  assertEqual(t.config.samplingRate, 1);
  assertEqual(t.config.autoTrack, false);
  assertEqual(t.config.logBody, false);
  assertEqual(t.config.sensitiveHeaders, null);
  t.destroy();
});

test('api: middleware() returns express middleware by default', () => {
  const t = new RT();
  const mw = t.middleware();
  assert(typeof mw === 'function');
  assert(t._initialized);
  t.destroy();
});

test('api: middleware("koa") returns koa middleware', () => {
  const t = new RT();
  const mw = t.middleware('koa');
  assert(typeof mw === 'function');
  t.destroy();
});

test('api: fastifyPlugin() returns plugin function', () => {
  const t = new RT();
  const p = t.fastifyPlugin();
  assert(typeof p === 'function');
  assert(t._initialized);
  t.destroy();
});

test('api: koaMiddleware() returns async function', () => {
  const t = new RT();
  const mw = t.koaMiddleware();
  assert(typeof mw === 'function');
  assert(t._initialized);
  t.destroy();
});

test('api: routes() returns router function', () => {
  const t = new RT();
  const r = t.routes();
  assert(typeof r === 'function');
  assert(t._initialized);
  t.destroy();
});

test('api: current() returns null outside context', () => {
  const t = new RT();
  t.init();
  assertEqual(t.current(), null);
  t.destroy();
});

test('api: step() works inside trace context', async () => {
  const t = new RT();
  t.init();
  const trace = engine.createTrace({ method: 'GET', url: '/api', headers: {} });
  await engine.runWithTrace(trace, async () => {
    const result = await t.step('query', async () => 'data');
    assertEqual(result, 'data');
    assertEqual(t.current().steps.length, 1);
    assertEqual(t.current().steps[0].name, 'query');
  });
  t.destroy();
});

test('api: useLogger("pino", ...) sets pino logger', () => {
  const t = new RT();
  t.init();
  const mockPino = { info() {}, warn() {} };
  const ret = t.useLogger('pino', mockPino);
  assertEqual(ret, t);
  assert(t._logger != null);
  assert(typeof t._logger.onTrace === 'function');
  t.destroy();
});

test('api: useLogger("winston", ...) sets winston logger', () => {
  const t = new RT();
  t.init();
  const mockWinston = { info() {}, warn() {} };
  t.useLogger('winston', mockWinston);
  assert(t._logger != null);
  t.destroy();
});

test('api: useLogger("console") sets console logger', () => {
  const t = new RT();
  t.init();
  t.useLogger('console');
  assert(t._logger != null);
  t.destroy();
});

test('api: useLogger with custom object', () => {
  const t = new RT();
  t.init();
  const custom = { onTrace() {} };
  t.useLogger(custom);
  assertEqual(t._logger, custom);
  t.destroy();
});

test('api: useLogger with invalid type does not set logger', () => {
  const t = new RT();
  t.init();
  t.useLogger('invalid');
  assertEqual(t._logger, null);
  t.destroy();
});

test('api: useLogger with object missing onTrace does not set logger', () => {
  const t = new RT();
  t.init();
  t.useLogger({ notOnTrace() {} });
  assertEqual(t._logger, null);
  t.destroy();
});

test('api: sanitizeHeaders delegates correctly', () => {
  const t = new RT();
  t.init();
  const result = t.sanitizeHeaders({ 'authorization': 'secret', 'x-ok': 'val' });
  assertEqual(result['authorization'], '[REDACTED]');
  assertEqual(result['x-ok'], 'val');
  t.destroy();
});

test('api: sanitizeHeaders with custom sensitiveHeaders config', () => {
  const t = new RT();
  t.init({ sensitiveHeaders: ['x-my-secret'] });
  const result = t.sanitizeHeaders({ 'x-my-secret': 'hidden', 'authorization': 'visible' });
  assertEqual(result['x-my-secret'], '[REDACTED]');
  assertEqual(result['authorization'], 'visible');
  t.destroy();
});

test('api: destroy clears storage and resets state', () => {
  const t = new RT();
  t.init();
  t.storage.store({ requestId: 'd1', startTime: Date.now(), duration: 10, steps: [] });
  t.destroy();
  assertEqual(t._initialized, false);
});

test('api: destroy without storage is safe', () => {
  const t = new RT();
  t.destroy();
  assertEqual(t._initialized, false);
});

test('api: _shouldSample always true for rate >= 1', () => {
  const t = new RT();
  t.init({ samplingRate: 1 });
  assert(t._shouldSample());
  t.destroy();
});

test('api: _shouldSample always true for rate > 1', () => {
  const t = new RT();
  t.init({ samplingRate: 2 });
  assert(t._shouldSample());
  t.destroy();
});

test('api: _shouldSample always false for rate 0', () => {
  const t = new RT();
  t.init({ samplingRate: 0 });
  let sampled = false;
  for (let i = 0; i < 100; i++) {
    if (t._shouldSample()) { sampled = true; break; }
  }
  assert(!sampled);
  t.destroy();
});

test('api: _onTraceComplete without storage is safe', () => {
  const t = new RT();
  t._onTraceComplete({ requestId: 'x', duration: 100, steps: [] });
});

test('api: _onTraceComplete marks slow traces', () => {
  const t = new RT();
  t.init({ slowThreshold: 100 });
  const trace = { requestId: 'slow1', startTime: Date.now(), duration: 150, status: 200, steps: [] };
  t._onTraceComplete(trace);
  assert(trace._slow === true);
  t.destroy();
});

test('api: _onTraceComplete does not mark fast traces as slow', () => {
  const t = new RT();
  t.init({ slowThreshold: 100 });
  const trace = { requestId: 'fast1', startTime: Date.now(), duration: 50, status: 200, steps: [] };
  t._onTraceComplete(trace);
  assertEqual(trace._slow, undefined);
  t.destroy();
});

test('api: _onTraceComplete calls logger.onTrace', () => {
  const t = new RT();
  t.init();
  const logs = [];
  t.useLogger({ onTrace(tr) { logs.push(tr.requestId); } });
  t._onTraceComplete({ requestId: 'l1', startTime: Date.now(), duration: 10, status: 200, steps: [] });
  assertEqual(logs.length, 1);
  assertEqual(logs[0], 'l1');
  t.destroy();
});

test('api: _onTraceComplete catches logger errors', () => {
  const t = new RT();
  t.init();
  t.useLogger({ onTrace() { throw new Error('logger crash'); } });
  t._onTraceComplete({ requestId: 'crash', startTime: Date.now(), duration: 10, status: 200, steps: [] });
  assertEqual(t.storage.size, 1);
  t.destroy();
});

test('api: _onTraceComplete skips logger when logger has no onTrace', () => {
  const t = new RT();
  t.init();
  t._logger = { notOnTrace() {} };
  t._onTraceComplete({ requestId: 'nolog', startTime: Date.now(), duration: 10, status: 200, steps: [] });
  assertEqual(t.storage.size, 1);
  t.destroy();
});

test('api: _ensureInit initializes when not yet initialized', () => {
  const t = new RT();
  assert(!t._initialized);
  t._ensureInit();
  assert(t._initialized);
  assert(t.storage != null);
  t.destroy();
});

test('api: _ensureInit is no-op when already initialized', () => {
  const t = new RT();
  t.init({ slowThreshold: 999 });
  t._ensureInit();
  assertEqual(t.config.slowThreshold, 999);
  t.destroy();
});

test('api: module exports singleton and RequestTracer class', () => {
  const mod = require('../index');
  assert(typeof mod.middleware === 'function');
  assert(typeof mod.init === 'function');
  assert(typeof mod.RequestTracer === 'function');
});

// Run all tests
run();
