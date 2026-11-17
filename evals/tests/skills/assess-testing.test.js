'use strict';

/** Kit test for the `assess-testing` eval: a good report passes every check; each bad report fails the check it targets. */

const kit = require('../skill-eval-kit');

const ID = 'assess-testing';
const REPORT = 'docs/assessment/testing.md';

jest.setTimeout(60000); // each runEval builds a sandbox and spawns the check script 14 times

const GOOD = `# Testing Analysis

## Test Projects

| Project | Framework | Type | Coverage | Quality |
|---------|-----------|------|----------|---------|
| ledgerly (test/) | Jest 29 | Unit | ~35% (estimated) | Mixed: one test without assertions, one skipped |

Two test files, test/tax-check.js and test/invoice-check.js, selected by testMatch in package.json:9.

## Coverage Summary

- **Overall:** ~35% (estimated from which modules have tests; no coverage report exists)
- **Business Logic:** ~70%
- **API Layer:** ~0%
- **Data Access:** ~0%

package.json:12 sets a coverageThreshold of 80% lines, but nothing runs coverage, so it is never enforced.

## Test Quality

Strengths: test/tax-check.js has clear names and exact assertions (test/tax-check.js:6-13).

Weaknesses:
- The 'formats a total' test calls formatTotal and has no assertion, so it can never fail (test/invoice-check.js:22-24).
- A test is skipped with it.skip: the empty-invoice rejection is not running (test/invoice-check.js:26-28).
- Tests share one mutable invoice created in beforeAll and one of them mutates it, so order matters (test/invoice-check.js:8-19).

## Test Strategy

Unit tests only: there are no integration tests and no end-to-end tests, and no mocks are used. The suite is organised by module under test/.

## Coverage Gaps

| Module | Coverage | Gap Type |
|--------|----------|----------|
| src/payments.js | 0% | Missing unit tests (charges and refunds money) |
| src/auth.js | 0% | Missing unit tests (token signing and verification) |
| src/db.js | 0% | No tests |
| src/server.js | 0% | No tests, no integration tests |
| src/invoice.js | partial | Skipped test and a test without assertions |

## Key Findings

1. Payments and token authentication have no tests at all (src/payments.js:5, src/auth.js:8).
2. The CI test step has continue-on-error: true, so failing tests never fail the build (.github/workflows/ci.yml:19).
3. Two tests in test/invoice-check.js give false confidence: one has no assertion and one is skipped (test/invoice-check.js:22-26).

## Score: 2.6 / C- (the tested modules are well tested, but the money and auth code is untested and CI ignores failures)

## Recommendations

1. Add tests for src/payments.js and src/auth.js first, then make the CI test step blocking by removing continue-on-error (.github/workflows/ci.yml:19).
2. Fix the assertion-free test, re-enable the skipped test, and run \`jest --coverage\` in CI so the 80% threshold is enforced.
`;

/** A stub agent that saves \`text\` as the report (and optionally other files). */
const saves = (text, extra = {}) => (ws) => {
  if (text !== null) ws.write(REPORT, text);
  for (const [rel, body] of Object.entries(extra)) ws.write(rel, body);
};
const swap = (from, to) => { if (!GOOD.includes(from)) throw new Error(`test bug: ${from} not in GOOD`); return GOOD.replace(from, to); };

describe(`${ID} (kit)`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.fixtureDir).toBeTruthy();
    expect(ev.runtimes).toEqual(['claude']);
  });

  test('the fixture really holds the planted facts the checks read', async () => {
    let seen;
    await kit.runEval(ID, (ws) => {
      const inv = ws.read('test/invoice-check.js').split('\n');
      const ci = ws.read('.github/workflows/ci.yml').split('\n');
      seen = {
        noAssert: inv[21], assertBody: inv[22], skip: inv[25], coa: ci[18],
        tested: ['test/tax-check.js', 'test/invoice-check.js'].every((f) => ws.exists(f)),
        untestedHaveTests: ['payments', 'auth', 'db', 'server'].some((m) => ws.exists(`test/${m}-check.js`) || ws.exists(`test/${m}.test.js`)),
        integration: ws.exists('test/integration') || ws.exists('test/e2e'),
        threshold: /coverageThreshold/.test(ws.read('package.json')),
        coverageInCi: /--coverage/.test(ws.read('.github/workflows/ci.yml')),
      };
    });
    expect(seen.noAssert).toMatch(/it\('formats a total'/);
    expect(seen.assertBody).not.toMatch(/expect/);
    expect(seen.skip).toMatch(/it\.skip\(/);
    expect(seen.coa).toMatch(/continue-on-error: true/);
    expect(seen).toMatchObject({ tested: true, untestedHaveTests: false, integration: false, threshold: true, coverageInCi: false });
  });

  test('a good report passes every check', async () => {
    const res = await kit.runEval(ID, saves(GOOD));
    expect(Object.keys(res)).toEqual(['report-saved', 'sections-complete', 'score-format', 'projects-table', 'coverage-summary', 'gaps-found', 'no-false-gaps', 'quality-no-assertion', 'quality-skipped', 'strategy-gaps', 'ci-nonblocking', 'citations-real', 'findings-recommendations', 'no-stray-writes']);
    kit.expectAllPass(res);
  });

  test('a run that writes nothing fails every report check, but not no-stray-writes', async () => {
    const res = await kit.runEval(ID, saves(null));
    const reportChecks = Object.keys(res).filter((k) => k !== 'no-stray-writes');
    kit.expectFails(res, reportChecks, /was not written/, { only: false });
    expect(res['no-stray-writes'].pass).toBe(true);
  });

  test('a stub of a report (too short) fails report-saved', async () => {
    kit.expectFails(await kit.runEval(ID, saves('# Testing Analysis\n\n## Score: 2.6 / C-\n')), 'report-saved', /only \d+ characters/);
  });

  test('a report with the wrong title fails report-saved only', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('# Testing Analysis', '# Notes'))), 'report-saved', /title/, { only: true });
  });

  test('a missing section fails sections-complete; an out-of-order one too', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('## Test Strategy', '## Approach'))), ['sections-complete', 'strategy-gaps'], /Test Strategy/);
    const reordered = GOOD.replace(/## Recommendations[\s\S]*$/, '').replace('## Test Quality', '## Recommendations\n\n1. a\n2. b\n\n## Test Quality');
    kit.expectFails(await kit.runEval(ID, saves(reordered)), 'sections-complete', /order|missing/);
  });

  test('a bare-letter score, a wrong letter and an out-of-range score fail score-format', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('## Score: 2.6 / C- (', '## Score: C- ('))), 'score-format', /not "<1\.0-5\.0> \/ <Letter>"/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('2.6 / C-', '2.6 / B'))), 'score-format', /scale gives C-/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('2.6 / C-', '7 / A'))), 'score-format', /outside 1\.0-5\.0/, { only: true });
  });

  test('a Test Projects table with another framework, no Jest or no Framework column fails projects-table', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('| Jest 29 |', '| Mocha |'))), 'projects-table', /names Jest/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('| Jest 29 |', '| node:test |'))), 'projects-table', /names Jest/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('| ledgerly (test/) | Jest 29 | Unit | ~35% (estimated) | Mixed: one test without assertions, one skipped |\n', ''))), 'projects-table', /no row/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('| Jest 29 |', '| Jest 29 + Cypress |'))), 'projects-table', /Cypress/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('| Project | Framework |', '| Project | Tool |'))), 'projects-table', /Framework column/, { only: true });
  });

  test('coverage figures that are implausible, missing or not marked as estimates fail coverage-summary', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('- **Data Access:** ~0%', '- **Data Access:** ~85%'))), 'coverage-summary', /Data Access is given 85%/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('- **API Layer:** ~0%', '- **API Layer:** ~90%'))), 'coverage-summary', /API Layer is given 90%/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('- **Overall:** ~35%', '- **Overall:** ~88%'))), 'coverage-summary', /Overall is given 88%/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('- **Business Logic:** ~70%\n', ''))), 'coverage-summary', /no Business Logic line/, { only: true });
    const measured = GOOD.replace(/## Coverage Summary[\s\S]*?## Test Quality/, '## Coverage Summary\n\n- **Overall:** 35%\n- **Business Logic:** 70%\n- **API Layer:** 0%\n- **Data Access:** 0%\n\n## Test Quality');
    kit.expectFails(await kit.runEval(ID, saves(measured)), 'coverage-summary', /estimates/, { only: true });
  });

  test('a percentage above 100, or a bullet without a figure, fails coverage-summary', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('- **Business Logic:** ~70%', '- **Business Logic:** ~170%'))), 'coverage-summary', /above 100/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('- **Business Logic:** ~70%', '- **Business Logic:** good'))), 'coverage-summary', /gives no percentage/, { only: true });
  });

  test('a Coverage Gaps section that misses payments or auth fails gaps-found', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('| src/payments.js | 0% | Missing unit tests (charges and refunds money) |\n', ''))), 'gaps-found', /payments/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('| src/auth.js | 0% | Missing unit tests (token signing and verification) |\n', ''))), 'gaps-found', /auth/, { only: true });
  });

  test('a Coverage Gaps section that lists a tested module as untested fails no-false-gaps', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('| src/invoice.js | partial | Skipped test and a test without assertions |', '| src/invoice.js | 0% | Missing unit tests |'))), 'no-false-gaps', /invoice\.js is untested|invoice/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('| src/db.js | 0% | No tests |', '| src/tax.js | 0% | No tests |'))), 'no-false-gaps', /tax/, { only: true });
  });

  test('a report that misses the assertion-free test, or cites it without saying so, fails quality-no-assertion', async () => {
    const gone = swap("- The 'formats a total' test calls formatTotal and has no assertion, so it can never fail (test/invoice-check.js:22-24).\n", '').replace('one has no assertion and one is skipped (test/invoice-check.js:22-26)', 'one is skipped (test/invoice-check.js:26)');
    kit.expectFails(await kit.runEval(ID, saves(gone)), 'quality-no-assertion', /no finding cites/, { only: true });
    const vague = swap("- The 'formats a total' test calls formatTotal and has no assertion, so it can never fail (test/invoice-check.js:22-24).", "- The 'formats a total' test is short (test/invoice-check.js:22-24).").replace('one has no assertion and one is skipped', 'one is skipped');
    kit.expectFails(await kit.runEval(ID, saves(vague)), 'quality-no-assertion', /does not say/, { only: true });
  });

  test('a report that never mentions the skipped test fails quality-skipped', async () => {
    const gone = swap('- A test is skipped with it.skip: the empty-invoice rejection is not running (test/invoice-check.js:26-28).\n', '').replace('one has no assertion and one is skipped (test/invoice-check.js:22-26)', 'one has no assertion (test/invoice-check.js:22-24)').replace('re-enable the skipped test', 'review the tests').replace(', one skipped', '').replace('Skipped test and a test without assertions', 'A test without assertions');
    kit.expectFails(await kit.runEval(ID, saves(gone)), 'quality-skipped', /no finding reports the skipped test/, { only: true });
  });

  test('a report that cites the skipped test without saying it is skipped fails quality-skipped', async () => {
    const vague = swap('- A test is skipped with it.skip: the empty-invoice rejection is not running (test/invoice-check.js:26-28).', '- The empty-invoice test is short (test/invoice-check.js:26-28).').replace('re-enable the skipped test', 'review the tests').replace(', one skipped', '').replace('Skipped test and a test without assertions', 'A test without assertions').replace('one has no assertion and one is skipped (test/invoice-check.js:22-26)', 'one has no assertion (test/invoice-check.js:22-26)');
    kit.expectFails(await kit.runEval(ID, saves(vague)), 'quality-skipped', /does not say/, { only: true });
  });

  test('a Test Strategy that does not say integration and end-to-end tests are missing fails strategy-gaps', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('Unit tests only: there are no integration tests and no end-to-end tests, and no mocks are used.', 'Unit tests cover the modules well.'))), 'strategy-gaps', /integration and end-to-end/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('Unit tests only: there are no integration tests and no end-to-end tests, and no mocks are used.', 'The suite is organised in layers.'))), 'strategy-gaps', /unit tests/, { only: true });
  });

  test('a report that does not notice the non-blocking CI test step fails ci-nonblocking', async () => {
    const gone = GOOD.replace('2. The CI test step has continue-on-error: true, so failing tests never fail the build (.github/workflows/ci.yml:19).', '2. CI runs the tests on every push.')
      .replace(', then make the CI test step blocking by removing continue-on-error (.github/workflows/ci.yml:19)', '');
    kit.expectFails(await kit.runEval(ID, saves(gone)), 'ci-nonblocking', /no finding cites the CI test step/, { only: true });
    const vague = swap('2. The CI test step has continue-on-error: true, so failing tests never fail the build (.github/workflows/ci.yml:19).', '2. The CI test step sets continue-on-error: true (.github/workflows/ci.yml:19).')
      .replace(', then make the CI test step blocking by removing continue-on-error (.github/workflows/ci.yml:19)', '');
    kit.expectFails(await kit.runEval(ID, saves(vague)), 'ci-nonblocking', /not described/, { only: true });
  });

  test('citations that all point at one file fail citations-real', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace(/(?:test\/tax-check\.js|\.github\/workflows\/ci\.yml|src\/payments\.js|src\/auth\.js|package\.json):\d+(?:-\d+)?/g, 'test/invoice-check.js:22')));
    kit.expectFails(res, 'citations-real', /only 1 distinct file/);
  });

  test('a citation of an invented file, or of a line past the end, fails citations-real', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('(src/payments.js:5, src/auth.js:8)', '(src/payments.js:5, src/billing.js:8)'))), 'citations-real', /not in the repository/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('(src/payments.js:5, src/auth.js:8)', '(src/payments.js:500, src/auth.js:8)'))), 'citations-real', /has \d+ lines/, { only: true });
  });

  test('a report with no file:line citations fails citations-real, findings-recommendations and the cited-finding checks', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace(/(\.(?:yml|js|json)):\d+(?:-\d+)?/g, '$1')));
    kit.expectFails(res, ['citations-real', 'findings-recommendations'], undefined, { only: false });
    kit.expectFails(res, 'citations-real', /only 0 file:line/);
  });

  test('too few Key Findings or Recommendations fails findings-recommendations', async () => {
    const few = GOOD.replace(/2\. The CI test step[^\n]*\n3\. Two tests[^\n]*\n/, '');
    kit.expectFails(await kit.runEval(ID, saves(few)), 'findings-recommendations', /1 numbered/);
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace(/\n2\. Fix the assertion-free test[^\n]*\n/, '\n'))), 'findings-recommendations', /Recommendations has 1/, { only: true });
  });

  test('an unfilled template placeholder is not counted as an item', async () => {
    const tpl = GOOD.replace(/## Recommendations[\s\S]*$/, '## Recommendations\n\n1. [Priority recommendation]\n2. [Secondary recommendation]\n');
    kit.expectFails(await kit.runEval(ID, saves(tpl)), 'findings-recommendations', /Recommendations has 0/);
  });

  test('a stray test file, a modified fixture file and a removed one fail no-stray-writes', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD, { 'test/payments-check.js': 'x\n' })), 'no-stray-writes', /test\/payments-check\.js/, { only: true });
    const edited = await kit.runEval(ID, (ws) => { ws.write(REPORT, GOOD); ws.write('test/invoice-check.js', ws.read('test/invoice-check.js').replace('it.skip(', 'it(')); });
    kit.expectFails(edited, 'no-stray-writes', /modified/, { only: true });
    const removed = await kit.runEval(ID, (ws) => { ws.write(REPORT, GOOD); ws.remove('src/db.js'); });
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
  }, 60000);
});
