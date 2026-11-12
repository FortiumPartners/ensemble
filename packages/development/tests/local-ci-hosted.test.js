'use strict';

/**
 * verifyHosted (fwj0): may the jobs hosted CI already ran on the PR's head stand in for the local clean-clone run?
 *
 * Real temp git repos (a base commit carrying the workflow files, a head commit) and a fake GitHub Actions API. Every
 * test changes ONE thing about an otherwise honest answer and asserts a refusal whose reason names that cause, so
 * removing a guard in local-ci-hosted.js fails the test that pins it. Nothing here posts, runs or reaches the network.
 */

const yaml = require('js-yaml');

const { verifyHosted, expectedJobName } = require('../lib/local-ci-hosted');
const { cleanupBaseRepos } = require('./helpers/local-ci-base-repo');
const {
  VALIDATE,
  TEST,
  DRIFT,
  WORKFLOW_FILES,
  APPROVAL_SET,
  VERIFIED,
  REPO,
  hostedRepo,
  approvalSetOf,
  hostedRun,
  honest,
  swap,
  withRun,
  withJob,
  withoutJob,
  actionsApi,
  memoGit,
} = require('./helpers/local-ci-hosted');

afterAll(cleanupBaseRepos);

const OTHER = 'c'.repeat(40);
const git = memoGit();

const fx = hostedRepo(); // base: config + the three workflows; head: adds head.txt only
const HEAD = fx.headSha;
const where = (fixture) => ({ headSha: fixture.headSha, baseSha: fixture.baseSha, repoRoot: fixture.dir });

/** Verify against a fake GitHub answering with `entries`. `over` replaces input fields, `api` configures the fake, `deps` replaces dependencies. */
function verify(entries, { fixture = fx, over = {}, api, deps = {} } = {}) {
  const ghApi = actionsApi(entries, api);
  const r = verifyHosted({ repo: REPO, ...where(fixture), ...BIND, approvalSet: APPROVAL_SET, ...over }, { git, ghApi, ...deps });
  return { r, ghApi };
}

/** The pull request the fake runs belong to (what every honest run lists in `pull_requests`) and its base branch. */
const { PR, BASE_BRANCH } = require('./helpers/local-ci-base-repo');
const BIND = { pr: PR, baseRefName: BASE_BRANCH };

/** A refusal in the documented shape whose reason names every given cause. */
function refused(r, ...causes) {
  expect(r.ok).toBe(false);
  expect(r.source).toBe('hosted');
  expect(r.reason).toMatch(/^hosted CI not accepted: /);
  for (const cause of causes) expect(r.reason).toContain(cause);
  return r;
}

const jobsOf = (r, file) => r.jobs.filter((j) => j.workflow === file);

describe('expectedJobName: the name GitHub gives a job', () => {
  it.each([
    ['its id when it has no custom name and no matrix', { 'runs-on': 'x' }, 'validate', {}, 'validate'],
    ['its id when the job definition is missing', undefined, 'validate', {}, 'validate'],
    ['its id when there is no matrix at all', { 'runs-on': 'x' }, 'validate', undefined, 'validate'],
    ['`<id> (<value>)` for a one-key matrix', {}, 'test', { 'node-version': 22 }, 'test (22)'],
    ['`<id> (<values>)` in the matrix key order', {}, 'build', { os: 'ubuntu-latest', node: 22 }, 'build (ubuntu-latest, 22)'],
    ['a plain literal custom name', { name: 'Lint Code' }, 'lint', {}, 'Lint Code'],
  ])('is %s', (_n, jobDef, id, matrix, expected) => {
    expect(expectedJobName(jobDef, id, matrix)).toBe(expected);
  });

  it.each([
    ['a custom name containing an expression', { name: 'Build ${{ matrix.os }}' }, 'build', {}],
    ['a literal custom name decorated by a matrix', { name: 'Unit' }, 'unit', { node: 22 }],
    ['a custom name that is not text', { name: 5 }, 'x', {}],
    ['a custom name that is empty YAML', { name: null }, 'x', {}],
  ])('cannot be derived (null) for %s', (_n, jobDef, id, matrix) => {
    expect(expectedJobName(jobDef, id, matrix)).toBeNull();
  });
});

describe('verifyHosted accepts hosted CI that is green on exactly this head', () => {
  it('validate + test (22) + test (24) + the extra drift job, green on the head, workflow blobs identical at head and base', () => {
    // the fixture is what it claims to be: a head that is not the base, and untouched workflow files
    expect(fx.headSha).not.toBe(fx.baseSha);
    for (const file of [VALIDATE, TEST, DRIFT]) {
      expect(fx.git('rev-parse', `${fx.headSha}:${file}`)).toBe(fx.git('rev-parse', `${fx.baseSha}:${file}`));
    }
    const { r } = verify(honest(HEAD));
    expect(r).toEqual({ ok: true, source: 'hosted', headSha: HEAD, jobs: VERIFIED });
  });

  it('asks GitHub only for the Actions runs of this head and the latest-attempt jobs of the runs it uses', () => {
    const { r, ghApi } = verify(honest(HEAD));
    expect(r.ok).toBe(true);
    expect(ghApi.calls).toEqual([
      `repos/${REPO}/actions/runs?head_sha=${HEAD}&per_page=100`,
      `repos/${REPO}/actions/runs/101/jobs?filter=latest&per_page=100`,
      `repos/${REPO}/actions/runs/102/jobs?filter=latest&per_page=100`,
      `repos/${REPO}/actions/runs/103/jobs?filter=latest&per_page=100`,
    ]);
    // not the checks API and not commit statuses: a status is postable by anyone with write access
    expect(ghApi.calls.every((c) => c.startsWith(`repos/${REPO}/actions/runs`))).toBe(true);
  });

  it('a green push run next to the green pull_request run is verified as well, and reported', () => {
    const push = hostedRun(111, TEST, ['test (22)', 'test (24)'], HEAD, { run: { event: 'push' } });
    const { r } = verify([...honest(HEAD), push]);
    expect(r.ok).toBe(true);
    expect(jobsOf(r, TEST).map((j) => `${j.event}:${j.runId}:${j.name}`)).toEqual([
      'pull_request:102:test (22)',
      'pull_request:102:test (24)',
      'push:111:test (22)',
      'push:111:test (24)',
    ]);
  });

  it('only the required jobs are judged: a red job the config does not name is ignored', () => {
    const extra = withJob(hostedRun(102, TEST, ['test (22)', 'test (24)', 'lint'], HEAD), 'lint', { conclusion: 'failure' });
    const { r } = verify(swap(honest(HEAD), TEST, () => extra));
    expect(r.ok).toBe(true);
    expect(r.jobs.map((j) => j.name)).not.toContain('lint');
  });

  it('head SHAs are the same commit whatever their letter case', () => {
    const { r } = verify(honest(HEAD.toUpperCase()));
    expect(r.ok).toBe(true);
  });

  it('a head that edits a workflow the config does not name (or adds one) is still accepted', () => {
    const other = '.github/workflows/release.yml';
    const unrelated = hostedRepo({
      files: { [other]: 'name: release\non: push\njobs: {}\n' },
      headFiles: { [other]: 'name: release\non: push\njobs:\n  x: {}\n', '.github/workflows/new.yml': 'name: new\non: push\njobs: {}\n' },
    });
    expect(unrelated.git('rev-parse', `${unrelated.headSha}:${other}`)).not.toBe(unrelated.git('rev-parse', `${unrelated.baseSha}:${other}`));
    const { r } = verify(honest(unrelated.headSha), { fixture: unrelated });
    expect(r.ok).toBe(true);
  });
});

describe('a result for another commit is never accepted', () => {
  it.each([
    ['another commit', OTHER],
    ['the head abbreviated', HEAD.slice(0, 12)],
    ['missing', undefined],
    ['empty', ''],
  ])('a validate run whose head_sha is %s is not a run of this head, whatever its jobs say', (_n, headSha) => {
    // the jobs claim the right head: only the RUN's own head_sha can tell this run apart
    const entries = swap(honest(HEAD), VALIDATE, () => hostedRun(101, VALIDATE, ['validate'], headSha, { job: { head_sha: HEAD } }));
    const { r } = verify(entries);
    refused(r, `no pull_request run of ${VALIDATE} exists for ${HEAD}`);
    expect(r.pending).toBe(true);
  });

  it('a newer run on another head neither replaces nor hides the head\'s own green run', () => {
    const newerElsewhere = hostedRun(201, VALIDATE, ['validate'], OTHER, { job: { conclusion: 'failure' } });
    const { r } = verify([...honest(HEAD), newerElsewhere]);
    expect(r.ok).toBe(true);
    expect(jobsOf(r, VALIDATE).map((j) => j.runId)).toEqual([101]);
  });

  it.each([
    ['another commit', OTHER],
    ['the head abbreviated', HEAD.slice(0, 12)],
    ['missing', undefined],
  ])('a job whose head_sha is %s is refused even inside this head\'s own completed run', (_n, headSha) => {
    const entries = swap(honest(HEAD), TEST, (e) => withJob(e, 'test (24)', { head_sha: headSha }));
    const r = refused(verify(entries).r, `job "test (24)" of run 102 is not on head ${HEAD}`);
    expect(r.pending).toBeUndefined();
  });

  it('a job that belongs to another run is refused', () => {
    const entries = swap(honest(HEAD), TEST, (e) => withJob(e, 'test (22)', { run_id: 999 }));
    refused(verify(entries).r, `job "test (22)" of run 102 is not on head ${HEAD}`);
  });
});

describe('a required job that did not succeed refuses', () => {
  it.each(['failure', 'cancelled', 'skipped', 'timed_out', 'neutral', 'action_required', 'stale', 'startup_failure', null])(
    'a required job that concluded %s names the job and the conclusion, and is final rather than pending',
    (conclusion) => {
      const entries = swap(honest(HEAD), TEST, (e) => withJob(e, 'test (24)', { conclusion }));
      const r = refused(verify(entries).r, `job "test (24)" of run 102 concluded ${conclusion}, not success`);
      expect(r.pending).toBeUndefined();
    }
  );

  it.each([
    ['validate', VALIDATE],
    ['test (22)', TEST],
    ['test (24)', TEST],
    ['drift', DRIFT],
  ])('a red %s refuses even when every other required job is green', (name, file) => {
    const entries = swap(honest(HEAD), file, (e) => withJob(e, name, { conclusion: 'failure' }));
    refused(verify(entries).r, `job "${name}" of run`, 'concluded failure, not success');
  });
});

describe('a required job that is absent refuses', () => {
  it.each([
    ['validate', VALIDATE],
    ['test (22)', TEST],
    ['test (24)', TEST],
    ['drift', DRIFT],
  ])('%s missing from an otherwise complete green run names the job and the run', (name, file) => {
    const entries = swap(honest(HEAD), file, (e) => withoutJob(e, name));
    refused(verify(entries).r, `required job "${name}" is missing from the latest pull_request run of ${file}`);
  });

  it.each(['Test (24)', 'test(24)', 'test (24) ', 'test (24', 'test'])('a job named %j is not the job test (24)', (near) => {
    const entries = swap(honest(HEAD), TEST, (e) => ({ run: e.run, jobs: e.jobs.map((j) => (j.name === 'test (24)' ? { ...j, name: near } : j)) }));
    refused(verify(entries).r, 'required job "test (24)" is missing');
  });

  it('a job of the right name in ANOTHER workflow\'s run does not count', () => {
    const stray = hostedRun(102, TEST, ['test (22)', 'test (24)', 'validate'], HEAD);
    const entries = swap(swap(honest(HEAD), VALIDATE, (e) => withoutJob(e, 'validate')), TEST, () => stray);
    refused(verify(entries).r, `required job "validate" is missing from the latest pull_request run of ${VALIDATE}`);
  });

  it('a run that has no jobs at all refuses', () => {
    const entries = swap(honest(HEAD), VALIDATE, () => hostedRun(101, VALIDATE, [], HEAD));
    refused(verify(entries).r, 'required job "validate" is missing');
  });
});

describe('anything still running refuses and says it is pending', () => {
  it.each(['queued', 'in_progress', 'waiting', 'requested', 'pending'])('a %s run is refused without reading its jobs', (status) => {
    const entries = swap(honest(HEAD), TEST, (e) => withRun(e, { status, conclusion: null }));
    const { r, ghApi } = verify(entries);
    refused(r, `the latest pull_request run of ${TEST} (102) is ${status}, not completed`);
    expect(r.pending).toBe(true);
    expect(ghApi.calls.some((c) => c.includes('/runs/102/jobs'))).toBe(false);
  });

  it.each(['queued', 'in_progress', 'waiting', 'pending'])('a required job still %s inside a completed run is refused', (status) => {
    const entries = swap(honest(HEAD), TEST, (e) => withJob(e, 'test (24)', { status, conclusion: null }));
    const r = refused(verify(entries).r, `job "test (24)" of run 102 is ${status}, not completed`);
    expect(r.pending).toBe(true);
  });
});

describe('a pull_request run is required', () => {
  it('a green push run alone does not stand in for the missing pull_request run', () => {
    const entries = swap(honest(HEAD), VALIDATE, (e) => withRun(e, { event: 'push' }));
    const r = refused(verify(entries).r, `no pull_request run of ${VALIDATE} exists for ${HEAD}`);
    expect(r.pending).toBe(true);
  });

  it('no run at all for the head refuses, naming the first workflow', () => {
    const r = refused(verify([]).r, `no pull_request run of ${VALIDATE} exists for ${HEAD}`);
    expect(r.pending).toBe(true);
  });

  it.each(['pull_request_target', 'workflow_dispatch', 'schedule', 'workflow_run', 'release'])('a green %s run is not a pull_request run', (event) => {
    const entries = swap(honest(HEAD), VALIDATE, (e) => withRun(e, { event }));
    refused(verify(entries).r, `no pull_request run of ${VALIDATE} exists for ${HEAD}`);
  });

  it('every required workflow needs its own pull_request run: the extra drift workflow too', () => {
    const entries = honest(HEAD).filter((e) => e.run.path !== DRIFT);
    const r = refused(verify(entries).r, `no pull_request run of ${DRIFT} exists for ${HEAD}`);
    expect(r.pending).toBe(true);
  });
});

describe('the workflow files must be the base ref\'s: hosted CI runs the HEAD\'s workflow', () => {
  const trivial = (text) => text.replace('npm run validate', 'true');

  it('the head rewrites validate.yml so `validate` is trivial: hosted is green, yet refused, and GitHub is never asked', () => {
    const forged = hostedRepo({ headFiles: { [VALIDATE]: trivial(WORKFLOW_FILES[VALIDATE]) } });
    expect(forged.git('show', `${forged.headSha}:${VALIDATE}`)).toContain('run: true');
    const { r, ghApi } = verify(honest(forged.headSha), { fixture: forged });
    refused(r, `${VALIDATE} at the PR head differs from the base ref`);
    expect(ghApi.calls).toEqual([]);
    // the same green answer for a head that left the workflow alone is accepted: only the file made the difference
    expect(verify(honest(HEAD)).r.ok).toBe(true);
  });

  it('the comparison is byte-exact: a comment added to test.yml is enough to refuse', () => {
    const commented = hostedRepo({ headFiles: { [TEST]: `${WORKFLOW_FILES[TEST]}# harmless\n` } });
    refused(verify(honest(commented.headSha), { fixture: commented }).r, `${TEST} at the PR head differs from the base ref`);
  });

  it('a head that deletes a required workflow is refused (the file is missing there)', () => {
    const deleted = hostedRepo({ headFiles: { [TEST]: null } });
    refused(verify(honest(deleted.headSha), { fixture: deleted }).r, `${TEST} at the PR head differs from the base ref (or is missing)`);
  });

  it('an edit to the extra workflow (drift) refuses as well', () => {
    const edited = hostedRepo({ headFiles: { [DRIFT]: WORKFLOW_FILES[DRIFT].replace('npm run generate', 'true') } });
    refused(verify(honest(edited.headSha), { fixture: edited }).r, `${DRIFT} at the PR head differs from the base ref`);
  });

  it('a workflow the base does not have is refused, even when the head adds it and hosted CI is green', () => {
    const added = hostedRepo({ files: { [DRIFT]: null }, headFiles: { [DRIFT]: WORKFLOW_FILES[DRIFT] } });
    expect(added.git('show', `${added.headSha}:${DRIFT}`)).toContain('drift:');
    const { r, ghApi } = verify(honest(added.headSha), { fixture: added });
    refused(r, `${DRIFT} does not exist at the base ref`);
    expect(ghApi.calls).toEqual([]);
  });
});

describe('job names come from the base ref\'s workflow and config, never from a guess', () => {
  const job = (extra = {}) => ({ 'runs-on': 'ubuntu-latest', steps: [{ run: 'true' }], ...extra });
  const wf = (jobs) => yaml.dump({ name: 'wf', on: 'pull_request', jobs });
  const FILES = {
    literal: '.github/workflows/literal.yml',
    expression: '.github/workflows/expression.yml',
    matrixNamed: '.github/workflows/matrix-named.yml',
    multi: '.github/workflows/multi.yml',
    buildOnly: '.github/workflows/build-only.yml',
    shifted: '.github/workflows/shifted.yml',
    broken: '.github/workflows/broken.yml',
    noJobs: '.github/workflows/no-jobs.yml',
  };
  const TEXTS = {
      [FILES.literal]: wf({ lint: job({ name: 'Lint Code' }) }),
      [FILES.expression]: wf({ build: job({ name: 'Build ${{ matrix.os }}', strategy: { matrix: { os: ['ubuntu-latest'] } } }) }),
      [FILES.matrixNamed]: wf({ unit: job({ name: 'Unit', strategy: { matrix: { 'node-version': [22] } } }) }),
      [FILES.multi]: wf({ build: job({ strategy: { matrix: { os: ['ubuntu-latest'], node: [22] } } }) }),
      [FILES.buildOnly]: wf({ build: job() }),
      [FILES.shifted]: wf({ test: job({ strategy: { matrix: { 'node-version': [20, 22] } } }) }),
      [FILES.broken]: 'jobs: [\n',
      [FILES.noJobs]: yaml.dump({ name: 'wf', on: 'push' }),
  };
  const names = hostedRepo({ files: TEXTS });
  // the steps[] of a hosted job come from ITS workflow's definition
  const run = (id, file, jobNames, head, o = {}) => hostedRun(id, file, jobNames, head, { workflow: TEXTS[file], ...o });
  const approvalFor = (file, id, matrix) =>
    approvalSetOf({
      workflows: [{ file, jobs: [{ id, ...(matrix ? { matrix } : {}) }] }],
      steps: [{ name: 's', cmd: 'true' }],
      status_context: 'x/local-ci',
      hosted_reuse: { covers: ['s'] },
    });
  const check = (entries, approvalSet) => verify(entries, { fixture: names, over: { approvalSet } });
  const HEAD2 = names.headSha;

  it('a plain literal custom name is the name hosted CI must report (and the job id then is not)', () => {
    const set = approvalFor(FILES.literal, 'lint');
    expect(check([run(301, FILES.literal, ['Lint Code'], HEAD2)], set).r.ok).toBe(true);
    refused(check([run(301, FILES.literal, ['lint'], HEAD2)], set).r, 'required job "Lint Code" is missing');
  });

  it('a custom name with an expression cannot be derived: refused before GitHub is asked', () => {
    const { r, ghApi } = check([run(301, FILES.expression, ['Build ubuntu-latest'], HEAD2)], approvalFor(FILES.expression, 'build', { os: ['ubuntu-latest'] }));
    refused(r, `cannot derive the hosted job name of "build" in ${FILES.expression}`);
    expect(ghApi.calls).toEqual([]);
  });

  it('a custom name together with a matrix cannot be derived either', () => {
    const { r, ghApi } = check([run(301, FILES.matrixNamed, ['Unit'], HEAD2)], approvalFor(FILES.matrixNamed, 'unit', { 'node-version': [22] }));
    refused(r, `cannot derive the hosted job name of "unit" in ${FILES.matrixNamed}`);
    expect(ghApi.calls).toEqual([]);
  });

  it('a job id the base workflow does not define is refused, even if hosted CI reports a job of that name', () => {
    const { r, ghApi } = check([run(301, FILES.buildOnly, ['lint'], HEAD2)], approvalFor(FILES.buildOnly, 'lint'));
    refused(r, `job "lint" is not defined in ${FILES.buildOnly} at the base ref`);
    expect(ghApi.calls).toEqual([]);
  });

  it('the matrix values give the name, in the config\'s key order: build (ubuntu-latest, 22)', () => {
    const set = approvalFor(FILES.multi, 'build', { os: ['ubuntu-latest'], node: [22] });
    expect(check([run(301, FILES.multi, ['build (ubuntu-latest, 22)'], HEAD2)], set).r.ok).toBe(true);
    refused(check([run(301, FILES.multi, ['build'], HEAD2)], set).r, 'required job "build (ubuntu-latest, 22)" is missing');
  });

  it('a config matrix that differs from the base workflow\'s names jobs hosted CI never ran: test (24) is missing', () => {
    // the base workflow runs Node 20 and 22; the config (and so the required names) say 22 and 24
    const hostedJobs = ['test (20)', 'test (22)'];
    const r = check([run(301, FILES.shifted, hostedJobs, HEAD2)], approvalSetOf({
      workflows: [{ file: FILES.shifted, jobs: [{ id: 'test', matrix: { 'node-version': [22, 24] } }] }],
      steps: [{ name: 's', cmd: 'true' }],
      status_context: 'x/local-ci',
      hosted_reuse: { covers: ['s'] },
    })).r;
    refused(r, 'required job "test (24)" is missing');
  });

  it.each([
    ['not valid YAML', FILES.broken, 'is not valid YAML'],
    ['without a jobs mapping', FILES.noJobs, 'has no jobs'],
  ])('a base workflow %s is refused: nothing can be derived from it', (_n, file, cause) => {
    const { r, ghApi } = check([hostedRun(301, file, ['x'], HEAD2)], approvalFor(file, 'x'));
    refused(r, `${file} at the base ref ${cause}`);
    expect(ghApi.calls).toEqual([]);
  });
});

describe('only the latest run per workflow and event counts', () => {
  const others = [hostedRun(101, VALIDATE, ['validate'], HEAD), hostedRun(103, DRIFT, ['drift'], HEAD)];
  const older = (over) => hostedRun(102, TEST, ['test (22)', 'test (24)'], HEAD, over);
  const newer = (over) => hostedRun(112, TEST, ['test (22)', 'test (24)'], HEAD, over);
  const red = (entry) => withJob(entry, 'test (24)', { conclusion: 'failure' });
  const both = (a, b, newerFirst) => [...others, ...(newerFirst ? [b, a] : [a, b])];

  it.each([
    ['older first', false],
    ['newer first', true],
  ])('an older green run followed by a newer red one refuses, whatever the list order (%s)', (_n, newerFirst) => {
    const r = refused(verify(both(older(), red(newer()), newerFirst)).r, 'job "test (24)" of run 112 concluded failure, not success');
    expect(r.pending).toBeUndefined();
  });

  it.each([
    ['older first', false],
    ['newer first', true],
  ])('an older red run followed by a newer green one is accepted, and the newer run is the one reported (%s)', (_n, newerFirst) => {
    const { r } = verify(both(red(older()), newer(), newerFirst));
    expect(r.ok).toBe(true);
    expect(jobsOf(r, TEST).map((j) => j.runId)).toEqual([112, 112]);
  });

  it('a newest run that is still running refuses even though an older run is green', () => {
    const r = refused(verify(both(older(), withRun(newer(), { status: 'in_progress', conclusion: null }), false)).r, `the latest pull_request run of ${TEST} (112) is in_progress, not completed`);
    expect(r.pending).toBe(true);
  });

  it('an older run that never finished is ignored once a newer one completed green', () => {
    const { r } = verify(both(withRun(older(), { status: 'in_progress', conclusion: null }), newer(), false));
    expect(r.ok).toBe(true);
  });

  describe('push and pull_request are judged separately', () => {
    const push = (id, over) => hostedRun(id, TEST, ['test (22)', 'test (24)'], HEAD, { run: { event: 'push', ...over } });

    it('a red push run refuses even though the pull_request run is green', () => {
      const r = refused(verify([...honest(HEAD), red(push(111))]).r, 'job "test (24)" of run 111 concluded failure, not success');
      expect(r.pending).toBeUndefined();
    });

    it('a push run still running refuses (pending) although the pull_request run is green', () => {
      const r = refused(verify([...honest(HEAD), push(111, { status: 'queued', conclusion: null })]).r, `the latest push run of ${TEST} (111) is queued, not completed`);
      expect(r.pending).toBe(true);
    });

    it('only the latest push run counts: an older red push run is replaced by a newer green one, and vice versa', () => {
      expect(verify([...honest(HEAD), red(push(111)), push(121)]).r.ok).toBe(true);
      refused(verify([...honest(HEAD), push(111), red(push(121))]).r, 'job "test (24)" of run 121 concluded failure');
    });
  });
});

describe('a run counts only for the workflow path the config names', () => {
  it('a green run of ANOTHER workflow file with a job named validate does not stand in for validate.yml', () => {
    // validate.yml\'s own run is red; a newer run of a different file (one a head could add) is green and has a `validate` job
    const evil = hostedRun(201, '.github/workflows/evil.yml', ['validate'], HEAD);
    const entries = [...swap(honest(HEAD), VALIDATE, (e) => withJob(e, 'validate', { conclusion: 'failure' })), evil];
    refused(verify(entries).r, 'job "validate" of run 101 concluded failure, not success');
  });

  it('and it cannot make a missing validate.yml run appear', () => {
    const evil = hostedRun(201, '.github/workflows/evil.yml', ['validate'], HEAD);
    const entries = [...honest(HEAD).filter((e) => e.run.path !== VALIDATE), evil];
    refused(verify(entries).r, `no pull_request run of ${VALIDATE} exists for ${HEAD}`);
  });

  it.each(['validate.yml', '.github/workflows/Validate.yml', '.github/workflows/validate.yaml', ''])('a run whose path is %j is not a run of the configured validate.yml', (runPath) => {
    const entries = swap(honest(HEAD), VALIDATE, () => hostedRun(101, VALIDATE, ['validate'], HEAD, { run: { path: runPath } }));
    refused(verify(entries).r, `no pull_request run of ${VALIDATE} exists for ${HEAD}`);
  });
});

describe('a truncated listing is refused, not guessed', () => {
  it('more runs exist than were read: refused although everything that was read is green', () => {
    const { r } = verify(honest(HEAD), { api: { runsTotal: 4 } });
    refused(r, `4 workflow runs exist for ${HEAD}`, 'more than the 3 read');
  });

  it('more jobs exist in a run than were read: refused although everything that was read is green', () => {
    const { r } = verify(honest(HEAD), { api: { jobsTotal: { 102: 3 } } });
    refused(r, 'run 102 has 3 jobs', 'more than the 2 read');
  });

  it('control: a total_count equal to what was read is a complete listing', () => {
    expect(verify(honest(HEAD), { api: { runsTotal: 3, jobsTotal: { 101: 1, 102: 2, 103: 1 } } }).r.ok).toBe(true);
  });
});

describe('a lookup that fails or answers nonsense is a refusal', () => {
  const MALFORMED = [undefined, null, 'ok', 5, { ok: true }, { ok: true, json: null }, { ok: true, json: [] }, { ok: false }];

  it('the runs lookup failing names the head and the error', () => {
    const { r } = verify(honest(HEAD), { api: { answer: () => ({ ok: false, error: 'gh api failed: HTTP 502' }) } });
    refused(r, `cannot read workflow runs for ${HEAD}: gh api failed: HTTP 502`);
  });

  it.each(MALFORMED.map((answer) => [JSON.stringify(answer), answer]))('a runs answer of %s is refused', (_n, bad) => {
    const { r } = verify(honest(HEAD), { api: { answer: () => bad } });
    refused(r, `cannot read workflow runs for ${HEAD}`);
  });

  it('a runs answer whose workflow_runs is not a list is refused', () => {
    const { r } = verify(honest(HEAD), { api: { answer: () => ({ ok: true, json: { workflow_runs: {} } }) } });
    refused(r, `cannot read workflow runs for ${HEAD}`);
  });

  it('an ok:false runs answer is a refusal even when it carries a body that looks complete', () => {
    const body = { total_count: 3, workflow_runs: honest(HEAD).map((e) => e.run) };
    const { r } = verify(honest(HEAD), { api: { answer: () => ({ ok: false, error: 'gh api failed: HTTP 500', json: body }) } });
    refused(r, `cannot read workflow runs for ${HEAD}: gh api failed: HTTP 500`);
  });

  it('the jobs lookup failing names the run and the error', () => {
    const { r } = verify(honest(HEAD), { api: { answer: (p, proceed) => (p.includes('/runs/101/jobs') ? { ok: false, error: 'gh api failed: HTTP 404' } : proceed()) } });
    refused(r, 'cannot read the jobs of run 101: gh api failed: HTTP 404');
  });

  it('an ok:false jobs answer is a refusal even when it carries a body that looks complete', () => {
    const { r } = verify(honest(HEAD), { api: { answer: (p, proceed) => (p.includes('/runs/101/jobs') ? { ...proceed(), ok: false, error: 'gh api failed: HTTP 500' } : proceed()) } });
    refused(r, 'cannot read the jobs of run 101: gh api failed: HTTP 500');
  });

  it('entries in the runs and jobs lists that are not objects are skipped: neither trusted nor fatal', () => {
    const junk = [null, 'run', 7, [], undefined];
    const answer = (p, proceed) => {
      const real = proceed();
      return p.includes('?head_sha=')
        ? { ...real, json: { ...real.json, workflow_runs: [...junk, ...real.json.workflow_runs] } }
        : { ...real, json: { ...real.json, jobs: [...junk, ...real.json.jobs] } };
    };
    const { r } = verify(honest(HEAD), { api: { answer } });
    expect(r).toEqual({ ok: true, source: 'hosted', headSha: HEAD, jobs: VERIFIED });
  });

  it.each([...MALFORMED, { ok: true, json: { jobs: 'x' } }].map((answer) => [JSON.stringify(answer), answer]))('a jobs answer of %s is refused', (_n, bad) => {
    const { r } = verify(honest(HEAD), { api: { answer: (p, proceed) => (p.includes('/jobs') ? bad : proceed()) } });
    refused(r, 'cannot read the jobs of run 101');
  });

  it.each([
    ['is missing', undefined],
    ['is not a function', 'gh'],
  ])('a lookup dependency that %s is refused: there is no "no answer, so fine"', (_n, ghApi) => {
    const { r } = verify(honest(HEAD), { deps: { ghApi } });
    refused(r, 'no GitHub lookup is available');
  });

  it('without a resolvable js-yaml the base workflow cannot be read: refused, never guessed', () => {
    try {
      jest.isolateModules(() => {
        jest.doMock('js-yaml', () => {
          throw new Error("Cannot find module 'js-yaml'");
        });
        const isolated = require('../lib/local-ci-hosted');
        const ghApi = actionsApi(honest(HEAD));
        const r = isolated.verifyHosted({ repo: REPO, ...where(fx), ...BIND, approvalSet: APPROVAL_SET }, { git, ghApi });
        refused(r, 'js-yaml is not resolvable, so the base workflow cannot be read');
        expect(ghApi.calls).toEqual([]);
      });
    } finally {
      jest.dontMock('js-yaml');
    }
  });
});

describe('the opt-in comes only from the base config, and only well-formed commits reach GitHub', () => {
  it.each([[{ hostedReuse: null }], [{}], [undefined], [null]])('an approval set without hosted_reuse (%j) is disabled: neither git nor GitHub is touched', (approvalSet) => {
    const gitSpy = jest.fn();
    const ghApi = jest.fn();
    const r = verifyHosted({ repo: REPO, ...where(fx), ...BIND, approvalSet }, { git: gitSpy, ghApi });
    expect(r).toMatchObject({ ok: false, source: 'hosted', disabled: true });
    expect(r.reason).toBe('hosted CI not accepted: hosted_reuse is not enabled in the base-ref config');
    expect(gitSpy).not.toHaveBeenCalled();
    expect(ghApi).not.toHaveBeenCalled();
  });

  it('every other refusal is NOT flagged disabled (only a missing opt-in is)', () => {
    const { r } = verify([]);
    expect(r.disabled).toBeUndefined();
  });

  it.each([
    ['an abbreviated head', { headSha: HEAD.slice(0, 12) }],
    ['a head with a query string smuggled in', { headSha: `${HEAD.slice(0, 30)}&per_page=1` }],
    ['a head one character too long', { headSha: `${HEAD}a` }],
    ['a head that is not hex', { headSha: 'z'.repeat(40) }],
    ['no head', { headSha: undefined }],
    ['an abbreviated base', { baseSha: fx.baseSha.slice(0, 12) }],
    ['a ref name instead of a base commit', { baseSha: 'origin/main' }],
    ['no base', { baseSha: undefined }],
  ])('%s is refused before any lookup', (_n, over) => {
    const { r, ghApi } = verify(honest(HEAD), { over });
    refused(r, 'head or base is not a full commit SHA');
    expect(ghApi.calls).toEqual([]);
  });

  it.each([
    ['an omitted repo', undefined],
    ['an empty repo', ''],
    ['a repo without an owner', 'ensemble'],
    ['a repo with a path smuggled in', 'o/r/../../x'],
    ['a repo with a query string', 'o/r?x=1'],
  ])('%s never becomes a GitHub API path', (_n, repo) => {
    const { r, ghApi } = verify(honest(HEAD), { over: { repo } });
    refused(r, 'repo is not owner/name');
    expect(ghApi.calls).toEqual([]);
  });

  it('an approval set that names no hosted job is refused, never vacuously accepted', () => {
    const { r } = verify(honest(HEAD), { over: { approvalSet: { hostedReuse: { covers: ['x'], checks: [] } } } });
    refused(r, 'the base config names no hosted jobs');
  });
});
