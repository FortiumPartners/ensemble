'use strict';

/** Kit test for the `assess-code-quality` eval: a good report passes every check; each bad report fails the check it targets. */

const kit = require('../skill-eval-kit');

jest.setTimeout(60000);

const ID = 'assess-code-quality';
const REPORT = 'docs/assessment/code-quality.md';

const GOOD = `# Code Quality Analysis

## Largest Files

| File | Lines | Methods | Concern |
|------|-------|---------|---------|
| src/billing.js | 303 | 9 | one 175-line function, buildStatement (src/billing.js:111) |
| src/customers.js | 40 | 3 | naming |
| src/reports.js | 30 | 3 | swallowed error |

## Technical Debt

| Type | Count | Severity | Example |
|------|-------|----------|---------|
| TODO | 3 | Medium | src/customers.js:5 |
| FIXME | 2 | High | src/billing.js:118 |
| HACK | 1 | High | src/billing.js:106 |

## Naming Violations

| Convention | Status | Example |
|------------|--------|---------|
| Classes PascalCase | ✗ | class customer_store, src/customers.js:8 |
| Functions camelCase | ✗ | Get_Customer, src/customers.js:24 |

## Duplication

| Pattern | Locations | Suggested Fix |
|---------|-----------|---------------|
| The same try/catch that logs 'operation failed:' and returns null | src/customers.js:18, src/reports.js:15, src/index.js:9 | one shared helper |

Three copies of an identical catch block.

## Error Handling

The catch in saveStatement is empty and swallows write errors silently (src/reports.js:26). The other catch blocks only log with console.log (src/customers.js:18).

## Complexity Concerns

buildStatement in src/billing.js:111 repeats the same loop for every item kind, three times.

## Before/After Examples

Before:

\`\`\`js
} catch {}
\`\`\`

After:

\`\`\`js
} catch (err) {
  throw new Error('cannot save statement: ' + err.message);
}
\`\`\`

## Key Findings

1. src/billing.js is 303 lines with a 175-line function (src/billing.js:111).
2. An empty catch swallows write errors (src/reports.js:26).
3. The same catch block is copied three times (src/customers.js:18).

## Score: 2.9 / C (small code base, but oversized file, duplication and silent failures)

## Recommendations

1. Split buildStatement into one pricing loop and move the tax table to configuration.
2. Replace the empty catch with a handled error and share the logging helper.
`;

/** A stub agent that saves \`text\` as the report (and optionally other files). */
const saves = (text, extra = {}) => (ws) => {
  if (text !== null) ws.write(REPORT, text);
  for (const [rel, body] of Object.entries(extra)) ws.write(rel, body);
};
const swap = (from, to) => { if (!GOOD.includes(from)) throw new Error(`test bug: ${from} not in GOOD`); return GOOD.replace(from, to); };

describe(`${ID}`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    expect(kit.loadsClean(ID).fixtureDir).toBeTruthy();
  });

  test('a good report passes every check', async () => {
    const res = await kit.runEval(ID, saves(GOOD));
    expect(Object.keys(res)).toEqual(['report-saved', 'sections-complete', 'score-format', 'largest-file', 'debt-counts', 'naming-violations', 'duplication-found',
      'swallowed-error', 'complexity-hotspot', 'before-after', 'citations-real', 'findings-recommendations', 'no-stray-writes']);
    kit.expectAllPass(res);
  });

  test('a run that writes nothing fails every report check and passes only no-stray-writes', async () => {
    const res = await kit.runEval(ID, saves(null));
    kit.expectFails(res, Object.keys(res).filter((k) => k !== 'no-stray-writes'), /was not written/, { only: true });
  });

  test('a bare-letter score, a mismatched letter and an out-of-range score fail score-format', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('## Score: 2.9 / C (', '## Score: C ('))), 'score-format', /not "<1\.0-5\.0> \/ <Letter>"/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('2.9 / C', '2.9 / B'))), 'score-format', /scale gives C for/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('2.9 / C', '5.5 / A'))), 'score-format', /outside 1\.0-5\.0/, { only: true });
  });

  test('no title, or a stub report, fails report-saved', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('# Code Quality Analysis', '# Notes'))), 'report-saved', /title/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves('# Code Quality Analysis\n\nMessy.\n')), 'report-saved', /only \d+ characters/);
  });

  test('sections out of order, or a skipped section, fail sections-complete', async () => {
    const recs = GOOD.slice(GOOD.indexOf('## Recommendations'));
    const moved = GOOD.slice(0, GOOD.indexOf('## Recommendations')).replace('## Largest Files', `${recs}\n## Largest Files`);
    kit.expectFails(await kit.runEval(ID, saves(moved)), 'sections-complete', /out of the prescribed order/, { only: true });
    const res = await kit.runEval(ID, saves(swap('## Duplication', '## Notes')));
    kit.expectFails(res, ['sections-complete', 'duplication-found'], /missing|no "Duplication/);
    kit.expectFails(res, 'sections-complete', /Duplication/);
  });

  test('a Largest Files table that leads with a small file, or gives a wrong size, fails largest-file', async () => {
    const swapped = swap('| src/billing.js | 303 | 9 | one 175-line function, buildStatement (src/billing.js:111) |\n| src/customers.js | 40 | 3 | naming |',
      '| src/customers.js | 40 | 3 | naming |\n| src/billing.js | 303 | 9 | one 175-line function, buildStatement (src/billing.js:111) |');
    kit.expectFails(await kit.runEval(ID, saves(swapped)), 'largest-file', /not src\/billing\.js/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('| src/billing.js | 303 |', '| src/billing.js | 120 |'))), 'largest-file', /the file has 303 lines/, { only: true });
  });

  test('wrong or missing debt counts fail debt-counts', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('| TODO | 3 |', '| TODO | 47 |'))), 'debt-counts', /TODO \(reported 47, the fixture has 3\)/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('| FIXME | 2 | High | src/billing.js:118 |\n', ''))), 'debt-counts', /FIXME \(no count/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('| HACK | 1 |', '| HACK | 4 |'))), 'debt-counts', /HACK \(reported 4/, { only: true });
  });

  test('debt counts given as bullets are accepted', async () => {
    const bullets = swap('| TODO | 3 | Medium | src/customers.js:5 |\n| FIXME | 2 | High | src/billing.js:118 |\n| HACK | 1 | High | src/billing.js:106 |',
      '- TODO: 3 markers (src/customers.js:5)\n- FIXME: 2 markers (src/billing.js:118)');
    kit.expectAllPass(await kit.runEval(ID, saves(bullets)));
  });

  test('naming violations that miss the planted identifiers, or cite the wrong line, fail naming-violations', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('src/customers.js:8', 'src/customers.js:3').replace('src/customers.js:24', 'src/customers.js:36'))), 'naming-violations', /neither customer_store/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('class customer_store, ', 'a class, ').replace('Get_Customer, ', 'a function, '))), 'naming-violations', /neither customer_store/, { only: true });
  });

  test('a Duplication section that cites fewer than two copies, or describes nothing, fails duplication-found', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('src/customers.js:18, src/reports.js:15, src/index.js:9', 'src/customers.js:18'))), 'duplication-found', /cites 1 of the 3/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('src/customers.js:18, src/reports.js:15, src/index.js:9', 'src/billing.js:20, src/billing.js:30'))), 'duplication-found', /cites 0 of the 3/, { only: true });
    const bare = swap('| The same try/catch that logs \'operation failed:\' and returns null |', '| Pattern A |').replace('Three copies of an identical catch block.', 'See above.').replace('one shared helper', 'extract');
    kit.expectFails(await kit.runEval(ID, saves(bare)), 'duplication-found', /does not describe/, { only: true });
  });

  test('an Error Handling section that misses the empty catch, or cites it without calling it out, fails swallowed-error', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('(src/reports.js:26)', '(src/reports.js:15)'))), 'swallowed-error', /does not cite the empty catch at src\/reports\.js:26/, { only: true });
    const quiet = swap('The catch in saveStatement is empty and swallows write errors silently (src/reports.js:26).', 'The saveStatement function writes a file (src/reports.js:26).').replace('The other catch blocks only log with console.log', 'Other blocks log');
    kit.expectFails(await kit.runEval(ID, saves(quiet)), 'swallowed-error', /not described/, { only: true });
  });

  test('a Complexity Concerns section that misses the oversized function fails complexity-hotspot', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('buildStatement in src/billing.js:111 repeats', 'The code repeats'))), 'complexity-hotspot', /buildStatement/, { only: true });
  });

  test('Before/After Examples with no code, or with no after, fail before-after', async () => {
    const noCode = swap('```js\n} catch {}\n```', 'Use a handled catch.').replace(/```js\n\} catch \(err\)[\s\S]*?```/, 'Throw a real error.');
    kit.expectFails(await kit.runEval(ID, saves(noCode)), 'before-after', /no code block|label/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('After:', 'Result:'))), 'before-after', /does not label a before and an after/, { only: true });
  });

  test('a citation of an invented file, or of a line past the end, fails citations-real', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('| src/reports.js | 30 |', '| src/metrics.js:2 | 30 |'))), 'citations-real', /not in the repository/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('src/customers.js:5 |', 'src/customers.js:500 |'))), 'citations-real', /has \d+ lines/, { only: true });
  });

  test('citations of a single file only fail citations-real', async () => {
    const one = GOOD.replace(/src\/(?:customers|reports|index)\.js:(\d+)/g, (m, n) => `src/billing.js:${Number(n) % 100 + 1}`);
    kit.expectFails(await kit.runEval(ID, saves(one)), 'citations-real', /only 1 distinct/);
  });

  test('a report with no file:line citations fails citations-real and the cited checks', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace(/(\.js):\d+(?:-\d+)?/g, '$1')));
    kit.expectFails(res, ['citations-real', 'findings-recommendations', 'naming-violations', 'duplication-found', 'swallowed-error'], undefined, { only: true });
    kit.expectFails(res, 'citations-real', /only 0 file:line/);
  });

  test('too few findings, none citing a file, or too few recommendations fail findings-recommendations', async () => {
    const few = swap('2. An empty catch swallows write errors (src/reports.js:26).\n3. The same catch block is copied three times (src/customers.js:18).\n', '');
    kit.expectFails(await kit.runEval(ID, saves(few)), 'findings-recommendations', /1 numbered/, { only: true });
    const uncited = swap('1. src/billing.js is 303 lines with a 175-line function (src/billing.js:111).\n2. An empty catch swallows write errors (src/reports.js:26).\n3. The same catch block is copied three times (src/customers.js:18).',
      '1. The billing file is long.\n2. An empty catch swallows errors.\n3. The catch block is copied.');
    kit.expectFails(await kit.runEval(ID, saves(uncited)), 'findings-recommendations', /only 0 Key Finding/);
    kit.expectFails(await kit.runEval(ID, saves(swap('2. Replace the empty catch with a handled error and share the logging helper.\n', ''))), 'findings-recommendations', /Recommendations has 1/, { only: true });
  });

  test('a stray file, a modified fixture file and a removed fixture file fail no-stray-writes', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD, { 'src/fix.js': 'x\n' })), 'no-stray-writes', /src\/fix\.js/, { only: true });
    const edited = await kit.runEval(ID, (ws) => { ws.write(REPORT, GOOD); ws.write('src/reports.js', `${ws.read('src/reports.js')}// fixed\n`); });
    kit.expectFails(edited, 'no-stray-writes', /modified/, { only: true });
    const gone = await kit.runEval(ID, (ws) => { ws.write(REPORT, GOOD); ws.remove('tests/billing-check.js'); });
    kit.expectFails(gone, 'no-stray-writes', /removed/, { only: true });
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
