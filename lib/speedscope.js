'use strict';

// Speedscope is the de-facto interactive flamegraph viewer
// (https://www.speedscope.app). We emit the "evented" profile format, which is
// the most forgiving for sequential/overlapping spans like ours.
//
// Each step becomes an OpenFrame (O) / CloseFrame (C) event pair on a single
// timeline ordered by start time. Drop the JSON at speedscope.app to explore.
function toSpeedscope(trace) {
  const steps = Array.isArray(trace.steps) ? trace.steps : [];
  const requestStart = Number(trace.startTime) || firstStart(steps);

  const frames = [];
  const frameIndex = new Map();
  const getFrame = (name) => {
    if (frameIndex.has(name)) return frameIndex.get(name);
    const idx = frames.length;
    frames.push({ name });
    frameIndex.set(name, idx);
    return idx;
  };

  // Build (start, end, frame) tuples relative to request start, in ms.
  const spans = steps.map((step) => {
    const at = (Number(step.start) || requestStart) - requestStart;
    const dur = Math.max(Number(step.duration) || 0, 0);
    return {
      frame: getFrame(step.error ? `${step.name} (error)` : step.name),
      at: Math.max(at, 0),
      end: Math.max(at, 0) + dur,
    };
  });

  // Speedscope evented format requires events in non-decreasing time order,
  // with closes before opens at the same timestamp handled via a stack-safe
  // ordering. We use a simple sweep producing O then C per span — correct for
  // a single-thread sequential view.
  const events = [];
  for (const span of spans.sort((a, b) => a.at - b.at)) {
    events.push({ type: 'O', frame: span.frame, at: span.at });
    events.push({ type: 'C', frame: span.frame, at: span.end });
  }
  // Re-sort so all events are time-ordered; on ties, closes precede opens.
  events.sort((a, b) => {
    if (a.at !== b.at) return a.at - b.at;
    if (a.type === b.type) return 0;
    return a.type === 'C' ? -1 : 1;
  });

  const totalDuration = Math.max(
    Number(trace.duration) || 0,
    events.length ? events[events.length - 1].at : 0
  );

  return {
    $schema: 'https://www.speedscope.app/file-format-schema.json',
    name: `${trace.method || 'REQ'} ${trace.path || '/'} (${trace.requestId || 'trace'})`,
    activeProfileIndex: 0,
    exporter: 'node-request-trace',
    shared: { frames },
    profiles: [
      {
        type: 'evented',
        name: `${trace.method || 'REQ'} ${trace.path || '/'}`,
        unit: 'milliseconds',
        startValue: 0,
        endValue: totalDuration,
        events,
      },
    ],
  };
}

function toSpeedscopeJson(trace) {
  return JSON.stringify(toSpeedscope(trace));
}

function firstStart(steps) {
  if (!steps.length) return Date.now();
  const starts = steps.map(s => Number(s.start)).filter(Number.isFinite);
  return starts.length ? Math.min(...starts) : Date.now();
}

module.exports = { toSpeedscope, toSpeedscopeJson };
