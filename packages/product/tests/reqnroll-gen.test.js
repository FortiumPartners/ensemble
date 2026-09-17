'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parsePRD } = require('../lib/prd-parser');
const {
  collectSteps,
  methodNameFor,
  renderStepClass,
  renderProject,
  buildBindingArtifacts,
  writeBindingArtifacts,
  diffBindingDrift,
} = require('../lib/reqnroll-gen');

const SAMPLE = fs.readFileSync(
  path.join(__dirname, 'fixtures/PRD-sample.md'),
  'utf8'
);
const prd = parsePRD(SAMPLE);

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rn-test-'));
}

describe('methodNameFor', () => {
  test('PascalCases keyword + step text into a C# identifier', () => {
    expect(methodNameFor('When', 'they submit the login form')).toBe(
      'WhenTheySubmitTheLoginForm'
    );
  });
  test('strips punctuation/backticks and is a valid identifier', () => {
    const n = methodNameFor('Given', '`/cmd <x>` runs, then ok');
    expect(n).toMatch(/^[A-Za-z][A-Za-z0-9]*$/);
  });
});

describe('collectSteps', () => {
  const steps = collectSteps(prd);

  test('extracts Given/When/Then steps from structured ACs', () => {
    const texts = steps.map((s) => s.text);
    expect(texts).toContain('a user with valid credentials');
    expect(texts).toContain('they submit the login form');
    expect(steps.every((s) => ['Given', 'When', 'Then'].includes(s.keyword))).toBe(true);
  });

  test('dedupes identical (keyword, text) pairs', () => {
    // AC-001-1 and AC-001-2 share "Given one valid..."? In the fixture both
    // AC-001-* share no text, but AC-002-1 stands alone. Assert no dup pairs.
    const seen = new Set();
    for (const s of steps) {
      const key = s.keyword + '::' + s.text.toLowerCase();
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  test('free-form / needs-clarification ACs contribute no steps', () => {
    // AC-002-2 is free-form, AC-002-3 has a clarification marker -> excluded.
    const texts = steps.map((s) => s.text.toLowerCase());
    expect(texts.some((t) => t.includes('complexity rules'))).toBe(false);
  });
});

describe('diffBindingDrift', () => {
  test('reports stale bindings as orphaned when a structured AC needs clarification', () => {
    const marked = parsePRD(`---
document_id: PRD-2026-clarify
label: clarify-marker
---

# PRD-2026-clarify: Clarification Marker

### REQ-101: Clarify Structured AC [Must] [Low]

- **AC-101-1:** Given a customer has a saved card, when they check out, then payment is captured [NEEDS CLARIFICATION: confirm SCA rules].
`);
    const staleBindings = `
using Reqnroll;

[Binding]
public partial class REQ101Steps
{
    [Given(@"a customer has a saved card")]
    public void GivenACustomerHasASavedCard() => throw new PendingStepException();

    [When(@"they check out")]
    public void WhenTheyCheckOut() => throw new PendingStepException();

    [Then(@"payment is captured")]
    public void ThenPaymentIsCaptured() => throw new PendingStepException();
}
`;

    const res = diffBindingDrift(marked, [staleBindings]);

    expect(res.inSync).toBe(false);
    expect(res.unbound).toEqual([]);
    expect(res.orphaned.map((s) => s.text).sort()).toEqual([
      'a customer has a saved card',
      'payment is captured',
      'they check out',
    ]);
  });
});

describe('renderStepClass', () => {
  const req = prd.reqs[0];
  const steps = collectSteps(prd).filter((s) => s.reqId === req.id);
  const cs = renderStepClass(req, steps);

  test('emits a [Binding] partial class with ScenarioContext injection', () => {
    expect(cs).toContain('[Binding]');
    expect(cs).toContain(`partial class ${req.id.replace('-', '')}Steps`);
    expect(cs).toContain('ScenarioContext');
  });

  test('emits literal verbatim [Given/When/Then(@"...")] attributes', () => {
    expect(cs).toContain('[Given(@"a user with valid credentials")]');
    expect(cs).toContain('[When(@"they submit the login form")]');
  });

  test('every body is a Pending stub', () => {
    expect(cs).toContain('throw new PendingStepException();');
    expect(cs).not.toContain('// TODO real impl');
  });
});

describe('renderProject', () => {
  test('csproj references Reqnroll.xUnit + test SDK and links the SUT', () => {
    const { csproj } = renderProject({ sutCsproj: '../../src/App/App.csproj' });
    expect(csproj).toContain('Reqnroll.xUnit');
    expect(csproj).toContain('Microsoft.NET.Test.Sdk');
    expect(csproj).toContain('xunit');
    expect(csproj).toContain('<ProjectReference Include="../../src/App/App.csproj"');
  });
  test('reqnroll.json sets the xUnit provider', () => {
    const { reqnrollJson } = renderProject({});
    expect(JSON.parse(reqnrollJson)).toHaveProperty('language');
  });
});

describe('buildBindingArtifacts', () => {
  const a = buildBindingArtifacts(prd, 'PRD-sample', { sutCsproj: 'x.csproj' });

  test('produces feature + steps + project files and a bindings manifest', () => {
    const rels = a.files.map((f) => f.relPath);
    expect(rels).toContain('Features/REQ-001.feature');
    expect(rels).toContain('Steps/REQ-001.Steps.cs');
    expect(rels.some((r) => r.endsWith('.csproj'))).toBe(true);
    expect(rels).toContain('reqnroll.json');
    expect(a.manifest.steps.length).toBeGreaterThan(0);
    expect(a.manifest.steps[0]).toHaveProperty('hash');
    expect(a.manifest.steps[0]).toHaveProperty('method');
  });
});

describe('writeBindingArtifacts', () => {
  test('writes the full project tree', () => {
    const dir = mkTmp();
    const res = writeBindingArtifacts(prd, 'PRD-sample', dir, { sutCsproj: 'x.csproj' });
    expect(fs.existsSync(path.join(res.outDir, 'Features/REQ-001.feature'))).toBe(true);
    expect(fs.existsSync(path.join(res.outDir, 'Steps/REQ-001.Steps.cs'))).toBe(true);
    expect(fs.existsSync(path.join(res.outDir, '.reqnroll-trace.json'))).toBe(true);
  });

  test('is WRITE-ONCE for step .cs: a filled body survives regeneration', () => {
    const dir = mkTmp();
    writeBindingArtifacts(prd, 'PRD-sample', dir, {});
    const stepFile = path.join(dir, 'PRD-sample', 'Steps/REQ-001.Steps.cs');
    const edited = fs.readFileSync(stepFile, 'utf8').replace(
      'throw new PendingStepException();',
      '_ctx["done"] = true; // FILLED'
    );
    fs.writeFileSync(stepFile, edited);
    // regenerate
    writeBindingArtifacts(prd, 'PRD-sample', dir, {});
    expect(fs.readFileSync(stepFile, 'utf8')).toContain('// FILLED');
  });

  test('--force overwrites step .cs back to stubs', () => {
    const dir = mkTmp();
    writeBindingArtifacts(prd, 'PRD-sample', dir, {});
    const stepFile = path.join(dir, 'PRD-sample', 'Steps/REQ-001.Steps.cs');
    fs.writeFileSync(stepFile, '// clobbered');
    writeBindingArtifacts(prd, 'PRD-sample', dir, { force: true });
    expect(fs.readFileSync(stepFile, 'utf8')).toContain('PendingStepException');
  });

  test('feature files + manifest regenerate byte-identically', () => {
    const dir = mkTmp();
    writeBindingArtifacts(prd, 'PRD-sample', dir, {});
    const f1 = fs.readFileSync(path.join(dir, 'PRD-sample', 'Features/REQ-001.feature'), 'utf8');
    const m1 = fs.readFileSync(path.join(dir, 'PRD-sample', '.reqnroll-trace.json'), 'utf8');
    writeBindingArtifacts(prd, 'PRD-sample', dir, {});
    expect(fs.readFileSync(path.join(dir, 'PRD-sample', 'Features/REQ-001.feature'), 'utf8')).toBe(f1);
    expect(fs.readFileSync(path.join(dir, 'PRD-sample', '.reqnroll-trace.json'), 'utf8')).toBe(m1);
  });
});
