'use strict';

const { parsePRD } = require('../lib/prd-parser');
const {
  scanBindingAttributes,
  diffBindingDrift,
} = require('../lib/reqnroll-gen');

const PRD = parsePRD(
  '### REQ-001: x\n' +
    '- AC-001-1: Given a user, when they log in, then they see the dashboard.\n'
);

// A .cs file whose attributes exactly match the PRD's three steps.
const CS_IN_SYNC = `
[Binding]
public partial class REQ001Steps {
  [Given(@"a user")] public void G() => throw new PendingStepException();
  [When(@"they log in")] public void W() => throw new PendingStepException();
  [Then(@"they see the dashboard")] public void T() => throw new PendingStepException();
}`;

describe('scanBindingAttributes', () => {
  test('extracts keyword + literal text from [Given/When/Then(@"...")]', () => {
    const found = scanBindingAttributes(CS_IN_SYNC);
    expect(found).toContainEqual({ keyword: 'Given', text: 'a user' });
    expect(found).toContainEqual({ keyword: 'When', text: 'they log in' });
    expect(found.length).toBe(3);
  });

  test('unescapes doubled quotes', () => {
    const found = scanBindingAttributes('[Given(@"a ""quoted"" thing")]');
    expect(found[0].text).toBe('a "quoted" thing');
  });
});

describe('diffBindingDrift', () => {
  test('IN_SYNC when bindings match the PRD steps', () => {
    const r = diffBindingDrift(PRD, [CS_IN_SYNC]);
    expect(r.inSync).toBe(true);
    expect(r.unbound).toEqual([]);
    expect(r.orphaned).toEqual([]);
  });

  test('UNBOUND when the PRD has a step with no binding', () => {
    const missing = `[Given(@"a user")] [When(@"they log in")]`; // no Then
    const r = diffBindingDrift(PRD, [missing]);
    expect(r.inSync).toBe(false);
    expect(r.unbound.map((s) => s.text)).toContain('they see the dashboard');
  });

  test('ORPHANED when a binding has no matching PRD step', () => {
    const extra = CS_IN_SYNC + '\n[Then(@"some removed outcome")] public void X(){}';
    const r = diffBindingDrift(PRD, [extra]);
    expect(r.inSync).toBe(false);
    expect(r.orphaned.map((s) => s.text)).toContain('some removed outcome');
  });

  test('a reworded AC shows up as BOTH unbound (new text) and orphaned (old text)', () => {
    const reworded = parsePRD(
      '### REQ-001: x\n- AC-001-1: Given a user, when they log in, then they land on the home page.\n'
    );
    const r = diffBindingDrift(reworded, [CS_IN_SYNC]);
    expect(r.unbound.map((s) => s.text)).toContain('they land on the home page');
    expect(r.orphaned.map((s) => s.text)).toContain('they see the dashboard');
  });
});
