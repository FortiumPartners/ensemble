'use strict';

/**
 * Kit test for the `ensemble-generate-feature-tests` eval. The good output is the REAL generator's output (packages/product/lib
 * writeArtifacts, the code the skill runs) on the fixture PRD; the bad outputs are plausible hand-authored mistakes made from it.
 */

const fs = require('fs');
const path = require('path');
const kit = require('../skill-eval-kit');
const { parsePRD } = require('../../../packages/product/lib/prd-parser');
const { writeArtifacts } = require('../../../packages/product/lib/feature-gen');

const ID = 'ensemble-generate-feature-tests';
const PRD = 'docs/PRD/PRD-2026-a1b2c3d4-csv2json.md';
const SLUG = 'PRD-2026-a1b2c3d4-csv2json';
const OUT = `features/${SLUG}`;
const FIXTURE = path.join(__dirname, '..', '..', 'skills', ID, 'fixture', PRD);
const IDS = ['features-saved', 'scenario-per-ac', 'gwt-steps', 'needs-clarification', 'trace-tags', 'manifest', 'hashes-match', 'prd-unchanged', 'no-impl-files'];

/** The generator's own files for the fixture PRD, as { relPath under the workspace: text }. */
function generated() {
  const root = fs.mkdtempSync(path.join(require('os').homedir(), '.omp', 'trd-skills-eval', 'gft-gen-'));
  try {
    writeArtifacts(parsePRD(fs.readFileSync(FIXTURE, 'utf8')), SLUG, path.join(root, 'features'), { prdPath: PRD });
    const dir = path.join(root, 'features', SLUG);
    const out = {};
    for (const f of fs.readdirSync(dir)) out[`${OUT}/${f}`] = fs.readFileSync(path.join(dir, f), 'utf8');
    return out;
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
const GOOD = generated();

/** A stub agent that writes GOOD with `edit(files)` applied (a copy), plus `extra` files. */
const writes = (edit = () => {}, extra = {}) => (ws) => {
  const files = { ...GOOD };
  edit(files);
  for (const [rel, text] of Object.entries(files)) if (text !== null) ws.write(rel, text);
  for (const [rel, text] of Object.entries(extra)) ws.write(rel, text);
};
const F = (n) => `${OUT}/REQ-00${n}.feature`;
const M = `${OUT}/.prd-trace.json`;
const manifestEdit = (fn) => (files) => { const m = JSON.parse(files[M]); fn(m); files[M] = JSON.stringify(m, null, 2); };

describe(`${ID} eval`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration, claude only', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.runtimes).toEqual(['claude']);
    expect(ev.invocation).toBe('explicit');
  });

  test('the generator output (the real artifacts) passes every check, in the declared order', async () => {
    expect(Object.keys(GOOD).sort()).toEqual([F(1), F(2), F(3), F(4), M].sort());
    const res = await kit.runEval(ID, writes());
    expect(Object.keys(res)).toEqual(IDS);
    kit.expectAllPass(res);
  });

  test('a run that writes nothing fails the artifact checks; the untouched fixture still passes prd-unchanged and no-impl-files', async () => {
    const res = await kit.runEval(ID, () => {});
    kit.expectFails(res, ['features-saved', 'scenario-per-ac', 'gwt-steps', 'needs-clarification', 'trace-tags', 'manifest', 'hashes-match'], /not written|no Scenario|dropped/, { only: true });
  });

  test('a missing requirement file fails features-saved and scenario-per-ac', async () => {
    const res = await kit.runEval(ID, writes((f) => { f[F(2)] = null; }));
    kit.expectFails(res, 'features-saved', /REQ-002\.feature was not written/);
  });

  test('a feature file for an invented requirement fails features-saved only', async () => {
    const res = await kit.runEval(ID, writes((f) => { f[`${OUT}/REQ-009.feature`] = 'Feature: invented\n'; }));
    kit.expectFails(res, 'features-saved', /unexpected feature files: REQ-009/, { only: true });
  });

  test('a dropped acceptance criterion (scenario removed) fails scenario-per-ac', async () => {
    const res = await kit.runEval(ID, writes((f) => { f[F(1)] = f[F(1)].replace(/ {2}@AC-001-2[\s\S]*$/, ''); }));
    kit.expectFails(res, 'scenario-per-ac', /no Scenario tagged @AC-001-2.*dropped/);
  });

  test('two ACs merged into one scenario, or a duplicated scenario, fails scenario-per-ac', async () => {
    const dup = await kit.runEval(ID, writes((f) => { f[F(2)] += `\n${f[F(2)].slice(f[F(2)].indexOf('  @AC-002-1'))}`; }));
    kit.expectFails(dup, 'scenario-per-ac', /2 Scenarios tagged @AC-002-1/);
  });

  test('an acceptance criterion placed in the wrong requirement file fails scenario-per-ac', async () => {
    const res = await kit.runEval(ID, writes((f) => {
      const block = f[F(2)].slice(f[F(2)].indexOf('  @AC-002-1'));
      f[F(2)] = f[F(2)].replace(block, '');
      f[F(1)] += `\n${block}`;
    }));
    kit.expectFails(res, 'scenario-per-ac', /@AC-002-1 is in REQ-001\.feature, expected REQ-002\.feature/);
  });

  test('a structured AC emitted without a Then step fails gwt-steps', async () => {
    const res = await kit.runEval(ID, writes((f) => { f[F(2)] = f[F(2)].replace(/^ {4}Then .*\n/m, ''); }));
    kit.expectFails(res, 'gwt-steps', /@AC-002-1 lacks Given, When, Then/, { only: true });
  });

  test('a structured AC wrongly tagged @needs-clarification fails gwt-steps', async () => {
    const res = await kit.runEval(ID, writes((f) => { f[F(2)] = f[F(2)].replace('@AC-002-1 ', '@AC-002-1 @needs-clarification '); }));
    kit.expectFails(res, 'gwt-steps', /already Given\/When\/Then/);
  });

  test('a free-form AC turned into invented steps fails needs-clarification', async () => {
    const res = await kit.runEval(ID, writes((f) => {
      f[F(4)] = f[F(4)].replace(/ {4}#.*\n {4}#.*\n?/, '    Given a typical file\n    When the tool runs\n    Then it is fast\n');
    }));
    kit.expectFails(res, 'needs-clarification', /@AC-004-1.*executable steps/);
  });

  test('a free-form AC without the @needs-clarification tag fails needs-clarification', async () => {
    const res = await kit.runEval(ID, writes((f) => { f[F(4)] = f[F(4)].replace(' @needs-clarification', ''); }));
    kit.expectFails(res, 'needs-clarification', /@AC-004-1 is free-form or flagged but not tagged/);
  });

  test('missing hash tags or document tag fail trace-tags', async () => {
    const noHash = await kit.runEval(ID, writes((f) => { f[F(1)] = f[F(1)].replace(/ @hash:[0-9a-f]{12}/, ''); }));
    kit.expectFails(noHash, 'trace-tags', /lacks a @hash/);
    const noDoc = await kit.runEval(ID, writes((f) => { f[F(3)] = f[F(3)].replace('@prd-2026-a1b2c3d4 ', ''); }));
    kit.expectFails(noDoc, 'trace-tags', /REQ-003\.feature lacks the document tag @prd-2026-a1b2c3d4/);
  });

  test('a missing manifest fails manifest and hashes-match', async () => {
    const res = await kit.runEval(ID, writes((f) => { f[M] = null; }));
    kit.expectFails(res, ['manifest', 'hashes-match'], /\.prd-trace\.json was not written/, { only: true });
  });

  test('a manifest without an AC entry, or with the wrong flag, fails manifest', async () => {
    const gone = await kit.runEval(ID, writes(manifestEdit((m) => { delete m.acs['AC-001-2']; })));
    kit.expectFails(gone, 'manifest', /no entry for AC-001-2/);
    const flag = await kit.runEval(ID, writes(manifestEdit((m) => { m.acs['AC-004-1'].needs_clarification = false; })));
    kit.expectFails(flag, 'manifest', /AC-004-1\.needs_clarification is false, expected true/);
  });

  test('a manifest hash that is well-formed but invented fails hashes-match and manifest (it differs from the scenario tag)', async () => {
    const res = await kit.runEval(ID, writes(manifestEdit((m) => { m.acs['AC-001-1'].hash = '000000000000'; })));
    kit.expectFails(res, ['manifest', 'hashes-match'], /000000000000/, { only: true });
  });

  test('a consistent but invented fingerprint (tag and manifest agree, wrong value) fails only hashes-match', async () => {
    const res = await kit.runEval(ID, writes((f) => {
      const real = JSON.parse(f[M]).acs['AC-001-1'].hash;
      f[F(1)] = f[F(1)].replace(real, 'abcdefabcdef');
      manifestEdit((m) => { m.acs['AC-001-1'].hash = 'abcdefabcdef'; })(f);
    }));
    kit.expectFails(res, 'hashes-match', /AC-001-1\.hash is "abcdefabcdef"/, { only: true });
  });

  test('a feature file with no Feature line fails features-saved', async () => {
    const res = await kit.runEval(ID, writes((f) => { f[F(2)] = f[F(2)].replace(/^Feature:.*\n/m, ''); }));
    kit.expectFails(res, 'features-saved', /REQ-002\.feature has no "Feature:" line/);
  });

  test('an extra invented scenario fails scenario-per-ac', async () => {
    const res = await kit.runEval(ID, writes((f) => { f[F(2)] += '\n  @AC-002-9 @hash:123456789abc\n  Scenario: AC-002-9\n    Given x\n    When y\n    Then z\n'; }));
    kit.expectFails(res, 'scenario-per-ac', /6 Scenarios for 5 acceptance criteria/);
  });

  test('a dropped free-form AC fails needs-clarification as well as scenario-per-ac', async () => {
    const res = await kit.runEval(ID, writes((f) => { f[F(4)] = f[F(4)].replace(/ {2}@AC-004-1[\s\S]*$/, ''); }));
    kit.expectFails(res, 'needs-clarification', /free-form acceptance criterion must be kept/);
  });

  test('a feature without its @REQ tag fails trace-tags', async () => {
    const res = await kit.runEval(ID, writes((f) => { f[F(2)] = f[F(2)].replace(' @REQ-002', ''); }));
    kit.expectFails(res, 'trace-tags', /REQ-002\.feature lacks the @REQ-002 tag/);
  });

  test('manifest entries with a wrong document id, requirement, file, hash format or an extra AC fail manifest', async () => {
    const doc = await kit.runEval(ID, writes(manifestEdit((m) => { m.prd.document_id = 'PRD-2026-ffffffff'; })));
    kit.expectFails(doc, 'manifest', /prd\.document_id is "PRD-2026-ffffffff"/);
    const req = await kit.runEval(ID, writes(manifestEdit((m) => { m.acs['AC-002-1'].req = 'REQ-001'; })));
    kit.expectFails(req, 'manifest', /AC-002-1\.req is "REQ-001"/);
    const file = await kit.runEval(ID, writes(manifestEdit((m) => { m.acs['AC-002-1'].feature_file = 'features.feature'; })));
    kit.expectFails(file, 'manifest', /AC-002-1\.feature_file is "features\.feature"/);
    const extra = await kit.runEval(ID, writes(manifestEdit((m) => { m.acs['AC-009-1'] = { ...m.acs['AC-002-1'] }; })));
    kit.expectFails(extra, 'manifest', /not in the PRD: AC-009-1/);
    const fmt = await kit.runEval(ID, writes((f) => {
      const real = JSON.parse(f[M]).acs['AC-001-1'].hash;
      f[F(1)] = f[F(1)].replace(real, 'XYZ');
      manifestEdit((m) => { m.acs['AC-001-1'].hash = 'XYZ'; })(f);
    }));
    kit.expectFails(fmt, 'manifest', /AC-001-1\.hash is not 12 hex/);
  });

  test('an edited PRD fails prd-unchanged', async () => {
    const res = await kit.runEval(ID, writes(() => {}, { [PRD]: `${fs.readFileSync(FIXTURE, 'utf8')}\n- AC-004-2: Given a file, when it runs, then it is fast.\n` }));
    kit.expectFails(res, 'prd-unchanged', /modified/);
  });

  test('step definitions or implementation files fail no-impl-files only', async () => {
    const res = await kit.runEval(ID, writes(() => {}, { 'steps/csv.steps.js': 'module.exports = {};\n', 'src/csv2json.js': 'module.exports = {};\n' }));
    kit.expectFails(res, 'no-impl-files', /steps\/csv\.steps\.js/, { only: true });
  });

  test('arms: baseline loads nothing, with-skill loads packages/product; the command prefixes only the with-skill prompt', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.prompt.startsWith('/ensemble-product:ensemble:generate-feature-tests ')).toBe(true);
    expect(baseline.prompt).not.toMatch(/^\//);
  }, 60000);
});
