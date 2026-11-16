#!/usr/bin/env node
'use strict';

/**
 * Headless behavioral eval runner.
 * Usage: node evals/run.js [--scenario <id>] [--skill <name>] [--model <id>] [--judge-model <id>] [--dry-run]
 *   [--max-usd N] [--timeout SEC] [--concurrency N] [--keep-workspace] [--allow-env NAME]... [--env-allowlist FILE]
 *   [--run-usd N] [--judge-usd N] [--repeats N] [--runtime claude|pi]
 * Exit: 0 all pass, 1 an eval failed or timed out, 2 usage/rejected definition (including an unsupported runtime, or a --scenario/--skill selection that the runtime filter empties),
 *   3 the runtime's CLI missing, 4 incomplete evals or an unfiltered run that executed zero evals (1 outranks 4).
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
const { loadLimits, reservationFor, runSuite, resolveRepeats, expandRuns } = require('./lib/exec');
const arms = require('./lib/arms');
const { describeCopy } = require('./lib/results');
const { getRunner, supportedRuntimes } = require('./lib/runners');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCENARIOS_DIR = process.env.EVALS_SCENARIOS_DIR || path.join(__dirname, 'scenarios');
const EVAL_SKILLS_DIR = process.env.EVALS_SKILLS_DIR || path.join(__dirname, 'skills');
const RESULTS_DIR = process.env.EVALS_RESULTS_DIR || path.join(__dirname, 'results');

let activeSecrets = []; // credential values in play; the top-level error handler redacts with these

function parseArgs(argv) {
  const o = {
    scenario: null, skill: null, model: null, judgeModel: null, dryRun: false, maxUsd: null,
    timeoutSec: null, concurrency: null, keepWorkspace: false, allowEnv: [], envAllowlist: null, runUsd: null, judgeUsd: null,
    repeats: null, runtime: 'claude',
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
    else if (a === '--repeats') o.repeats = num(a, argv[++i], { int: true });
    else if (a === '--runtime') o.runtime = argv[++i];
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
 * run: { bin (the runtime's CLI), judgeBin (the claude CLI, which runs the judge), model, runUsd, judgeUsd, timeoutMs, repoRoot, judge, workdir, credentials, judgeCredentials (base names + --allow-env, never a runtime's provider keys; defaults to credentials), secrets (all credential values, redacted from every process's output), parentEnv, keepWorkspace,
 *        arm, ev, runtime, runner }
 * With `run.arm` ('with-skill' | 'baseline') and `run.ev` the job is built from the skill eval by arms.buildJob;
 * otherwise from the legacy scenario. `run.runner` replaces the runtime's adapter (tests).
 */
async function runScenario(scenario, run) {
  const { bin, judgeBin = bin, model, runUsd, judgeUsd = 0, timeoutMs, repoRoot, judge, workdir, credentials, judgeCredentials = credentials, secrets = [], parentEnv = process.env, keepWorkspace } = run;
  const sb = sandbox.createSandbox(scenario.scenarioDir, scenario, { workdir });
  let ciHome = null;
  let checkHome = null;
  let agentHome = null;
  const started = Date.now();
  try {
    if (envlib.isCI(parentEnv)) ciHome = envlib.makeCiHome(workdir);
    // A Pi run gets a throwaway empty HOME like the checks do (probed: Pi still authenticates from its provider key in the
    // environment); Pi's own auth files under the real HOME are then not reachable. Claude keeps the passthrough HOME for its login.
    if (!ciHome && (run.runtime || 'claude') === 'pi' && scenario.type === 'agent') agentHome = envlib.makeCiHome(workdir);
    const env = envlib.buildEnv({ parent: parentEnv, credentials, home: ciHome || agentHome || undefined });
    // Checks run agent-written code: always a throwaway empty HOME, never the real one.
    checkHome = ciHome || envlib.makeCiHome(workdir);
    const checkEnv = envlib.buildEnv({ parent: parentEnv, credentials: [], home: checkHome });
    // The judge is a claude process: it never sees the runtime-scoped (Pi provider) keys.
    const judgeEnv = envlib.buildEnv({ parent: parentEnv, credentials: judgeCredentials, home: ciHome || undefined });
    let transcript = '';
    let proc = { exitCode: 0, stderr: '', timedOut: false, transcriptTruncated: false, commands: [], commandsIncomplete: false };
    let armInfo = {};
    if (scenario.type === 'agent') {
      const runtime = run.runtime || 'claude';
      const jobCtx = { repoRoot, runtime, model, workspace: sb.dir, env, timeoutMs, maxUsd: runUsd };
      const job = run.arm ? arms.buildJob(run.ev, run.arm, jobCtx) : arms.scenarioJob(scenario, jobCtx);
      proc = await (run.runner || getRunner(runtime)).run(job, { bin, secrets });
      transcript = envlib.redactText(proc.transcript, secrets);
      if (run.arm) {
        armInfo = {
          invoked: arms.wasInvoked(run.ev.skill, proc),
          loadedSkills: proc.loadedSkills || [], invokedSkills: proc.invokedSkills || [], loadedPlugins: proc.loadedPlugins || [],
          loadedSource: proc.loadedSource,
        };
      }
    }
    const summary = sandbox.summarizeTranscript(transcript);
    if (proc.costUsd !== undefined) summary.costUsd = proc.costUsd;
    if (proc.turns !== undefined && proc.turns !== null) summary.turns = proc.turns;
    // An agent run with no reported cost (timeout, crash) is charged its full per-run budget, flagged costEstimated.
    const agentUnknown = scenario.type === 'agent' && summary.costUsd === null;
    const agentCost = agentUnknown ? runUsd : summary.costUsd;
    const base = {
      id: scenario.id, type: scenario.type, skill: scenario.skill,
      runtime: scenario.type === 'agent' ? (run.runtime || 'claude') : null,
      ...armInfo,
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
    const commands = Array.isArray(proc.commands) ? proc.commands.map((c) => envlib.redactText(c, secrets)) : undefined;
    const ctx = { dir: sb.dir, repoRoot, baseline: sb.baseline, transcript, transcriptTruncated: proc.transcriptTruncated, commands, commandsIncomplete: proc.commandsIncomplete, env: checkEnv, judgeEnv, secrets, judge: judge ? { ...judge, bin: judgeBin } : undefined };
    // Judged checks read only the with-skill arm (judgedScore), so the baseline arm skips them: no judge spend is wasted.
    const specs = (scenario.graders || []).filter((g) => !(run.arm === 'baseline' && g.type === 'judge'));
    const graders = await runGraders(specs, ctx);
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
    if (agentHome) fs.rmSync(agentHome, { recursive: true, force: true });
  }
}

async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const credentials = envlib.loadCredentialNames({ file: opts.envAllowlist || undefined, extra: opts.allowEnv, runtime: opts.runtime });
  const judgeCredentials = envlib.loadCredentialNames({ file: opts.envAllowlist || undefined, extra: opts.allowEnv });
  const secrets = envlib.secretValues(process.env, credentials);
  activeSecrets = secrets;
  const out = (text) => console.log(envlib.redactText(text, secrets));
  const err = (text) => console.error(envlib.redactText(text, secrets));
  if (!supportedRuntimes().includes(opts.runtime)) {
    err(`unsupported --runtime "${String(opts.runtime).slice(0, 80)}": not supported in this release (supported: ${supportedRuntimes().join(', ')}); nothing was run`);
    return 2;
  }
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
  // `runtimes` acts: an eval runs only under a runtime it lists; legacy agent scenarios are Claude-only.
  const selected = scenarios;
  scenarios = scenarios.filter((s) => {
    const ev = skillEvals.find((e) => e.id === s.id && e.skill === s.skill);
    const ok = ev ? ev.runtimes.includes(opts.runtime) : s.type !== 'agent' || opts.runtime === 'claude';
    if (!ok) err(`SKIP ${s.id}: not run under --runtime ${opts.runtime} (${ev ? `its \`runtimes\` is ${JSON.stringify(ev.runtimes)}` : 'a legacy agent scenario is Claude-only'})`);
    return ok;
  });
  if ((opts.scenario || opts.skill) && selected.length && !scenarios.length) {
    err(`nothing to run: the selected eval(s) (${selected.map((s) => s.id).join(', ')}) are not run under --runtime ${opts.runtime}`);
    return 2;
  }
  if (opts.runtime === 'pi') {
    for (const ev of skillEvals) {
      if (!scenarios.some((s) => s.id === ev.id && s.skill === ev.skill)) continue;
      const dropped = [ev.allowedTools && ev.allowedTools.length ? '`allowedTools`' : null, ev.maxTurns !== undefined ? '`maxTurns`' : null].filter(Boolean);
      if (dropped.length) err(`WARNING eval "${ev.id}": ${dropped.join(' and ')} not applied under --runtime pi (Pi runs with its default tools and no turn limit)`);
    }
  }
  const runner = getRunner(opts.runtime);
  const evById = new Map(skillEvals.map((ev) => [ev.id, ev]));
  const bin = runner.find();
  const claudeBin = sandbox.findClaude(); // the judge always runs through claude
  const needsBin = scenarios.some((s) => s.type === 'agent');
  const limits = loadLimits();
  // Repeats and bar per skill eval: --repeats over the eval's value over limits.json; the bar is the eval's or the default.
  const plans = new Map();
  for (const s of scenarios) {
    const ev = evById.get(s.id);
    if (!ev) continue;
    try { plans.set(ev.id, resolveRepeats(ev, { flagRepeats: opts.repeats, limits })); } catch (e) { err(e.message); return 2; }
  }

  // Judged checks run only with a judge model that differs from the model under test; otherwise they are refused.
  const judge = resolveJudge({ judgeModel: opts.judgeModel, model: opts.model });
  if (!claudeBin && !judge.refusal) judge.refusal = 'the `claude` CLI that runs the judge was not found (set EVALS_CLAUDE_BIN)';
  const judgedIds = scenarios.filter((s) => (s.graders || []).some((g) => g.type === 'judge')).map((s) => s.id);
  if (judgedIds.length && judge.refusal) {
    err(`REFUSED judged checks (${judgedIds.join(', ')}): ${judge.refusal}; deterministic checks still run`);
  }

  if (opts.dryRun) {
    out(`${scenarios.length} eval(s)${rejected.length ? `, ${rejected.length} rejected` : ''}:`);
    for (const s of scenarios) {
      out(`  ${s.id} [${s.skill ? `skill: ${s.skill}` : s.type}] graders: ${(s.graders || []).map((g) => g.type).join(', ')}`);
      out(`      ${s.description || ''}`);
      const plan = plans.get(s.id);
      if (plan) out(`      arms: with-skill + baseline, repeats ${plan.repeats} (${plan.repeatsSource}), bar ${plan.bar} (${plan.barSource})`);
    }
    if (needsBin && !bin) out(`SKIP: \`${runner.BIN_NAME}\` CLI not found on PATH; agent scenarios would not run.`);
    return rejected.length ? 2 : 0;
  }
  if (!scenarios.length) {
    out(`0 evals ran under runtime ${opts.runtime}`);
    return rejected.length ? 2 : 4;
  }
  if (needsBin && !bin) {
    err(`SKIP: \`${runner.BIN_NAME}\` CLI not found on PATH (set ${runner.BIN_ENV} to override); cannot run agent scenarios.`);
    return 3;
  }

  if (opts.timeoutSec && opts.timeoutSec > limits.timeoutSec) {
    err(`--timeout ${opts.timeoutSec} exceeds the limit of ${limits.timeoutSec}s in evals/limits.json`);
    return 2;
  }
  const capUsd = opts.maxUsd || limits.maxUsdPerSuite;
  const concurrency = opts.concurrency || limits.concurrency;
  const workdir = sandbox.resolveWorkdir();
  const judgeActive = Boolean(judge && !judge.refusal);
  const reservationOf = (s, arm) => reservationFor(
    { model: s.type === 'agent', judged: arm !== 'baseline' && judgeActive && (s.graders || []).some((g) => g.type === 'judge') },
    { runReserveUsd: opts.runUsd || limits.runReserveUsd, judgeReserveUsd: opts.judgeUsd || limits.judgeReserveUsd, capUsd },
  );
  const runUsdFor = () => Math.min(opts.runUsd || limits.runReserveUsd, capUsd);
  const timeoutMsFor = (s) => 1000 * (opts.timeoutSec || Math.min(s.timeoutSec || limits.timeoutSec, limits.timeoutSec));

  const show = (r, label = '') => {
    const judgedNote = r.judgedScore === null || r.judgedScore === undefined ? '' : ` judged=${r.judgedScore.toFixed(2)} (${r.judgeModel})`;
    const invokedNote = r.invoked === undefined ? '' : ` skill-invoked=${r.invoked ? 'yes' : 'no'}`;
    out(`  ${label}${r.outcome.toUpperCase()} turns=${r.turns} cost=${r.costUsd}${r.costEstimated ? ' (estimated)' : ''}${invokedNote}${judgedNote}`);
    for (const g of r.graders) out(`    ${g.pass ? 'ok  ' : 'FAIL'} ${g.type}${g.judged ? ' [judged]' : ''}: ${g.detail}`);
  };
  const runOpts = (s) => ({
    bin, judgeBin: claudeBin, model: opts.model, runUsd: runUsdFor(), judgeUsd: Math.min(opts.judgeUsd || limits.judgeReserveUsd, capUsd), timeoutMs: timeoutMsFor(s), repoRoot: REPO_ROOT, judge,
    workdir, credentials, judgeCredentials, secrets, keepWorkspace: opts.keepWorkspace, runtime: opts.runtime,
  });
  const scenarioOf = new Map(scenarios.map((s) => [s.id, s]));
  const aborts = new Map(); // eval id -> leak message: the rest of that eval's runs are skipped
  const exec = async (item) => {
    const { ev, arm } = item;
    if (!ev) {
      const s = item.legacy;
      out(`running ${s.id} ...`);
      let r;
      try {
        r = await runScenario(s, runOpts(s));
      } catch (e) {
        r = { id: s.id, type: s.type, skill: s.skill, pass: false, outcome: 'fail', verdict: 'fail', graders: [], costUsd: null, claudeResult: `runner error: ${e.message}` };
      }
      r = { ...r, runtime: s.type === 'agent' ? opts.runtime : null };
      r = envlib.redactDeep(r, secrets);
      show(r);
      return r;
    }
    const s = scenarioOf.get(ev.id);
    const plan = plans.get(ev.id);
    const label = `[${arm} ${item.run}/${plan.repeats}] `;
    if (aborts.has(ev.id)) return { outcome: 'aborted', graders: [], costUsd: 0, arm, run: item.run, evalId: ev.id };
    out(`running ${ev.id} ${label.trim()} ...`);
    let r;
    try {
      r = await runScenario(s, { ...runOpts(s), arm, ev });
    } catch (e) {
      r = { id: ev.id, type: 'agent', skill: ev.skill, pass: false, outcome: 'fail', verdict: 'fail', graders: [], costUsd: null, claudeResult: `runner error: ${e.message}` };
    }
    r = { ...r, evalId: ev.id, arm, run: item.run, runtime: opts.runtime, model: opts.model || 'default', invocationMode: ev.invocation };
    if (arm === 'baseline') {
      const check = arms.checkBaseline(ev, r, { repoRoot: REPO_ROOT });
      if (check && check.kind === 'unverifiable-run') {
        // Crashed or timed out before any startup event: cannot be called clean, so it is not counted in the baseline score.
        r = { ...r, outcome: 'unverifiable', pass: null, verdict: null, unverifiable: check.message };
      } else if (check) {
        aborts.set(ev.id, check.message);
        r = { ...r, outcome: 'aborted', pass: null, verdict: null, leak: check.message };
      }
    }
    r = envlib.redactDeep(r, secrets);
    show(r, label);
    return r;
  };

  const copies = new Map();
  const items = [];
  for (const s of scenarios) {
    const ev = evById.get(s.id);
    if (!ev) { items.push({ legacy: s }); continue; }
    copies.set(ev.id, arms.evaluatedCopy({ repoRoot: REPO_ROOT, packageName: ev.package, skill: ev.skill }));
    items.push(...expandRuns(ev, plans.get(ev.id).repeats));
  }
  const reserveItem = (item) => reservationOf(item.ev ? scenarioOf.get(item.ev.id) : item.legacy, item.arm);
  const suite = await runSuite(items, { concurrency, capUsd, reserve: reserveItem, run: exec });
  const byItem = new Map(suite.done.map((d) => [d.item, d.result]));

  const results = [];
  for (const s of scenarios) {
    const ev = evById.get(s.id);
    if (!ev) {
      const r = byItem.get(items.find((i) => i.legacy === s)) || { id: s.id, type: s.type, skill: s.skill, pass: null, outcome: 'incomplete', skipped: 'budget exhausted', graders: [], runtime: s.type === 'agent' ? opts.runtime : null };
      results.push(r);
      continue;
    }
    const plan = plans.get(ev.id);
    const runs = { 'with-skill': [], baseline: [] };
    for (const item of items.filter((i) => i.ev === ev)) {
      const r = byItem.get(item);
      if (r && (r.outcome !== 'aborted' || r.leak)) runs[item.arm].push(r); // skipped-after-abort placeholders are dropped
    }
    const copy = copies.get(ev.id);
    const evalResult = envlib.redactDeep(arms.summarizeEval(ev, plan, runs, { runtime: opts.runtime, abort: aborts.get(ev.id) || null, copy }), secrets);
    results.push(evalResult);
    out(`eval ${ev.id}: ${evalResult.outcome.toUpperCase()}`);
    if (evalResult.abort) {
      err(`ABORTED ${evalResult.abort}`);
      out(`  with-skill ${evalResult.withSkill.passes}/${evalResult.withSkill.runs} (not scored: baseline aborted)`);
    } else {
      const u = evalResult.uplift === null ? 'n/a' : `${evalResult.uplift >= 0 ? '+' : ''}${evalResult.uplift.toFixed(2)}`;
      out(`  with-skill ${evalResult.withSkill.passes}/${evalResult.withSkill.runs} (bar ${plan.bar} of ${plan.repeats}: ${evalResult.reliable === null ? 'undetermined' : evalResult.reliable ? 'reliable' : 'NOT reliable'}); baseline ${evalResult.baseline.passes}/${evalResult.baseline.runs}${evalResult.baseline.unverifiable ? ` (${evalResult.baseline.unverifiable} run(s) not counted: isolation unverifiable)` : ''}`);
      out(`  uplift ${u} ${evalResult.upliftLabel}`);
    }
    out(`  repeats ${plan.repeats} (${plan.repeatsSource}), bar ${plan.bar} (${plan.barSource}${plan.barSource === 'eval' ? ' override' : ''})`);
    out(`  skill invoked in ${evalResult.invokedRuns}/${evalResult.withSkill.runs} with-skill run(s)${evalResult.invokedAsExpected === false ? ` (expectInvoked ${evalResult.expectInvoked}: NOT as expected)` : ''}`);
    if (copy) out(`  evaluated copy: ${describeCopy(copy)}`);
  }
  const incomplete = results.filter((r) => r.outcome === 'incomplete');
  for (const r of incomplete.filter((x) => !x.arms)) out(`running ${r.id} ...\n  INCOMPLETE not started: cost cap $${capUsd} reached (spend plus in-flight reservations)`);
  for (const r of incomplete.filter((x) => x.arms)) out(`  INCOMPLETE ${r.id}: cost cap $${capUsd} reached before every run started (spend plus in-flight reservations)`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const modelTag = (opts.model || 'default').replace(/[^A-Za-z0-9._-]/g, '_');
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, `${modelTag}-${stamp}.json`);
  const report = {
    model: opts.model || 'default',
    runtime: opts.runtime,
    startedAt: new Date().toISOString(),
    maxUsd: capUsd,
    timeoutSec: opts.timeoutSec || limits.timeoutSec,
    concurrency,
    totalCostUsd: suite.spent,
    peakCommittedUsd: suite.peakCommitted,
    env: { allowlisted: [...envlib.BASE_NAMES, 'HOME', ...credentials], homeMode: envlib.isCI(process.env) || opts.runtime === 'pi' ? 'ci-temp' : 'passthrough' },
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
