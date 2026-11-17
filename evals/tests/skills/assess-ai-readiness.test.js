'use strict';

/**
 * Proof for the `assess-ai-readiness` eval (kit: evals/tests/skill-eval-kit.js). A good report passes every check; each check has a
 * plausible wrong report that fails it. No model is called: the "agent" is a function that writes the report a run would leave.
 */

const kit = require('../skill-eval-kit');

const ID = 'assess-ai-readiness';
const REPORT = 'docs/assessment/ai-readiness.md';
const CHECK_IDS = [
  'report-saved', 'dimensions-complete', 'score-format', 'dimension-evidence', 'sections-present', 'overall-score',
  'facts-match-repo', 'scores-fit-repo', 'evidence-grounded', 'gaps-named', 'list-counts', 'read-only',
];

const GOOD = `# AI Readiness Analysis

## 8-Dimension Assessment
| Dimension | Score | Evidence |
|-----------|-------|----------|
| Context Efficiency | 3.2/C+ | README.md and docs/architecture.md explain the two modules; no AGENTS.md or typed interfaces |
| Refactorability | 3.8/B- | Two small modules, src/index.js and src/store.js, with one narrow exported API |
| Testability | 3.0/C | test/store-test.js runs with \`npm test\` (node --test) but covers only the store |
| Determinism | 2.4/D+ | package.json uses caret ranges and there is no lock file and no CI configuration |
| Observability | 1.8/D- | Only console.log in src/index.js; no logger, levels or tracing |
| Error Recovery | 2.8/C- | src/store.js wraps read failures in an Error with context but has no retry or fallback |
| Incremental Changes | 3.4/C+ | Small surface and a fast test, but no lint config or type checks on a single edit |
| Skill Coverage | 2.6/C- | package.json scripts for test, lint and start; no build or deploy script |

## Documentation
README exists with usage; docs/architecture.md describes the layout.

| Aspect | Status | Notes |
|--------|--------|-------|
| Documentation | ✓ | README.md and docs/architecture.md |
| Type Definitions | ✗ | plain JavaScript, no JSDoc or .d.ts |
| Examples/Tutorials | ✓ | usage block in the README |

Documents found:
- README.md: ✓
- docs/: ✓
- SKILL.md: ✗
- AGENTS.md: ✗

## Skill Coverage
| Operation | Available | Implementation |
|-----------|-----------|----------------|
| Build | ✓ | no compile step; \`npm start\` runs src/index.js |
| Test | ✓ | \`npm test\` runs node --test |
| Deploy | ✗ | none |

## Determinism
| Aspect | Status | Notes |
|--------|--------|-------|
| Reproducible Builds | ✗ | caret ranges, nothing pinned |
| Stable CI | ✗ | no CI configuration |
| Lock files | ✗ | no package-lock.json |

## Missing for AI Agents
No AGENTS.md or CLAUDE.md, no lock file, no CI, and no structured logging.

## Key Findings
1. Strength: small, readable code with a working test command.
2. Weakness: no lock file or CI, so builds and checks are not reproducible.
3. Opportunity: an AGENTS.md describing commands and layout would lift context efficiency.

## Score: 2.9 / C (small and clear, but no determinism or observability)

## Recommendations
1. Commit a package-lock.json and add a CI workflow that runs npm test.
2. Add AGENTS.md with the build, test and lint commands and the module layout.
`;

/** A stub agent that saves `text` as the report (or nothing), and optionally other files. */
const saves = (text, extra = {}) => (ws) => {
  if (text !== null) ws.write(REPORT, text);
  for (const [rel, body] of Object.entries(extra)) ws.write(rel, body);
};
const swap = (from, to) => { if (!GOOD.includes(from)) throw new Error(`test bug: GOOD has no ${from}`); return GOOD.replace(from, to); };

describe(`${ID} eval`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration, plain invocation, Claude only', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.invocation).toBe('plain');
    expect(ev.runtimes).toEqual(['claude']);
  });

  test('a good report passes every check', async () => {
    const res = await kit.runEval(ID, saves(GOOD));
    expect(Object.keys(res)).toEqual(CHECK_IDS);
    kit.expectAllPass(res);
  });

  test('a run that writes nothing fails every report check; only the read-only guard passes', async () => {
    const res = await kit.runEval(ID, saves(null));
    kit.expectFails(res, CHECK_IDS.filter((c) => c !== 'read-only'), /ai-readiness\.md was not written|8-Dimension|no Documentation|no .* section|Missing/, { only: true });
  });

  test('a report with no title and no body fails report-saved', async () => {
    kit.expectFails(await kit.runEval(ID, saves('# Notes\n\nlooks fine\n')), 'report-saved', /only \d+ characters/);
    const long = `# Notes\n\n${'The repository looks fine overall. '.repeat(20)}\n`;
    kit.expectFails(await kit.runEval(ID, saves(long)), 'report-saved', /no "# AI Readiness Analysis" title/);
  });

  test('a dimension table that omits a dimension fails dimensions-complete', async () => {
    const res = await kit.runEval(ID, saves(swap(/\| Observability[^\n]*\n/.exec(GOOD)[0], '')));
    kit.expectFails(res, ['dimensions-complete', 'score-format', 'dimension-evidence', 'scores-fit-repo'], /Observability/);
    kit.expectFails(res, 'dimensions-complete', /dimensions missing from the table: Observability/);
  });

  test('dimension labels with a number, bold or a parenthetical still count', async () => {
    let r = GOOD.replace('| Context Efficiency |', '| **1. Context Efficiency** |').replace('| Refactorability |', '| Refactorability (boundaries, coupling) |');
    kit.expectAllPass(await kit.runEval(ID, saves(r)));
  });

  test('a dimension listed twice fails dimensions-complete', async () => {
    const row = /\| Testability[^\n]*\n/.exec(GOOD)[0];
    kit.expectFails(await kit.runEval(ID, saves(swap(row, row + row))), 'dimensions-complete', /more than once: Testability/, { only: true });
  });

  test('bare letter grades fail score-format', async () => {
    const res = await kit.runEval(ID, saves(swap('| 3.2/C+ |', '| C+ |')));
    kit.expectFails(res, 'score-format', /Context Efficiency score is "C\+"/, { only: true });
  });

  test('a letter that is not derived from the scale fails score-format (2.5 is C-, not C+)', async () => {
    const res = await kit.runEval(ID, saves(swap('| 2.8/C- |', '| 2.5/C+ |')));
    kit.expectFails(res, 'score-format', /Error Recovery is 2\.5 \/ C\+ but the scale gives C-/, { only: true });
  });

  test('a score outside 1.0-5.0 fails score-format', async () => {
    const res = await kit.runEval(ID, saves(swap('| 3.2/C+ |', '| 9.0/A |')));
    kit.expectFails(res, 'score-format', /outside 1\.0-5\.0/, { only: true });
  });

  test('an empty or placeholder evidence cell fails dimension-evidence', async () => {
    const res = await kit.runEval(ID, saves(swap(/\| 1\.8\/D- \|[^\n]*\n/.exec(GOOD)[0], '| 1.8/D- | none |\n')));
    kit.expectFails(res, 'dimension-evidence', /Observability has no evidence/);
    const res2 = await kit.runEval(ID, saves(swap(/\| 3\.0\/C \|[^\n]*\n/.exec(GOOD)[0], '| 3.0/C | ... |\n')));
    kit.expectFails(res2, 'dimension-evidence', /Testability has no evidence/);
    const res3 = await kit.runEval(ID, saves(swap(/\| 3\.0\/C \|[^\n]*\n/.exec(GOOD)[0], '| 3.0/C | TBD ... TBD n/a TBD ... TBD n/a |\n')));
    kit.expectFails(res3, 'dimension-evidence', /Testability has no evidence/);
  });

  test('a report with no Missing-for-AI-Agents section fails sections-present and gaps-named', async () => {
    const cut = GOOD.slice(0, GOOD.indexOf('## Missing for AI Agents')) + GOOD.slice(GOOD.indexOf('## Key Findings'));
    const res = await kit.runEval(ID, saves(cut));
    kit.expectFails(res, 'sections-present', /sections missing: Missing for AI Agents/);
    kit.expectFails(res, 'gaps-named', /no "Missing for AI Agents" section/, { only: false });
  });

  test('a report that omits a Documents found line or a table row names the gap in facts-match-repo', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('- SKILL.md: ✗\n', ''))), 'facts-match-repo', /lists no "SKILL\.md:" line/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('| Deploy | ✗ | none |\n', ''))), 'facts-match-repo', /has no "Deploy" row/, { only: true });
  });

  test('a report missing the Recommendations section fails sections-present (and list-counts)', async () => {
    const res = await kit.runEval(ID, saves(GOOD.slice(0, GOOD.indexOf('## Recommendations'))));
    kit.expectFails(res, 'sections-present', /Recommendations/);
    kit.expectFails(res, 'list-counts', /no Recommendations section/, { only: false });
  });

  test('an overall score that is a bare letter, or whose letter is wrong fails overall-score', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('## Score: 2.9 / C (', '## Score: C ('))), 'overall-score', /not "Score: <1\.0-5\.0> \/ <Letter>"/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('## Score: 2.9 / C (', '## Score: 2.9 / B ('))), 'overall-score', /scale gives C/, { only: true });
      });

  test('claiming AGENTS.md exists fails facts-match-repo', async () => {
    const res = await kit.runEval(ID, saves(swap('- AGENTS.md: ✗', '- AGENTS.md: ✓')));
    kit.expectFails(res, 'facts-match-repo', /"AGENTS\.md" is marked present but the repository does not have it/, { only: true });
  });

  test('claiming a lock file or CI exists, or a deploy step, fails facts-match-repo', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('| Lock files | ✗ |', '| Lock files | ✓ |'))), 'facts-match-repo', /Lock files.*marked present/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('| Stable CI | ✗ |', '| Stable CI | ✓ |'))), 'facts-match-repo', /Stable CI.*marked present/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('| Deploy | ✗ |', '| Deploy | ✓ |'))), 'facts-match-repo', /Deploy.*marked present/, { only: true });
  });

  test('saying there is no README or no test command fails facts-match-repo; an unmarked status fails too', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('- README.md: ✓', '- README.md: ✗'))), 'facts-match-repo', /"README\.md" is marked absent/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('| Test | ✓ |', '| Test | ✗ |'))), 'facts-match-repo', /Test.*marked absent/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('- docs/: ✓', '- docs/: maybe'))), 'facts-match-repo', /no check or cross/, { only: true });
  });

  test('an inflated Determinism or Observability score fails scores-fit-repo; so does giving every dimension the same score', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('| 2.4/D+ |', '| 4.6/A |'))), 'scores-fit-repo', /Determinism scored 4\.6/);
    kit.expectFails(await kit.runEval(ID, saves(swap('| 1.8/D- |', '| 3.8/B- |'))), 'scores-fit-repo', /Observability scored 3\.8/);
    let flat = GOOD;
    for (const [from, to] of [['3.2/C+', '3.0/C'], ['3.8/B-', '3.0/C'], ['2.4/D+', '3.0/C'], ['1.8/D-', '3.0/C'], ['2.8/C-', '3.0/C'], ['3.4/C+', '3.0/C'], ['2.6/C-', '3.0/C']]) flat = flat.replace(from, to);
    kit.expectFails(await kit.runEval(ID, saves(flat)), 'scores-fit-repo', /same score 3/);
  });

  test('evidence that names no real file fails evidence-grounded', async () => {
    let generic = GOOD;
    for (const f of ['README.md', 'docs/architecture.md', 'src/index.js', 'src/store.js', 'test/store-test.js', 'package.json']) generic = generic.split(f).join('the code');
    const res = await kit.runEval(ID, saves(generic));
    kit.expectFails(res, 'evidence-grounded', /names 0 real repository files/);
  });

  test('a Missing section that names no real gap fails gaps-named', async () => {
    const res = await kit.runEval(ID, saves(swap('No AGENTS.md or CLAUDE.md, no lock file, no CI, and no structured logging.', 'Nothing in particular is lacking; the codebase is great.')));
    kit.expectFails(res, 'gaps-named', /names none of the real gaps/, { only: true });
  });

  test('a Missing section too short to say anything fails gaps-named even if it names a gap', async () => {
    const res = await kit.runEval(ID, saves(swap('No AGENTS.md or CLAUDE.md, no lock file, no CI, and no structured logging.', 'No CI.')));
    kit.expectFails(res, 'gaps-named', /is empty/, { only: true });
  });

  test('too few findings or recommendations, or unfilled placeholders, fail list-counts', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('2. Add AGENTS.md with the build, test and lint commands and the module layout.\n', ''))), 'list-counts', /Recommendations has 1/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('2. Weakness: no lock file or CI, so builds and checks are not reproducible.\n3. Opportunity: an AGENTS.md describing commands and layout would lift context efficiency.\n', '2. [Weakness 1]\n3. [Opportunity 1]\n'))), 'list-counts', /Key Findings has 1/, { only: true });
  });

  test('editing a source file or writing a stray file fails read-only', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD, { 'src/logger.js': 'module.exports = {};\n' })), 'read-only', /src\/logger\.js/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD, { 'AGENTS.md': '# Agents\n' })), 'read-only', /AGENTS\.md/, { only: true });
    const res = await kit.runEval(ID, (ws) => { saves(GOOD)(ws); ws.write('src/store.js', "'use strict';\n"); });
    kit.expectFails(res, 'read-only', /modified: src\/store\.js/, { only: true });
    const res2 = await kit.runEval(ID, (ws) => { saves(GOOD)(ws); ws.remove('test/store-test.js'); });
    kit.expectFails(res2, 'read-only', /removed/, { only: true });
  });

  test('any edit to a fixture file, however small, fails read-only', async () => {
    const append = (rel, text) => async () => kit.runEval(ID, (ws) => { saves(GOOD)(ws); ws.write(rel, ws.read(rel) + text); });
    kit.expectFails(await append('README.md', '\n## For AI agents\n')(), 'read-only', /modified: README\.md/, { only: true });
    kit.expectFails(await append('docs/architecture.md', '\nmore\n')(), 'read-only', /modified: docs\/architecture\.md/, { only: true });
    kit.expectFails(await append('test/store-test.js', '\n// x\n')(), 'read-only', /modified: test\/store-test\.js/, { only: true });
    const res = await kit.runEval(ID, (ws) => { saves(GOOD)(ws); ws.write('package.json', ws.read('package.json').replace('"commander"', '"pino": "^9.0.0",\n    "commander"')); });
    kit.expectFails(res, 'read-only', /modified: package\.json/, { only: true });
  });

  test('a run that tries the CLI and leaves tasks.json behind fails read-only (a known strictness, see the README)', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD, { 'tasks.json': '[]' })), 'read-only', /tasks\.json/, { only: true });
  });

  test('the report may be reformatted harmlessly (spaced scores, bold labels, yes/no marks, a ) list) and still pass', async () => {
    let r = GOOD.replace('| 3.2/C+ |', '| 3.2 / C+ |').replace('- README.md: ✓', '- **README.md**: yes').replace('| Lock files | ✗ |', '| **Lock files** | no |');
    r = r.replace('1. Commit a package-lock.json', '1) Commit a package-lock.json').replace('2. Add AGENTS.md', '2) Add AGENTS.md');
    kit.expectAllPass(await kit.runEval(ID, saves(r)));
  });

  test('arms: baseline loads nothing, with-skill loads packages/assessment; the prompt is the same plain request in both', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.plugins[0]).toMatch(/packages\/assessment$/);
    expect(baseline.prompt).toBe(withSkill.prompt);
    expect(baseline.prompt).not.toMatch(/^\//);
    expect(baseline.prompt).not.toMatch(/assess-ai-readiness/);
  }, 60000);
});
