'use strict';

/**
 * Proof for the ensemble-generate-reqnroll-bindings eval: the good stub is the real deterministic generator's output for the seeded
 * PRD (so the checks are calibrated against what the skill really produces), and each bad output is a plausible wrong scaffold.
 */

const kit = require('../skill-eval-kit');
const { parsePRD } = require('../../../packages/product/lib/prd-parser');
const { buildBindingArtifacts } = require('../../../packages/product/lib/reqnroll-gen');

const ID = 'ensemble-generate-reqnroll-bindings';
const SLUG = 'PRD-2026-0a1b2c3d-csv2json';
const PRD = `docs/PRD/${SLUG}.md`;
const SUT = 'src/Csv2Json/Csv2Json.csproj';
const DIR = `tests/${SLUG}`;
const CHECK_IDS = ['scaffold-files', 'feature-scenarios', 'step-bindings', 'csproj-wired', 'trace-manifest', 'matches-generator', 'no-stray-writes'];

/** The generator's own output for the seeded PRD, as { relative path: text } under the scaffold directory. */
function generated(ws) {
  const built = buildBindingArtifacts(parsePRD(ws.read(PRD)), SLUG, { sutCsproj: SUT, prdPath: PRD });
  const out = {};
  for (const f of built.files) out[f.relPath] = f.content;
  out['.reqnroll-trace.json'] = `${JSON.stringify(built.manifest, null, 2)}\n`;
  return out;
}

/** An agent that writes the scaffold, after `edit(files)` has changed it (a file set to null is not written). */
const scaffolds = (edit = () => {}, extra = {}) => (ws) => {
  const files = generated(ws);
  edit(files, ws);
  for (const [rel, text] of Object.entries(files)) if (text !== null) ws.write(`${DIR}/${rel}`, text);
  for (const [rel, text] of Object.entries(extra)) ws.write(rel, text);
};
const csproj = (files) => Object.keys(files).find((k) => k.endsWith('.Tests.csproj'));
const swap = (files, rel, from, to) => {
  if (!files[rel].includes(from)) throw new Error(`test setup: ${rel} does not contain ${from}`);
  files[rel] = files[rel].replace(from, to);
};

describe(`${ID} eval`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.command).toBe('/ensemble-product:ensemble:generate-reqnroll-bindings');
    expect(ev.fixtureDir).toBeTruthy();
  });

  test('the generator output for the seeded PRD passes every check, in the declared order', async () => {
    const res = await kit.runEval(ID, scaffolds());
    expect(Object.keys(res)).toEqual(CHECK_IDS);
    kit.expectAllPass(res);
  });

  test('a run that writes nothing fails every scaffold check (the seeded fixture alone passes none)', async () => {
    const res = await kit.runEval(ID, () => {});
    kit.expectFails(res, CHECK_IDS, /no \.reqnroll-trace\.json/, { only: true });
  });

  test('a missing feature file fails scaffold-files', async () => {
    const res = await kit.runEval(ID, scaffolds((f) => { f['Features/REQ-002.feature'] = null; }));
    kit.expectFails(res, ['scaffold-files', 'feature-scenarios', 'matches-generator'], /REQ-002\.feature/);
    kit.expectFails(res, 'scaffold-files', /REQ-002\.feature is missing/);
  });

  test('a scenario that paraphrases a PRD step fails feature-scenarios', async () => {
    const res = await kit.runEval(ID, scaffolds((f) => swap(f, 'Features/REQ-002.feature', 'Given a row with too many fields', 'Given a malformed row')));
    kit.expectFails(res, 'feature-scenarios', /verbatim step "Given a row with too many fields"/);
    kit.expectFails(res, 'matches-generator', /REQ-002\.feature differs/);
  });

  test('a scenario with no AC tag fails feature-scenarios', async () => {
    const res = await kit.runEval(ID, scaffolds((f) => swap(f, 'Features/REQ-001.feature', '@AC-001-2', '@AC-001-9')));
    kit.expectFails(res, 'feature-scenarios', /no scenario tagged @AC-001-2/);
  });

  test('a step body that is implemented instead of Pending fails step-bindings', async () => {
    const res = await kit.runEval(ID, scaffolds((f) => swap(f, 'Steps/REQ-002.Steps.cs', 'public void WhenTheToolRuns() => throw new PendingStepException();', 'public void WhenTheToolRuns() { _ctx["ran"] = true; }')));
    kit.expectFails(res, 'step-bindings', /not a Pending stub/);
  });

  test('a step attribute that is not the literal expression fails step-bindings (and drifts from the generator)', async () => {
    const res = await kit.runEval(ID, scaffolds((f) => swap(f, 'Steps/REQ-001.Steps.cs', '@"^the analyst runs the tool$"', '@"the analyst runs the tool"')));
    kit.expectFails(res, 'step-bindings', /has no \[When\(@"\^the analyst runs the tool\$"\)\] binding/);
    kit.expectFails(res, 'matches-generator');
  });

  test('a missing step stub fails step-bindings', async () => {
    const res = await kit.runEval(ID, scaffolds((f) => {
      f['Steps/REQ-002.Steps.cs'] = f['Steps/REQ-002.Steps.cs'].replace(/\n {4}\[Then\([^\n]*\n[^\n]*\n/, '\n');
    }));
    kit.expectFails(res, 'step-bindings', /REQ-002\.Steps\.cs has no \[Then/);
  });

  test('a project without Reqnroll.xUnit fails csproj-wired', async () => {
    const res = await kit.runEval(ID, scaffolds((f) => swap(f, csproj(f), 'Reqnroll.xUnit', 'Reqnroll.NUnit')));
    kit.expectFails(res, 'csproj-wired', /no PackageReference to Reqnroll\.xUnit/);
  });

  test('a project that does not reference the SUT fails csproj-wired', async () => {
    const res = await kit.runEval(ID, scaffolds((f) => { f[csproj(f)] = f[csproj(f)].replace(/\s*<ProjectReference[^\n]*/, ''); }));
    kit.expectFails(res, 'csproj-wired', /no ProjectReference/);
  });

  test('a project that references the wrong project fails csproj-wired', async () => {
    const res = await kit.runEval(ID, scaffolds((f) => swap(f, csproj(f), 'src/Csv2Json/Csv2Json.csproj', 'src/Other/Other.csproj')));
    kit.expectFails(res, 'csproj-wired', /expected src\/Csv2Json\/Csv2Json\.csproj/);
  });

  test('an invalid reqnroll.json fails csproj-wired', async () => {
    const res = await kit.runEval(ID, scaffolds((f) => { f['reqnroll.json'] = '{ "language": '; }));
    kit.expectFails(res, 'csproj-wired', /reqnroll\.json is not valid JSON/);
  });

  test('a manifest with a made-up hash fails trace-manifest', async () => {
    const res = await kit.runEval(ID, scaffolds((f) => {
      const m = JSON.parse(f['.reqnroll-trace.json']);
      m.steps[0].hash = '000000000000';
      f['.reqnroll-trace.json'] = `${JSON.stringify(m, null, 2)}\n`;
    }));
    kit.expectFails(res, 'trace-manifest', /not the generator's fingerprint/);
  });

  test('a manifest that lists too few steps fails trace-manifest', async () => {
    const res = await kit.runEval(ID, scaffolds((f) => {
      const m = JSON.parse(f['.reqnroll-trace.json']);
      m.steps.pop();
      f['.reqnroll-trace.json'] = `${JSON.stringify(m, null, 2)}\n`;
    }));
    kit.expectFails(res, 'trace-manifest', /lists 7 steps/);
  });

  test('a manifest that is not JSON fails trace-manifest', async () => {
    const res = await kit.runEval(ID, scaffolds((f) => { f['.reqnroll-trace.json'] = 'not json'; }));
    kit.expectFails(res, 'trace-manifest', /(^|: )\.reqnroll-trace\.json is not valid JSON/);
  });

  test('two test projects fail scaffold-files', async () => {
    const res = await kit.runEval(ID, scaffolds((f) => { f['Other.Tests.csproj'] = f[csproj(f)]; }));
    kit.expectFails(res, 'scaffold-files', /expected one \*\.Tests\.csproj/);
  });

  test('an extra hand-written step fails step-bindings', async () => {
    const res = await kit.runEval(ID, scaffolds((f) => swap(f, 'Steps/REQ-002.Steps.cs', '    [When(', '    [Given(@"^an extra step$")]\n    public void GivenAnExtraStep() => throw new PendingStepException();\n\n    [When(')));
    kit.expectFails(res, 'step-bindings', /has 4 step attributes, the PRD has 3/);
  });

  test('a step class without [Binding] fails step-bindings', async () => {
    const res = await kit.runEval(ID, scaffolds((f) => swap(f, 'Steps/REQ-001.Steps.cs', '[Binding]\n', '')));
    kit.expectFails(res, 'step-bindings', /no \[Binding\] class/);
  });

  test('a harmless extra comment in a step file passes the shape checks but fails matches-generator', async () => {
    const res = await kit.runEval(ID, scaffolds((f) => { f['Steps/REQ-001.Steps.cs'] += '// extra\n'; }));
    kit.expectFails(res, 'matches-generator', /REQ-001\.Steps\.cs differs/, { only: true });
  });

  test('an edited PRD fails no-stray-writes', async () => {
    const res = await kit.runEval(ID, scaffolds(() => {}, { [PRD]: 'changed\n' }));
    kit.expectFails(res, 'no-stray-writes', /was modified/, { only: true });
  });

  test('a file written outside the scaffold fails no-stray-writes', async () => {
    const res = await kit.runEval(ID, scaffolds(() => {}, { 'src/Csv2Json/Program.cs': 'class P {}\n' }));
    kit.expectFails(res, 'no-stray-writes', /src\/Csv2Json\/Program\.cs/, { only: true });
  });

  test('a scaffold written under a different --out still passes (the directory is found by its manifest)', async () => {
    const res = await kit.runEval(ID, (ws) => {
      for (const [rel, text] of Object.entries(generated(ws))) ws.write(`acceptance/${SLUG}/${rel}`, text);
    });
    kit.expectAllPass(res);
  });

  test('two scaffolds fail (ambiguous)', async () => {
    const res = await kit.runEval(ID, (ws) => {
      for (const [rel, text] of Object.entries(generated(ws))) { ws.write(`tests/${SLUG}/${rel}`, text); ws.write(`other/${SLUG}/${rel}`, text); }
    });
    kit.expectFails(res, CHECK_IDS, /expected one scaffold, found 2/, { only: true });
  });

  test('arms: baseline loads nothing, with-skill loads packages/product; the command prefixes only the with-skill prompt', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.prompt.startsWith('/ensemble-product:ensemble:generate-reqnroll-bindings ')).toBe(true);
    expect(baseline.prompt).not.toMatch(/^\//);
  }, 60000);
});
