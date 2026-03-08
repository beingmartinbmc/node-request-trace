'use strict';

const http = require('node:http');
const https = require('node:https');
const { currentTrace } = require('./trace-engine');

let _origHttpRequest = null;
let _origHttpGet = null;
let _origHttpsRequest = null;
let _origHttpsGet = null;
let _origFetch = null;
let _enabled = false;

function enableHttpTracing() {
  if (_enabled) return;
  _enabled = true;

  _origHttpRequest = http.request;
  _origHttpGet = http.get;
  _origHttpsRequest = https.request;
  _origHttpsGet = https.get;

  http.request = function tracedHttpRequest(...args) {
    return _wrapRequest(_origHttpRequest, 'http', args);
  };
  http.get = function tracedHttpGet(...args) {
    const req = _wrapRequest(_origHttpRequest, 'http', args);
    req.end();
    return req;
  };
  https.request = function tracedHttpsRequest(...args) {
    return _wrapRequest(_origHttpsRequest, 'https', args);
  };
  https.get = function tracedHttpsGet(...args) {
    const req = _wrapRequest(_origHttpsRequest, 'https', args);
    req.end();
    return req;
  };

  if (typeof globalThis.fetch === 'function') {
    _origFetch = globalThis.fetch;
    globalThis.fetch = function tracedFetch(...args) {
      return _wrapFetch(_origFetch, args);
    };
  }
}

function disableHttpTracing() {
  if (!_enabled) return;
  _enabled = false;

  if (_origHttpRequest) {
    http.request = _origHttpRequest;
    _origHttpRequest = null;
  }
  if (_origHttpGet) {
    http.get = _origHttpGet;
    _origHttpGet = null;
  }
  if (_origHttpsRequest) {
    https.request = _origHttpsRequest;
    _origHttpsRequest = null;
  }
  if (_origHttpsGet) {
    https.get = _origHttpsGet;
    _origHttpsGet = null;
  }
  if (_origFetch) {
    globalThis.fetch = _origFetch;
    _origFetch = null;
  }
}

function isEnabled() {
  return _enabled;
}

function _parseRequestArgs(args) {
  let method = 'GET';
  let host = 'unknown';
  let path = '/';

  const first = args[0];
  if (typeof first === 'string') {
    try {
      const u = new URL(first);
      host = u.host;
      path = u.pathname;
    } catch (_) {
      path = first;
    }
  } else if (first instanceof URL) {
    host = first.host;
    path = first.pathname;
  } else if (first && typeof first === 'object') {
    host = first.hostname || first.host || 'unknown';
    path = first.path || '/';
    method = first.method || 'GET';
  }

  const second = args[1];
  if (second && typeof second === 'object' && typeof second !== 'function') {
    if (second.method) method = second.method;
    if (second.hostname || second.host) host = second.hostname || second.host;
    if (second.path) path = second.path;
  }

  return { method: method.toUpperCase(), host, path };
}

function _wrapRequest(origFn, protocol, args) {
  const trace = currentTrace();
  if (!trace) return origFn.apply(null, args);

  const { method, host, path } = _parseRequestArgs(args);
  const stepName = `HTTP ${method} ${host}${path}`;
  const start = Date.now();

  const req = origFn.apply(null, args);

  req.on('response', () => {
    trace.steps.push({
      name: stepName,
      start,
      duration: Date.now() - start,
      type: 'http-outgoing',
    });
  });

  req.on('error', (err) => {
    trace.steps.push({
      name: stepName,
      start,
      duration: Date.now() - start,
      type: 'http-outgoing',
      error: err.message,
    });
  });

  return req;
}

async function _wrapFetch(origFn, args) {
  const trace = currentTrace();
  if (!trace) return origFn.apply(globalThis, args);

  const input = args[0];
  const init = args[1] || {};

  let method = 'GET';
  let host = 'unknown';
  let path = '/';

  if (typeof input === 'string') {
    try {
      const u = new URL(input);
      host = u.host;
      path = u.pathname;
    } catch (_) {
      path = input;
    }
  } else if (input instanceof URL) {
    host = input.host;
    path = input.pathname;
  } else if (input && typeof input === 'object' && input.url) {
    try {
      const u = new URL(input.url);
      host = u.host;
      path = u.pathname;
    } catch (_) { /* ignore */ }
    method = input.method || method;
  }

  method = (init.method || method).toUpperCase();

  const stepName = `HTTP ${method} ${host}${path}`;
  const start = Date.now();

  try {
    const response = await origFn.apply(globalThis, args);
    trace.steps.push({
      name: stepName,
      start,
      duration: Date.now() - start,
      type: 'http-outgoing',
    });
    return response;
  } catch (err) {
    trace.steps.push({
      name: stepName,
      start,
      duration: Date.now() - start,
      type: 'http-outgoing',
      error: err.message,
    });
    throw err;
  }
}

module.exports = {
  enableHttpTracing,
  disableHttpTracing,
  isEnabled,
  _parseRequestArgs,
  _wrapRequest,
  _wrapFetch,
};
