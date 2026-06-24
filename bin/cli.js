#!/usr/bin/env node
'use strict';

const http = require('node:http');
const https = require('node:https');

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';
const GRAY = '\x1b[90m';

const BAR_COLORS = [MAGENTA, CYAN, RED, YELLOW, BLUE, GREEN];

const USAGE = `
${BOLD}node-request-trace CLI${RESET}

${BOLD}Usage:${RESET}
  npx node-request-trace <command> <server-url> [options]

${BOLD}Commands:${RESET}
  ${GREEN}stats${RESET}    <url>          Show trace statistics
  ${GREEN}recent${RESET}   <url>          Show recent traces
  ${GREEN}slow${RESET}     <url>          Show slow traces
  ${GREEN}inspect${RESET}  <url> <id>     Show single trace detail
  ${GREEN}timeline${RESET} <url> <id>     Show request timeline report
  ${GREEN}tail${RESET}     <url>          Live tail of incoming traces
  ${GREEN}diff${RESET}     <url> <a> <b>  Compare two traces (regression diff)
  ${GREEN}markdown${RESET} <url> <id>     Print GitHub-flavored markdown (alias: md)
  ${GREEN}snapshot${RESET} <url> <id>     Save a self-contained shareable .html file
  ${GREEN}explain${RESET}  <url> <id>     AI explanation of why a request was slow
  ${GREEN}export${RESET}   <url> <id>     Export trace as Chrome Trace JSON
  ${GREEN}speedscope${RESET} <url> <id>   Export trace as Speedscope JSON

${BOLD}Examples:${RESET}
  npx node-request-trace stats http://localhost:3000
  npx node-request-trace recent http://localhost:3000
  npx node-request-trace inspect http://localhost:3000 req_abc123
  npx node-request-trace timeline http://localhost:3000 req_abc123
  npx node-request-trace tail http://localhost:3000
  npx node-request-trace diff http://localhost:3000 req_aaa req_bbb
  npx node-request-trace markdown http://localhost:3000 req_abc123
  npx node-request-trace snapshot http://localhost:3000 req_abc123 > trace.html
  npx node-request-trace explain http://localhost:3000 req_abc123
  npx node-request-trace export http://localhost:3000 req_abc123 > trace.json
  npx node-request-trace speedscope http://localhost:3000 req_abc > scope.json
`;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON response')); }
      });
    }).on('error', reject);
  });
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
        resolve(data);
      });
    }).on('error', reject);
  });
}

function methodColor(m) {
  switch (m) {
    case 'GET': return GREEN;
    case 'POST': return MAGENTA;
    case 'PUT': return YELLOW;
    case 'DELETE': return RED;
    default: return WHITE;
  }
}

function statusColor(s) {
  if (s < 300) return GREEN;
  if (s < 400) return BLUE;
  if (s < 500) return YELLOW;
  return RED;
}

function fmtDuration(ms) {
  if (ms >= 1000) return (ms / 1000).toFixed(1) + 's';
  return ms + 'ms';
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString();
}

function padRight(str, len) {
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}

function padLeft(str, len) {
  return str.length >= len ? str : ' '.repeat(len - str.length) + str;
}

function renderBar(ratio, width) {
  const filled = Math.max(Math.round(ratio * width), 1);
  return '█'.repeat(filled) + '░'.repeat(Math.max(width - filled, 0));
}

function printStats(stats) {
  console.log(`\n${BOLD}  Trace Statistics${RESET}\n`);
  console.log(`  ${CYAN}Total Requests${RESET}  ${BOLD}${stats.totalRequests}${RESET}`);
  console.log(`  ${GREEN}Avg Latency${RESET}     ${BOLD}${fmtDuration(stats.avgLatency)}${RESET}`);
  console.log(`  ${YELLOW}Slow Requests${RESET}   ${BOLD}${stats.slowRequests}${RESET}`);
  console.log(`  ${RED}Error Rate${RESET}      ${BOLD}${stats.errorRate}%${RESET}`);
  console.log(`  ${BLUE}Requests/sec${RESET}    ${BOLD}${stats.requestsPerSec}${RESET}`);
  console.log();
}

function printTraceTable(traces, label) {
  if (!traces.length) {
    console.log(`\n  ${DIM}No ${label} traces found${RESET}\n`);
    return;
  }

  console.log(`\n${BOLD}  ${label} (${traces.length})${RESET}\n`);
  console.log(`  ${DIM}${padRight('ID', 14)} ${padRight('METHOD', 8)} ${padRight('PATH', 30)} ${padLeft('DURATION', 10)} ${padLeft('STATUS', 8)} TIME${RESET}`);
  console.log(`  ${DIM}${'─'.repeat(90)}${RESET}`);

  for (const t of traces) {
    const mc = methodColor(t.method);
    const sc = statusColor(t.status);
    const dur = fmtDuration(t.duration);
    const isSlow = t._slow ? ` ${RED}●${RESET}` : '';
    console.log(
      `  ${GRAY}${padRight(t.requestId.slice(0, 12), 14)}${RESET}` +
      ` ${mc}${padRight(t.method, 8)}${RESET}` +
      ` ${padRight(t.path, 30)}` +
      ` ${padLeft(dur, 10)}${isSlow}` +
      ` ${sc}${padLeft(String(t.status), 8)}${RESET}` +
      ` ${DIM}${fmtTime(t.startTime)}${RESET}`
    );
  }
  console.log();
}

function printTraceDetail(t) {
  console.log(`\n${BOLD}  ${t.method} ${t.path}${RESET}\n`);
  console.log(`  ${DIM}Request ID${RESET}   ${t.requestId}`);
  console.log(`  ${DIM}Status${RESET}       ${statusColor(t.status)}${t.status}${RESET}`);
  console.log(`  ${DIM}Duration${RESET}     ${BOLD}${fmtDuration(t.duration)}${RESET}`);
  console.log(`  ${DIM}Time${RESET}         ${fmtTime(t.startTime)}`);

  if (!t.steps || !t.steps.length) {
    console.log(`\n  ${DIM}No steps recorded${RESET}\n`);
    return;
  }

  const maxDur = Math.max(...t.steps.map(s => s.duration), 1);
  const barWidth = 30;

  console.log(`\n${BOLD}  Timeline (${t.steps.length} steps)${RESET}\n`);

  t.steps.forEach((s, i) => {
    const ratio = s.duration / maxDur;
    const color = BAR_COLORS[i % BAR_COLORS.length];
    const bar = renderBar(ratio, barWidth);
    const errTag = s.error ? ` ${RED}✗ ${s.error}${RESET}` : '';
    const typeTag = s.type ? ` ${DIM}[${s.type}]${RESET}` : '';

    console.log(
      `  ${padRight(s.name, 22)} ${color}${bar}${RESET} ${padLeft(fmtDuration(s.duration), 8)}${typeTag}${errTag}`
    );
  });

  // Flamegraph-style compact view
  console.log(`\n${BOLD}  Flamegraph${RESET}\n`);
  const totalWidth = 60;
  let flame = '  ';
  t.steps.forEach((s, i) => {
    const w = Math.max(Math.round((s.duration / t.duration) * totalWidth), 1);
    const color = BAR_COLORS[i % BAR_COLORS.length];
    const label = s.name.length <= w - 2 ? s.name : s.name.slice(0, Math.max(w - 2, 1));
    flame += `${color}[${padRight(label, w - 1)}]${RESET}`;
  });
  console.log(flame);
  console.log(`  ${DIM}${'─'.repeat(totalWidth + 2)}${RESET}`);
  console.log(`  ${DIM}0ms${' '.repeat(totalWidth - 6)}${fmtDuration(t.duration)}${RESET}`);
  console.log();
}

async function cmdStats(baseUrl) {
  const stats = await fetchJson(`${baseUrl}/trace/stats`);
  printStats(stats);
}

async function cmdRecent(baseUrl) {
  const traces = await fetchJson(`${baseUrl}/trace/recent`);
  printTraceTable(traces, 'Recent Traces');
}

async function cmdSlow(baseUrl) {
  const traces = await fetchJson(`${baseUrl}/trace/slow`);
  printTraceTable(traces, 'Slow Traces');
}

async function cmdInspect(baseUrl, requestId) {
  if (!requestId) {
    console.error(`${RED}Error: request ID required${RESET}`);
    console.error('Usage: npx node-request-trace inspect <url> <request-id>');
    process.exit(1);
  }
  const trace = await fetchJson(`${baseUrl}/trace/${requestId}`);
  printTraceDetail(trace);
}

async function cmdTimeline(baseUrl, requestId) {
  if (!requestId) {
    console.error(`${RED}Error: request ID required${RESET}`);
    console.error('Usage: npx node-request-trace timeline <url> <request-id>');
    process.exit(1);
  }
  const report = await fetchJson(`${baseUrl}/trace/${requestId}/timeline`);
  console.log('\n' + report.text + '\n');
}

async function cmdTail(baseUrl) {
  console.log(`${BOLD}  Tailing traces from ${baseUrl}${RESET}`);
  console.log(`  ${DIM}Press Ctrl+C to stop${RESET}\n`);

  let lastSeenId = null;

  const poll = async () => {
    try {
      const traces = await fetchJson(`${baseUrl}/trace/recent`);
      if (traces.length && traces[0].requestId !== lastSeenId) {
        const newTraces = [];
        for (const t of traces) {
          if (t.requestId === lastSeenId) break;
          newTraces.push(t);
        }
        for (const t of newTraces.reverse()) {
          const mc = methodColor(t.method);
          const sc = statusColor(t.status);
          const dur = fmtDuration(t.duration);
          const slow = t._slow ? ` ${RED}●${RESET}` : '';
          console.log(
            `  ${DIM}${fmtTime(t.startTime)}${RESET}` +
            ` ${mc}${t.method}${RESET}` +
            ` ${t.path}` +
            ` ${BOLD}${dur}${RESET}${slow}` +
            ` ${sc}${t.status}${RESET}` +
            ` ${GRAY}${t.requestId.slice(0, 12)}${RESET}`
          );
        }
        lastSeenId = traces[0].requestId;
      }
    } catch (_) { /* silent */ }
  };

  await poll();
  const interval = setInterval(poll, 2000);
  process.on('SIGINT', () => {
    clearInterval(interval);
    console.log(`\n  ${DIM}Stopped.${RESET}\n`);
    process.exit(0);
  });
}

async function cmdExport(baseUrl, requestId) {
  if (!requestId) {
    console.error(`${RED}Error: request ID required${RESET}`);
    console.error('Usage: npx node-request-trace export <url> <request-id>');
    process.exit(1);
  }
  const chromeTrace = await fetchJson(`${baseUrl}/trace/${requestId}/chrome`);
  console.log(JSON.stringify(chromeTrace, null, 2));
}

async function cmdSpeedscope(baseUrl, requestId) {
  if (!requestId) {
    console.error(`${RED}Error: request ID required${RESET}`);
    console.error('Usage: npx node-request-trace speedscope <url> <request-id>');
    process.exit(1);
  }
  const profile = await fetchJson(`${baseUrl}/trace/${requestId}/speedscope`);
  console.log(JSON.stringify(profile, null, 2));
}

async function cmdMarkdown(baseUrl, requestId) {
  if (!requestId) {
    console.error(`${RED}Error: request ID required${RESET}`);
    console.error('Usage: npx node-request-trace markdown <url> <request-id>');
    process.exit(1);
  }
  const md = await fetchText(`${baseUrl}/trace/${requestId}/markdown`);
  console.log(md);
}

async function cmdSnapshot(baseUrl, requestId) {
  if (!requestId) {
    console.error(`${RED}Error: request ID required${RESET}`);
    console.error('Usage: npx node-request-trace snapshot <url> <request-id> > trace.html');
    process.exit(1);
  }
  const html = await fetchText(`${baseUrl}/trace/${requestId}/snapshot`);
  // If stdout is a TTY, write a file; otherwise stream for redirection.
  if (process.stdout.isTTY) {
    const fs = require('node:fs');
    const file = `${requestId}.html`;
    fs.writeFileSync(file, html);
    console.log(`\n  ${GREEN}Saved${RESET} ${file} ${DIM}(open in a browser, or share the file)${RESET}\n`);
  } else {
    process.stdout.write(html);
  }
}

async function cmdDiff(baseUrl, idA, idB) {
  if (!idA || !idB) {
    console.error(`${RED}Error: two request IDs required${RESET}`);
    console.error('Usage: npx node-request-trace diff <url> <id-a> <id-b>');
    process.exit(1);
  }
  const diff = await fetchJson(`${baseUrl}/trace/diff/${idA}/${idB}`);
  printDiff(diff);
}

async function cmdExplain(baseUrl, requestId) {
  if (!requestId) {
    console.error(`${RED}Error: request ID required${RESET}`);
    console.error('Usage: npx node-request-trace explain <url> <request-id>');
    process.exit(1);
  }
  const { buildExplainPrompt, explainTrace } = require('../lib/explain');
  const trace = await fetchJson(`${baseUrl}/trace/${requestId}`);

  if (!process.env.OPENAI_API_KEY && !process.env.LLM_API_KEY) {
    const { system, user } = buildExplainPrompt(trace);
    console.log(`\n${YELLOW}No API key set (OPENAI_API_KEY / LLM_API_KEY).${RESET}`);
    console.log(`${DIM}Copy the prompt below into your LLM of choice:${RESET}\n`);
    console.log(`${DIM}--- system ---${RESET}\n${system}\n`);
    console.log(`${DIM}--- user ---${RESET}\n${user}\n`);
    return;
  }

  console.log(`\n${DIM}  Asking the model...${RESET}\n`);
  const answer = await explainTrace(trace);
  console.log(answer + '\n');
}

function printDiff(diff) {
  const arrow = diff.totalDeltaMs > 0 ? `${RED}🔺${RESET}` : diff.totalDeltaMs < 0 ? `${GREEN}🔻${RESET}` : '➖';
  console.log(`\n${BOLD}  Trace diff: ${diff.b.method} ${diff.b.path}${RESET}\n`);
  const pct = diff.totalDeltaPercent === null ? 'n/a' : `${diff.totalDeltaPercent}%`;
  const sign = diff.totalDeltaMs > 0 ? '+' : '';
  console.log(
    `  ${arrow} Total: ${diff.a.totalDuration}ms → ${diff.b.totalDuration}ms ` +
    `(${sign}${diff.totalDeltaMs}ms, ${pct})` +
    (diff.regressed ? ` ${RED}⚠ regression${RESET}` : '')
  );
  console.log();
  for (const s of diff.steps) {
    if (s.status === 'unchanged') continue;
    let label;
    if (s.status === 'added') label = `${BLUE}added${RESET}`;
    else if (s.status === 'removed') label = `${GRAY}removed${RESET}`;
    else if (s.status === 'slower') label = `${RED}slower${RESET}`;
    else label = `${GREEN}faster${RESET}`;
    const sgn = s.deltaMs > 0 ? '+' : '';
    console.log(
      `  ${padRight(s.name, 28)} ${padLeft(s.durationA + 'ms', 8)} → ` +
      `${padLeft(s.durationB + 'ms', 8)}  ${padLeft(sgn + s.deltaMs + 'ms', 9)}  ${label}`
    );
  }
  console.log();
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const baseUrl = args[1];

  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    return;
  }

  if (!baseUrl) {
    console.error(`${RED}Error: server URL required${RESET}`);
    console.log(USAGE);
    process.exit(1);
  }

  const cleanUrl = baseUrl.replace(/\/$/, '');

  try {
    switch (command) {
      case 'stats':   return await cmdStats(cleanUrl);
      case 'recent':  return await cmdRecent(cleanUrl);
      case 'slow':    return await cmdSlow(cleanUrl);
      case 'inspect': return await cmdInspect(cleanUrl, args[2]);
      case 'timeline': return await cmdTimeline(cleanUrl, args[2]);
      case 'tail':    return await cmdTail(cleanUrl);
      case 'diff':    return await cmdDiff(cleanUrl, args[2], args[3]);
      case 'markdown':
      case 'md':      return await cmdMarkdown(cleanUrl, args[2]);
      case 'snapshot': return await cmdSnapshot(cleanUrl, args[2]);
      case 'explain': return await cmdExplain(cleanUrl, args[2]);
      case 'export':  return await cmdExport(cleanUrl, args[2]);
      case 'speedscope': return await cmdSpeedscope(cleanUrl, args[2]);
      default:
        console.error(`${RED}Unknown command: ${command}${RESET}`);
        console.log(USAGE);
        process.exit(1);
    }
  } catch (err) {
    console.error(`${RED}Error: ${err.message}${RESET}`);
    process.exit(1);
  }
}

main();

module.exports = {
  fetchJson,
  printStats,
  printTraceTable,
  printTraceDetail,
  padRight,
  padLeft,
  renderBar,
  fmtDuration,
  fmtTime,
  methodColor,
  statusColor,
  main,
  cmdStats,
  cmdRecent,
  cmdSlow,
  cmdInspect,
  cmdTimeline,
  cmdTail,
  cmdExport,
};
