'use strict';

/** Proof for the ensemble-refine-trd eval: its checks pass on a good refinement and each fails on a plausible wrong one. */

const kit = require('../skill-eval-kit');

const ID = 'ensemble-refine-trd';
const TRD = 'docs/TRD/TRD-2026-c3d4e5f6-slugify.md';

const GOOD = `---
document_id: TRD-2026-c3d4e5f6
label: trd-slugify
kind: trd
prd_reference: PRD-2026-b2c3d4e5
prd_path: docs/PRD/PRD-2026-b2c3d4e5-slugify.md
version: 1.0.1
status: Draft
date: 2026-11-02
design_readiness_score: 4.0
Constitution compliance: passed
---

# TRD-2026-c3d4e5f6: Slugify Helper

## Architecture Decision

**Chosen approach:** One pure function, \`slugify(text)\`, in \`src/slugify.js\`.

## Master Task List

### PR 1: Core slugify
**Shippable State:** A developer can call \`slugify("Hello, World!")\` and get \`hello-world\`.

- [ ] **TRD-001** Implement lowercase and dash-join [satisfies REQ-001] (3h)
  - Validates PRD ACs: AC-001-1, AC-001-2

- [ ] **TRD-001-TEST** Lowercase and dash-join behavior [Verifies TRD-001] [Satisfies REQ-001] [Depends: TRD-001] (2h)

- [ ] **TRD-002** Trim leading and trailing dashes [satisfies REQ-002] [Depends: TRD-001] (2h)

- [ ] **TRD-002-TEST** Trim behavior [Verifies TRD-002] [Satisfies REQ-002] [Depends: TRD-002] (1h)

### PR 2: Input tolerance

**Shippable State:** A developer can call \`slugify(null)\` and get an empty string instead of an exception.

- [ ] **TRD-003** Return an empty string for empty or non-string input [satisfies REQ-003] [Depends: TRD-001] (2h)

- [ ] **TRD-003-TEST** Empty and non-string input [Verifies TRD-003] [Satisfies REQ-003] [Depends: TRD-003] (1h)

## Acceptance Criteria Traceability

| PRD requirement | Implementation task | Test task |
|---|---|---|
| REQ-001 | TRD-001 | TRD-001-TEST |
| REQ-002 | TRD-002 | TRD-002-TEST |
| REQ-003 | TRD-003 | TRD-003-TEST |

## Changelog

- **1.0.1 (2026-11-13):** Refinement: added TRD-002-TEST, the REQ-003 link on TRD-003 and PR 2's Shippable State; refreshed the matrix and readiness score.
- **1.0.0 (2026-11-02):** Initial draft from \`create-trd\`.
`;

/** A stub agent that saves \`text\` as the TRD (and optionally other files). */
const saves = (text, extra = {}) => (ws) => {
  if (text !== null) ws.write(TRD, text);
  for (const [rel, body] of Object.entries(extra)) ws.write(rel, body);
};
const edit = (from, to) => { if (!GOOD.includes(from)) throw new Error(`test bug: ${from}`); return GOOD.replace(from, to); };

describe(`${ID}`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    kit.loadsClean(ID);
  });

  test('a good refinement passes every check', async () => {
    const res = await kit.runEval(ID, saves(GOOD));
    expect(Object.keys(res)).toEqual([
      'trdParses', 'refine-in-place', 'refine-identity', 'refine-version', 'refine-changelog', 'tasks-kept', 'task-links',
      'test-paired', 'shippable', 'traceability', 'readiness', 'prd-untouched', 'no-impl-files',
    ]);
    kit.expectAllPass(res);
  });

  test('the seeded TRD left untouched fails every refinement check (it still has its defects)', async () => {
    const res = await kit.runEval(ID, saves(null));
    kit.expectFails(res, ['refine-version', 'refine-changelog', 'task-links', 'test-paired', 'shippable', 'traceability', 'readiness'], undefined, { only: false });
    expect(res.trdParses.pass).toBe(true);
    expect(res['refine-identity'].pass).toBe(true);
  });

  test('a task removed fails tasks-kept', async () => {
    const res = await kit.runEval(ID, saves(edit(/- \[ \] \*\*TRD-003-TEST\*\*[^\n]*\n\n/.exec(GOOD)[0], '')));
    kit.expectFails(res, 'tasks-kept', /TRD-003-TEST/);
  });

  test('a task that lost its checkbox prefix fails tasks-kept', async () => {
    const res = await kit.runEval(ID, saves(edit('- [ ] **TRD-002** Trim', '**TRD-002** Trim')));
    kit.expectFails(res, 'tasks-kept', /checkbox prefix/);
  });

  test('a regenerated Document ID fails refine-identity', async () => {
    kit.expectFails(await kit.runEval(ID, saves(edit('document_id: TRD-2026-c3d4e5f6', 'document_id: TRD-2026-99999999'))), 'refine-identity', /document_id/, { only: true });
  });

  test('a minor bump instead of a patch bump fails refine-version', async () => {
    kit.expectFails(await kit.runEval(ID, saves(edit('version: 1.0.1', 'version: 1.1.0'))), 'refine-version', /expected "1\.0\.1"/, { only: true });
  });

  test('a changelog that dropped the earlier entry fails refine-changelog', async () => {
    const res = await kit.runEval(ID, saves(edit('- **1.0.0 (2026-11-02):** Initial draft from `create-trd`.\n', '')));
    kit.expectFails(res, 'refine-changelog', /earlier changelog entry/, { only: true });
  });

  test('a new TRD file beside the seeded one (not refined in place) fails refine-in-place', async () => {
    const res = await kit.runEval(ID, saves(GOOD, { 'docs/TRD/TRD-2026-c3d4e5f6-slugify-v2.md': GOOD }));
    kit.expectFails(res, 'refine-in-place', /found/);
  });

  test('a task still without [satisfies] fails task-links; a satisfies of a nonexistent REQ fails it too', async () => {
    kit.expectFails(await kit.runEval(ID, saves(edit(' [satisfies REQ-003] [Depends: TRD-001] (2h)', ' [Depends: TRD-001] (2h)'))), 'task-links', /no \[satisfies/);
    kit.expectFails(await kit.runEval(ID, saves(edit('[satisfies REQ-003]', '[satisfies REQ-042]'))), 'task-links', /REQ-042/);
  });

  test('a dependency on a task that does not exist fails task-links', async () => {
    kit.expectFails(await kit.runEval(ID, saves(edit('[Depends: TRD-003] (1h)', '[Depends: TRD-099] (1h)'))), 'task-links', /TRD-099/, { only: true });
  });

  test('a user-facing task with no test task fails test-paired', async () => {
    const gone = /- \[ \] \*\*TRD-002-TEST\*\*[^\n]*\n\n/.exec(GOOD)[0];
    kit.expectFails(await kit.runEval(ID, saves(edit(gone, ''))), 'test-paired', /TRD-002/);
  });

  test('a PR section without a Shippable State line fails shippable', async () => {
    const res = await kit.runEval(ID, saves(edit(/\*\*Shippable State:\*\* A developer can call `slugify\(null\)`[^\n]*\n\n/.exec(GOOD)[0], '')));
    kit.expectFails(res, 'shippable', /PR 2/, { only: true });
  });

  test('a stale traceability matrix fails traceability', async () => {
    kit.expectFails(await kit.runEval(ID, saves(edit('| REQ-002 | TRD-002 | TRD-002-TEST |', '| REQ-002 | TRD-002 | (none) |'))), 'traceability', /TRD-002-TEST/, { only: true });
  });

  test('a missing or non-numeric readiness score fails readiness', async () => {
    kit.expectFails(await kit.runEval(ID, saves(edit('design_readiness_score: 4.0\n', ''))), 'readiness', /missing/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(edit('design_readiness_score: 4.0', 'design_readiness_score: high'))), 'readiness', /expected a number/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(edit('design_readiness_score: 4.0', 'design_readiness_score: 9'))), 'readiness', /expected a number/, { only: true });
  });

  test('an edited PRD fails prd-untouched', async () => {
    const res = await kit.runEval(ID, (ws) => {
      ws.write(TRD, GOOD);
      ws.write('docs/PRD/PRD-2026-b2c3d4e5-slugify.md', ws.read('docs/PRD/PRD-2026-b2c3d4e5-slugify.md').replace('status: Locked', 'status: Draft'));
    });
    kit.expectFails(res, 'prd-untouched', /the PRD changed/, { only: true });
  });

  test('an implementation file written next to a good TRD fails no-impl-files', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD, { 'src/slugify.js': 'module.exports = {};\n' })), 'no-impl-files', /src\/slugify\.js/, { only: true });
  });

  test('a TRD with a non-parsing Master Task List fails trdParses', async () => {
    kit.expectFails(await kit.runEval(ID, saves('# not a TRD\n')), 'trdParses');
  });

  test('arms: baseline loads nothing, with-skill loads the plugin; the command prefixes only the with-skill prompt', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.prompt.startsWith('/ensemble-development:ensemble:refine-trd ')).toBe(true);
    expect(baseline.prompt).not.toMatch(/^\//);
    expect(baseline.prompt).toMatch(/--foreman/);
  }, 60000);
});
