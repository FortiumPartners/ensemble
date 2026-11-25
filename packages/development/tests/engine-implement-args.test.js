'use strict';

/**
 * TRD-006-TEST (TRD-2026-d571763f): the argument decisions of `ensemble implement args`.
 *
 * Every scenario drives the real entry point `main(argv, ctx)` from `lib/ensemble-cli.js` with the
 * real `buildRegistry()`, so what is pinned is what a maintainer gets from
 * `ensemble implement args`, never a stand-in.
 *
 * The refusal texts are asserted against the skill file they came from, not against a copy in this
 * test: a reworded constant and a reworded skill would otherwise agree with each other while the
 * engine printed something the skill never prints.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { buildRegistry } = require('../lib/ensemble-cli');
const MESSAGES = require('../lib/engine/messages');
const { expectMatchesOutputSchema, makeCtx, makeRoot, runMain, writeEngineYaml } = require('./helpers/engine-run');

const PREFLIGHT = path.join(
  __dirname,
  '..',
  'skills',
  'ensemble-implement-trd-tasks',
  'references',
  'phase-1-preflight.md'
);
const REFERENCE = path.join(__dirname, '..', 'skills', 'implement-trd-tasks-reference', 'SKILL.md');

function run(root, argv, overrides = {}) {
  return runMain(['implement', 'args', ...argv], makeCtx({ cwd: root, ...overrides }));
}

function argsSpec() {
  return buildRegistry().get('implement', 'args');
}

/** Write a TRD file under `root` and return its project-relative path. */
function writeTrd(root, relative, frontmatter = null) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const head = frontmatter === null ? '' : `---\n${frontmatter}\n---\n`;
  fs.writeFileSync(file, `${head}# A TRD\n`);
  return relative;
}

/** A hash of every file under `root`, so a scenario can prove the verb wrote nothing. */
function treeHash(root) {
  const hash = crypto.createHash('sha256');
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, entry.name);
      hash.update(path.relative(root, full));
      if (entry.isDirectory()) walk(full);
      else hash.update(fs.readFileSync(full));
    }
  };
  walk(root);
  return hash.digest('hex');
}

describe('refusals carry the text the skill prints today', () => {
  test('each verbatim message is a substring of the file it was taken from', () => {
    const preflight = fs.readFileSync(PREFLIGHT, 'utf8');
    const reference = fs.readFileSync(REFERENCE, 'utf8');

    expect(preflight).toContain(MESSAGES.PLAN_EXECUTE_EXCLUSIVE);
    expect(preflight).toContain(MESSAGES.GENERATE_ONLY_CONFLICT);
    expect(preflight).toContain(MESSAGES.MULTIPLE_TRDS);
    expect(preflight).toContain(MESSAGES.GENERATE_ONLY_REQUIRES_WORKSTREAM);
    expect(reference).toContain(MESSAGES.EXECUTE_NEEDS_SCAFFOLD);
    expect(reference).toContain(MESSAGES.WORKTREE_DIRTY);
  });

  test('mutual exclusion: --plan --execute is REFUSED with the exact message and exit 1', () => {
    const root = makeRoot();
    const { envelope, exitCode } = run(root, ['--plan', '--execute']);
    expect(exitCode).toBe(1);
    expect(envelope.status).toBe('REFUSED');
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('PLAN_EXECUTE_EXCLUSIVE');
    expect(envelope.error.message).toBe(MESSAGES.PLAN_EXECUTE_EXCLUSIVE);
  });

  test('--generate-only with a conflicting flag is REFUSED with the exact message', () => {
    const root = makeRoot();
    const { envelope, exitCode } = run(root, ['--generate-only', '--status']);
    expect(exitCode).toBe(1);
    expect(envelope.error.code).toBe('GENERATE_ONLY_CONFLICT');
    expect(envelope.error.message).toBe(MESSAGES.GENERATE_ONLY_CONFLICT);
  });

  test('--generate-only without --workstream is REFUSED with the exact message', () => {
    const root = makeRoot();
    const a = writeTrd(root, 'a.md');
    const b = writeTrd(root, 'b.md');
    const { envelope, exitCode } = run(root, ['--generate-only', '--legacy-multi', a, b]);
    expect(exitCode).toBe(1);
    expect(envelope.error.code).toBe('GENERATE_ONLY_REQUIRES_WORKSTREAM');
    expect(envelope.error.message).toBe(MESSAGES.GENERATE_ONLY_REQUIRES_WORKSTREAM);
  });

  test('the same TRD named twice is one TRD, not two', () => {
    const root = makeRoot();
    writeTrd(root, 'plan.md');
    const { envelope, exitCode } = run(root, [
      '--generate-only',
      '--workstream',
      'plan.md',
      './plan.md',
    ]);
    expect(exitCode).toBe(1);
    expect(envelope.error.code).toBe('GENERATE_ONLY_REQUIRES_WORKSTREAM');
    expect(envelope.error.message).toBe(MESSAGES.GENERATE_ONLY_REQUIRES_WORKSTREAM);
  });

  test('ambiguous multi-TRD run is REFUSED and nothing on disk changes', () => {
    const root = makeRoot();
    const a = writeTrd(root, 'docs/TRD/a.md');
    const b = writeTrd(root, 'docs/TRD/b.md');
    const before = treeHash(root);
    const { envelope, exitCode } = run(root, [a, b]);
    expect(exitCode).toBe(1);
    expect(envelope.status).toBe('REFUSED');
    expect(envelope.error.code).toBe('MULTIPLE_TRDS');
    expect(envelope.error.message).toBe(MESSAGES.MULTIPLE_TRDS);
    expect(treeHash(root)).toBe(before);
  });

  test('--generate-only with --workstream and two paths is accepted', () => {
    const root = makeRoot();
    const a = writeTrd(root, 'docs/TRD/a.md');
    const b = writeTrd(root, 'docs/TRD/b.md');
    const { envelope, exitCode } = run(root, ['--generate-only', '--workstream', a, b]);
    expect(exitCode).toBe(0);
    expect(envelope.status).toBe('OK');
    expect(envelope.data.GENERATE_ONLY).toBe(true);
    expect(envelope.data.TRD_PATHS).toEqual([a, b]);
  });

  test('a boolean explicitly false over --stdin is not a conflicting flag', () => {
    const root = makeRoot();
    const a = writeTrd(root, 'docs/TRD/a.md');
    const b = writeTrd(root, 'docs/TRD/b.md');
    const { envelope, exitCode } = run(root, ['--stdin'], {
      stdin: JSON.stringify({
        'generate-only': true,
        operands: [a, b],
        plan: false,
        status: false,
        workstream: true,
      }),
    });
    expect(exitCode).toBe(0);
    expect(envelope.data.GENERATE_ONLY).toBe(true);
  });

  test('--workstream makes two TRD paths acceptable', () => {
    const root = makeRoot();
    const a = writeTrd(root, 'docs/TRD/a.md');
    const b = writeTrd(root, 'docs/TRD/b.md');
    const { envelope, exitCode } = run(root, ['--workstream', a, b]);
    expect(exitCode).toBe(0);
    expect(envelope.status).toBe('OK');
    expect(envelope.data.TRD_PATHS).toEqual([a, b]);
    expect(envelope.data.WORKSTREAM).toBe(true);
  });

  test('--branch with --use-current-branch is REFUSED before any side effect', () => {
    const root = makeRoot();
    const before = treeHash(root);
    const { envelope, exitCode } = run(root, ['--branch', 'feature/x', '--use-current-branch']);
    expect(exitCode).toBe(1);
    expect(envelope.status).toBe('REFUSED');
    expect(envelope.error.code).toBe('BRANCH_FLAGS_EXCLUSIVE');
    expect(envelope.error.message).toBe(MESSAGES.BRANCH_FLAGS_EXCLUSIVE);
    expect(treeHash(root)).toBe(before);
  });
});

describe('argument decisions', () => {
  test('the value after --out is not a TRD path', () => {
    const root = makeRoot();
    writeTrd(root, 'a.md');
    const { envelope, exitCode } = run(root, ['a.md', '--out', 'b.md']);
    expect(exitCode).toBe(0);
    expect(envelope.data.TRD_PATHS).toEqual(['a.md']);
    expect(envelope.data.OUT_PATH).toBe('b.md');
    expectMatchesOutputSchema(argsSpec(), envelope);
  });

  test('flags are reported as the prose variables the skill names', () => {
    const root = makeRoot();
    const trd = writeTrd(root, 'docs/TRD/x.md');
    const { envelope } = run(root, ['--plan', '--branch', 'feature/x', '--allow-invalid', trd]);
    expect(envelope.data.PLAN_ONLY).toBe(true);
    expect(envelope.data.EXECUTE_ONLY).toBe(false);
    expect(envelope.data.BRANCH_REQUESTED).toBe('feature/x');
    expect(envelope.data.USE_CURRENT_BRANCH_REQUESTED).toBe(false);
    expect(envelope.data.ALLOW_INVALID).toBe(true);
    expect(envelope.data.GENERATE_ONLY).toBe(false);
    expect(envelope.data.LEGACY_MULTI).toBe(false);
    expect(envelope.data.TRD_PATHS).toEqual([trd]);
    expectMatchesOutputSchema(argsSpec(), envelope);
  });

  test('--use-current-branch alone is reported, not refused', () => {
    const root = makeRoot();
    const { envelope, exitCode } = run(root, ['--use-current-branch']);
    expect(exitCode).toBe(0);
    expect(envelope.data.USE_CURRENT_BRANCH_REQUESTED).toBe(true);
    expect(envelope.data.BRANCH_REQUESTED).toBeNull();
  });

  test('the text forms "max parallel 4" and "strategy=tdd" are understood', () => {
    const root = makeRoot();
    const { envelope, exitCode } = run(root, ['max', 'parallel', '4', 'strategy=tdd']);
    expect(exitCode).toBe(0);
    expect(envelope.data.MAX_PARALLEL).toBe(4);
    expect(envelope.data.MAX_PARALLEL_SOURCE).toBe('text');
    expect(envelope.data.STRATEGY_ARGUMENT).toBe('tdd');
    expect(envelope.data.TRD_QUERY).toBeNull();
    expectMatchesOutputSchema(argsSpec(), envelope);
  });

  test('a strategy the engine does not implement is refused', () => {
    const root = makeRoot();
    const { envelope, exitCode } = run(root, ['strategy=vibes']);
    expect(exitCode).toBe(1);
    expect(envelope.error.code).toBe('INVALID_STRATEGY');
  });

  test('a non-positive "max parallel" count is refused', () => {
    const root = makeRoot();
    const { envelope, exitCode } = run(root, ['max', 'parallel', '0']);
    expect(exitCode).toBe(1);
    expect(envelope.error.code).toBe('INVALID_MAX_PARALLEL');
  });

  test('a "max parallel" count this runtime cannot hold exactly is refused', () => {
    const root = makeRoot();
    const { envelope, exitCode } = run(root, ['max', 'parallel', '9007199254740993']);
    expect(exitCode).toBe(1);
    expect(envelope.error.code).toBe('INVALID_MAX_PARALLEL');
  });

  test('a --max-parallel count this runtime cannot hold exactly is INVALID_INPUT', () => {
    const root = makeRoot();
    const { envelope, exitCode } = run(root, ['--max-parallel', '9007199254740993']);
    expect(exitCode).toBe(2);
    expect(envelope.status).toBe('INVALID_INPUT');
  });

  test('leftover words become the TRD query', () => {
    const root = makeRoot();
    const { envelope } = run(root, ['payment', 'gateway']);
    expect(envelope.data.TRD_QUERY).toBe('payment gateway');
    expect(envelope.data.TRD_PATHS).toEqual([]);
  });
});

describe('MAX_PARALLEL precedence', () => {
  test('the flag wins over frontmatter and policy', () => {
    const root = makeRoot();
    writeEngineYaml(root, 'max_parallel_default: 9\n');
    const trd = writeTrd(root, 'docs/TRD/x.md', 'max_parallel: 7');
    const { envelope } = run(root, ['--max-parallel', '2', trd]);
    expect(envelope.data.MAX_PARALLEL).toBe(2);
    expect(envelope.data.MAX_PARALLEL_SOURCE).toBe('flag');
  });

  test('frontmatter wins over policy when no flag is given', () => {
    const root = makeRoot();
    writeEngineYaml(root, 'max_parallel_default: 9\n');
    const trd = writeTrd(root, 'docs/TRD/x.md', 'max_parallel: 7');
    const { envelope } = run(root, [trd]);
    expect(envelope.data.MAX_PARALLEL).toBe(7);
    expect(envelope.data.MAX_PARALLEL_SOURCE).toBe('frontmatter');
  });

  test('the policy default applies when neither is given', () => {
    const root = makeRoot();
    writeEngineYaml(root, 'max_parallel_default: 9\n');
    const { envelope } = run(root, []);
    expect(envelope.data.MAX_PARALLEL).toBe(9);
    expect(envelope.data.MAX_PARALLEL_SOURCE).toBe('policy');
  });

  test('the shipped default applies with no repository policy file', () => {
    const root = makeRoot();
    const { envelope } = run(root, []);
    expect(envelope.data.MAX_PARALLEL).toBe(3);
    expect(envelope.data.MAX_PARALLEL_SOURCE).toBe('policy');
  });

  test('an unusable frontmatter value warns and falls through to policy', () => {
    const root = makeRoot();
    const trd = writeTrd(root, 'docs/TRD/x.md', 'max_parallel: soon');
    const { envelope } = run(root, [trd]);
    expect(envelope.data.MAX_PARALLEL).toBe(3);
    expect(envelope.data.MAX_PARALLEL_SOURCE).toBe('policy');
    expect(envelope.data.WARNINGS.join(' ')).toContain('max_parallel');
  });
});

describe('interactivity detection', () => {
  test('a non-empty FOREMAN_TASK_TITLE turns non-interactive mode on', () => {
    const root = makeRoot();
    const { envelope } = run(root, [], { env: { FOREMAN_TASK_TITLE: 'build the thing' } });
    expect(envelope.data.FOREMAN).toBe(true);
    expect(envelope.data.NON_INTERACTIVE).toBe(true);
    expect(envelope.data.INTERACTIVE).toBe(false);
  });

  test('a blank FOREMAN_TASK_TITLE does not', () => {
    const root = makeRoot();
    const { envelope } = run(root, [], { env: { FOREMAN_TASK_TITLE: '   ' } });
    expect(envelope.data.FOREMAN).toBe(false);
    expect(envelope.data.NON_INTERACTIVE).toBe(false);
  });

  test('CI alone never implies it', () => {
    const root = makeRoot();
    const { envelope } = run(root, [], { env: { CI: 'true' } });
    expect(envelope.data.NON_INTERACTIVE).toBe(false);
    expect(envelope.data.INTERACTIVE).toBe(true);
  });

  test('ENSEMBLE_NON_INTERACTIVE alone never implies it', () => {
    const root = makeRoot();
    const { envelope } = run(root, [], { env: { ENSEMBLE_NON_INTERACTIVE: '1' } });
    expect(envelope.data.NON_INTERACTIVE).toBe(false);
    expect(envelope.data.INTERACTIVE).toBe(true);
  });

  test('--foreman turns it on', () => {
    const root = makeRoot();
    const { envelope } = run(root, ['--foreman']);
    expect(envelope.data.FOREMAN).toBe(true);
    expect(envelope.data.NON_INTERACTIVE).toBe(true);
  });

  test('the global --non-interactive turns it on without claiming Foreman', () => {
    const root = makeRoot();
    const { envelope } = run(root, ['--non-interactive']);
    expect(envelope.data.NON_INTERACTIVE).toBe(true);
    expect(envelope.data.FOREMAN).toBe(false);
  });
});

describe('early exits are reported, never performed', () => {
  test('--list returns the list action and changes nothing', () => {
    const root = makeRoot();
    const before = treeHash(root);
    const { envelope, exitCode } = run(root, ['--list']);
    expect(exitCode).toBe(0);
    expect(envelope.data.EARLY_EXIT).toEqual({ action: 'list' });
    expect(treeHash(root)).toBe(before);
  });

  test('--status returns the status action and changes nothing', () => {
    const root = makeRoot();
    const before = treeHash(root);
    const { envelope } = run(root, ['--status']);
    expect(envelope.data.EARLY_EXIT).toEqual({ action: 'status' });
    expect(treeHash(root)).toBe(before);
  });

  test('--reset-task returns the task id and changes nothing', () => {
    const root = makeRoot();
    const before = treeHash(root);
    const { envelope } = run(root, ['--reset-task', 'TRD-001']);
    expect(envelope.data.EARLY_EXIT).toEqual({ action: 'reset-task', taskId: 'TRD-001' });
    expect(treeHash(root)).toBe(before);
  });

  test('no early-exit flag reports no early exit', () => {
    const root = makeRoot();
    const { envelope } = run(root, []);
    expect(envelope.data.EARLY_EXIT).toBeNull();
  });
});

describe('the input boundary applies to this verb (Constitution Rule 6)', () => {
  test('--out outside the project root is INVALID_INPUT with exit 2', () => {
    const root = makeRoot();
    const { envelope, exitCode } = run(root, ['--out', '../../etc/passwd']);
    expect(exitCode).toBe(2);
    expect(envelope.status).toBe('INVALID_INPUT');
    expect(envelope.error.code).toBe('PATH_ESCAPE');
  });

  test('a TRD operand outside the project root is INVALID_INPUT with exit 2', () => {
    const root = makeRoot();
    const { envelope, exitCode } = run(root, ['../x.md']);
    expect(exitCode).toBe(2);
    expect(envelope.status).toBe('INVALID_INPUT');
    expect(envelope.error.code).toBe('PATH_ESCAPE');
  });

  test('--stdin carries the same input object as the flags do', () => {
    const root = makeRoot();
    writeTrd(root, 'a.md');
    const viaFlags = run(root, ['--plan', 'a.md', '--max-parallel', '5']);
    const viaStdin = run(root, ['--stdin'], {
      stdin: JSON.stringify({ 'max-parallel': 5, operands: ['a.md'], plan: true }),
    });
    expect(viaStdin.exitCode).toBe(0);
    expect(viaStdin.envelope.data).toEqual(viaFlags.envelope.data);
  });

  test('an undeclared flag is refused', () => {
    const root = makeRoot();
    const { envelope, exitCode } = run(root, ['--nope']);
    expect(exitCode).toBe(2);
    expect(envelope.error.code).toBe('UNKNOWN_FLAG');
  });
});

describe('the verb is deterministic and describes itself truthfully', () => {
  test('two identical runs produce byte-equal envelopes', () => {
    const root = makeRoot();
    const trd = writeTrd(root, 'docs/TRD/x.md', 'max_parallel: 4');
    const first = run(root, ['--plan', trd]);
    const second = run(root, ['--plan', trd]);
    expect(JSON.stringify(second.envelope)).toBe(JSON.stringify(first.envelope));
  });

  test('the verb is registered as a read verb with the policy key it reads', () => {
    const spec = argsSpec();
    expect(spec).not.toBeNull();
    expect(spec.sideEffect).toBe('read');
    expect(spec.policyKeys).toEqual(['max_parallel_default']);
    expect(spec.exitCodes).toEqual([0, 1, 2]);
  });

  test('every OK payload matches the published outputSchema', () => {
    const root = makeRoot();
    const trd = writeTrd(root, 'docs/TRD/x.md');
    const spec = argsSpec();
    for (const argv of [[], ['--plan', trd], ['--list'], ['max', 'parallel', '2'], ['a query']]) {
      const { envelope } = run(root, argv);
      expect(envelope.status).toBe('OK');
      expectMatchesOutputSchema(spec, envelope);
    }
  });
});
