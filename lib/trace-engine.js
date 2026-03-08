'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('node:crypto');

const asyncLocalStorage = new AsyncLocalStorage();

function generateRequestId() {
  return 'req_' + crypto.randomBytes(8).toString('hex');
}

function createTrace(req) {
  const requestId =
    (req.headers && req.headers['x-request-id']) || generateRequestId();
  return {
    requestId,
    method: req.method || 'UNKNOWN',
    path: req.url || req.path || '/',
    startTime: Date.now(),
    duration: 0,
    status: 0,
    steps: [],
  };
}

function currentTrace() {
  return asyncLocalStorage.getStore() || null;
}

function runWithTrace(trace, fn) {
  return asyncLocalStorage.run(trace, fn);
}

function finalizeTrace(trace, statusCode) {
  trace.duration = Date.now() - trace.startTime;
  trace.status = statusCode || 0;
  return trace;
}

async function addStep(name, fn) {
  const trace = currentTrace();
  const step = {
    name,
    start: Date.now(),
    duration: 0,
  };

  try {
    const result = await fn();
    step.duration = Date.now() - step.start;
    if (trace) {
      trace.steps.push(step);
    }
    return result;
  } catch (err) {
    step.duration = Date.now() - step.start;
    step.error = err.message;
    if (trace) {
      trace.steps.push(step);
    }
    throw err;
  }
}

module.exports = {
  generateRequestId,
  createTrace,
  currentTrace,
  runWithTrace,
  finalizeTrace,
  addStep,
  asyncLocalStorage,
};
