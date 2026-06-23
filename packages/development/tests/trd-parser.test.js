/**
 * Unit tests for the deterministic TRD parser (lib/trd-parser.js).
 *
 * The parser ports the "Scaffold Pass 1-7 + 4b/4c" prose logic from
 * implement-trd-beads.yaml into a pure, testable function. These tests pin
 * the ParsedTRD contract that downstream modules depend on.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { parseTRD } = require('../lib/trd-parser');

// ---------------------------------------------------------------------------
// Inline fixtures
// ---------------------------------------------------------------------------

const LEGACY_PHASE_TRD = `# TRD-100: Legacy Phase Format

A short summary paragraph describing the work.

## Master Task List

### Phase 1: Foundation

- [ ] **TRD-001**: Build the foundation (2h)
- [ ] **TRD-002**: Add config loading (1h)

### Phase 2: API

- [ ] **TRD-003**: Implement the API (3h)
`;

const LEGACY_SPRINT_TRD = `# TRD-101: Legacy Sprint Format

Summary line here.

## Master Task List

### Sprint 1: Kickoff

- [ ] **TRD-001**: First task (2h)

### Sprint 2: Wrap

- [ ] **TRD-002**: Second task (4h)
`;

const NO_BOUNDARY_TRD = `# TRD-102: No Boundary

Just a description.

## Master Task List

- [ ] **TRD-001**: Do thing one (2h)
- [ ] **TRD-002**: Do thing two (1h)
`;

const TEST_CLASSIFICATION_TRD = `# TRD-103: Test Classification

Summary.

## Master Task List

### PR 1: Feature

**Shippable State:** Users can do the thing.

- [ ] **TRD-001**: Implement feature (2h) [satisfies REQ-001]
- [ ] **TRD-001-TEST**: Verify feature (1h) [verifies TRD-001] [satisfies REQ-001] [depends: TRD-001]
`;

const SUBITEM_TRD = `# TRD-104: Sub-items

Summary.

## Master Task List

### PR 1: Feature

**Shippable State:** Users can log in.

- [ ] **TRD-001**: Build login (3h) [satisfies REQ-001]
  - Actions:
    1. Create the endpoint
    2. Wire the handler
  - [ ] write unit tests for the handler
  - [ ] update docs for the endpoint

- [ ] **TRD-002**: Build logout (1h) [satisfies REQ-002]
  - [ ] add e2e coverage
`;

// AC-block checklist items (and Actions) must NOT leak into nestedSubitems /
// testSubitems. The Implementation AC item below intentionally mentions "test"
// to prove an AC line is never reclassified as a loose test sub-item.
const AC_LEAK_TRD = `# TRD-112: AC Leak Guard

Summary.

## Master Task List

### PR 1: Feature

**Shippable State:** Users can do the thing.

- [ ] **TRD-001**: Build it (2h) [satisfies REQ-001]
  - Implementation AC:
    - [ ] Given the test suite passes, when run, then output is correct
    - [ ] Handles empty input gracefully
  - Test AC:
    - [ ] Given a fixture, when tested, then it passes
  - [ ] write actual unit tests for the handler
  - [ ] update the docs
`;

const ANNOTATIONS_TRD = `# TRD-105: Annotations

Summary.

## Master Task List

### PR 1: Annotated

**Shippable State:** Everything is annotated.

- [ ] **TRD-001**: Infra task (1h) [satisfies INFRA] [depends: TRD-000]
- [ ] **TRD-002**: Arch task (1h) [satisfies ARCH]
- [ ] **TRD-003**: Real task (2h) [satisfies REQ-007] [depends: TRD-001]
  - Dependencies: TRD-002, TRD-001
- [ ] **TRD-003-TEST**: Test it (0.5h) [verifies TRD-003] [satisfies REQ-007]
  - Validates PRD ACs: AC-007-1, AC-007-2
`;

const BODY_FIELDS_TRD = `# TRD-106: Body Fields

Summary.

## Master Task List

### PR 1: Bodywork

**Shippable State:** Full body coverage.

- [ ] **TRD-001**: Implement core (3h) [satisfies REQ-001]
  - Validates PRD ACs: AC-001-1, AC-001-2
  - Target File: \`src/core.js\`
  - Actions:
    1. Write the core module
    2. Export the public API
  - Implementation AC:
    - Given input X, when run, then output Y
    - Handles empty input gracefully

- [ ] **TRD-001-TEST**: Test core (1h) [verifies TRD-001] [satisfies REQ-001]
  - Target Files: \`src/core.test.js\`, \`src/core.fixtures.js\`
  - Test AC:
    - Given a fixture, when tested, then it passes
  - Proof of requirement: All ACs map to passing tests
`;

const SCOPING_TRD = `---
design_readiness_score: 4.5
prd_reference: docs/PRD/PRD-2026-099-example.md
---

# TRD-107: Scoping Guard

Based on PRD: docs/PRD/PRD-2026-099-example.md

---

This is the real summary paragraph.

## Master Task List

### PR 1: Real Work

**Shippable State:** Users see real output.

- [ ] **TRD-001**: Real task (2h) [satisfies REQ-001]

## Sprint Planning

### Sprint 1 (single PR — ~2h total)

- **PR 1 tasks**: TRD-001
`;

const DUPLICATE_TRD = `# TRD-108: Duplicates

Summary.

## Master Task List

### PR 1: Dupes

**Shippable State:** Tasks exist.

- [ ] **TRD-001**: First definition (2h)
- [ ] **TRD-001**: Second definition (3h)
`;

const EMPTY_TRD = `# TRD-109: Empty

Just a title and a summary, no tasks at all.
`;

const HOUR_ESTIMATE_TRD = `# TRD-110: Hours

Summary.

## Master Task List

### PR 1: Hours

**Shippable State:** Hours parsed.

- [ ] **TRD-001**: Two hours (2h)
- [ ] **TRD-002**: Half hour (0.5h)
- [ ] **TRD-003**: No estimate here
`;

const MISSING_SHIPPABLE_TRD = `# TRD-111: Missing Shippable

Summary.

## Master Task List

### PR 1: No Shippable State

- [ ] **TRD-001**: A task (1h)
`;

// ---------------------------------------------------------------------------
// PR format (real repo fixture)
// ---------------------------------------------------------------------------

describe('parseTRD — PR format (real fixture)', () => {
  let result;

  beforeAll(() => {
    const fixturePath = path.resolve(__dirname, 'fixtures/TRD-2026-023-trd-staleness-gate.md');
    const md = fs.readFileSync(fixturePath, 'utf8');
    result = parseTRD(md);
  });

  it('detects PR format', () => {
    expect(result.prFormat).toBe(true);
  });

  it('extracts the H1 title', () => {
    expect(result.title).toBe('TRD-2026-023: TRD Staleness Gate');
  });

  it('extracts the design readiness score from frontmatter', () => {
    expect(result.designReadinessScore).toBe(4.88);
  });

  it('resolves the PRD reference to the docs/PRD path', () => {
    expect(result.prdReference).toBe('docs/PRD/PRD-2026-022-trd-staleness-gate.md');
  });

  it('finds exactly one PR phase', () => {
    expect(result.phases).toHaveLength(1);
    expect(result.phases[0].n).toBe(1);
    expect(result.phases[0].title).toBe('TRD Staleness Gate');
  });

  it('captures the Shippable State', () => {
    expect(result.phases[0].shippableState).toMatch(/staleness gate on first invocation/i);
  });

  it('collects all 9 task ids in the phase in document order', () => {
    expect(result.phases[0].taskIds).toEqual([
      'TRD-001',
      'TRD-001-TEST',
      'TRD-002',
      'TRD-002-TEST',
      'TRD-003',
      'TRD-003-TEST',
      'TRD-004',
      'TRD-004-TEST',
      'TRD-005',
    ]);
  });

  it('does NOT misread the Sprint Planning section as a boundary', () => {
    // Sprint 1 lives in ## Sprint Planning, outside the Master Task List scope.
    expect(Object.keys(result.tasksById)).toHaveLength(9);
  });

  it('classifies -TEST tasks correctly and populates verifies', () => {
    expect(result.tasksById['TRD-001-TEST'].isTest).toBe(true);
    expect(result.tasksById['TRD-001-TEST'].verifies).toBe('TRD-001');
    expect(result.tasksById['TRD-001'].isTest).toBe(false);
  });

  it('extracts satisfies tokens including INFRA', () => {
    expect(result.tasksById['TRD-001'].satisfies).toContain('REQ-001');
    expect(result.tasksById['TRD-005'].satisfies).toContain('INFRA');
  });

  it('extracts validatesAcs from the Validates PRD ACs field', () => {
    expect(result.tasksById['TRD-002'].validatesAcs).toContain('AC-006-1');
  });

  it('extracts dependsOn from inline [depends:] annotations', () => {
    expect(result.tasksById['TRD-002'].dependsOn).toContain('TRD-001');
    expect(result.tasksById['TRD-005'].dependsOn).toEqual(
      expect.arrayContaining(['TRD-002', 'TRD-003', 'TRD-004'])
    );
  });

  it('extracts target files', () => {
    expect(result.tasksById['TRD-002'].targetFiles).toContain(
      'packages/development/commands/implement-trd-beads.yaml'
    );
  });

  it('extracts numbered actions', () => {
    expect(result.tasksById['TRD-001'].actions.length).toBeGreaterThan(0);
  });

  it('extracts proof of requirement on test tasks', () => {
    expect(result.tasksById['TRD-001-TEST'].proofOfRequirement).toMatch(/14 ACs/);
  });

  it('parses hour estimates including decimals', () => {
    expect(result.tasksById['TRD-001'].hourEstimate).toBe(3);
    expect(result.tasksById['TRD-003-TEST'].hourEstimate).toBe(0.5);
  });

  it('produces no warnings for a well-formed PR-format TRD', () => {
    expect(result.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Legacy Phase / Sprint formats
// ---------------------------------------------------------------------------

describe('parseTRD — legacy Phase format', () => {
  let result;
  beforeAll(() => {
    result = parseTRD(LEGACY_PHASE_TRD);
  });

  it('sets prFormat to false', () => {
    expect(result.prFormat).toBe(false);
  });

  it('finds two phases', () => {
    expect(result.phases).toHaveLength(2);
    expect(result.phases[0].title).toBe('Foundation');
    expect(result.phases[1].title).toBe('API');
  });

  it('assigns tasks to the correct phase', () => {
    expect(result.phases[0].taskIds).toEqual(['TRD-001', 'TRD-002']);
    expect(result.phases[1].taskIds).toEqual(['TRD-003']);
  });

  it('does not warn about missing Shippable State for Phase format', () => {
    expect(result.warnings.filter((w) => /Shippable State/i.test(w))).toEqual([]);
  });
});

describe('parseTRD — legacy Sprint format', () => {
  let result;
  beforeAll(() => {
    result = parseTRD(LEGACY_SPRINT_TRD);
  });

  it('sets prFormat to false', () => {
    expect(result.prFormat).toBe(false);
  });

  it('finds two sprint phases with correct tasks', () => {
    expect(result.phases).toHaveLength(2);
    expect(result.phases[0].taskIds).toEqual(['TRD-001']);
    expect(result.phases[1].taskIds).toEqual(['TRD-002']);
  });
});

// ---------------------------------------------------------------------------
// No boundary -> synthesized single phase
// ---------------------------------------------------------------------------

describe('parseTRD — no boundary headings', () => {
  let result;
  beforeAll(() => {
    result = parseTRD(NO_BOUNDARY_TRD);
  });

  it('synthesizes a single Implementation phase', () => {
    expect(result.prFormat).toBe(false);
    expect(result.phases).toHaveLength(1);
    expect(result.phases[0].n).toBe(1);
    expect(result.phases[0].title).toBe('Implementation');
  });

  it('assigns all tasks to the synthesized phase', () => {
    expect(result.phases[0].taskIds).toEqual(['TRD-001', 'TRD-002']);
  });
});

// ---------------------------------------------------------------------------
// -TEST classification
// ---------------------------------------------------------------------------

describe('parseTRD — -TEST classification', () => {
  let result;
  beforeAll(() => {
    result = parseTRD(TEST_CLASSIFICATION_TRD);
  });

  it('marks the -TEST task as a test task', () => {
    expect(result.tasksById['TRD-001-TEST'].isTest).toBe(true);
  });

  it('marks the impl task as not a test task', () => {
    expect(result.tasksById['TRD-001'].isTest).toBe(false);
  });

  it('populates verifies on the test task', () => {
    expect(result.tasksById['TRD-001-TEST'].verifies).toBe('TRD-001');
  });
});

// ---------------------------------------------------------------------------
// Sub-item detection (Pass 4b / 4c)
// ---------------------------------------------------------------------------

describe('parseTRD — nested sub-item detection', () => {
  let result;
  beforeAll(() => {
    result = parseTRD(SUBITEM_TRD);
  });

  it('captures nested checklist sub-items that lack their own TRD id', () => {
    const t1 = result.tasksById['TRD-001'];
    expect(t1.nestedSubitems).toEqual(
      expect.arrayContaining([
        'write unit tests for the handler',
        'update docs for the endpoint',
      ])
    );
  });

  it('classifies the test sub-item into testSubitems', () => {
    const t1 = result.tasksById['TRD-001'];
    expect(t1.testSubitems).toContain('write unit tests for the handler');
  });

  it('does NOT classify the docs sub-item as a test sub-item', () => {
    const t1 = result.tasksById['TRD-001'];
    expect(t1.testSubitems).not.toContain('update docs for the endpoint');
  });

  it('classifies an e2e/coverage sub-item as a test sub-item', () => {
    const t2 = result.tasksById['TRD-002'];
    expect(t2.nestedSubitems).toContain('add e2e coverage');
    expect(t2.testSubitems).toContain('add e2e coverage');
  });

  it('does not pull the next top-level task into the previous task body', () => {
    // TRD-002 must not appear in TRD-001's nestedSubitems.
    const t1 = result.tasksById['TRD-001'];
    expect(t1.nestedSubitems.join(' ')).not.toMatch(/Build logout/);
  });
});

// ---------------------------------------------------------------------------
// nestedSubitems must EXCLUDE AC-block / Actions items (regression pin)
// ---------------------------------------------------------------------------

describe('parseTRD — AC-block items do not leak into nestedSubitems', () => {
  let task;
  beforeAll(() => {
    task = parseTRD(AC_LEAK_TRD).tasksById['TRD-001'];
  });

  it('captures Implementation AC items in implementationAc only', () => {
    expect(task.implementationAc).toEqual([
      'Given the test suite passes, when run, then output is correct',
      'Handles empty input gracefully',
    ]);
  });

  it('captures Test AC items in testAc, without swallowing the loose sub-item', () => {
    expect(task.testAc).toEqual(['Given a fixture, when tested, then it passes']);
  });

  it('nestedSubitems contains ONLY the loose checklist items', () => {
    expect(task.nestedSubitems).toEqual([
      'write actual unit tests for the handler',
      'update the docs',
    ]);
  });

  it('an Implementation AC item mentioning "test" is NOT added to testSubitems', () => {
    expect(task.testSubitems).not.toContain(
      'Given the test suite passes, when run, then output is correct'
    );
  });

  it('a Test AC item is NOT added to testSubitems', () => {
    expect(task.testSubitems).not.toContain(
      'Given a fixture, when tested, then it passes'
    );
  });

  it('testSubitems contains only the genuinely-loose test sub-item', () => {
    expect(task.testSubitems).toEqual(['write actual unit tests for the handler']);
  });
});

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

describe('parseTRD — annotations', () => {
  let result;
  beforeAll(() => {
    result = parseTRD(ANNOTATIONS_TRD);
  });

  it('extracts INFRA satisfies token', () => {
    expect(result.tasksById['TRD-001'].satisfies).toEqual(['INFRA']);
  });

  it('extracts ARCH satisfies token', () => {
    expect(result.tasksById['TRD-002'].satisfies).toEqual(['ARCH']);
  });

  it('extracts REQ satisfies token', () => {
    expect(result.tasksById['TRD-003'].satisfies).toEqual(['REQ-007']);
  });

  it('merges dependsOn from both [depends:] and Dependencies: forms', () => {
    const t3 = result.tasksById['TRD-003'];
    // inline [depends: TRD-001] plus "Dependencies: TRD-002, TRD-001"
    expect(t3.dependsOn).toEqual(expect.arrayContaining(['TRD-001', 'TRD-002']));
    // de-duplicated
    expect(t3.dependsOn.filter((d) => d === 'TRD-001')).toHaveLength(1);
  });

  it('extracts verifies on the test task', () => {
    expect(result.tasksById['TRD-003-TEST'].verifies).toBe('TRD-003');
  });

  it('extracts validatesAcs', () => {
    expect(result.tasksById['TRD-003-TEST'].validatesAcs).toEqual([
      'AC-007-1',
      'AC-007-2',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Body fields
// ---------------------------------------------------------------------------

describe('parseTRD — body field extraction', () => {
  let result;
  beforeAll(() => {
    result = parseTRD(BODY_FIELDS_TRD);
  });

  it('extracts a single Target File', () => {
    expect(result.tasksById['TRD-001'].targetFiles).toEqual(['src/core.js']);
  });

  it('extracts multiple comma-separated Target Files', () => {
    expect(result.tasksById['TRD-001-TEST'].targetFiles).toEqual([
      'src/core.test.js',
      'src/core.fixtures.js',
    ]);
  });

  it('extracts numbered actions', () => {
    expect(result.tasksById['TRD-001'].actions).toEqual([
      'Write the core module',
      'Export the public API',
    ]);
  });

  it('extracts Implementation AC checklist', () => {
    expect(result.tasksById['TRD-001'].implementationAc).toEqual([
      'Given input X, when run, then output Y',
      'Handles empty input gracefully',
    ]);
  });

  it('extracts Test AC checklist', () => {
    expect(result.tasksById['TRD-001-TEST'].testAc).toEqual([
      'Given a fixture, when tested, then it passes',
    ]);
  });

  it('extracts Proof of requirement', () => {
    expect(result.tasksById['TRD-001-TEST'].proofOfRequirement).toBe(
      'All ACs map to passing tests'
    );
  });
});

// ---------------------------------------------------------------------------
// Scoping: Master Task List vs Sprint Planning
// ---------------------------------------------------------------------------

describe('parseTRD — Master Task List scoping', () => {
  let result;
  beforeAll(() => {
    result = parseTRD(SCOPING_TRD);
  });

  it('uses PR format from the Master Task List, ignoring ### Sprint 1 in Sprint Planning', () => {
    expect(result.prFormat).toBe(true);
    expect(result.phases).toHaveLength(1);
    expect(result.phases[0].title).toBe('Real Work');
  });

  it('only parses tasks inside the Master Task List scope', () => {
    expect(Object.keys(result.tasksById)).toEqual(['TRD-001']);
  });

  it('extracts the frontmatter design readiness score', () => {
    expect(result.designReadinessScore).toBe(4.5);
  });

  it('resolves the PRD reference', () => {
    expect(result.prdReference).toBe('docs/PRD/PRD-2026-099-example.md');
  });

  it('skips Based on PRD / hr / blockquote lines when building the summary', () => {
    expect(result.summary).toBe('This is the real summary paragraph.');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('parseTRD — edge cases', () => {
  it('warns and does not throw on an empty / no-tasks document', () => {
    const result = parseTRD(EMPTY_TRD);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/No tasks found/i)])
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/No "## Master Task List"/i)])
    );
    expect(Object.keys(result.tasksById)).toHaveLength(0);
  });

  it('does not throw on an empty string', () => {
    expect(() => parseTRD('')).not.toThrow();
    const result = parseTRD('');
    expect(result.title).toBe('');
    expect(result.phases.length).toBeGreaterThanOrEqual(1);
  });

  it('warns on duplicate task ids and keeps the first definition', () => {
    const result = parseTRD(DUPLICATE_TRD);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/Duplicate task id: TRD-001/)])
    );
    expect(result.tasksById['TRD-001'].hourEstimate).toBe(2); // first def wins
    expect(Object.keys(result.tasksById)).toHaveLength(1);
  });

  it('parses scalar frontmatter without requiring js-yaml at runtime', () => {
    const script = `
      const Module = require('module');
      const originalLoad = Module._load;
      Module._load = function(request, parent, isMain) {
        if (request === 'js-yaml') throw new Error('Cannot find module js-yaml');
        return originalLoad.apply(this, arguments);
      };
      const { parseTRD } = require('./packages/development/lib/trd-parser');
      const result = parseTRD(\`---
design_readiness_score: 4.7
status: Draft
prd_reference: docs/PRD/frontmatter-only.md
---

# TRD-200: Frontmatter Fallback

Summary.

## Master Task List

- [ ] **TRD-001**: Do work (1h)
\`);
      process.stdout.write(JSON.stringify({ score: result.designReadinessScore, status: result.status, prd: result.prdReference }));
    `;
    const child = spawnSync(process.execPath, ['-e', script], { cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8' });
    expect(child.stderr).toBe('');
    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({ score: 4.7, status: 'Draft', prd: 'docs/PRD/frontmatter-only.md' });
  });

  it('warns when a PR-format phase has no Shippable State', () => {
    const result = parseTRD(MISSING_SHIPPABLE_TRD);
    expect(result.phases[0].shippableState).toBeNull();
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/missing a Shippable State/i)])
    );
  });
});

// ---------------------------------------------------------------------------
// hourEstimate
// ---------------------------------------------------------------------------

describe('parseTRD — hour estimates', () => {
  let result;
  beforeAll(() => {
    result = parseTRD(HOUR_ESTIMATE_TRD);
  });

  it('parses integer hours', () => {
    expect(result.tasksById['TRD-001'].hourEstimate).toBe(2);
  });

  it('parses decimal hours', () => {
    expect(result.tasksById['TRD-002'].hourEstimate).toBe(0.5);
  });

  it('returns null when no estimate is present', () => {
    expect(result.tasksById['TRD-003'].hourEstimate).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Contract shape
// ---------------------------------------------------------------------------

describe('parseTRD — ParsedTRD contract shape', () => {
  it('returns the exact top-level keys', () => {
    const result = parseTRD(BODY_FIELDS_TRD);
    expect(Object.keys(result).sort()).toEqual(
      [
        'designReadinessScore',
        'phases',
        'prFormat',
        'prdReference',
        'status',
        'summary',
        'tasksById',
        'title',
        'warnings',
      ].sort()
    );
  });

  it('each task carries the full Task shape', () => {
    const result = parseTRD(BODY_FIELDS_TRD);
    const task = result.tasksById['TRD-001'];
    expect(Object.keys(task).sort()).toEqual(
      [
        'actions',
        'dependsOn',
        'description',
        'hourEstimate',
        'id',
        'implementationAc',
        'isTest',
        'nestedSubitems',
        'phaseN',
        'proofOfRequirement',
        'satisfies',
        'targetFiles',
        'testAc',
        'testSubitems',
        'validatesAcs',
        'verifies',
      ].sort()
    );
  });

  it('each phase carries the full Phase shape', () => {
    const result = parseTRD(BODY_FIELDS_TRD);
    expect(Object.keys(result.phases[0]).sort()).toEqual(
      ['n', 'shippableState', 'taskIds', 'title'].sort()
    );
  });
});


describe('RCA corrective parsing', () => {
  const RCA_TRD = `# TRD-200: RCA Gaps

Summary.

## Acceptance Criteria

- AC-001: Handler validates activity exists
- AC-002-1: Handler enforces tenant isolation
- AC-013a: Event includes all changed fields

## Cross-Cutting Requirements

### XC-001: NATS Event Routing
Requirement: Configure routes for emitted events.

### XC-002: RBAC Permission Codes
Requirement: Seed permission codes for handlers.

## Master Task List

### PR 1: Feature

**Shippable State:** Feature can be verified.

- [ ] **TRD-001**: Implement handler [satisfies REQ-001]
  - Validates PRD ACs: AC-001, AC-002-1
`;

  it('generates synthetic AC validation and cross-cutting tasks', () => {
    const result = parseTRD(RCA_TRD);
    expect(result.tasksById['AC-001'].syntheticKind).toBe('ac-validation');
    expect(result.tasksById['AC-002-1'].dependsOn).toEqual(['TRD-001']);
    expect(result.tasksById['AC-013A'].testAc.join(' ')).toContain('disabled');
    expect(result.tasksById['XC-001'].syntheticKind).toBe('cross-cutting');
    expect(result.tasksById['XC-001'].dependsOn).toEqual(['TRD-001']);
    expect(result.phases[0].taskIds).toEqual(expect.arrayContaining(['AC-001', 'AC-002-1', 'AC-013A', 'XC-001', 'XC-002']));
    expect(result.warnings).toEqual(expect.arrayContaining([
      'Generated 3 acceptance-criteria validation task(s)',
      'Generated 2 cross-cutting requirement task(s)',
    ]));
  });
});
