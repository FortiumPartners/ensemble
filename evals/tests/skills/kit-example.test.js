'use strict';

/**
 * Worked example of the skill eval kit (evals/tests/skill-eval-kit.js) against `ensemble-create-prd`. Copy this file to
 * `evals/tests/skills/<skill>.test.js` and change: the id, the good output, the bad outputs and the check ids they must fail.
 * The existing pilot suite (`evals/tests/pilot-evals.test.js`) is not migrated; this only proves the kit.
 */

const kit = require('../skill-eval-kit');

const ID = 'ensemble-create-prd';
const PRD = 'docs/PRD/PRD-2026-0f1e2d3c-csv2json.md';

const GOOD = `---
document_id: PRD-2026-0f1e2d3c
label: prd-csv2json
version: 1.0.0
status: Draft
---

# PRD-2026-0f1e2d3c: csv2json

## PRD Health Summary

- **Constitution compliance:** passed

## Requirements

### REQ-001: Convert a CSV file (Must)

- AC-001-1: Given a CSV file with a header row, when the analyst runs the tool, then it prints a JSON array of objects.

### REQ-002: Report bad rows (Must)

- AC-002-1: Given a row with too many fields, when the tool runs, then it exits non-zero and names the row.
`;

/** A stub agent that saves `text` as the PRD (and optionally other files). */
const saves = (text, extra = {}) => (ws) => {
  if (text !== null) ws.write(PRD, text);
  for (const [rel, body] of Object.entries(extra)) ws.write(rel, body);
};

describe(`${ID} (kit example)`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.fixtureDir).toBeTruthy();
  });

  test('a good PRD passes every check', async () => {
    const res = await kit.runEval(ID, saves(GOOD));
    expect(Object.keys(res)).toEqual(['prd-saved', 'prd-reqs', 'prd-gwt', 'prd-constitution', 'no-impl-files']);
    kit.expectAllPass(res);
  });

  test('a run that writes nothing fails the four PRD checks and only those', async () => {
    kit.expectFails(await kit.runEval(ID, saves(null)), ['prd-saved', 'prd-reqs', 'prd-gwt', 'prd-constitution'], /no new PRD/, { only: true });
  });

  test('acceptance criteria that are not Given/When/Then fail prd-gwt', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace(/Given a CSV file[^\n]*/, 'The tool converts CSV.')));
    kit.expectFails(res, 'prd-gwt', /not Given\/When\/Then/, { only: true });
  });

  test('a PRD that does not record constitution compliance fails prd-constitution', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('passed', 'failed')));
    kit.expectFails(res, 'prd-constitution', /Constitution compliance: passed/, { only: true });
  });

  test('an implementation file written next to a good PRD fails no-impl-files', async () => {
    const res = await kit.runEval(ID, saves(GOOD, { 'src/csv2json.js': 'module.exports = {};\n' }));
    kit.expectFails(res, 'no-impl-files', /src\/csv2json\.js/, { only: true });
  });

  test('the kit refuses to pass a typo: an unknown check id is an error', async () => {
    const res = await kit.runEval(ID, saves(GOOD));
    expect(() => kit.expectFails(res, 'prd-gtw')).toThrow(/no check "prd-gtw"/);
  });

  test('the helpers can fail: expectAllPass throws on a failing check, expectFails throws on a passing one, a wrong reason or an extra failure', async () => {
    const good = await kit.runEval(ID, saves(GOOD));
    const bad = await kit.runEval(ID, saves(GOOD.replace('passed', 'failed')));
    expect(() => kit.expectAllPass(bad)).toThrow();
    expect(() => kit.expectFails(good, 'prd-constitution')).toThrow();
    expect(() => kit.expectFails(bad, 'prd-constitution', /a reason it did not give/)).toThrow();
    expect(() => kit.expectFails(bad, 'prd-gwt')).toThrow();
    const nothing = await kit.runEval(ID, saves(null));
    expect(() => kit.expectFails(nothing, 'prd-saved', undefined, { only: true })).toThrow();
  });

  test('arms: baseline loads nothing, with-skill loads packages/product; the command prefixes only the with-skill prompt', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.prompt.startsWith('/ensemble-product:ensemble:create-prd ')).toBe(true);
    expect(baseline.prompt).not.toMatch(/^\//);
  }, 60000);
});

// A command-driven eval with `remote`, `branch`, `sandboxPath` and `explicit-both`: the kit builds the same sandbox the harness does.
describe('pr-merge-trace (kit: remote, branch, sandboxPath, sharedPackages)', () => {
  const PM = 'pr-merge-trace';
  test('the sandbox carries the stub bin, a bare origin and the PR branch; the arms share packages/git and prefix the command in both', async () => {
    const ev = kit.loadsClean(PM);
    expect(ev.sandboxPath).toEqual(['bin']);
    let seen;
    const res = await kit.runEval(PM, (ws) => {
      seen = { gh: ws.exists('bin/gh'), origin: require('fs').existsSync(`${ws.root}/origin.git`), branch: ws.sb.baseline.remotePath !== null };
    });
    expect(seen).toEqual({ gh: true, origin: true, branch: true });
    kit.expectFails(res, 'gh-no-merge', /never ran|never answered/); // a run that does nothing cannot pass
    const { baseline, withSkill } = await kit.armsFor(PM);
    expect(baseline.plugins).toHaveLength(1);
    expect(withSkill.plugins).toHaveLength(2);
    expect(baseline.prompt.startsWith(`${ev.command} `)).toBe(true);
    expect(withSkill.prompt).toBe(baseline.prompt);
  }, 60000);
});
