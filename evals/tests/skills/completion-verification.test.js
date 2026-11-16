'use strict';

/** Proof that the completion-verification eval's checks pass on a good report and fail on plausible wrong ones (kit: evals/tests/skill-eval-kit.js). */

const kit = require('../skill-eval-kit');

const ID = 'completion-verification';
const REPORT = 'docs/reports/slugify-completion-2026-11-13.md';

const GOOD = `# Completion Verification Report: slugify

- TRD file: docs/TRD/slugify.md
- TRD slug: slugify
- Date: 2026-11-13
- Tracking mode: checkbox

## Task Inventory

| ID | Description | Status | Evidence |
|----|--------------|--------|----------|
| TRD-001 | Implement slugify | closed | TRD file checkbox \`- [x]\` |
| TRD-001-TEST | Unit tests for lowercasing | closed | TRD file checkbox \`- [x]\` |
| TRD-002 | Trim dashes | closed | TRD file checkbox \`- [x]\` |
| TRD-002-TEST | Unit tests for trimming | open | TRD file checkbox \`- [ ]\` |
| TRD-003 | Empty and non-string input | open | TRD file checkbox \`- [ ]\` |

## Requirement Coverage

| REQ-NNN | Priority | Satisfying Task(s) | Status |
|---------|----------|---------------------|--------|
| REQ-001 | Must | TRD-001 | SATISFIED |
| REQ-002 | Must | TRD-002 | SATISFIED |
| REQ-003 | Should | TRD-003 | UNSATISFIED |

## Gap Summary

Total gaps: 3

### TASK-OPEN (1)
- TRD-003: still open

### TEST-GAP (1)
- TRD-002 closed without TRD-002-TEST closed

### REQ-UNSATISFIED (1)
- REQ-003 (Should): no closed satisfying task

## Test Suite Result

PASS — \`npm run test --workspaces --if-present\` — slugify tests passed

---

**VERDICT: INCOMPLETE (3 gaps found)**
`;

/** A stub agent that saves \`text\` as the report (and optionally rewrites other files). */
const saves = (text, extra = {}) => (ws) => {
  if (text !== null) ws.write(REPORT, text);
  for (const [rel, body] of Object.entries(extra)) ws.write(rel, body);
};
const edit = (from, to) => { if (!GOOD.includes(from)) throw new Error(`test bug: ${from}`); return GOOD.replace(from, to); };

describe(`${ID} eval`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.fixtureDir).toBeTruthy();
    expect(ev.invocation).toBe('plain');
  });

  test('a good report passes every check', async () => {
    const res = await kit.runEval(ID, saves(GOOD));
    expect(Object.keys(res)).toEqual(['report-saved', 'verdict-incomplete', 'gap-count', 'gap-classes', 'no-false-gaps', 'inventory', 'coverage', 'suite-result', 'source-untouched']);
    kit.expectAllPass(res);
  });

  test('a run that writes nothing fails every report check; the untouched fixture still passes source-untouched', async () => {
    const res = await kit.runEval(ID, saves(null));
    kit.expectFails(res, ['report-saved', 'verdict-incomplete', 'gap-count', 'gap-classes', 'no-false-gaps', 'inventory', 'coverage', 'suite-result'], /no docs\/reports|no .*completion/, { only: true });
  });

  test('declaring the TRD COMPLETE fails verdict-incomplete', async () => {
    const res = await kit.runEval(ID, saves(edit('**VERDICT: INCOMPLETE (3 gaps found)**', '**VERDICT: COMPLETE (0 gaps)**')));
    kit.expectFails(res, ['verdict-incomplete', 'gap-count'], undefined, { only: true });
    expect(res['verdict-incomplete'].detail).toMatch(/COMPLETE/);
  });

  test('a verdict that is not the last line fails verdict-incomplete', async () => {
    const res = await kit.runEval(ID, saves(`${GOOD}\nAll done, ship it.\n`));
    kit.expectFails(res, ['verdict-incomplete', 'gap-count'], undefined, { only: true });
    expect(res['verdict-incomplete'].detail).toMatch(/last line/);
  });

  test('a wrong gap count fails gap-count', async () => {
    const res = await kit.runEval(ID, saves(edit('(3 gaps found)', '(1 gap found)').replace('Total gaps: 3', 'Total gaps: 1')));
    kit.expectFails(res, 'gap-count', /1 gaps/, { only: true });
  });

  test('a gap filed under the wrong class fails gap-classes', async () => {
    const res = await kit.runEval(ID, saves(edit('- TRD-002 closed without TRD-002-TEST closed', '- TRD-009 closed without TRD-009-TEST closed')));
    kit.expectFails(res, 'gap-classes', /TRD-002 is not listed under TEST-GAP/, { only: true });
  });

  test('a missing gap class fails gap-classes', async () => {
    const res = await kit.runEval(ID, saves(edit('### REQ-UNSATISFIED (1)\n- REQ-003 (Should): no closed satisfying task\n', '')));
    kit.expectFails(res, 'gap-classes', /no REQ-UNSATISFIED/, { only: true });
  });

  test('flagging finished work as a gap fails no-false-gaps', async () => {
    const res = await kit.runEval(ID, saves(edit('- TRD-003: still open', '- TRD-003: still open\n- TRD-001: still open')));
    kit.expectFails(res, 'no-false-gaps', /TRD-001/, { only: true });
  });

  test('misreporting a task status fails inventory', async () => {
    const res = await kit.runEval(ID, saves(edit('| TRD-003 | Empty and non-string input | open |', '| TRD-003 | Empty and non-string input | closed |')));
    kit.expectFails(res, 'inventory', /TRD-003 is listed as "closed"/, { only: true });
  });

  test('a task missing from the inventory fails inventory', async () => {
    const res = await kit.runEval(ID, saves(edit('| TRD-001-TEST | Unit tests for lowercasing | closed | TRD file checkbox `- [x]` |\n', '')));
    kit.expectFails(res, 'inventory', /no TRD-001-TEST row/, { only: true });
  });

  test('a requirement marked satisfied although its task is open fails coverage', async () => {
    const res = await kit.runEval(ID, saves(edit('| REQ-003 | Should | TRD-003 | UNSATISFIED |', '| REQ-003 | Should | TRD-003 | SATISFIED |')));
    kit.expectFails(res, 'coverage', /REQ-003 is "SATISFIED"/, { only: true });
  });

  test('a report that drops the Requirement Coverage section fails coverage', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace(/## Requirement Coverage[\s\S]*?## Gap Summary/, '## Gap Summary')));
    kit.expectFails(res, 'coverage', /no "Requirement Coverage" section/, { only: true });
  });

  test('a FAIL suite result fails suite-result', async () => {
    const res = await kit.runEval(ID, saves(edit('PASS — `npm run test', 'FAIL — `npm run test')));
    kit.expectFails(res, 'suite-result', /suite result is FAIL/, { only: true });
  });

  test('ticking a checkbox in the TRD fails source-untouched', async () => {
    const trd = require('fs').readFileSync(`${kit.loadsClean(ID).fixtureDir}/docs/TRD/slugify.md`, 'utf8');
    const res = await kit.runEval(ID, saves(GOOD, { 'docs/TRD/slugify.md': trd.replace('- [ ] **TRD-003**', '- [x] **TRD-003**') }));
    kit.expectFails(res, 'source-untouched', /docs\/TRD\/slugify\.md was changed/, { only: true });
  });

  test('a new source file fails source-untouched', async () => {
    const res = await kit.runEval(ID, saves(GOOD, { 'packages/slugify/extra.js': 'module.exports = {};\n' }));
    kit.expectFails(res, 'source-untouched', /extra\.js/, { only: true });
  });

  test('two reports for the same TRD fail report-saved', async () => {
    const res = await kit.runEval(ID, saves(GOOD, { 'docs/reports/slugify-completion-2026-11-12.md': GOOD }));
    kit.expectFails(res, 'report-saved', /more than one report/);
  });

  test('a "Total gaps" line that disagrees with the verdict fails gap-count', async () => {
    const res = await kit.runEval(ID, saves(edit('Total gaps: 3', 'Total gaps: 2')));
    kit.expectFails(res, 'gap-count', /"Total gaps" says 2/, { only: true });
  });

  test('a closed task listed as open fails inventory', async () => {
    const res = await kit.runEval(ID, saves(edit('| TRD-002 | Trim dashes | closed |', '| TRD-002 | Trim dashes | open |')));
    kit.expectFails(res, 'inventory', /TRD-002 is listed as "open"/, { only: true });
  });

  test('an open task missing from the inventory fails inventory', async () => {
    const res = await kit.runEval(ID, saves(edit('| TRD-003 | Empty and non-string input | open | TRD file checkbox `- [ ]` |\n', '')));
    kit.expectFails(res, 'inventory', /no TRD-003 row/, { only: true });
  });

  test('an unsatisfied requirement missing from the coverage table fails coverage', async () => {
    const res = await kit.runEval(ID, saves(edit('| REQ-003 | Should | TRD-003 | UNSATISFIED |\n', '')));
    kit.expectFails(res, 'coverage', /no REQ-003 row/, { only: true });
  });

  test('a satisfied requirement missing from the coverage table fails coverage', async () => {
    const res = await kit.runEval(ID, saves(edit('| REQ-001 | Must | TRD-001 | SATISFIED |\n', '')));
    kit.expectFails(res, 'coverage', /no REQ-001 row/, { only: true });
  });

  test('a satisfied requirement reported as unsatisfied fails coverage', async () => {
    const res = await kit.runEval(ID, saves(edit('| REQ-001 | Must | TRD-001 | SATISFIED |', '| REQ-001 | Must | TRD-001 | UNSATISFIED |')));
    kit.expectFails(res, 'coverage', /REQ-001 is "UNSATISFIED"/, { only: true });
  });

  test('a wrong priority for the Should requirement fails coverage', async () => {
    const res = await kit.runEval(ID, saves(edit('| REQ-003 | Should |', '| REQ-003 | Must |')));
    kit.expectFails(res, 'coverage', /priority Should/, { only: true });
  });

  test('a report without a suite section fails suite-result', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace(/## Test Suite Result[\s\S]*?---/, '---')));
    kit.expectFails(res, 'suite-result', /no "Test Suite Result" section/, { only: true });
  });

  test('a suite section recording neither PASS nor FAIL fails suite-result', async () => {
    const res = await kit.runEval(ID, saves(edit('PASS — `npm run test --workspaces --if-present` — slugify tests passed', 'Not run.')));
    kit.expectFails(res, 'suite-result', /neither PASS nor FAIL/, { only: true });
  });

  test('deleting a seeded file fails source-untouched', async () => {
    const res = await kit.runEval(ID, (ws) => { saves(GOOD)(ws); ws.remove('packages/slugify/slugify.js'); });
    kit.expectFails(res, 'source-untouched', /slugify\.js was deleted/, { only: true });
  });

  test('arms: baseline loads nothing, with-skill loads packages/development; the prompt is not a command', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.plugins[0]).toMatch(/packages\/development$/);
    expect(withSkill.prompt).toBe(baseline.prompt);
    expect(baseline.prompt).not.toMatch(/^\//);
  }, 60000);
});
