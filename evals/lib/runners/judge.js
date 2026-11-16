'use strict';

/**
 * Judge runner: asks a model to score a transcript against a rubric.
 * The judging model must differ from the model under test (resolveJudge refuses otherwise).
 */

const { runProcess } = require('../exec');

/** Compare-form of a model name: `sonnet`, `claude-sonnet-5-5` and `claude-sonnet-4-20250514` all become `sonnet`. */
const norm = (m) => String(m || '').trim().toLowerCase()
  .replace(/\[.*\]$/, '')
  .replace(/^claude-/, '')
  .replace(/^(\d+-)+/, '')
  .replace(/(-\d[\d.]*)+$/, '');

/**
 * Decide whether judged checks may run. `judgeModel` comes from --judge-model, else EVALS_JUDGE_MODEL.
 * Returns { model, refusal }: `refusal` is a message naming the conflict, or null when allowed.
 */
function resolveJudge({ judgeModel, model, env = process.env } = {}) {
  const chosen = judgeModel || env.EVALS_JUDGE_MODEL || null;
  if (!chosen) {
    return { model: null, refusal: 'no judge model configured: set --judge-model or EVALS_JUDGE_MODEL' };
  }
  if (!norm(model)) {
    return { model: chosen, refusal: `judge model "${chosen}" cannot be compared: no model under test was given (pass --model so the judge can be compared)` };
  }
  if (norm(chosen) === norm(model)) {
    return { model: chosen, refusal: `judge model "${chosen}" is the model under test; the judge must be a different model` };
  }
  return { model: chosen, refusal: null };
}

function judgePrompt(rubric, transcript) {
  return [
    'You are grading the output of an AI agent against a rubric.',
    'Reply with only a JSON object: {"score": <number from 0 to 1>, "reason": "<one sentence>"}.',
    '',
    '## Rubric',
    rubric,
    '',
    '## Agent transcript (tail)',
    String(transcript || '').slice(-8000),
  ].join('\n');
}

/** First JSON object in `text` that carries a numeric score, or null. */
function parseScore(text) {
  for (const candidate of jsonObjects(String(text || ''))) {
    try {
      const o = JSON.parse(candidate);
      if (o && typeof o.score === 'number' && o.score >= 0 && o.score <= 1) return { score: o.score, reason: String(o.reason || '') };
    } catch { /* next */ }
  }
  return null;
}

/** Balanced `{...}` substrings, in order; braces inside JSON strings do not count. */
function jsonObjects(text) {
  const out = [];
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    let depth = 0; let inStr = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (c === '\\') i++;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { out.push(text.slice(start, i + 1)); break; }
    }
  }
  return out;
}

/** Run the judge model via the claude CLI. Returns { score, reason, costUsd } or { error, costUsd }. */
async function runJudge(bin, { model, rubric, transcript, cwd, env, timeoutMs = 120000 }) {
  const args = ['-p', judgePrompt(rubric, transcript), '--output-format', 'json', '--no-session-persistence',
    '--max-turns', '1', '--permission-mode', 'plan', '--model', model];
  const r = await runProcess(bin, args, { cwd, env, timeoutMs });
  if (r.timedOut || r.exitCode !== 0) return { error: `judge call failed: ${r.timedOut ? 'timed out' : `exit ${r.exitCode}${r.stderr ? `: ${r.stderr.slice(-200)}` : ''}`}`, costUsd: null };
  let text = r.transcript || '';
  let costUsd = null;
  try {
    const o = JSON.parse(text);
    if (typeof o.result === 'string') text = o.result;
    costUsd = o.total_cost_usd ?? o.cost_usd ?? null;
  } catch { /* plain text reply */ }
  const parsed = parseScore(text);
  return parsed ? { ...parsed, costUsd } : { error: 'judge reply had no JSON score between 0 and 1', costUsd };
}

module.exports = { resolveJudge, runJudge, parseScore, judgePrompt };
