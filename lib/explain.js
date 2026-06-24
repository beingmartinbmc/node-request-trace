'use strict';

const { buildTimeline } = require('./timeline');

// Builds a compact, structured summary of a trace that's ideal as an LLM
// prompt. Kept separate from any network call so it's testable and usable
// offline (e.g. paste into your own chat).
function buildExplainPrompt(trace) {
  const report = buildTimeline(trace);
  const s = report.summary;

  const facts = [];
  facts.push(`Request: ${report.method} ${report.path} (status ${report.status})`);
  facts.push(`Total duration: ${report.totalDuration}ms across ${report.stepCount} steps.`);
  if (s.bottleneck) {
    facts.push(
      `Bottleneck: "${s.bottleneck.name}" took ${s.bottleneck.duration}ms ` +
      `(${s.bottleneck.percentOfRequest}% of the request).`
    );
  }
  facts.push(
    `Coverage: ${s.coveragePercent}% of the request is explained by recorded steps; ` +
    `${s.uninstrumentedDuration}ms is uninstrumented (untraced time).`
  );
  if (s.errorCount) facts.push(`${s.errorCount} step(s) errored.`);

  if (s.duplicates && s.duplicates.length) {
    for (const d of s.duplicates) {
      facts.push(
        `${d.isNPlusOne ? 'N+1 pattern' : 'Duplicate work'}: "${d.sample}" ran ` +
        `${d.count}× for ${d.totalDuration}ms total.`
      );
    }
  }

  if (s.gaps && s.gaps.length) {
    const biggest = s.gaps.slice().sort((a, b) => b.duration - a.duration)[0];
    facts.push(`Largest untraced gap: ${biggest.duration}ms (${biggest.percentOfRequest}%).`);
  }

  const steps = report.steps
    .map(st => `- ${st.name}: ${st.duration}ms${st.type ? ` [${st.type}]` : ''}${st.error ? ` ERROR: ${st.error}` : ''}`)
    .join('\n');

  const system =
    'You are a senior performance engineer. Given a single web request trace, ' +
    'explain in 3-5 concise bullet points why it was slow and what to optimize ' +
    'first. Be specific and actionable. Prefer indexing, batching (fixing N+1), ' +
    'caching, and parallelization advice when the data supports it.';

  const user =
    `Trace summary:\n${facts.join('\n')}\n\nSteps (in order):\n${steps || '(none)'}`;

  return { system, user, report };
}

// Calls an OpenAI-compatible chat completions endpoint. The caller supplies the
// API key/URL/model so we never bundle a vendor or store secrets. Returns the
// assistant text. Uses global fetch (Node 18+); falls back gracefully.
async function explainTrace(trace, options = {}) {
  const { system, user } = buildExplainPrompt(trace);

  const apiKey = options.apiKey || process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
  if (!apiKey) {
    const err = new Error(
      'No API key provided. Set OPENAI_API_KEY or pass { apiKey }. ' +
      'You can also use buildExplainPrompt(trace) to copy the prompt manually.'
    );
    err.code = 'NO_API_KEY';
    throw err;
  }

  const baseUrl = options.baseUrl || process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
  const model = options.model || process.env.LLM_MODEL || 'gpt-4o-mini';

  if (typeof fetch !== 'function') {
    throw new Error('global fetch is unavailable; Node 18+ is required for explainTrace');
  }

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: options.temperature ?? 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM request failed: HTTP ${res.status} ${text}`);
  }

  const json = await res.json();
  return json.choices?.[0]?.message?.content?.trim() || '';
}

module.exports = { buildExplainPrompt, explainTrace };
