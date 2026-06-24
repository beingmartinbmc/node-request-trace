'use strict';

const { buildTimeline } = require('./timeline');
const { groupSteps } = require('./analysis');

// Compares two traces (a baseline "A" and a candidate "B") and reports how the
// request shape changed: total duration delta, per-step regressions, added and
// removed steps. Built for PR comments and CI gates.
function diffTraces(traceA, traceB, options = {}) {
  const a = buildTimeline(traceA);
  const b = buildTimeline(traceB);

  const groupsA = aggregateGroups(a.steps);
  const groupsB = aggregateGroups(b.steps);
  const keys = new Set([...groupsA.keys(), ...groupsB.keys()]);

  const steps = [];
  for (const key of keys) {
    const ga = groupsA.get(key);
    const gb = groupsB.get(key);
    const durA = ga ? ga.totalDuration : 0;
    const durB = gb ? gb.totalDuration : 0;
    let status;
    if (!ga) status = 'added';
    else if (!gb) status = 'removed';
    else if (durB > durA) status = 'slower';
    else if (durB < durA) status = 'faster';
    else status = 'unchanged';

    steps.push({
      name: (gb || ga).sample,
      status,
      durationA: durA,
      durationB: durB,
      deltaMs: durB - durA,
      deltaPercent: percentChange(durA, durB),
      countA: ga ? ga.count : 0,
      countB: gb ? gb.count : 0,
    });
  }

  // Most impactful changes first (largest absolute time delta).
  steps.sort((x, y) => Math.abs(y.deltaMs) - Math.abs(x.deltaMs));

  const totalDelta = b.totalDuration - a.totalDuration;
  const regressionThreshold = options.regressionPercent || 0;
  const totalPercent = percentChange(a.totalDuration, b.totalDuration);
  const regressed =
    totalPercent !== null && totalPercent > regressionThreshold && totalDelta > 0;

  return {
    a: summarize(a),
    b: summarize(b),
    totalDeltaMs: totalDelta,
    totalDeltaPercent: totalPercent,
    regressed,
    added: steps.filter(s => s.status === 'added'),
    removed: steps.filter(s => s.status === 'removed'),
    slower: steps.filter(s => s.status === 'slower'),
    faster: steps.filter(s => s.status === 'faster'),
    steps,
  };
}

function aggregateGroups(steps) {
  // Reuse the normalization from analysis so dynamic ids collapse together.
  return groupSteps(steps);
}

function summarize(report) {
  return {
    requestId: report.requestId,
    method: report.method,
    path: report.path,
    totalDuration: report.totalDuration,
    status: report.status,
  };
}

function percentChange(from, to) {
  if (!from) return to ? null : 0;
  return Number((((to - from) / from) * 100).toFixed(1));
}

// Render a markdown table suitable for a PR comment.
function diffToMarkdown(diff) {
  const arrow = diff.totalDeltaMs > 0 ? '🔺' : diff.totalDeltaMs < 0 ? '🔻' : '➖';
  const pct = diff.totalDeltaPercent === null ? 'n/a' : `${diff.totalDeltaPercent}%`;
  const lines = [];
  lines.push(
    `### ${arrow} Trace diff: \`${diff.b.method} ${diff.b.path}\``
  );
  lines.push('');
  lines.push(
    `**Total:** ${diff.a.totalDuration}ms → ${diff.b.totalDuration}ms ` +
    `(${signed(diff.totalDeltaMs)}ms, ${pct})` +
    (diff.regressed ? ' — ⚠️ **regression**' : '')
  );
  lines.push('');
  lines.push('| Step | Before | After | Δ | Change |');
  lines.push('|---|---:|---:|---:|---|');
  for (const s of diff.steps) {
    if (s.status === 'unchanged') continue;
    const change = changeLabel(s);
    lines.push(
      `| \`${escapeCell(s.name)}\` | ${s.durationA}ms | ${s.durationB}ms | ` +
      `${signed(s.deltaMs)}ms | ${change} |`
    );
  }
  return lines.join('\n');
}

function changeLabel(s) {
  if (s.status === 'added') return '🆕 added';
  if (s.status === 'removed') return '🗑️ removed';
  const pct = s.deltaPercent === null ? '' : ` (${signed(s.deltaPercent)}%)`;
  if (s.status === 'slower') return `🔺 slower${pct}`;
  return `🔻 faster${pct}`;
}

function signed(n) {
  return n > 0 ? `+${n}` : `${n}`;
}

function escapeCell(value) {
  return String(value).replace(/\|/g, '\\|');
}

module.exports = { diffTraces, diffToMarkdown };
