'use strict';

/**
 * `changedPaths` come from ONE documented command, and a list that did not
 * come from it fails closed where that can be seen (solo-maintainer rule, F-02).
 *
 * "This PR touches no sensitive path" is only as good as the list of changed
 * paths behind it, and git's default listing is lossy twice over:
 *
 *   - `git diff --name-only` prints only the DESTINATION of a rename, so
 *     moving `.github/workflows/ci.yml`, `REVIEW.md` or `CODEOWNERS` out of its
 *     path hides the sensitive path that was deleted;
 *   - it C-quotes any name holding a non-ASCII byte, a control character, `"`
 *     or `\` (`".github/workflows/a\"b.yml"`), and a quoted name matches no
 *     sensitive pattern.
 *
 * Step 1b of the pr-review-cycle skill therefore defines the list as
 * `git diff --name-only -z --no-renames <baseSha> <headSha>` split on NUL.
 * This file runs real git on a real repository to prove both halves -- the
 * default listing is lossy, the documented one is not -- and the command it
 * runs is read out of the skill's own text, so the prose cannot drift from
 * what is proven here. The code can see a quoted name but not a missing
 * rename side, so it refuses the discount for the first and the documented
 * command is the control for the second.
 *
 * The same list feeds Step 1c's slices check, so `slices.paths` is cut from
 * the same kind of listing (`git diff --numstat -z --no-renames`): a plan made
 * from git's default numstat names a move as `{old => new}` and quotes a name,
 * so after every slice is reviewed the coverage check would still call the
 * real paths uncovered (N-12). And `-z` does not make a name safe to match:
 * git prints a name holding U+2028 or U+2029 raw, and a glob engine whose `**`
 * stopped at a line terminator would grade such a workflow "not sensitive"
 * (N-01), so the names the engine and the tier module cannot vouch for are run
 * through real git here too.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { classifyPaths } = require('../lib/pr-review-paths');
const { assignTier, effectiveTier } = require('../lib/pr-review-tier');
const { planSlices, verifyCoverage } = require('../lib/pr-review-depth');
const { readSkillReference } = require('./helpers/pr-review-cycle-skill');
const { reviewedByOf } = require('./helpers/pr-review-reviewed-by');

const GUIDANCE = readSkillReference('scope-guidance-depth.md').replace(/\s+/g, ' ');

const SOLO_POLICY = Object.freeze({ maintainerLogins: ['@Maintainer-M'], soloMaintainer: true });
const NO_PEER = Object.freeze({ needsAnotherPerson: false, reason: 'reviewed', evidencePaths: [] });

/** The git arguments of the command Step 1b documents, taken from the skill's text. */
function documentedListing() {
  const match = /run as git diff with the flags `(--name-only -z --no-renames)` over `<baseSha> <headSha>`/.exec(GUIDANCE);
  expect(match).not.toBeNull();
  return ['diff', ...match[1].split(' ')];
}

/** The git arguments of the command Step 1c documents for the slices' `paths`, taken from the skill's text. */
function documentedNumstat() {
  const match = /run as git diff with the flags `(--numstat -z --no-renames)` over `<baseSha> <headSha>`/.exec(GUIDANCE);
  expect(match).not.toBeNull();
  return ['diff', ...match[1].split(' ')];
}

/**
 * Step 1c's rule for turning that output into `paths`, as the skill words it: NUL ends a record, a record is the added
 * count, a tab, the deleted count, a tab and the name (split at the FIRST TWO tabs only: a name may hold a tab or a
 * newline), and a binary file, which git counts as `-`, is 0.
 */
function parseNumstat(output) {
  const records = output.split('\0');
  expect(records.pop()).toBe(''); // the empty field after the last NUL
  const count = (field) => (field === '-' ? 0 : Number(field));
  return records.map((record) => {
    const first = record.indexOf('\t');
    const second = record.indexOf('\t', first + 1);
    return {
      path: record.slice(second + 1),
      lines: count(record.slice(0, first)) + count(record.slice(first + 1, second)),
    };
  });
}

/** An empty repository with git's own defaults stated, so a developer's global config cannot change what is shown. */
function initRepository() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-review-changed-paths-'));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_SYSTEM: os.devNull, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' });
  const write = (relative, body) => {
    const target = path.join(repo, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  };

  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.quotepath', 'true');
  git('config', 'diff.renames', 'true');
  return { repo, git, write };
}

/** A repository whose pull request moves three sensitive files and adds a workflow git has to quote. */
function buildRepository() {
  const { repo, git, write } = initRepository();
  const lines = (name) => Array.from({ length: 12 }, (_, index) => `${name} line ${index}\n`).join('');

  write('.github/workflows/ci.yml', lines('workflow'));
  write('REVIEW.md', lines('review rules'));
  write('.github/CODEOWNERS', lines('owners'));
  write('packages/agent-core/src/x.ts', 'export const x = 1;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const baseSha = git('rev-parse', 'HEAD').trim();

  for (const directory of ['tools', 'docs']) fs.mkdirSync(path.join(repo, directory), { recursive: true });
  git('mv', '.github/workflows/ci.yml', 'tools/ci.yml');
  git('mv', 'REVIEW.md', 'docs/REVIEW.md');
  git('mv', '.github/CODEOWNERS', 'docs/OWNERS');
  write('.github/workflows/a"b.yml', lines('quoted'));
  write('packages/agent-core/src/x.ts', 'export const x = 2;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'move the guards, add a workflow, change a High path');
  const headSha = git('rev-parse', 'HEAD').trim();

  return { repo, git, baseSha, headSha };
}

/** Names git prints raw under `-z` that `.` does not match, so a glob compiled to `.*` would walk past them. */
const SEPARATOR_SENSITIVE_NAMES = [
  '.github/workflows/ev\u2028il.yml',
  '.github/workflows/ev\u2029il.yml',
  '.github/actions/a\u2028b/action.yml',
  'scripts/generate-x/a\u2028b.js',
];
const SEPARATOR_PLAIN_NAME = 'packages/agent-core/src/a\u2028b.ts';

/** A repository whose pull request changes a High path and adds names that hold a line or paragraph separator. */
function buildSeparatorRepository() {
  const { repo, git, write } = initRepository();
  write('packages/agent-core/src/x.ts', 'export const x = 1;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const baseSha = git('rev-parse', 'HEAD').trim();

  write('packages/agent-core/src/x.ts', 'export const x = 2;\n');
  for (const name of SEPARATOR_SENSITIVE_NAMES) write(name, 'name: x\n');
  write(SEPARATOR_PLAIN_NAME, 'export const y = 1;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'change a High path, add names holding line terminators');
  const headSha = git('rev-parse', 'HEAD').trim();

  return { repo, git, baseSha, headSha };
}

/** A repository whose pull request moves a file and edits it, and adds a quoted name, one with a tab and one with a newline. */
function buildSliceRepository() {
  const { repo, git, write } = initRepository();
  const lines = (name, count) => Array.from({ length: count }, (_, index) => `${name} line ${index}\n`).join('');

  write('.github/workflows/ci.yml', lines('workflow', 12));
  write('packages/pkg/src/a.js', lines('a', 3));
  write('docs/guide.md', lines('guide', 4));
  write('docs/logo.bin', Buffer.from([0, 1, 2, 3]));
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const baseSha = git('rev-parse', 'HEAD').trim();

  fs.mkdirSync(path.join(repo, 'tools'), { recursive: true });
  git('mv', '.github/workflows/ci.yml', 'tools/ci.yml');
  write('tools/ci.yml', `${lines('workflow', 12)}one more line\n`); // a move AND an edit: git still pairs the two sides
  write('packages/pkg/src/a.js', `${lines('a', 3)}added\n`);
  write('docs/logo.bin', Buffer.from([0, 1, 2, 3, 4]));
  write('docs/a\tb.md', 'tab\n');
  write('docs/a\nb.md', 'newline\n');
  write('docs/q"uote.md', 'quote\n');
  write('docs/\u00e9.md', 'accent\n');
  write('docs/empty.txt', '');
  git('add', '-A');
  git('commit', '-q', '-m', 'move and edit a workflow, add awkward names');
  const headSha = git('rev-parse', 'HEAD').trim();

  return { repo, git, baseSha, headSha };
}

let fixture;
let separators;
let slicing;

// Three small real repositories, a few dozen git calls: far inside a minute, but a loaded CI box is slower than 5s.
beforeAll(() => {
  fixture = buildRepository();
  separators = buildSeparatorRepository();
  slicing = buildSliceRepository();
}, 60000);

afterAll(() => {
  for (const { repo } of [fixture, separators, slicing]) fs.rmSync(repo, { recursive: true, force: true });
});

/** The real tier chain over a changed-path list, with a "no" second assessment. */
function chainFor(changedPaths) {
  const declaration = { sourceSha: fixture.baseSha, sensitive: [], high: ['packages/agent-core/**'] };
  const paths = classifyPaths({ changedPaths, declaration, baseSha: fixture.baseSha });
  const assignment = assignTier({ paths, kinds: [{ kind: 'product', paths: changedPaths }], secondAssessment: NO_PEER });
  return { paths, assignment, effective: effectiveTier({ assignment, policy: SOLO_POLICY, author: 'maintainer-m' }) };
}

describe("git's default listing is lossy", () => {
  let lossy;

  beforeAll(() => {
    lossy = fixture.git('diff', '--name-only', fixture.baseSha, fixture.headSha).split('\n').filter((line) => line !== '');
  });

  test('it names the destination of a move and drops the sensitive path that was deleted', () => {
    expect(lossy).toEqual(expect.arrayContaining(['tools/ci.yml', 'docs/REVIEW.md', 'docs/OWNERS']));
    for (const deleted of ['.github/workflows/ci.yml', 'REVIEW.md', '.github/CODEOWNERS']) expect(lossy).not.toContain(deleted);
  });

  test('it quotes a name that holds a double quote, so the path it names is not the path on disk', () => {
    expect(lossy).toContain('".github/workflows/a\\"b.yml"');
    expect(lossy).not.toContain('.github/workflows/a"b.yml');
  });

  test('a list holding a quoted name is refused for the solo-maintainer discount', () => {
    const { assignment, effective } = chainFor(lossy);
    expect(assignment.warnings).toContain('non-verbatim-changed-path');
    expect(effective).toMatchObject({ effectiveTier: 'high', soloMaintainer: { eligible: false, login: null } });
  });
});

describe('the documented listing is rename-complete and verbatim', () => {
  let listed;

  beforeAll(() => {
    const out = fixture.git(...documentedListing(), fixture.baseSha, fixture.headSha);
    listed = out.split('\0');
    expect(listed.pop()).toBe(''); // the empty field after the last NUL
  });

  test('both sides of every move are listed, and no name is quoted', () => {
    expect([...listed].sort()).toEqual(
      [
        '.github/CODEOWNERS',
        '.github/workflows/a"b.yml',
        '.github/workflows/ci.yml',
        'REVIEW.md',
        'docs/OWNERS',
        'docs/REVIEW.md',
        'packages/agent-core/src/x.ts',
        'tools/ci.yml',
      ].sort()
    );
  });

  test('the sensitive paths that were moved away are sensitive again, and the discount is refused', () => {
    const { paths, assignment, effective } = chainFor(listed);
    expect(paths.sensitive).toEqual(
      expect.arrayContaining(['.github/workflows/ci.yml', '.github/workflows/a"b.yml', 'REVIEW.md', '.github/CODEOWNERS'])
    );
    expect(assignment.declarationChanged).toBe(true);
    expect(assignment.warnings).toEqual([]);
    expect(effective).toMatchObject({ effectiveTier: 'high', soloMaintainer: { eligible: false, login: null } });
  });
});

describe('the skill says exactly how changedPaths is produced', () => {
  test('Step 1b names the one command, NUL splitting and what each flag is for', () => {
    expect(documentedListing()).toEqual(['diff', '--name-only', '-z', '--no-renames']);
    expect(GUIDANCE).toContain('split on NUL with the empty field after the last NUL dropped');
    expect(GUIDANCE).toContain('`-z` makes git print every name verbatim');
    expect(GUIDANCE).toContain('`--no-renames` makes git list BOTH sides of a move');
  });

  test('the prose forbids every other source, and an empty list as a stand-in for a failed command', () => {
    expect(GUIDANCE).toContain("Never take the list from the host's own file listing");
    expect(GUIDANCE).toContain("from git's `--name-status` output, from a diff with renames detected");
    expect(GUIDANCE).toContain('never pass `[]` or a guess');
  });
});

describe('a name holding a line or paragraph separator is no escape from the sensitive floor (N-01)', () => {
  let listed;

  beforeAll(() => {
    const out = separators.git(...documentedListing(), separators.baseSha, separators.headSha);
    listed = out.split('\0');
    expect(listed.pop()).toBe(''); // the empty field after the last NUL
  });

  test('git prints these names raw under -z, so the documented command does not protect the list from them', () => {
    expect(listed).toEqual(
      expect.arrayContaining([...SEPARATOR_SENSITIVE_NAMES, SEPARATOR_PLAIN_NAME, 'packages/agent-core/src/x.ts'])
    );
    for (const name of listed) expect(name.startsWith('"')).toBe(false);
  });

  test('each of them is a sensitive path, and the High path they ride with stays High', () => {
    const { paths } = chainFor(listed);
    expect([...paths.sensitive].sort()).toEqual([...SEPARATOR_SENSITIVE_NAMES].sort());
    expect(paths.high).toEqual(expect.arrayContaining(['packages/agent-core/src/x.ts', SEPARATOR_PLAIN_NAME]));
  });

  test('the discount is refused: the list holds sensitive paths, and it is no verbatim list', () => {
    const { assignment, effective } = chainFor(listed);
    expect(assignment.sensitivePaths).toEqual(expect.arrayContaining(SEPARATOR_SENSITIVE_NAMES));
    expect(assignment.warnings).toContain('non-verbatim-changed-path');
    expect(assignment.changedPathsReadable).toBe(false);
    expect(effective).toMatchObject({ effectiveTier: 'high', soloMaintainer: { eligible: false, login: null } });
  });

  test('a name no sensitive pattern names is refused on its own: the list cannot vouch for it', () => {
    const { paths, assignment, effective } = chainFor(['packages/agent-core/src/x.ts', SEPARATOR_PLAIN_NAME]);
    expect(paths.sensitive).toEqual([]);
    expect(paths.high).toEqual(['packages/agent-core/src/x.ts', SEPARATOR_PLAIN_NAME]);
    expect(assignment.warnings).toContain('non-verbatim-changed-path');
    expect(effective).toMatchObject({ effectiveTier: 'high', soloMaintainer: { eligible: false, login: null } });
  });
});

describe("Step 1c's slices check: the listing git writes by default never covers the real paths (N-12)", () => {
  const AREAS = ['.github/workflows', 'tools', 'docs', 'packages/pkg'];

  test("git's default numstat writes a move as {old => new} and quotes a name, so no entry of it is a changed path", () => {
    const lossy = slicing.git('diff', '--numstat', slicing.baseSha, slicing.headSha).split('\n').filter((line) => line !== '');
    const names = lossy.map((line) => line.split('\t').slice(2).join('\t'));
    expect(names).toContain('{.github/workflows => tools}/ci.yml');
    expect(names).toContain('"docs/q\\"uote.md"');
    expect(names).not.toContain('.github/workflows/ci.yml');
    expect(names).not.toContain('tools/ci.yml');
  });

  test('a plan cut from it leaves the real paths uncovered after EVERY slice is reviewed: the instruction to review the missing slices cannot be met', () => {
    const lossy = slicing.git('diff', '--numstat', slicing.baseSha, slicing.headSha).split('\n').filter((line) => line !== '');
    const paths = lossy.map((line) => {
      const [added, deleted, ...name] = line.split('\t');
      const count = (field) => (field === '-' ? 0 : Number(field));
      return { path: name.join('\t'), lines: count(added) + count(deleted) };
    });
    const plan = planSlices({ paths, areas: AREAS, threshold: 1 });
    expect(plan.ok).toBe(true);

    const changedPaths = slicing
      .git(...documentedListing(), slicing.baseSha, slicing.headSha)
      .split('\0')
      .filter((name) => name !== '');
    // Every assigned reviewer (2 distinct lenses per slice) reported on its whole slice.
    const coverage = verifyCoverage({ slices: plan.slices, reviewedBy: reviewedByOf(plan), changedPaths });
    expect(coverage.covered).toBe(false);
    expect(coverage.unreviewedSlices).toEqual([]);
    expect(coverage.uncovered).toEqual(expect.arrayContaining(['.github/workflows/ci.yml', 'tools/ci.yml']));
  });
});

describe('the documented numstat is rename-free and verbatim: its plan is covered once every slice is reviewed (N-12)', () => {
  const AREAS = ['.github/workflows', 'tools', 'docs', 'packages/pkg'];
  let changedPaths;
  let paths;
  let plan;

  beforeAll(() => {
    const listing = slicing.git(...documentedListing(), slicing.baseSha, slicing.headSha);
    changedPaths = listing.split('\0');
    expect(changedPaths.pop()).toBe(''); // the empty field after the last NUL
    paths = parseNumstat(slicing.git(...documentedNumstat(), slicing.baseSha, slicing.headSha));
    plan = planSlices({ paths, areas: AREAS, threshold: 1 });
  });

  const linesOf = (name) => paths.find((entry) => entry.path === name).lines;

  test('it names exactly the paths of the documented name-only listing, each once, spelled the same', () => {
    expect(paths.map((entry) => entry.path).sort()).toEqual([...changedPaths].sort());
    expect(changedPaths).toEqual(
      expect.arrayContaining(['.github/workflows/ci.yml', 'tools/ci.yml', 'docs/a\tb.md', 'docs/a\nb.md', 'docs/q"uote.md', 'docs/\u00e9.md'])
    );
  });

  test('a move counts at both of its names, and a binary file and an empty file count 0', () => {
    expect(linesOf('.github/workflows/ci.yml')).toBe(12); // the old name: every line deleted
    expect(linesOf('tools/ci.yml')).toBe(13); // the new name: every line added
    expect(linesOf('packages/pkg/src/a.js')).toBe(1);
    expect(linesOf('docs/logo.bin')).toBe(0);
    expect(linesOf('docs/empty.txt')).toBe(0);
    expect(linesOf('docs/a\tb.md')).toBe(1);
  });

  test('every changed path sits in exactly one slice of the plan', () => {
    expect(plan).toMatchObject({ ok: true, sliced: true });
    for (const changed of changedPaths) {
      expect(plan.slices.filter((slice) => slice.paths.includes(changed))).toHaveLength(1);
    }
    expect(plan.slices.flatMap((slice) => slice.paths).sort()).toEqual([...changedPaths].sort());
  });

  test('with every slice reviewed the check answers covered, with nothing uncovered and no slice unreviewed', () => {
    const coverage = verifyCoverage({ slices: plan.slices, reviewedBy: reviewedByOf(plan), changedPaths });
    expect(coverage.underReviewed).toEqual([]);
    expect(coverage).toMatchObject({ ok: true, covered: true, uncovered: [], unreviewedSlices: [], unknownReviewed: [] });
  });

  test('a slice left unreviewed is named, and exactly its paths are uncovered', () => {
    const [left] = plan.slices;
    const reviewedBy = reviewedByOf(plan, plan.reviewerAssignments.filter((entry) => entry.sliceId !== left.id));
    const coverage = verifyCoverage({ slices: plan.slices, reviewedBy, changedPaths });
    expect(coverage.covered).toBe(false);
    expect(coverage.unreviewedSlices).toEqual([left.id]);
    expect([...coverage.uncovered].sort()).toEqual([...left.paths].sort());
  });
});

describe('the skill says exactly how the slices paths are produced (N-12)', () => {
  test('Step 1c names the one command, how a record is split and what a binary count is', () => {
    expect(documentedNumstat()).toEqual(['diff', '--numstat', '-z', '--no-renames']);
    expect(GUIDANCE).toContain('one entry for every entry of `changedPaths`, spelled exactly as it is spelled there');
    expect(GUIDANCE).toContain('split each record at its first two tabs only');
    expect(GUIDANCE).toContain('a binary file, which git counts as `-`, is 0');
  });

  test('the prose says what the default numstat gets wrong, and what an uncovered path with every slice reviewed means', () => {
    expect(GUIDANCE).toContain('Without `-z` git writes a move as `{old => new}` and quotes a name');
    expect(GUIDANCE).toContain('Never take `paths` from the host\'s own file listing or from a diff with renames detected');
    expect(GUIDANCE).toContain('An `uncovered` path with an empty `unreviewedSlices`');
  });
});
