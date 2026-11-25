'use strict';

/**
 * TRD-010-TEST (TRD-2026-d571763f): branch and PR plan decisions, `ensemble implement branch`.
 *
 * Every scenario drives the real entry point `main(argv, ctx)` from `lib/ensemble-cli.js` through
 * the real `buildRegistry()`, against a real git repository: the branch list, the current branch
 * and the remote's default branch are read with real `git`, the PR plan comes from the real
 * `trd-cli pr-plan`, and `--apply` creates the branch through a real toolchain adapter. Nothing
 * the verb decides is stubbed out inside the engine.
 *
 * The fixture `PATH` carries no real `git-town`, `br` or `kata`, and the `workflow` adapter is a
 * stub that records the `name` and `baseBranch` it was handed -- so "created from the remote
 * default" is proved by what the adapter actually received, not by what the verb says it did.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');

const { buildRegistry } = require('../lib/ensemble-cli');
const MESSAGES = require('../lib/engine/messages');
const { expectMatchesOutputSchema, makeCtx, runMain } = require('./helpers/engine-run');
const { fixtureTracker, initRepo, makeRepo, writeToolchainYaml } = require('./helpers/engine-repo');

const REFERENCE = path.join(__dirname, '..', 'skills', 'implement-trd-tasks-reference', 'SKILL.md');
const TRD_PATH = 'docs/TRD/widget-engine.md';
const SLUG = 'widget-engine';
const PROPOSED = 'feature/widget-engine';

jest.setTimeout(240000);

function branchSpec() {
  return buildRegistry().get('implement', 'branch');
}

function run(fx, argv, extraEnv = {}) {
  return runMain(
    ['implement', 'branch', ...argv],
    makeCtx({ cwd: fx.root, env: { ...fx.env, ...extraEnv } })
  );
}

/** A TRD with the frontmatter `choices-read`/`choices-write` work on and one phase to plan. */
function trdDoc(options = {}) {
  const { choices = null, frontmatter = true } = options;
  const head = [];
  if (frontmatter) {
    head.push('---', 'status: In Progress', 'design_readiness_score: 4.5');
    if (choices) {
      head.push('ensemble_implement_trd_beads:');
      head.push(`  branch_name: ${choices.branch_name}`);
      head.push(`  use_proposed: ${choices.use_proposed}`);
      head.push(`  stacked_prs: ${choices.stacked_prs}`);
    }
    head.push('---', '');
  }
  return [
    ...head,
    '# TRD: Widget Engine',
    '',
    'Engine for widgets.',
    '',
    '## Master Task List',
    '',
    '### Phase 1: Core',
    '',
    '**Shippable State:** widgets can be created',
    '',
    '- [ ] **TRD-001**: Create widget storage (2h)',
    '  - Implementation AC:',
    '    - [ ] Storage persists widgets',
    '',
    '### Phase 2: Deletion',
    '',
    '**Shippable State:** widgets can be deleted',
    '',
    '- [ ] **TRD-002**: Delete widget storage (2h)',
    '  - Implementation AC:',
    '    - [ ] Storage deletes widgets',
    '',
  ].join('\n');
}

/**
 * The stub `workflow` adapter. `branch-create` records the exact `name` and `baseBranch` the
 * runner resolved and then really creates the branch, so a scenario can assert both the base the
 * verb chose and the effect on the repository.
 * @param {{binDir: string, root: string}} fx
 * @returns {string} the path of the call log, outside the project root
 */
function writeWorkflowAdapter(fx) {
  const log = `${fx.root}-branch-create.log`;
  const bin = path.join(fx.binDir, 'fixture-workflow');
  const source = [
    '#!/usr/bin/env node',
    "'use strict';",
    "const fs = require('fs');",
    "const { execFileSync } = require('child_process');",
    'const argv = process.argv.slice(2);',
    `const log = ${JSON.stringify(log)};`,
    "if (argv[0] === 'status') { process.exit(0); }",
    "if (argv[0] === 'branch-create') {",
    "  fs.appendFileSync(log, JSON.stringify({ name: argv[1], baseBranch: argv[2] }) + '\\n');",
    "  execFileSync('git', ['switch', '--quiet', '--create', argv[1]], { stdio: 'ignore' });",
    '  process.exit(0);',
    '}',
    "if (argv[0] === 'commit' || argv[0] === 'merge-base') { process.exit(0); }",
    "process.stderr.write('stub fixture-workflow: unexpected ' + JSON.stringify(argv) + '\\n');",
    'process.exit(1);',
  ].join('\n');
  fs.writeFileSync(bin, `${source}\n`, { mode: 0o755 });
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
      allowlist: [
        { bin: 'fixture-workflow', sub: ['status', 'branch-create', 'commit', 'merge-base'] },
      ],
      env: [],
      health: [],
      detect: [],
      capabilities: {
        'workflow.status': {
          run: ['fixture-workflow', 'status'],
          parse: { format: 'lines', map: { files: '$' } },
        },
        'workflow.branch-create': {
          run: ['fixture-workflow', 'branch-create', '${name}', '${baseBranch}'],
        },
        'workflow.commit': { run: ['fixture-workflow', 'commit'] },
        'workflow.merge-base': { run: ['fixture-workflow', 'merge-base'] },
      },
    })
  );
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# fixture-workflow\n');
  writeToolchainYaml(fx.root, 'tracker: fixture-tracker\nworkflow: fixture-workflow\n');
  return log;
}

function git(fx, args) {
  return execFileSync('git', args, { cwd: fx.root, encoding: 'utf8', env: fx.env });
}

function branches(fx) {
  return git(fx, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
    .split('\n')
    .filter(line => line.length > 0)
    .sort();
}

function head(fx) {
  return git(fx, ['rev-parse', 'HEAD']).trim();
}

/**
 * A committed repository holding the TRD, a stub tracker and the stub workflow adapter.
 * @param {{choices?: object, frontmatter?: boolean, remote?: string|null}} [options]
 * @returns {{binDir: string, branchLog: string, env: object, root: string}}
 */
function trdRepo(options = {}) {
  const { choices = null, frontmatter = true, remote = 'https://github.com/org/repo.git' } = options;
  const fx = makeRepo({
    files: {
      'README.md': 'fixture\n',
      'package.json': '{"name":"fixture","private":true}\n',
      [TRD_PATH]: trdDoc({ choices, frontmatter }),
    },
    init: false,
  });
  fixtureTracker(fx.root);
  const branchLog = writeWorkflowAdapter(fx);
  initRepo(fx, { remote });
  return { ...fx, branchLog };
}

/** Record a passing preflight for `runId`, the gate `workflow.branch-create` gets checked by. */
function preflight(fx, runId) {
  const result = runMain(
    ['implement', 'env', '--preflight', '--run-id', runId],
    makeCtx({ cwd: fx.root, env: { ...fx.env } })
  );
  expect(result.exitCode).toBe(0);
  return result;
}

function branchCreateCalls(fx) {
  if (!fs.existsSync(fx.branchLog)) return [];
  return fs
    .readFileSync(fx.branchLog, 'utf8')
    .split('\n')
    .filter(line => line.length > 0)
    .map(line => JSON.parse(line));
}

describe('the messages the verb prints come from the skill they replace', () => {
  test('the detached-HEAD refusal names the flag and the way out, as the reference does', () => {
    const reference = fs.readFileSync(REFERENCE, 'utf8');
    expect(reference).toContain('requires a current branch');
    expect(reference).toContain('use --branch=<name>');
    expect(MESSAGES.DETACHED_HEAD).toContain('--use-current-branch');
    expect(MESSAGES.DETACHED_HEAD).toContain('--branch=<name>');
  });
});

describe('branch intent resolution', () => {
  test('explicit branch wins -- it is chosen over a branch auto-detection would have found', () => {
    const fx = trdRepo();
    git(fx, ['branch', PROPOSED]);
    git(fx, ['branch', 'feature/x']);

    const { envelope, exitCode } = run(fx, [TRD_PATH, '--branch', 'feature/x', '--non-interactive']);

    expect(exitCode).toBe(0);
    expect(envelope.data.BRANCH_NAME).toBe('feature/x');
    expect(envelope.data.BRANCH_RESOLVED_BY).toBe('flag-branch');
    expect(envelope.data.USE_PROPOSED).toBe(false);
    expectMatchesOutputSchema(branchSpec(), envelope);
  });

  test('detached head refused -- --use-current-branch on a detached HEAD is REFUSED', () => {
    const fx = trdRepo();
    git(fx, ['checkout', '--detach', '--quiet']);

    const { envelope, exitCode } = run(fx, [TRD_PATH, '--use-current-branch', '--non-interactive']);

    expect(exitCode).toBe(1);
    expect(envelope.status).toBe('REFUSED');
    expect(envelope.error.code).toBe('DETACHED_HEAD');
    expect(envelope.error.message).toBe(MESSAGES.DETACHED_HEAD);
  });

  test('--use-current-branch takes the branch HEAD is on', () => {
    const fx = trdRepo();
    git(fx, ['switch', '--quiet', '--create', 'feature/current']);

    const { envelope, exitCode } = run(fx, [TRD_PATH, '--use-current-branch', '--non-interactive']);

    expect(exitCode).toBe(0);
    expect(envelope.data.BRANCH_NAME).toBe('feature/current');
    expect(envelope.data.BRANCH_RESOLVED_BY).toBe('flag-current');
    expect(envelope.data.CURRENT_BRANCH_NAME).toBe('feature/current');
  });

  test('both branch flags together are refused before anything is resolved', () => {
    const fx = trdRepo();

    const { envelope, exitCode } = run(fx, [
      TRD_PATH,
      '--branch',
      'feature/x',
      '--use-current-branch',
      '--non-interactive',
    ]);

    expect(exitCode).toBe(1);
    expect(envelope.error.code).toBe('BRANCH_FLAGS_EXCLUSIVE');
    expect(envelope.error.message).toBe(MESSAGES.BRANCH_FLAGS_EXCLUSIVE);
  });

  test('auto detect -- exactly one local branch ending in the slug is chosen', () => {
    const fx = trdRepo();
    git(fx, ['branch', `topic/${SLUG}`]);

    const { envelope, exitCode } = run(fx, [TRD_PATH, '--non-interactive']);

    expect(exitCode).toBe(0);
    expect(envelope.data.BRANCH_NAME).toBe(`topic/${SLUG}`);
    expect(envelope.data.BRANCH_RESOLVED_BY).toBe('auto-detect');
    expect(envelope.data.AUTO_DETECT_CANDIDATES).toEqual([`topic/${SLUG}`]);
  });

  test('two candidates warn and none is selected', () => {
    const fx = trdRepo();
    git(fx, ['branch', `topic/${SLUG}`]);
    git(fx, ['branch', `other/${SLUG}`]);

    const { envelope, exitCode } = run(fx, [TRD_PATH, '--non-interactive']);

    expect(exitCode).toBe(0);
    expect(envelope.data.AUTO_DETECT_CANDIDATES.sort()).toEqual([`other/${SLUG}`, `topic/${SLUG}`]);
    expect(envelope.data.BRANCH_RESOLVED_BY).not.toBe('auto-detect');
    expect(envelope.data.BRANCH_NAME).toBe(PROPOSED);
    expect(envelope.data.WARNINGS.join('\n')).toContain(`topic/${SLUG}`);
    expect(envelope.data.WARNINGS.join('\n')).toContain(`other/${SLUG}`);
  });

  test('the saved choice is used when no flag and no single candidate answer', () => {
    const fx = trdRepo({
      choices: { branch_name: 'feature/saved', stacked_prs: false, use_proposed: false },
    });
    git(fx, ['branch', 'feature/saved']);

    const { envelope, exitCode } = run(fx, [TRD_PATH, '--non-interactive']);

    expect(exitCode).toBe(0);
    expect(envelope.data.BRANCH_NAME).toBe('feature/saved');
    expect(envelope.data.BRANCH_RESOLVED_BY).toBe('saved');
    expect(envelope.data.USE_PROPOSED).toBe(false);
  });

  test('a saved use_proposed choice resolves to the proposed branch', () => {
    const fx = trdRepo({
      choices: { branch_name: PROPOSED, stacked_prs: false, use_proposed: true },
    });

    const { envelope, exitCode } = run(fx, [TRD_PATH, '--non-interactive']);

    expect(exitCode).toBe(0);
    expect(envelope.data.BRANCH_NAME).toBe(PROPOSED);
    expect(envelope.data.BRANCH_RESOLVED_BY).toBe('saved');
    expect(envelope.data.USE_PROPOSED).toBe(true);
  });

  test('interactive choice offered -- nothing resolvable and interactive is NEEDS_CHOICE', () => {
    const fx = trdRepo();

    const { envelope, exitCode } = run(fx, [TRD_PATH]);

    expect(exitCode).toBe(4);
    expect(envelope.status).toBe('NEEDS_CHOICE');
    expect(envelope.data.CHOICE.id).toBe('branch_intent');
    expect(envelope.data.CHOICE.flag).toBeNull();
    expect(envelope.data.CHOICE.options.map(option => option.value)).toEqual([
      'proposed',
      'existing',
      'current',
    ]);
    expect(envelope.data.CHOICE.options[0].args).toEqual(['--use-proposed-branch']);
    expect(envelope.data.CHOICE.options[1].args).toEqual(['--branch', '<name>']);
    expect(envelope.data.CHOICE.options[2].args).toEqual(['--use-current-branch']);
    expectMatchesOutputSchema(branchSpec(), envelope);
  });

  test('the "use current branch" option is omitted when HEAD is detached', () => {
    const fx = trdRepo();
    git(fx, ['checkout', '--detach', '--quiet']);

    const { envelope, exitCode } = run(fx, [TRD_PATH]);

    expect(exitCode).toBe(4);
    expect(envelope.data.CHOICE.options.map(option => option.value)).toEqual([
      'proposed',
      'existing',
    ]);
  });

  test('non-interactive with nothing resolvable uses the proposed branch and records it', () => {
    const fx = trdRepo();

    const { envelope, exitCode } = run(fx, [TRD_PATH, '--non-interactive']);

    expect(exitCode).toBe(0);
    expect(envelope.data.BRANCH_NAME).toBe(PROPOSED);
    expect(envelope.data.BRANCH_RESOLVED_BY).toBe('non-interactive-proposed');
    expect(envelope.data.USE_PROPOSED).toBe(true);
  });

  test('--use-proposed-branch answers the choice without a prompt', () => {
    const fx = trdRepo();

    const { envelope, exitCode } = run(fx, [TRD_PATH, '--use-proposed-branch']);

    expect(exitCode).toBe(0);
    expect(envelope.data.BRANCH_NAME).toBe(PROPOSED);
    expect(envelope.data.BRANCH_RESOLVED_BY).toBe('flag-proposed');
    expect(envelope.data.USE_PROPOSED).toBe(true);
  });
});

describe('the PR plan the branch decision carries', () => {
  test('the output carries STACKED_PRS, PR_ACTIONS and the phase maps', () => {
    const fx = trdRepo();

    const { envelope, exitCode } = run(fx, [TRD_PATH, '--use-proposed-branch']);

    expect(exitCode).toBe(0);
    expect(envelope.data.STACKED_PRS).toBe(false);
    expect(Array.isArray(envelope.data.PR_ACTIONS)).toBe(true);
    expect(envelope.data.PR_ACTIONS.length).toBeGreaterThan(0);
    expect(envelope.data.CURRENT_PHASE_BRANCH).toBe(PROPOSED);
    expect(envelope.data.PHASE_BRANCH_MAP).toEqual({ 1: PROPOSED });
    expect(envelope.data.PHASE_PR_MAP).toEqual({});
  });

  test('ENSEMBLE_USE_STACKED_PRS=true produces the stacked plan and topology', () => {
    const fx = trdRepo();

    const { envelope, exitCode } = run(fx, [TRD_PATH, '--use-proposed-branch'], {
      ENSEMBLE_USE_STACKED_PRS: 'TRUE',
    });

    expect(exitCode).toBe(0);
    expect(envelope.data.STACKED_PRS).toBe(true);
    expect(envelope.data.BRANCH_NAME).toBe(`feature/${SLUG}-phase-1`);
    expect(envelope.data.EXECUTION_PLAN.TOPOLOGY).toBe('Stacked (one PR per phase)');
  });

  test('reuse rewrites actions -- the completion action has createPr true and the named branch', () => {
    const fx = trdRepo();
    git(fx, ['branch', 'feature/reuse']);

    const { envelope, exitCode } = run(fx, [
      TRD_PATH,
      '--branch',
      'feature/reuse',
      '--non-interactive',
    ], { ENSEMBLE_USE_STACKED_PRS: 'true' });

    expect(exitCode).toBe(0);
    expect(envelope.data.USE_PROPOSED).toBe(false);
    expect(envelope.data.STACKED_PRS).toBe(false);

    const completion = envelope.data.PR_ACTIONS.find(action => action.kind === 'completion');
    expect(completion.createPr).toBe(true);
    expect(completion.branch).toBe('feature/reuse');
    expect(completion.summaryKind).toBe('single');
    expect(completion.proposeTitle).toBe(`Implement ${SLUG} (widget-engine.md)`);
    expect(completion.parentBranch).toBe('');
    expect(completion.appendNextBranch).toBe('');

    for (const action of envelope.data.PR_ACTIONS.filter(a => a.kind !== 'completion')) {
      expect(action.branch).toBe('feature/reuse');
      expect(action.createPr).toBe(false);
      expect(action.parentBranch).toBe('');
      expect(action.appendNextBranch).toBe('');
    }
  });

  test('the execution plan summary is returned with the decision', () => {
    const fx = trdRepo();

    const { envelope, exitCode } = run(fx, [
      TRD_PATH,
      '--use-proposed-branch',
      '--plan',
      '--strategy',
      'tdd',
    ]);

    expect(exitCode).toBe(0);
    expect(envelope.data.EXECUTION_PLAN).toEqual({
      CURRENT_BRANCH: envelope.data.CURRENT_BRANCH_NAME,
      MODE: 'plan-only',
      PROPOSED_BRANCH: PROPOSED,
      SELECTED_BRANCH: PROPOSED,
      STRATEGY: 'tdd',
      TOPOLOGY: 'Single PR (all phases on one branch)',
      TRD: TRD_PATH,
    });
  });
});

describe('the verb is read-only without --apply', () => {
  test('dry by default -- no branch is created, HEAD does not move and the TRD is untouched', () => {
    const fx = trdRepo();
    const beforeBranches = branches(fx);
    const beforeHead = head(fx);
    const beforeTrd = fs.readFileSync(path.join(fx.root, TRD_PATH));

    const { envelope, exitCode } = run(fx, [TRD_PATH, '--use-proposed-branch']);

    expect(exitCode).toBe(0);
    expect(envelope.data.APPLIED).toBe(false);
    expect(envelope.data.BRANCH_ACTION).toBe('create');
    expect(branches(fx)).toEqual(beforeBranches);
    expect(head(fx)).toBe(beforeHead);
    expect(fs.readFileSync(path.join(fx.root, TRD_PATH)).equals(beforeTrd)).toBe(true);
    expect(branchCreateCalls(fx)).toEqual([]);
  });

  test('existing branch required -- proposed-branch use off and no such branch is REFUSED, and dry', () => {
    const fx = trdRepo();
    const beforeBranches = branches(fx);

    const { envelope, exitCode } = run(fx, [
      TRD_PATH,
      '--branch',
      'feature/missing',
      '--non-interactive',
    ]);

    expect(exitCode).toBe(1);
    expect(envelope.status).toBe('REFUSED');
    expect(envelope.error.code).toBe('BRANCH_NOT_FOUND');
    expect(envelope.error.message).toContain('feature/missing');
    expect(branches(fx)).toEqual(beforeBranches);
  });
});

describe('--apply carries the decision out', () => {
  test('proposed branch created from default -- the adapter is handed the remote default branch', () => {
    const fx = trdRepo();
    git(fx, ['update-ref', 'refs/remotes/origin/trunk', 'HEAD']);
    git(fx, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk']);
    preflight(fx, 'r1');

    const { envelope, exitCode } = run(fx, [
      TRD_PATH,
      '--use-proposed-branch',
      '--apply',
      '--run-id',
      'r1',
      '--non-interactive',
    ]);

    expect(exitCode).toBe(0);
    expect(envelope.data.APPLIED).toBe(true);
    expect(envelope.data.BASE_BRANCH).toBe('trunk');
    expect(envelope.data.BRANCH_ACTION).toBe('create');
    expect(branchCreateCalls(fx)).toEqual([{ baseBranch: 'trunk', name: PROPOSED }]);
    expect(branches(fx)).toContain(PROPOSED);
    expect(git(fx, ['branch', '--show-current']).trim()).toBe(PROPOSED);
  });

  test('with no remote default the base falls back to main', () => {
    const fx = trdRepo({ remote: null });
    preflight(fx, 'r1');

    const { envelope, exitCode } = run(fx, [
      TRD_PATH,
      '--use-proposed-branch',
      '--apply',
      '--run-id',
      'r1',
      '--non-interactive',
    ]);

    expect(exitCode).toBe(0);
    expect(envelope.data.BASE_BRANCH).toBe('main');
    expect(branchCreateCalls(fx)).toEqual([{ baseBranch: 'main', name: PROPOSED }]);
  });

  test('an existing proposed branch is switched to rather than created again', () => {
    const fx = trdRepo();
    git(fx, ['branch', PROPOSED]);
    preflight(fx, 'r1');

    const { envelope, exitCode } = run(fx, [
      TRD_PATH,
      '--use-proposed-branch',
      '--apply',
      '--run-id',
      'r1',
      '--non-interactive',
    ]);

    expect(exitCode).toBe(0);
    expect(envelope.data.BRANCH_ACTION).toBe('switch');
    expect(branchCreateCalls(fx)).toEqual([]);
    expect(git(fx, ['branch', '--show-current']).trim()).toBe(PROPOSED);
  });

  test('the choices are written back to the TRD', () => {
    const fx = trdRepo();
    preflight(fx, 'r1');

    const { envelope, exitCode } = run(fx, [
      TRD_PATH,
      '--use-proposed-branch',
      '--apply',
      '--run-id',
      'r1',
      '--non-interactive',
    ]);

    expect(exitCode).toBe(0);
    expect(envelope.data.WARNINGS).toEqual([]);
    const written = fs.readFileSync(path.join(fx.root, TRD_PATH), 'utf8');
    expect(written).toContain(`branch_name: ${PROPOSED}`);
    expect(written).toContain('use_proposed: true');
  });

  test('a choices-write failure is a warning, not a halt', () => {
    const fx = trdRepo({ frontmatter: false });
    preflight(fx, 'r1');

    const { envelope, exitCode } = run(fx, [
      TRD_PATH,
      '--use-proposed-branch',
      '--apply',
      '--run-id',
      'r1',
      '--non-interactive',
    ]);

    expect(exitCode).toBe(0);
    expect(envelope.data.APPLIED).toBe(true);
    expect(envelope.data.WARNINGS.join('\n')).toContain('cannot write choices');
    expect(branches(fx)).toContain(PROPOSED);
  });
});
