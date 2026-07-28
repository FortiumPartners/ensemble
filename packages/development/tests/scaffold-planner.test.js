/**
 * Unit tests for the pure scaffold planner (lib/scaffold-planner.js).
 *
 * The planner ports Scaffold Steps 3-6 (epic / story / task / synthesized-test /
 * dependency edges) from implement-trd-beads.yaml into a pure function that
 * returns a PLAN (data) with no side effects. These tests pin the plan shape
 * and the dependency-edge semantics that the executor depends on.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { buildScaffoldPlan } = require('../lib/scaffold-planner');
const { parseTRD } = require('../lib/trd-parser');

// ---------------------------------------------------------------------------
// Inline ParsedTRD fixtures (the planner consumes parser OUTPUT, not markdown)
// ---------------------------------------------------------------------------

const OPTS = {
  trdSlug: 'demo-trd',
  trdFilePath: 'docs/TRD/demo.md',
  prdFilePath: 'docs/PRD/demo.md',
};

function makeTask(over) {
  return {
    id: 'TRD-001',
    phaseN: 1,
    description: 'Do the thing',
    isTest: false,
    hourEstimate: null,
    satisfies: ['REQ-001'],
    verifies: null,
    validatesAcs: [],
    dependsOn: [],
    targetFiles: [],
    actions: [],
    implementationAc: [],
    testAc: [],
    nestedSubitems: [],
    testSubitems: [],
    proofOfRequirement: null,
    ...over,
  };
}

// Two-phase PR-format TRD with: impl + test tasks, explicit deps, an INFRA
// task, embedded test sub-items, and a cross-phase dependency.
function buildTwoPhaseParsed() {
  const t1 = makeTask({
    id: 'TRD-001',
    phaseN: 1,
    description: 'Implement core',
    satisfies: ['REQ-001'],
    validatesAcs: ['AC-001-1'],
    targetFiles: ['src/core.js'],
    actions: ['Create module', 'Wire it up'],
    implementationAc: ['Core exists', 'Core is exported'],
    nestedSubitems: ['Add a README note', 'Write a unit test for core'],
    testSubitems: ['Write a unit test for core'],
  });
  const t1test = makeTask({
    id: 'TRD-001-TEST',
    phaseN: 1,
    description: 'Test core',
    isTest: true,
    verifies: 'TRD-001',
    satisfies: ['REQ-001'],
    validatesAcs: ['AC-001-1'],
    dependsOn: ['TRD-001'],
    targetFiles: ['test/core.test.js'],
    actions: ['Test the module'],
    testAc: ['Coverage >= 80%'],
    proofOfRequirement: 'Tests pass',
  });
  const t2infra = makeTask({
    id: 'TRD-002',
    phaseN: 1,
    description: 'Set up CI',
    satisfies: ['INFRA'],
    targetFiles: ['.github/ci.yml'],
    actions: ['Add workflow'],
  });
  const t3 = makeTask({
    id: 'TRD-003',
    phaseN: 2,
    description: 'Build API',
    satisfies: ['REQ-002'],
    dependsOn: ['TRD-001'],
    targetFiles: ['src/api.js'],
    actions: ['Add endpoint'],
  });

  return {
    title: 'Demo TRD',
    summary: 'A demo summary paragraph.',
    prdReference: 'docs/PRD/demo.md',
    designReadinessScore: null,
    prFormat: true,
    phases: [
      {
        n: 1,
        title: 'Foundation',
        shippableState: 'Users can use the core.',
        taskIds: ['TRD-001', 'TRD-001-TEST', 'TRD-002'],
      },
      {
        n: 2,
        title: 'API Layer',
        shippableState: 'Users can call the API.',
        taskIds: ['TRD-003'],
      },
    ],
    tasksById: {
      'TRD-001': t1,
      'TRD-001-TEST': t1test,
      'TRD-002': t2infra,
      'TRD-003': t3,
    },
    warnings: [],
  };
}

// Like buildTwoPhaseParsed but with document-level architecture context.
function buildTwoPhaseParsedWithTrdCtx() {
  const parsed = buildTwoPhaseParsed();
  return {
    ...parsed,
    architectureDecision:
      '**Chosen Approach: Option C — Typed-Events-First**\n\n' +
      'REQ-010 is implemented as the first shippable vertical slice. This locks the\n' +
      'authoritative event vocabulary before map→struct debt accumulates.\n\n' +
      '**Rationale:** The PRD identified typed-event migration as the highest-risk item.',
    keyTechnicalDecisions: [
      '1. EventCodec dual-read path: Both old map format and new typed structs accepted on read during migration.',
      '2. Versioned envelope: {version: 1, data: typed_event} or {version: 0, data: map}.',
    ],
  };
}

// Like buildTwoPhaseParsed but with only keyTechnicalDecisions (no architectureDecision).
function buildTwoPhaseParsedWithDecisionsOnly() {
  const parsed = buildTwoPhaseParsed();
  return {
    ...parsed,
    architectureDecision: null,
    keyTechnicalDecisions: [
      '1. EventCodec dual-read path: Both old map format and new typed structs accepted on read.',
      '2. Versioned envelope: {version: 1, data: typed_event} or {version: 0, data: map}.',
    ],
  };
}

// Single-phase legacy (phase) format with an unknown dependency.
function buildLegacyParsed() {
  const t1 = makeTask({ id: 'TRD-010', phaseN: 1, description: 'A' });
  const t2 = makeTask({
    id: 'TRD-011',
    phaseN: 1,
    description: 'B',
    dependsOn: ['TRD-010', 'TRD-999'], // TRD-999 is unknown
  });
  return {
    title: 'Legacy TRD',
    summary: 'Legacy summary.',
    prdReference: null,
    designReadinessScore: null,
    prFormat: false,
    phases: [
      { n: 1, title: 'Only Phase', shippableState: null, taskIds: ['TRD-010', 'TRD-011'] },
    ],
    tasksById: { 'TRD-010': t1, 'TRD-011': t2 },
    warnings: [],
  };
}

function depsOfType(plan, type) {
  return plan.deps.filter((d) => d.type === type);
}

// ---------------------------------------------------------------------------
// Epic / story / task structure
// ---------------------------------------------------------------------------

describe('buildScaffoldPlan — epic', () => {
  const plan = buildScaffoldPlan(buildTwoPhaseParsed(), OPTS);

  test('epic title prefix and title', () => {
    expect(plan.epic.titlePrefix).toBe('[trd:demo-trd]');
    expect(plan.epic.title).toBe('[trd:demo-trd] Implement TRD: Demo TRD');
    expect(plan.epic.type).toBe('epic');
    expect(plan.epic.priority).toBe(2);
    expect(plan.epic.description).toBe('A demo summary paragraph.');
  });
});

describe('buildScaffoldPlan — stories', () => {
  const plan = buildScaffoldPlan(buildTwoPhaseParsed(), OPTS);

  test('one story per phase, ascending', () => {
    expect(plan.stories).toHaveLength(2);
    expect(plan.stories.map((s) => s.phaseN)).toEqual([1, 2]);
  });

  test('PR-format story title prefix, title, type, priority', () => {
    const s1 = plan.stories[0];
    expect(s1.titlePrefix).toBe('[trd:demo-trd:pr:1]');
    expect(s1.title).toBe('[trd:demo-trd:pr:1] PR 1: Foundation');
    expect(s1.type).toBe('feature');
    expect(s1.priority).toBe(2);
  });

  test('story description includes task count and shippable state (PR format)', () => {
    const s1 = plan.stories[0];
    expect(s1.description).toBe(
      'PR 1 of TRD: Demo TRD. Contains 3 tasks. Shippable state: Users can use the core.',
    );
    expect(s1.shippableState).toBe('Users can use the core.');
  });
});

describe('buildScaffoldPlan — phase (legacy) naming', () => {
  const plan = buildScaffoldPlan(buildLegacyParsed(), OPTS);

  test('uses phase prefix/label and omits shippable state', () => {
    const s1 = plan.stories[0];
    expect(s1.titlePrefix).toBe('[trd:demo-trd:phase:1]');
    expect(s1.title).toBe('[trd:demo-trd:phase:1] Phase 1: Only Phase');
    // shippableState is null and prFormat false -> no "Shippable state:" suffix
    expect(s1.description).toBe('Phase 1 of TRD: Legacy TRD. Contains 2 tasks.');
    expect(s1.shippableState).toBeNull();
  });
});

describe('buildScaffoldPlan — tasks', () => {
  const plan = buildScaffoldPlan(buildTwoPhaseParsed(), OPTS);

  test('one task per non-synthesized task, in document order', () => {
    expect(plan.tasks.map((t) => t.id)).toEqual([
      'TRD-001',
      'TRD-001-TEST',
      'TRD-002',
      'TRD-003',
    ]);
  });

  test('task title prefix is the idempotency key', () => {
    const t = plan.tasks.find((x) => x.id === 'TRD-001');
    expect(t.titlePrefix).toBe('[trd:demo-trd:task:TRD-001]');
    expect(t.title).toBe('[trd:demo-trd:task:TRD-001] Implement core');
    expect(t.type).toBe('task');
    expect(t.priority).toBe(2);
    expect(t.isTest).toBe(false);
  });

  test('impl task description has Task header, TRD/PRD refs, ACs, actions', () => {
    const t = plan.tasks.find((x) => x.id === 'TRD-001');
    expect(t.description).toContain('## Task: TRD-001');
    expect(t.description).toContain('TRD Reference: docs/TRD/demo.md#trd-001');
    expect(t.description).toContain('PRD Reference: docs/PRD/demo.md#req-001');
    expect(t.description).toContain('Satisfies: REQ-001');
    expect(t.description).toContain('PRD ACs: AC-001-1');
    expect(t.description).toContain('Target File: src/core.js');
    expect(t.description).toContain('1. Create module');
    expect(t.description).toContain('2. Wire it up');
    expect(t.description).toContain('Implementation AC:');
    expect(t.description).toContain('- [ ] Core exists');
  });

  test('impl task includes Sub-items and Embedded tests sections when present', () => {
    const t = plan.tasks.find((x) => x.id === 'TRD-001');
    expect(t.description).toContain(
      'Sub-items (every checklist item below MUST be completed before this task is done):',
    );
    expect(t.description).toContain('- [ ] Add a README note');
    expect(t.description).toContain(
      'Embedded tests (implement AND run these — they have no separate TRD-NNN-TEST task):',
    );
    expect(t.description).toContain('- [ ] Write a unit test for core');
  });

  test('impl task omits Sub-items / Embedded tests sections when empty', () => {
    const t = plan.tasks.find((x) => x.id === 'TRD-003');
    expect(t.description).not.toContain('Sub-items (');
    expect(t.description).not.toContain('Embedded tests (');
  });

  test('INFRA task omits the PRD Reference line', () => {
    const t = plan.tasks.find((x) => x.id === 'TRD-002');
    expect(t.description).toContain('## Task: TRD-002');
    expect(t.description).not.toContain('PRD Reference:');
    expect(t.description).toContain('Satisfies: INFRA');
  });

  test('test task uses Test Task header and Verifies fields', () => {
    const t = plan.tasks.find((x) => x.id === 'TRD-001-TEST');
    expect(t.isTest).toBe(true);
    expect(t.description).toContain('## Test Task: TRD-001-TEST');
    expect(t.description).toContain('Verifies Task: docs/TRD/demo.md#trd-001');
    expect(t.description).toContain('Verifies: TRD-001');
    expect(t.description).toContain('PRD ACs Proven: AC-001-1');
    expect(t.description).toContain('Proof of requirement: Tests pass');
    expect(t.description).toContain('Test AC:');
    expect(t.description).toContain('- [ ] Coverage >= 80%');
  });
});
// ---------------------------------------------------------------------------
// PRD enrichment
// ---------------------------------------------------------------------------

describe('buildScaffoldPlan — PRD enrichment', () => {
  const prdCtx = {
    requirements: {
      'REQ-001': {
        id: 'REQ-001',
        title: 'HTTP command ingress',
        text: 'The system MUST accept commands via HTTP POST to a Phoenix endpoint.',
        acIds: ['AC-001-1', 'AC-001-2'],
      },
    },
    acs: {
      'AC-001-1': {
        id: 'AC-001-1',
        reqId: 'REQ-001',
        given: 'a running Elixir backend',
        when: 'the Go CLI sends POST /api/commands',
        then: 'all mutations route to CommandRouter.dispatch',
        text: 'Given a running Elixir backend, When the Go CLI sends POST /api/commands, Then all mutations route to CommandRouter.dispatch',
      },
      'AC-001-2': {
        id: 'AC-001-2',
        reqId: 'REQ-001',
        given: 'an invalid JSON payload',
        when: 'the POST request is received',
        then: 'the system returns a 400 error',
        text: 'Given an invalid JSON payload, When the POST request is received, Then the system returns a 400 error',
      },
    },
  };

  const optsWithPrd = { ...OPTS, prdContext: prdCtx };
  const planWithPrd = buildScaffoldPlan(buildTwoPhaseParsed(), optsWithPrd);

  test('impl task embeds PRD requirement title and prose when prdContext is provided', () => {
    const t = planWithPrd.tasks.find((x) => x.id === 'TRD-001');
    expect(t.description).toContain('--- PRD Context ---');
    expect(t.description).toContain('**Requirement REQ-001**: HTTP command ingress');
    expect(t.description).toContain('MUST accept commands via HTTP POST');
  });

  test('impl task embeds AC Given/When/Then breakdown for validatesAcs', () => {
    const t = planWithPrd.tasks.find((x) => x.id === 'TRD-001');
    expect(t.description).toContain('**Acceptance Criteria:**');
    expect(t.description).toContain('AC-001-1');
    expect(t.description).toContain('Given a running Elixir backend');
    expect(t.description).toContain('When the Go CLI sends POST /api/commands');
    expect(t.description).toContain('Then all mutations route to CommandRouter.dispatch');
  });

  test('impl task omits PRD block when no matching requirement in prdContext', () => {
    // TRD-003 satisfies REQ-003 which is not in prdCtx
    const t = planWithPrd.tasks.find((x) => x.id === 'TRD-003');
    expect(t.description).not.toContain('--- PRD Context ---');
  });

  test('test task embeds PRD enrichment via same prdContext', () => {
    const t = planWithPrd.tasks.find((x) => x.id === 'TRD-001-TEST');
    expect(t.description).toContain('--- PRD Context ---');
    expect(t.description).toContain('**Requirement REQ-001**: HTTP command ingress');
  });

  test('task without satisfies req (INFRA) does not emit PRD block', () => {
    const t = planWithPrd.tasks.find((x) => x.id === 'TRD-002');
    expect(t.description).not.toContain('--- PRD Context ---');
  });
});

describe('buildScaffoldPlan — TRD Context enrichment', () => {
  const planWithCtx = buildScaffoldPlan(buildTwoPhaseParsedWithTrdCtx(), OPTS);
  const planWithoutCtx = buildScaffoldPlan(buildTwoPhaseParsed(), OPTS);

  test('impl task emits --- TRD Context --- when architectureDecision is present', () => {
    const t = planWithCtx.tasks.find((x) => x.id === 'TRD-001');
    expect(t.description).toContain('--- TRD Context ---');
    expect(t.description).toContain('Chosen Approach');
    expect(t.description).toContain('Typed-Events-First');
    expect(t.description).toContain('Rationale:');
  });

  test('impl task emits --- TRD Context --- when keyTechnicalDecisions is present', () => {
    const t = planWithCtx.tasks.find((x) => x.id === 'TRD-001');
    expect(t.description).toContain('**Key Technical Decisions:**');
    expect(t.description).toContain('1. EventCodec dual-read path');
    expect(t.description).toContain('2. Versioned envelope');
  });

  test('test task emits --- TRD Context --- when architectureDecision is present', () => {
    const t = planWithCtx.tasks.find((x) => x.id === 'TRD-001-TEST');
    expect(t.description).toContain('--- TRD Context ---');
    expect(t.description).toContain('Chosen Approach');
  });

  test('impl and test tasks omit --- TRD Context --- when both fields are absent', () => {
    const impl = planWithoutCtx.tasks.find((x) => x.id === 'TRD-001');
    const test = planWithoutCtx.tasks.find((x) => x.id === 'TRD-001-TEST');
    expect(impl.description).not.toContain('--- TRD Context ---');
    expect(test.description).not.toContain('--- TRD Context ---');
  });

  test('impl task emits --- TRD Context --- from keyTechnicalDecisions alone (no architectureDecision)', () => {
    const plan = buildScaffoldPlan(buildTwoPhaseParsedWithDecisionsOnly(), OPTS);
    const t = plan.tasks.find((x) => x.id === 'TRD-001');
    expect(t.description).toContain('--- TRD Context ---');
    expect(t.description).toContain('**Key Technical Decisions:**');
    expect(t.description).not.toContain('Rationale:');
  });
});

// ---------------------------------------------------------------------------
// Synthesized tests
// ---------------------------------------------------------------------------

describe('buildScaffoldPlan — synthesized tests', () => {
  const plan = buildScaffoldPlan(buildTwoPhaseParsed(), OPTS);

  test('one synthesized test per testSubitems entry with -TEST-S<k> id', () => {
    expect(plan.synthesizedTests).toHaveLength(1);
    const synth = plan.synthesizedTests[0];
    expect(synth.id).toBe('TRD-001-TEST-S1');
    expect(synth.parentId).toBe('TRD-001');
    expect(synth.phaseN).toBe(1);
    expect(synth.titlePrefix).toBe('[trd:demo-trd:task:TRD-001-TEST-S1]');
    expect(synth.title).toBe('[trd:demo-trd:task:TRD-001-TEST-S1] Write a unit test for core');
    expect(synth.verifies).toBe('TRD-001');
    expect(synth.satisfies).toEqual(['REQ-001']);
    expect(synth.description).toContain('## Synthesized Test Task: TRD-001-TEST-S1');
    expect(synth.description).toContain('Derived from a nested test sub-item of TRD-001');
  });

  test('multiple testSubitems produce sequential 1-based ids', () => {
    const parsed = buildTwoPhaseParsed();
    parsed.tasksById['TRD-001'].testSubitems = ['unit test A', 'integration test B'];
    const plan = buildScaffoldPlan(parsed, OPTS);
    expect(plan.synthesizedTests.map((s) => s.id)).toEqual([
      'TRD-001-TEST-S1',
      'TRD-001-TEST-S2',
    ]);
    expect(plan.synthesizedTests.every((s) => s.verifies === 'TRD-001')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dependency edges
// ---------------------------------------------------------------------------

describe('buildScaffoldPlan — dependency edges', () => {
  const plan = buildScaffoldPlan(buildTwoPhaseParsed(), OPTS);

  test('story-blocks-epic for every story (blocker=story, blocked=epic)', () => {
    const edges = depsOfType(plan, 'story-blocks-epic');
    expect(edges).toHaveLength(2);
    for (const e of edges) {
      expect(e.blockedId).toBe('[trd:demo-trd]');
      expect(e.blockerId).toMatch(/^\[trd:demo-trd:pr:\d\]$/);
    }
  });

  test('task-blocks-story for every task and synth test (blocker=task, blocked=story)', () => {
    const edges = depsOfType(plan, 'task-blocks-story');
    // 4 real tasks + 1 synth test = 5 task-blocks-story edges
    expect(edges).toHaveLength(5);
    const t1 = edges.find((e) => e.blockerId === '[trd:demo-trd:task:TRD-001]');
    expect(t1.blockedId).toBe('[trd:demo-trd:pr:1]');
    const t3 = edges.find((e) => e.blockerId === '[trd:demo-trd:task:TRD-003]');
    expect(t3.blockedId).toBe('[trd:demo-trd:pr:2]');
  });

  test('task-depends: dep blocks task (blocker=dep, blocked=task)', () => {
    const edges = depsOfType(plan, 'task-depends');
    // TRD-001-TEST depends on TRD-001; TRD-003 depends on TRD-001
    expect(edges).toHaveLength(2);
    const e = edges.find((x) => x.blockedId === '[trd:demo-trd:task:TRD-001-TEST]');
    expect(e.blockerId).toBe('[trd:demo-trd:task:TRD-001]');
  });

  test('synthtest-depends: parent impl task blocks the synth test', () => {
    const edges = depsOfType(plan, 'synthtest-depends');
    expect(edges).toHaveLength(1);
    const e = edges[0];
    expect(e.blockerId).toBe('[trd:demo-trd:task:TRD-001]');
    expect(e.blockedId).toBe('[trd:demo-trd:task:TRD-001-TEST-S1]');
  });

  test('all four dep edge types are present', () => {
    const types = new Set(plan.deps.map((d) => d.type));
    expect(types).toEqual(
      new Set([
        'story-blocks-epic',
        'task-blocks-story',
        'task-depends',
        'synthtest-depends',
      ]),
    );
  });
});


// ---------------------------------------------------------------------------
// Unknown dependency handling
// ---------------------------------------------------------------------------

describe('buildScaffoldPlan — unknown dependsOn id', () => {
  const plan = buildScaffoldPlan(buildLegacyParsed(), OPTS);

  test('known dep produces an edge, unknown dep produces a warning and is skipped', () => {
    const edges = depsOfType(plan, 'task-depends');
    // TRD-011 depends on TRD-010 (known) and TRD-999 (unknown)
    expect(edges).toHaveLength(1);
    expect(edges[0].blockerId).toBe('[trd:demo-trd:task:TRD-010]');
    expect(edges[0].blockedId).toBe('[trd:demo-trd:task:TRD-011]');
  });

  test('warning names the unknown dependency', () => {
    expect(plan.warnings.some((w) => w.includes('TRD-999'))).toBe(true);
  });

  test('never throws on malformed input', () => {
    expect(() => buildScaffoldPlan(null, null)).not.toThrow();
    const empty = buildScaffoldPlan(null, null);
    expect(empty.epic).toBeDefined();
    expect(empty.stories).toEqual([]);
    expect(empty.tasks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// never-throw contract — null / non-object task entries (regression)
// ---------------------------------------------------------------------------

describe('buildScaffoldPlan — null/non-object task entries', () => {
  const OK = { trdSlug: 's', trdFilePath: 't', prdFilePath: 'p' };

  test('a phase-referenced null task is skipped with a warning, not thrown', () => {
    // Regression: buildScaffoldPlan previously threw
    // "Cannot read properties of null (reading 'id')" when tasksById held a
    // null entry referenced by a phase.
    const parsed = {
      title: 'X',
      prFormat: true,
      phases: [{ n: 1, taskIds: ['A'] }],
      tasksById: { A: null },
    };
    let plan;
    expect(() => {
      plan = buildScaffoldPlan(parsed, OK);
    }).not.toThrow();
    expect(plan.tasks).toEqual([]);
    expect(plan.warnings.some((w) => w.includes('A') && /no valid task object/i.test(w))).toBe(true);
    // Story still exists, so its story-blocks-epic edge is still present.
    expect(depsOfType(plan, 'story-blocks-epic')).toHaveLength(1);
  });

  test('an orphan null task (in tasksById, not in any phase) is skipped, not thrown', () => {
    const parsed = { title: 'X', phases: [], tasksById: { A: null } };
    let plan;
    expect(() => {
      plan = buildScaffoldPlan(parsed, OK);
    }).not.toThrow();
    expect(plan.tasks).toEqual([]);
    expect(plan.warnings.some((w) => /no valid task object/i.test(w))).toBe(true);
  });

  test('a dependsOn pointing at a null task is skipped (no undefined-prefix edge)', () => {
    const parsed = {
      title: 'X',
      phases: [{ n: 1, taskIds: ['A', 'B'] }],
      tasksById: { A: null, B: { id: 'B', dependsOn: ['A'] } },
    };
    const plan = buildScaffoldPlan(parsed, OK);
    // No task-depends edge wired to a non-existent (null) bead.
    expect(depsOfType(plan, 'task-depends')).toHaveLength(0);
    // No emitted edge carries an undefined blocker/blocked id.
    for (const e of plan.deps) {
      expect(e.blockerId).toBeDefined();
      expect(e.blockedId).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Integration sanity: real fixture parsed by trd-parser
// ---------------------------------------------------------------------------

describe('buildScaffoldPlan — integration with real fixture', () => {
  const md = fs.readFileSync(
    path.join(__dirname, 'fixtures', 'TRD-2026-023-trd-staleness-gate.md'),
    'utf8',
  );
  const parsed = parseTRD(md);
  const plan = buildScaffoldPlan(parsed, {
    trdSlug: 'trd-2026-023',
    trdFilePath: 'docs/TRD/trd-2026-023.md',
    prdFilePath: 'docs/PRD/prd-2026-023.md',
  });

  test('epic reflects parsed title', () => {
    expect(plan.epic.titlePrefix).toBe('[trd:trd-2026-023]');
    expect(plan.epic.title).toBe(`[trd:trd-2026-023] Implement TRD: ${parsed.title}`);
  });

  test('one story per parsed phase', () => {
    expect(plan.stories).toHaveLength(parsed.phases.length);
    // fixture is PR format -> pr prefix
    expect(plan.stories[0].titlePrefix).toMatch(/^\[trd:trd-2026-023:pr:\d\]$/);
  });

  test('one task per parsed task', () => {
    const taskCount = Object.keys(parsed.tasksById).length;
    expect(plan.tasks).toHaveLength(taskCount);
    expect(taskCount).toBe(9);
  });

  test('plan contains the expected dep edge types', () => {
    const types = new Set(plan.deps.map((d) => d.type));
    expect(types.has('story-blocks-epic')).toBe(true);
    expect(types.has('task-blocks-story')).toBe(true);
    expect(types.has('task-depends')).toBe(true);
  });

  test('explicit task-depends edges reflect the fixture dependency graph', () => {
    const edges = depsOfType(plan, 'task-depends');
    // fixture has 7 intra-known deps plus TRD-005 -> {TRD-002,TRD-003,TRD-004}
    expect(edges.length).toBeGreaterThanOrEqual(7);
    const dep005 = edges.filter(
      (e) => e.blockedId === '[trd:trd-2026-023:task:TRD-005]',
    );
    expect(dep005.map((e) => e.blockerId).sort()).toEqual([
      '[trd:trd-2026-023:task:TRD-002]',
      '[trd:trd-2026-023:task:TRD-003]',
      '[trd:trd-2026-023:task:TRD-004]',
    ]);
  });
});
