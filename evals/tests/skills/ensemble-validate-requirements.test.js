'use strict';

/** Proof that the ensemble-validate-requirements checks pass on good output and fail on bad output (kit: evals/tests/skill-eval-kit.js). */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const kit = require('../skill-eval-kit');

const ID = 'ensemble-validate-requirements';
const REPORT = 'docs/validation/requirements-report.md';
const FIXTURE = path.join(kit.REPO_ROOT, 'evals/skills', ID, 'fixture');
const TRD = 'docs/TRD/TRD-2026-c3d4e5f6-slugify.md';
const PRD = 'docs/PRD/PRD-2026-b2c3d4e5-slugify.md';
const CLI = path.join(kit.REPO_ROOT, 'packages/development/lib/trd-cli.js');

const ALL = ['report-saved', 'report-stats', 'report-errors', 'report-warnings', 'report-verdict', 'docs-unchanged', 'no-impl-files'];

// The CLI's own output on the seeded pair (see the calibration test, which regenerates it and compares).
const CLI_JSON = '{"slug":"trd-2026-c3d4e5f6-slugify","prdPath":"docs/PRD/PRD-2026-b2c3d4e5-slugify.md","ok":false,"errors":[{"code":"ORPHANED_SATISFIES","message":"Task TRD-003 satisfies REQ-009, which is not in the PRD","task":"TRD-003","req":"REQ-009"}],"warnings":[{"code":"MISSING_ACCEPTANCE_CRITERIA","message":"Task TRD-001 has no Implementation AC or Test AC checklist","task":"TRD-001"},{"code":"MISSING_ACCEPTANCE_CRITERIA","message":"Task TRD-001-TEST has no Implementation AC or Test AC checklist","task":"TRD-001-TEST"},{"code":"MISSING_ACCEPTANCE_CRITERIA","message":"Task TRD-002 has no Implementation AC or Test AC checklist","task":"TRD-002"},{"code":"MISSING_ACCEPTANCE_CRITERIA","message":"Task TRD-003 has no Implementation AC or Test AC checklist","task":"TRD-003"},{"code":"UNCOVERED_REQUIREMENT","message":"No TRD task satisfies REQ-003","req":"REQ-003"},{"code":"MISSING_TEST_PAIR","message":"Task TRD-002 satisfies a requirement but TRD-002-TEST is not defined","task":"TRD-002"},{"code":"MISSING_TEST_PAIR","message":"Task TRD-003 satisfies a requirement but TRD-003-TEST is not defined","task":"TRD-003"}],"passed":["required_sections","tasks_parsed","dependencies_resolve","no_dependency_cycles","shippable_state","ac_references"],"skipped":[],"stats":{"tasks":4,"implTasks":3,"testTasks":1,"phases":1,"externalDependencies":0,"prdRequirements":3}}';

const PROSE = `# Requirements validation

## Stats

- Tasks: 4 (3 implementation, 1 test)
- PRD requirements: 3

## Errors

- ORPHANED_SATISFIES: Task TRD-003 satisfies REQ-009, which is not in the PRD

## Warnings

- UNCOVERED_REQUIREMENT: No TRD task satisfies REQ-003
- MISSING_TEST_PAIR: Task TRD-002 satisfies a requirement but TRD-002-TEST is not defined
- MISSING_TEST_PAIR: Task TRD-003 satisfies a requirement but TRD-003-TEST is not defined

## Passed checks

- required_sections
- tasks_parsed
- dependencies_resolve

VALIDATION_FAILED
`;

const TABLE = `| Item | Finding |
|---|---|
| tasks | 4 |
| PRD requirements | 3 |
| REQ-009 | orphaned: TRD-003 cites a requirement that is not in the PRD |
| REQ-003 | uncovered, no task satisfies it |
| TRD-002 | missing TEST pair |
| TRD-003 | missing TEST pair |
| TRD-001 | has TRD-001-TEST |

Result: FAILED (1 error)
`;

const PRETTY = JSON.stringify(JSON.parse(CLI_JSON), null, 2);

const saves = (text, extra = {}) => (ws) => {
  if (text !== null) ws.write(REPORT, text);
  for (const [rel, body] of Object.entries(extra)) ws.write(rel, body);
};
/** `GOOD` with one replacement applied (throws if the replacement matched nothing, so a test cannot pass by a typo). */
const edit = (from, to, base = PROSE) => {
  const next = base.replace(from, to);
  if (next === base) throw new Error(`test bug: ${String(from)} not found`);
  return next;
};

describe(`${ID}`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.invocation).toBe('explicit');
    expect(ev.runtimes).toEqual(['claude']);
  });

  test('calibration: the real trd-cli on the seeded fixture gives the answer the checks encode', () => {
    const r = spawnSync('node', [CLI, 'validate', TRD, '--prd', PRD], { cwd: FIXTURE, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(CLI_JSON);
  });

  test.each([['the CLI JSON verbatim', CLI_JSON], ['pretty-printed JSON', PRETTY], ['a prose report', PROSE], ['a markdown table', TABLE]])(
    'a good report passes every check: %s', async (_name, text) => {
      const res = await kit.runEval(ID, saves(text));
      expect(Object.keys(res)).toEqual(ALL);
      kit.expectAllPass(res);
    });

  test('a run that writes nothing fails the five report checks; the unchanged documents and the empty tree pass', async () => {
    const res = await kit.runEval(ID, saves(null));
    kit.expectFails(res, ['report-saved', 'report-stats', 'report-errors', 'report-warnings', 'report-verdict'], /not written/, { only: true });
  });

  test('an empty report fails report-saved', async () => {
    kit.expectFails(await kit.runEval(ID, saves('\n')), 'report-saved', /empty/);
  });

  test('counting the heading-style TRD-004 as a task (5 tasks) fails report-stats only', async () => {
    kit.expectFails(await kit.runEval(ID, saves(edit('Tasks: 4', 'Tasks: 5'))), 'report-stats', /5 tasks/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(edit('"tasks":4', '"tasks":5', CLI_JSON))), 'report-stats', /5 tasks/, { only: true });
  });

  test('a report with no task count fails report-stats; implTasks/testTasks do not stand in for it', async () => {
    kit.expectFails(await kit.runEval(ID, saves(edit('- Tasks: 4 (3 implementation, 1 test)\n', ''))), 'report-stats', /4 tasks/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(edit('"tasks":4,', '', CLI_JSON))), 'report-stats', /4 tasks/, { only: true });
  });

  test('implTasks/testTasks do not stand in for the task count (word boundary)', async () => {
    const text = edit('"tasks":4,', '', edit('"implTasks":3', '"implTasks":4', CLI_JSON));
    kit.expectFails(await kit.runEval(ID, saves(text)), 'report-stats', /4 tasks/, { only: true });
  });

  test('the orphan attributed to the wrong task (TRD-002) fails report-errors only', async () => {
    const text = edit('Task TRD-003 satisfies REQ-009', 'Task TRD-002 satisfies REQ-009');
    kit.expectFails(await kit.runEval(ID, saves(text)), 'report-errors', /TRD-003/, { only: true });
  });

  test('docs-unchanged fails when its fixture has no documents (a wrong --fixture cannot pass)', () => {
    const r = spawnSync('node', [path.join(kit.REPO_ROOT, 'evals/checks', `${ID}.js`), 'docs-unchanged', '--fixture', path.join(FIXTURE, 'nonexistent')], { cwd: FIXTURE, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^FAIL: fixture has no docs\/PRD documents/);
  });

  test('a report that does not give the PRD requirement count (or name the REQs) fails report-stats', async () => {
    const res = await kit.runEval(ID, saves(edit('- PRD requirements: 3\n', '').replace(/REQ-00[1-3]/g, 'R')));
    kit.expectFails(res, ['report-stats', 'report-warnings'], undefined, { only: true });
    kit.expectFails(res, 'report-stats', /3 PRD requirements/);
  });

  test('the orphaned REQ-009 missing fails report-errors only', async () => {
    const text = edit('- ORPHANED_SATISFIES: Task TRD-003 satisfies REQ-009, which is not in the PRD\n', '- none\n');
    kit.expectFails(await kit.runEval(ID, saves(text)), 'report-errors', /REQ-009/, { only: true });
  });

  test('REQ-009 mentioned without saying it is not in the PRD fails report-errors', async () => {
    const text = edit('which is not in the PRD', 'which is fine').replace('ORPHANED_SATISFIES', 'NOTE');
    kit.expectFails(await kit.runEval(ID, saves(text)), 'report-errors', /orphaned/, { only: true });
  });

  test('REQ-003 not reported uncovered fails report-warnings only', async () => {
    const text = edit('- UNCOVERED_REQUIREMENT: No TRD task satisfies REQ-003\n', '');
    kit.expectFails(await kit.runEval(ID, saves(text)), 'report-warnings', /REQ-003 as uncovered/, { only: true });
  });

  test('a missing TEST pair left out (TRD-003) fails report-warnings only', async () => {
    const text = edit('- MISSING_TEST_PAIR: Task TRD-003 satisfies a requirement but TRD-003-TEST is not defined\n', '');
    kit.expectFails(await kit.runEval(ID, saves(text)), 'report-warnings', /TRD-003 as missing/, { only: true });
    const json = edit(/\{"code":"MISSING_TEST_PAIR","message":"Task TRD-002[^}]*\},/, '', CLI_JSON);
    kit.expectFails(await kit.runEval(ID, saves(json)), 'report-warnings', /TRD-002 as missing/, { only: true });
  });

  test('TRD-001 wrongly listed as missing a TEST pair fails report-warnings only', async () => {
    kit.expectFails(await kit.runEval(ID, saves(`${PROSE}\n- MISSING_TEST_PAIR: Task TRD-001 satisfies a requirement but TRD-001-TEST is not defined\n`)), 'report-warnings', /TRD-001 is missing/, { only: true });
    const json = edit('"warnings":[', '"warnings":[{"code":"MISSING_TEST_PAIR","message":"Task TRD-001 satisfies a requirement but TRD-001-TEST is not defined","task":"TRD-001"},', CLI_JSON);
    kit.expectFails(await kit.runEval(ID, saves(json)), 'report-warnings', /TRD-001 is missing/, { only: true });
  });

  test('REQ-001 listed as uncovered is not asserted (only REQ-003 is required); a wrong uncovered id does not satisfy REQ-003', async () => {
    const text = edit('No TRD task satisfies REQ-003', 'No TRD task satisfies REQ-001');
    kit.expectFails(await kit.runEval(ID, saves(text)), 'report-warnings', /REQ-003 as uncovered/, { only: true });
  });

  test('a report that says validation passed (ok: true) fails report-verdict only', async () => {
    kit.expectFails(await kit.runEval(ID, saves(edit('"ok":false', '"ok":true', CLI_JSON))), 'report-verdict', /passed|failed validation/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(edit('VALIDATION_FAILED', 'Validation passed.'))), 'report-verdict', /failed validation/, { only: true });
  });

  test('a failed report that also says PASSED overall fails report-verdict', async () => {
    kit.expectFails(await kit.runEval(ID, saves(`${PROSE}\nOverall: PASSED\n`)), 'report-verdict', /also says validation passed/, { only: true });
  });

  test('a failed report that also says ok: true or "validation passed" fails report-verdict (each phrase alone)', async () => {
    kit.expectFails(await kit.runEval(ID, saves(`${PROSE}\nok: true\n`)), 'report-verdict', /also says validation passed/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(`${PROSE}\nValidation passed.\n`)), 'report-verdict', /also says validation passed/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(`${PROSE}\nAll checks passed.\n`)), 'report-verdict', /also says validation passed/, { only: true });
  });

  test('the TRD edited to "fix" the findings fails docs-unchanged only', async () => {
    const fixed = fs.readFileSync(path.join(FIXTURE, TRD), 'utf8').replace('REQ-009', 'REQ-003');
    kit.expectFails(await kit.runEval(ID, saves(PROSE, { [TRD]: fixed })), 'docs-unchanged', /edited/, { only: true });
  });

  test('the PRD removed, or a new TRD written beside the seeded one, fails docs-unchanged', async () => {
    kit.expectFails(await kit.runEval(ID, (ws) => { ws.write(REPORT, PROSE); ws.remove(PRD); }), 'docs-unchanged', /removed/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(PROSE, { 'docs/TRD/TRD-2026-aaaa-other.md': '# other\n' })), 'docs-unchanged', /new document/, { only: true });
  });

  test('an implementation file written next to a good report fails no-impl-files only', async () => {
    kit.expectFails(await kit.runEval(ID, saves(PROSE, { 'src/slugify.js': 'module.exports = {};\n' })), 'no-impl-files', /src\/slugify\.js/, { only: true });
  });

  test('a symlinked report is not followed', async () => {
    const res = await kit.runEval(ID, (ws) => {
      fs.mkdirSync(path.join(ws.dir, 'docs/validation'), { recursive: true });
      fs.writeFileSync(path.join(ws.root, 'outside.md'), PROSE);
      fs.symlinkSync(path.join(ws.root, 'outside.md'), path.join(ws.dir, REPORT));
    });
    kit.expectFails(res, 'report-saved', /symlink/);
  });

  test('arms: baseline loads nothing, with-skill loads packages/development; the command prefixes only the with-skill prompt', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.prompt.startsWith('/ensemble-development:ensemble:validate-requirements ')).toBe(true);
    expect(baseline.prompt).not.toMatch(/^\//);
    expect(baseline.prompt).toBe(withSkill.prompt.replace('/ensemble-development:ensemble:validate-requirements ', ''));
  }, 60000);
});
