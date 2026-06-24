'use strict';

const { analyzeRepetition, formatRepetitionWarnings } = require('./analysis');

const DEFAULT_WIDTH = 48;

function buildTimeline(trace) {
  if (!trace || typeof trace !== 'object') {
    throw new TypeError('trace is required');
  }

  const requestStart = toNumber(trace.startTime, firstStepStart(trace.steps));
  const totalDuration = Math.max(toNumber(trace.duration, estimateDuration(trace, requestStart)), 0);
  const requestEnd = requestStart + totalDuration;
  const steps = normalizeSteps(trace.steps, requestStart, totalDuration);
  const intervals = steps.map(step => [step.offset, step.offset + step.duration]);
  const coveredDuration = measureCoveredDuration(intervals, totalDuration);
  const stepTotalDuration = steps.reduce((sum, step) => sum + step.duration, 0);
  const uninstrumentedDuration = Math.max(totalDuration - coveredDuration, 0);
  const gaps = findGaps(steps, requestStart, requestEnd, totalDuration);
  const bottleneck = steps.reduce((current, step) => {
    if (!current || step.duration > current.duration) return step;
    return current;
  }, null);

  const repetition = analyzeRepetition(steps);

  return {
    requestId: trace.requestId || null,
    method: trace.method || 'UNKNOWN',
    path: trace.path || '/',
    status: toNumber(trace.status, 0),
    startTime: requestStart,
    totalDuration,
    stepCount: steps.length,
    steps,
    summary: {
      bottleneck,
      topSteps: steps.slice().sort((a, b) => b.duration - a.duration).slice(0, 5),
      coveredDuration,
      stepTotalDuration,
      uninstrumentedDuration,
      coveragePercent: percent(coveredDuration, totalDuration),
      errorCount: steps.filter(step => step.error).length,
      gaps,
      nPlusOne: repetition.nPlusOne,
      duplicates: repetition.duplicates,
      hasNPlusOne: repetition.hasNPlusOne,
      wastedDuration: repetition.wastedDuration,
    },
  };
}

function renderTimeline(trace, options = {}) {
  const report = buildTimeline(trace);
  const width = Math.max(toNumber(options.width, DEFAULT_WIDTH), 20);
  const lines = [];
  const title = `${report.method} ${report.path} ${report.totalDuration}ms (${report.status})`;

  lines.push(title);
  if (report.requestId) {
    lines.push(`requestId: ${report.requestId}`);
  }

  const bottleneck = report.summary.bottleneck;
  if (bottleneck) {
    lines.push(
      `bottleneck: ${bottleneck.name} ${bottleneck.duration}ms (${bottleneck.percentOfRequest}%)`
    );
  } else {
    lines.push('bottleneck: none');
  }

  lines.push(
    `coverage: ${report.summary.coveredDuration}ms traced (${report.summary.coveragePercent}%), ` +
    `${report.summary.uninstrumentedDuration}ms uninstrumented`
  );

  const warnings = formatRepetitionWarnings(
    { duplicates: report.summary.duplicates },
    { ascii: options.ascii }
  );
  for (const warning of warnings) {
    lines.push(warning);
  }

  lines.push(`0ms |${'-'.repeat(width)}| ${report.totalDuration}ms`);

  if (!report.steps.length) {
    lines.push('no steps recorded');
    return lines.join('\n');
  }

  report.steps.forEach((step, index) => {
    const marker = index === report.steps.length - 1 ? '`-' : '|-';
    const bar = renderPositionedBar(step.offset, step.duration, report.totalDuration, width);
    const type = step.type ? ` [${step.type}]` : '';
    const error = step.error ? ` ERROR: ${step.error}` : '';
    lines.push(`${marker} ${padRight(step.name, 24)} ${bar} ${step.duration}ms${type}${error}`);
  });

  return lines.join('\n');
}

function normalizeSteps(steps, requestStart, totalDuration) {
  if (!Array.isArray(steps)) return [];

  return steps
    .map((step, index) => {
      const start = toNumber(step.start, requestStart);
      const duration = Math.max(toNumber(step.duration, 0), 0);
      const offset = clamp(start - requestStart, 0, totalDuration);

      return {
        name: step.name || `step_${index + 1}`,
        type: step.type || null,
        start,
        offset,
        duration,
        end: start + duration,
        percentOfRequest: percent(duration, totalDuration),
        error: step.error || null,
      };
    })
    .sort((a, b) => {
      if (a.start === b.start) return b.duration - a.duration;
      return a.start - b.start;
    });
}

function findGaps(steps, requestStart, requestEnd, totalDuration) {
  const gaps = [];
  let cursor = requestStart;

  for (const step of steps) {
    if (step.start > cursor) {
      const duration = step.start - cursor;
      gaps.push({
        start: cursor,
        offset: clamp(cursor - requestStart, 0, totalDuration),
        duration,
        percentOfRequest: percent(duration, totalDuration),
      });
    }
    cursor = Math.max(cursor, step.end);
  }

  if (requestEnd > cursor) {
    const duration = requestEnd - cursor;
    gaps.push({
      start: cursor,
      offset: clamp(cursor - requestStart, 0, totalDuration),
      duration,
      percentOfRequest: percent(duration, totalDuration),
    });
  }

  return gaps.filter(gap => gap.duration > 0);
}

function measureCoveredDuration(intervals, totalDuration) {
  const normalized = intervals
    .map(([start, end]) => [clamp(start, 0, totalDuration), clamp(end, 0, totalDuration)])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);

  let covered = 0;
  let currentStart = null;
  let currentEnd = null;

  for (const [start, end] of normalized) {
    if (currentStart === null) {
      currentStart = start;
      currentEnd = end;
    } else if (start <= currentEnd) {
      currentEnd = Math.max(currentEnd, end);
    } else {
      covered += currentEnd - currentStart;
      currentStart = start;
      currentEnd = end;
    }
  }

  if (currentStart !== null) {
    covered += currentEnd - currentStart;
  }

  return covered;
}

function renderPositionedBar(offset, duration, totalDuration, width) {
  const safeTotal = Math.max(totalDuration, 1);
  const left = Math.min(Math.floor((offset / safeTotal) * width), width - 1);
  const barWidth = Math.max(Math.round((duration / safeTotal) * width), 1);
  const right = Math.min(left + barWidth, width);
  return ' '.repeat(left) + '#'.repeat(Math.max(right - left, 1));
}

function firstStepStart(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return Date.now();
  const starts = steps
    .map(step => Number(step.start))
    .filter(Number.isFinite);
  return starts.length ? Math.min(...starts) : Date.now();
}

function estimateDuration(trace, requestStart) {
  if (!Array.isArray(trace.steps) || trace.steps.length === 0) return 0;
  const ends = trace.steps.map(step => toNumber(step.start, requestStart) + toNumber(step.duration, 0));
  return Math.max(...ends) - requestStart;
}

function percent(value, total) {
  if (!total) return 0;
  return Number(((value / total) * 100).toFixed(1));
}

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function padRight(value, length) {
  const str = String(value);
  return str.length >= length ? str.slice(0, length) : str + ' '.repeat(length - str.length);
}

module.exports = {
  buildTimeline,
  renderTimeline,
};
