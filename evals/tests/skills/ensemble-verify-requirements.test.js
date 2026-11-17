'use strict';

/** Kit test for the `ensemble-verify-requirements` eval: the checks pass on the report trd-cli prints for the fixture and fail on plausible wrong reports. */

const kit = require('../skill-eval-kit');

const ID = 'ensemble-verify-requirements';
const REPORT = 'docs/req-traceability/trd-2026-b2c3d4e5-slugify-2026-11-13.md';
const TRD = 'docs/TRD/TRD-2026-b2c3d4e5-slugify.md';
const IDS = ['report-saved', 'report-header', 'report-verdict', 'report-rows', 'report-chain', 'report-summary', 'read-only', 'code-untouched'];
const REPORT_IDS = IDS.slice(0, 6);

// The shape of renderVerifyReport() in packages/development/lib/trd-cli.js, as printed for the fixture.
const GOOD = `# Requirement Traceability: trd-2026-b2c3d4e5-slugify

Generated: 2026-11-13T10:00:00.000Z
Mode: checkbox
PRD: docs/PRD/PRD-2026-b2c3d4e5-slugify.md

**Overall verdict: PARTIAL**

| REQ | Status | Impl | Test | Files | Commits | Tests |
|-----|--------|------|------|-------|---------|-------|
| REQ-001 | PARTIAL | TRD-001 | TRD-001-TEST | 1 | 0 | not_run |
| REQ-002 | IN PROGRESS | TRD-002 | TRD-002-TEST | 1 | 0 | not_run |
| REQ-003 | NOT PLANNED | - | - | 0 | 0 | not_run |

## Summary

\`\`\`json
{
  "total": 3,
  "partial": 1,
  "in_progress": 1,
  "not_planned": 1
}
\`\`\`
`;

/** Stub agent: saves `text` as the report (null = none), applies `edit(ws)` for other effects. */
const saves = (text, edit, name = REPORT) => (ws) => {
  if (text !== null) ws.write(name, text);
  if (edit) edit(ws);
};

describe(ID, () => {
  test('loads clean', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.fixtureDir).toBeTruthy();
    expect(ev.command).toBe('/ensemble-development:ensemble:verify-requirements');
  });

  test('the report trd-cli prints for the fixture passes every check', async () => {
    const res = await kit.runEval(ID, saves(GOOD));
    expect(Object.keys(res)).toEqual([...IDS, 'noProtectedBranchCommit']);
    kit.expectAllPass(res);
  });

  test('a run that writes nothing fails every report check; the seeded fixture is read-only-clean', async () => {
    const res = await kit.runEval(ID, saves(null));
    kit.expectFails(res, REPORT_IDS, /no report|is empty/, { only: true });
  });

  test('an empty report file fails report-saved', async () => {
    kit.expectFails(await kit.runEval(ID, saves('  \n')), 'report-saved', /is empty/);
  });

  test('a report at another path or name fails report-saved', async () => {
    const res = await kit.runEval(ID, saves(GOOD, null, 'docs/req-traceability/report.md'));
    kit.expectFails(res, ['report-saved', 'report-header', 'report-verdict', 'report-rows', 'report-chain', 'report-summary'], /not named <trd-slug>/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD, null, 'docs/trace.md')), 'report-saved', /no report/);
  });

  test('a report that claims COMPLETE fails report-verdict (and report-rows when REQ-001 is VERIFIED)', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('verdict: PARTIAL', 'verdict: COMPLETE')));
    kit.expectFails(res, 'report-verdict', /COMPLETE/, { only: true });
    const res2 = await kit.runEval(ID, saves(GOOD.replace('| REQ-001 | PARTIAL', '| REQ-001 | VERIFIED')));
    kit.expectFails(res2, 'report-rows', /REQ-001 status is VERIFIED/, { only: true });
  });

  test('a report without the verdict line fails report-verdict', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace(/\*\*Overall verdict: PARTIAL\*\*\n/, ''))), 'report-verdict', /no "Overall verdict/, { only: true });
  });

  test('wrong statuses, a missing row, an extra row and a duplicated row fail report-rows', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('| REQ-002 | IN PROGRESS', '| REQ-002 | PARTIAL'))), 'report-rows', /REQ-002 status is PARTIAL/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace(/\| REQ-003[^\n]*\n/, ''))), 'report-rows', /no table row for REQ-003/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('| REQ-003', '| REQ-004 | PARTIAL | - | - | 0 | 0 | not_run |\n| REQ-003'))), 'report-rows', /unexpected rows: REQ-004/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('| REQ-003', '| REQ-002 | IN PROGRESS | TRD-002 | TRD-002-TEST | 1 | 0 | not_run |\n| REQ-003'))), 'report-rows', /REQ-002 has 2 rows/, { only: true });
  });

  test('harmless variants still pass: lower-case snake_case statuses, no bold on the verdict', async () => {
    const v = GOOD.replace('IN PROGRESS', 'in_progress').replace('NOT PLANNED', 'not_planned').replace('**Overall verdict: PARTIAL**', 'Overall verdict: PARTIAL');
    kit.expectAllPass(await kit.runEval(ID, saves(v)));
  });

  test('a chain that names the wrong test task, impl task or file count fails report-chain', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('TRD-001-TEST', 'TRD-009-TEST'))), 'report-chain', /test task is TRD-009-TEST/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('| TRD-001 |', '| TRD-007 |'))), 'report-chain', /impl task is TRD-007/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('| TRD-001-TEST | 1 |', '| TRD-001-TEST | 0 |'))), 'report-chain', /counts 0 target files/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace(/\| REQ-001[^\n]*\n/, ''))), 'report-chain', /no table row for REQ-001/);
  });

  test('wrong header (title slug, mode, PRD) fails report-header', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('Traceability: trd-2026', 'Traceability: other-2026'))), 'report-header', /title names other-2026/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('# Requirement Traceability:', '# Traceability report:'))), 'report-header', /no "# Requirement Traceability/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('Mode: checkbox', 'Mode: both'))), 'report-header', /Mode line is both/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('Mode: checkbox\n', ''))), 'report-header', /Mode line is \(missing\)/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('PRD: docs/PRD/PRD-2026-b2c3d4e5-slugify.md', 'PRD: none'))), 'report-header', /PRD line is none/, { only: true });
  });

  test('a missing, unparsable or wrong Summary fails report-summary', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('## Summary', '## Totals'))), 'report-summary', /no "## Summary"/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('```json', '```text'))), 'report-summary', /no ```json block/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('"total": 3,', '"total": 3 oops'))), 'report-summary', /does not parse/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('"partial": 1', '"partial": 2'))), 'report-summary', /summary\.partial is 2/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('  "not_planned": 1\n', '').replace('"in_progress": 1,', '"in_progress": 1'))), 'report-summary', /summary\.not_planned is undefined/, { only: true });
  });

  test('closing a task in the TRD fails read-only', async () => {
    const res = await kit.runEval(ID, saves(GOOD, (ws) => ws.write(TRD, ws.read(TRD).replace('- [ ] **TRD-002**', '- [x] **TRD-002**'))));
    kit.expectFails(res, 'read-only', /TRD-002 was closed/, { only: true });
  });

  test('un-checking a verified task, or deleting the TRD, fails read-only', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD, (ws) => ws.write(TRD, ws.read(TRD).replace('- [x] **TRD-001**', '- [ ] **TRD-001**')))), 'read-only', /TRD-001 is no longer checked/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD, (ws) => ws.remove(TRD))), ['read-only'], /is gone/);
  });

  test('implementing the missing files (a verifier that fixes things) fails read-only', async () => {
    const res = await kit.runEval(ID, saves(GOOD, (ws) => ws.write('src/trim.js', 'module.exports = {};\n')));
    kit.expectFails(res, 'read-only', /src\/trim\.js was created/, { only: true });
  });

  test('a stray file outside docs/ fails read-only; a file under docs/ does not', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD, (ws) => ws.write('notes.txt', 'x'))), 'read-only', /notes\.txt/, { only: true });
    kit.expectAllPass(await kit.runEval(ID, saves(GOOD, (ws) => ws.write('docs/req-traceability/extra.md', 'x'))));
  });

  test('removing a seeded source file fails read-only and code-untouched', async () => {
    const res = await kit.runEval(ID, saves(GOOD, (ws) => ws.remove('src/slugify.js')));
    kit.expectFails(res, ['read-only', 'code-untouched'], /slugify\.js/, { only: true });
  });

  test('editing the source file fails code-untouched', async () => {
    const res = await kit.runEval(ID, saves(GOOD, (ws) => ws.write('src/slugify.js', "'use strict';\nmodule.exports = { slugify: (t) => t };\n")));
    kit.expectFails(res, 'code-untouched', /was modified/, { only: true });
  });

  test('arms: baseline loads nothing, with-skill loads packages/development; the command prefixes only the with-skill prompt', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.prompt.startsWith('/ensemble-development:ensemble:verify-requirements ')).toBe(true);
    expect(baseline.prompt).not.toMatch(/^\//);
  }, 60000);
});
