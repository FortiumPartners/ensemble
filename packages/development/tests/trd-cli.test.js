'use strict';

/**
 * Tests for the JSON CLI wrapper (lib/trd-cli.js).
 *
 * The exported handler functions are tested directly (no child process) for
 * speed and determinism. One child_process smoke test proves the executable
 * path emits valid JSON and exits 0.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const {
  runParse,
  runScaffoldPlan,
  runPhaseStatus,
  runNextTask,
  runPrPlan,
  runResolveSdlc,
  runQuickstart,
  runList,
  runStatus,
  main,
  deriveSlug,
} = require('../lib/trd-cli');

const FIXTURE = path.join(
  __dirname,
  'fixtures',
  'TRD-2026-023-trd-staleness-gate.md'
);
const CLI = path.join(__dirname, '..', 'lib', 'trd-cli.js');
const EXPECTED_SLUG = 'trd-2026-023-trd-staleness-gate';

// All 9 task ids in the fixture's Master Task List (PR 1).
const ALL_TASK_IDS = [
  'TRD-001',
  'TRD-001-TEST',
  'TRD-002',
  'TRD-002-TEST',
  'TRD-003',
  'TRD-003-TEST',
  'TRD-004',
  'TRD-004-TEST',
  'TRD-005',
];

/** Assert a value round-trips through JSON without throwing or losing shape. */
function expectJsonSerializable(value) {
  expect(() => JSON.stringify(value)).not.toThrow();
  const round = JSON.parse(JSON.stringify(value));
  expect(round).toEqual(value);
}

describe('deriveSlug', () => {
  test('filename-only: lowercases, hyphenates non-alphanumerics, strips edges', () => {
    // Slug comes PURELY from the filename basename (extension dropped),
    // matching the implement-trd-beads command's Preflight derivation.
    expect(deriveSlug('/a/b/My_File.Name.md')).toBe('my-file-name');
    expect(deriveSlug('---weird--.md')).toBe('weird');
    expect(deriveSlug('/docs/TRD-2026-023-trd-staleness-gate.md')).toBe(
      EXPECTED_SLUG
    );
  });

  test('real fixture filename yields the canonical TRD slug', () => {
    expect(deriveSlug(FIXTURE)).toBe(EXPECTED_SLUG);
  });

  test('REGRESSION: a TRD title argument is ignored — filename is the only source', () => {
    // The command derives the slug from the FILENAME, never the title. A
    // title-preference branch would silently diverge from the command and
    // break bead idempotency/resume matching. Passing a title MUST NOT change
    // the result for a non-canonical filename.
    expect(
      deriveSlug('/x/convenience-renamed.md', {
        title: 'TRD-2026-023: TRD Staleness Gate',
      })
    ).toBe('convenience-renamed');
    expect(deriveSlug('/x/foo.md', { title: 'Just A Title' })).toBe('foo');
  });
});

describe('runParse', () => {
  test('returns ok, correct slug, prFormat true, and 9 tasks', () => {
    const out = runParse([FIXTURE]);
    expect(out.ok).toBe(true);
    expect(out.trd.slug).toBe(EXPECTED_SLUG);
    expect(out.trd.prFormat).toBe(true);
    expect(Object.keys(out.trd.tasksById).sort()).toEqual(
      [...ALL_TASK_IDS].sort()
    );
    expect(Object.keys(out.trd.tasksById)).toHaveLength(9);
    expectJsonSerializable(out);
  });

  test('does not mutate the parser output (slug only on the copy)', () => {
    const out = runParse([FIXTURE]);
    // The emitted object carries slug; the nested phases/tasks are intact.
    expect(out.trd).toHaveProperty('slug');
    expect(Array.isArray(out.trd.phases)).toBe(true);
    expect(out.trd.phases).toHaveLength(1);
  });
});

describe('runParse: TRD-003 self-check fixture round-trip', () => {
  // Locks in the exact contract create-trd.yaml's Task Coverage Analysis
  // self-check (TRD-003) relies on: a task line missing the `- [ ] `
  // checkbox prefix is invisible to the parser, while one carrying it is
  // picked up correctly.
  function writeFixture(name, taskLine) {
    const tmp = path.join(os.tmpdir(), `trd-cli-checkbox-${name}-${Date.now()}.md`);
    fs.writeFileSync(tmp, `## Master Task List\n\n${taskLine}\n`);
    return tmp;
  }

  test('task line missing the checkbox prefix yields empty tasksById and the "no tasks" warning', () => {
    const tmp = writeFixture('missing', '**TRD-001** Some task (1h)');
    try {
      const out = runParse([tmp]);
      expect(out.ok).toBe(true);
      expect(out.trd.tasksById).toEqual({});
      expect(out.trd.warnings).toContain('No tasks found in the TRD');
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  test('task line with the checkbox prefix yields a populated tasksById and no such warning', () => {
    const tmp = writeFixture('present', '- [ ] **TRD-001** Some task (1h)');
    try {
      const out = runParse([tmp]);
      expect(out.ok).toBe(true);
      expect(Object.keys(out.trd.tasksById)).toEqual(['TRD-001']);
      expect(out.trd.warnings).not.toContain('No tasks found in the TRD');
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});

describe('runScaffoldPlan', () => {
  test('returns ok with epic, 1 story, 9 tasks, and non-empty deps', () => {
    const out = runScaffoldPlan([FIXTURE]);
    expect(out.ok).toBe(true);
    expect(out.slug).toBe(EXPECTED_SLUG);
    expect(out.plan.epic).toBeTruthy();
    expect(out.plan.epic.titlePrefix).toContain(EXPECTED_SLUG);
    expect(out.plan.stories).toHaveLength(1);
    expect(out.plan.tasks).toHaveLength(9);
    expect(Array.isArray(out.plan.deps)).toBe(true);
    expect(out.plan.deps.length).toBeGreaterThan(0);
    expectJsonSerializable(out);
  });
});

describe('runPhaseStatus', () => {
  test('no closed -> currentPhase 1, phase 1 not complete', () => {
    const out = runPhaseStatus([FIXTURE]);
    expect(out.ok).toBe(true);
    expect(out.slug).toBe(EXPECTED_SLUG);
    expect(out.prFormat).toBe(true);
    expect(out.currentPhase).toBe(1);
    expect(out.phases).toHaveLength(1);
    expect(out.phases[0]).toEqual({ n: 1, complete: false });
    expect(out.phaseTaskIds['1']).toHaveLength(9);
    expectJsonSerializable(out);
  });

  test('all task ids closed -> currentPhase null, all phases complete', () => {
    const out = runPhaseStatus([FIXTURE, '--closed', ALL_TASK_IDS.join(',')]);
    expect(out.ok).toBe(true);
    expect(out.currentPhase).toBeNull();
    expect(out.phases.every((p) => p.complete === true)).toBe(true);
    expectJsonSerializable(out);
  });
});

describe('runNextTask', () => {
  test('phase-1 ready id is selected', () => {
    const out = runNextTask([FIXTURE, '--ready', 'TRD-001']);
    expect(out.ok).toBe(true);
    expect(out.selected).toEqual(['TRD-001']);
    expectJsonSerializable(out);
  });

  test('boundary guard: unknown-phase id discarded while phase 1 open (stacked)', () => {
    // phase 1. To exercise the stacked boundary guard end-to-end we feed a
    // ready id that exists in NO phase mapping — in stacked mode such an id
    // must be discarded (it cannot be proven to belong to the current phase).
    const out = runNextTask([
      FIXTURE,
      '--ready',
      'TRD-999-NOT-IN-ANY-PHASE,TRD-001',
      '--max',
      '5',
    ], { ENSEMBLE_USE_STACKED_PRS: 'true' });
    expect(out.ok).toBe(true);
    // The unknown (would-be later-phase) id is filtered; only the real
    // phase-1 id survives.
    expect(out.selected).not.toContain('TRD-999-NOT-IN-ANY-PHASE');
    expect(out.selected).toEqual(['TRD-001']);
    expectJsonSerializable(out);
  });

  test('respects --max', () => {
    const out = runNextTask([
      FIXTURE,
      '--ready',
      'TRD-001,TRD-002',
      '--max',
      '2',
    ]);
    expect(out.selected).toEqual(['TRD-001', 'TRD-002']);
  });

  test('malformed --max (non-numeric) is coerced safely to default 1', () => {
    const out = runNextTask([
      FIXTURE,
      '--ready',
      'TRD-001,TRD-002',
      '--max',
      'not-a-number',
    ]);
    expect(out.ok).toBe(true);
    // NaN max falls back to 1 -> only the first ready id is selected.
    expect(out.selected).toEqual(['TRD-001']);
  });

  test('trailing boolean --max (no value) does not crash; defaults to 1', () => {
    const out = runNextTask([FIXTURE, '--ready', 'TRD-001,TRD-002', '--max']);
    expect(out.ok).toBe(true);
    expect(out.selected).toEqual(['TRD-001']);
  });
});

describe('runPrPlan', () => {
  test('--stacked -> stacked true, per-phase createPr true', () => {
    const out = runPrPlan([FIXTURE, '--stacked'], {});
    expect(out.ok).toBe(true);
    expect(out.slug).toBe(EXPECTED_SLUG);
    expect(out.stacked).toBe(true);
    expect(out.prFormat).toBe(true);
    expect(out.branchFirst).toBe(`feature/${EXPECTED_SLUG}-pr-1`);
    const phaseGates = out.actions.filter((a) => a.kind === 'phase-gate');
    expect(phaseGates.length).toBeGreaterThan(0);
    expect(phaseGates.every((a) => a.createPr === true)).toBe(true);
    expectJsonSerializable(out);
  });

  test('no flag + env unset -> stacked false, completion createPr true', () => {
    const out = runPrPlan([FIXTURE], {});
    expect(out.stacked).toBe(false);
    expect(out.branchFirst).toBe(`feature/${EXPECTED_SLUG}`);
    const completion = out.actions.find((a) => a.kind === 'completion');
    expect(completion).toBeTruthy();
    expect(completion.createPr).toBe(true);
    expect(completion.summaryKind).toBe('single');
    expectJsonSerializable(out);
  });

  test('env toggle enables stacked when flag absent', () => {
    const out = runPrPlan([FIXTURE], { ENSEMBLE_USE_STACKED_PRS: 'true' });
    expect(out.stacked).toBe(true);
  });
});

describe('runResolveSdlc', () => {
  const githubUrl = 'https://github.com/org/repo';
  const adoUrl = 'https://dev.azure.com/org/project/_git/repo';

  test('happy path (default): ok, git-town, gh, null consolidatedMessage', () => {
    const out = runResolveSdlc(
      ['--git-town-exit-code', '0', '--remote-url', githubUrl],
      {}
    );
    expect(out.ok).toBe(true);
    expect(out.branchingStrategy).toEqual({
      strategy: 'git-town',
      source: 'auto-detect',
      action: 'proceed',
      message: null,
    });
    expect(out.prBackend).toEqual({
      backend: 'gh',
      source: 'auto-detect',
      needsResolution: false,
    });
    expect(out.consolidatedMessage).toBeNull();
    expectJsonSerializable(out);
  });

  test('wires the three pr-strategy resolvers together on a non-default path', () => {
    const out = runResolveSdlc(
      ['--git-town-exit-code', '0', '--remote-url', adoUrl],
      { ENSEMBLE_BRANCHING_STRATEGY: 'plain-git' }
    );
    expect(out.ok).toBe(true);
    expect(out.branchingStrategy.strategy).toBe('plain-git');
    expect(out.branchingStrategy.source).toBe('env');
    expect(out.prBackend.needsResolution).toBe(true);
    expect(typeof out.consolidatedMessage).toBe('string');
    expect(out.consolidatedMessage).toContain("branching strategy resolved to 'plain-git'");
    expect(out.consolidatedMessage).toContain('PR backend resolution needed');
  });

  test('missing --git-town-exit-code throws', () => {
    expect(() => runResolveSdlc(['--remote-url', githubUrl], {})).toThrow(
      /Missing required --git-town-exit-code/
    );
  });

  test('out-of-range/non-integer --git-town-exit-code throws', () => {
    expect(() =>
      runResolveSdlc(['--git-town-exit-code', '9', '--remote-url', githubUrl], {})
    ).toThrow(/Invalid --git-town-exit-code/);
    expect(() =>
      runResolveSdlc(['--git-town-exit-code', 'abc', '--remote-url', githubUrl], {})
    ).toThrow(/Invalid --git-town-exit-code/);
  });

  test('missing --remote-url throws', () => {
    expect(() => runResolveSdlc(['--git-town-exit-code', '0'], {})).toThrow(
      /Missing required --remote-url/
    );
  });
});

describe('runQuickstart', () => {
  function writeQuickstartFixture(contents) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trd-cli-quickstart-'));
    const trdPath = path.join(tmpDir, 'TRD-2026-quickstart-fixture.md');
    const outPath = path.join(tmpDir, 'quickstart.md');
    fs.writeFileSync(trdPath, contents, 'utf8');
    return { tmpDir, trdPath, outPath };
  }

  test('quickstart success writes markdown and returns JSON-compatible coverage', () => {
    const { trdPath, outPath } = writeQuickstartFixture(`---\nprd_reference: \n---\n# Fixture\n\n## Master Task List\n\n### PR 1: Build\n\n- [ ] **TRD-001** Add quickstart output (1h) \`[satisfies REQ-001]\`\n  - Validates PRD ACs: AC-001-1\n`);

    const out = runQuickstart([trdPath, '--out', outPath, '--json']);
    expect(out.ok).toBe(true);
    expect(out.quickstartPath).toBe(outPath);
    expect(out.coverage).toMatchObject({
      parsedAcCount: 1,
      scenarioCount: 1,
      unmappedAcIds: [],
      coveragePercent: 100,
    });
    expect(fs.readFileSync(outPath, 'utf8')).toContain('## Coverage Summary');
    expectJsonSerializable(out);
  });

  test('quickstart failure returns shared JSON error through main and does not report success', () => {
    const { trdPath, outPath } = writeQuickstartFixture('# No ACs\n\n## Master Task List\n\n- [ ] **TRD-001** Task with no ACs (1h)\n');
    const writes = [];
    const orig = process.stdout.write;
    process.stdout.write = (chunk) => {
      writes.push(String(chunk));
      return true;
    };
    let code;
    try {
      code = main(['quickstart', trdPath, '--out', outPath, '--json']);
    } finally {
      process.stdout.write = orig;
    }
    expect(code).toBe(1);
    const parsed = JSON.parse(writes.join(''));
    expect(parsed.error).toMatch(/No parsed acceptance criteria found/);
    expect(parsed.ok).toBeUndefined();
    expect(fs.existsSync(outPath)).toBe(false);
  });
});

describe('error handling', () => {
  test('missing path -> handler throws (caught by main)', () => {
    expect(() => runParse([])).toThrow(/Missing required/);
  });

  test('unreadable path -> handler throws', () => {
    expect(() => runParse(['/no/such/trd-file-xyz.md'])).toThrow(/Cannot read/);
  });

  test('main prints {error} and returns exit code 1 on bad path', () => {
    const writes = [];
    const orig = process.stdout.write;
    process.stdout.write = (chunk) => {
      writes.push(String(chunk));
      return true;
    };
    let code;
    try {
      code = main(['parse', '/no/such/file.md']);
    } finally {
      process.stdout.write = orig;
    }
    expect(code).toBe(1);
    const parsed = JSON.parse(writes.join(''));
    expect(parsed.error).toMatch(/Cannot read/);
  });

  test('main returns 1 on missing subcommand', () => {
    const orig = process.stdout.write;
    process.stdout.write = () => true;
    let code;
    try {
      code = main([]);
    } finally {
      process.stdout.write = orig;
    }
    expect(code).toBe(1);
  });

  test('main returns 1 on unknown subcommand', () => {
    const orig = process.stdout.write;
    let captured = '';
    process.stdout.write = (chunk) => {
      captured += String(chunk);
      return true;
    };
    let code;
    try {
      code = main(['frobnicate', FIXTURE]);
    } finally {
      process.stdout.write = orig;
    }
    expect(code).toBe(1);
    expect(JSON.parse(captured).error).toMatch(/Unknown subcommand/);
  });
});

describe('main success path', () => {
  test('parse via main writes valid JSON and returns 0', () => {
    const orig = process.stdout.write;
    let captured = '';
    process.stdout.write = (chunk) => {
      captured += String(chunk);
      return true;
    };
    let code;
    try {
      code = main(['parse', FIXTURE]);
    } finally {
      process.stdout.write = orig;
    }
    expect(code).toBe(0);
    const parsed = JSON.parse(captured);
    expect(parsed.ok).toBe(true);
    expect(parsed.trd.slug).toBe(EXPECTED_SLUG);
  });
});

describe('executable smoke test (child_process)', () => {
  test('node trd-cli.js parse <fixture> -> exit 0, stdout is JSON ok:true, stderr empty', () => {
    const res = spawnSync('node', [CLI, 'parse', FIXTURE], {
      encoding: 'utf8',
    });
    expect(res.status).toBe(0);
    // stdout must be pure JSON; nothing leaks to stderr on the happy path.
    expect(res.stderr).toBe('');
    const parsed = JSON.parse(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.trd.slug).toBe(EXPECTED_SLUG);
    expect(parsed.trd.prFormat).toBe(true);
  });

  test('execFileSync happy path does not throw (implicitly exit 0)', () => {
    const stdout = execFileSync('node', [CLI, 'parse', FIXTURE], {
      encoding: 'utf8',
    });
    expect(JSON.parse(stdout).ok).toBe(true);
  });

  test('bad path -> exit 1 and a single JSON {error} on stdout', () => {
    const res = spawnSync('node', [CLI, 'parse', '/no/such/file-xyz.md'], {
      encoding: 'utf8',
    });
    expect(res.status).toBe(1);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.error).toMatch(/Cannot read/);
  });

  test('missing subcommand -> exit 1 and JSON {error} on stdout', () => {
    const res = spawnSync('node', [CLI], { encoding: 'utf8' });
    expect(res.status).toBe(1);
    expect(JSON.parse(res.stdout).error).toMatch(/Missing subcommand/);
  });

  test('node trd-cli.js resolve-sdlc <flags> -> exit 0, stdout is JSON ok:true, stderr empty', () => {
    const res = spawnSync(
      'node',
      [
        CLI,
        'resolve-sdlc',
        '--git-town-exit-code',
        '0',
        '--remote-url',
        'https://github.com/org/repo',
      ],
      { encoding: 'utf8' }
    );
    expect(res.status).toBe(0);
    expect(res.stderr).toBe('');
    const parsed = JSON.parse(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.branchingStrategy.strategy).toBe('git-town');
    expect(parsed.prBackend.backend).toBe('gh');
    expect(parsed.consolidatedMessage).toBeNull();
  });

  test('resolve-sdlc missing --remote-url -> exit 1 and JSON {error} on stdout (shared failure contract, not {ok:false})', () => {
    const res = spawnSync(
      'node',
      [CLI, 'resolve-sdlc', '--git-town-exit-code', '1'],
      { encoding: 'utf8' }
    );
    expect(res.status).toBe(1);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.error).toMatch(/Missing required --remote-url/);
    expect(parsed.ok).toBeUndefined();
  });
});

// REGRESSION (br-f6v): trd-cli imported extractDesignReadinessScore from
// trd-parser, which never exported it, so `list` and `status` threw
// "extractDesignReadinessScore is not a function" on every call.
describe('list and status read the design readiness score', () => {
  let dir;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trd-cli-list-'));
    fs.writeFileSync(
      path.join(dir, 'TRD-2026-aaaaaaaa-demo.md'),
      '---\ndesign_readiness_score: 9\n---\n# Demo\n'
    );
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('runList returns the score from frontmatter', () => {
    const res = runList(['--type', 'trd', '--dir', dir]);
    expect(res.ok).toBe(true);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].design_readiness_score).toBe(9);
  });

  test('runStatus returns the score from frontmatter', () => {
    const res = runStatus(['demo', '--type', 'trd', '--dir', dir]);
    expect(res.ok).toBe(true);
    expect(res.design_readiness_score).toBe(9);
  });
});
