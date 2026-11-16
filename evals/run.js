#!/usr/bin/env node
'use strict';

/**
 * Headless behavioral eval runner.
 * Usage: node evals/run.js [--scenario <id>] [--skill <name>] [--model <id>] [--judge-model <id>] [--dry-run] [--max-usd N]
 * Targets: skill-keyed evals in evals/skills/<skill>/eval.json, plus legacy single-arm evals/scenarios/*.
 */

const fs = require('fs');
const path = require('path');
const { runGraders } = require('./lib/graders');
const { loadEvalDefs, evalToScenario, EvalDefinitionError } = require('./lib/eval-def');
const { summarizeRun } = require('./lib/results');
const { resolveJudge } = require('./lib/runners/judge');
const sandbox = require('./lib/sandbox');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCENARIOS_DIR = path.join(__dirname, 'scenarios');
const EVAL_SKILLS_DIR = process.env.EVALS_SKILLS_DIR || path.join(__dirname, 'skills');
const RESULTS_DIR = process.env.EVALS_RESULTS_DIR || path.join(__dirname, 'results');

function parseArgs(argv) {
  const o = { scenario: null, skill: null, model: null, judgeModel: null, dryRun: false, maxUsd: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') o.dryRun = true;
    else if (a === '--scenario') o.scenario = argv[++i];
    else if (a === '--skill') o.skill = argv[++i];
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--judge-model') o.judgeModel = argv[++i];
    else if (a === '--max-usd') o.maxUsd = Number(argv[++i]);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (o.maxUsd !== null && !(o.maxUsd > 0)) throw new Error('--max-usd must be a positive number');
  return o;
}

function loadScenarios(dir = SCENARIOS_DIR) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'scenario.json')))
    .map((e) => {
      const scenarioDir = path.join(dir, e.name);
      const s = JSON.parse(fs.readFileSync(path.join(scenarioDir, 'scenario.json'), 'utf8'));
      return { ...s, id: s.id || e.name, type: s.type || 'agent', scenarioDir };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function runScenario(scenario, { bin, model, remainingUsd, repoRoot, judge }) {
  const sb = sandbox.createSandbox(scenario.scenarioDir, scenario);
  const started = Date.now();
  try {
    let transcript = '';
    let run = { exitCode: 0, stderr: '', timedOut: false };
    if (scenario.type === 'agent') {
      const args = sandbox.buildClaudeArgs(scenario, { repoRoot, model, maxUsd: remainingUsd });
      run = sandbox.runClaude(bin, args, sb.dir, (scenario.timeoutSec || 600) * 1000);
      transcript = run.transcript;
    }
    const ctx = { dir: sb.dir, repoRoot, baseline: sb.baseline, transcript, judge: judge ? { ...judge, bin } : undefined };
    const graders = runGraders(scenario.graders || [], ctx);
    const summary = sandbox.summarizeTranscript(transcript);
    const outcome = summarizeRun(graders);
    const judgeCost = graders.reduce((sum, g) => sum + (g.costUsd || 0), 0);
    return {
      id: scenario.id,
      type: scenario.type,
      skill: scenario.skill,
      pass: outcome.pass,
      verdict: outcome.verdict,
      judgedScore: outcome.judgedScore,
      judgeModel: outcome.judgeModel,
      graders,
      turns: summary.turns,
      costUsd: summary.costUsd === null && !judgeCost ? null : (summary.costUsd || 0) + judgeCost,
      claudeExitCode: run.exitCode,
      claudeResult: summary.resultText || (run.exitCode ? transcript.slice(-500) : undefined),
      timedOut: run.timedOut,
      stderr: run.stderr || undefined,
      durationMs: Date.now() - started,
    };
  } finally {
    sb.cleanup();
  }
}

function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const defs = loadEvalDefs({ skillsDir: EVAL_SKILLS_DIR, repoRoot: REPO_ROOT });
  const legacy = loadScenarios();
  const legacyIds = new Set(legacy.map((s) => s.id));
  let rejected = [...defs.rejected];
  const skillEvals = defs.evals.filter((ev) => {
    if (!legacyIds.has(ev.id)) return true;
    rejected.push({ id: ev.id, dir: ev.dir, error: new EvalDefinitionError(ev.id, 'id', `id collides with a legacy scenario id "${ev.id}"`) });
    return false;
  });
  let scenarios = [...legacy, ...skillEvals.map(evalToScenario)];
  if (opts.scenario) {
    scenarios = scenarios.filter((s) => s.id === opts.scenario);
    rejected = rejected.filter((r) => r.id === opts.scenario);
    if (scenarios.length === 0 && rejected.length === 0) {
      console.error(`unknown scenario: ${opts.scenario}`);
      return 2;
    }
  }
  if (opts.skill) {
    scenarios = scenarios.filter((s) => s.skill === opts.skill);
    rejected = rejected.filter((r) => path.basename(r.dir) === opts.skill || r.id === opts.skill);
    if (scenarios.length === 0 && rejected.length === 0) {
      console.error(`no eval for skill: ${opts.skill}`);
      return 2;
    }
  }
  for (const r of rejected) console.error(`REJECTED ${r.error.message}`);
  for (const ev of skillEvals) {
    if (!scenarios.some((s) => s.id === ev.id && s.skill === ev.skill) || !ev.unactedFields.length) continue;
    console.error(`WARNING eval "${ev.id}": ${ev.unactedFields.map((f) => `\`${f}\``).join(', ')} accepted but not yet acted on (lands in a later PR)`);
  }
  const bin = sandbox.findClaude();
  const needsClaude = scenarios.some((s) => s.type === 'agent');

  // Judged checks run only with a judge model that differs from the model under test; otherwise they are refused.
  const judge = resolveJudge({ judgeModel: opts.judgeModel, model: opts.model });
  const judgedIds = scenarios.filter((s) => (s.graders || []).some((g) => g.type === 'judge')).map((s) => s.id);
  if (judgedIds.length && judge.refusal) {
    console.error(`REFUSED judged checks (${judgedIds.join(', ')}): ${judge.refusal}; deterministic checks still run`);
  }

  if (opts.dryRun) {
    console.log(`${scenarios.length} eval(s)${rejected.length ? `, ${rejected.length} rejected` : ''}:`);
    for (const s of scenarios) {
      console.log(`  ${s.id} [${s.skill ? `skill: ${s.skill}` : s.type}] graders: ${(s.graders || []).map((g) => g.type).join(', ')}`);
      console.log(`      ${s.description || ''}`);
    }
    if (needsClaude && !bin) console.log('SKIP: `claude` CLI not found on PATH; agent scenarios would not run.');
    return rejected.length ? 2 : 0;
  }
  if (needsClaude && !bin) {
    console.error('SKIP: `claude` CLI not found on PATH (set EVALS_CLAUDE_BIN to override); cannot run agent scenarios.');
    return 3;
  }

  const results = [];
  let spent = 0;
  for (const s of scenarios) {
    const remainingUsd = opts.maxUsd ? Math.max(opts.maxUsd - spent, 0) : null;
    if (opts.maxUsd && s.type === 'agent' && remainingUsd <= 0) {
      results.push({ id: s.id, type: s.type, pass: false, skipped: 'budget exhausted', graders: [] });
      continue;
    }
    console.log(`running ${s.id} ...`);
    const r = runScenario(s, { bin, model: opts.model, remainingUsd, repoRoot: REPO_ROOT, judge });
    spent += r.costUsd || 0;
    results.push(r);
    const judgedNote = r.judgedScore === null ? '' : ` judged=${r.judgedScore.toFixed(2)} (${r.judgeModel})`;
    console.log(`  ${r.pass ? 'PASS' : 'FAIL'} turns=${r.turns} cost=${r.costUsd}${judgedNote}`);
    for (const g of r.graders) console.log(`    ${g.pass ? 'ok  ' : 'FAIL'} ${g.type}${g.judged ? ' [judged]' : ''}: ${g.detail}`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const modelTag = (opts.model || 'default').replace(/[^A-Za-z0-9._-]/g, '_');
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, `${modelTag}-${stamp}.json`);
  const report = {
    model: opts.model || 'default',
    startedAt: new Date().toISOString(),
    maxUsd: opts.maxUsd,
    totalCostUsd: spent,
    passed: results.filter((r) => r.pass).length,
    total: results.length,
    results,
  };
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`results: ${path.relative(process.cwd(), file)} (${report.passed}/${report.total} passed)`);
  if (rejected.length) return 2;
  return report.passed === report.total ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (e) {
    console.error(e.message);
    process.exitCode = 2;
  }
}

module.exports = { parseArgs, loadScenarios, runScenario, main };
