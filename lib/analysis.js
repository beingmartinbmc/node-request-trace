'use strict';

// Detects repeated work within a single request (N+1 queries, duplicate
// service calls, hot loops). Operates on the flat step list so it works
// with the existing trace shape and outgoing-HTTP steps.

const DEFAULT_DUPLICATE_THRESHOLD = 3; // >=N identical steps is suspicious
const DEFAULT_N_PLUS_ONE_THRESHOLD = 5; // >=N identical steps reads as N+1

// Collapses dynamic parts of a step name so semantically identical work
// groups together: numbers, hex ids, UUIDs, quoted literals.
function normalizeStepName(name) {
  if (typeof name !== 'string') return String(name);
  let out = name;
  // Strip query string from outgoing-HTTP step urls.
  out = out.replace(/\?.*$/, '');
  // UUIDs.
  out = out.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>');
  // Long hex blobs (mongo ids, request ids, hashes).
  out = out.replace(/\b[0-9a-f]{16,}\b/gi, '<hex>');
  // Quoted string literals (SQL).
  out = out.replace(/'[^']*'/g, "'?'").replace(/"[^"]*"/g, '"?"');
  // IN (...) lists.
  out = out.replace(/\bIN\s*\([^)]*\)/gi, 'IN (?)');
  // Standalone numbers (ids, offsets) -> ?.
  out = out.replace(/\b\d+\b/g, '?');
  // Collapse whitespace.
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

function groupSteps(steps) {
  const groups = new Map();
  if (!Array.isArray(steps)) return groups;

  for (const step of steps) {
    if (!step || !step.name) continue;
    const key = normalizeStepName(step.name);
    let group = groups.get(key);
    if (!group) {
      group = {
        pattern: key,
        sample: step.name,
        type: step.type || null,
        count: 0,
        totalDuration: 0,
        maxDuration: 0,
        errorCount: 0,
      };
      groups.set(key, group);
    }
    group.count += 1;
    const duration = Number(step.duration) || 0;
    group.totalDuration += duration;
    if (duration > group.maxDuration) group.maxDuration = duration;
    if (step.error) group.errorCount += 1;
  }

  return groups;
}

function analyzeRepetition(steps, options = {}) {
  const duplicateThreshold = options.duplicateThreshold || DEFAULT_DUPLICATE_THRESHOLD;
  const nPlusOneThreshold = options.nPlusOneThreshold || DEFAULT_N_PLUS_ONE_THRESHOLD;
  const groups = groupSteps(steps);

  const duplicates = [];
  for (const group of groups.values()) {
    if (group.count >= duplicateThreshold) {
      duplicates.push({
        pattern: group.pattern,
        sample: group.sample,
        type: group.type,
        count: group.count,
        totalDuration: group.totalDuration,
        maxDuration: group.maxDuration,
        avgDuration: Number((group.totalDuration / group.count).toFixed(1)),
        errorCount: group.errorCount,
        isNPlusOne: group.count >= nPlusOneThreshold,
      });
    }
  }

  // Worst offenders first: N+1 before plain duplicates, then by total time.
  duplicates.sort((a, b) => {
    if (a.isNPlusOne !== b.isNPlusOne) return a.isNPlusOne ? -1 : 1;
    return b.totalDuration - a.totalDuration;
  });

  const nPlusOne = duplicates.filter(d => d.isNPlusOne);

  return {
    duplicates,
    nPlusOne,
    hasNPlusOne: nPlusOne.length > 0,
    duplicateCount: duplicates.length,
    wastedDuration: duplicates.reduce(
      (sum, d) => sum + (d.totalDuration - d.maxDuration),
      0
    ),
  };
}

// Human-readable warning lines, e.g.
//   "⚠️ N+1 detected: db.user.find ran 23× (180ms total)"
function formatRepetitionWarnings(analysis, options = {}) {
  if (!analysis || !analysis.duplicates.length) return [];
  const icon = options.ascii ? '[!]' : '⚠️';
  return analysis.duplicates.map(d => {
    const label = d.isNPlusOne ? 'N+1 detected' : 'Duplicate work';
    return `${icon} ${label}: ${d.sample} ran ${d.count}× (${d.totalDuration}ms total)`;
  });
}

module.exports = {
  normalizeStepName,
  groupSteps,
  analyzeRepetition,
  formatRepetitionWarnings,
  DEFAULT_DUPLICATE_THRESHOLD,
  DEFAULT_N_PLUS_ONE_THRESHOLD,
};
