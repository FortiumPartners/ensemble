'use strict';

/**
 * verifyHosted, round 5 (E): the `needs:` closure is verified in the same run, and the STEP CONCLUSIONS of every required
 * job come from the jobs listing's `steps[]` (the real guard; the static `if:`/`continue-on-error` checks are an early
 * refusal). The fixtures are the REAL data of this repository: the three workflow files read from the working tree at
 * test time, and trimmed copies of the real GitHub jobs responses (tests/fixtures/local-ci-hosted/jobs-*.json). Every
 * mutation below changes ONE thing in that real data and must be refused with a reason naming job, step and conclusion.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { verifyHosted, structuralProblem, matrixOnlyIf } = require('../lib/local-ci-hosted');
const { cleanupBaseRepos, PR, BASE_BRANCH } = require('./helpers/local-ci-base-repo');
const H = require('./helpers/local-ci-hosted');

afterAll(cleanupBaseRepos);

const { VALIDATE, TEST, DRIFT, REPO } = H;
const ROOT = path.join(__dirname, '..', '..', '..');
const REAL_WORKFLOWS = Object.fromEntries([VALIDATE, TEST, DRIFT].map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]));
const REAL_JOBS = Object.fromEntries(['validate', 'test', 'drift'].map((k) => [k, JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'local-ci-hosted', `jobs-${k}.json`), 'utf8'))]));
const git = H.memoGit();
const BIND = { pr: PR, baseRefName: BASE_BRANCH };

const repos = new Map();
/** A real temp repo whose base AND head carry `files` (workflow overrides over the three real ones). */
function repoOf(files) {
  const key = JSON.stringify(files);
  if (!repos.has(key)) repos.set(key, H.hostedRepo({ files }));
  return repos.get(key);
}
const realRepo = () => repoOf(REAL_WORKFLOWS);

function verify(entries, { fixture = realRepo(), api } = {}) {
  const ghApi = H.actionsApi(entries, api);
  const r = verifyHosted({ repo: REPO, headSha: fixture.headSha, baseSha: fixture.baseSha, repoRoot: fixture.dir, approvalSet: H.APPROVAL_SET, ...BIND }, { git, ghApi });
  return { r, ghApi };
}

const clone = (v) => JSON.parse(JSON.stringify(v));

/** The real jobs of the three workflows as run entries on `head` (ids and head rewritten, nothing else touched). */
function realEntries(head) {
  const mk = (id, file, fx) => {
    const { run } = H.hostedRun(id, file, [], head);
    return { run, jobs: clone(fx.jobs).map((j, i) => ({ ...j, id: id * 100 + i + 1, run_id: id, head_sha: head })) };
  };
  return [mk(101, VALIDATE, REAL_JOBS.validate), mk(102, TEST, REAL_JOBS.test), mk(103, DRIFT, REAL_JOBS.drift)];
}

/** `entries` with `steps` of the job called `name` replaced by `change(copy of its steps)`. */
function withSteps(entries, name, change) {
  return entries.map((e) => ({ run: e.run, jobs: e.jobs.map((j) => (j.name === name ? { ...j, steps: change(clone(j.steps || [])) } : j)) }));
}
const setStep = (entries, name, index, over) => withSteps(entries, name, (steps) => { steps[index] = { ...steps[index], ...over }; return steps; });
/** Same, but a job without a `steps` key at all. */
const withoutSteps = (entries, name) => entries.map((e) => ({ run: e.run, jobs: e.jobs.map((j) => { if (j.name !== name) return j; const { steps: _steps, ...rest } = j; return rest; }) }));

function refused(r, ...causes) {
  expect(r.ok).toBe(false);
  expect(r.reason).toMatch(/^hosted CI not accepted: /);
  for (const c of causes) expect(r.reason).toContain(c);
  return r;
}

/** The real entries of the workflows other than `file`. */
const othersThan = (head, file) => realEntries(head).filter((e) => e.run.path !== file);

let HEAD;
let entries;
beforeAll(() => {
  HEAD = realRepo().headSha;
});
beforeEach(() => {
  entries = realEntries(HEAD);
});

const T22 = 'test (22)'; // steps: 0 Set up job, 1 checkout, 2 Setup Node.js 22, 3 Install, 4 Run tests, 5 Upload coverage (skipped), 6-7 Post, 8 Complete
const V = 'validate'; // steps: 0 Set up job, 1..9 the nine workflow steps, 10-11 Post, 12 Complete

describe('the real data: three real workflows and the real jobs responses', () => {
  it('is what it claims to be: the real jobs match the real workflows, test (22) skipped Upload coverage', () => {
    const t22 = REAL_JOBS.test.jobs.find((j) => j.name === T22);
    expect(t22.steps.find((s) => s.name === 'Upload coverage').conclusion).toBe('skipped');
    expect(REAL_WORKFLOWS[TEST]).toContain('if: matrix.node-version == 24');
    for (const j of REAL_JOBS.test.jobs.concat(REAL_JOBS.validate.jobs, REAL_JOBS.drift.jobs)) {
      expect(Object.keys(j).sort()).toEqual(['conclusion', 'head_sha', 'id', 'name', 'run_id', 'status', 'steps']);
      for (const s of j.steps) expect(Object.keys(s).sort()).toEqual(['conclusion', 'name', 'number', 'status']);
    }
  });

  it('verifyHosted ACCEPTS it, including test (22) whose Upload coverage was skipped by its matrix-only if:', () => {
    const { r } = verify(entries);
    expect(r.ok).toBe(true);
    expect(r.jobs.map((j) => j.name)).toEqual(['validate', 'test (22)', 'test (24)', 'drift']);
  });

  it('the three real workflows still pass the static structural checks (the early refusal is not what refuses them)', () => {
    for (const [file, id] of [[VALIDATE, 'validate'], [TEST, 'test'], [DRIFT, 'drift']]) {
      expect(structuralProblem(yaml.load(REAL_WORKFLOWS[file]).jobs, id, file)).toBeNull();
    }
  });

  it('a numbering gap is accepted (the mapping is positional): none, and a huge one', () => {
    const renumber = (gap) => withSteps(entries, T22, (steps) => steps.map((s, i) => ({ ...s, number: i < 6 ? i + 1 : i + gap })));
    expect(verify(renumber(1)).r.ok).toBe(true);
    expect(verify(renumber(500)).r.ok).toBe(true);
  });

  it('steps listed out of order are sorted by number, not refused', () => {
    const { r } = verify(withSteps(entries, T22, (steps) => steps.reverse()));
    expect(r.ok).toBe(true);
  });

  it('a skipped post step is fine', () => {
    expect(verify(setStep(entries, T22, 6, { conclusion: 'skipped' })).r.ok).toBe(true);
  });
});

describe('step conclusions: a step that did not succeed refuses, naming job, step and conclusion', () => {
  it.each([
    ['failure', 'failure'],
    ['cancelled', 'cancelled'],
    ['neutral', 'neutral'],
    ['null', null],
  ])('a mapped step concluded %s', (_n, conclusion) => {
    const r = verify(setStep(entries, T22, 4, { conclusion })).r;
    refused(r, 'job "test (22)"', 'step 4', '"Run tests"', String(conclusion));
  });

  it('a failed step of the validate job and of the drift job', () => {
    refused(verify(setStep(entries, V, 5, { conclusion: 'failure' })).r, 'job "validate"', 'step 5', '"Test build scripts"', 'failure');
    refused(verify(setStep(entries, 'drift', 6, { conclusion: 'failure' })).r, 'job "drift"', '"Fail on drift"', 'failure');
  });

  it.each([
    ['in_progress', null],
    ['queued', null],
    ['in_progress', 'success'],
  ])('a mapped step that is %s (conclusion %s) is not completed', (status, conclusion) => {
    refused(verify(setStep(entries, T22, 3, { status, conclusion })).r, 'job "test (22)"', 'step 3', '"Install dependencies"', status);
  });

  it('a failed post step refuses; so does a cancelled one', () => {
    refused(verify(setStep(entries, T22, 6, { conclusion: 'failure' })).r, 'job "test (22)"', 'Post Setup Node.js 22', 'failure');
    refused(verify(setStep(entries, T22, 7, { conclusion: 'cancelled' })).r, 'job "test (22)"', 'Post Run actions/checkout@v6', 'cancelled');
  });

  it('a post step that is not completed refuses', () => {
    refused(verify(setStep(entries, T22, 6, { status: 'in_progress', conclusion: null })).r, 'job "test (22)"', 'Post Setup Node.js 22');
    // a green conclusion does not make an unfinished post step finished: the status check alone refuses this one
    refused(verify(setStep(entries, T22, 6, { status: 'in_progress', conclusion: 'success' })).r, 'job "test (22)"', 'Post Setup Node.js 22', 'in_progress, not completed');
    refused(verify(setStep(entries, T22, 7, { status: 'queued', conclusion: 'skipped' })).r, 'job "test (22)"', 'Post Run actions/checkout@v6', 'queued, not completed');
  });

  it('a skipped step on a job where the workflow has no if: (a green job that skipped real work) refuses', () => {
    const r = verify(setStep(entries, V, 4, { conclusion: 'skipped' })).r;
    refused(r, 'job "validate"', 'step 4', '"Install dependencies"', 'skipped');
  });

});

describe('a skipped step is accepted only when its BASE if: is a pure matrix comparison', () => {
  const withIf = (cond) => {
    const text = REAL_WORKFLOWS[TEST].replace('if: matrix.node-version == 24', cond === undefined ? '' : `if: ${cond}`);
    expect(text).not.toBe(REAL_WORKFLOWS[TEST]);
    return repoOf({ ...REAL_WORKFLOWS, [TEST]: text });
  };
  it.each([
    ["github.event_name == 'pull_request'"],
    ['always()'],
    ['true'],
    ['${{ always() }}'],
    ["matrix.node-version == 24 && github.actor == 'a'"],
    ['matrix.node-version == 24 && env.X == 1'],
    ["'!(matrix.node-version == 22)'"],
    ['success()'],
  ])('if: %s refuses a skipped Upload coverage', (cond) => {
    const fixture = withIf(cond);
    const r = verify(realEntries(fixture.headSha), { fixture }).r;
    refused(r, 'test');
    expect(r.reason).toMatch(/Upload coverage|if:/);
  });

  it('no if: at all refuses the skipped step', () => {
    const fixture = withIf(undefined);
    refused(verify(realEntries(fixture.headSha), { fixture }).r, 'job "test (22)"', '"Upload coverage"', 'skipped');
  });

  it.each([
    ['${{ matrix.node-version == 24 }}'],
    ['matrix.node-version != 22'],
    ["matrix.node-version == 24 || matrix.node-version == 26"],
  ])('if: %s accepts it (a pure matrix comparison)', (cond) => {
    const fixture = withIf(cond);
    expect(verify(realEntries(fixture.headSha), { fixture }).r.ok).toBe(true);
  });
});

describe('matrixOnlyIf: the whitelist, as a pure unit', () => {
  it.each([
    ['matrix.node-version == 24'],
    ['matrix.node-version != 24'],
    ["matrix.os == 'ubuntu-latest'"],
    ['matrix.flag == true'],
    ['matrix.flag != false'],
    ['matrix.x == 1.5'],
    ['${{ matrix.node-version == 24 }}'],
    ['${{matrix.node-version==24}}'],
    ['  matrix.node-version   ==   24  '],
    ["matrix.a == 1 && matrix.b != 'x'"],
    ['matrix.a == 1 || matrix.b == 2'],
    ['matrix.a == 1 && matrix.b == 2 || matrix.c == 3'],
  ])('accepts %j', (cond) => {
    expect(matrixOnlyIf(cond)).toBe(true);
  });

  it.each([
    [undefined],
    [null],
    [true],
    [false],
    [24],
    [''],
    ['true'],
    ['false'],
    ['always()'],
    ['${{ always() }}'],
    ['success()'],
    ['failure()'],
    ['cancelled()'],
    ["github.event_name == 'pull_request'"],
    ["github.actor == 'a'"],
    ["github.ref == 'refs/heads/main'"],
    ["env.X == '1'"],
    ["steps.a.outcome == 'success'"],
    ['inputs.x == 1'],
    ['!matrix.a'],
    ['!(matrix.a == 1)'],
    ['(matrix.a == 1)'],
    ['matrix.a == 1 && (matrix.b == 2)'],
    ["matrix.a == 1 && github.actor == 'a'"],
    ["matrix.a == 1 || always()"],
    ['matrix.a'],
    ['matrix.a == matrix.b'],
    ['matrix.a == github.run_id'],
    ['matrix.a > 1'],
    ['matrix.a == "x"'],
    ["matrix.a == 'x"],
    ['matrix.a == '],
    ['matrix.a == 1 &&'],
    ['matrix.a == 1 &&& matrix.b == 2'],
    ['matrix.a == 1 & matrix.b == 2'],
    ['${{ matrix.a == 1'],
    ['matrix.a == 1 }}'],
    ['${{ matrix.a == 1 }} && matrix.b == 2'],
    ['${{ ${{ matrix.a == 1 }} }}'],
    ['matrix.a == 1 ; true'],
    ['matrix.a == 1 # c'],
    ['contains(matrix.a, 1)'],
    ['matrix.a == 1\nmatrix.b == 2'],
    ['matrix == 1'],
    ['matrix.a.b == 1'],
    ["matrix.a == 'x' + 'y'"],
    ['matrix.a == -1'],
    ['matrix.a == 0x10'],
  ])('rejects %j', (cond) => {
    expect(matrixOnlyIf(cond)).toBe(false);
  });
});

describe('the shape of steps[]: cannot map -> refuse', () => {
  it('a job with no steps key at all', () => {
    refused(verify(withoutSteps(entries, T22)).r, 'job "test (22)"', 'steps');
  });

  it.each([
    ['null', null],
    ['a string', 'ok'],
    ['an object', {}],
    ['empty', []],
  ])('steps that are %s', (_n, steps) => {
    refused(verify(withSteps(entries, T22, () => steps)).r, 'job "test (22)"', 'steps');
  });

  it('an entry that is not an object, and an entry without a string name', () => {
    refused(verify(withSteps(entries, T22, (s) => { s[3] = 'Install dependencies'; return s; })).r, 'job "test (22)"');
    refused(verify(setStep(entries, T22, 3, { name: undefined })).r, 'job "test (22)"');
    refused(verify(setStep(entries, T22, 3, { name: 4 })).r, 'job "test (22)"');
  });

  it('fewer entries than the workflow has steps plus the two bookends', () => {
    refused(verify(withSteps(entries, T22, (s) => [s[0], s[1], s[s.length - 1]])).r, 'job "test (22)"', 'steps');
    refused(verify(withSteps(entries, V, (s) => s.slice(0, 5).concat(s[s.length - 1]))).r, 'job "validate"');
    // exactly one short: one workflow step missing and no post steps
    refused(verify(withSteps(entries, T22, (s) => s.filter((_x, i) => i !== 4 && i !== 6 && i !== 7))).r, 'job "test (22)"');
  });

  it('a workflow whose LAST step is literally named "Complete job" cannot stand in for GitHub\'s own bookend', () => {
    const text = 'name: V\non:\n  pull_request:\njobs:\n  validate:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run x\n      - name: Complete job\n        run: echo done\n';
    const fixture = repoOf({ ...REAL_WORKFLOWS, [VALIDATE]: text });
    const mk = (change) => [change(H.hostedRun(101, VALIDATE, ['validate'], fixture.headSha, { workflow: text })), ...othersThan(fixture.headSha, VALIDATE)];
    // control: the real listing (Set up job, 2 workflow steps, Complete job) is accepted
    expect(verify(mk((e) => e), { fixture }).r.ok).toBe(true);
    // GitHub's bookend missing: the workflow's own last step now looks like the bookend, one entry short of n + 2
    const short = mk((e) => ({ run: e.run, jobs: e.jobs.map((j) => ({ ...j, steps: j.steps.slice(0, -1) })) }));
    refused(verify(short, { fixture }).r, 'job "validate"', 'steps');
  });

  it.each([
    ['missing', (s) => s.slice(1)],
    ['misnamed', (s) => { s[0].name = 'Setup job'; return s; }],
    ['not first by number', (s) => { s[0].number = 99; return s; }],
  ])('Set up job %s', (_n, change) => {
    refused(verify(withSteps(entries, T22, change)).r, 'job "test (22)"');
  });

  it.each([
    ['missing', (s) => s.slice(0, -1)],
    ['misnamed', (s) => { s[s.length - 1].name = 'Finish job'; return s; }],
    ['not last by number', (s) => { s[s.length - 1].number = 0; return s; }],
  ])('Complete job %s', (_n, change) => {
    refused(verify(withSteps(entries, T22, change)).r, 'job "test (22)"');
  });

  it('a non-Post entry in the post region', () => {
    refused(verify(setStep(entries, T22, 6, { name: 'Setup Node.js 22' })).r, 'job "test (22)"', 'Setup Node.js 22', 'Post');
    refused(verify(withSteps(entries, T22, (s) => { s.splice(7, 0, { number: 30, name: 'Extra work', status: 'completed', conclusion: 'success' }); return s; })).r, 'job "test (22)"', 'Extra work');
  });

  it('extra Post entries are fine (post steps are not mapped one to one)', () => {
    const extra = withSteps(entries, T22, (s) => { s[8].number = 20; s.splice(8, 0, { number: 14, name: 'Post Run something/else@v1', status: 'completed', conclusion: 'success' }); return s; });
    expect(verify(extra).r.ok).toBe(true);
  });

  it('duplicate step numbers', () => {
    refused(verify(setStep(entries, T22, 4, { number: 4 })).r, 'job "test (22)"', 'number');
  });

  it.each([
    ['a string', '3'],
    ['a fraction', 3.5],
    ['null', null],
    ['missing', undefined],
  ])('a step number that is %s', (_n, number) => {
    refused(verify(setStep(entries, T22, 2, { number })).r, 'job "test (22)"', 'number');
  });
});

describe('name sanity: a step list that cannot be the workflow\'s refuses', () => {
  it('a literal-named step must carry its name', () => {
    refused(verify(setStep(entries, V, 4, { name: 'Something else' })).r, 'job "validate"', 'step 4', '"Install dependencies"', 'Something else');
  });

  it('a named step with an expression in the name is not compared literally (evaluated name)', () => {
    expect(verify(setStep(entries, T22, 2, { name: 'Totally different' })).r.ok).toBe(true);
  });

  it('an unnamed uses: step must be named Run <uses>', () => {
    refused(verify(setStep(entries, 'drift', 1, { name: 'Run actions/checkout@v5' })).r, 'job "drift"', 'step 1', 'Run actions/checkout@v6');
    refused(verify(setStep(entries, T22, 1, { name: 'Checkout code' })).r, 'job "test (22)"', 'step 1');
  });

  it('an unnamed run: step must be named Run ...', () => {
    const text = 'name: V\non:\n  pull_request:\njobs:\n  validate:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n      - run: npm run validate\n';
    const fixture = repoOf({ ...REAL_WORKFLOWS, [VALIDATE]: text });
    const ok = [H.hostedRun(101, VALIDATE, [V], fixture.headSha, { workflow: text }), ...othersThan(fixture.headSha, VALIDATE)];
    expect(verify(ok, { fixture }).r.ok).toBe(true);
    const bad = withSteps(ok, V, (s) => { s[2].name = 'Lint'; return s; });
    refused(verify(bad, { fixture }).r, 'job "validate"', 'step 2', 'Lint');
  });
});

describe('the needs: closure is verified in the same run', () => {
  const triggers = 'on:\n  pull_request:\n';
  const job = (id, body = '', steps = '      - uses: actions/checkout@v6\n      - run: npm run x\n') => `  ${id}:\n    runs-on: ubuntu-latest\n${body}    steps:\n${steps}`;
  const workflow = (...jobs) => `name: V\n${triggers}jobs:\n${jobs.join('')}`;
  const alwaysValidate = workflow(job('build'), job('validate', '    needs: build\n    if: always()\n'));

  /** Honest entries with the VALIDATE run replaced by a run of `text` whose listing is `names` (steps derived from `text`). */
  function build(text, names, over = (e) => e) {
    const fixture = repoOf({ ...REAL_WORKFLOWS, [VALIDATE]: text });
    const run = over(H.hostedRun(101, VALIDATE, names, fixture.headSha, { workflow: text }));
    return { fixture, entries: [run, ...othersThan(fixture.headSha, VALIDATE)] };
  }

  it('R4: validate (if: always(), needs: build) green while build FAILED -> refused, naming build', () => {
    const { fixture, entries: es } = build(alwaysValidate, ['build', 'validate'], (e) => H.withJob(e, 'build', { conclusion: 'failure' }));
    refused(verify(es, { fixture }).r, 'job "build"', 'failure', 'validate');
  });

  it('build skipped -> refused', () => {
    const { fixture, entries: es } = build(alwaysValidate, ['build', 'validate'], (e) => H.withJob(e, 'build', { conclusion: 'skipped' }));
    refused(verify(es, { fixture }).r, 'job "build"', 'skipped');
  });

  it('build cancelled / not completed / null conclusion -> refused', () => {
    for (const over of [{ conclusion: 'cancelled' }, { status: 'in_progress', conclusion: null }, { conclusion: null }]) {
      const { fixture, entries: es } = build(alwaysValidate, ['build', 'validate'], (e) => H.withJob(e, 'build', over));
      refused(verify(es, { fixture }).r, 'job "build"');
    }
  });

  it('build missing from the listing -> refused', () => {
    const { fixture, entries: es } = build(alwaysValidate, ['validate']);
    refused(verify(es, { fixture }).r, 'job "build"', 'missing');
  });

  it('build present only in ANOTHER workflow run (other run id) does not count', () => {
    const { fixture, entries: es } = build(alwaysValidate, ['validate']);
    const withBuildElsewhere = H.swap(es, TEST, (e) => ({ run: e.run, jobs: [...e.jobs, { ...H.hostedRun(102, TEST, ['build'], fixture.headSha).jobs[0] }] }));
    refused(verify(withBuildElsewhere, { fixture }).r, 'job "build"', 'missing');
  });

  it('build listed in the run but belonging to another run or head -> refused', () => {
    const a = build(alwaysValidate, ['build', 'validate'], (e) => H.withJob(e, 'build', { run_id: 999 }));
    refused(verify(a.entries, { fixture: a.fixture }).r, 'job "build"');
    const b = build(alwaysValidate, ['build', 'validate'], (e) => H.withJob(e, 'build', { head_sha: 'c'.repeat(40) }));
    refused(verify(b.entries, { fixture: b.fixture }).r, 'job "build"');
  });

  it('build success -> accepted and reported with needed:true (required jobs are not marked)', () => {
    const { fixture, entries: es } = build(alwaysValidate, ['build', 'validate']);
    const { r } = verify(es, { fixture });
    expect(r.ok).toBe(true);
    const byName = Object.fromEntries(r.jobs.filter((j) => j.workflow === VALIDATE).map((j) => [j.name, j]));
    expect(byName.build).toEqual({ workflow: VALIDATE, event: 'pull_request', runId: 101, jobId: 10101, name: 'build', conclusion: 'success', needed: true });
    expect(byName.validate.needed).toBeUndefined();
    expect(r.jobs.filter((j) => j.needed)).toHaveLength(1);
  });

  it('transitive needs: validate -> mid -> base; a failed base refuses even though mid and validate are green', () => {
    const text = workflow(job('base'), job('mid', '    needs: base\n    if: always()\n'), job('validate', '    needs: [mid]\n    if: always()\n'));
    const ok = build(text, ['base', 'mid', 'validate']);
    const r = verify(ok.entries, { fixture: ok.fixture }).r;
    expect(r.ok).toBe(true);
    expect(r.jobs.filter((j) => j.needed).map((j) => j.name).sort()).toEqual(['base', 'mid']);
    const bad = build(text, ['base', 'mid', 'validate'], (e) => H.withJob(e, 'base', { conclusion: 'failure' }));
    refused(verify(bad.entries, { fixture: bad.fixture }).r, 'job "base"', 'failure');
    const missing = build(text, ['mid', 'validate']);
    refused(verify(missing.entries, { fixture: missing.fixture }).r, 'job "base"');
  });

  it('a needed job shared by two required matrix cells is verified once and listed once', () => {
    const text = `name: Test Plugins\n${triggers}jobs:\n${job('build')}  test:\n    runs-on: ubuntu-latest\n    needs: build\n    if: always()\n    strategy:\n      matrix:\n        node-version: [22, 24]\n    steps:\n      - uses: actions/checkout@v6\n      - run: npm test\n`;
    const fixture = repoOf({ ...REAL_WORKFLOWS, [TEST]: text });
    const mk = (over) => [over(H.hostedRun(102, TEST, ['build', 'test (22)', 'test (24)'], fixture.headSha, { workflow: text })), ...othersThan(fixture.headSha, TEST)];
    const r = verify(mk((e) => e), { fixture }).r;
    expect(r.ok).toBe(true);
    expect(r.jobs.filter((j) => j.name === 'build')).toHaveLength(1);
    refused(verify(mk((e) => H.withJob(e, 'build', { conclusion: 'failure' })), { fixture }).r, 'job "build"', 'failure');
  });

  it('a needed job that is already required is judged as a required job (steps and all), not as needed-only', () => {
    // validate needs lint, and lint is a required job of the same workflow in an extended config
    const text = workflow(job('lint'), job('validate', '    needs: lint\n'));
    const config = `${H.CONFIG}`.replace('  - file: .github/workflows/validate.yml\n    jobs:\n      - id: validate\n', '  - file: .github/workflows/validate.yml\n    jobs:\n      - id: validate\n      - id: lint\n');
    expect(config).not.toBe(H.CONFIG);
    const fixture = H.hostedRepo({ config, files: { ...REAL_WORKFLOWS, [VALIDATE]: text } });
    const set = H.approvalSetOf(config);
    const run = () => H.hostedRun(101, VALIDATE, ['lint', 'validate'], fixture.headSha, { workflow: text });
    const ghApi = H.actionsApi([run(), ...othersThan(fixture.headSha, VALIDATE)]);
    const ok = verifyHosted({ repo: REPO, headSha: fixture.headSha, baseSha: fixture.baseSha, repoRoot: fixture.dir, approvalSet: set, ...BIND }, { git, ghApi });
    expect(ok.ok).toBe(true);
    expect(ok.jobs.filter((j) => j.needed)).toEqual([]);
    const bad = H.actionsApi([setStep([run()], 'lint', 1, { conclusion: 'failure' })[0], ...othersThan(fixture.headSha, VALIDATE)]);
    refused(verifyHosted({ repo: REPO, headSha: fixture.headSha, baseSha: fixture.baseSha, repoRoot: fixture.dir, approvalSet: set, ...BIND }, { git, ghApi: bad }), 'job "lint"', 'step 1');
  });

  it.each([
    ['a matrix job', workflow(`  build:\n    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        os: [a, b]\n    steps:\n      - run: x\n`, job('validate', '    needs: build\n    if: always()\n')), 'build'],
    ['a custom-named job', workflow(`  build:\n    name: Build it\n    runs-on: ubuntu-latest\n    steps:\n      - run: x\n`, job('validate', '    needs: build\n    if: always()\n')), 'build'],
    ['a custom-named job with an expression', workflow(`  build:\n    name: Build \${{ github.run_id }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: x\n`, job('validate', '    needs: build\n')), 'build'],
    ['an undefined job', workflow(job('validate', '    needs: ghost\n    if: always()\n')), 'ghost'],
    ['a matrix job reached transitively', workflow(`  deep:\n    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        v: [1]\n    steps:\n      - run: x\n`, job('mid', '    needs: deep\n'), job('validate', '    needs: mid\n')), 'deep'],
  ])('%s is refused BEFORE GitHub is asked', (_n, text, who) => {
    const fixture = repoOf({ ...REAL_WORKFLOWS, [VALIDATE]: text });
    const { r, ghApi } = verify(H.honest(fixture.headSha), { fixture });
    refused(r, `job "${who}"`);
    expect(ghApi.calls).toEqual([]);
  });

  it('a needed job of the same workflow in a push run is checked in that run too', () => {
    const { fixture, entries: es } = build(alwaysValidate, ['build', 'validate']);
    const push = H.hostedRun(111, VALIDATE, ['build', 'validate'], fixture.headSha, { run: { event: 'push' }, workflow: alwaysValidate });
    const good = verify([...es, push], { fixture }).r;
    expect(good.ok).toBe(true);
    expect(good.jobs.filter((j) => j.needed).map((j) => `${j.event}:${j.name}`).sort()).toEqual(['pull_request:build', 'push:build']);
    const badPush = H.withJob(push, 'build', { conclusion: 'failure' });
    refused(verify([...es, badPush], { fixture }).r, 'job "build"', 'failure');
  });

  it('step conclusions are not demanded of a needed-only job, but its own conclusion is', () => {
    const { fixture, entries: es } = build(alwaysValidate, ['build', 'validate'], (e) => ({ run: e.run, jobs: e.jobs.map((j) => (j.name === 'build' ? { ...j, steps: [] } : j)) }));
    expect(verify(es, { fixture }).r.ok).toBe(true);
  });
});
