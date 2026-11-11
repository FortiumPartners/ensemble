'use strict';

/**
 * kata cwd4: what the README, the pr-review-eval skill and its reference, the
 * CHANGELOG entry and the guard's own header say the quality guard does is what
 * `review-eval-guard.js` does (its behaviour is proven in
 * `review-eval-guard.test.js`).
 *
 * A review of the first version found documentation that promised more than the
 * guard delivers (every expected finding present; a wrong pinned range checked;
 * every run recorded; a drift check that fails the run) and wording that
 * contradicted itself across files. Each claim below is stated once in the same
 * words everywhere it is made, and each sentence that overclaimed is pinned
 * gone, so a revert of the wording turns a test red.
 */

const fs = require('fs');
const path = require('path');

const { parseArgs } = require('../lib/review-eval-guard');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const GUARD = path.join(REPO_ROOT, 'packages', 'development', 'lib', 'review-eval-guard.js');

describe('the documentation states what the guard does', () => {
  const flat = (text) => text.replace(/\s+/g, ' ');
  const read = (...parts) => fs.readFileSync(path.join(REPO_ROOT, ...parts), 'utf8');
  const SKILL_DIR = ['packages', 'development', 'skills', 'pr-review-eval'];
  const SOURCES = {
    README: read('docs', 'review-eval', 'README.md'),
    'eval-details.md': read(...SKILL_DIR, 'reference', 'eval-details.md'),
    'SKILL.md': read(...SKILL_DIR, 'SKILL.md'),
    'guard header': fs.readFileSync(GUARD, 'utf8').split('*/')[0].replace(/\n \* ?/g, ' '),
    CHANGELOG: read('CHANGELOG.md').split('\n').find((line) => line.includes('review quality guard')) || '',
  };
  const text = (name) => flat(SOURCES[name]);

  const CLAIMS = [
    ['the match is by location and severity, not by what a finding says', /by location and severity, not by what a finding says/, ['README', 'eval-details.md', 'SKILL.md', 'guard header', 'CHANGELOG']],
    ['the eval set is read from the base commit, never from the checkout under test', /never from the checkout under test/, ['README', 'eval-details.md', 'guard header', 'CHANGELOG']],
    ['the skill runs the guard with --base "$BASE_SHA"', /review-eval-guard\.js --base "\$BASE_SHA"/, ['SKILL.md']],
    ['a pin does not read the recorded lines', /does not read the recorded lines|recorded lines (?:themselves )?(?:are )?not read/, ['README', 'eval-details.md', 'guard header', 'CHANGELOG']],
    ['stale cases are an advisory, failing only under --fail-on-stale', /stale[^.]*advisory/i, ['README', 'eval-details.md', 'guard header', 'CHANGELOG']],
    ['an unverifiable pin fails unless --allow-unverifiable-pins', /--allow-unverifiable-pins/, ['README', 'eval-details.md', 'guard header', 'CHANGELOG']],
  ];

  test.each(CLAIMS)('%s', (claim, pattern, names) => {
    for (const name of names) expect([claim, name, pattern.test(text(name))]).toEqual([claim, name, true]);
  });

  test('the sentences that overclaimed are gone', () => {
    expect(text('README')).not.toMatch(/Exit 0 only when every expected Important finding is present/);
    expect(text('README')).not.toMatch(/baseline is the output of the pipeline as it was/);
    expect(text('README')).not.toMatch(/re-checks that each file has those lines at its commit/);
    expect(text('eval-details.md')).not.toMatch(/Each run, failures included, appends/);
    expect(text('eval-details.md')).not.toMatch(/Exit 0 only when every expected Important finding is present/);
    expect(text('SKILL.md')).not.toMatch(/exit 1 means a lost Important finding\./i);
    expect(text('CHANGELOG')).not.toMatch(/records the false-negative rate of every run/);
    expect(text('CHANGELOG')).not.toMatch(/contains its lines/);
  });

  test('the documented commands are accepted by the CLI, and both carry --base', () => {
    const commandOf = (source) => {
      for (const block of source.matchAll(/```bash\n([\s\S]*?)```/g)) {
        const row = block[1].replace(/\\\n/g, ' ').split('\n').find((line) => /^node\s.*review-eval-guard|^node\s+"\$PR_REVIEW_EVAL_GUARD_CLI"/.test(line.trim()));
        if (row !== undefined) return row.trim().split(/\s+/).slice(2).map((token) => token.replace(/^"|"$/g, ''));
      }
      return null;
    };
    for (const name of ['README', 'eval-details.md']) {
      const argv = commandOf(SOURCES[name]);
      expect([name, argv !== null]).toEqual([name, true]);
      expect([name, argv.includes('--base')]).toEqual([name, true]);
      expect([name, parseArgs(argv).error]).toEqual([name, undefined]);
    }
  });

  test('the guard header documents every flag the CLI accepts', () => {
    const valued = ['--base', '--findings', '--cases', '--repo', '--history', '--reviewer'];
    const flags = ['--fail-on-stale', '--allow-unverifiable-pins'];
    for (const flag of [...valued, ...flags]) expect([flag, text('guard header').includes(flag)]).toEqual([flag, true]);
    const parsed = parseArgs([...valued.flatMap((flag) => [flag, 'x']), ...flags]);
    expect(parsed.error).toBeUndefined();
    expect(parsed.options).toMatchObject({ base: 'x', findingsPath: 'x', casesDir: 'x', repoRoot: 'x', historyPath: 'x', reviewer: 'x', failOnStale: true, allowUnverifiablePins: true });
  });
});
