'use strict';

const DEFAULT_SENSITIVE_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'proxy-authorization',
];

function sanitizeHeaders(headers, sensitiveList) {
  if (!headers) return {};
  const blocked = new Set((sensitiveList || DEFAULT_SENSITIVE_HEADERS).map(h => h.toLowerCase()));
  const safe = {};
  for (const [key, value] of Object.entries(headers)) {
    safe[key] = blocked.has(key.toLowerCase()) ? '[REDACTED]' : value;
  }
  return safe;
}

module.exports = { sanitizeHeaders, DEFAULT_SENSITIVE_HEADERS };
