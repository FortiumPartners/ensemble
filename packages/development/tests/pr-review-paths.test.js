'use strict';

/**
 * TRD-001: Path matching, owner and sensitivity resolution.
 *
 * Validates PRD ACs: AC-003-1, AC-003-2, AC-003-3 (REQ-003).
 *
 * These are the Implementation AC tests for `pr-review-paths.js`. The
 * PRD-scenario tests live in TRD-001-TEST.
 *
 * What is pinned here:
 *   1. an owner-declared sensitive/High list classifies each changed path and
 *      NAMES the declaration entry that matched (AC-003-1);
 *   2. with no owner declaration, CI workflows, release gates, installers,
 *      generation scripts and the constitution are sensitive through the
 *      built-in default set (AC-003-2);
 *   3. a PR that edits the declaration file is itself sensitive, and the
 *      declaration in force is the BASE copy -- a declaration that did not
 *      come from the base commit is rejected, never used (AC-003-3, REQ-024);
 *   4. CODEOWNERS resolution is last-match-wins and a malformed line is
 *      reported and skipped, never guessed.
 *
 * Fail-closed is pinned too: bad request shapes never produce a clean
 * "not sensitive" answer.
 */

const {
  classifyPaths,
  ownersFor,
  matchesPattern,
  DEFAULT_SENSITIVE_PATHS,
  DEFAULT_DECLARATION_PATHS,
} = require('../lib/pr-review-paths');

const BASE = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

/** The detail record for one changed path. */
const detailFor = (result, path) => result.paths.find((entry) => entry.path === path);

describe('pr-review-paths: classifyPaths with an owner declaration (AC-003-1)', () => {
  const declaration = {
    path: 'REVIEW.md',
    sourceSha: BASE,
    sensitive: ['packages/core/lib/**', 'src/auth/**'],
    high: ['packages/billing/**'],
  };

  test('each changed path is reported as sensitive or not, and the matching entry is named', () => {
    const result = classifyPaths({
      changedPaths: ['src/auth/token.js', 'docs/readme.md'],
      declaration,
      baseSha: BASE,
    });

    expect(result.ok).toBe(true);
    expect(result.sensitive).toEqual(['src/auth/token.js']);
    expect(detailFor(result, 'src/auth/token.js')).toMatchObject({
      sensitive: true,
      matchedBy: 'src/auth/**',
      source: 'declaration',
    });
    expect(detailFor(result, 'docs/readme.md')).toMatchObject({
      sensitive: false,
      matchedBy: null,
      source: null,
    });
    expect(result.prSensitive).toBe(true);
  });

  test('a declared High path is reported in high[] with the entry that matched', () => {
    const result = classifyPaths({
      changedPaths: ['packages/billing/invoice.js'],
      declaration,
      baseSha: BASE,
    });

    expect(result.high).toEqual(['packages/billing/invoice.js']);
    expect(detailFor(result, 'packages/billing/invoice.js')).toMatchObject({
      high: true,
      highMatchedBy: 'packages/billing/**',
    });
  });

  test('a PR touching no declared or default area is not sensitive', () => {
    const result = classifyPaths({
      changedPaths: ['docs/readme.md', 'src/ui/button.jsx'],
      declaration,
      baseSha: BASE,
    });

    expect(result.ok).toBe(true);
    expect(result.sensitive).toEqual([]);
    expect(result.high).toEqual([]);
    expect(result.declarationChanged).toBe(false);
    expect(result.prSensitive).toBe(false);
  });

  test('a declaration can add to the built-in defaults but never remove one', () => {
    const narrowing = { path: 'REVIEW.md', sourceSha: BASE, sensitive: ['src/auth/**'] };
    const result = classifyPaths({
      changedPaths: ['.github/workflows/release.yml'],
      declaration: narrowing,
      baseSha: BASE,
    });

    expect(result.sensitive).toEqual(['.github/workflows/release.yml']);
    expect(detailFor(result, '.github/workflows/release.yml').source).toBe('default');
  });
});

describe('pr-review-paths: built-in default sensitive set (AC-003-2)', () => {
  const defaultsOnly = (path) => classifyPaths({ changedPaths: [path], declaration: null, baseSha: BASE });

  test.each([
    ['CI workflow definition', '.github/workflows/test.yml'],
    ['CI composite action', '.github/actions/setup/action.yml'],
    ['release gate workflow', '.github/workflows/release-gate.yml'],
    ['release gate script', 'scripts/validate-release-bump.js'],
    ['publish script', 'scripts/publish-plugin.js'],
    ['installer script', 'scripts/install-codex-project.js'],
    ['installer shell script', 'install.sh'],
    ['generation script', 'scripts/generate-markdown.js'],
    ['generation pipeline directory', 'scripts/generate-codex/index.js'],
    ['project constitution', 'docs/standards/constitution.md'],
    ['root constitution', 'CONSTITUTION.md'],
    // `**` takes ANY character: `.` would skip these four line terminators, so a name holding one would be no
    // match for the built-in floor and a PR adding it would touch "no sensitive path" (N-01).
    ['CI workflow whose name holds a line separator (U+2028)', '.github/workflows/ev\u2028il.yml'],
    ['CI workflow whose name holds a paragraph separator (U+2029)', '.github/workflows/ev\u2029il.yml'],
    ['CI workflow whose name holds a newline', '.github/workflows/ev\nil.yml'],
    ['CI workflow whose name holds a carriage return', '.github/workflows/ev\ril.yml'],
    ['CI composite action under a directory whose name holds a line separator', '.github/actions/a\u2028b/action.yml'],
    ['CircleCI config whose name holds a paragraph separator', '.circleci/a\u2029b.yml'],
    ['generation pipeline file whose name holds a line separator', 'scripts/generate-codex/a\u2028b.js'],
  ])('%s is sensitive with no owner declaration', (_label, path) => {
    const result = defaultsOnly(path);
    expect(result.sensitive).toEqual([path]);
    expect(detailFor(result, path).source).toBe('default');
    expect(typeof detailFor(result, path).matchedBy).toBe('string');
  });

  test('an ordinary source file is not sensitive by default', () => {
    const result = defaultsOnly('packages/development/lib/trd-parser.js');
    expect(result.sensitive).toEqual([]);
    expect(result.prSensitive).toBe(false);
  });

  test('declarationSource reports that no declaration was in force', () => {
    const result = defaultsOnly('docs/readme.md');
    expect(result.declarationSource).toBe('defaults');
    expect(result.ok).toBe(true);
  });

  test('the default set is frozen and non-empty, so a caller cannot shrink it', () => {
    expect(Array.isArray(DEFAULT_SENSITIVE_PATHS)).toBe(true);
    expect(DEFAULT_SENSITIVE_PATHS.length).toBeGreaterThan(0);
    expect(Object.isFrozen(DEFAULT_SENSITIVE_PATHS)).toBe(true);
  });
});

describe('pr-review-paths: the declaration file itself and base-commit trust (AC-003-3, REQ-024)', () => {
  const declaration = { path: 'REVIEW.md', sourceSha: BASE, sensitive: ['src/auth/**'] };

  test('a PR that changes the declaration file is sensitive and the change is reported', () => {
    const result = classifyPaths({
      changedPaths: ['REVIEW.md'],
      declaration,
      baseSha: BASE,
    });

    expect(result.declarationChanged).toBe(true);
    expect(result.prSensitive).toBe(true);
    expect(result.sensitive).toEqual(['REVIEW.md']);
    expect(detailFor(result, 'REVIEW.md').source).toBe('declaration-file');
  });

  test('the declaration in force is the base copy -- a head-sourced declaration is rejected', () => {
    const fromHead = { path: 'REVIEW.md', sourceSha: OTHER, sensitive: ['src/vendor/**'] };
    const result = classifyPaths({
      changedPaths: ['src/vendor/lib.js', '.github/workflows/test.yml'],
      declaration: fromHead,
      baseSha: BASE,
    });

    expect(result.declarationSource).toBe('defaults');
    expect(result.warnings).toContain('declaration-not-from-base');
    // The PR's own widened declaration never takes effect...
    expect(result.sensitive).not.toContain('src/vendor/lib.js');
    // ...and the defaults still apply.
    expect(result.sensitive).toContain('.github/workflows/test.yml');
  });

  test('a declaration with no source identity is rejected with the same reason', () => {
    const anonymous = { path: 'REVIEW.md', sensitive: ['src/vendor/**'] };
    const result = classifyPaths({ changedPaths: ['src/vendor/lib.js'], declaration: anonymous, baseSha: BASE });

    expect(result.declarationSource).toBe('defaults');
    expect(result.warnings).toContain('declaration-not-from-base');
    expect(result.sensitive).toEqual([]);
  });

  test('the declaration file is sensitive even when no declaration is in force', () => {
    const result = classifyPaths({ changedPaths: ['REVIEW.md'], declaration: null, baseSha: BASE });
    expect(result.declarationChanged).toBe(true);
    expect(result.prSensitive).toBe(true);
  });

  test('CODEOWNERS counts as a declaration file by default', () => {
    expect(DEFAULT_DECLARATION_PATHS).toContain('.github/CODEOWNERS');
    const result = classifyPaths({ changedPaths: ['.github/CODEOWNERS'], declaration: null, baseSha: BASE });
    expect(result.declarationChanged).toBe(true);
    expect(result.prSensitive).toBe(true);
  });

  test('a declaration naming several files marks any of them as the declaration file', () => {
    const multi = { path: ['REVIEW.md', 'docs/REVIEW.md'], sourceSha: BASE, sensitive: [] };
    const result = classifyPaths({ changedPaths: ['docs/REVIEW.md'], declaration: multi, baseSha: BASE });
    expect(result.declarationChanged).toBe(true);
    expect(detailFor(result, 'docs/REVIEW.md').source).toBe('declaration-file');
  });
});

describe('pr-review-paths: fail-closed request handling', () => {
  test('a missing changedPaths list never returns a clean not-sensitive answer', () => {
    const result = classifyPaths({ declaration: null, baseSha: BASE });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid-changed-paths');
    expect(result.prSensitive).toBe(true);
    expect(result.declarationChanged).toBe(true);
  });

  test.each([[null], [undefined], ['a string'], [42], [[]]])('a non-object payload (%p) fails closed', (payload) => {
    const result = classifyPaths(payload);
    expect(result.ok).toBe(false);
    expect(result.prSensitive).toBe(true);
  });

  test('a non-string entry in changedPaths fails closed and names the reason', () => {
    const result = classifyPaths({ changedPaths: ['ok.js', 7], declaration: null, baseSha: BASE });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid-path-entry');
    expect(result.prSensitive).toBe(true);
  });

  test('a missing or malformed baseSha rejects the declaration rather than trusting it', () => {
    const declaration = { path: 'REVIEW.md', sourceSha: BASE, sensitive: ['src/vendor/**'] };
    const result = classifyPaths({ changedPaths: ['src/vendor/lib.js'], declaration, baseSha: 'main' });
    expect(result.declarationSource).toBe('defaults');
    expect(result.warnings).toContain('declaration-not-from-base');
    expect(result.sensitive).toEqual([]);
  });

  test('a declaration whose lists are not arrays of strings is rejected, not partially read', () => {
    const declaration = { path: 'REVIEW.md', sourceSha: BASE, sensitive: 'src/**' };
    const result = classifyPaths({ changedPaths: ['src/a.js'], declaration, baseSha: BASE });
    expect(result.declarationSource).toBe('defaults');
    expect(result.warnings).toContain('declaration-malformed');
    expect(result.sensitive).toEqual([]);
  });

  test('a __proto__ payload cannot pollute Object.prototype', () => {
    classifyPaths(JSON.parse('{"changedPaths":["a.js"],"__proto__":{"polluted":true},"baseSha":"' + BASE + '"}'));
    expect({}.polluted).toBeUndefined();
  });
});

describe('pr-review-paths: ownersFor (CODEOWNERS)', () => {
  const codeowners = [
    '# comment line',
    '*            @org/default-team',
    'packages/**  @org/platform @alice',
    'packages/development/lib/** @bob',
    '',
  ].join('\n');

  test('the last matching rule wins and the owner list is returned', () => {
    const result = ownersFor('packages/development/lib/pr-review-paths.js', codeowners);
    expect(result.owners).toEqual(['@bob']);
    expect(result.matchedBy).toBe('packages/development/lib/**');
    expect(result.malformed).toEqual([]);
  });

  test('an earlier rule applies when no later rule matches', () => {
    const result = ownersFor('packages/core/lib/x.js', codeowners);
    expect(result.owners).toEqual(['@org/platform', '@alice']);
    expect(result.matchedBy).toBe('packages/**');
  });

  test('the catch-all rule applies to an otherwise unmatched path', () => {
    const result = ownersFor('README.md', codeowners);
    expect(result.owners).toEqual(['@org/default-team']);
    expect(result.matchedBy).toBe('*');
  });

  test('a malformed line is reported and skipped, never guessed', () => {
    const text = ['packages/** @org/platform', 'docs/**', 'src/** not-an-owner', 'lib/** @ok'].join('\n');
    const result = ownersFor('docs/guide.md', text);

    expect(result.owners).toEqual([]);
    expect(result.matchedBy).toBeNull();
    expect(result.malformed).toEqual([
      { line: 2, text: 'docs/**', reason: 'no-owners' },
      { line: 3, text: 'src/** not-an-owner', reason: 'invalid-owner' },
    ]);
  });

  test('a malformed line never contributes owners to a path it would have matched', () => {
    const text = ['*  @org/default', 'src/** not-an-owner'].join('\n');
    const result = ownersFor('src/a.js', text);
    expect(result.owners).toEqual(['@org/default']);
    expect(result.matchedBy).toBe('*');
  });

  test('an email owner is accepted', () => {
    const result = ownersFor('a.js', '* dev@example.com');
    expect(result.owners).toEqual(['dev@example.com']);
  });

  test('absent or non-string CODEOWNERS text yields no owners rather than throwing', () => {
    expect(ownersFor('a.js', undefined)).toEqual({ owners: [], matchedBy: null, malformed: [] });
    expect(ownersFor('a.js', { not: 'text' })).toEqual({ owners: [], matchedBy: null, malformed: [] });
  });

  test('a non-string path yields no owners rather than throwing', () => {
    expect(ownersFor(null, '* @org/default').owners).toEqual([]);
  });

  test('classifyPaths reports owners for each changed path when CODEOWNERS is supplied', () => {
    const result = classifyPaths({
      changedPaths: ['packages/development/lib/pr-review-paths.js'],
      declaration: null,
      codeowners,
      baseSha: BASE,
    });

    expect(detailFor(result, 'packages/development/lib/pr-review-paths.js').owners).toEqual(['@bob']);
    expect(result.ownersMalformed).toEqual([]);
  });

  test('classifyPaths surfaces malformed CODEOWNERS lines instead of guessing owners', () => {
    const result = classifyPaths({
      changedPaths: ['docs/guide.md'],
      declaration: null,
      codeowners: 'docs/**\n',
      baseSha: BASE,
    });

    expect(detailFor(result, 'docs/guide.md').owners).toEqual([]);
    expect(result.ownersMalformed).toEqual([{ line: 1, text: 'docs/**', reason: 'no-owners' }]);
    expect(result.warnings).toContain('codeowners-malformed');
  });
});

describe('pr-review-paths: glob matching', () => {
  test.each([
    ['src/**', 'src/a/b/c.js', true],
    ['src/**', 'src/a.js', true],
    ['src/**', 'srcx/a.js', false],
    ['src/*', 'src/a.js', true],
    ['src/*', 'src/a/b.js', false],
    ['*.yml', 'a.yml', true],
    ['*.yml', 'deep/dir/a.yml', true],
    ['/*.yml', 'deep/dir/a.yml', false],
    ['/*.yml', 'a.yml', true],
    ['docs/', 'docs/a/b.md', true],
    ['docs/', 'docsx/b.md', false],
    ['a?c.js', 'a-c.js', true],
    ['a?c.js', 'abbc.js', false],
    // A wildcard segment matches only what it spells out...
    ['scripts/generate-*', 'scripts/generate-codex/index.js', false],
    ['scripts/generate-*/**', 'scripts/generate-codex/index.js', true],
    // ...while a literal directory name covers everything beneath it.
    ['src/auth', 'src/auth/token.js', true],
    ['src/auth', 'src/authz/token.js', false],
    ['docs/a/b.md', 'docs/a/b.md', true],
  ])('pattern %p vs path %p -> %p', (pattern, path, expected) => {
    expect(matchesPattern(pattern, path)).toBe(expected);
  });

  // `**` takes ANY character, line terminators included: `.` skips \n, \r, U+2028 and U+2029, so a name holding one
  // slipped past `.github/workflows/**` (N-01). `*` and `?` never did, and neither of them crosses `/`. The rows carry
  // their own label: these names would print as line breaks in a test title.
  test.each([
    ['`**` crosses a line separator', '.github/workflows/**', '.github/workflows/a\u2028b.yml', true],
    ['`**` crosses a paragraph separator', '.github/workflows/**', '.github/workflows/a\u2029b.yml', true],
    ['`**` crosses a newline', '.github/workflows/**', '.github/workflows/a\nb.yml', true],
    ['`**` crosses a carriage return', '.github/workflows/**', '.github/workflows/a\rb.yml', true],
    ['`**` crosses separators in every segment', '.github/workflows/**', '.github/workflows/a\u2028/b\u2029c/d\ne.yml', true],
    ['`**/` in the middle crosses separators', 'src/**/x.js', 'src/a\u2028b/c\nd/x.js', true],
    ['`**/` in the middle still matches no directory at all', 'src/**/x.js', 'src/x.js', true],
    ['`**/` in the middle still needs the file it names', 'src/**/x.js', 'src/a\u2028b/y.js', false],
    ['`*` matches a line separator inside a segment', 'src/*', 'src/a\u2028b', true],
    ['`*` still stops at a slash after a line separator', 'src/*', 'src/a\u2028/b', false],
    ['`*` still stops at a slash after a newline', 'src/*', 'src/a\nb/c', false],
    ['`?` matches one line separator', 'a?c.js', 'a\u2028c.js', true],
    ['`?` matches only one character', 'a?c.js', 'a\u2028\u2029c.js', false],
    ['`?` still stops at a slash', 'a?c.js', 'a/c.js', false],
  ])('%s', (_label, pattern, path, expected) => {
    expect(matchesPattern(pattern, path)).toBe(expected);
  });

  test('a regex metacharacter in a pattern is matched literally, not executed', () => {
    expect(matchesPattern('a+b.js', 'a+b.js')).toBe(true);
    expect(matchesPattern('a+b.js', 'aab.js')).toBe(false);
    expect(matchesPattern('a.js', 'axjs')).toBe(false);
  });

  test('a non-string pattern or path never matches', () => {
    expect(matchesPattern(null, 'a.js')).toBe(false);
    expect(matchesPattern('a.js', null)).toBe(false);
  });

  test('a leading ./ in a changed path is normalized before matching', () => {
    const result = classifyPaths({ changedPaths: ['./.github/workflows/test.yml'], declaration: null, baseSha: BASE });
    expect(result.sensitive).toEqual(['./.github/workflows/test.yml']);
  });
});

describe('pr-review-paths: a declared High path is High whatever its name holds (N-01)', () => {
  const declaration = { path: 'REVIEW.md', sourceSha: BASE, sensitive: [], high: ['packages/agent-core/**'] };

  test.each([
    ['a line separator (U+2028)', '\u2028'],
    ['a paragraph separator (U+2029)', '\u2029'],
    ['a newline', '\n'],
    ['a carriage return', '\r'],
  ])('a name holding %s under a High area is still High', (_label, terminator) => {
    const changed = `packages/agent-core/src/a${terminator}b.ts`;
    const result = classifyPaths({ changedPaths: [changed], declaration, baseSha: BASE });
    expect(result.high).toEqual([changed]);
    expect(detailFor(result, changed)).toMatchObject({ high: true, highMatchedBy: 'packages/agent-core/**' });
  });
});

describe('pr-review-paths: sensitive and High patterns that name a path are matched ignoring letter case (N-06)', () => {
  // A case-insensitive checkout (macOS, Windows) writes `PR-REVIEW-GATE.JS` over `pr-review-gate.js`, and no glob
  // can spell "either case", so a pattern that names a path also covers the other-case spellings of that path.
  const declaration = {
    path: 'REVIEW.md',
    sourceSha: BASE,
    sensitive: ['packages/*/lib/pr-review-*', 'docs/standards/constitution.md', 'REVIEW.md'],
    high: ['packages/development/lib/**'],
  };
  const classify = (changedPath) => classifyPaths({ changedPaths: [changedPath], declaration, baseSha: BASE });

  test.each([
    ['packages/development/lib/PR-REVIEW-GATE.JS', 'packages/*/lib/pr-review-*'],
    ['packages/development/lib/pr-review-gate.JS', 'packages/*/lib/pr-review-*'],
    ['Packages/Development/Lib/Pr-Review-Gate', 'packages/*/lib/pr-review-*'],
    ['DOCS/STANDARDS/CONSTITUTION.MD', 'docs/standards/constitution.md'],
  ])('a declared sensitive area covers %s', (changedPath, matchedBy) => {
    const result = classify(changedPath);
    expect(result.sensitive).toEqual([changedPath]);
    expect(detailFor(result, changedPath)).toMatchObject({ sensitive: true, matchedBy, source: 'declaration' });
  });

  test('a declared High area covers its other-case spelling', () => {
    const result = classify('PACKAGES/DEVELOPMENT/LIB/foo.js');
    expect(result.high).toEqual(['PACKAGES/DEVELOPMENT/LIB/foo.js']);
    expect(result.sensitive).toEqual([]);
  });

  test.each([
    ['.GitHub/Workflows/Release.yml'],
    ['Scripts/Validate-All.js'],
    ['SCRIPTS/GENERATE-CODEX/index.js'],
  ])('the built-in floor covers %s too', (changedPath) => {
    const result = classifyPaths({ changedPaths: [changedPath], declaration: null, baseSha: BASE });
    expect(result.sensitive).toEqual([changedPath]);
    expect(detailFor(result, changedPath).source).toBe('default');
  });

  // A bare file name selects that name at any depth; an other-case spelling of it elsewhere is no alias of anything.
  // This repository has such a file: `docs/toolchain/contracts/review.md` is a page about review toolchains, not a
  // review rules file.
  test('a bare file name stays exact: REVIEW.md is sensitive at any depth, review.md is not', () => {
    expect(classify('REVIEW.md').sensitive).toEqual(['REVIEW.md']);
    expect(classify('packages/development/REVIEW.md').sensitive).toEqual(['packages/development/REVIEW.md']);
    expect(classify('docs/toolchain/contracts/review.md').sensitive).toEqual([]);
    const floor = classifyPaths({ changedPaths: ['JENKINSFILE', 'jenkinsfile'], declaration: null, baseSha: BASE });
    expect(floor.sensitive).toEqual([]);
    expect(matchesPattern('Jenkinsfile', 'ci/JENKINSFILE', { ignoreCase: true })).toBe(false);
    expect(matchesPattern('*.yml', 'a.YML', { ignoreCase: true })).toBe(false);
  });

  test('a path no area names in either case is still not sensitive', () => {
    const result = classify('packages/development/lib/trd-parser.js');
    expect(result.sensitive).toEqual([]);
    expect(result.high).toEqual(['packages/development/lib/trd-parser.js']);
  });

  // A case-insensitive file system (APFS, NTFS) folds more than ASCII: U+212A KELVIN SIGN is `k` and U+017F LATIN SMALL
  // LETTER LONG S is `s`. A path spelled that way is the same file, so it must be classified as the guard it aliases.
  test.each([
    ['packages/development/\u017Fkills/pr-review-cycle/SKILL.md', 'packages/**/skills/pr-review-cycle/**'],
    ['packages/development/s\u212Aills/pr-review-cycle/SKILL.md', 'packages/**/skills/pr-review-cycle/**'],
    ['packages/development/lib/pr-review-gate.js', 'packages/*/lib/pr-review-*'],
  ])('the Unicode case fold of a guard path is the guard: %s', (changedPath, matchedBy) => {
    const guarded = classifyPaths({
      changedPaths: [changedPath],
      declaration: { path: 'REVIEW.md', sourceSha: BASE, sensitive: ['packages/**/skills/pr-review-cycle/**', 'packages/*/lib/pr-review-*'], high: [] },
      baseSha: BASE,
    });
    expect(guarded.sensitive).toEqual([changedPath]);
    expect(detailFor(guarded, changedPath).matchedBy).toBe(matchedBy);
  });

  test('the Unicode fold does not make an unrelated path a guard', () => {
    // U+0130 (I with dot above) and U+00DF (sharp s) have no simple case fold to an ASCII letter.
    expect(matchesPattern('packages/**/skills/x', 'packages/a/\u00DFkills/x', { ignoreCase: true })).toBe(false);
    expect(matchesPattern('packages/**/skills/x', 'packages/a/skills/x', { ignoreCase: true })).toBe(true);
    expect(matchesPattern('packages/**/skills/x', 'packages/a/skills/x')).toBe(true);
  });

  test('matchesPattern is case-sensitive unless asked: CODEOWNERS paths are, because GitHub resolves them on a case-sensitive file system', () => {
    expect(matchesPattern('src/**', 'SRC/a.js')).toBe(false);
    expect(matchesPattern('src/**', 'SRC/a.js', { ignoreCase: true })).toBe(true);
    expect(ownersFor('SRC/a.js', 'src/** @alice').owners).toEqual([]);
    expect(ownersFor('src/a.js', 'src/** @alice').owners).toEqual(['@alice']);
  });
});
