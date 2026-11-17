'use strict';

/** Proof that the checks of the `ensemble-check-binding-drift` eval pass on a good drift report and fail on plausible wrong ones. */

const kit = require('../skill-eval-kit');

const ID = 'ensemble-check-binding-drift';
const REPORT = 'drift-report.md';
const STEPS = 'tests/PRD-2026-b7c8d9e0-csv2json/Steps/REQ-001.Steps.cs';

// The CLI's own format, as the skill prints it.
const GOOD = `BINDING DRIFT — PRD-2026-b7c8d9e0-csv2json
  + UNBOUND  (4) — PRD step with no binding:
      Then the tool prints an empty JSON array
      Given a CSV file that does not exist
      When the analyst names a missing file
      Then it exits non-zero and names the missing file
  - ORPHANED (1) — binding with no PRD step:
      Then the tool prints an empty array
  Re-run generate-bindings (adds new step stubs); update or remove orphaned bindings.
`;

const saves = (text, extra) => (ws) => {
  if (text !== null) ws.write(REPORT, text);
  if (extra) extra(ws);
};

describe(`${ID} (kit)`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    expect(kit.loadsClean(ID).fixtureDir).toBeTruthy();
  });

  test('a good report passes every check', async () => {
    const res = await kit.runEval(ID, saves(GOOD));
    expect(Object.keys(res)).toEqual(['report-saved', 'report-unbound', 'report-orphaned', 'report-precision', 'bindings-untouched']);
    kit.expectAllPass(res);
  });

  test('a markdown report with headings, bold and backticks passes too', async () => {
    const md = '# Binding drift\n\nStatus: drift detected.\n\n## Unbound steps (PRD, no binding)\n\n- **Then** `the tool prints an empty JSON array`\n'
      + '- Given a CSV file that does not exist\n- When the analyst names a missing file\n- Then it exits non-zero and names the missing file\n\n'
      + '## Orphaned bindings (code, no PRD step)\n\n- THEN  the tool prints   an EMPTY array\n\n## Recommendation\n\nRe-run bindings; an empty CSV file is already covered.\n';
    kit.expectAllPass(await kit.runEval(ID, saves(md)));
  });

  test('a run that writes nothing fails the four report checks; the untouched fixture still passes bindings-untouched', async () => {
    const res = await kit.runEval(ID, saves(null));
    kit.expectFails(res, ['report-saved', 'report-unbound', 'report-orphaned', 'report-precision'], /drift-report\.md/);
    expect(res['bindings-untouched'].pass).toBe(true);
  });

  test('a report that says IN_SYNC fails the unbound and orphaned checks', async () => {
    const res = await kit.runEval(ID, saves('IN_SYNC — PRD-2026-b7c8d9e0-csv2json bindings cover the PRD\'s steps. Nothing to do.\n'));
    kit.expectFails(res, ['report-unbound', 'report-orphaned'], /no (UNBOUND|ORPHANED) section/);
    expect(res['report-saved'].pass).toBe(true);
  });

  test('a report that misses one unbound step fails report-unbound only', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace(/ {6}When the analyst names a missing file\n/, '')));
    kit.expectFails(res, 'report-unbound', /names a missing file/, { only: true });
  });

  test('a report with no orphaned binding listed fails report-orphaned only', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace(/ {6}Then the tool prints an empty array\n/, '      (none)\n')));
    kit.expectFails(res, 'report-orphaned', /empty array/, { only: true });
  });

  test('a report that lists an in-sync step as unbound fails report-precision only', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('      Given a CSV file that does not exist\n', '      Given a CSV file that does not exist\n      Given an empty CSV file\n')));
    kit.expectFails(res, 'report-precision', /bound step reported as drift: an empty CSV file/, { only: true });
  });

  test('a report that also lists an unbound step as orphaned fails report-precision only', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('      Then the tool prints an empty array\n', '      Then the tool prints an empty array\n      Given a CSV file that does not exist\n')));
    kit.expectFails(res, 'report-precision', /unbound step reported as ORPHANED/, { only: true });
  });

  test('a report that also lists the orphaned binding as unbound fails report-precision only', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('      Given a CSV file that does not exist\n', '      Given a CSV file that does not exist\n      Then the tool prints an empty array\n')));
    kit.expectFails(res, 'report-precision', /orphaned binding reported as UNBOUND/, { only: true });
  });

  test('a stub report fails report-saved', async () => {
    const res = await kit.runEval(ID, saves('Drift found.\n'));
    kit.expectFails(res, 'report-saved', /only \d+ characters/);
  });

  test('a report that swaps the two lists fails the listing and precision checks', async () => {
    const swapped = GOOD.replace('UNBOUND ', 'TMP').replace('ORPHANED', 'UNBOUND ').replace('TMP', 'ORPHANED');
    const res = await kit.runEval(ID, saves(swapped));
    kit.expectFails(res, ['report-unbound', 'report-orphaned', 'report-precision'], undefined, { only: true });
  });

  test('a run that adds a stub for an unbound step fails bindings-untouched', async () => {
    const res = await kit.runEval(ID, saves(GOOD, (ws) => {
      ws.write(STEPS, `${ws.read(STEPS)}\n    [Given(@"^a CSV file that does not exist$")]\n    public void GivenACSVFileThatDoesNotExist() => throw new PendingStepException();\n`);
    }));
    kit.expectFails(res, 'bindings-untouched', /a binding was added for an unbound step/, { only: true });
  });

  test('a run that rewrites the orphaned binding fails bindings-untouched', async () => {
    const res = await kit.runEval(ID, saves(GOOD, (ws) => {
      ws.write(STEPS, ws.read(STEPS).replace('the tool prints an empty array', 'the tool prints an empty list'));
    }));
    kit.expectFails(res, 'bindings-untouched', /binding removed or rewritten/, { only: true });
  });

  test('a new file under tests/ fails bindings-untouched', async () => {
    const res = await kit.runEval(ID, saves(GOOD, (ws) => ws.write('tests/PRD-2026-b7c8d9e0-csv2json/Steps/REQ-003.Steps.cs', 'x\n')));
    kit.expectFails(res, 'bindings-untouched', /files under .* changed/, { only: true });
  });

  test('a run that edits the PRD to match the bindings fails bindings-untouched', async () => {
    const prd = 'docs/PRD/PRD-2026-b7c8d9e0-csv2json.md';
    const res = await kit.runEval(ID, saves(GOOD, (ws) => ws.write(prd, ws.read(prd).replace('names the missing file', 'names the file'))));
    kit.expectFails(res, 'bindings-untouched', /the PRD no longer contains/, { only: true });
  });

  test('arms: baseline loads nothing, with-skill loads packages/product; the command prefixes only the with-skill prompt', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.prompt.startsWith('/ensemble-product:ensemble:check-binding-drift ')).toBe(true);
    expect(baseline.prompt).not.toMatch(/^\//);
  }, 60000);
});
