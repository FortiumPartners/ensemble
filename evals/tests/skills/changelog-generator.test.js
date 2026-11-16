'use strict';

/** Proof that the changelog-generator checks pass on a good changelog and fail on plausible wrong ones (evals/checks/changelog-generator.js). */

const kit = require('../skill-eval-kit');

const ID = 'changelog-generator';
const TAG = '.git/refs/tags/v1.0.0';

const GOOD = `# Changelog

## [2.0.0] - 2026-11-14

### Breaking Changes
- **auth**: remove deprecated OAuth 1.0 support (a1b2c3d)
- **config**: rename the timeout option (BREAKING CHANGE: the timeout option is now called timeoutMs) (b2c3d4e)

### Features
- **api**: add rate limiting with Redis backend (c3d4e5f)
- **ui**: implement dark mode toggle (d4e5f60)

### Bug Fixes
- **database**: fix connection pool exhaustion (e5f6071)

### Performance
- **api**: add query indexes for widget lookups (f607182)

### Documentation
- document the setup steps in the README (0718293)

Suggested version: 2.0.0 (major: breaking changes).
`;

/** A stub agent: the seeded tag (the seed script ran) and a CHANGELOG.md with `text`. */
const writes = (text, { tag = true } = {}) => (ws) => {
  if (tag) ws.write(TAG, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n');
  if (text !== null) ws.write('CHANGELOG.md', text);
};
const swap = (from, to) => GOOD.replace(from, to);

describe(`${ID}`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.runtimes).toEqual(['claude']);
  });

  test('a good changelog passes every check', async () => {
    const res = await kit.runEval(ID, writes(GOOD));
    expect(Object.keys(res)).toEqual(['history-seeded', 'changelog-saved', 'breaking-section', 'categories', 'scopes', 'hashes', 'breaking-first', 'chore-excluded', 'version-bump']);
    kit.expectAllPass(res);
  });

  test('a run that does nothing fails the history and every changelog check', async () => {
    const res = await kit.runEval(ID, () => {});
    kit.expectFails(res, Object.keys(res), undefined, { only: true });
  });

  test('a changelog written without running the seed script fails history-seeded only', async () => {
    kit.expectFails(await kit.runEval(ID, writes(GOOD, { tag: false })), 'history-seeded', /seed-history/, { only: true });
  });

  test('breaking commits listed as plain features fail breaking-section (and breaking-first when the section is gone)', async () => {
    const flat = GOOD.replace(/### Breaking Changes\n[^#]*/, '').replace('### Features\n', '### Features\n- **auth**: remove deprecated OAuth 1.0 support (a1b2c3d)\n- **config**: rename the timeout option (b2c3d4e)\n');
    kit.expectFails(await kit.runEval(ID, writes(flat)), ['breaking-section', 'breaking-first'], /Breaking Changes/);
  });

  test('only the ! form detected (the footer form missing) fails breaking-section', async () => {
    const res = await kit.runEval(ID, writes(swap(/- \*\*config\*\*: rename[^\n]*\n/, '')));
    kit.expectFails(res, 'breaking-section', /timeout option/);
  });

  test('a feature listed under Breaking Changes fails breaking-section', async () => {
    const res = await kit.runEval(ID, writes(swap('### Breaking Changes\n', '### Breaking Changes\n- **ui**: implement dark mode toggle (d4e5f60)\n')));
    kit.expectFails(res, 'breaking-section', /dark mode/);
  });

  test('a changelog without any heading fails changelog-saved', async () => {
    const res = await kit.runEval(ID, writes(GOOD.replace(/^#+ /gm, '')));
    kit.expectFails(res, 'changelog-saved', /no markdown heading/);
  });

  test('a non-breaking fix listed under Breaking Changes fails breaking-section', async () => {
    const res = await kit.runEval(ID, writes(swap('### Breaking Changes\n', '### Breaking Changes\n- **database**: fix connection pool exhaustion (e5f6071)\n')));
    kit.expectFails(res, 'breaking-section', /connection pool/);
  });

  test('a fix moved out of Bug Fixes into Features fails categories as not under Bug Fixes', async () => {
    const moved = swap('- **database**: fix connection pool exhaustion (e5f6071)\n', '').replace('### Features\n', '### Features\n- **database**: fix connection pool exhaustion (e5f6071)\n');
    kit.expectFails(await kit.runEval(ID, writes(moved)), 'categories', /not under Bug Fixes|connection pool/);
    const res = await kit.runEval(ID, writes(moved.replace('### Bug Fixes', '### Bug Fixes\n- **api**: other fix (1234567)')));
    kit.expectFails(res, 'categories', /connection pool is not under Bug Fixes/);
  });

  test('a fix filed under Features fails categories', async () => {
    const res = await kit.runEval(ID, writes(swap('### Features\n', '### Features\n- **database**: fix connection pool exhaustion (e5f6071)\n')));
    kit.expectFails(res, 'categories', /connection pool/);
  });

  test('a missing Performance section fails categories', async () => {
    const res = await kit.runEval(ID, writes(swap(/### Performance\n[^#]*/, '')));
    kit.expectFails(res, 'categories', /Performance/);
  });

  test('a changelog that drops the scopes fails scopes only', async () => {
    const res = await kit.runEval(ID, writes(GOOD.replace(/\*\*(api|ui|database|auth|config)\*\*: /g, '')));
    kit.expectFails(res, 'scopes', /scope/, { only: true });
  });

  test('a changelog without commit hashes fails hashes only; a word that looks like hex does not count', async () => {
    const none = GOOD.replace(/ \([0-9a-f]{7}\)/g, '');
    kit.expectFails(await kit.runEval(ID, writes(none)), 'hashes', /no commit hash/, { only: true });
    const decoy = none.replace('Redis backend', 'Redis backend, defaced');
    kit.expectFails(await kit.runEval(ID, writes(decoy)), 'hashes', /rate limiting/, { only: true });
  });

  test('Features before Breaking Changes fails breaking-first only', async () => {
    const feat = /### Features\n[^#]*/.exec(GOOD)[0];
    const reordered = GOOD.replace(feat, '').replace('### Breaking Changes', `${feat}### Breaking Changes`);
    kit.expectFails(await kit.runEval(ID, writes(reordered)), 'breaking-first', /before Breaking Changes/, { only: true });
  });

  test('listing the chore commit fails chore-excluded only', async () => {
    const res = await kit.runEval(ID, writes(GOOD.trimEnd() + '\n\n### Maintenance\n- bump lodash to 4.17.21 (1829304)\n'));
    kit.expectFails(res, 'chore-excluded', /lodash/, { only: true });
  });

  test('a minor bump (1.1.0) fails version-bump only; 12.0.0 and 2.0.01 do not count as 2.0.0', async () => {
    const minor = swap('Suggested version: 2.0.0 (major: breaking changes).', 'Suggested version: 1.1.0.').replace('[2.0.0]', '[1.1.0]');
    kit.expectFails(await kit.runEval(ID, writes(minor)), 'version-bump', /2\.0\.0/, { only: true });
    for (const v of ['12.0.0', '2.0.01', '2.0.0.1']) {
      const res = await kit.runEval(ID, writes(minor.replace('1.1.0.', `${v}.`)));
      kit.expectFails(res, 'version-bump', undefined, { only: true });
    }
  });

  test('a symlinked CHANGELOG.md is refused, not followed', async () => {
    const res = await kit.runEval(ID, (ws) => {
      writes(null)(ws);
      ws.write('real.md', GOOD);
      require('fs').symlinkSync(`${ws.dir}/real.md`, `${ws.dir}/CHANGELOG.md`);
    });
    kit.expectFails(res, ['changelog-saved', 'breaking-section', 'categories'], /symlink/);
  });

  test('arms: plain prompt in both arms, baseline loads nothing, with-skill loads packages/git', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.prompt).toBe(baseline.prompt);
    expect(baseline.prompt).toMatch(/seed-history/);
  }, 60000);
});
