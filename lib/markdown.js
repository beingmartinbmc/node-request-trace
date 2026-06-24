'use strict';

const { buildTimeline, renderTimeline } = require('./timeline');

// GitHub-flavored markdown export for a single trace. Designed to be pasted
// directly into a PR description, issue, or incident note. Uses a collapsible
// <details> block so it stays compact in long threads.
function toMarkdown(trace, options = {}) {
  const report = buildTimeline(trace);
  const s = report.summary;
  const slow = options.slowThreshold && report.totalDuration >= options.slowThreshold;
  const emoji = slow ? '🐢' : '⚡';

  const lines = [];
  const title =
    `${emoji} \`${report.method} ${report.path}\` — **${report.totalDuration}ms** ` +
    `(${report.status})`;
  lines.push(`<details>`);
  lines.push(`<summary>${title}</summary>`);
  lines.push('');

  // Summary bullets.
  if (report.requestId) lines.push(`- **Request:** \`${report.requestId}\``);
  if (s.bottleneck) {
    lines.push(
      `- **Bottleneck:** \`${s.bottleneck.name}\` ${s.bottleneck.duration}ms ` +
      `(${s.bottleneck.percentOfRequest}%)`
    );
  }
  lines.push(
    `- **Coverage:** ${s.coveredDuration}ms traced (${s.coveragePercent}%), ` +
    `${s.uninstrumentedDuration}ms uninstrumented`
  );
  if (s.errorCount) lines.push(`- **Errors:** ${s.errorCount}`);

  // N+1 / duplicate warnings get pulled to the top — that's the shareable bit.
  if (s.duplicates && s.duplicates.length) {
    lines.push('');
    for (const d of s.duplicates) {
      const label = d.isNPlusOne ? '⚠️ **N+1 detected**' : '⚠️ **Duplicate work**';
      lines.push(`- ${label}: \`${d.sample}\` ran **${d.count}×** (${d.totalDuration}ms total)`);
    }
  }

  // Step table.
  lines.push('');
  lines.push('| Step | Start | Duration | % | Type |');
  lines.push('|---|---:|---:|---:|---|');
  if (report.steps.length) {
    for (const step of report.steps) {
      const name = step.error ? `${step.name} ❌` : step.name;
      lines.push(
        `| ${escapeCell(name)} | ${step.offset}ms | ${step.duration}ms | ` +
        `${step.percentOfRequest}% | ${step.type || ''} |`
      );
    }
  } else {
    lines.push('| _no steps recorded_ |  |  |  |  |');
  }

  // ASCII timeline in a code block for the visual hook.
  lines.push('');
  lines.push('```txt');
  lines.push(renderTimeline(trace, { ascii: true }));
  lines.push('```');
  lines.push('');
  lines.push('</details>');

  return lines.join('\n');
}

function escapeCell(value) {
  return String(value).replace(/\|/g, '\\|');
}

module.exports = { toMarkdown };
