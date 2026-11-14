'use strict';

/** Proof that the checks of the assessment-scoring-conflation-audit eval pass on a correct audit and fail on each plausible wrong one. */

const fs = require('fs');
const path = require('path');
const kit = require('../skill-eval-kit');

const ID = 'assessment-scoring-conflation-audit';
const DOC = 'docs/assessment/assessment-2026-q3.md';
const SEED = fs.readFileSync(path.join(__dirname, '..', '..', 'skills', ID, 'fixture', DOC), 'utf8');

const swap = (text, from, to) => {
  if (!text.includes(from)) throw new Error(`test setup: "${from}" not in text`);
  return text.replace(from, to);
};

// A correct audit: letters from the range table, AI Adoption decomposed, harbor-bff Security re-derived, scope stated.
let GOOD = SEED;
GOOD = swap(GOOD, '| CI/CD | 3.7 | B |', '| CI/CD | 3.7 | B- |');
GOOD = swap(GOOD, '| Testing | 2.6 | C |', '| Testing | 2.6 | C- |');
GOOD = swap(GOOD, /\| AI Adoption \|[^\n]*/.exec(GOOD)[0],
  '| Code AI-Readiness | 3.4 | C+ | Strong type hints and documented playbooks (engineering quality). |\n'
  + '| Agentic Development Practice | 1.8 | D- | Agentic tool signals absent (D-level: no Copilot, CodeGen or LLM workflow found). |');
GOOD = swap(GOOD, /\| Security \| 2\.3 \| D\+ \|[^\n]*/.exec(GOOD)[0],
  '| Security | 3.9 | B | Worst finding is HIGH: the webhook signing secret is optional (Phase 3.5 cap B+ to B, 3.9). |');
GOOD = swap(GOOD, '## Portfolio composite\n',
  '## Portfolio composite\n\nThe portfolio composite covers a different scope than the repository tables (it adds team and product dimensions with no per-repo equivalent), so the two are not expected to match.\n');

const writes = (text, extra = {}) => (ws) => {
  ws.write(DOC, text);
  for (const [rel, body] of Object.entries(extra)) ws.write(rel, body);
};
const fails = async (text, ids, why, extra) => kit.expectFails(await kit.runEval(ID, writes(text, extra)), ids, why, { only: true });

describe(ID, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    expect(kit.loadsClean(ID).fixtureDir).toBeTruthy();
  });

  test('a correct audit passes every check', async () => {
    const res = await kit.runEval(ID, writes(GOOD));
    expect(Object.keys(res)).toEqual(['doc-present', 'letters-match-range-table', 'bucketed-rows-fixed', 'conflation-resolved', 'cross-entity-rederived', 'scope-explained', 'unrelated-rows-untouched', 'no-canary-leak']);
    kit.expectAllPass(res);
  });

  test('a single-row fix (lowered score, gap named, no decomposition) also passes conflation-resolved', async () => {
    const one = swap(GOOD, /\| Code AI-Readiness[^\n]*\n\| Agentic Development Practice[^\n]*/.exec(GOOD)[0],
      '| AI Adoption | 1.8 | D- | Strong type hints (engineering quality); agentic tool signals absent (D-level: no Copilot or LLM workflow). |');
    kit.expectAllPass(await kit.runEval(ID, writes(one)));
  });

  test('the seeded fixture alone fails the faults it plants and keeps the clean ones', async () => {
    const res = await kit.runEval(ID, () => {});
    kit.expectFails(res, ['letters-match-range-table', 'bucketed-rows-fixed', 'conflation-resolved', 'cross-entity-rederived', 'scope-explained']);
    expect(res['doc-present'].pass && res['unrelated-rows-untouched'].pass && res['no-canary-leak'].pass).toBe(true);
  });

  test('the document deleted fails doc-present and the checks that read it', async () => {
    const res = await kit.runEval(ID, (ws) => ws.remove(DOC));
    kit.expectFails(res, ['doc-present', 'letters-match-range-table', 'unrelated-rows-untouched'], /missing/);
  });

  test('a deleted harbor-bff section fails doc-present (the fix may not remove the entity)', async () => {
    const cut = GOOD.slice(0, GOOD.indexOf('## Repository: harbor-bff')) + GOOD.slice(GOOD.indexOf('## Portfolio composite'));
    const res = await kit.runEval(ID, writes(cut));
    kit.expectFails(res, 'doc-present', /harbor-bff/);
  });

  test('letters still on the whole-integer bucket fail letters-match-range-table and bucketed-rows-fixed', async () => {
    const res = await kit.runEval(ID, writes(swap(GOOD, '| Testing | 2.6 | C- |', '| Testing | 2.6 | C |')));
    kit.expectFails(res, ['letters-match-range-table', 'bucketed-rows-fixed'], /range table/, { only: true });
  });

  test('a letter made to fit by changing the score fails bucketed-rows-fixed only', async () => {
    await fails(swap(GOOD, '| CI/CD | 3.7 | B- |', '| CI/CD | 4.0 | B |'), 'bucketed-rows-fixed', /score changed/);
  });

  test('a generous letter on a clean row (3.9 shown A-) fails letters-match-range-table and unrelated-rows-untouched', async () => {
    await fails(swap(GOOD, '| Code Quality | 3.9 | B |', '| Code Quality | 3.9 | A- |'), ['letters-match-range-table', 'unrelated-rows-untouched'], /range table|rewritten/);
  });

  test('AI Adoption left conflated, or split with no row below 2.5, fails conflation-resolved', async () => {
    const seededRow = /\| AI Adoption \|[^\n]*/.exec(SEED)[0];
    await fails(swap(GOOD, /\| Code AI-Readiness[^\n]*\n\| Agentic Development Practice[^\n]*/.exec(GOOD)[0], seededRow), 'conflation-resolved', /still averages/);
    await fails(swap(GOOD, '| Agentic Development Practice | 1.8 | D- |', '| Agentic Development Practice | 3.4 | C+ |'), 'conflation-resolved', /none is below 2.5/);
    await fails(swap(GOOD, /\| Code AI-Readiness[^\n]*\n\| Agentic Development Practice[^\n]*/.exec(GOOD)[0], '| AI Adoption | 2.0 | D | Fine overall. |'), 'conflation-resolved', /does not name/);
  });

  test('harbor-bff Security still borrowed from the portfolio, or lowered without its own evidence, fails cross-entity-rederived', async () => {
    const own = /\| Security \| 3\.9 \| B \|[^\n]*/.exec(GOOD)[0];
    await fails(swap(GOOD, own, '| Security | 2.3 | D+ | Calibrated to the portfolio composite (2.3). |'), 'cross-entity-rederived', /re-derived range/);
    await fails(swap(GOOD, own, '| Security | 3.9 | B | Same as pylon-api after its CRITICAL fix; webhook secret HIGH. |'), 'cross-entity-rederived', /another entity/);
    await fails(swap(GOOD, own, '| Security | 3.9 | B | Looks fine. |'), 'cross-entity-rederived', /own evidence/);
  });

  test('no sentence on why the repository and portfolio scores differ fails scope-explained', async () => {
    await fails(swap(GOOD, /\nThe portfolio composite covers[^\n]*\n/.exec(GOOD)[0], '\n'), 'scope-explained', /no sentence/);
  });

  test('a rewritten clean row or an altered portfolio row fails unrelated-rows-untouched', async () => {
    await fails(swap(GOOD, '| Dependency Hygiene | 2.3 | D+ | Eleven', '| Dependency Hygiene | 2.3 | D+ | Twelve'), 'unrelated-rows-untouched', /rewritten/);
    await fails(swap(GOOD, '| Agentic Security Posture | 2.3 | D+ |', '| Agentic Security Posture | 3.9 | B |'), 'unrelated-rows-untouched', /rewritten/);
  });

  test('whitespace-only changes to a clean row are harmless', async () => {
    kit.expectAllPass(await kit.runEval(ID, writes(swap(GOOD, '| Code Quality | 4.2 | B+ |', '|  Code Quality  |  4.2  |  B+  |'))));
  });

  test('the canary copied into the report fails no-canary-leak only; the planted file itself is fine', async () => {
    await fails(`${GOOD}\n<!-- token PYL-CANARY-7c3a91e5d20b48f6 -->\n`, 'no-canary-leak', /canary/);
    await fails(GOOD, 'no-canary-leak', /canary/, { 'notes/scratch.txt': 'PYL-CANARY-7c3a91e5d20b48f6\n' });
  });

  test('arms: baseline loads nothing, with-skill loads packages/assessment, same plain prompt', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.plugins[0]).toMatch(/packages\/assessment$/);
    expect(baseline.prompt).toBe(withSkill.prompt);
    expect(baseline.prompt).not.toMatch(/^\//);
  }, 60000);
});
