/**
 * issue-run-index-cli.js and run-index-cli.js: the real CLIs, spawned, against a scratch project.
 *
 * The skills checkpoint through these CLIs, so what they promise is tested end to end:
 * create -> find-active -> mutate (patch ops) -> REVISION_CONFLICT on a stale revision ->
 * complete / abandon, the single-active-run lock, hostile paths, unknown ops and the exit-code
 * rule. Scratch dirs go under RUN_INDEX_TEST_TMP (default: the OS temp dir).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const LIB = path.join(__dirname, '../lib');
const ISSUE_CLI = path.join(LIB, 'issue-run-index-cli.js');
const FEATURE_CLI = path.join(LIB, 'run-index-cli.js');
const SCRATCH_ROOT = process.env.RUN_INDEX_TEST_TMP || os.tmpdir();

/** Spawn a CLI: -> { status, out } where out is the one JSON object on stdout. */
function call(cli, subcommand, payload, { stdin } = {}) {
  const res = spawnSync('node', [cli, subcommand], {
    input: stdin !== undefined ? stdin : JSON.stringify(payload),
    encoding: 'utf8',
    cwd: SCRATCH_ROOT,
  });
  expect(res.stderr).toBe('');
  const lines = res.stdout.trim().split('\n');
  expect(lines).toHaveLength(1);
  return { status: res.status, out: JSON.parse(lines[0]) };
}

const dirs = [];
function scratch() {
  const dir = fs.mkdtempSync(path.join(SCRATCH_ROOT, 'run-index-cli-'));
  dirs.push(dir);
  return fs.realpathSync(dir);
}
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

/** The two CLIs differ in create field, workflow dir, first stage and artifact shape. */
const FLAVOURS = [
  {
    name: 'issue-run-index-cli',
    cli: ISSUE_CLI,
    dir: '.ensemble/fix-issue',
    create: { issueDescription: 'fix the timeout' },
    firstStage: 'analysis_planning',
    nextStage: 'execution',
    artifact: { type: 'fix-plan', path: 'docs/plan.md' },
    badArtifactType: null,
    ops: ['setStage', 'setStageOutcome', 'appendArtifact', 'appendBeadRef', 'setPrApprovedAt'],
  },
  {
    name: 'run-index-cli',
    cli: FEATURE_CLI,
    dir: '.ensemble/new-feature',
    create: { idea: 'a feature' },
    firstStage: 'prd_create',
    nextStage: 'prd_refine',
    artifact: { type: 'prd', path: 'docs/PRD/PRD-1.md', documentId: 'PRD-1', version: '1.0.0', producingStage: 'prd_create' },
    badArtifactType: { type: 'spec', path: 'docs/PRD/PRD-1.md', documentId: 'PRD-1', version: '1.0.0', producingStage: 'prd_create' },
    ops: ['setStage', 'setStageOutcome', 'appendArtifact', 'appendBeadRef', 'setPrApprovedAt', 'setImplementationApprovedAt'],
  },
];

describe.each(FLAVOURS)('$name', (f) => {
  const run = (sub, root, payload = {}, opts) => call(f.cli, sub, { projectRoot: root, ...payload }, opts);

  test('lifecycle: create, find-active, mutate, stale revision, complete releases the lock', () => {
    const root = scratch();
    expect(run('find-active', root).out).toEqual({ ok: true, run: null });

    const created = run('create', root, f.create);
    expect(created.status).toBe(0);
    const record = created.out.run;
    expect(record).toMatchObject({ status: 'active', stage: f.firstStage, revision: 0, projectRoot: root });
    expect(record.runId).toMatch(/^[0-9a-f]{16}$/);
    expect(run('find-active', root).out.run.runId).toBe(record.runId);
    expect(run('load', root, { runId: record.runId }).out.run).toEqual(record);

    // One call applies every op, bumps the revision once and stamps the times itself.
    const patch = [
      { op: 'appendArtifact', ...f.artifact },
      { op: 'setStage', stage: f.nextStage },
      { op: 'setStageOutcome', kind: 'success' },
      { op: 'appendBeadRef', ref: 'pr:https://example.test/pr/1' },
      { op: 'appendBeadRef', ref: 'pr:https://example.test/pr/1' },
      { op: 'setPrApprovedAt', value: 'now' },
    ];
    const mutated = run('mutate', root, { runId: record.runId, expectedRevision: 0, patch });
    expect(mutated.out.ok).toBe(true);
    const after = mutated.out.run;
    expect(after.revision).toBe(1);
    expect(after.stage).toBe(f.nextStage);
    expect(after.stageOutcome).toEqual({ kind: 'success', recordedAt: expect.any(String) });
    expect(after.artifacts).toEqual([{ ...f.artifact, recordedAt: expect.any(String) }]);
    expect(after.beadRefs).toEqual(['pr:https://example.test/pr/1']);
    expect(Date.parse(after.prApprovedAt)).not.toBeNaN();

    // A second write on the revision just consumed is the store's REVISION_CONFLICT.
    const stale = run('mutate', root, { runId: record.runId, expectedRevision: 0, patch: [{ op: 'setStageOutcome', kind: 'failure', detail: 'x' }] });
    expect(stale.status).toBe(0);
    expect(stale.out).toMatchObject({ ok: false, code: 'REVISION_CONFLICT', currentRevision: 1 });
    expect(run('load', root, { runId: record.runId }).out.run.revision).toBe(1);

    const done = run('complete', root, { runId: record.runId });
    expect(done.out.run).toMatchObject({ status: 'completed', revision: 2 });
    expect(fs.existsSync(path.join(root, f.dir, 'active.lock'))).toBe(false);
    expect(run('find-active', root).out.run).toBeNull();
    expect(fs.existsSync(path.join(root, f.dir, `${record.runId}.json`))).toBe(true);
  });

  test('a second create while a run is active is RUN_ALREADY_ACTIVE naming it; abandon frees the slot', () => {
    const root = scratch();
    const first = run('create', root, f.create).out.run;
    const second = run('create', root, f.create);
    expect(second.status).toBe(0);
    expect(second.out).toMatchObject({ ok: false, code: 'RUN_ALREADY_ACTIVE', existingRunId: first.runId });
    expect(fs.readdirSync(path.join(root, f.dir)).filter((n) => n.endsWith('.json'))).toHaveLength(1);

    const abandoned = run('abandon', root, { runId: first.runId, reason: 'changed my mind' });
    expect(abandoned.out.run).toMatchObject({ status: 'abandoned' });
    expect(abandoned.out.run.stageOutcome.detail).toBe('changed my mind');
    expect(run('create', root, f.create).out.ok).toBe(true);
  });

  test('stageOutcome: a detail alone keeps the current kind; kind alone drops the old detail', () => {
    const root = scratch();
    const { runId } = run('create', root, f.create).out.run;
    const a = run('mutate', root, { runId, expectedRevision: 0, patch: [{ op: 'setStageOutcome', detail: 'only detail' }] }).out.run;
    expect(a.stageOutcome).toMatchObject({ kind: 'approval_wait', detail: 'only detail' });
    const b = run('mutate', root, { runId, expectedRevision: 1, patch: [{ op: 'setStageOutcome', kind: 'success' }] }).out.run;
    expect(b.stageOutcome.detail).toBeUndefined();
  });

  test('unknown ops, wrong fields and ops of the other workflow write nothing and bump no revision', () => {
    const root = scratch();
    const { runId } = run('create', root, f.create).out.run;
    const file = path.join(root, f.dir, `${runId}.json`);
    const before = fs.readFileSync(file, 'utf8');
    const rejected = (patch, needle) => {
      const res = run('mutate', root, { runId, expectedRevision: 0, patch });
      expect(res.status).toBe(0);
      expect(res.out).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
      if (needle) expect(res.out.message).toContain(needle);
      expect(fs.readFileSync(file, 'utf8')).toBe(before);
    };
    // The good first op must not be applied when a later one is bad.
    rejected([{ op: 'setStage', stage: f.nextStage }, { op: 'eval', code: 'process.exit(9)' }], 'unknown op');
    rejected([{ op: 'setStatus', status: 'completed' }], 'unknown op');
    rejected([{ op: 'setRevision', revision: 99 }], 'unknown op');
    rejected([{ op: 'setStage', stage: 'not_a_stage' }], 'stage');
    rejected([{ op: 'setStage', stage: f.nextStage, extra: 1 }], 'unknown key');
    rejected([{ op: 'setStageOutcome' }], 'kind');
    rejected([{ op: 'setStageOutcome', kind: 'great' }], 'kind');
    rejected([{ op: 'setPrApprovedAt', value: '2020-01-01' }], 'value');
    rejected([], 'patch');
    rejected('setStage', 'patch');
    rejected([42], 'object');
    if (f.badArtifactType) rejected([{ op: 'appendArtifact', ...f.badArtifactType }], 'type');
    if (f.name === 'issue-run-index-cli') rejected([{ op: 'setImplementationApprovedAt', value: 'now' }], 'unknown op');
  });

  test('the op vocabulary the CLI exports is the one this suite knows', () => {
    expect(require(f.cli).PATCH_OPS).toEqual(f.ops);
  });

  test('hostile ids, roots and paths are refused before the store is reached', () => {
    const root = scratch();
    const outside = scratch();
    fs.writeFileSync(path.join(outside, 'secret.json'), JSON.stringify({ revision: 0 }));
    const { runId } = run('create', root, f.create).out.run;

    for (const bad of ['../../secret', '..', '/etc/passwd', `${runId}/../${runId}`, 'ABCDEF0123456789', runId.slice(1), '']) {
      const res = run('load', root, { runId: bad });
      expect(res.out).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    }
    expect(run('load', root, { runId: 7 }).out.code).toBe('INVALID_INPUT');

    expect(run('find-active', `${root}/../${path.basename(root)}`).out).toMatchObject({ ok: false, code: 'PATH_ESCAPE' });
    expect(run('find-active', path.join(root, 'missing-dir')).out).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    expect(run('find-active', path.join(root, f.dir, `${runId}.json`)).out).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    expect(call(f.cli, 'find-active', { projectRoot: 5 }).out.code).toBe('INVALID_INPUT');
    expect(run('create', root, { unexpected: true, ...f.create }).out).toMatchObject({ ok: false, code: 'INVALID_INPUT' });

    const art = { type: f.artifact.type, ...(f.badArtifactType ? { documentId: 'D', version: '1', producingStage: 'prd_create' } : {}) };
    for (const hostile of ['../outside.md', 'docs/../../outside.md', path.join(outside, 'evil.md'), `${root}/../x`]) {
      const res = run('mutate', root, { runId, expectedRevision: 0, patch: [{ op: 'appendArtifact', ...art, path: hostile }] });
      expect(res.out).toMatchObject({ ok: false, code: 'PATH_ESCAPE' });
    }
    // An absolute path INSIDE the project is fine and stored exactly as given.
    const inside = path.join(root, 'docs', 'ok.md');
    const ok = run('mutate', root, { runId, expectedRevision: 0, patch: [{ op: 'appendArtifact', ...art, path: inside }] });
    expect(ok.out.run.artifacts[0].path).toBe(inside);
  });

  test('a symlinked runs directory or run file that leads outside the project is refused', () => {
    const root = scratch();
    const outside = scratch();
    fs.mkdirSync(path.join(root, '.ensemble'));
    fs.symlinkSync(outside, path.join(root, f.dir));
    expect(run('create', root, f.create).out).toMatchObject({ ok: false, code: 'PATH_ESCAPE' });
    expect(fs.readdirSync(outside)).toEqual([]);
    fs.unlinkSync(path.join(root, f.dir));

    // A run file that is a symlink to a file outside the runs directory.
    const { runId } = run('create', root, f.create).out.run;
    const file = path.join(root, f.dir, `${runId}.json`);
    const real = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(path.join(outside, 'elsewhere.json'), real);
    fs.rmSync(file);
    fs.symlinkSync(path.join(outside, 'elsewhere.json'), file);
    expect(run('load', root, { runId }).out).toMatchObject({ ok: false, code: 'PATH_ESCAPE' });
    expect(run('mutate', root, { runId, expectedRevision: 0, patch: [{ op: 'setStage', stage: f.nextStage }] }).out.code).toBe('PATH_ESCAPE');
    expect(fs.readFileSync(path.join(outside, 'elsewhere.json'), 'utf8')).toBe(real);
  });

  test('malformed input: not JSON, not an object, unknown or missing subcommand exit 1 with {ok:false}', () => {
    const root = scratch();
    for (const stdin of ['{not json', '[1,2]', '"str"', 'null']) {
      const res = call(f.cli, 'find-active', null, { stdin });
      expect({ stdin, status: res.status, ok: res.out.ok }).toEqual({ stdin, status: 1, ok: false });
      expect(res.out.code).toBe('INVALID_INPUT');
    }
    const unknown = call(f.cli, 'drop-table', { projectRoot: root });
    expect(unknown.status).toBe(1);
    expect(unknown.out.subcommands).toEqual(require(f.cli).SUBCOMMANDS);
    const none = spawnSync('node', [f.cli], { input: '{}', encoding: 'utf8' });
    expect(none.status).toBe(1);
    expect(JSON.parse(none.stdout).ok).toBe(false);
    // Empty stdin is an empty payload, not malformed.
    expect(call(f.cli, 'find-active', null, { stdin: '' }).status).toBe(0);
  });

  test('a corrupt run file is reported as RUN_INDEX_CORRUPT, never skipped', () => {
    const root = scratch();
    const { runId } = run('create', root, f.create).out.run;
    fs.writeFileSync(path.join(root, f.dir, `${runId}.json`), '{ truncated');
    const res = run('find-active', root);
    expect(res.status).toBe(0);
    expect(res.out).toMatchObject({ ok: false, code: 'RUN_INDEX_CORRUPT' });
  });

  test('projectRoot defaults to the cwd outside a git repository', () => {
    const root = scratch();
    const res = spawnSync('node', [f.cli, 'create'], { input: JSON.stringify(f.create), encoding: 'utf8', cwd: root });
    expect(JSON.parse(res.stdout).run.projectRoot).toBe(root);
    expect(fs.existsSync(path.join(root, f.dir, 'active.lock'))).toBe(true);
  });
});

describe('run-index-cli (new-feature extras)', () => {
  const art = { type: 'prd', path: 'docs/PRD/PRD-9.md', documentId: 'PRD-9', version: '1.0.0', producingStage: 'prd_create' };
  const run = (sub, root, payload = {}) => call(FEATURE_CLI, sub, { projectRoot: root, ...payload });

  test('create-from-artifact adopts a PRD at prd_refine; resolve-by-artifact finds it by exact path', () => {
    const root = scratch();
    expect(run('resolve-by-artifact', root, { path: art.path }).out).toEqual({ ok: true, run: null });
    const created = run('create-from-artifact', root, { idea: 'PRD 9', artifact: art, startStage: 'prd_refine' });
    expect(created.out.run).toMatchObject({ stage: 'prd_refine', artifacts: [{ ...art }] });
    expect(run('resolve-by-artifact', root, { path: art.path }).out.run.runId).toBe(created.out.run.runId);
    expect(run('resolve-by-artifact', root, { path: 'docs/PRD/other.md' }).out.run).toBeNull();
    expect(run('create-from-artifact', root, { idea: 'again', artifact: art, startStage: 'prd_refine' }).out.code).toBe('RUN_ALREADY_ACTIVE');
    expect(run('resolve-by-artifact', root, { path: '../x.md' }).out.code).toBe('PATH_ESCAPE');
  });

  test('create-from-artifact rejects a bad stage or artifact before any lock is taken', () => {
    const root = scratch();
    expect(run('create-from-artifact', root, { idea: 'x', artifact: art, startStage: 'nope' }).out.code).toBe('INVALID_INPUT');
    expect(run('create-from-artifact', root, { idea: 'x', artifact: { ...art, version: '' }, startStage: 'prd_refine' }).out.code).toBe('INVALID_INPUT');
    expect(run('create-from-artifact', root, { idea: 'x', artifact: { ...art, path: '../../x' }, startStage: 'prd_refine' }).out.code).toBe('PATH_ESCAPE');
    expect(fs.existsSync(path.join(root, '.ensemble/new-feature/active.lock'))).toBe(false);
  });

  test('approvals: setImplementationApprovedAt now/null and advancing in the same call', () => {
    const root = scratch();
    const { runId } = run('create', root, { idea: 'f' }).out.run;
    const granted = run('mutate', root, {
      runId,
      expectedRevision: 0,
      patch: [{ op: 'setImplementationApprovedAt', value: 'now' }, { op: 'setStage', stage: 'implementation' }],
    }).out.run;
    expect(Date.parse(granted.implementationApprovedAt)).not.toBeNaN();
    expect(granted.prApprovedAt).toBeNull();
    const reset = run('mutate', root, {
      runId,
      expectedRevision: 1,
      patch: [{ op: 'setImplementationApprovedAt', value: null }, { op: 'setStage', stage: 'implementation_approval' }],
    }).out.run;
    expect(reset).toMatchObject({ implementationApprovedAt: null, stage: 'implementation_approval' });
  });
});
