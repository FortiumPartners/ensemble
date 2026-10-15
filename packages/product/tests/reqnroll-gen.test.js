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

// methodNameFor collapses every run of non-alphanumerics to a word break, so two
// steps that differ only in punctuation produce ONE C# identifier. They survive
// dedup because normalizeStepText only lowercases and collapses whitespace, so
// both land in the same partial class and the generated project does not compile
// (CS0111: a member with the same name is already declared).
describe('two steps differing only in punctuation (ensemble#120)', () => {
  const collidePrd = parsePRD(`---
document_id: PRD-2026-collide
label: collide
---

# PRD-2026-collide: Collide

### REQ-001: Plans [Must] [High]

- **AC-001-1:** Given a paused/canceled plan, when the occurrence is due, then nothing is sent.
- **AC-001-2:** Given a paused canceled plan, when the occurrence is skipped, then nothing is sent.
`);
  const collided = collectSteps(collidePrd);

  test('both steps really are present, or this test proves nothing', () => {
    const givens = collided.filter((s) => s.keyword === 'Given').map((s) => s.text);
    expect(givens).toEqual(
      expect.arrayContaining(['a paused/canceled plan', 'a paused canceled plan'])
    );
    expect(givens).toHaveLength(2);
  });

  test('they collapse to one identifier before disambiguation', () => {
    const givens = collided.filter((s) => s.keyword === 'Given');
    const bare = givens.map((s) => methodNameFor(s.keyword, s.text));
    expect(new Set(bare).size).toBe(1);
  });

  test('every method name in a requirement is unique', () => {
    const byReq = new Map();
    for (const s of collided) {
      if (!byReq.has(s.reqId)) byReq.set(s.reqId, []);
      byReq.get(s.reqId).push(s.method);
    }
    for (const [reqId, methods] of byReq) {
      expect(new Set(methods).size).toBe(methods.length);
      expect(reqId).toBeTruthy();
    }
  });

  test('the generated class declares no duplicate method', () => {
    const cs = renderStepClass(collidePrd.reqs[0], collided);
    const declared = (cs.match(/public void (\w+)\(\)/g) || []).map((m) =>
      m.replace(/public void (\w+)\(\)/, '$1')
    );
    expect(declared).toHaveLength(collided.length);
    expect(new Set(declared).size).toBe(declared.length);
  });

  test('every name is still a valid C# identifier', () => {
    for (const s of collided) expect(s.method).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/);
  });

  test('the disambiguator is the step hash, so it does not depend on PRD order', () => {
    const reversed = parsePRD(`---
document_id: PRD-2026-collide
label: collide
---

# PRD-2026-collide: Collide

### REQ-001: Plans [Must] [High]

- **AC-001-1:** Given a paused canceled plan, when the occurrence is skipped, then nothing is sent.
- **AC-001-2:** Given a paused/canceled plan, when the occurrence is due, then nothing is sent.
`);
    const byText = (list) =>
      new Map(list.filter((s) => s.keyword === 'Given').map((s) => [s.text, s.method]));
    expect(byText(collectSteps(reversed))).toEqual(byText(collided));
  });

  test('a step with no collision keeps its clean name', () => {
    const lone = collided.find((s) => s.text === 'the occurrence is due');
    expect(lone.method).toBe('WhenTheOccurrenceIsDue');
  });

  // The manifest is the binding-drift identity, and renderStepClass and the
  // manifest read s.method from the same step objects. Disambiguating anywhere
  // but collectSteps would let those two disagree.
  test('the manifest records the same name the class declares', () => {
    const arts = buildBindingArtifacts(collidePrd, 'collide');
    const cs = arts.files.find((f) => f.relPath.endsWith('REQ-001.Steps.cs')).content;
    const recorded = arts.manifest.steps.map((s) => s.method);
    expect(recorded).toHaveLength(collided.length);
    expect(new Set(recorded).size).toBe(recorded.length);
    for (const method of recorded) {
      expect(cs).toContain(`public void ${method}()`);
    }
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
