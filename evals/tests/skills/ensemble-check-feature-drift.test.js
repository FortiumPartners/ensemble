'use strict';

/** Proof that the `ensemble-check-feature-drift` checks pass on a good drift report and fail on plausible wrong ones (kit: evals/tests/skill-eval-kit.js). */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const kit = require('../skill-eval-kit');

const ID = 'ensemble-check-feature-drift';
const FIXTURE = path.resolve(__dirname, '..', '..', 'skills', ID, 'fixture');
const FEATURE = 'features/PRD-2026-a1b2c3d4-csv2json/REQ-001.feature';
const ALL = ['report-saved', 'drift-added', 'drift-removed', 'drift-changed', 'cosmetic-ignored', 'resync-advised', 'read-only'];

// What `prd-cli check-drift` prints for the fixture, plus the recommendation the skill asks for.
const CLI_STYLE = `DRIFT DETECTED — PRD-2026-a1b2c3d4-csv2json
  + ADDED   (1): AC-003-2
  - REMOVED (1): AC-002-1
  ~ CHANGED (1): AC-001-3
  Run generate-features to resync.
`;

const GOOD = `# Drift report: PRD-2026-a1b2c3d4-csv2json

Status: drift detected (exit code 2).

## ADDED (no scenario yet)

- AC-003-2

## REMOVED (orphaned scenario)

- AC-002-1

## CHANGED (wording diverged)

- AC-001-3

AC-001-2 was only reformatted (casing and spacing) so it is not drift.

## Recommendation

Re-run /ensemble:reqnroll features to resync, then commit the updated features and manifest.
`;

const saves = (text, extra = {}) => (ws) => {
  if (text !== null) ws.write('drift-report.md', text);
  for (const [rel, body] of Object.entries(extra)) ws.write(rel, body);
};

describe(`${ID} eval`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration, manifest included', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.fixtureDir).toBeTruthy();
    expect(fs.existsSync(path.join(FIXTURE, 'features/PRD-2026-a1b2c3d4-csv2json/.prd-trace.json'))).toBe(true);
  });

  test('calibration: the real prd-cli reports exactly the drift the checks expect on the fixture (exit 2), and its own output passes', () => {
    const cli = path.resolve(__dirname, '..', '..', '..', 'packages', 'product', 'lib', 'prd-cli.js');
    const r = spawnSync('node', [cli, 'check-drift', 'docs/PRD/PRD-2026-a1b2c3d4-csv2json.md', '--out', 'features', '--json'], { cwd: FIXTURE, encoding: 'utf8' });
    expect(r.status).toBe(2);
    const d = JSON.parse(r.stdout).drift;
    expect({ added: d.added, removed: d.removed, changed: d.changed }).toEqual({ added: ['AC-003-2'], removed: ['AC-002-1'], changed: ['AC-001-3'] });
  });

  test('a good report passes every check', async () => {
    const res = await kit.runEval(ID, saves(GOOD));
    expect(Object.keys(res)).toEqual(ALL);
    kit.expectAllPass(res);
  });

  test('the prd-cli output style (one line per category) passes every check', async () => {
    const res = await kit.runEval(ID, saves(CLI_STYLE));
    kit.expectAllPass(res);
  });

  test('a table report and an inline report pass the category checks', async () => {
    const table = '| id | status |\n|---|---|\n| AC-003-2 | ADDED |\n| AC-002-1 | REMOVED |\n| AC-001-3 | CHANGED |\n\nRun /ensemble:reqnroll features.\n';
    kit.expectAllPass(await kit.runEval(ID, saves(table)));
    const inline = '**ADDED:** AC-003-2 **REMOVED:** AC-002-1 **CHANGED:** AC-001-3\n\nRe-run reqnroll features to resync.\n';
    kit.expectAllPass(await kit.runEval(ID, saves(inline)));
  });

  test('a run that writes no report fails every report check and keeps the seeded files intact', async () => {
    const res = await kit.runEval(ID, saves(null));
    kit.expectFails(res, ['report-saved', 'drift-added', 'drift-removed', 'drift-changed', 'cosmetic-ignored', 'resync-advised'], /was not written/, { only: true });
  });

  test('a report that says IN_SYNC fails the three category checks', async () => {
    const res = await kit.runEval(ID, saves('IN_SYNC: the feature files match the PRD.\n\nRe-run reqnroll features if needed.\n'));
    kit.expectFails(res, ['drift-added', 'drift-removed', 'drift-changed'], /missing/, { only: true });
  });

  test('flagging the cosmetic edit as CHANGED fails cosmetic-ignored and drift-changed', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('- AC-001-3\n', '- AC-001-3\n- AC-001-2\n')));
    kit.expectFails(res, 'cosmetic-ignored', /AC-001-2/);
    kit.expectFails(res, 'drift-changed', /wrongly lists AC-001-2/);
    kit.expectFails(res, ['cosmetic-ignored', 'drift-changed'], undefined, { only: true });
  });

  test('ids under the wrong category fail the category checks (a removed criterion reported as added)', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('- AC-003-2', '- AC-003-2\n- AC-002-1').replace('## REMOVED (orphaned scenario)\n\n- AC-002-1', '## REMOVED (orphaned scenario)\n\nnone')));
    kit.expectFails(res, ['drift-added', 'drift-removed'], undefined, { only: true });
  });

  test('a blank report fails report-saved; ids listed under a later heading or after a line of prose are not drift', async () => {
    kit.expectFails(await kit.runEval(ID, saves('  \n\n')), 'report-saved', /is empty/);
    const heading = GOOD.replace('## Recommendation', '## Ignored (cosmetic edits only)\n\n- AC-001-2\n\n## Recommendation');
    kit.expectAllPass(await kit.runEval(ID, saves(heading)));
    const prose = GOOD.replace('AC-001-2 was only reformatted', 'These criteria are unaffected:\n- AC-001-2\n- AC-001-1\nAC-001-2 was only reformatted');
    kit.expectAllPass(await kit.runEval(ID, saves(prose)));
  });

  test('a report that does not say how to resync fails resync-advised only', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace(/## Recommendation[\s\S]*$/, '')));
    kit.expectFails(res, 'resync-advised', /reqnroll features/, { only: true });
  });

  test('rewriting a feature file (the skill is read-only) fails read-only only', async () => {
    const res = await kit.runEval(ID, saves(GOOD, { [FEATURE]: '# regenerated\n' }));
    kit.expectFails(res, 'read-only', /REQ-001\.feature was modified/, { only: true });
  });

  test('regenerating the manifest, editing the PRD, deleting a file or writing a stray file fails read-only', async () => {
    for (const [name, agent, re] of [
      ['manifest', (ws) => ws.write('features/PRD-2026-a1b2c3d4-csv2json/.prd-trace.json', '{}\n'), /\.prd-trace\.json was modified/],
      ['prd', (ws) => ws.write('docs/PRD/PRD-2026-a1b2c3d4-csv2json.md', 'edited\n'), /csv2json\.md was modified/],
      ['delete', (ws) => ws.remove(FEATURE), /REQ-001\.feature was deleted/],
      ['stray', (ws) => ws.write('src/fix.js', 'x\n'), /unexpected files written: src\/fix\.js/],
    ]) {
      const res = await kit.runEval(ID, (ws) => { saves(GOOD)(ws); agent(ws); });
      kit.expectFails(res, 'read-only', re, { only: true });
      expect(name).toBeTruthy();
    }
  });

  test('arms: baseline loads nothing, with-skill loads packages/product; the command prefixes only the with-skill prompt', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.prompt.startsWith('/ensemble-product:ensemble:check-feature-drift ')).toBe(true);
    expect(baseline.prompt).not.toMatch(/^\//);
  }, 60000);
});
