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
  escapeCucumberExpression,
  unescapeCucumberExpression,
  migrateStepAttributes,
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

describe('Cucumber-expression escaping', () => {
  test('escapes the opening specials and leaves unpaired closers literal', () => {
    expect(escapeCucumberExpression('a paused/canceled plan')).toBe(
      'a paused\\/canceled plan'
    );
    expect(escapeCucumberExpression('revoked access (temporarily)')).toBe(
      'revoked access \\(temporarily)'
    );
    expect(escapeCucumberExpression('the {token} field')).toBe('the \\{token} field');
    expect(escapeCucumberExpression('a back\\slash')).toBe('a back\\\\slash');
  });

  test('leaves text with no specials byte-identical', () => {
    const plain = 'a user with valid credentials, then it fails.';
    expect(escapeCucumberExpression(plain)).toBe(plain);
  });

  test('round-trips back to the literal step text', () => {
    for (const s of [
      'a paused/canceled future plan',
      'revoked child access (temporarily)',
      'the {token} and the URL/token pair',
      'a back\\slash and a /slash',
    ]) {
      expect(unescapeCucumberExpression(escapeCucumberExpression(s))).toBe(s);
    }
  });
});

describe('literal slash bindings (ensemble#116)', () => {
  // Reqnroll reads an unanchored expression with no regex markers as a Cucumber
  // expression, so a raw `/` is alternation and the scenario reports undefined
  // even though the attribute looks byte-identical to the feature file.
  const slashPrd = parsePRD(`---
document_id: PRD-2026-slash
label: slash-literal
---

# PRD-2026-slash: Literal Slash

### REQ-005: Suppress Reminders [Must] [High]

- **AC-005-3:** Given a paused/canceled future plan, when the occurrence is due, then the URL/token is not sent.
`);

  const steps = collectSteps(slashPrd);
  const cs = renderStepClass(slashPrd.reqs[0], steps);

  test('emits the slash escaped so Reqnroll matches it literally', () => {
    expect(cs).toContain('[Given(@"a paused\\/canceled future plan")]');
    expect(cs).toContain('[Then(@"the URL\\/token is not sent")]');
  });

  test('never emits a bare slash in a step attribute', () => {
    const attrs = cs.match(/\[(?:Given|When|Then)\(@"[^"]*"\)\]/g) || [];
    expect(attrs.length).toBe(3);
    for (const a of attrs) expect(a).not.toMatch(/[^\\]\//);
  });

  test('the method name is unchanged by escaping, so filled bodies stay bound', () => {
    expect(cs).toContain('public void GivenAPausedCanceledFuturePlan()');
  });

  test('an escaped binding still matches its unescaped PRD step', () => {
    const res = diffBindingDrift(slashPrd, [cs]);
    expect(res.unbound).toEqual([]);
    expect(res.orphaned).toEqual([]);
    expect(res.inSync).toBe(true);
  });

  test('drift is still detected when a binding is genuinely absent', () => {
    const truncated = cs.replace(
      /\n*    \[Then\(@"the URL\\\/token is not sent"\)\]\n.*\n/,
      '\n'
    );
    expect(truncated).not.toContain('the URL\\/token');
    const res = diffBindingDrift(slashPrd, [truncated]);
    expect(res.inSync).toBe(false);
    expect(res.unbound.map((s) => s.text)).toEqual(['the URL/token is not sent']);
  });
});

describe('migrateStepAttributes (ensemble#116 migration)', () => {
  const slashPrd = parsePRD(`---
document_id: PRD-2026-slash-migrate
label: slash-migrate
---

# PRD-2026-slash-migrate: Literal Slash

### REQ-005: Suppress Reminders [Must] [High]

- **AC-005-3:** Given a paused/canceled future plan, when the occurrence is due, then the URL/token is not sent.
`);

  // A step file generated BEFORE the fix, with bodies since filled in.
  const filled = `using Reqnroll;
using FluentAssertions;

namespace Acceptance.Tests;

[Binding]
public partial class REQ005Steps
{
    private readonly ScenarioContext _ctx;
    public REQ005Steps(ScenarioContext ctx) => _ctx = ctx;

    [Given(@"a paused/canceled future plan")]
    public void GivenAPausedCanceledFuturePlan()
        => _ctx["state"] = Plan.Evolve(Plan.Initial, new PlanPaused(DateOnly.MaxValue));

    [When(@"the occurrence is due")]
    public async Task WhenTheOccurrenceIsDue()
    {
        _ctx["events"] = await _sut.Dispatch(new OccurrenceDue());
    }

    [Then(@"the URL/token is not sent")]
    public void ThenTheURLTokenIsNotSent()
        => _ctx.Get<IReadOnlyList<object>>("events").Should().BeEmpty();
}
`;

  const res = migrateStepAttributes(filled, slashPrd);

  test('rewrites exactly the attributes that were wrong', () => {
    expect(res.rewritten.map((r) => r.text).sort()).toEqual([
      'a paused/canceled future plan',
      'the URL/token is not sent',
    ]);
    expect(res.content).toContain('[Given(@"a paused\\/canceled future plan")]');
    expect(res.content).toContain('[Then(@"the URL\\/token is not sent")]');
  });

  test('leaves an already-correct attribute untouched', () => {
    expect(res.rewritten.some((r) => r.text === 'the occurrence is due')).toBe(false);
    expect(res.content).toContain('[When(@"the occurrence is due")]');
  });

  test('every filled body survives byte-identical', () => {
    for (const body of [
      '        => _ctx["state"] = Plan.Evolve(Plan.Initial, new PlanPaused(DateOnly.MaxValue));',
      '        _ctx["events"] = await _sut.Dispatch(new OccurrenceDue());',
      '        => _ctx.Get<IReadOnlyList<object>>("events").Should().BeEmpty();',
    ]) {
      expect(res.content).toContain(body);
    }
    // Only the two attribute lines differ from the original.
    const before = filled.split('\n');
    const after = res.content.split('\n');
    expect(after.length).toBe(before.length);
    const changed = before.filter((l, i) => l !== after[i]);
    expect(changed).toEqual([
      '    [Given(@"a paused/canceled future plan")]',
      '    [Then(@"the URL/token is not sent")]',
    ]);
  });

  test('the migrated file is in sync with the PRD', () => {
    expect(diffBindingDrift(slashPrd, [res.content]).inSync).toBe(true);
  });

  test('is idempotent', () => {
    const again = migrateStepAttributes(res.content, slashPrd);
    expect(again.rewritten).toEqual([]);
    expect(again.content).toBe(res.content);
  });

  test('reports a binding absent from the PRD instead of guessing', () => {
    const extra = filled.replace(
      '}\n',
      `
    [Given(@"a step nobody declared")]
    public void GivenAStepNobodyDeclared() => throw new PendingStepException();
}
`
    );
    const r = migrateStepAttributes(extra, slashPrd);
    expect(r.unmatched).toEqual(['a step nobody declared']);
    expect(r.content).toContain('[Given(@"a step nobody declared")]');
  });

  // Reqnroll lets you stack a second attribute on one method to bind an alias.
  // Pairing each attribute line to the next declaration below it rewrote BOTH to
  // the same step's text, destroying the alias with nothing reported.
  describe('when an alias attribute is stacked on a generated method', () => {
    const aliased = `[Binding]
public partial class REQ005Steps
{
    [Given(@"a paused/canceled future plan")]
    [Given(@"a plan that is not active")]
    public void GivenAPausedCanceledFuturePlan()
        => _ctx["state"] = Plan.Initial;
}
`;

    test('escapes the generated attribute and leaves the alias intact', () => {
      const r = migrateStepAttributes(aliased, slashPrd);
      expect(r.content).toContain('[Given(@"a paused\\/canceled future plan")]');
      expect(r.content).toContain('[Given(@"a plan that is not active")]');
    });

    test('reports the alias rather than silently overwriting it', () => {
      const r = migrateStepAttributes(aliased, slashPrd);
      expect(r.unmatched).toEqual(['a plan that is not active']);
      expect(r.rewritten.map((x) => x.text)).toEqual(['a paused/canceled future plan']);
    });
  });

  // methodNameFor strips exactly the characters this migration escapes, so two
  // distinct steps land on one identifier. Matching on the step text instead of
  // the method name makes that irrelevant: each attribute already says which
  // step it is, so both migrate correctly.
  describe('when two steps produce the same method name', () => {
    const collidePrd = parsePRD(`---
document_id: PRD-2026-collide
label: collide
---

# PRD-2026-collide: Collision

### REQ-001: Collide [Must] [High]

- **AC-001-1:** Given a paused/canceled plan, when it is due, then nothing is sent.
- **AC-001-2:** Given a paused canceled plan, when it fires, then nothing is logged.
`);

    const collided = `[Binding]
public partial class REQ001Steps
{
    [Given(@"a paused/canceled plan")]
    public void GivenAPausedCanceledPlan()
        => _ctx["kept"] = true;
}
`;

    test('the two steps really do collide, or this test proves nothing', () => {
      const methods = collectSteps(collidePrd).map((s) => s.method);
      expect(methods.filter((m) => m === 'GivenAPausedCanceledPlan')).toHaveLength(2);
    });

    test('escapes the colliding binding to ITS OWN step, not the other one', () => {
      const r = migrateStepAttributes(collided, collidePrd);
      expect(r.rewritten.map((x) => x.text)).toEqual(['a paused/canceled plan']);
      expect(r.content).toContain('[Given(@"a paused\\/canceled plan")]');
      // The defect this replaced: the attribute became the OTHER step's text.
      expect(r.content).not.toContain('a paused canceled plan');
      expect(r.unmatched).toEqual([]);
    });

    test('migrates the other colliding step correctly too', () => {
      const other = collided.replace(
        '[Given(@"a paused/canceled plan")]',
        '[Given(@"a paused canceled plan")]'
      );
      const r = migrateStepAttributes(other, collidePrd);
      // No specials in that text, so it is already correct and stays byte-identical.
      expect(r.rewritten).toEqual([]);
      expect(r.content).toBe(other);
    });

    test('a body is never read, so both survive byte-identical', () => {
      const r = migrateStepAttributes(collided, collidePrd);
      expect(r.content).toContain('        => _ctx["kept"] = true;');
      expect(r.content.split('\n')).toHaveLength(collided.split('\n').length);
    });
  });

  // Splitting on '\n' to match a whole line dropped the '\r' of every attribute
  // line in a CRLF file, and counted specials-free attributes as rewritten
  // because the rebuilt line could never equal the original.
  describe('CRLF step files', () => {
    const crlf = [
      '[Binding]',
      'public partial class REQ005Steps',
      '{',
      '    [Given(@"a paused/canceled future plan")]',
      '    public void GivenAPausedCanceledFuturePlan()',
      '        => _ctx["state"] = Plan.Initial;',
      '',
      '    [When(@"the occurrence is due")]',
      '    public void WhenTheOccurrenceIsDue() => _ctx["due"] = true;',
      '}',
      '',
    ].join('\r\n');

    test('every CR survives', () => {
      const r = migrateStepAttributes(crlf, slashPrd);
      expect((r.content.match(/\r\n/g) || []).length).toBe((crlf.match(/\r\n/g) || []).length);
      expect(r.content).not.toMatch(/[^\r]\n/);
    });

    test('escapes the slash and leaves the specials-free attribute alone', () => {
      const r = migrateStepAttributes(crlf, slashPrd);
      expect(r.content).toContain('[Given(@"a paused\\/canceled future plan")]');
      expect(r.rewritten.map((x) => x.text)).toEqual(['a paused/canceled future plan']);
    });

    test('changes nothing but that one attribute', () => {
      const r = migrateStepAttributes(crlf, slashPrd);
      const diff = crlf.split('\r\n').filter((l, i) => l !== r.content.split('\r\n')[i]);
      expect(diff).toEqual(['    [Given(@"a paused/canceled future plan")]']);
    });
  });

  // The line-anchored match required the attribute to sit alone on its line,
  // while the drift scanner's unanchored ATTR_RE saw these too, so migrate
  // skipped silently what drift reported as present.
  describe('attribute shapes that are not alone on their line', () => {
    test('migrates an attribute with the method beside it', () => {
      const inline = '[Given(@"a paused/canceled future plan")] public void G() { }\n';
      const r = migrateStepAttributes(inline, slashPrd);
      expect(r.content).toBe('[Given(@"a paused\\/canceled future plan")] public void G() { }\n');
      expect(r.unmatched).toEqual([]);
    });

    test('migrates an attribute with a trailing comment', () => {
      const commented = '    [Then(@"the URL/token is not sent")] // asserts no dispatch\n';
      const r = migrateStepAttributes(commented, slashPrd);
      expect(r.content).toContain('[Then(@"the URL\\/token is not sent")] // asserts no dispatch');
    });
  });

  // A file generated BEFORE the escaping patch holds the raw step text. If that
  // text contains a backslash, unescaping it yields something matching no step,
  // so the attribute this command exists to fix was reported as unknown.
  test('matches a legacy attribute whose raw text contains a backslash', () => {
    const backslashPrd = parsePRD(`---
document_id: PRD-2026-backslash
label: backslash
---

# PRD-2026-backslash: Backslash

### REQ-001: Paths [Must] [High]

- **AC-001-1:** Given a path c:\\{env}/bin, when it runs, then nothing is logged.
`);
    const step = collectSteps(backslashPrd).find((s) => s.keyword === 'Given');
    // Pre-patch generation wrote the step text through with no escaping.
    const legacy = `    [Given(@"${step.text}")]\n    public void G() { }\n`;
    const r = migrateStepAttributes(legacy, backslashPrd);
    expect(r.unmatched).toEqual([]);
    expect(r.rewritten.map((x) => x.text)).toEqual([step.text]);
    expect(r.content).toContain(escapeCucumberExpression(step.text));
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
