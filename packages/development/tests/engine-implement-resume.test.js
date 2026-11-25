'use strict';

/**
 * TRD-008-TEST (TRD-2026-d571763f): the resume, gate and strategy decisions of
 * `ensemble implement resume`.
 *
 * Every scenario drives the real entry point `main(argv, ctx)` from `lib/ensemble-cli.js` through
 * the real `buildRegistry()`, against a real git repository whose tracker is a stub binary that
 * refuses to mutate -- so an answer only appears here if the verb really ran `trd-cli validate`,
 * the tracker's `tracker.list`, the `workflow` adapter's status and `git ls-files`.
 *
 * The clock is supplied through `ctx.now`, never read from the host: a staleness scenario that
 * depended on the wall clock would pass or fail by the hour it ran in.
 */

const fs = require('fs');
const path = require('path');

const { buildRegistry } = require('../lib/ensemble-cli');
const MESSAGES = require('../lib/engine/messages');
const { expectMatchesOutputSchema, makeCtx, runMain } = require('./helpers/engine-run');
const {
  fixtureTracker,
  initRepo,
  makeRepo,
  snapshotTracker,
  snapshotTree,
} = require('./helpers/engine-repo');

const FIXTURES = path.join(__dirname, 'fixtures', 'trd-checks');

jest.setTimeout(240000);

/** The constitution line this repository's own `docs/standards/constitution.md:8` carries. */
const CONSTITUTION_FLEXIBLE =
  '- **Development Methodology:** Flexible — no strict ordering; trust developer judgment.\n';

function resumeSpec() {
  return buildRegistry().get('implement', 'resume');
}

function run(fx, argv, overrides = {}) {
  return runMain(
    ['implement', 'resume', ...argv],
    makeCtx({ cwd: fx.root, env: { ...fx.env }, ...overrides })
  );
}

/**
 * A TRD whose every decision-bearing field is a parameter, so a scenario changes exactly the one
 * field it is about.
 * @param {object} [options]
 * @returns {string} the document's markdown
 */
function trdDoc(options = {}) {
  const {
    prd,
    readiness = 4.5,
    satisfies = '',
    status = 'In Progress',
    strategy,
    summary = 'Engine for widgets.',
    title = 'TRD: Widget Engine',
  } = options;
  const frontmatter = ['---', `status: ${status}`];
  if (readiness !== null) frontmatter.push(`design_readiness_score: ${readiness}`);
  if (strategy !== undefined) frontmatter.push(`strategy: ${strategy}`);
  if (prd !== undefined) frontmatter.push(`prd_reference: ${prd}`);
  frontmatter.push('---');
  return [
    ...frontmatter,
    '',
    `# ${title}`,
    '',
    summary,
    '',
    '## Master Task List',
    '',
    '### Phase 1: Core',
    '',
    '**Shippable State:** widgets can be created',
    '',
    `- [ ] **TRD-001**: Create widget storage (2h)${satisfies}`,
    '  - Implementation AC:',
    '    - [ ] Storage persists widgets',
    `- [ ] **TRD-001-TEST**: Test storage (1h) [verifies TRD-001] [depends: TRD-001]${satisfies}`,
    '  - Test AC:',
    '    - [ ] Storage tests pass',
    '',
  ].join('\n');
}

/**
 * A committed repository holding a stub tracker and the given files, so the working tree starts
 * clean and a scenario about a dirty tree has to dirty it itself.
 * @param {{files?: object, issues?: object[]}} [options]
 * @returns {{binDir: string, env: object, root: string, tracker: object}}
 */
function trdRepo(options = {}) {
  const { files = {}, issues = [] } = options;
  const fx = makeRepo({
    files: {
      'README.md': 'fixture\n',
      'package.json': '{"name":"fixture","private":true}\n',
      'docs/TRD/widget-engine.md': trdDoc(),
      ...files,
    },
    init: false,
  });
  const tracker = fixtureTracker(fx.root, { issues });
  initRepo(fx);
  return { ...fx, tracker };
}

/** The epic and task beads a resume is detected from. */
function resumeIssues(slug = 'widget-engine') {
  return [
    { id: 'ep-1', status: 'open', title: `[trd:${slug}] Widget Engine` },
    { id: 't-1', status: 'closed', title: `[trd:${slug}:task:TRD-001] Create widget storage` },
    { id: 't-2', status: 'open', title: `[trd:${slug}:task:TRD-001-TEST] Test storage` },
    { id: 't-3', status: 'in_progress', title: `[trd:${slug}:task:TRD-002] Delete widgets` },
  ];
}

/** Set the mtime of every tracked path, then of the named ones, so drift is exactly known. */
function setMtimes(root, seconds, relatives) {
  for (const relative of relatives) {
    const file = path.join(root, relative);
    fs.utimesSync(file, seconds, seconds);
  }
}

function trackedPaths(root) {
  const { execFileSync } = require('child_process');
  // The fixture's git must answer about its own repository: an inherited GIT_DIR, GIT_WORK_TREE
  // or GIT_INDEX_FILE would point it at another tree or another index.
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_COMMON_DIR;
  delete env.GIT_OBJECT_DIRECTORY;
  delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
  return execFileSync('git', ['ls-files', '--exclude-standard'], { cwd: root, encoding: 'utf8', env })
    .split('\n')
    .filter(line => line.length > 0);
}

describe('resume detection', () => {
  test('an open epic sets IS_RESUME, the epic id and the task counts', () => {
    const fx = trdRepo({ issues: resumeIssues() });
    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(0);
    expect(envelope.status).toBe('OK');
    expect(envelope.data.IS_RESUME).toBe(true);
    expect(envelope.data.ROOT_EPIC_ID).toBe('ep-1');
    expect(envelope.data.CLOSED_TASKS).toBe(1);
    expect(envelope.data.OPEN_TASKS).toBe(1);
    expect(envelope.data.IN_PROGRESS_TASKS).toBe(1);
    expect(envelope.data.TOTAL_TASKS).toBe(3);
    expect(envelope.data.TRD_SLUG).toBe('widget-engine');
    expect(envelope.data.TRD_LABEL).toBe('widget-engine');
    expect(envelope.data.TRD_FILE_PATH).toBe('docs/TRD/widget-engine.md');
    expect(envelope.data.BDD_MODE.enabled).toBe(false);
    expect(envelope.data.BDD_MODE.source).toBe('repo');
    expectMatchesOutputSchema(resumeSpec(), envelope);
  });

  test('no epic is a fresh run, not a resume', () => {
    const fx = trdRepo();
    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(0);
    expect(envelope.data.IS_RESUME).toBe(false);
    expect(envelope.data.ROOT_EPIC_ID).toBeNull();
    expect(envelope.data.TOTAL_TASKS).toBe(0);
  });

  test('a closed epic is not a resume', () => {
    const fx = trdRepo({
      issues: [{ id: 'ep-1', status: 'closed', title: '[trd:widget-engine] Widget Engine' }],
    });
    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(0);
    expect(envelope.data.IS_RESUME).toBe(false);
    expect(envelope.data.ROOT_EPIC_ID).toBeNull();
  });

  test('two open epics are REFUSED, never silently the first one', () => {
    const fx = trdRepo({
      issues: [
        { id: 'ep-1', status: 'open', title: '[trd:widget-engine] Widget Engine' },
        { id: 'ep-2', status: 'open', title: '[trd:widget-engine] Widget Engine again' },
      ],
    });
    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(1);
    expect(envelope.status).toBe('REFUSED');
    expect(envelope.error.code).toBe('MULTIPLE_OPEN_EPICS');
    expect(envelope.error.message).toContain('ep-1');
    expect(envelope.error.message).toContain('ep-2');
  });

  test('a tracker that cannot be read is UNAVAILABLE, never a fresh run', () => {
    const fx = trdRepo({ issues: resumeIssues() });
    fs.rmSync(fx.tracker.tracker);
    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(5);
    expect(envelope.status).toBe('UNAVAILABLE');
    expect(envelope.ok).toBe(false);
    // The adapter's own failure code is passed through rather than reworded, so the maintainer
    // reads which tool refused.
    expect(envelope.error.code).toBe('TOOL_FAILED');
    // An error envelope carries no `data` at all, so no caller can read a resume decision out of
    // an unreadable tracker.
    expect(envelope.data).toBeUndefined();
  });
});

describe('the working-tree gate', () => {
  test('a fresh run on a dirty tree is REFUSED with the skill text', () => {
    const fx = trdRepo();
    fs.writeFileSync(path.join(fx.root, 'README.md'), 'edited\n');
    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(1);
    expect(envelope.status).toBe('REFUSED');
    expect(envelope.error.code).toBe('WORKTREE_DIRTY');
    expect(envelope.error.message).toBe(MESSAGES.WORKTREE_DIRTY);
    expect(envelope.error.details.WORKTREE_STATUS).toContain('README.md');
  });

  test('a resume on the same dirty tree notes it and continues', () => {
    const fx = trdRepo({ issues: resumeIssues() });
    fs.writeFileSync(path.join(fx.root, 'README.md'), 'edited\n');
    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(0);
    expect(envelope.data.WORKTREE_DIRTY).toBe(true);
    expect(envelope.data.WORKTREE_NOTE).toBe(
      'NOTE: working directory is dirty; continuing because this is a resume.'
    );
  });

  test('a dirty tree on a fresh run is byte-identical afterwards', () => {
    const fx = trdRepo();
    fs.writeFileSync(path.join(fx.root, 'README.md'), 'edited\n');
    const before = snapshotTree(fx.root);
    const trackerBefore = snapshotTracker(fx.tracker);

    run(fx, []);

    expect(snapshotTree(fx.root)).toEqual(before);
    expect(snapshotTracker(fx.tracker)).toBe(trackerBefore);
  });
});

describe('design readiness bands', () => {
  test('4.2 passes', () => {
    const fx = trdRepo({ files: { 'docs/TRD/widget-engine.md': trdDoc({ readiness: 4.2 }) } });
    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(0);
    expect(envelope.data.DESIGN_READINESS.band).toBe('pass');
    expect(envelope.data.DESIGN_READINESS.score).toBe(4.2);
    expect(envelope.data.DESIGN_READINESS.askToContinue).toBe(false);
  });

  test('3.5 warns and continues', () => {
    const fx = trdRepo({ files: { 'docs/TRD/widget-engine.md': trdDoc({ readiness: 3.5 }) } });
    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(0);
    expect(envelope.data.DESIGN_READINESS.band).toBe('warn');
    expect(envelope.data.DESIGN_READINESS.askToContinue).toBe(true);
  });

  test('3.5 warns without asking when nobody can be asked', () => {
    const fx = trdRepo({ files: { 'docs/TRD/widget-engine.md': trdDoc({ readiness: 3.5 }) } });
    const { envelope, exitCode } = runMain(
      ['--non-interactive', 'implement', 'resume'],
      makeCtx({ cwd: fx.root, env: { ...fx.env } })
    );

    expect(exitCode).toBe(0);
    expect(envelope.data.DESIGN_READINESS.band).toBe('warn');
    expect(envelope.data.DESIGN_READINESS.askToContinue).toBe(false);
  });

  test('2.9 is REFUSED suggesting refine-trd', () => {
    const fx = trdRepo({ files: { 'docs/TRD/widget-engine.md': trdDoc({ readiness: 2.9 }) } });
    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(1);
    expect(envelope.status).toBe('REFUSED');
    expect(envelope.error.code).toBe('READINESS_BELOW_WARN');
    expect(envelope.error.message).toBe(
      'design_readiness_score 2.9 is below 3; run /ensemble:refine-trd'
    );
  });

  test('an absent score is noted and continues', () => {
    const fx = trdRepo({ files: { 'docs/TRD/widget-engine.md': trdDoc({ readiness: null }) } });
    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(0);
    expect(envelope.data.DESIGN_READINESS.band).toBe('absent');
    expect(envelope.data.DESIGN_READINESS.score).toBeNull();
    expect(envelope.data.WARNINGS.join('\n')).toContain('design_readiness_score');
  });

  test('a repository threshold of 3.5 lets 3.6 pass', () => {
    const fx = trdRepo({
      files: {
        '.ensemble/engine.yaml': 'design_readiness_pass: 3.5\n',
        'docs/TRD/widget-engine.md': trdDoc({ readiness: 3.6 }),
      },
    });
    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(0);
    expect(envelope.data.DESIGN_READINESS.band).toBe('pass');
  });
});

describe('TRD shape', () => {
  test('a TRD without the Master Task List heading is REFUSED naming the heading', () => {
    const fx = trdRepo({
      files: {
        'docs/TRD/missing-section.md': fs.readFileSync(
          path.join(FIXTURES, 'missing-section.md'),
          'utf8'
        ),
      },
    });
    const { envelope, exitCode } = run(fx, ['docs/TRD/missing-section.md']);

    expect(exitCode).toBe(1);
    expect(envelope.status).toBe('REFUSED');
    expect(envelope.error.code).toBe('TRD_NO_MASTER_TASK_LIST');
    expect(envelope.error.message).toBe(
      "TRD 'docs/TRD/missing-section.md' has no '## Master Task List' heading"
    );
  });

  test('a Master Task List with no task line is REFUSED', () => {
    const fx = trdRepo({
      files: {
        'docs/TRD/empty-list.md':
          '---\nstatus: Draft\ndesign_readiness_score: 4.5\n---\n\n# TRD: Empty\n\nNothing.\n\n## Master Task List\n\nNo tasks yet.\n',
      },
    });
    const { envelope, exitCode } = run(fx, ['docs/TRD/empty-list.md']);

    expect(exitCode).toBe(1);
    expect(envelope.error.code).toBe('TRD_NO_TASKS');
  });

  test('a path that is not a file is REFUSED', () => {
    const fx = trdRepo();
    const { envelope, exitCode } = run(fx, ['docs/TRD/absent.md']);

    expect(exitCode).toBe(1);
    expect(envelope.error.code).toBe('TRD_NOT_FOUND');
  });

  test('a path outside the project root is INVALID_INPUT', () => {
    const fx = trdRepo();
    const { envelope, exitCode } = run(fx, ['../outside.md']);

    expect(exitCode).toBe(2);
    expect(envelope.status).toBe('INVALID_INPUT');
    expect(envelope.error.code).toBe('PATH_ESCAPE');
  });
});

describe('TRD selection without a path', () => {
  test('a name fragment matching two TRDs is NEEDS_CHOICE listing both', () => {
    const fx = trdRepo({
      files: {
        'docs/TRD/alpha-engine.md': trdDoc({ title: 'TRD: Alpha Engine' }),
        'docs/TRD/beta-engine.md': trdDoc({ title: 'TRD: Beta Engine' }),
      },
    });
    const { envelope, exitCode } = run(fx, ['engine']);

    expect(exitCode).toBe(4);
    expect(envelope.status).toBe('NEEDS_CHOICE');
    expect(envelope.data.CHOICE.id).toBe('trd_select');
    expect(envelope.data.CHOICE.options.map(option => option.value)).toEqual([
      'docs/TRD/alpha-engine.md',
      'docs/TRD/beta-engine.md',
      'docs/TRD/widget-engine.md',
    ]);
    expect(envelope.data.CHOICE.options[0].label).toBe('TRD: Alpha Engine (In Progress)');
    expect(envelope.data.CHOICE.options[0].args).toEqual(['docs/TRD/alpha-engine.md']);
    expectMatchesOutputSchema(resumeSpec(), envelope);
  });

  test('the same ambiguity is REFUSED when nobody can be asked', () => {
    const fx = trdRepo({
      files: {
        'docs/TRD/alpha-engine.md': trdDoc({ title: 'TRD: Alpha Engine' }),
        'docs/TRD/beta-engine.md': trdDoc({ title: 'TRD: Beta Engine' }),
      },
    });
    const { envelope, exitCode } = runMain(
      ['--non-interactive', 'implement', 'resume', 'engine'],
      makeCtx({ cwd: fx.root, env: { ...fx.env } })
    );

    expect(exitCode).toBe(1);
    expect(envelope.status).toBe('REFUSED');
    expect(envelope.error.code).toBe('TRD_AMBIGUOUS');
    expect(envelope.error.message).toContain('docs/TRD/alpha-engine.md');
    expect(envelope.error.message).toContain('docs/TRD/beta-engine.md');
  });

  test('a fragment matching one TRD selects it', () => {
    const fx = trdRepo({ files: { 'docs/TRD/other-thing.md': trdDoc({ title: 'TRD: Other' }) } });
    const { envelope, exitCode } = run(fx, ['widget']);

    expect(exitCode).toBe(0);
    expect(envelope.data.TRD_FILE_PATH).toBe('docs/TRD/widget-engine.md');
  });

  test('no argument selects the single in-progress TRD', () => {
    const fx = trdRepo({
      files: { 'docs/TRD/draft-thing.md': trdDoc({ status: 'Draft', title: 'TRD: Draft' }) },
    });
    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(0);
    expect(envelope.data.TRD_FILE_PATH).toBe('docs/TRD/widget-engine.md');
  });

  test('a fragment matching nothing is REFUSED', () => {
    const fx = trdRepo();
    const { envelope, exitCode } = run(fx, ['nothing-like-this']);

    expect(exitCode).toBe(1);
    expect(envelope.status).toBe('REFUSED');
    expect(envelope.error.code).toBe('TRD_NOT_FOUND');
  });

  test('a name carrying no word at all names no TRD and is REFUSED', () => {
    const fx = trdRepo();
    const { envelope, exitCode } = run(fx, ['!!!']);

    expect(exitCode).toBe(1);
    expect(envelope.status).toBe('REFUSED');
    expect(envelope.error.code).toBe('TRD_NOT_FOUND');
    expect(envelope.error.message).toContain('!!!');
  });
});

describe('traceability', () => {
  test('an orphaned satisfies annotation is REFUSED naming the task and the requirement', () => {
    const fx = trdRepo({
      files: {
        'docs/PRD/widget.md': fs.readFileSync(path.join(FIXTURES, 'valid-prd.md'), 'utf8'),
        'docs/TRD/widget-engine.md': trdDoc({
          prd: 'docs/PRD/widget.md',
          satisfies: ' [satisfies REQ-009]',
        }),
      },
    });
    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(1);
    expect(envelope.status).toBe('REFUSED');
    expect(envelope.error.code).toBe('TRD_VALIDATION_FAILED');
    expect(envelope.error.message).toContain('TRD-001');
    expect(envelope.error.message).toContain('REQ-009');
    expect(envelope.error.message).toContain('/ensemble:validate-requirements');
  });

  test('warnings alone continue and are reported', () => {
    const fx = trdRepo({
      files: {
        'docs/PRD/widget.md': fs.readFileSync(path.join(FIXTURES, 'valid-prd.md'), 'utf8'),
        'docs/TRD/widget-engine.md': trdDoc({ prd: 'docs/PRD/widget.md' }),
      },
    });
    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(0);
    expect(envelope.data.VALIDATION.errors).toEqual([]);
    expect(envelope.data.VALIDATION.warnings.join('\n')).toContain('REQ-001');
  });
});

describe('--execute without a scaffold', () => {
  test('is REFUSED with the skill text', () => {
    const fx = trdRepo();
    const { envelope, exitCode } = run(fx, ['--execute']);

    expect(exitCode).toBe(1);
    expect(envelope.status).toBe('REFUSED');
    expect(envelope.error.code).toBe('EXECUTE_NEEDS_SCAFFOLD');
    expect(envelope.error.message).toBe(MESSAGES.EXECUTE_NEEDS_SCAFFOLD);
  });

  test('is accepted when the epic exists', () => {
    const fx = trdRepo({ issues: resumeIssues() });
    const { envelope, exitCode } = run(fx, ['--execute']);

    expect(exitCode).toBe(0);
    expect(envelope.data.IS_RESUME).toBe(true);
  });

  test('an epic row with no id is no scaffold and is REFUSED', () => {
    const fx = trdRepo({
      issues: [{ status: 'open', title: '[trd:widget-engine] Widget Engine' }],
    });
    const { envelope, exitCode } = run(fx, ['--execute']);

    expect(exitCode).toBe(1);
    expect(envelope.status).toBe('REFUSED');
    expect(envelope.error.code).toBe('EXECUTE_NEEDS_SCAFFOLD');
    expect(envelope.error.message).toBe(MESSAGES.EXECUTE_NEEDS_SCAFFOLD);
  });
});

describe('the staleness gate', () => {
  const NOW = 1700000000;

  test('the fixture index is the fixture index, whatever GIT_INDEX_FILE says', () => {
    const fx = trdRepo();
    const previous = process.env.GIT_INDEX_FILE;
    process.env.GIT_INDEX_FILE = path.join(fx.root, 'no-such-index');
    try {
      expect(trackedPaths(fx.root)).toContain('docs/TRD/widget-engine.md');
    } finally {
      if (previous === undefined) delete process.env.GIT_INDEX_FILE;
      else process.env.GIT_INDEX_FILE = previous;
    }
  });

  test('a TRD older than the threshold is REFUSED by age', () => {
    const fx = trdRepo();
    const tracked = trackedPaths(fx.root);
    setMtimes(fx.root, NOW - 3600 * 200, tracked);
    setMtimes(fx.root, NOW - 3600 * 48, ['docs/TRD/widget-engine.md']);

    const { envelope, exitCode } = run(fx, [], { now: NOW });

    expect(exitCode).toBe(1);
    expect(envelope.status).toBe('REFUSED');
    expect(envelope.error.code).toBe('TRD_STALE');
    expect(envelope.error.details.STALE_AGE).toBe(true);
    expect(envelope.error.details.STALE_DRIFT).toBe(false);
    expect(envelope.error.details.AGE_HOURS).toBe(48);
    expect(envelope.error.message).toBe(
      'TRD is 48h old (threshold: 24h).\n' +
        'Run /ensemble:refine-trd docs/TRD/widget-engine.md before implementation, then re-run.'
    );
  });

  test('a newer source file is REFUSED by drift, naming the file', () => {
    const fx = trdRepo();
    const tracked = trackedPaths(fx.root);
    setMtimes(fx.root, NOW - 3600 * 100, tracked);
    setMtimes(fx.root, NOW - 3600 * 2, ['docs/TRD/widget-engine.md']);
    setMtimes(fx.root, NOW - 60, ['README.md']);

    const { envelope, exitCode } = run(fx, [], { now: NOW });

    expect(exitCode).toBe(1);
    expect(envelope.error.code).toBe('TRD_STALE');
    expect(envelope.error.details.STALE_AGE).toBe(false);
    expect(envelope.error.details.STALE_DRIFT).toBe(true);
    expect(envelope.error.details.NEWER_COUNT).toBe(1);
    expect(envelope.error.message).toBe(
      '1 source file(s) are newer than the TRD:\n' +
        '  - README.md\n' +
        'Run /ensemble:refine-trd docs/TRD/widget-engine.md before implementation, then re-run.'
    );
  });

  test('a current TRD passes the gate', () => {
    const fx = trdRepo();
    const tracked = trackedPaths(fx.root);
    setMtimes(fx.root, NOW - 3600 * 100, tracked);
    setMtimes(fx.root, NOW - 3600 * 2, ['docs/TRD/widget-engine.md']);

    const { envelope, exitCode } = run(fx, [], { now: NOW });

    expect(exitCode).toBe(0);
    expect(envelope.data.STALENESS.checked).toBe(true);
    expect(envelope.data.STALENESS.stale).toBe(false);
    expect(envelope.data.STALENESS.message).toBe('Staleness check: TRD is current');
  });

  test('a resume skips the gate however old the TRD is', () => {
    const fx = trdRepo({ issues: resumeIssues() });
    setMtimes(fx.root, NOW - 3600 * 500, ['docs/TRD/widget-engine.md']);

    const { envelope, exitCode } = run(fx, [], { now: NOW });

    expect(exitCode).toBe(0);
    expect(envelope.data.STALENESS.checked).toBe(false);
    expect(envelope.data.STALENESS.message).toBe('Staleness check: skipped (resume detected)');
  });

  test('the gate reports no clock of its own', () => {
    const fx = trdRepo();
    const tracked = trackedPaths(fx.root);
    setMtimes(fx.root, NOW - 3600 * 100, tracked);
    setMtimes(fx.root, NOW - 3600 * 2, ['docs/TRD/widget-engine.md']);

    const { envelope } = run(fx, [], { now: NOW });

    expect(JSON.stringify(envelope.data)).not.toContain(String(NOW));
  });

  test('a repository threshold of 72 hours lets a 48h-old TRD through', () => {
    const fx = trdRepo({ files: { '.ensemble/engine.yaml': 'staleness_hours: 72\n' } });
    const tracked = trackedPaths(fx.root);
    setMtimes(fx.root, NOW - 3600 * 200, tracked);
    setMtimes(fx.root, NOW - 3600 * 48, ['docs/TRD/widget-engine.md']);

    const { envelope, exitCode } = run(fx, [], { now: NOW });

    expect(exitCode).toBe(0);
    expect(envelope.data.STALENESS.stale).toBe(false);
  });
});

describe('strategy precedence', () => {
  test('the argument wins over the TRD declaration', () => {
    const fx = trdRepo({
      files: {
        'docs/standards/constitution.md': CONSTITUTION_FLEXIBLE,
        'docs/TRD/widget-engine.md': trdDoc({ strategy: 'bug-fix' }),
      },
    });
    const { envelope, exitCode } = run(fx, ['--strategy', 'refactor']);

    expect(exitCode).toBe(0);
    expect(envelope.data.STRATEGY).toBe('refactor');
    expect(envelope.data.STRATEGY_SOURCE).toBe('argument');
  });

  test('the TRD declaration wins over the constitution', () => {
    const fx = trdRepo({
      files: {
        'docs/standards/constitution.md': CONSTITUTION_FLEXIBLE,
        'docs/TRD/widget-engine.md': trdDoc({ strategy: 'bug-fix' }),
      },
    });
    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(0);
    expect(envelope.data.STRATEGY).toBe('bug-fix');
    expect(envelope.data.STRATEGY_SOURCE).toBe('trd');
  });

  test('an unknown TRD declaration is a warning and is ignored', () => {
    const fx = trdRepo({
      files: {
        'docs/standards/constitution.md': CONSTITUTION_FLEXIBLE,
        'docs/TRD/widget-engine.md': trdDoc({ strategy: 'vibes' }),
      },
    });
    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(0);
    expect(envelope.data.STRATEGY).toBe('flexible');
    expect(envelope.data.STRATEGY_SOURCE).toBe('constitution');
    expect(envelope.data.WARNINGS.join('\n')).toContain("'strategy'");
  });

  test('the constitution wins over detection', () => {
    const fx = trdRepo({
      files: {
        'docs/standards/constitution.md': CONSTITUTION_FLEXIBLE,
        'docs/TRD/widget-engine.md': trdDoc({ title: 'TRD: Legacy widget rescue' }),
      },
    });
    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(0);
    expect(envelope.data.STRATEGY).toBe('flexible');
    expect(envelope.data.STRATEGY_SOURCE).toBe('constitution');
  });

  test('detection wins over the default', () => {
    const fx = trdRepo({
      files: { 'docs/TRD/widget-engine.md': trdDoc({ title: 'TRD: Legacy widget rescue' }) },
    });
    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(0);
    expect(envelope.data.STRATEGY).toBe('characterization');
    expect(envelope.data.STRATEGY_SOURCE).toBe('detection');
  });

  test('nothing at all is the policy default', () => {
    const fx = trdRepo();
    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(0);
    expect(envelope.data.STRATEGY).toBe('tdd');
    expect(envelope.data.STRATEGY_SOURCE).toBe('default');
  });

  test('a repository default_strategy moves the last resort', () => {
    const fx = trdRepo({ files: { '.ensemble/engine.yaml': 'default_strategy: flexible\n' } });
    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(0);
    expect(envelope.data.STRATEGY).toBe('flexible');
    expect(envelope.data.STRATEGY_SOURCE).toBe('default');
  });

  test('a repository detection table decides instead of the shipped one', () => {
    const fx = trdRepo({
      files: {
        '.ensemble/engine.yaml': 'strategy_detection:\n  widget: refactor\n',
        'docs/TRD/widget-engine.md': trdDoc({ title: 'TRD: Legacy widget rescue' }),
      },
    });
    const { envelope, exitCode } = run(fx, []);

    expect(exitCode).toBe(0);
    expect(envelope.data.STRATEGY).toBe('refactor');
    expect(envelope.data.STRATEGY_SOURCE).toBe('detection');
  });
});

describe('the verb contract', () => {
  test('it is read-only and declares the exit codes it can produce', () => {
    const spec = resumeSpec();

    expect(spec.sideEffect).toBe('read');
    expect(spec.exitCodes).toEqual([0, 1, 2, 4, 5]);
    expect(spec.policyKeys).toEqual([
      'constitution_methodology',
      'default_strategy',
      'design_readiness_pass',
      'design_readiness_warn',
      'staleness_hours',
      'strategy_detection',
    ]);
  });
});
