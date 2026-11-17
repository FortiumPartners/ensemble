'use strict';

/**
 * Proof that the checks of the `ensemble-analyze-requirements` eval pass on a good readiness report and fail on plausible wrong ones.
 * Built on the kit (evals/tests/skill-eval-kit.js); no model is called.
 */

const kit = require('../skill-eval-kit');

const ID = 'ensemble-analyze-requirements';
const REPORT = 'docs/analysis/readiness-report.md';
const PRD = 'docs/PRD/PRD-2026-c3d4e5f6-report-export.md';

const GOOD = `# Readiness report: report export

**Verdict: NOT READY**

## Phases

- Phase 1: Export service, 5 tasks (3 implementation, 2 test), 11 hours estimated, 1 task without an estimate.

## Dependencies

- TRD-003 depends on TRD-009, which is not defined in the TRD (unresolved dependency, an error).
- No dependency cycles.

## Estimates

- Missing estimate: TRD-003.

## Traceability

- Uncovered requirements: REQ-002 and REQ-003 have no TRD task that satisfies them.
- TRD-003 satisfies a requirement but its test pair TRD-003-TEST is not defined.

## Contradictions

- REQ-002 (AC-002-1) requires a synchronous export returned in the same HTTP response within 2 seconds, and the PRD constraint
  says no separate worker process. TRD-002 queues the export on a background worker, returns a job id and promises the file within
  30 seconds. These contradict each other (sync versus async, 2 s versus 30 s). Remediation: align the TRD with REQ-002 or amend the PRD.
`;

/** Same facts, laid out as tables and a heading-plus-bullets verdict, to show the checks do not depend on one layout. */
const GOOD_TABLES = `# Readiness report

## Verdict

NOT READY

| Phase | Title | Tasks | Hours | Missing estimates |
|---|---|---|---|---|
| 1 | Export service | 5 | 11 | 1 |

### Findings

| Finding | Detail |
|---|---|
| Unresolved dependency | TRD-003 -> TRD-009 does not exist |
| No estimate | TRD-003 |
| Missing test pair | TRD-003-TEST |
| Uncovered | REQ-002 |
| Uncovered | REQ-003 |

### Conflict

PRD REQ-002 wants a synchronous export (same HTTP response, 2 seconds); TRD-002 is an asynchronous background queue (30 seconds). Conflict.
`;

/** A stub agent that saves `text` as the report (when not null) and writes `extra` files. */
const saves = (text, extra = {}) => (ws) => {
  if (text !== null) ws.write(REPORT, text);
  for (const [rel, body] of Object.entries(extra)) ws.write(rel, body);
};

describe(`${ID}`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.fixtureDir).toBeTruthy();
    expect(ev.runtimes).toEqual(['claude']);
    expect(ev.command).toBe('/ensemble-development:ensemble:analyze-requirements');
  });

  test('a good report passes every check', async () => {
    const res = await kit.runEval(ID, saves(GOOD));
    expect(Object.keys(res)).toEqual([
      'report-saved', 'verdict-not-ready', 'finding-uncovered', 'finding-dependency', 'finding-estimate-and-test-pair',
      'phase-stats', 'contradiction-found', 'inputs-unchanged', 'no-impl-files',
    ]);
    kit.expectAllPass(res);
  });

  test('the same facts laid out as tables with the verdict under a heading also pass', async () => {
    kit.expectAllPass(await kit.runEval(ID, saves(GOOD_TABLES)));
  });

  test('a run that writes nothing fails the seven report checks and only those', async () => {
    const res = await kit.runEval(ID, saves(null));
    kit.expectFails(res, [
      'report-saved', 'verdict-not-ready', 'finding-uncovered', 'finding-dependency', 'finding-estimate-and-test-pair',
      'phase-stats', 'contradiction-found',
    ], undefined, { only: true });
  });

  test('a report that is nearly empty fails report-saved', async () => {
    kit.expectFails(await kit.runEval(ID, saves('NOT READY\n')), 'report-saved', /nearly empty/);
  });

  test('a MOSTLY READY verdict fails verdict-not-ready (the TRD has an error)', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('NOT READY', 'MOSTLY READY')));
    kit.expectFails(res, 'verdict-not-ready', /mostlyready/, { only: true });
  });

  test('a READY or CAUTION verdict fails verdict-not-ready', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('NOT READY', 'READY'))), 'verdict-not-ready', /ready, but|states the verdict ready/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('NOT READY', 'CAUTION'))), 'verdict-not-ready', /caution/, { only: true });
  });

  test('an unlabelled verdict that is not NOT READY fails; one with no verdict at all fails', async () => {
    const noLabel = GOOD.replace('**Verdict: NOT READY**', 'Overall: MOSTLY READY').replace(/\bNOT READY\b/g, 'x');
    kit.expectFails(await kit.runEval(ID, saves(noLabel)), 'verdict-not-ready', /different verdict/, { only: true });
    const none = GOOD.replace('**Verdict: NOT READY**', 'Overall: see below');
    kit.expectFails(await kit.runEval(ID, saves(none)), 'verdict-not-ready', /no verdict NOT READY/, { only: true });
  });

  test('a report that does not flag REQ-003 as uncovered fails finding-uncovered', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('REQ-002 and REQ-003 have no TRD task that satisfies them', 'REQ-002 has no TRD task that satisfies it')));
    kit.expectFails(res, 'finding-uncovered', /REQ-003/, { only: true });
  });

  test('a report that does not flag REQ-002 as uncovered fails finding-uncovered', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('REQ-002 and REQ-003 have no TRD task that satisfies them', 'REQ-003 has no TRD task that satisfies it')));
    kit.expectFails(res, 'finding-uncovered', /REQ-002/, { only: true });
  });

  test('a heading-plus-bullets layout of the uncovered requirements passes', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('- Uncovered requirements: REQ-002 and REQ-003 have no TRD task that satisfies them.', 'Requirements with no TRD task:\n\n- REQ-002\n- REQ-003')));
    kit.expectAllPass(res);
  });

  test('a report that says the requirements are covered fails finding-uncovered', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('Uncovered requirements: REQ-002 and REQ-003 have no TRD task that satisfies them.', 'Every requirement (REQ-001, REQ-002, REQ-003) is covered.')));
    kit.expectFails(res, 'finding-uncovered', /REQ-00[23]/, { only: true });
  });

  test('a report that drops the undefined dependency fails finding-dependency', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('- TRD-003 depends on TRD-009, which is not defined in the TRD (unresolved dependency, an error).\n', '')));
    kit.expectFails(res, 'finding-dependency', /TRD-009/, { only: true });
  });

  test('TRD-009 mentioned without saying it is undefined fails finding-dependency', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('which is not defined in the TRD (unresolved dependency, an error)', 'which is the release task')));
    kit.expectFails(res, 'finding-dependency', /TRD-009/, { only: true });
  });

  test('a report that names the wrong task for the undefined dependency fails finding-dependency', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('TRD-003 depends on TRD-009', 'TRD-001 depends on TRD-009')));
    kit.expectFails(res, 'finding-dependency', /TRD-003/);
  });

  test('the undefined-dependency finding spread over neighbouring lines passes', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('- TRD-003 depends on TRD-009, which is not defined in the TRD (unresolved dependency, an error).', 'Dependency error:\n\n- TRD-003 depends on\n- TRD-009\n\nThat task is not defined.')));
    kit.expectAllPass(res);
  });

  test('a report with no missing-estimate finding fails finding-estimate-and-test-pair', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('- Missing estimate: TRD-003.\n', '').replace('1 task without an estimate', 'all tasks estimated')
      .replace('TRD-003 satisfies a requirement but its test pair TRD-003-TEST is not defined', 'TRD-003 is fine')));
    kit.expectFails(res, 'finding-estimate-and-test-pair', /estimate/, { only: true });
  });

  test('a report with the estimate but not the missing test pair fails finding-estimate-and-test-pair', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('- TRD-003 satisfies a requirement but its test pair TRD-003-TEST is not defined.\n', '')));
    kit.expectFails(res, 'finding-estimate-and-test-pair', /test task/, { only: true });
  });

  test('the test-pair finding by task id alone, or by words alone, passes; neither fails', async () => {
    const line = '- TRD-003 satisfies a requirement but its test pair TRD-003-TEST is not defined.';
    kit.expectAllPass(await kit.runEval(ID, saves(GOOD.replace(line, '- Not defined: TRD-003-TEST.'))));
    kit.expectAllPass(await kit.runEval(ID, saves(GOOD.replace(line, '- There is no test task for TRD-003.'))));
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace(line, '- TRD-003 is traced.'))), 'finding-estimate-and-test-pair', /test task/, { only: true });
  });

  test('a phase with the right hours but the wrong task count, or the reverse, fails phase-stats', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('5 tasks (3 implementation, 2 test), 11 hours', '4 tasks, 11 hours'))), 'phase-stats', undefined, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('5 tasks (3 implementation, 2 test), 11 hours', '5 tasks, 8 hours'))), 'phase-stats', undefined, { only: true });
  });

  test('wrong phase statistics fail phase-stats', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('5 tasks (3 implementation, 2 test), 11 hours', '4 tasks, 8 hours')));
    kit.expectFails(res, 'phase-stats', /5 tasks and 11 hours/, { only: true });
  });

  test('a contradiction that only says asynchronous (no synchronous side) fails contradiction-found', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace(/REQ-002 \(AC-002-1\)[\s\S]*Remediation/, 'REQ-002 and TRD-002 conflict: TRD-002 is an asynchronous background queue. Remediation')));
    kit.expectFails(res, 'contradiction-found', /contradiction/, { only: true });
  });

  test('both sides listed with no conflict language fail contradiction-found', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('## Contradictions', '## Notes').replace(/These contradict each other[^\n]*\n[^\n]*\n?/, '')));
    kit.expectFails(res, 'contradiction-found', /contradiction/, { only: true });
  });

  test('a contradiction that never names TRD-002 fails contradiction-found', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace(/TRD-002 queues/, 'The TRD queues')));
    kit.expectFails(res, 'contradiction-found', /TRD-002/, { only: true });
  });

  test('a contradiction without a PRD-side citation (no REQ-002, AC-002-1 or worker constraint) fails contradiction-found', async () => {
    const noPrd = GOOD.replace('REQ-002 (AC-002-1) requires', 'The spec requires').replace('and the PRD constraint\n  says no separate worker process.', 'only.').replace('with REQ-002', 'with the spec');
    expect(noPrd).not.toMatch(/REQ-002 \(|AC-002-1|separate worker/);
    const res = await kit.runEval(ID, saves(noPrd.replace('- Uncovered requirements: REQ-002 and REQ-003', '- Uncovered requirements: two of them')));
    kit.expectFails(res, ['contradiction-found', 'finding-uncovered'], undefined);
    expect(res['contradiction-found'].detail).toMatch(/contradiction/);
  });

  test('a contradiction with no asynchronous side fails contradiction-found', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace(/TRD-002 queues[\s\S]*$/, 'TRD-002 promises the file within 30 seconds, which conflicts with REQ-002.\n')));
    kit.expectFails(res, 'contradiction-found', /contradiction/, { only: true });
  });

  test('a contradiction that names only TRD-002-TEST (a different task) fails contradiction-found', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('TRD-002 queues', 'TRD-002-TEST queues')));
    kit.expectFails(res, 'contradiction-found', /TRD-002/, { only: true });
  });

  test('a modified PRD fails inputs-unchanged', async () => {
    const res = await kit.runEval(ID, (ws) => { saves(GOOD)(ws); ws.write(PRD, `${ws.read(PRD)}\nEdited by the run.\n`); });
    kit.expectFails(res, 'inputs-unchanged', /modified/, { only: true });
  });

  test('a deleted TRD fails inputs-unchanged', async () => {
    const res = await kit.runEval(ID, (ws) => { saves(GOOD)(ws); ws.remove('docs/TRD/TRD-report-export.md'); });
    kit.expectFails(res, 'inputs-unchanged', /deleted/, { only: true });
  });

  test('a TRD added next to the good report fails inputs-unchanged', async () => {
    const res = await kit.runEval(ID, saves(GOOD, { 'docs/TRD/TRD-fixed.md': '# fixed\n' }));
    kit.expectFails(res, 'inputs-unchanged', /added/, { only: true });
  });

  test('an implementation file written next to the good report fails no-impl-files', async () => {
    const res = await kit.runEval(ID, saves(GOOD, { 'src/export.js': 'module.exports = {};\n' }));
    kit.expectFails(res, 'no-impl-files', /src\/export\.js/, { only: true });
  });

  test('arms: baseline loads nothing, with-skill loads packages/development; the command prefixes only the with-skill prompt', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.prompt.startsWith('/ensemble-development:ensemble:analyze-requirements ')).toBe(true);
    expect(baseline.prompt).not.toMatch(/^\//);
  }, 60000);
});
