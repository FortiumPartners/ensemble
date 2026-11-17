'use strict';

/**
 * Proof that the checks of the `ensemble-requirement-status` eval can pass and can fail (kit: evals/tests/skill-eval-kit.js). The model is
 * faked: each stub agent writes the report.md (and the br stub's call log) a good or bad run would leave. No model, no network, no real br.
 */

const fs = require('fs');
const path = require('path');
const kit = require('../skill-eval-kit');

const ID = 'ensemble-requirement-status';
const TRD = 'docs/TRD/inventory-sync.md';
const IDS = ['report-saved', 'req-statuses', 'summary-counts', 'phase-rollup', 'acs-proven', 'evidence-level', 'beads-read', 'read-only'];

const GOOD = `# Requirement status: inventory-sync

## Checklist

- Phase 1: Import and export - 4/4 (100%)
- Phase 2: Alerts and audit - 1/3 (33.3%)
- Overall: 5/7 (71.4%)

## Requirements

| REQ | Title | Status | Tests | ACs proven | Note |
|---|---|---|---|---|---|
| REQ-001 | Import stock levels (Must) | SATISFIED | TRD-001-TEST (closed) | AC-001-1, AC-001-2 | |
| REQ-002 | Export stock levels (Must) | IN_PROGRESS | TRD-002-TEST (closed) | none | closed without PASSED verdict: TRD-002-TEST (failed) |
| REQ-003 | Low-stock alerts (Should) | PENDING | TRD-003-TEST (open) | none | |
| REQ-004 | Audit log (Could) | NOT_PLANNED | none | none | |

## Summary

SATISFIED: 1 | IN_PROGRESS: 1 | PENDING: 1 | NOT_PLANNED: 1

Evidence: verdict-verified
`;

const CALLS = ['--version', 'list --all --limit 0 --json', 'comments list br-a --json', 'comments list br-b --json', 'comments list br-c --json', 'comments list br-epic --json'];

/** A stub agent: saves `report` (null: none) as report.md, writes the br stub's call log (default: the reads a good run makes) and extra files. */
const run = (report, { calls = CALLS, extra = {} } = {}) => (ws) => {
  if (report !== null) ws.write('report.md', report);
  if (calls !== null) fs.writeFileSync(path.join(ws.root, 'br-calls.log'), `${calls.join('\n')}\n`);
  for (const [rel, body] of Object.entries(extra)) ws.write(rel, body);
};
const swap = (text, from, to) => {
  if (!text.includes(from)) throw new Error(`test setup: ${from} not in the report`);
  return text.replace(from, to);
};

describe(ID, () => {
  test('loads clean: valid definition, a fixture with the TRD, PRD and stubs and no agent or git configuration', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.runtimes).toEqual(['claude']);
    expect(ev.sandboxPath).toEqual(['bin']);
  });

  test('a good report passes every check', async () => {
    const res = await kit.runEval(ID, run(GOOD));
    expect(Object.keys(res)).toEqual(IDS);
    kit.expectAllPass(res);
  });

  test('the fixture alone (a run that does nothing) fails the checks about the report and the beads, and passes read-only', async () => {
    const res = await kit.runEval(ID, run(null, { calls: null }));
    kit.expectFails(res, IDS.filter((i) => i !== 'read-only'), undefined, { only: true });
  });

  test('other layouts pass: number-first counts, `in progress`, status on the line after a REQ heading', async () => {
    const alt = `# Report

Phase 1 (Import and export): 4 of 4 done
Phase 2 (Alerts and audit): 1 of 3 done
Total 5 of 7 tasks checked

### REQ-001: Import stock levels
Status: satisfied
ACs proven: AC-001-1, AC-001-2

### REQ-002: Export stock levels
Status: in progress (verdict failed)

### REQ-003: Low-stock alerts
Status: pending

### REQ-004: Audit log
Status: not planned

1 SATISFIED, 1 IN PROGRESS, 1 PENDING, 1 NOT PLANNED
Evidence level: verdict-verified
`;
    kit.expectAllPass(await kit.runEval(ID, run(alt)));
  });

  test('REQ-002 reported SATISFIED (checkbox and closed bead trusted, the failed verdict ignored) fails req-statuses', async () => {
    const res = await kit.runEval(ID, run(swap(GOOD, '| IN_PROGRESS | TRD-002-TEST (closed) | none | closed without PASSED verdict: TRD-002-TEST (failed) |', '| SATISFIED | TRD-002-TEST (closed) | none | |')));
    kit.expectFails(res, 'req-statuses', /REQ-002 reported SATISFIED, expected IN_PROGRESS/, { only: true });
  });

  test('REQ-004 (no test task) reported PENDING instead of NOT_PLANNED fails req-statuses', async () => {
    const res = await kit.runEval(ID, run(swap(GOOD, '| NOT_PLANNED | none |', '| PENDING | none |')));
    kit.expectFails(res, 'req-statuses', /REQ-004 reported PENDING/, { only: true });
  });

  test('a requirement with no row fails report-saved and req-statuses', async () => {
    const res = await kit.runEval(ID, run(GOOD.replace(/^\| REQ-003.*\n/m, '')));
    kit.expectFails(res, ['report-saved', 'req-statuses', 'acs-proven'], /REQ-003/, { only: true });
  });

  test('summary counts of a closed-only reading fail summary-counts', async () => {
    const res = await kit.runEval(ID, run(swap(GOOD, 'SATISFIED: 1 | IN_PROGRESS: 1', 'SATISFIED: 2 | IN_PROGRESS: 0')));
    kit.expectFails(res, 'summary-counts', /SATISFIED count was 2, expected 1/, { only: true });
  });

  test('no summary at all fails summary-counts', async () => {
    const res = await kit.runEval(ID, run(swap(GOOD, 'SATISFIED: 1 | IN_PROGRESS: 1 | PENDING: 1 | NOT_PLANNED: 1', 'Four requirements in total.')));
    kit.expectFails(res, 'summary-counts', /no count for SATISFIED/, { only: true });
  });

  test('a wrong phase rollup fails phase-rollup; a missing overall total fails it too', async () => {
    kit.expectFails(await kit.runEval(ID, run(swap(GOOD, '1/3 (33.3%)', '0/3 (0%)'))), 'phase-rollup', /phase 2 line does not show/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(swap(GOOD, '- Overall: 5/7 (71.4%)\n', ''))), 'phase-rollup', /no overall checkbox total/, { only: true });
  });

  test('every PRD AC listed as proven fails acs-proven; so does an ac-proven token missed', async () => {
    kit.expectFails(await kit.runEval(ID, run(swap(GOOD, '| AC-001-1, AC-001-2 |', '| AC-001-1, AC-001-2, AC-001-3 |'))), 'acs-proven', /REQ-001 ACs proven were/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(swap(GOOD, '| none | closed without', '| AC-002-1 | closed without'))), 'acs-proven', /REQ-002 row names ACs \[AC-002-1\]/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(swap(GOOD, '| AC-001-1, AC-001-2 |', '| AC-001-1 |'))), 'acs-proven', /expected \[AC-001-1, AC-001-2\]/, { only: true });
  });

  test('evidence closed-only (verdicts never read) fails evidence-level; an unstated level fails it', async () => {
    kit.expectFails(await kit.runEval(ID, run(swap(GOOD, 'Evidence: verdict-verified', 'Evidence: closed-only'))), 'evidence-level', /does not state/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(swap(GOOD, 'Evidence: verdict-verified', ''))), 'evidence-level', /does not state/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(swap(GOOD, 'Evidence: verdict-verified', 'Evidence: closed-only (not verdict-verified)'))), 'evidence-level', /closed-only/, { only: true });
  });

  test('a report written from the TRD alone (br never called) fails beads-read only', async () => {
    kit.expectFails(await kit.runEval(ID, run(GOOD, { calls: null })), 'beads-read', /recorded no call/, { only: true });
  });

  test('bead statuses read but no comments fails beads-read', async () => {
    kit.expectFails(await kit.runEval(ID, run(GOOD, { calls: ['--version', 'list --all --limit 0 --json'] })), 'beads-read', /comments list.*br-a/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(GOOD, { calls: ['--version', 'comments list br-a --json', 'comments list br-b --json', 'comments list br-c --json'] })), 'beads-read', /no `br list`/, { only: true });
  });

  test('a bead write fails read-only (and only that)', async () => {
    for (const w of ['close br-b --json', 'update br-c --status in_progress', 'comments add br-a hi']) {
      kit.expectFails(await kit.runEval(ID, run(GOOD, { calls: [...CALLS, w] })), 'read-only', /more than read/, { only: true });
    }
  });

  test('ticking a TRD checkbox or writing an implementation file fails read-only', async () => {
    const trd = (ws) => ws.read(TRD);
    let ticked;
    const res = await kit.runEval(ID, (ws) => {
      run(GOOD)(ws);
      ticked = trd(ws).replace('- [ ] **TRD-003**', '- [x] **TRD-003**');
      ws.write(TRD, ticked);
    });
    expect(ticked).not.toBeNull();
    kit.expectFails(res, 'read-only', /checkboxes changed: 6 done and 1 open/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: { 'src/alerts.js': 'module.exports = {};\n' } })), 'read-only', /src\/alerts\.js/, { only: true });
  });

  test('a TRD with an extra done task, or an extra open one, fails read-only (each count is checked)', async () => {
    const withLine = (line) => async (ws) => { run(GOOD)(ws); ws.write(TRD, `${ws.read(TRD)}\n${line}\n`); };
    kit.expectFails(await kit.runEval(ID, withLine('- [x] **TRD-009**: Extra (1h) [satisfies REQ-004]')), 'read-only', /6 done and 2 open/, { only: true });
    kit.expectFails(await kit.runEval(ID, withLine('- [ ] **TRD-009**: Extra (1h) [satisfies REQ-004]')), 'read-only', /5 done and 3 open/, { only: true });
  });

  test('a report that is only a few words fails report-saved', async () => {
    const res = await kit.runEval(ID, run('REQ-001 SATISFIED\n'));
    kit.expectFails(res, 'report-saved', /empty or too short/);
  });

  test('arms: the command prefixes only the with-skill prompt; baseline loads no plugin, with-skill loads packages/development', async () => {
    const ev = kit.loadsClean(ID);
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(withSkill.prompt.startsWith(`${ev.command} `)).toBe(true);
    expect(baseline.prompt).not.toMatch(/^\//);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.plugins[0]).toMatch(/packages\/development$/);
  }, 60000);
});
