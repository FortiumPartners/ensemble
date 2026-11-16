#!/usr/bin/env node
'use strict';

/**
 * Headless behavioral eval runner.
 * Usage: node evals/run.js [--scenario <id>] [--skill <name>] [--model <id>] [--judge-model <id>] [--dry-run]
 *   [--max-usd N] [--timeout SEC] [--concurrency N] [--keep-workspace] [--allow-env NAME]... [--env-allowlist FILE]
 *   [--run-usd N] [--judge-usd N]
 * Exit: 0 all pass, 1 an eval failed or timed out, 2 usage/rejected definition, 3 claude missing, 4 incomplete evals (1 outranks 4).
 * Targets: skill-keyed evals in evals/skills/<skill>/eval.json, plus legacy single-arm evals/scenarios/*.
 */

const fs = require('fs');
const path = require('path');
const { runGraders } = require('./lib/graders');
const { loadEvalDefs, evalToScenario, EvalDefinitionError } = require('./lib/eval-def');
const { summarizeRun } = require('./lib/results');
const { resolveJudge } = require('./lib/runners/judge');
const sandbox = require('./lib/sandbox');
const envlib = require('./lib/env');
const { loadLimits, runProcess, reservationFor, runSuite } = require('./lib/exec');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCENARIOS_DIR = process.env.EVALS_SCENARIOS_DIR || path.join(__dirname, 'scenarios');
const EVAL_SKILLS_DIR = process.env.EVALS_SKILLS_DIR || path.join(__dirname, 'skills');
const RESULTS_DIR = process.env.EVALS_RESULTS_DIR || path.join(__dirname, 'results');

let activeSecrets = []; // credential values in play; the top-level error handler redacts with these

function parseArgs(argv) {
  const o = {
    scenario: null, skill: null, model: null, judgeModel: null, dryRun: false, maxUsd: null,
    timeoutSec: null, concurrency: null, keepWorkspace: false, allowEnv: [], envAllowlist: null, runUsd: null, judgeUsd: null,
  };
  const num = (flag, v, { int = false } = {}) => {
    const n = Number(v);
    if (v === undefined || !(n > 0) || (int && !Number.isInteger(n))) throw new Error(`${flag} must be a positive ${int ? 'integer' : 'number'}`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') o.dryRun = true;
    else if (a === '--keep-workspace') o.keepWorkspace = true;
    else if (a === '--scenario') o.scenario = argv[++i];
    else if (a === '--skill') o.skill = argv[++i];
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--judge-model') o.judgeModel = argv[++i];
    else if (a === '--max-usd') o.maxUsd = num(a, argv[++i]);
    else if (a === '--timeout') o.timeoutSec = num(a, argv[++i]);
    else if (a === '--concurrency') o.concurrency = num(a, argv[++i], { int: true });
    else if (a === '--run-usd') o.runUsd = num(a, argv[++i]);
    else if (a === '--judge-usd') o.judgeUsd = num(a, argv[++i]);
    else if (a === '--allow-env') o.allowEnv.push(argv[++i]);
    else if (a === '--env-allowlist') o.envAllowlist = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
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

/**
 * Run one eval in a fresh workspace under `workdir`.
 * Only the agent and the judge get the allowlisted credentials; checks that execute agent-written code
 * (testsPass, commandOutputMatches, trdParses) get an environment with none. The transcript is redacted before
 * it reaches checks or the judge prompt.
 * run: { bin, model, runUsd, judgeUsd, timeoutMs, repoRoot, judge, workdir, credentials, secrets, parentEnv, keepWorkspace }
 */
async function runScenario(scenario, run) {
  const { bin, model, runUsd, judgeUsd = 0, timeoutMs, repoRoot, judge, workdir, credentials, secrets = [], parentEnv = process.env, keepWorkspace } = run;
  const sb = sandbox.createSandbox(scenario.scenarioDir, scenario, { workdir });
  let ciHome = null;
  let checkHome = null;
  const started = Date.now();
  try {
    if (envlib.isCI(parentEnv)) ciHome = envlib.makeCiHome(workdir);
    const env = envlib.buildEnv({ parent: parentEnv, credentials, home: ciHome || undefined });
    // Checks run agent-written code: always a throwaway empty HOME, never the real one.
    checkHome = ciHome || envlib.makeCiHome(workdir);
    const checkEnv = envlib.buildEnv({ parent: parentEnv, credentials: [], home: checkHome });
    let transcript = '';
    let proc = { exitCode: 0, stderr: '', timedOut: false, transcriptTruncated: false, commands: [], commandsIncomplete: false };
    if (scenario.type === 'agent') {
      const args = sandbox.buildClaudeArgs(scenario, { repoRoot, model, maxUsd: runUsd });
      proc = await runProcess(bin, args, { cwd: sb.dir, env, timeoutMs });
      transcript = envlib.redactText(proc.transcript, secrets);
    }
    const summary = sandbox.summarizeTranscript(transcript);
    // An agent run with no reported cost (timeout, crash) is charged its full per-run budget, flagged costEstimated.
    const agentUnknown = scenario.type === 'agent' && summary.costUsd === null;
    const agentCost = agentUnknown ? runUsd : summary.costUsd;
    const base = {
      id: scenario.id, type: scenario.type, skill: scenario.skill,
      turns: summary.turns, claudeExitCode: proc.exitCode, timedOut: proc.timedOut, stderr: proc.stderr || undefined,
    };
    if (proc.timedOut) {
      return {
        ...base, pass: false, outcome: 'timed_out', verdict: 'fail', judgedScore: null, judgeModel: null, graders: [],
        costUsd: agentCost, ...(agentUnknown && { costEstimated: true }),
        claudeResult: `timed out after ${Math.round(timeoutMs / 1000)}s; run and child processes killed`,
        durationMs: Date.now() - started,
      };
    }
    const commands = proc.commands.map((c) => envlib.redactText(c, secrets));
    const ctx = { dir: sb.dir, repoRoot, baseline: sb.baseline, transcript, transcriptTruncated: proc.transcriptTruncated, commands, commandsIncomplete: proc.commandsIncomplete, env: checkEnv, judgeEnv: env, judge: judge ? { ...judge, bin } : undefined };
    const graders = await runGraders(scenario.graders || [], ctx);
    const outcome = summarizeRun(graders);
    // A judge call that ran but reported no cost (failed or timed out) is charged the judge allowance.
    const judgeUnknown = graders.filter((g) => g.judged && !g.refused && (g.costUsd === null || g.costUsd === undefined)).length;
    const judgeCost = graders.reduce((sum, g) => sum + (g.costUsd || 0), 0) + judgeUnknown * judgeUsd;
    const known = agentCost !== null || judgeCost > 0;
    return {
      ...base,
      pass: outcome.pass,
      outcome: outcome.pass ? 'pass' : 'fail',
      verdict: outcome.verdict,
      judgedScore: outcome.judgedScore,
      judgeModel: outcome.judgeModel,
      graders,
      costUsd: known ? (agentCost || 0) + judgeCost : null,
      ...((agentUnknown || (judgeUnknown && judgeUsd > 0)) && { costEstimated: true }),
      claudeResult: summary.resultText || (proc.exitCode ? transcript.slice(-500) : undefined),
      durationMs: Date.now() - started,
    };
  } finally {
    if (keepWorkspace) console.log(envlib.redactText(`workspace kept: ${sb.dir}`, secrets));
    else sb.cleanup();
    if (ciHome) fs.rmSync(ciHome, { recursive: true, force: true });
    if (checkHome && checkHome !== ciHome) fs.rmSync(checkHome, { recursive: true, force: true });
  }
}

async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const credentials = envlib.loadCredentialNames({ file: opts.envAllowlist || undefined, extra: opts.allowEnv });
  const secrets = envlib.secretValues(process.env, credentials);
  activeSecrets = secrets;
  const out = (text) => console.log(envlib.redactText(text, secrets));
  const err = (text) => console.error(envlib.redactText(text, secrets));
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
      err(`unknown scenario: ${opts.scenario}`);
      return 2;
    }
  }
  if (opts.skill) {
    scenarios = scenarios.filter((s) => s.skill === opts.skill);
    rejected = rejected.filter((r) => path.basename(r.dir) === opts.skill || r.id === opts.skill);
    if (scenarios.length === 0 && rejected.length === 0) {
      err(`no eval for skill: ${opts.skill}`);
      return 2;
    }
  }
  for (const r of rejected) err(`REJECTED ${r.error.message}`);
  for (const ev of skillEvals) {
    if (!scenarios.some((s) => s.id === ev.id && s.skill === ev.skill) || !ev.unactedFields.length) continue;
    err(`WARNING eval "${ev.id}": ${ev.unactedFields.map((f) => `\`${f}\``).join(', ')} accepted but not yet acted on (lands in a later PR)`);
  }
  const bin = sandbox.findClaude();
  const needsClaude = scenarios.some((s) => s.type === 'agent');

  // Judged checks run only with a judge model that differs from the model under test; otherwise they are refused.
  const judge = resolveJudge({ judgeModel: opts.judgeModel, model: opts.model });
  const judgedIds = scenarios.filter((s) => (s.graders || []).some((g) => g.type === 'judge')).map((s) => s.id);
  if (judgedIds.length && judge.refusal) {
    err(`REFUSED judged checks (${judgedIds.join(', ')}): ${judge.refusal}; deterministic checks still run`);
  }

  if (opts.dryRun) {
    out(`${scenarios.length} eval(s)${rejected.length ? `, ${rejected.length} rejected` : ''}:`);
    for (const s of scenarios) {
      out(`  ${s.id} [${s.skill ? `skill: ${s.skill}` : s.type}] graders: ${(s.graders || []).map((g) => g.type).join(', ')}`);
      out(`      ${s.description || ''}`);
    }
    if (needsClaude && !bin) out('SKIP: `claude` CLI not found on PATH; agent scenarios would not run.');
    return rejected.length ? 2 : 0;
  }
  if (needsClaude && !bin) {
    err('SKIP: `claude` CLI not found on PATH (set EVALS_CLAUDE_BIN to override); cannot run agent scenarios.');
    return 3;
  }

  const limits = loadLimits();
  if (opts.timeoutSec && opts.timeoutSec > limits.timeoutSec) {
    err(`--timeout ${opts.timeoutSec} exceeds the limit of ${limits.timeoutSec}s in evals/limits.json`);
    return 2;
  }
  const capUsd = opts.maxUsd || limits.maxUsdPerSuite;
  const concurrency = opts.concurrency || limits.concurrency;
  const workdir = sandbox.resolveWorkdir();
  const judgeActive = Boolean(judge && !judge.refusal);
  const reservationOf = (s) => reservationFor(
    { model: s.type === 'agent', judged: judgeActive && (s.graders || []).some((g) => g.type === 'judge') },
    { runReserveUsd: opts.runUsd || limits.runReserveUsd, judgeReserveUsd: opts.judgeUsd || limits.judgeReserveUsd, capUsd },
  );
  const runUsdFor = () => Math.min(opts.runUsd || limits.runReserveUsd, capUsd);
  const timeoutMsFor = (s) => 1000 * (opts.timeoutSec || Math.min(s.timeoutSec || limits.timeoutSec, limits.timeoutSec));

  const show = (r) => {
    const judgedNote = r.judgedScore === null || r.judgedScore === undefined ? '' : ` judged=${r.judgedScore.toFixed(2)} (${r.judgeModel})`;
    out(`  ${r.outcome.toUpperCase()} turns=${r.turns} cost=${r.costUsd}${r.costEstimated ? ' (estimated)' : ''}${judgedNote}`);
    for (const g of r.graders) out(`    ${g.pass ? 'ok  ' : 'FAIL'} ${g.type}${g.judged ? ' [judged]' : ''}: ${g.detail}`);
  };
  const exec = async (s) => {
    out(`running ${s.id} ...`);
    let r;
    try {
      r = await runScenario(s, {
        bin, model: opts.model, runUsd: runUsdFor(), judgeUsd: Math.min(opts.judgeUsd || limits.judgeReserveUsd, capUsd), timeoutMs: timeoutMsFor(s), repoRoot: REPO_ROOT, judge,
        workdir, credentials, secrets, keepWorkspace: opts.keepWorkspace,
      });
    } catch (e) {
      r = { id: s.id, type: s.type, skill: s.skill, pass: false, outcome: 'fail', verdict: 'fail', graders: [], costUsd: null, claudeResult: `runner error: ${e.message}` };
    }
    r = envlib.redactDeep(r, secrets);
    show(r);
    return r;
  };

  const suite = await runSuite(scenarios, { concurrency, capUsd, reserve: reservationOf, run: exec });
  const byId = new Map(suite.done.map((d) => [d.item.id, d.result]));
  const results = scenarios.map((s) => byId.get(s.id) || {
    id: s.id, type: s.type, skill: s.skill, pass: null, outcome: 'incomplete', skipped: 'budget exhausted', graders: [],
  });
  const incomplete = results.filter((r) => r.outcome === 'incomplete');
  for (const r of incomplete) out(`running ${r.id} ...\n  INCOMPLETE not started: cost cap $${capUsd} reached (spend plus in-flight reservations)`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const modelTag = (opts.model || 'default').replace(/[^A-Za-z0-9._-]/g, '_');
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, `${modelTag}-${stamp}.json`);
  const report = {
    model: opts.model || 'default',
    startedAt: new Date().toISOString(),
    maxUsd: capUsd,
    timeoutSec: opts.timeoutSec || limits.timeoutSec,
    concurrency,
    totalCostUsd: suite.spent,
    peakCommittedUsd: suite.peakCommitted,
    env: { allowlisted: [...envlib.BASE_NAMES, 'HOME', ...credentials], homeMode: envlib.isCI(process.env) ? 'ci-temp' : 'passthrough' },
    passed: results.filter((r) => r.outcome === 'pass').length,
    failed: results.filter((r) => r.outcome === 'fail' || r.outcome === 'timed_out').length,
    incomplete: incomplete.length,
    total: results.length,
    results,
  };
  fs.writeFileSync(file, envlib.redactText(JSON.stringify(report, null, 2), secrets));
  out(`results: ${path.relative(process.cwd(), file)} (${report.passed}/${report.total} passed${report.incomplete ? `, ${report.incomplete} incomplete` : ''})`);
  if (rejected.length) return 2;
  if (report.failed) return 1;
  return report.incomplete ? 4 : 0;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }, (e) => {
    const known = [...new Set([...activeSecrets, ...envlib.secretValues(process.env, envlib.DEFAULT_CREDENTIALS)])];
    console.error(envlib.redactText(e.message, known));
    process.exitCode = 2;
  });
}

module.exports = { parseArgs, loadScenarios, runScenario, main };
