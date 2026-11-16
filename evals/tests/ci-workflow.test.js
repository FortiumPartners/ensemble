'use strict';

/**
 * TRD-021-TEST and TRD-023-TEST: CI parity, trigger rules, advisory statement, credential guard and CODEOWNERS.
 * Parses the real files (.github/workflows/evals.yml with the repository's js-yaml, package.json, .github/CODEOWNERS and the docs).
 * Every assertion reads the real file, so editing the file can make it fail. Nothing here runs a workflow or a model.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '../..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const WORKFLOW = () => yaml.load(read('.github/workflows/evals.yml'), { schema: yaml.CORE_SCHEMA });
const PKG = () => JSON.parse(read('package.json'));
const job = (wf) => Object.values(wf.jobs)[0];
const runSteps = (wf) => Object.values(wf.jobs).flatMap((j) => j.steps).filter((s) => typeof s.run === 'string');
/** Non-comment lines of a shell script. */
const lines = (script) => script.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
/** The `npm run <script> [-- args]` command lines of every run step. */
const npmCalls = (wf) => runSteps(wf).flatMap((s) => lines(s.run)).map((l) => l.match(/^npm run (\S+)(?: -- (.*))?$/)).filter(Boolean).map((m) => ({ script: m[1], args: m[2] || '' }));
const flagsOf = (text) => [...text.matchAll(/(?:^|[\s(])(--[a-z][a-z-]*)/g)].map((m) => m[1]);

describe('the workflow file parses (a malformed file fails loudly)', () => {
  test('js-yaml rejects malformed input, and the real workflow is a mapping with jobs', () => {
    expect(() => yaml.load('on: [unclosed\n  jobs: {', { schema: yaml.CORE_SCHEMA })).toThrow();
    const wf = WORKFLOW();
    expect(wf).toEqual(expect.objectContaining({ name: 'Evals' }));
    expect(Object.keys(wf.jobs).length).toBeGreaterThan(0);
    expect(runSteps(wf).length).toBeGreaterThan(0);
  });
});

describe('TRD-021-TEST: same entry points and arguments locally and in CI (AC-017-1)', () => {
  test('every eval invocation in a run step is an npm script, never a direct node call, and the scripts point at the harness entry points', () => {
    const wf = WORKFLOW();
    const scripts = PKG().scripts;
    expect(scripts.evals).toBe('node evals/run.js');
    expect(scripts['evals:coverage']).toBe('node evals/coverage.js');
    expect(scripts['evals:compare']).toBe('node evals/compare.js');
    for (const s of runSteps(wf)) expect(s.run).not.toMatch(/node\s+(\.\/)?evals\//);
    const calls = npmCalls(wf);
    expect(calls.map((c) => c.script)).toEqual(['evals', 'evals:coverage', 'evals:compare']);
    for (const c of calls) expect(Object.keys(scripts)).toContain(c.script);
  });

  test('the flags the workflow passes are the flags a maintainer uses: each is accepted by the entry point and documented in the README', () => {
    const calls = npmCalls(WORKFLOW());
    const run = fs.readFileSync(path.join(ROOT, 'evals/run.js'), 'utf8');
    const compare = fs.readFileSync(path.join(ROOT, 'evals/compare.js'), 'utf8');
    const readme = read('evals/README.md');
    const stepText = runSteps(WORKFLOW()).map((s) => s.run).join('\n');
    const evalsFlags = flagsOf(stepText.split('\n').filter((l) => /ARGS|npm run evals --/.test(l) && !/compare/.test(l)).join('\n'));
    expect(new Set(evalsFlags)).toEqual(new Set(['--runtime', '--model', '--max-usd', '--skill', '--scenario']));
    for (const f of evalsFlags) { expect(run).toContain(`'${f}'`); expect(readme).toContain(f); }
    expect(readme).toContain('npm run evals -- --runtime <runtime> --model <model> --max-usd <usd> [--skill <skill>]');
    const evalsCall = calls.find((c) => c.script === 'evals');
    expect(evalsCall.args).toBe('"${ARGS[@]}"');
    expect(flagsOf(stepText.split('\n').filter((l) => /compare/.test(l) || /EVAL_SKILL/.test(l)).join('\n'))).toContain('--skill');
    expect(compare).toContain("'--skill'");
    expect(calls.find((c) => c.script === 'evals:compare').args).toBe('"${ARGS[@]}"');
    expect(calls.find((c) => c.script === 'evals:coverage').args).toBe('');
  });

  test('the flag values come from the dispatch inputs: --runtime, --model, --max-usd, --skill read EVAL_* variables', () => {
    const evalStep = job(WORKFLOW()).steps.find((s) => s.run && /npm run evals --/.test(s.run));
    expect(evalStep.run).toContain('--runtime "$EVAL_RUNTIME"');
    expect(evalStep.run).toContain('--model "$EVAL_MODEL"');
    expect(evalStep.run).toContain('--max-usd "$EVAL_MAX_USD"');
    expect(evalStep.run).toContain('--skill "$EVAL_SKILL"');
    expect(evalStep.env).toEqual(expect.objectContaining({ EVAL_RUNTIME: '${{ inputs.runtime }}', EVAL_MODEL: '${{ inputs.model }}', EVAL_MAX_USD: '${{ inputs.max_usd }}', EVAL_SKILL: '${{ inputs.skill }}' }));
  });

  test('the report is uploaded as an artifact (also when a step failed)', () => {
    const up = job(WORKFLOW()).steps.find((s) => /^actions\/upload-artifact@/.test(s.uses || ''));
    expect(up).toBeDefined();
    expect(up.with.path).toBe('evals/results/');
    expect(String(up.if)).toBe('always()');
  });
});

describe('TRD-021-TEST: on-demand selection, no automatic trigger (AC-017-2, AC-017-3)', () => {
  test('workflow_dispatch with skill, runtime, model and max_usd inputs', () => {
    const on = WORKFLOW().on;
    expect(on).toBeDefined();
    expect(Object.keys(on)).toContain('workflow_dispatch');
    expect(Object.keys(on.workflow_dispatch.inputs)).toEqual(expect.arrayContaining(['skill', 'runtime', 'model', 'max_usd']));
    expect(on.workflow_dispatch.inputs.skill.default).toBe(''); // blank selects the full suite
    expect(on.workflow_dispatch.inputs.runtime.options).toEqual(expect.arrayContaining(['claude', 'pi']));
    expect(on.workflow_dispatch.inputs.runtime.type).toBe('choice');
  });

  test('workflow_dispatch is the only trigger: no push, pull_request, pull_request_target, schedule or workflow_run', () => {
    const on = WORKFLOW().on;
    expect(typeof on).toBe('object'); // a string or array form (`on: push`) would not have inputs
    expect(Array.isArray(on)).toBe(false);
    expect(Object.keys(on)).toEqual(['workflow_dispatch']);
    for (const k of ['push', 'pull_request', 'pull_request_target', 'schedule', 'workflow_run', 'issue_comment']) expect(on).not.toHaveProperty(k);
  });
});

describe('TRD-021-TEST: advisory, not required (AC-018-4)', () => {
  test.each(['docs/guides/skills-eval.md', 'evals/README.md'])('%s states the regression check is advisory and the evals workflow is not a required status check', (file) => {
    const text = read(file).replace(/\s+/g, ' ');
    expect(text).toMatch(/regression check is advisory/i);
    expect(text).toMatch(/evals workflow is not a required status check/i);
  });

  test('the workflow carries no continue-on-error that would hide a failed regression check, and the compare step has no `|| true`', () => {
    const wf = WORKFLOW();
    const step = job(wf).steps.find((s) => s.run && /evals:compare/.test(s.run));
    expect(step).toBeDefined();
    expect(step['continue-on-error']).toBeUndefined();
    expect(job(wf)['continue-on-error']).toBeUndefined();
    expect(step.run).not.toMatch(/\|\|\s*(true|:)/);
    expect(String(step.if)).toContain('!cancelled()'); // it still runs after a failed evals step
  });

  test('docs describe the workflow inputs and scripts (no stale "later PR" statement)', () => {
    for (const file of ['docs/guides/skills-eval.md', 'evals/README.md']) {
      const text = read(file);
      for (const word of ['workflow_dispatch', 'npm run evals:coverage', 'npm run evals:compare', 'max_usd', 'CODEOWNERS']) expect(text).toContain(word);
      expect(text).not.toMatch(/\blater PR\b|\(TRD-02[123]\)|CI (is|comes) (planned|a later)|not yet (implemented|available)/i);
    }
  });
});

describe('workflow hygiene (script injection, least privilege)', () => {
  test('no ${{ }} expression is expanded inside any run script body', () => {
    for (const s of runSteps(WORKFLOW())) expect(s.run).not.toMatch(/\$\{\{/);
  });

  test('dispatch inputs reach steps only as env values', () => {
    const wf = WORKFLOW();
    const raw = read('.github/workflows/evals.yml').split('\n').filter((l) => !l.trim().startsWith('#'));
    const users = raw.filter((l) => /\$\{\{\s*(inputs|github\.event\.inputs)\./.test(l));
    expect(users.length).toBeGreaterThan(0);
    for (const l of users) expect(l).toMatch(/^\s+EVAL_[A-Z_]+: \$\{\{ inputs\.[a-z_]+ \}\}$/);
    for (const j of Object.values(wf.jobs)) for (const s of j.steps) {
      // An `if:` expression is evaluated by Actions, never by a shell; the one allowed use is the legacy-scenario skip.
      const uses = JSON.stringify({ with: s.with, name: s.name, if: String(s.if || '').replace("inputs.scenario == ''", '') });
      expect(uses).not.toMatch(/inputs\./);
    }
  });

  test('least-privilege permissions: read-only contents, nothing else', () => {
    expect(WORKFLOW().permissions).toEqual({ contents: 'read' });
    for (const j of Object.values(WORKFLOW().jobs)) expect(j.permissions === undefined || JSON.stringify(j.permissions) === JSON.stringify({ contents: 'read' })).toBe(true);
  });

  test('every action is pinned to a version', () => {
    for (const s of job(WORKFLOW()).steps.filter((x) => x.uses)) expect(s.uses).toMatch(/^[\w.-]+\/[\w.-]+@v\d+$/);
  });
});

describe('TRD-023-TEST: credential guard (AC-009-4)', () => {
  const GUARD = /github\.repository\s*==\s*'Sunstone-Partners\/ensemble'/;
  const BRANCH = /github\.ref\s*==\s*'refs\/heads\/main'\s*\|\|\s*github\.ref\s*==\s*'refs\/heads\/dev'/;
  const guarded = (cond) => GUARD.test(String(cond)) && BRANCH.test(String(cond));

  test('the job and the step that reads a secret are both guarded by a same-repository branch condition', () => {
    const j = job(WORKFLOW());
    expect(guarded(j.if)).toBe(true);
    const secretSteps = j.steps.filter((s) => JSON.stringify(s).includes('secrets.'));
    expect(secretSteps.length).toBe(1);
    expect(guarded(secretSteps[0].if)).toBe(true);
    expect(secretSteps[0].env.ANTHROPIC_API_KEY).toBe('${{ secrets.ANTHROPIC_API_KEY }}');
  });

  test('secrets appear nowhere else: not at workflow or job env, not in a `with:`, not in any other step', () => {
    const wf = WORKFLOW();
    expect(JSON.stringify(wf.env || {})).not.toContain('secrets.');
    expect(JSON.stringify(job(wf).env || {})).not.toContain('secrets.');
    const secretLines = read('.github/workflows/evals.yml').split('\n').filter((l) => !l.trim().startsWith('#') && l.includes('secrets.'));
    expect(secretLines.length).toBe(1);
    expect(secretLines[0]).toMatch(/^\s+ANTHROPIC_API_KEY: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}$/);
  });

  test('the guard refuses a fork, a tag and a pull ref (evaluated against the real condition)', () => {
    const cond = String(job(WORKFLOW()).if);
    // Evaluate the two operands the condition is made of; the whole condition must be exactly their conjunction.
    const evaluate = (repository, ref) => repository === 'Sunstone-Partners/ensemble' && (ref === 'refs/heads/main' || ref === 'refs/heads/dev');
    expect(cond.replace(/\s+/g, ' ')).toBe("github.repository == 'Sunstone-Partners/ensemble' && (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/dev')");
    expect(evaluate('Sunstone-Partners/ensemble', 'refs/heads/main')).toBe(true);
    expect(evaluate('Sunstone-Partners/ensemble', 'refs/heads/dev')).toBe(true);
    expect(evaluate('Sunstone-Partners/ensemble', 'refs/heads/feature/evil')).toBe(false); // an unreviewed branch would run its own evals/run.js with the key
    expect(evaluate('brumschlag/ensemble', 'refs/heads/main')).toBe(false);
    expect(evaluate('Sunstone-Partners/ensemble', 'refs/tags/v1')).toBe(false);
    expect(evaluate('Sunstone-Partners/ensemble', 'refs/pull/7/merge')).toBe(false);
  });

  test('the regression-check step is skipped for the legacy scenario input (nothing to compare), and not otherwise', () => {
    const step = job(WORKFLOW()).steps.find((x) => /evals:compare/.test(x.run || ''));
    expect(step).toBeDefined();
    expect(String(step.if).replace(/\s+/g, ' ')).toBe("${{ !cancelled() && inputs.scenario == '' }}");
  });

  test('CODEOWNERS has an explicit /evals/ owner entry beside the other sensitive paths', () => {
    const entries = read('.github/CODEOWNERS').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\s+/));
    const evals = entries.find(([p]) => p === '/evals/');
    expect(evals).toBeDefined();
    expect(evals.length).toBeGreaterThan(1);
    for (const owner of evals.slice(1)) expect(owner).toMatch(/^@[\w.-]+(\/[\w.-]+)?$/);
    const star = entries.find(([p]) => p === '*');
    expect(evals.slice(1)).toEqual(star.slice(1)); // same owner as the file's other sensitive paths
    const workflows = entries.find(([p]) => p === '/.github/workflows/');
    expect(evals.slice(1)).toEqual(workflows.slice(1));
    // CODEOWNERS: the last matching pattern wins, so the explicit entry must come after the `*` default.
    expect(entries.findIndex(([p]) => p === '/evals/')).toBeGreaterThan(entries.findIndex(([p]) => p === '*'));
  });
});
