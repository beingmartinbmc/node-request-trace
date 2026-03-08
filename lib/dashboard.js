'use strict';

function getDashboardHtml(config) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Request Trace Dashboard</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0f1117; --surface: #1a1d27; --surface2: #242836;
    --border: #2e3348; --text: #e1e4ed; --text2: #8b8fa7;
    --accent: #6c5ce7; --accent2: #a29bfe; --green: #00cec9;
    --red: #ff7675; --orange: #fdcb6e; --blue: #74b9ff;
  }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
  .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 16px 0; border-bottom: 1px solid var(--border); margin-bottom: 24px; }
  header h1 { font-size: 22px; font-weight: 700; background: linear-gradient(135deg, var(--accent), var(--accent2)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .live-dot { width: 8px; height: 8px; background: var(--green); border-radius: 50%; display: inline-block; margin-right: 6px; animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1}50%{opacity:.4} }
  .live-badge { display:flex; align-items:center; font-size:13px; color:var(--green); }

  /* Stats */
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
  .stat-card .label { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: var(--text2); margin-bottom: 4px; }
  .stat-card .value { font-size: 28px; font-weight: 700; }
  .stat-card .value.green { color: var(--green); }
  .stat-card .value.orange { color: var(--orange); }
  .stat-card .value.red { color: var(--red); }
  .stat-card .value.blue { color: var(--blue); }

  /* Tabs */
  .tabs { display: flex; gap: 4px; margin-bottom: 20px; background: var(--surface); border-radius: 10px; padding: 4px; width: fit-content; }
  .tab { padding: 8px 18px; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 500; color: var(--text2); transition: all .2s; border: none; background: none; }
  .tab.active { background: var(--accent); color: #fff; }
  .tab:hover:not(.active) { color: var(--text); background: var(--surface2); }

  /* Table */
  .panel { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 12px 16px; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--text2); background: var(--surface2); border-bottom: 1px solid var(--border); }
  td { padding: 10px 16px; font-size: 13px; border-bottom: 1px solid var(--border); }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(108,92,231,0.05); }
  .method { font-weight: 600; font-size: 11px; padding: 2px 8px; border-radius: 4px; }
  .method-GET { background: rgba(0,206,201,0.15); color: var(--green); }
  .method-POST { background: rgba(108,92,231,0.15); color: var(--accent2); }
  .method-PUT { background: rgba(253,203,110,0.15); color: var(--orange); }
  .method-DELETE { background: rgba(255,118,117,0.15); color: var(--red); }
  .status { font-weight: 600; }
  .status-2xx { color: var(--green); }
  .status-3xx { color: var(--blue); }
  .status-4xx { color: var(--orange); }
  .status-5xx { color: var(--red); }
  .dur { font-variant-numeric: tabular-nums; }
  .dur.slow { color: var(--red); font-weight: 600; }
  .clickable { cursor: pointer; }

  /* Detail panel */
  .detail-overlay { display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,.6); z-index:100; }
  .detail-overlay.open { display:flex; align-items:center; justify-content:center; }
  .detail-panel { background:var(--surface); border:1px solid var(--border); border-radius:16px; width:90%; max-width:800px; max-height:85vh; overflow-y:auto; padding:28px; }
  .detail-panel h2 { font-size:18px; margin-bottom:16px; }
  .detail-meta { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; margin-bottom:24px; }
  .detail-meta div { font-size:13px; }
  .detail-meta .lbl { color:var(--text2); font-size:11px; text-transform:uppercase; letter-spacing:.5px; }
  .close-btn { float:right; background:none; border:none; color:var(--text2); font-size:20px; cursor:pointer; }
  .close-btn:hover { color:var(--text); }

  /* Timeline */
  .timeline { margin-top: 12px; }
  .tl-row { display:flex; align-items:center; margin-bottom:6px; font-size:13px; }
  .tl-label { width:160px; flex-shrink:0; text-align:right; padding-right:12px; color:var(--text2); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .tl-bar-wrap { flex:1; height:22px; background:var(--surface2); border-radius:4px; position:relative; overflow:hidden; }
  .tl-bar { height:100%; border-radius:4px; display:flex; align-items:center; padding-left:6px; font-size:11px; font-weight:600; color:#fff; min-width:24px; }
  .tl-bar.positioned { position:absolute; top:0; }
  .tl-dur { margin-left:8px; color:var(--text2); font-size:12px; width:60px; flex-shrink:0; }
  .color-0 { background: linear-gradient(90deg, #6c5ce7, #a29bfe); }
  .color-1 { background: linear-gradient(90deg, #00cec9, #81ecec); }
  .color-2 { background: linear-gradient(90deg, #fd79a8, #e84393); }
  .color-3 { background: linear-gradient(90deg, #fdcb6e, #f39c12); }
  .color-4 { background: linear-gradient(90deg, #74b9ff, #0984e3); }
  .color-5 { background: linear-gradient(90deg, #55efc4, #00b894); }

  /* Flamegraph */
  .flamegraph { margin-top:12px; }
  .flame-row { display:flex; height:28px; margin-bottom:2px; border-radius:4px; overflow:hidden; }
  .flame-block { display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:600; color:#fff; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; padding:0 4px; border-right:1px solid var(--bg); cursor:default; }
  .flame-block:hover { filter:brightness(1.2); }
  .flame-axis { display:flex; justify-content:space-between; font-size:11px; color:var(--text2); margin-top:4px; }

  /* View tabs in detail */
  .view-tabs { display:flex; gap:4px; margin:12px 0; background:var(--surface2); border-radius:8px; padding:3px; width:fit-content; }
  .view-tab { padding:5px 14px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:500; color:var(--text2); border:none; background:none; }
  .view-tab.active { background:var(--accent); color:#fff; }
  .view-tab:hover:not(.active) { color:var(--text); }

  /* Chrome export button */
  .export-btn { display:inline-flex; align-items:center; gap:4px; padding:6px 14px; background:var(--surface2); border:1px solid var(--border); border-radius:6px; color:var(--text2); font-size:12px; cursor:pointer; margin-left:8px; }
  .export-btn:hover { color:var(--text); border-color:var(--accent); }

  .empty { text-align:center; padding:40px; color:var(--text2); }
  .section-title { font-size:14px; font-weight:600; margin-bottom:12px; }
  #content-slow, #content-live { display:none; }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>⚡ Request Trace</h1>
    <div class="live-badge"><span class="live-dot"></span> Live</div>
  </header>

  <div class="stats" id="stats">
    <div class="stat-card"><div class="label">Requests / sec</div><div class="value blue" id="s-rps">-</div></div>
    <div class="stat-card"><div class="label">Avg Latency</div><div class="value green" id="s-lat">-</div></div>
    <div class="stat-card"><div class="label">Slow Requests</div><div class="value orange" id="s-slow">-</div></div>
    <div class="stat-card"><div class="label">Error Rate</div><div class="value red" id="s-err">-</div></div>
  </div>

  <div class="tabs">
    <button class="tab active" data-tab="recent">Recent</button>
    <button class="tab" data-tab="slow">Slow</button>
    <button class="tab" data-tab="live">Live Feed</button>
  </div>

  <div id="content-recent" class="panel">
    <table><thead><tr><th>ID</th><th>Method</th><th>Path</th><th>Duration</th><th>Status</th><th>Time</th></tr></thead><tbody id="t-recent"></tbody></table>
  </div>
  <div id="content-slow" class="panel">
    <table><thead><tr><th>ID</th><th>Method</th><th>Path</th><th>Duration</th><th>Status</th><th>Time</th></tr></thead><tbody id="t-slow"></tbody></table>
  </div>
  <div id="content-live" class="panel">
    <table><thead><tr><th>ID</th><th>Method</th><th>Path</th><th>Duration</th><th>Status</th><th>Time</th></tr></thead><tbody id="t-live"></tbody></table>
  </div>
</div>

<div class="detail-overlay" id="detail-overlay">
  <div class="detail-panel" id="detail-panel"></div>
</div>

<script>
const SLOW = ${config.slowThreshold || 200};
let lastSeenId = null;

document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  t.classList.add('active');
  ['recent','slow','live'].forEach(k => {
    document.getElementById('content-' + k).style.display = (k === t.dataset.tab) ? '' : 'none';
  });
}));

document.getElementById('detail-overlay').addEventListener('click', e => {
  if (e.target.id === 'detail-overlay' || e.target.classList.contains('close-btn'))
    e.currentTarget.classList.remove('open');
});

function methodBadge(m) { return '<span class="method method-' + m + '">' + m + '</span>'; }
function statusClass(s) { if(s<300)return 'status-2xx'; if(s<400)return 'status-3xx'; if(s<500)return 'status-4xx'; return 'status-5xx'; }
function durClass(d) { return d >= SLOW ? 'dur slow' : 'dur'; }
function fmtTime(ts) { return new Date(ts).toLocaleTimeString(); }

function renderRow(t) {
  return '<tr class="clickable" onclick="showDetail(\\'' + t.requestId + '\\')">'
    + '<td style="font-family:monospace;font-size:12px">' + t.requestId.slice(0,12) + '</td>'
    + '<td>' + methodBadge(t.method) + '</td>'
    + '<td>' + t.path + '</td>'
    + '<td class="' + durClass(t.duration) + '">' + t.duration + 'ms</td>'
    + '<td class="status ' + statusClass(t.status) + '">' + t.status + '</td>'
    + '<td style="color:var(--text2);font-size:12px">' + fmtTime(t.startTime) + '</td></tr>';
}

function renderWaterfall(steps) {
  if (!steps || !steps.length) return '<div class="empty">No steps recorded</div>';
  const maxDur = Math.max(...steps.map(s => s.duration), 1);
  return steps.map((s, i) => {
    const pct = Math.max((s.duration / maxDur) * 100, 3);
    const errTag = s.error ? ' <span style="color:var(--red)">\\u2717 ' + s.error + '</span>' : '';
    const typeTag = s.type ? ' <span style="color:var(--text2);font-size:10px">[' + s.type + ']</span>' : '';
    return '<div class="tl-row"><div class="tl-label">' + s.name + typeTag + '</div>'
      + '<div class="tl-bar-wrap"><div class="tl-bar color-' + (i % 6) + '" style="width:' + pct + '%"></div></div>'
      + '<div class="tl-dur">' + s.duration + 'ms' + errTag + '</div></div>';
  }).join('');
}

function renderTimeline(steps, requestStart, totalDur) {
  if (!steps || !steps.length) return '<div class="empty">No steps recorded</div>';
  const dur = Math.max(totalDur, 1);
  let html = '';
  html += steps.map((s, i) => {
    const offsetPct = Math.max(((s.start - requestStart) / dur) * 100, 0);
    const widthPct = Math.max((s.duration / dur) * 100, 2);
    const errTag = s.error ? ' <span style="color:var(--red)">\\u2717</span>' : '';
    return '<div class="tl-row"><div class="tl-label">' + s.name + '</div>'
      + '<div class="tl-bar-wrap"><div class="tl-bar positioned color-' + (i % 6) + '" style="left:' + offsetPct + '%;width:' + widthPct + '%"></div></div>'
      + '<div class="tl-dur">' + s.duration + 'ms' + errTag + '</div></div>';
  }).join('');
  html += '<div style="display:flex;margin-top:4px"><div style="width:160px"></div><div style="flex:1;display:flex;justify-content:space-between;font-size:10px;color:var(--text2)"><span>0ms</span><span>' + totalDur + 'ms</span></div><div style="width:60px"></div></div>';
  return html;
}

function renderFlamegraph(steps, totalDur) {
  if (!steps || !steps.length) return '<div class="empty">No steps recorded</div>';
  const dur = Math.max(totalDur, 1);
  let html = '<div class="flamegraph"><div class="flame-row">';
  steps.forEach((s, i) => {
    const pct = Math.max((s.duration / dur) * 100, 2);
    const label = s.duration > dur * 0.05 ? s.name : '';
    html += '<div class="flame-block color-' + (i % 6) + '" style="width:' + pct + '%" title="' + s.name + ': ' + s.duration + 'ms">' + label + '</div>';
  });
  html += '</div><div class="flame-axis"><span>0ms</span><span>' + totalDur + 'ms</span></div></div>';
  return html;
}

let _currentTrace = null;
let _currentView = 'waterfall';

function switchView(view) {
  _currentView = view;
  document.querySelectorAll('.view-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  const container = document.getElementById('viz-container');
  if (!_currentTrace || !container) return;
  const t = _currentTrace;
  if (view === 'waterfall') container.innerHTML = renderWaterfall(t.steps);
  else if (view === 'timeline') container.innerHTML = renderTimeline(t.steps, t.startTime, t.duration);
  else if (view === 'flamegraph') container.innerHTML = renderFlamegraph(t.steps, t.duration);
}

async function exportChrome(id) {
  const r = await fetch('/trace/' + id + '/chrome');
  if (!r.ok) return;
  const data = await r.text();
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'trace-' + id + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

async function showDetail(id) {
  const r = await fetch('/trace/' + id);
  if (!r.ok) return;
  const t = await r.json();
  _currentTrace = t;
  _currentView = 'waterfall';
  const p = document.getElementById('detail-panel');
  p.innerHTML = '<button class="close-btn" onclick="document.getElementById(\\'detail-overlay\\').classList.remove(\\'open\\')">&times;</button>'
    + '<h2>' + t.method + ' ' + t.path
    + '<button class="export-btn" onclick="exportChrome(\\'' + t.requestId + '\\')">\\u2B07 Chrome Trace</button>'
    + '</h2>'
    + '<div class="detail-meta">'
    + '<div><div class="lbl">Request ID</div>' + t.requestId + '</div>'
    + '<div><div class="lbl">Status</div><span class="status ' + statusClass(t.status) + '">' + t.status + '</span></div>'
    + '<div><div class="lbl">Duration</div><span class="' + durClass(t.duration) + '">' + t.duration + 'ms</span></div>'
    + '<div><div class="lbl">Time</div>' + fmtTime(t.startTime) + '</div>'
    + '</div>'
    + '<div class="view-tabs">'
    + '<button class="view-tab active" data-view="waterfall" onclick="switchView(\\'waterfall\\')">Waterfall</button>'
    + '<button class="view-tab" data-view="timeline" onclick="switchView(\\'timeline\\')">Timeline</button>'
    + '<button class="view-tab" data-view="flamegraph" onclick="switchView(\\'flamegraph\\')">Flamegraph</button>'
    + '</div>'
    + '<div class="section-title">Steps (' + (t.steps ? t.steps.length : 0) + ')</div>'
    + '<div id="viz-container" class="timeline">' + renderWaterfall(t.steps) + '</div>';
  document.getElementById('detail-overlay').classList.add('open');
}

async function refresh() {
  try {
    const [statsR, recentR, slowR] = await Promise.all([
      fetch('/trace/stats'), fetch('/trace/recent'), fetch('/trace/slow')
    ]);
    const stats = await statsR.json();
    const recent = await recentR.json();
    const slow = await slowR.json();

    document.getElementById('s-rps').textContent = stats.requestsPerSec;
    document.getElementById('s-lat').textContent = stats.avgLatency + 'ms';
    document.getElementById('s-slow').textContent = stats.slowRequests;
    document.getElementById('s-err').textContent = stats.errorRate + '%';

    document.getElementById('t-recent').innerHTML = recent.length
      ? recent.map(renderRow).join('')
      : '<tr><td colspan="6" class="empty">No traces yet</td></tr>';

    document.getElementById('t-slow').innerHTML = slow.length
      ? slow.map(renderRow).join('')
      : '<tr><td colspan="6" class="empty">No slow requests</td></tr>';

    // Live feed: show only new
    if (recent.length && recent[0].requestId !== lastSeenId) {
      const liveBody = document.getElementById('t-live');
      const newRows = [];
      for (const t of recent) {
        if (t.requestId === lastSeenId) break;
        newRows.push(t);
      }
      if (newRows.length) {
        liveBody.innerHTML = newRows.map(renderRow).join('') + liveBody.innerHTML;
        const maxLive = 100;
        while (liveBody.children.length > maxLive) liveBody.removeChild(liveBody.lastChild);
      }
      lastSeenId = recent[0].requestId;
    }
  } catch(e) { /* silent */ }
}

refresh();
setInterval(refresh, 3000);
</script>
</body>
</html>`;
}

module.exports = { getDashboardHtml };
