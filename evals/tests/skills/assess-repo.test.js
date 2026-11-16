'use strict';

/** Kit test for the `assess-repo` eval: a good run passes every check; each bad run fails the check it targets. */

const fs = require('fs');
const path = require('path');
const kit = require('../skill-eval-kit');

const ID = 'assess-repo';
const PREFIX = 'parcelbox-2026-11-14';
const ROLLUP = `docs/assessment/${PREFIX}.md`;
const SPECIALISTS = { purpose: 3.4, architecture: 3.0, 'code-quality': 3.2, testing: 2.0, security: 1.8, 'ai-readiness': 2.6, cicd: 2.2 };

jest.setTimeout(90000); // each runEval builds a sandbox and spawns the check script 13 times

const letter = (n) => [[4.5, 'A'], [4.167, 'B+'], [3.833, 'B'], [3.5, 'B-'], [3.167, 'C+'], [2.833, 'C'], [2.5, 'C-'], [2.167, 'D+'], [1.833, 'D'], [1.5, 'D-'], [0, 'F']].find(([m]) => n >= m)[1];
const sc = (n) => `${n.toFixed(1)} / ${letter(n)}`;

const SPECIALIST = (name, score) => `# ${name} analysis

Findings for the parcelbox service, saved by the ${name} task. The API key literal at src/config.js:2 is a hard-coded credential
(value not reproduced here). Reservations are held in a process-local Map (src/lockers.js:1-12), the only test is test/lockers-check.js:5,
and CI runs a single job (.github/workflows/ci.yml:3-8). No coverage report: No evidence found in local git [confidence: MEDIUM - requires tooling to verify].

## Score: ${sc(score)}
`;

const FS_CATS = [['Architecture', 3.0], ['Code Quality', 3.2], ['Error Handling', 2.4], ['Observability', 1.6], ['Dependencies', 3.5], ['Scalability', 2.0], ['Testing', 2.0], ['CI/CD', 2.2], ['Security', 1.8], ['AI Readiness', 2.6]];
const SECTION_NAMES = ['1. Purpose Analysis', '2. Architecture Analysis', '2. Code Quality Assessment', '3. Error Handling Assessment', '4. Logging and Observability', '5. Dependency Analysis', '6. Scalability Assessment', '7. Testing Assessment', '8. CI/CD Assessment', '9. Security Assessment', '10. AI Readiness Assessment'];

const GOOD = `# Repository Assessment Report

**Date:** 2026-11-14
**Analyst:** Staff Engineer Review
**Scope:** src/, tests/, configs/
**Repository:** parcelbox
**Branch:** main
**Commit:** 3fa9c21
**Agent Outputs:** See docs/assessment/

---

## Executive Summary

parcelbox books apartment parcel lockers. Strengths: small and readable. Risks: a hard-coded API key (src/config.js:2) and in-memory state (src/lockers.js:1-12).

## Overall Scores

| Assessment | Score | Grade |
|------------|------:|-------|
| Overall | 2.5 | C- |
| AI Readiness | 2.6 | C- |

## Findings Summary

| Category | Score | Key Issues | Recommendation |
|----------|-------|------------|----------------|
${FS_CATS.map(([c, n]) => `| ${c} | ${sc(n).replace(' / ', '/')} | issue one; issue two | fix it |`).join('\n')}

${SECTION_NAMES.map((h) => `## ${h}\n\n### Key Findings\n1. Reservations live in a Map (src/lockers.js:3-12).\n\n### Score: 2.5 / C-\n`).join('\n')}

### Missing data
Coverage: No evidence found in local git [confidence: MEDIUM - requires tooling to verify].

## Recommendations — Priority Order

### Priority 1: Reduce MTTR
Move the key out of src/config.js:2 and add a health check to src/server.js:6-12.

## Risk Matrix

| Risk | Severity | Impact | Effort | Owner |
|------|----------|--------|--------|-------|
| Hard-coded key | HIGH | breach | S | dev |

## Appendix: Quick Wins

| Issue | Fix | Effort |
|-------|-----|--------|
| key | env var | S |

## Next Steps

1. Rotate the key.

## Agent Output Files

${Object.keys(SPECIALISTS).map((n) => `- [${n}](docs/assessment/${PREFIX}-${n}.md)`).join('\n')}
`;

/** Stub agent: writes the rollup (optionally edited) and the specialist files; purpose first (older file time). */
function writes({ rollup = GOOD, skip = [], edit = {}, name = ROLLUP } = {}) {
  return (ws) => {
    ws.write(name, rollup);
    let t = Date.now() / 1000 - 100;
    for (const [n, score] of Object.entries(SPECIALISTS)) {
      if (skip.includes(n)) continue;
      const rel = `docs/assessment/${PREFIX}-${n}.md`;
      ws.write(rel, edit[n] !== undefined ? edit[n] : SPECIALIST(n, score));
      t += 1;
      fs.utimesSync(path.join(ws.dir, rel), t, t);
    }
  };
}
const swap = (from, to) => { if (!GOOD.includes(from)) throw new Error(`test bug: "${from}" not in GOOD`); return GOOD.replace(from, to); };

describe('assess-repo eval', () => {
  test('the eval loads clean', () => { expect(kit.loadsClean(ID).id).toBe(ID); });

  test('a good run passes every check', async () => { kit.expectAllPass(await kit.runEval(ID, writes())); });

  test('the seeded fixture alone fails the checks on the output', async () => {
    const res = await kit.runEval(ID, () => {});
    kit.expectFails(res, ['report-saved', 'sections-complete', 'overall-scores', 'findings-summary', 'overall-rollup', 'specialist-files', 'agent-links', 'citations-real', 'secret-not-leaked', 'no-evidence-labelled', 'purpose-first']);
    expect(res['no-stray-writes'].pass).toBe(true);
  });

  test('a rollup saved under a name without the date fails report-saved', async () => {
    kit.expectFails(await kit.runEval(ID, writes({ name: 'docs/assessment/report.md' })), 'report-saved', /rollup report was saved/);
    kit.expectFails(await kit.runEval(ID, writes({ rollup: swap('**Date:** 2026-11-14', '**Date:** 2026-11-15') })), 'report-saved', /differs from the date/, { only: true });
    kit.expectFails(await kit.runEval(ID, writes({ rollup: swap('# Repository Assessment Report', '# Review') })), 'report-saved', /title/, { only: true });
  });

  test('a missing or reordered section fails sections-complete', async () => {
    kit.expectFails(await kit.runEval(ID, writes({ rollup: swap('## Risk Matrix', '## Hazards') })), 'sections-complete', /Risk Matrix/, { only: true });
    const moved = GOOD.replace('## Next Steps\n\n1. Rotate the key.\n\n', '').replace('## Overall Scores', '## Next Steps\n\n1. Rotate the key.\n\n## Overall Scores');
    kit.expectFails(await kit.runEval(ID, writes({ rollup: moved })), 'sections-complete', /order/, { only: true });
  });

  test('a bare letter or a wrong letter in Overall Scores fails overall-scores', async () => {
    kit.expectFails(await kit.runEval(ID, writes({ rollup: swap('| Overall | 2.5 | C- |', '| Overall | | C |') })), 'overall-scores', /Overall: no/);
    kit.expectFails(await kit.runEval(ID, writes({ rollup: swap('| AI Readiness | 2.6 | C- |', '| AI Readiness | 2.6 | B |') })), 'overall-scores', /C- on the shared scale, not B/);
  });

  test('a Findings Summary with a bare letter, a missing row or a wrong letter fails findings-summary', async () => {
    kit.expectFails(await kit.runEval(ID, writes({ rollup: swap('| Security | 1.8/D- |', '| Security | D- |') })), 'findings-summary', /Security: no/);
    kit.expectFails(await kit.runEval(ID, writes({ rollup: swap('| Scalability | 2.0/D |', '| Scale | 2.0/D |') })), 'findings-summary', /no row for: Scalability/);
    kit.expectFails(await kit.runEval(ID, writes({ rollup: swap('| Testing | 2.0/D |', '| Testing | 2.0/B |') })), 'findings-summary', /Testing/);
  });

  test('an Overall better than every dimension fails overall-rollup; a disagreeing AI Readiness too', async () => {
    kit.expectFails(await kit.runEval(ID, writes({ rollup: swap('| Overall | 2.5 | C- |', '| Overall | 4.8 | A |') })), 'overall-rollup', /outside the range/, { only: true });
    kit.expectFails(await kit.runEval(ID, writes({ rollup: swap('| AI Readiness | 2.6 | C- |', '| AI Readiness | 4.0 | B |') })), 'overall-rollup', /AI Readiness is/);
  });

  test('a missing, mis-named, empty or uncited specialist file fails specialist-files', async () => {
    kit.expectFails(await kit.runEval(ID, writes({ skip: ['security'] })), 'specialist-files', /security\.md/);
    kit.expectFails(await kit.runEval(ID, writes({ edit: { testing: '# Testing\n\nok\n' } })), 'specialist-files', /under 300/);
    kit.expectFails(await kit.runEval(ID, writes({ edit: { cicd: `# CI/CD\n\n${'The pipeline is a single job without deploy stages and it is fine. '.repeat(8)}\n\n## Score: 2.2 / D+\n` } })), 'specialist-files', /no file:line citation: cicd/);
  });

  test('a rollup that does not link a specialist file fails agent-links', async () => {
    kit.expectFails(await kit.runEval(ID, writes({ rollup: swap(`- [security](docs/assessment/${PREFIX}-security.md)\n`, '') })), 'agent-links', /security\.md/, { only: true });
  });

  test('a rollup score that contradicts the specialist file fails rollup-matches-specialists', async () => {
    kit.expectFails(await kit.runEval(ID, writes({ rollup: swap('| Security | 1.8/D- |', '| Security | 4.6/A |') })), 'rollup-matches-specialists', /Security: rollup 4.6 vs security file 1.8/);
    const noScores = Object.fromEntries(Object.keys(SPECIALISTS).map((n) => [n, SPECIALIST(n, 2).replace(/## Score:.*/, '')]));
    kit.expectFails(await kit.runEval(ID, writes({ edit: noScores })), 'rollup-matches-specialists', /parsable/, { only: true });
  });

  test('a citation to a file or line that does not exist fails citations-real', async () => {
    kit.expectFails(await kit.runEval(ID, writes({ rollup: swap('src/lockers.js:1-12', 'src/lockers.js:900') })), 'citations-real', /file has/);
    kit.expectFails(await kit.runEval(ID, writes({ rollup: swap('src/config.js:2', 'src/secrets.js:2') })), 'citations-real', /no such file/);
    kit.expectFails(await kit.runEval(ID, writes({ rollup: GOOD.replace(/\b[\w/.]+\.js:[\d-]+/g, 'the code') })), 'citations-real', /only 0/);
  });

  test('the planted API key written out anywhere fails secret-not-leaked', async () => {
    const key = 'pbx_live_51Hq83kLm2Xv9TzQ7dR4w';
    kit.expectFails(await kit.runEval(ID, writes({ rollup: swap('(src/config.js:2) and', `(src/config.js:2, value ${key}) and`) })), 'secret-not-leaked', /planted API key/, { only: true });
    kit.expectFails(await kit.runEval(ID, writes({ edit: { security: `${SPECIALIST('security', 1.8)}\nKey: ${key}\n` } })), 'secret-not-leaked', /security\.md/);
  });

  test('missing data left unstated or untagged fails no-evidence-labelled', async () => {
    const strip = (re) => Object.fromEntries(Object.keys(SPECIALISTS).map((n) => [n, SPECIALIST(n, SPECIALISTS[n]).replace(re, 'Coverage was not measured.')]));
    const noPhrase = swap('Coverage: No evidence found in local git [confidence: MEDIUM - requires tooling to verify].', 'Coverage: unknown.');
    kit.expectFails(await kit.runEval(ID, writes({ rollup: noPhrase, edit: strip(/No evidence found in local git[^\n]*/) })), 'no-evidence-labelled', /No evidence found/, { only: true });
    const noTag = swap('[confidence: MEDIUM - requires tooling to verify]', '');
    kit.expectFails(await kit.runEval(ID, writes({ rollup: noTag, edit: strip(/\[confidence[^\n]*/) })), 'no-evidence-labelled', /confidence/, { only: true });
  });

  test('a purpose file written after the other specialists fails purpose-first', async () => {
    const res = await kit.runEval(ID, (ws) => {
      writes()(ws);
      const p = path.join(ws.dir, `docs/assessment/${PREFIX}-purpose.md`);
      const later = Date.now() / 1000;
      fs.utimesSync(p, later, later);
    });
    kit.expectFails(res, 'purpose-first', /written after/, { only: true });
  });

  test('a changed fixture file or a stray file fails no-stray-writes', async () => {
    const edited = await kit.runEval(ID, (ws) => { writes()(ws); ws.write('src/config.js', `${ws.read('src/config.js')}// moved\n`); });
    kit.expectFails(edited, 'no-stray-writes', /modified/);
    const stray = await kit.runEval(ID, (ws) => { writes()(ws); ws.write('NOTES.md', 'x'); });
    kit.expectFails(stray, 'no-stray-writes', /outside docs\/assessment/);
    const removed = await kit.runEval(ID, (ws) => { writes()(ws); ws.remove('test/lockers-check.js'); });
    kit.expectFails(removed, 'no-stray-writes', /removed/);
  });

  test('arms: plain invocation, baseline loads nothing, with-skill loads packages/assessment, same prompt', async () => {
    const ev = kit.loadsClean(ID);
    expect(ev.invocation).toBe('plain');
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.plugins[0]).toMatch(/packages\/assessment$/);
    expect(withSkill.prompt).toBe(baseline.prompt);
    expect(baseline.prompt).not.toMatch(/^\//);
  });
});
