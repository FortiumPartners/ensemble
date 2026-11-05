'use strict';

/**
 * TRD-007: this repository carries its OWN review files.
 *
 * Validates PRD ACs: AC-002-4 (the files exist here, not only in a template),
 * AC-003-1 (the sensitive paths an owner declares cover this repository's
 * workflows, release gates, installers, generation pipeline and constitution)
 * and AC-001-3 (the policy is data the loader reads, so editing REVIEW.md
 * changes the next review with no code change, rebuild or release).
 *
 * The policy block is graded by the real loader (`pr-review-policy.js`) and
 * the sensitive paths by the real classifier (`pr-review-paths.js`), so a typo
 * in REVIEW.md fails here rather than silently degrading a live review to the
 * strict defaults.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { loadPolicy } = require('../lib/pr-review-policy');
const { classifyPaths } = require('../lib/pr-review-paths');
const { checkDescription } = require('../lib/pr-review-description');

/** The template with every section body filled in, as an author would send it. */
const filled = (template) => template.replace(/^(## .*)$/gm, '$1\n\nfilled by the author.');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

const BASE_SHA = 'b'.repeat(40);

const read = (relative) => fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(REPO_ROOT, relative));

/** The repository's own policy, read as the review reads it: from a base commit, identified by the caller. */
function repoPolicy() {
  const text = read('REVIEW.md');
  expect(/```ensemble-review-policy\n([\s\S]*?)\n```/.exec(text)).not.toBeNull();
  return loadPolicy({ text, baseSha: BASE_SHA, sourceSha: BASE_SHA });
}

describe('this repository ships a root REVIEW.md (AC-002-4)', () => {
  test('REVIEW.md exists at the repository root', () => {
    expect(exists('REVIEW.md')).toBe(true);
  });

  test('its policy block declares no sourceSha: a commit cannot name itself, and a declared one is never the base', () => {
    const block = /```ensemble-review-policy\n([\s\S]*?)\n```/.exec(read('REVIEW.md'));
    expect(Object.prototype.hasOwnProperty.call(JSON.parse(block[1]), 'sourceSha')).toBe(false);
  });

  test('its policy block is accepted by the loader with nothing rejected', () => {
    const loaded = repoPolicy();
    expect(loaded.ok).toBe(true);
    expect(loaded.source).toBe('policy');
    expect(loaded.rejected).toEqual([]);
  });

  test('it declares maintainers, review bots and a round cap', () => {
    const { policy } = repoPolicy();
    expect(policy.maintainerLogins.length).toBeGreaterThan(0);
    expect(policy.botLogins).toContain('@coderabbitai');
    expect(policy.roundCap).toBeGreaterThanOrEqual(1);
    expect(policy.roundCap).toBeLessThanOrEqual(5);
  });

  test('it explains how area rules files are written (AC-001-3)', () => {
    const text = read('REVIEW.md');
    expect(text).toMatch(/`[^`]*\/REVIEW\.md`/);
    expect(text.toLowerCase()).toContain('area');
  });
});

/** The classification of `changedPaths` under this repository's own declared sensitive paths, read as a review reads it. */
const sensitiveFor = (changedPaths) => {
  const { policy } = repoPolicy();
  return classifyPaths({
    changedPaths,
    baseSha: BASE_SHA,
    declaration: { path: 'REVIEW.md', sourceSha: BASE_SHA, sensitive: policy.sensitivePaths },
  });
};

describe('the declared sensitive paths cover this repository (AC-003-1)', () => {
  test.each([
    ['a CI workflow', '.github/workflows/release.yml'],
    ['a release gate', 'scripts/validate-all.js'],
    ['an installer', 'scripts/install-codex-project.js'],
    ['the generation pipeline', 'scripts/generate-markdown.js'],
    ['a generation pipeline subtree file', 'scripts/generate-codex/index.js'],
    ['the constitution', 'docs/standards/constitution.md'],
    ['the review gate code', 'packages/development/lib/pr-review-gate.js'],
    ['a local-CI gate module', 'packages/development/lib/local-ci-runner.js'],
    ['the local-CI approval set', '.ensemble/local-ci.yaml'],
    ['a vendored copy of the review gate', 'packages/pi/vendor/lib/pr-review-gate.js'],
    ['a vendored copy of a local-CI gate module', 'packages/pi/vendor/lib/local-ci-status.js'],
    ['the merge-gate procedure', 'packages/development/skills/pr-review-cycle/reference/merge-gate.md'],
    ['the merge-gate procedure copy shipped for Pi', 'packages/pi/skills/pr-review-cycle/reference/merge-gate.md'],
    ['the changed-path procedure', 'packages/development/skills/pr-review-cycle/reference/scope-guidance-depth.md'],
    ['the changed-path procedure copy shipped for Pi', 'packages/pi/skills/pr-review-cycle/reference/scope-guidance-depth.md'],
    ['the pr-merge command source', 'packages/git/commands/pr-merge.yaml'],
  ])('%s is treated as sensitive', (_label, changedPath) => {
    const result = sensitiveFor([changedPath]);
    expect(result.ok).toBe(true);
    expect(result.sensitive).toContain(changedPath);
    expect(result.prSensitive).toBe(true);
  });

  test('an ordinary source file is not sensitive', () => {
    const result = sensitiveFor(['packages/development/lib/trd-parser.js']);
    expect(result.ok).toBe(true);
    expect(result.sensitive).toEqual([]);
    expect(result.prSensitive).toBe(false);
  });

  test('a vendored copy of an ordinary library is not sensitive: only the review and local-CI guards are', () => {
    const result = sensitiveFor(['packages/pi/vendor/lib/trd-parser.js']);
    expect(result.ok).toBe(true);
    expect(result.sensitive).toEqual([]);
    expect(result.prSensitive).toBe(false);
  });
});

/**
 * N-05, N-06: the review guards are declared by what they ARE, not by one spelling of one copy.
 *
 * REVIEW.md promises that a change to the review guards always keeps two humans, whatever
 * `soloMaintainer` says. A guard that is shadowed, replaced or copied under a name no declared glob matches
 * is High only through `highPaths`, touches no sensitive path and so takes the one-human discount. Every way
 * in is pinned here against the real policy block, and wherever the tree can be read against the real tree,
 * so a copy a generator starts to write cannot go unguarded unnoticed:
 *
 *   - Node resolves `require('./pr-review-gate')` to a file with NO extension before it tries `.js`, and the
 *     CLI requires its modules that way, so an extensionless sibling replaces the gate;
 *   - a case-insensitive checkout (macOS, Windows) writes `PR-REVIEW-GATE.JS` over `pr-review-gate.js`;
 *   - `packages/full/lib/*` and `packages/full/skills/pr-review-cycle` are git symlinks, so replacing or
 *     retargeting one is a change at a path of its own;
 *   - the generated copies of the `pr-merge` command are the text the runtimes load, and the pr-review-cycle
 *     skill is the procedure that decides what reaches the gate.
 */
describe('the review guards are sensitive under every name and copy that can shadow or ship them (N-05, N-06)', () => {
  const expectSensitive = (changedPaths) => {
    const result = sensitiveFor(changedPaths);
    expect(result.ok).toBe(true);
    expect(result.sensitive).toEqual(changedPaths);
    expect(result.prSensitive).toBe(true);
  };

  /** Every tracked path, as git lists it: NUL-delimited, so no name is quoted. */
  const tracked = () =>
    execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
      .split('\0')
      .filter((entry) => entry !== '');

  const LIB_DIRECTORIES = [
    'packages/development/lib',
    'packages/full/lib',
    'packages/pi/vendor/lib',
    'packages/codex/.codex/skills/vendor/lib',
  ];
  const MODULES = ['pr-review-gate', 'pr-review-tier', 'pr-review-cli', 'local-ci-runner', 'local-ci-status'];
  // `require('./name')` tries the bare name first, then `.js`, `.json` and `.node`; `.mjs` and `.cjs` cost a PR
  // nothing to add, so they are declared too.
  const SPELLINGS = ['', '.js', '.mjs', '.cjs', '.json', '.node', '.JS', '.Js'];

  test.each(LIB_DIRECTORIES)('a guard module under %s is sensitive with any extension, or none', (directory) => {
    expectSensitive(MODULES.flatMap((name) => SPELLINGS.map((suffix) => `${directory}/${name}${suffix}`)));
  });

  test.each([
    'packages/development/lib/PR-REVIEW-GATE.JS',
    'packages/development/lib/pr-review-gate.JS',
    'packages/development/lib/PR-review-gate.js',
    'packages/development/lib/Local-CI-Runner.js',
    'packages/Development/LIB/pr-review-gate.js',
    'PACKAGES/PI/VENDOR/LIB/pr-review-gate.js',
    'packages/development/skills/PR-REVIEW-CYCLE/SKILL.md',
    'packages/git/commands/ensemble/PR-MERGE.md',
    'packages/git/commands/PR-MERGE.YAML',
    'Scripts/CI-Local.js',
    '.ENSEMBLE/LOCAL-CI.YAML',
  ])('%s is sensitive: a case-insensitive checkout writes it over the guard', (changedPath) => {
    expectSensitive([changedPath]);
  });

  test.each([
    ['a full-bundle gate module (a link) replaced by a regular file', 'packages/full/lib/pr-review-gate.js'],
    ['a full-bundle local-CI module (a link) replaced by a regular file', 'packages/full/lib/local-ci-runner.js'],
    ['the full-bundle link to the review procedure, replaced or retargeted', 'packages/full/skills/pr-review-cycle'],
    ['a file under that link once it is a real directory', 'packages/full/skills/pr-review-cycle/reference/inputs.md'],
    ['the full-bundle link to the git commands, replaced or retargeted', 'packages/full/commands/git'],
    ['a pr-merge command under that link once it is a real directory', 'packages/full/commands/git/pr-merge.md'],
  ])('%s: %s is sensitive', (_label, changedPath) => {
    expectSensitive([changedPath]);
  });

  test.each([
    ['the review procedure', 'packages/development/skills/pr-review-cycle/SKILL.md'],
    ['the review procedure copy shipped for Pi', 'packages/pi/skills/pr-review-cycle/SKILL.md'],
    ['the definition of how the author and the director reach the gate', 'packages/development/skills/pr-review-cycle/reference/inputs.md'],
    ['that definition as shipped for Pi', 'packages/pi/skills/pr-review-cycle/reference/inputs.md'],
    ['the remote phase procedure', 'packages/development/skills/pr-review-cycle/reference/remote-phase.md'],
    ['the remote phase procedure as shipped for Pi', 'packages/pi/skills/pr-review-cycle/reference/remote-phase.md'],
    ['the status and state procedure', 'packages/development/skills/pr-review-cycle/reference/status-and-state.md'],
    ['the status and state procedure as shipped for Pi', 'packages/pi/skills/pr-review-cycle/reference/status-and-state.md'],
    ['a procedure file the skill gains later', 'packages/development/skills/pr-review-cycle/reference/next-step.md'],
  ])('%s: %s is sensitive', (_label, changedPath) => {
    expectSensitive([changedPath]);
  });

  test.each([
    ['the Claude command generated from pr-merge.yaml', 'packages/git/commands/ensemble/pr-merge.md'],
    ['the Pi prompt generated from it', 'packages/pi/prompts/ensemble-pr-merge.md'],
    ['the Pi skill generated from it', 'packages/pi/skills/ensemble-pr-merge/SKILL.md'],
    ['the Codex skill generated from it', 'packages/codex/.codex/skills/commands/ensemble-pr-merge/SKILL.md'],
    ['the local CI runner script the approval set mirrors', 'scripts/ci-local.js'],
  ])('%s: %s is sensitive', (_label, changedPath) => {
    expectSensitive([changedPath]);
  });

  test('every review or local-CI module in any lib directory of the tree is sensitive, whichever package carries it', () => {
    const modules = tracked().filter((entry) => /^packages\/.+\/lib\/(pr-review|local-ci)-[^/]*$/.test(entry));
    // The development library, the full bundle's links and the Pi vendor copy: a tree that lost them would pass vacuously.
    expect(modules.filter((entry) => entry.startsWith('packages/development/lib/')).length).toBeGreaterThan(20);
    expect(modules.some((entry) => entry.startsWith('packages/full/lib/'))).toBe(true);
    expect(modules.some((entry) => entry.startsWith('packages/pi/vendor/lib/'))).toBe(true);
    expectSensitive(modules);
  });

  test('every file of the pr-review-cycle skill, and every link to it, is sensitive', () => {
    const entries = tracked().filter((entry) => /^packages\/[^/]+\/skills\/pr-review-cycle(\/|$)/.test(entry));
    expect(entries).toEqual(
      expect.arrayContaining([
        'packages/development/skills/pr-review-cycle/SKILL.md',
        'packages/development/skills/pr-review-cycle/reference/inputs.md',
        'packages/pi/skills/pr-review-cycle/SKILL.md',
        'packages/full/skills/pr-review-cycle',
      ])
    );
    expectSensitive(entries);
  });

  test('every copy of the pr-merge command the generators write is sensitive', () => {
    const copies = tracked().filter((entry) => /^packages\/(.*\/)?(ensemble-)?pr-merge(\.md|\.yaml|\/SKILL\.md)$/.test(entry));
    expect(copies).toEqual(
      expect.arrayContaining([
        'packages/git/commands/pr-merge.yaml',
        'packages/git/commands/ensemble/pr-merge.md',
        'packages/pi/prompts/ensemble-pr-merge.md',
        'packages/pi/skills/ensemble-pr-merge/SKILL.md',
        'packages/codex/.codex/skills/commands/ensemble-pr-merge/SKILL.md',
      ])
    );
    expectSensitive(copies);
  });

  test.each([
    'packages/development/lib/trd-parser.js',
    'packages/full/lib/trd-parser.js',
    'packages/pi/vendor/lib/trd-parser.js',
  ])('%s, an ordinary library, is not sensitive: the guards are named, never the whole lib directory', (changedPath) => {
    const result = sensitiveFor([changedPath]);
    expect(result.ok).toBe(true);
    expect(result.sensitive).toEqual([]);
    expect(result.prSensitive).toBe(false);
  });

  test('letter case is loosened for a path, never for a bare file name: a page named review.md is no REVIEW.md', () => {
    expect(exists('docs/toolchain/contracts/review.md')).toBe(true); // a real tracked page about review toolchains
    const result = sensitiveFor(['docs/toolchain/contracts/review.md', 'packages/development/REVIEW.md']);
    expect(result.sensitive).toEqual(['packages/development/REVIEW.md']);
  });
});

describe('this repository ships a PR template and an ownership declaration', () => {
  test('the PR template asks for Testing, Risk and How to revert', () => {
    expect(exists('.github/pull_request_template.md')).toBe(true);
    const template = read('.github/pull_request_template.md');
    expect(template).toContain('## Testing');
    expect(template).toContain('## Risk');
    expect(template).toContain('## How to revert');
  });

  test('the real description checker recognises every section of the template', () => {
    const template = read('.github/pull_request_template.md');

    // Unfilled, the template is NOT a description: headings are not content.
    const empty = checkDescription({ body: template, agentAuthored: false });
    expect(empty.ready).toBe(false);
    expect(empty.missing).toEqual(['testing', 'risk', 'how-to-revert']);

    // Filled in, the same headings satisfy the checker: the template's
    // spelling matches the section labels the checker accepts.
    const answered = checkDescription({ body: filled(template), agentAuthored: false });
    expect(answered.ready).toBe(true);
    expect(answered.missing).toEqual([]);
  });

  test('CODEOWNERS exists and every entry names a path and an owner', () => {
    expect(exists('.github/CODEOWNERS')).toBe(true);
    const entries = read('.github/CODEOWNERS')
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      const [pattern, ...owners] = entry.trim().split(/\s+/);
      expect(pattern.length).toBeGreaterThan(0);
      expect(owners.length).toBeGreaterThan(0);
      for (const owner of owners) {
        expect(owner).toMatch(/^@[A-Za-z0-9][A-Za-z0-9-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/);
      }
    }
  });
});
