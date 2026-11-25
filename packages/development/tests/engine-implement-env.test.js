'use strict';

/**
 * TRD-007-TEST (TRD-2026-d571763f): the environment decisions of `ensemble implement env`.
 *
 * Every scenario drives the real entry point `main(argv, ctx)` from `lib/ensemble-cli.js` with
 * the real `buildRegistry()`, against a real git repository, the real
 * `validate-git-town.sh` and the real `toolchain-cli.js` -- the verb's answers come from the
 * tools it actually runs, never from a stubbed-out engine internal.
 *
 * The fixture `PATH` contains no `git-town`, `br` or `kata` unless a scenario puts a stub there,
 * so a host that happens to have any of them installed cannot change an outcome.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { buildRegistry } = require('../lib/ensemble-cli');
const {
  buildConsolidatedResolutionMessage,
  resolveBranchingStrategy,
} = require('../lib/pr-strategy');
const MESSAGES = require('../lib/engine/messages');
const { expectMatchesOutputSchema, makeCtx, runMain } = require('./helpers/engine-run');
const {
  fakeGitTown,
  fixtureTracker,
  initRepo,
  makeRepo,
  snapshotTracker,
  snapshotTree,
  trackerCalls,
  writeToolchainYaml,
} = require('./helpers/engine-repo');

const REFERENCE = path.join(__dirname, '..', 'skills', 'implement-trd-tasks-reference', 'SKILL.md');
const KATA_ADAPTER = path.join(__dirname, '..', 'skills', 'adapter-tracker-kata', 'adapter.yaml');
const AZURE_REMOTE = 'https://dev.azure.com/org/project/_git/repo';

jest.setTimeout(120000);

function run(fx, argv, extraEnv = {}) {
  return runMain(
    ['implement', 'env', ...argv],
    makeCtx({ cwd: fx.root, env: { ...fx.env, ...extraEnv } })
  );
}

function envSpec() {
  return buildRegistry().get('implement', 'env');
}

/**
 * Select a `workflow` adapter whose `workflow.status` answers with no `files` list at all, so the
 * scenario that pins "an unreadable status is not a clean tree" has a real adapter producing it.
 * @param {{binDir: string, root: string}} fx
 */
function writeFilelessWorkflowAdapter(fx) {
  const bin = path.join(fx.binDir, 'fixture-workflow');
  fs.writeFileSync(bin, '#!/bin/sh\necho not-a-file-list\n', { mode: 0o755 });
  fs.chmodSync(bin, 0o755);
  const skillDir = path.join(fx.root, 'packages', 'fixture-pkg', 'skills', 'fixture-workflow');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'adapter.yaml'),
    yaml.dump({
      adapter: 'fixture-workflow',
      version: '1.0.0',
      categories: ['workflow'],
      contract: { workflow: '1.0' },
      binaries: ['fixture-workflow'],
      allowlist: [{ bin: 'fixture-workflow', sub: ['status'] }],
      env: [],
      health: [],
      detect: [],
      capabilities: { 'workflow.status': { run: ['fixture-workflow', 'status'] } },
    })
  );
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# fixture-workflow\n');
  writeToolchainYaml(fx.root, 'tracker: fixture-tracker\nworkflow: fixture-workflow\n');
}

/**
 * A repository whose tracker is the stub adapter, so a full preflight can pass. The adapter and
 * the stub binary are committed with everything else, so the working tree starts clean and a
 * scenario that asserts "nothing changed" is comparing against a real baseline.
 *
 * `package.json` is part of the fixture because the shipped `test-runner` adapter's Python, Ruby
 * and Elixir health checks are language-conditional (`skills/adapter-test-runner-default/
 * adapter.yaml:58-73`): a project that declares no language at all is checked for all of them.
 */
function trackedRepo(options = {}) {
  const fx = makeRepo({
    files: { 'README.md': 'fixture\n', 'package.json': '{"name":"fixture","private":true}\n' },
    ...options,
    init: false,
  });
  const tracker = fixtureTracker(fx.root);
  initRepo(fx, options);
  return { ...fx, tracker };
}

describe('halt on a git-town the repository cannot use', () => {
  test('version too old (exit 3) is REFUSED, not a silent fallback', () => {
    const fx = makeRepo({ files: { 'README.md': 'x\n' }, gitTownConfigured: true });
    fakeGitTown(fx.binDir, '13.0.0');

    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(1);
    expect(envelope.status).toBe('REFUSED');
    expect(envelope.error.code).toBe('GIT_TOWN_UNUSABLE');
    expect(envelope.error.message).toBe(MESSAGES.gitTownUnusable(3));
    expect(envelope.error.details.exitCode).toBe(3);
  });

  test('not a git repository (exit 4) is REFUSED', () => {
    const fx = makeRepo({ files: { 'README.md': 'x\n' }, init: false });
    fakeGitTown(fx.binDir, '14.2.0');

    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(1);
    expect(envelope.status).toBe('REFUSED');
    expect(envelope.error.code).toBe('GIT_TOWN_UNUSABLE');
    expect(envelope.error.message).toBe(MESSAGES.gitTownUnusable(4));
    expect(envelope.error.details.exitCode).toBe(4);
  });

  test('an explicit ENSEMBLE_BRANCHING_STRATEGY=git-town that cannot be honoured halts', () => {
    const fx = makeRepo({ files: { 'README.md': 'x\n' } });

    const { envelope, exitCode } = run(fx, [], { ENSEMBLE_BRANCHING_STRATEGY: 'git-town' });

    expect(exitCode).toBe(1);
    expect(envelope.status).toBe('REFUSED');
    expect(envelope.error.code).toBe('BRANCHING_STRATEGY_HALT');
    expect(envelope.error.message).toBe(
      resolveBranchingStrategy({ ENSEMBLE_BRANCHING_STRATEGY: 'git-town' }, 1).message
    );
  });
});

describe('an unresolvable PR backend is a question, never a guess', () => {
  test('interactive: NEEDS_CHOICE offers gh, ado and manual with the flag that answers it', () => {
    const fx = makeRepo({ files: { 'README.md': 'x\n' }, remote: AZURE_REMOTE });

    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(4);
    expect(envelope.status).toBe('NEEDS_CHOICE');
    expect(envelope.data.CHOICE.id).toBe('pr_backend');
    expect(envelope.data.CHOICE.flag).toBe('--pr-backend');
    expect(envelope.data.CHOICE.options.map(option => option.value)).toEqual(['ado', 'manual', 'gh']);
    for (const option of envelope.data.CHOICE.options) {
      expect(option.args).toEqual(['--pr-backend', option.value]);
    }
    expectMatchesOutputSchema(envSpec(), envelope);
  });

  test('non-interactive: REFUSED printing the three ENSEMBLE_PR_BACKEND values', () => {
    const fx = makeRepo({ files: { 'README.md': 'x\n' }, remote: AZURE_REMOTE });

    const { envelope, exitCode } = run(fx, ['--non-interactive']);

    expect(exitCode).toBe(1);
    expect(envelope.status).toBe('REFUSED');
    expect(envelope.error.code).toBe('PR_BACKEND_UNRESOLVED');
    expect(envelope.error.message).toContain('ENSEMBLE_PR_BACKEND=ado');
    expect(envelope.error.message).toContain('ENSEMBLE_PR_BACKEND=manual');
    expect(envelope.error.message).toContain('ENSEMBLE_PR_BACKEND=gh');
    expect(envelope.error.message).toBe(MESSAGES.PR_BACKEND_UNRESOLVED);
  });

  test('the reference the message is copied from still says the same thing', () => {
    const reference = fs.readFileSync(REFERENCE, 'utf8');
    expect(reference).toContain('ENSEMBLE_PR_BACKEND=<ado|manual|gh>');
    expect(reference).toContain('azure-devops MCP, manual steps if not connected');
    expect(reference).toContain('proceed with gh anyway (not recommended)');
  });
});

describe('a resolved PR backend is used and never written down', () => {
  test('--pr-backend manual resolves the unsupported host without touching anything', () => {
    const fx = trackedRepo({ remote: AZURE_REMOTE });
    const before = snapshotTree(fx.root);
    const trackerBefore = snapshotTracker(fx.tracker);

    const { envelope, exitCode } = run(fx, ['--pr-backend', 'manual']);

    expect(exitCode).toBe(0);
    expect(envelope.status).toBe('OK');
    expect(envelope.data.PR_BACKEND).toBe('manual');
    expect(envelope.data.PR_BACKEND_SOURCE).toBe('flag');
    expect(envelope.data.REMOTE_URL).toBe(AZURE_REMOTE);
    expect(snapshotTree(fx.root)).toEqual(before);
    expect(snapshotTracker(fx.tracker)).toBe(trackerBefore);
    expectMatchesOutputSchema(envSpec(), envelope);
  });

  test('the flag wins over ENSEMBLE_PR_BACKEND in the environment', () => {
    const fx = trackedRepo({ remote: AZURE_REMOTE });

    const { envelope } = run(fx, ['--pr-backend', 'manual'], { ENSEMBLE_PR_BACKEND: 'ado' });

    expect(envelope.data.PR_BACKEND).toBe('manual');
    expect(envelope.data.PR_BACKEND_SOURCE).toBe('flag');
  });

  test('ENSEMBLE_PR_BACKEND alone resolves it, reported as the environment', () => {
    const fx = trackedRepo({ remote: AZURE_REMOTE });

    const { envelope } = run(fx, [], { ENSEMBLE_PR_BACKEND: 'ado' });

    expect(envelope.data.PR_BACKEND).toBe('ado');
    expect(envelope.data.PR_BACKEND_SOURCE).toBe('env');
  });

  test('a supported host needs no resolution at all', () => {
    const fx = trackedRepo({ remote: 'https://github.com/org/repo.git' });

    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(0);
    expect(envelope.data.PR_BACKEND).toBe('gh');
    expect(envelope.data.PR_BACKEND_SOURCE).toBe('auto-detect');
    expect(envelope.data.BRANCHING_STRATEGY).toBe('plain-git');
    expect(envelope.data.BRANCHING_STRATEGY_SOURCE).toBe('auto-detect');
    expect(envelope.data.GIT_TOWN_EXIT_CODE).toBe(1);
    expect(envelope.data.INTERACTIVE).toBe(true);
    expect(envelope.data.CONSOLIDATED_MESSAGE).toBe(
      buildConsolidatedResolutionMessage(
        { action: 'proceed', message: null, source: 'auto-detect', strategy: 'plain-git' },
        { backend: 'gh', needsResolution: false, source: 'auto-detect' }
      )
    );
  });

  test('no remote at all reads as none rather than failing', () => {
    const fx = trackedRepo({ remote: null });

    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(0);
    expect(envelope.data.REMOTE_URL).toBe('none');
    expect(envelope.data.PR_BACKEND).toBe('gh');
  });
});

describe('the working tree the gate reads', () => {
  test('a modified, committed .beads/ export is not dirt', () => {
    const fx = trackedRepo({
      files: { '.beads/issues.jsonl': '{"id":"a"}\n', 'README.md': 'fixture\n' },
      remote: 'https://github.com/org/repo.git',
    });
    fs.writeFileSync(path.join(fx.root, '.beads', 'issues.jsonl'), '{"id":"a"}\n{"id":"b"}\n');

    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(0);
    expect(envelope.data.WORKTREE_STATUS).toEqual([]);
    expect(envelope.data.WORKTREE_DIRTY).toBe(false);
  });

  test('an untracked .beads/ directory is not dirt either', () => {
    const fx = trackedRepo({ remote: 'https://github.com/org/repo.git' });
    fs.mkdirSync(path.join(fx.root, '.beads'), { recursive: true });
    fs.writeFileSync(path.join(fx.root, '.beads', 'issues.jsonl'), '{"id":"x"}\n');

    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(0);
    expect(envelope.data.WORKTREE_STATUS).toEqual([]);
    expect(envelope.data.WORKTREE_DIRTY).toBe(false);
  });

  test('a status without a file list is UNAVAILABLE, never a clean tree', () => {
    const fx = trackedRepo({ remote: 'https://github.com/org/repo.git' });
    writeFilelessWorkflowAdapter(fx);

    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(5);
    expect(envelope.status).toBe('UNAVAILABLE');
    expect(envelope.error.code).toBe('WORKTREE_STATUS_UNREADABLE');
    expect(envelope.ok).toBe(false);
  });

  test('a real edit is dirt, and the path is reported', () => {
    const fx = trackedRepo({ remote: 'https://github.com/org/repo.git' });
    fs.writeFileSync(path.join(fx.root, 'README.md'), 'edited\n');

    const { envelope } = run(fx, []);

    expect(envelope.data.WORKTREE_DIRTY).toBe(true);
    expect(envelope.data.WORKTREE_STATUS).toContain('README.md');
  });
});

describe('the verb is read-only without --preflight', () => {
  test('neither the tree nor the tracker changes', () => {
    const fx = trackedRepo({ remote: 'https://github.com/org/repo.git' });
    const before = snapshotTree(fx.root);
    const trackerBefore = snapshotTracker(fx.tracker);

    const { exitCode } = run(fx, []);

    expect(exitCode).toBe(0);
    expect(snapshotTree(fx.root)).toEqual(before);
    expect(snapshotTracker(fx.tracker)).toBe(trackerBefore);
    expect(trackerCalls(fx.tracker)).toEqual([]);
  });

  test('--plan and --execute together are refused in the skill\'s own words', () => {
    const fx = trackedRepo({ remote: 'https://github.com/org/repo.git' });

    const { envelope, exitCode } = run(fx, ['--plan', '--execute']);

    expect(exitCode).toBe(1);
    expect(envelope.error.code).toBe('PLAN_EXECUTE_EXCLUSIVE');
    expect(envelope.error.message).toBe(MESSAGES.PLAN_EXECUTE_EXCLUSIVE);
  });
});

describe('--preflight requires the capabilities the mode actually uses', () => {
  function preflightRecord(root, runId) {
    const file = path.join(root, '.ensemble', 'state', 'toolchain', `preflight-${runId}.json`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  test('the execute list is the command\'s full required set and the plan list is narrower', () => {
    const full = trackedRepo({ remote: 'https://github.com/org/repo.git' });
    const before = snapshotTree(full.root);

    const result = run(full, ['--preflight', '--run-id', 'r1']);
    expect(result.exitCode).toBe(0);
    expect(result.envelope.data.PREFLIGHT.RUN_ID).toBe('r1');
    expect(result.envelope.data.PREFLIGHT.MODE).toBe('execute');
    expect(result.envelope.data.PREFLIGHT.AGENT_REGISTRATION_REQUIRED).toEqual(['beads-build-wave']);
    expect(result.envelope.data.PREFLIGHT.OPTIONAL_CAPABILITIES).toContain('work-graph.ready');
    expectMatchesOutputSchema(envSpec(), result.envelope);

    const fullCapabilities = preflightRecord(full.root, 'r1').capabilities;
    expect(fullCapabilities).toEqual(result.envelope.data.PREFLIGHT.CAPABILITIES);
    expect(fullCapabilities).toEqual([
      'tracker.list',
      'tracker.create',
      'tracker.comment',
      'tracker.close',
      'test-runner.run',
      'package-runner.run-script',
      'workflow.commit',
      'workflow.merge-base',
    ]);

    const added = snapshotTree(full.root).paths.filter(p => !before.paths.includes(p));
    expect(added.sort()).toEqual(
      [
        path.join('.ensemble', 'state', '.gitignore'),
        path.join('.ensemble', 'state', 'toolchain', 'preflight-r1.json'),
      ].sort()
    );

    const planned = trackedRepo({ remote: 'https://github.com/org/repo.git' });
    const planResult = run(planned, ['--plan', '--preflight', '--run-id', 'r1']);
    expect(planResult.exitCode).toBe(0);
    expect(planResult.envelope.data.PREFLIGHT.MODE).toBe('plan');
    expect(planResult.envelope.data.PREFLIGHT.AGENT_REGISTRATION_REQUIRED).toEqual([]);

    const planCapabilities = preflightRecord(planned.root, 'r1').capabilities;
    expect(planCapabilities).toEqual(['tracker.list', 'tracker.create']);
    expect(planCapabilities).not.toEqual(fullCapabilities);
  });

  test('a failing adapter health check is UNAVAILABLE with the adapter\'s own message', () => {
    const fx = makeRepo({ files: { 'README.md': 'x\n' }, remote: 'https://github.com/org/repo.git' });
    const tracker = fixtureTracker(fx.root);
    const doctor = JSON.stringify({ checks: [{ id: 'config.workspace', status: 'warn' }] });
    fs.writeFileSync(
      path.join(fx.binDir, 'kata'),
      `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "kata v0.23.0"; exit 0; fi\n` +
        `if [ "$1" = "doctor" ]; then echo '${doctor}'; exit 0; fi\nexit 1\n`,
      { mode: 0o755 }
    );
    fs.chmodSync(path.join(fx.binDir, 'kata'), 0o755);
    writeToolchainYaml(fx.root, 'tracker: kata\n');
    const failMessage = yaml.load(fs.readFileSync(KATA_ADAPTER, 'utf8')).health.find(
      check => check.id === 'kata-doctor'
    ).jsonAssert.failMessage;

    const { envelope, exitCode } = run(fx, ['--preflight', '--run-id', 'r1']);

    expect(exitCode).toBe(5);
    expect(envelope.status).toBe('UNAVAILABLE');
    expect(envelope.error.message).toBe(`kata: ${failMessage}`);
    expect(fs.existsSync(path.join(fx.root, '.ensemble', 'state', 'toolchain', 'preflight-r1.json'))).toBe(
      false
    );
    expect(trackerCalls(tracker)).toEqual([]);
  });
});

describe('the verb describes itself honestly', () => {
  test('the spec declares the side effect and the exit codes it can produce', () => {
    const spec = envSpec();
    expect(spec.sideEffect).toBe('write');
    expect(spec.exitCodes).toEqual([0, 1, 2, 4, 5]);
    expect(spec.policyKeys).toEqual([]);
  });

  test('an unknown flag is INVALID_INPUT, not a silently ignored argument', () => {
    const fx = makeRepo({ files: { 'README.md': 'x\n' } });

    const { envelope, exitCode } = run(fx, ['--no-such-flag']);

    expect(exitCode).toBe(2);
    expect(envelope.status).toBe('INVALID_INPUT');
    expect(envelope.error.code).toBe('UNKNOWN_FLAG');
  });
});
