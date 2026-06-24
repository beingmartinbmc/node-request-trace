'use strict';

const { currentTrace } = require('./trace-engine');

// Auto-instrumentation for popular data libraries. Each integration is opt-in
// and best-effort: if the module isn't installed or the internals differ, we
// skip silently rather than crash the host app. Steps are pushed onto the
// active trace via AsyncLocalStorage, so no manual trace.step() is needed.

const _patched = new Set();
const _restore = [];

function recordStep(name, type, start, error) {
  const trace = currentTrace();
  if (!trace) return;
  const step = { name, start, duration: Date.now() - start, type };
  if (error) step.error = error.message || String(error);
  trace.steps.push(step);
}

function tryRequire(name) {
  if (_requireOverride) return _requireOverride(name);
  try {
    return require(name);
  } catch (_) {
    return null;
  }
}

// Test seam: lets the suite inject fake drivers so the patch paths are
// exercised without installing pg/mongodb/ioredis. Not part of the public API.
let _requireOverride = null;
function __setRequireForTests(fn) {
  _requireOverride = fn;
}

// Wrap a function that returns a promise, timing it as a step.
function timePromise(name, type, fn, thisArg, args) {
  const start = Date.now();
  let result;
  try {
    result = fn.apply(thisArg, args);
  } catch (err) {
    recordStep(name, type, start, err);
    throw err;
  }
  if (result && typeof result.then === 'function') {
    return result.then(
      (value) => { recordStep(name, type, start); return value; },
      (err) => { recordStep(name, type, start, err); throw err; }
    );
  }
  recordStep(name, type, start);
  return result;
}

// --- pg (node-postgres) ---------------------------------------------------
function instrumentPg() {
  const pg = tryRequire('pg');
  if (!pg || !pg.Client || _patched.has('pg')) return false;
  const proto = pg.Client.prototype;
  const orig = proto.query;
  if (typeof orig !== 'function') return false;

  proto.query = function tracedQuery(...args) {
    const sql = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].text) || 'query';
    const name = `pg ${truncateSql(sql)}`;
    // pg.query supports both callback and promise styles; only time promise.
    const last = args[args.length - 1];
    if (typeof last === 'function') {
      const start = Date.now();
      const cb = args[args.length - 1];
      args[args.length - 1] = function (err, ...rest) {
        recordStep(name, 'db', start, err);
        return cb(err, ...rest);
      };
      return orig.apply(this, args);
    }
    return timePromise(name, 'db', orig, this, args);
  };

  _patched.add('pg');
  _restore.push(() => { proto.query = orig; _patched.delete('pg'); });
  return true;
}

// --- mysql2 ---------------------------------------------------------------
function instrumentMysql2() {
  const mysql = tryRequire('mysql2');
  if (!mysql || _patched.has('mysql2')) return false;
  const promiseMod = tryRequire('mysql2/promise');
  let patchedAny = false;

  if (promiseMod && promiseMod.Connection) {
    // Newer mysql2 exposes prototypes lazily; patch via createConnection wrap.
  }

  // Patch the core Connection.prototype.query if reachable.
  const core = tryRequire('mysql2');
  const Connection = core && core.Connection;
  if (Connection && Connection.prototype && typeof Connection.prototype.query === 'function') {
    const orig = Connection.prototype.query;
    Connection.prototype.query = function tracedQuery(sql, ...rest) {
      const text = typeof sql === 'string' ? sql : (sql && sql.sql) || 'query';
      const name = `mysql ${truncateSql(text)}`;
      const start = Date.now();
      const last = rest[rest.length - 1];
      if (typeof last === 'function') {
        rest[rest.length - 1] = function (err, ...r) {
          recordStep(name, 'db', start, err);
          return last(err, ...r);
        };
        return orig.call(this, sql, ...rest);
      }
      const out = orig.call(this, sql, ...rest);
      if (out && typeof out.then === 'function') {
        return out.then(
          (v) => { recordStep(name, 'db', start); return v; },
          (e) => { recordStep(name, 'db', start, e); throw e; }
        );
      }
      recordStep(name, 'db', start);
      return out;
    };
    _restore.push(() => { Connection.prototype.query = orig; });
    patchedAny = true;
  }

  if (patchedAny) _patched.add('mysql2');
  return patchedAny;
}

// --- mongodb --------------------------------------------------------------
function instrumentMongodb() {
  const mongo = tryRequire('mongodb');
  if (!mongo || !mongo.Collection || _patched.has('mongodb')) return false;
  const proto = mongo.Collection.prototype;
  const methods = ['find', 'findOne', 'insertOne', 'insertMany', 'updateOne',
    'updateMany', 'deleteOne', 'deleteMany', 'aggregate', 'countDocuments'];
  let patchedAny = false;

  for (const method of methods) {
    const orig = proto[method];
    if (typeof orig !== 'function') continue;
    proto[method] = function tracedMongo(...args) {
      const name = `mongo ${this.collectionName || 'collection'}.${method}`;
      // find/aggregate return cursors (lazy); time the sync call only.
      if (method === 'find' || method === 'aggregate') {
        const start = Date.now();
        const cursor = orig.apply(this, args);
        recordStep(name, 'db', start);
        return cursor;
      }
      return timePromise(name, 'db', orig, this, args);
    };
    _restore.push(() => { proto[method] = orig; });
    patchedAny = true;
  }

  if (patchedAny) _patched.add('mongodb');
  return patchedAny;
}

// --- redis / ioredis ------------------------------------------------------
function instrumentRedis() {
  let patchedAny = false;

  // ioredis: patch sendCommand.
  const IORedis = tryRequire('ioredis');
  if (IORedis && !_patched.has('ioredis')) {
    const proto = IORedis.prototype || (IORedis.default && IORedis.default.prototype);
    if (proto && typeof proto.sendCommand === 'function') {
      const orig = proto.sendCommand;
      proto.sendCommand = function tracedSend(command, ...rest) {
        const cmdName = command && command.name ? command.name : 'cmd';
        const name = `redis ${String(cmdName).toUpperCase()}`;
        return timePromise(name, 'cache', orig, this, [command, ...rest]);
      };
      _patched.add('ioredis');
      _restore.push(() => { proto.sendCommand = orig; _patched.delete('ioredis'); });
      patchedAny = true;
    }
  }

  return patchedAny;
}

// --- knex -----------------------------------------------------------------
function instrumentKnex() {
  const knex = tryRequire('knex');
  if (!knex || _patched.has('knex')) return false;
  // knex emits 'query'/'query-response' events per instance; we can't patch a
  // prototype reliably across versions. Expose a helper instead.
  _patched.add('knex');
  return true;
}

// Attach to a knex instance's event hooks (call manually since knex is
// instance-based): instrumentKnexInstance(knexInstance).
function instrumentKnexInstance(knexInstance) {
  if (!knexInstance || typeof knexInstance.on !== 'function') return knexInstance;
  const starts = new Map();
  knexInstance.on('query', (q) => { starts.set(q.__knexQueryUid, Date.now()); });
  const finish = (q, err) => {
    const start = starts.get(q.__knexQueryUid) || Date.now();
    starts.delete(q.__knexQueryUid);
    recordStep(`knex ${truncateSql(q.sql || 'query')}`, 'db', start, err);
  };
  knexInstance.on('query-response', (_resp, q) => finish(q));
  knexInstance.on('query-error', (err, q) => finish(q, err));
  return knexInstance;
}

// --- prisma ---------------------------------------------------------------
// Prisma is best instrumented via its $use middleware on a client instance.
function instrumentPrismaClient(prismaClient) {
  if (!prismaClient || typeof prismaClient.$use !== 'function') return prismaClient;
  prismaClient.$use(async (params, next) => {
    const name = `prisma ${params.model || ''}.${params.action}`.trim();
    const start = Date.now();
    try {
      const result = await next(params);
      recordStep(name, 'db', start);
      return result;
    } catch (err) {
      recordStep(name, 'db', start, err);
      throw err;
    }
  });
  return prismaClient;
}

function truncateSql(sql) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  return s.length > 60 ? s.slice(0, 57) + '...' : s;
}

// Enable all auto-detectable integrations. Returns the list that were applied.
function enableAutoInstrumentation(options = {}) {
  const only = options.only; // optional array of names
  const want = (name) => !only || only.includes(name);
  const applied = [];
  if (want('pg') && instrumentPg()) applied.push('pg');
  if (want('mysql2') && instrumentMysql2()) applied.push('mysql2');
  if (want('mongodb') && instrumentMongodb()) applied.push('mongodb');
  if (want('redis') && instrumentRedis()) applied.push('redis');
  if (want('knex') && instrumentKnex()) applied.push('knex');
  return applied;
}

function disableAutoInstrumentation() {
  while (_restore.length) {
    const restore = _restore.pop();
    try { restore(); } catch (_) { /* ignore */ }
  }
  _patched.clear();
}

module.exports = {
  enableAutoInstrumentation,
  disableAutoInstrumentation,
  instrumentKnexInstance,
  instrumentPrismaClient,
  __setRequireForTests,
  _patched,
};
