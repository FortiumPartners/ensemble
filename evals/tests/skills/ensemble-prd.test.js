'use strict';

/** Proof that the ensemble-prd eval's checks pass on a good routed `create` run and fail on plausible bad ones (no model is called). */

const kit = require('../skill-eval-kit');

const ID = 'ensemble-prd';
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

const saves = (text, extra = {}) => (ws) => {
  if (text !== null) ws.write(PRD, text);
  for (const [rel, body] of Object.entries(extra)) ws.write(rel, body);
};
const IDS = ['prd-saved', 'prd-reqs', 'prd-gwt', 'prd-constitution', 'prd-subject', 'prd-keyword-stripped', 'no-impl-files'];

describe(`${ID}`, () => {
  test('loads clean; the eval is Claude-only (the router reads a sibling skill by relative path)', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.runtimes).toEqual(['claude']);
    expect(ev.invocation).toBe('explicit');
    expect(ev.command).toBe('/ensemble-product:ensemble:prd');
    expect(ev.prompt.startsWith('create ')).toBe(true);
  });

  test('a good routed PRD passes every check', async () => {
    const res = await kit.runEval(ID, saves(GOOD));
    expect(Object.keys(res)).toEqual(IDS);
    kit.expectAllPass(res);
  });

  test('a run that writes nothing (the router halted or never dispatched) fails every PRD check and passes no-impl-files', async () => {
    kit.expectFails(await kit.runEval(ID, saves(null)), IDS.slice(0, 6), /no new PRD/, { only: true });
  });

  test('a PRD about the wrong subject (invented, not the arguments) fails prd-subject only', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace(/csv2json/g, 'invoice-portal')));
    kit.expectFails(res, 'prd-subject', /do not mention csv2json/, { only: true });
  });

  test('a title that mentions the subject only in the body fails prd-subject', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('prd-csv2json', 'prd-tool').replace(': csv2json', ': Data tool').replace('REQ-001: Convert', 'REQ-001: csv2json convert')));
    kit.expectFails(res, 'prd-subject', /do not mention csv2json/, { only: true });
  });

  test('the routing keyword carried into the title or the label fails prd-keyword-stripped', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace(': csv2json', ': Create csv2json'))), 'prd-keyword-stripped', /title starts with the routing keyword/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('prd-csv2json', 'prd-create-csv2json'))), 'prd-keyword-stripped', /label starts with the routing keyword/, { only: true });
  });

  test('a title that merely contains the word later is not a leak', async () => {
    kit.expectAllPass(await kit.runEval(ID, saves(GOOD.replace(': csv2json', ': csv2json, a tool to create JSON'))));
  });

  test('acceptance criteria that are not Given/When/Then fail prd-gwt', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace(/Given a CSV file[^\n]*/, 'The tool converts CSV.')));
    kit.expectFails(res, 'prd-gwt', /not Given\/When\/Then/, { only: true });
  });

  test('a PRD without REQ headings fails prd-reqs and prd-gwt', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace(/REQ-00(\d)/g, 'Requirement $1')));
    kit.expectFails(res, ['prd-reqs', 'prd-gwt'], /no REQ-NNN/, { only: true });
  });

  test('a PRD that does not record constitution compliance fails prd-constitution', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('passed', 'failed')));
    kit.expectFails(res, 'prd-constitution', /Constitution compliance: passed/, { only: true });
  });

  test('two PRDs (the router ran both subcommands or saved twice) fail prd-saved', async () => {
    const res = await kit.runEval(ID, saves(GOOD, { 'docs/PRD/PRD-2026-aaaaaaaa-csv2json.md': GOOD }));
    kit.expectFails(res, 'prd-saved', /found 2/);
  });

  test('an implementation file next to a good PRD fails no-impl-files', async () => {
    const res = await kit.runEval(ID, saves(GOOD, { 'src/csv2json.js': 'module.exports = {};\n' }));
    kit.expectFails(res, 'no-impl-files', /src\/csv2json\.js/, { only: true });
  });

  test('arms: baseline loads no plugin and gets the plain prompt; with-skill loads packages/product and the command prefixes the prompt', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(baseline.prompt.startsWith('create csv2json')).toBe(true);
    expect(withSkill.prompt.startsWith('/ensemble-product:ensemble:prd create csv2json')).toBe(true);
  }, 60000);
});
