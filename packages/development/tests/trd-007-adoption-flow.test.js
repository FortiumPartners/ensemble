'use strict';

/**
 * TRD-007-TEST: Scaffolding adoption flow (PRD scenarios).
 *
 * Validates PRD ACs: AC-002-4, AC-003-1, AC-001-3 (REQ-001, REQ-002, REQ-003).
 *
 * These are the PRD-level scenarios for TRD-007 -- "an adopting team runs the
 * project init flow" -- run the way an adopting team actually lives them:
 *
 *   - the scaffolded files are the SHIPPED templates, lifted out of
 *     `packages/core/commands/ensemble/init-project.md`, never a copy kept
 *     in this test. A template that drifts fails here;
 *   - they are written into a REAL git repository created per test, and the
 *     team's later edits are real commits;
 *   - every review resolves its guidance the way
 *     `skills/pr-review-cycle/SKILL.md` Step 1b documents: the rules files
 *     are listed at the base commit with `git ls-tree`, their text is read
 *     with `git show <baseSha>:<path>` (never the working tree, never the PR
 *     head), and each answer comes from a FRESH `node pr-review-cli.js`
 *     process. Nothing under test is mocked or re-implemented here;
 *   - this package has no build step, and the bytes of `lib/` are hashed
 *     before and after every maintainer edit, so "no code change, rebuild or
 *     release" is a checked property rather than a claim.
 *
 * Scenarios:
 *   - AC-002-4: the init flow leaves the PR template, the review rules file
 *     and the ownership declaration in the adopting repository, and each one
 *     is accepted by the real checker that will grade it.
 *   - AC-003-1: a path an owner declares sensitive in the scaffolded
 *     REVIEW.md is treated as sensitive by everything that consults
 *     sensitivity -- the library, the CLI, the declaration the skill builds
 *     -- and a PR cannot talk its way out of it by editing its own copy.
 *   - AC-001-3: a maintainer edits the rules file; the next review reflects
 *     the edit, while a review of the older base still sees the older rules.
 *
 * Each scenario carries a negative control, so an implementation that
 * answered "sensitive" (or "not sensitive") to everything would fail here.
 *
 * One property of the shipped policy loader is worth stating: the policy
 * block's identity is the commit the caller read it from. The caller passes
 * `sourceSha` = `baseSha`, and a block never declares a `sourceSha` of its
 * own (a commit cannot name itself). A text read from any other commit gets
 * the strict defaults, which is the safe direction.
 */

const crypto = require('crypto');
const { readSkillBundle } = require('./helpers/pr-review-cycle-skill');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const DEV_ROOT = path.join(__dirname, '..');
const LIB_DIR = path.join(DEV_ROOT, 'lib');
const CLI = path.join(LIB_DIR, 'pr-review-cli.js');
const SKILL_PATH = path.join(DEV_ROOT, 'skills', 'pr-review-cycle', 'SKILL.md');
const INIT_PROJECT_PATH = path.join(
  DEV_ROOT, '..', 'core', 'commands', 'ensemble', 'init-project.md',
);

const INIT_PROJECT = fs.readFileSync(INIT_PROJECT_PATH, 'utf8');
const SCAFFOLD_HEADING = '### Step 6: Scaffold Review Files';

const { DEFAULT_POLICY } = require('../lib/pr-review-policy');
const { DEFAULT_SENSITIVE_PATHS } = require('../lib/pr-review-paths');
const { classifyPaths } = require('../lib/pr-review-paths');

// ---------------------------------------------------------------------------
// The shipped templates (read out of the command source, not copied here)
// ---------------------------------------------------------------------------

/** The first fenced block after `fromIndex`, honouring fences of three OR MORE backticks. */
function fencedBlockAfter(fromIndex, language) {
  const lines = INIT_PROJECT.slice(fromIndex).split('\n');
  const open = new RegExp(`^(\`{3,})${language}\\s*$`);
  let fence = null;
  const body = [];

  for (const line of lines) {
    if (fence === null) {
      const match = open.exec(line);
      if (match) fence = match[1];
      continue;
    }
    if (line.trim() === fence) return body.join('\n');
    body.push(line);
  }
  return null;
}

/** The template the scaffold step writes to `filePath`. */
function shippedTemplate(filePath, language) {
  const step = INIT_PROJECT.indexOf(SCAFFOLD_HEADING);
  if (step === -1) throw new Error(`init-project.md has no "${SCAFFOLD_HEADING}"`);
  const label = INIT_PROJECT.indexOf(filePath, step);
  if (label === -1) throw new Error(`the scaffold step never names ${filePath}`);
  const body = fencedBlockAfter(label, language);
  if (body === null) throw new Error(`no ${language} template follows ${filePath}`);
  return `${body}\n`;
}

/** The three targets of the scaffold step, in the order the command lists them. */
const TARGETS = Object.freeze([
  { path: '.github/pull_request_template.md', language: 'markdown' },
  { path: 'REVIEW.md', language: 'markdown' },
  { path: '.github/CODEOWNERS', language: 'text' },
]);

const templateFor = (target) => shippedTemplate(target.path, target.language);

// ---------------------------------------------------------------------------
// The adopting team's repository
// ---------------------------------------------------------------------------

function git(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

/** A real, empty git repository with one commit, as an adopting team would have. */
function adoptingRepo() {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trd-007-adoption-')));
  git(repo, ['init', '--quiet', '--initial-branch=main']);
  git(repo, ['config', 'user.email', 'team@example.test']);
  git(repo, ['config', 'user.name', 'Adopting Team']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  writeFile(repo, 'src/app.js', '// the team\'s own code\n');
  writeFile(repo, 'services/billing/charge.js', '// money moves here\n');
  writeFile(repo, '.github/workflows/release.yml', 'name: release\n');
  return commitAll(repo, 'initial commit').repo;
}

function writeFile(repo, relative, contents) {
  const target = path.join(repo, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return target;
}

const readFile = (repo, relative) => fs.readFileSync(path.join(repo, relative), 'utf8');
const exists = (repo, relative) => fs.existsSync(path.join(repo, relative));

/** Commits everything in the worktree and returns `{ repo, sha }`. */
function commitAll(repo, message) {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '--no-verify', '-m', message]);
  return { repo, sha: git(repo, ['rev-parse', 'HEAD']).trim() };
}

/**
 * The init flow's Step 6, performed exactly as the shipped command states it:
 * write the template when the file does not exist; when it does and force was
 * not requested, report the difference and leave every line the user wrote
 * alone; replace only on force.
 *
 * @returns {{created:string[], skipped:string[], replaced:string[], differences:Object}}
 */
function runInitProjectScaffolding(repo, { force = false } = {}) {
  const report = { created: [], skipped: [], replaced: [], differences: {} };

  for (const target of TARGETS) {
    const template = templateFor(target);
    if (!exists(repo, target.path)) {
      writeFile(repo, target.path, template);
      report.created.push(target.path);
      continue;
    }

    const existing = readFile(repo, target.path);
    report.differences[target.path] = existing === template ? '' : 'differs from template';
    if (force) {
      writeFile(repo, target.path, template);
      report.replaced.push(target.path);
    } else {
      report.skipped.push(target.path);
    }
  }

  return report;
}

// ---------------------------------------------------------------------------
// One review, resolving its guidance from the base commit (SKILL.md Step 1b)
// ---------------------------------------------------------------------------

const POLICY_BLOCK = /```ensemble-review-policy\n([\s\S]*?)\n```/;

/** The policy object a REVIEW.md text declares. */
function policyBlockOf(text) {
  const match = POLICY_BLOCK.exec(text);
  if (match === null) throw new Error('REVIEW.md carries no ensemble-review-policy block');
  return JSON.parse(match[1]);
}

/** Rewrites the policy block of a REVIEW.md text with `policy`. */
function withPolicyBlock(text, policy) {
  return text.replace(POLICY_BLOCK, `\`\`\`ensemble-review-policy\n${JSON.stringify(policy, null, 2)}\n\`\`\``);
}

/** One CLI call: a fresh process, one JSON payload in, one JSON object out. */
function cli(subcommand, payload) {
  const res = spawnSync('node', [CLI, subcommand], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
  expect(res.stderr).toBe('');
  expect(res.status).toBe(0);
  return JSON.parse(res.stdout);
}

/** `git show <sha>:<path>`, or null when the file does not exist there. */
function showAt(repo, sha, relative) {
  const res = spawnSync('git', ['show', `${sha}:${relative}`], { cwd: repo, encoding: 'utf8' });
  return res.status === 0 ? res.stdout : null;
}

/** Every rules file present at `sha`, as the skill lists them. */
function ruleFilesAt(repo, sha, rulesFileName = 'REVIEW.md') {
  return git(repo, ['ls-tree', '-r', '--name-only', sha])
    .split('\n')
    .filter((line) => line.trim() !== '' && path.basename(line) === rulesFileName);
}

/**
 * Resolves the guidance for one review of `changedPaths` against `baseSha`,
 * running the real CLI in the documented order (policy, then rules, then
 * paths -- `paths` consumes what `policy` returned -- then description).
 * The policy text is read from the base commit and the caller names that
 * commit as `sourceSha`, exactly as the skill does.
 */
function reviewAt(repo, baseSha, { changedPaths, body, agentAuthored = false } = {}) {
  const rulesFileName = 'REVIEW.md';
  const rootText = showAt(repo, baseSha, rulesFileName);
  const codeowners = showAt(repo, baseSha, '.github/CODEOWNERS');
  const text = rootText;

  const policy = cli('policy', { text, baseSha, sourceSha: baseSha });
  const rules = cli('rules', {
    changedPaths,
    ruleFiles: ruleFilesAt(repo, baseSha, rulesFileName),
    rulesFileName,
    baseSha,
    sourceSha: baseSha,
  });
  const declaration = {
    sourceSha: baseSha,
    sensitive: policy.policy.sensitivePaths,
    high: policy.policy.highPaths,
  };
  const paths = cli('paths', {
    changedPaths,
    declaration,
    codeowners: codeowners === null ? undefined : codeowners,
    baseSha,
  });
  const description = body === undefined
    ? undefined
    : cli('description', { body, agentAuthored });

  return { policy, rules, paths, description, declaration, rootText };
}

/** The sha256 of every shipped library file: the code a review runs. */
function libDigest() {
  const hash = crypto.createHash('sha256');
  // lib/ now also holds sub-directories (lib/toolchain/ ...): digest every file in them too.
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))) {
      const rel = prefix + entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel + '/');
      else hash.update(rel).update(fs.readFileSync(path.join(dir, entry.name)));
    }
  };
  walk(LIB_DIR, '');
  return hash.digest('hex');
}

/** The template with every section answered, as an author would send it. */
const filled = (template) => template.replace(/^(## .*)$/gm, '$1\n\nfilled by the author.');

// ---------------------------------------------------------------------------
// AC-002-4 -- the init flow scaffolds the three files into the repository
// ---------------------------------------------------------------------------

describe('AC-002-4: the project init flow scaffolds the review files', () => {
  test('a repository without them receives all three, and nothing else is claimed', () => {
    const repo = adoptingRepo();

    for (const target of TARGETS) expect(exists(repo, target.path)).toBe(false);

    const report = runInitProjectScaffolding(repo);

    expect(report.created).toEqual([
      '.github/pull_request_template.md',
      'REVIEW.md',
      '.github/CODEOWNERS',
    ]);
    expect(report.skipped).toEqual([]);
    expect(report.replaced).toEqual([]);

    // They are real files in the team's repository, and they commit.
    const { sha } = commitAll(repo, 'chore: adopt ensemble review files');
    for (const target of TARGETS) {
      expect(exists(repo, target.path)).toBe(true);
      expect(showAt(repo, sha, target.path)).toBe(readFile(repo, target.path));
    }

    // The completion report the command prints names the same three files.
    const completion = INIT_PROJECT.slice(INIT_PROJECT.indexOf('### Step 7: Completion Report'));
    for (const target of TARGETS) expect(completion).toContain(target.path);
  });

  test('the scaffolded PR template is graded ready only once it is answered', () => {
    const repo = adoptingRepo();
    runInitProjectScaffolding(repo);
    const { sha } = commitAll(repo, 'chore: adopt ensemble review files');

    const template = showAt(repo, sha, '.github/pull_request_template.md');
    expect(template).toContain('## Testing');
    expect(template).toContain('## Risk');
    expect(template).toContain('## How to revert');

    // Negative control: the scaffolded template as-is is not a description.
    const unanswered = reviewAt(repo, sha, { changedPaths: ['src/app.js'], body: template });
    expect(unanswered.description.ready).toBe(false);
    expect(unanswered.description.missing).toEqual(['testing', 'risk', 'how-to-revert']);

    // Answered, the same headings pass the gate the team will meet.
    const answered = reviewAt(repo, sha, { changedPaths: ['src/app.js'], body: filled(template) });
    expect(answered.description.ready).toBe(true);
    expect(answered.description.missing).toEqual([]);

    // An agent-authored body must still name the accountable human.
    const byAgent = reviewAt(repo, sha, {
      changedPaths: ['src/app.js'],
      body: filled(template),
      agentAuthored: true,
    });
    expect(byAgent.description.ready).toBe(false);
    expect(byAgent.description.missing).toContain('directed-by');
  });

  test('the scaffolded rules file loads as policy, not as the strict defaults', () => {
    const repo = adoptingRepo();
    runInitProjectScaffolding(repo);
    const { sha } = commitAll(repo, 'chore: adopt ensemble review files');

    const review = reviewAt(repo, sha, { changedPaths: ['src/app.js'] });
    expect(review.policy.ok).toBe(true);
    expect(review.policy.source).toBe('policy');
    expect(review.policy.rejected).toEqual([]);
    expect(review.policy.warnings).toEqual([]);
    expect(review.policy.policy.roundCap).toBe(3);

    // The rules file is found at the base commit and governs the change.
    expect(review.rules.ok).toBe(true);
    expect(review.rules.rootFile).toBe('REVIEW.md');
    expect(review.rules.applied).toEqual(['REVIEW.md']);
  });

  test('the scaffolded ownership declaration names an owner for the team\'s files', () => {
    const repo = adoptingRepo();
    runInitProjectScaffolding(repo);
    const { sha } = commitAll(repo, 'chore: adopt ensemble review files');

    const review = reviewAt(repo, sha, {
      changedPaths: ['src/app.js', '.github/workflows/release.yml'],
    });
    expect(review.paths.ok).toBe(true);
    expect(review.paths.ownersMalformed).toEqual([]);

    const owners = Object.fromEntries(review.paths.paths.map((p) => [p.path, p.owners]));
    expect(owners['src/app.js'].length).toBeGreaterThan(0);
    // The narrower workflow entry in the template overrides the default owner.
    expect(owners['.github/workflows/release.yml'].length).toBeGreaterThan(0);
    expect(owners['.github/workflows/release.yml']).not.toEqual(owners['src/app.js']);
  });

  test('a second run never overwrites what the team wrote; force replaces it', () => {
    const repo = adoptingRepo();
    runInitProjectScaffolding(repo);
    commitAll(repo, 'chore: adopt ensemble review files');

    // The team makes the files their own.
    const edited = `${readFile(repo, 'REVIEW.md')}\n## Our own rule\n\nNo raw SQL in handlers.\n`;
    writeFile(repo, 'REVIEW.md', edited);
    writeFile(repo, '.github/CODEOWNERS', '* @acme/platform\n');
    commitAll(repo, 'docs: tune our review rules');

    const second = runInitProjectScaffolding(repo);
    expect(second.created).toEqual([]);
    expect(second.replaced).toEqual([]);
    expect(second.skipped).toEqual(TARGETS.map((target) => target.path));
    expect(second.differences['REVIEW.md']).toBe('differs from template');
    expect(readFile(repo, 'REVIEW.md')).toBe(edited);
    expect(readFile(repo, 'REVIEW.md')).toContain('No raw SQL in handlers.');
    expect(readFile(repo, '.github/CODEOWNERS')).toBe('* @acme/platform\n');

    // Force is the only path that replaces a file, and it is not the default.
    const forced = runInitProjectScaffolding(repo, { force: true });
    expect(forced.replaced).toEqual(TARGETS.map((target) => target.path));
    expect(readFile(repo, 'REVIEW.md')).not.toContain('No raw SQL in handlers.');
    expect(readFile(repo, 'REVIEW.md')).toBe(templateFor(TARGETS[1]));
  });
});

// ---------------------------------------------------------------------------
// AC-003-1 -- an owner declares a path sensitive; everything that consults
// sensitivity treats a PR touching it as sensitive
// ---------------------------------------------------------------------------

describe('AC-003-1: an owner-declared sensitive path is sensitive everywhere', () => {
  /** An adopting repo whose owner has declared `services/billing/**` sensitive. */
  function repoWithDeclaration() {
    const repo = adoptingRepo();
    runInitProjectScaffolding(repo);
    const text = readFile(repo, 'REVIEW.md');
    const policy = policyBlockOf(text);
    writeFile(repo, 'REVIEW.md', withPolicyBlock(text, {
      ...policy,
      sensitivePaths: ['services/billing/**'],
      maintainerLogins: ['@acme-owner'],
    }));
    return commitAll(repo, 'chore: declare billing sensitive');
  }

  test('a PR touching the declared path is sensitive, and names what matched', () => {
    const { repo, sha } = repoWithDeclaration();

    const review = reviewAt(repo, sha, {
      changedPaths: ['services/billing/charge.js', 'src/app.js'],
    });

    // The declaration reaches the classifier through the policy block.
    expect(review.policy.policy.sensitivePaths).toEqual(['services/billing/**']);
    expect(review.paths.ok).toBe(true);
    expect(review.paths.declarationSource).toBe('declaration');
    expect(review.paths.prSensitive).toBe(true);
    expect(review.paths.sensitive).toEqual(['services/billing/charge.js']);

    const detail = Object.fromEntries(review.paths.paths.map((p) => [p.path, p]));
    expect(detail['services/billing/charge.js'].sensitive).toBe(true);
    expect(detail['services/billing/charge.js'].matchedBy).toBe('services/billing/**');
    expect(detail['services/billing/charge.js'].source).toBe('declaration');

    // Negative control: an undeclared path in the same PR is NOT sensitive,
    // so "sensitive" is a decision and not a constant.
    expect(detail['src/app.js'].sensitive).toBe(false);
    expect(detail['src/app.js'].matchedBy).toBeNull();

    // And with no declaration at all, the same path is not sensitive either.
    const plain = adoptingRepo();
    runInitProjectScaffolding(plain);
    const plainSha = commitAll(plain, 'chore: adopt ensemble review files').sha;
    const before = reviewAt(plain, plainSha, { changedPaths: ['services/billing/charge.js'] });
    expect(before.paths.prSensitive).toBe(false);
  });

  test('every consumer of sensitivity gets the same answer from the same declaration', () => {
    const { repo, sha } = repoWithDeclaration();
    const changedPaths = ['services/billing/charge.js'];

    const review = reviewAt(repo, sha, { changedPaths });

    // 1. The declaration the skill documents building is the one used here.
    const skill = readSkillBundle().replace(/\s+/g, ' ');
    expect(skill).toContain('`declaration` is `{ sourceSha: <baseSha>, sensitive: <policy.sensitivePaths>, high: <policy.highPaths> }`');
    expect(review.declaration).toEqual({
      sourceSha: sha,
      sensitive: review.policy.policy.sensitivePaths,
      high: review.policy.policy.highPaths,
    });

    // 2. The CLI subcommand every caller reaches and the library a caller may
    //    require in process agree byte for byte -- no second opinion exists.
    const inProcess = classifyPaths({
      changedPaths,
      declaration: review.declaration,
      codeowners: showAt(repo, sha, '.github/CODEOWNERS'),
      baseSha: sha,
    });
    expect(review.paths).toEqual(inProcess);

    // 3. A second review of the same base, in another process, is identical:
    //    sensitivity is not stateful.
    expect(reviewAt(repo, sha, { changedPaths }).paths).toEqual(review.paths);
  });

  test('the declaration adds to the built-in floor and can never shrink it', () => {
    const { repo, sha } = repoWithDeclaration();

    const review = reviewAt(repo, sha, {
      changedPaths: ['.github/workflows/release.yml', 'services/billing/charge.js'],
    });

    const detail = Object.fromEntries(review.paths.paths.map((p) => [p.path, p]));
    // The owner's list never mentions workflows, yet they stay sensitive.
    expect(review.policy.policy.sensitivePaths).not.toContain('.github/workflows/**');
    expect(detail['.github/workflows/release.yml'].sensitive).toBe(true);
    expect(detail['.github/workflows/release.yml'].source).toBe('default');
    expect(DEFAULT_SENSITIVE_PATHS).toContain(detail['.github/workflows/release.yml'].matchedBy);
    expect(review.paths.prSensitive).toBe(true);
  });

  test('a PR cannot un-declare its own sensitivity by editing its copy', () => {
    const { repo, sha: baseSha } = repoWithDeclaration();

    // The PR head removes the declaration and touches the declared area.
    git(repo, ['checkout', '--quiet', '-b', 'pr/relax-review']);
    const headText = withPolicyBlock(readFile(repo, 'REVIEW.md'), {
      ...policyBlockOf(readFile(repo, 'REVIEW.md')),
      sensitivePaths: [],
    });
    writeFile(repo, 'REVIEW.md', headText);
    writeFile(repo, 'services/billing/charge.js', '// money moves differently now\n');
    commitAll(repo, 'chore: relax review');

    // Guidance is resolved from the base commit, so the head's copy is data.
    const review = reviewAt(repo, baseSha, {
      changedPaths: ['services/billing/charge.js', 'REVIEW.md'],
    });
    expect(review.rootText).toContain('services/billing/**');
    expect(review.policy.policy.sensitivePaths).toEqual(['services/billing/**']);
    expect(review.paths.prSensitive).toBe(true);
    expect(review.paths.sensitive).toEqual(['services/billing/charge.js', 'REVIEW.md']);

    // Touching the declaration file is itself sensitive, and reported as such.
    const detail = Object.fromEntries(review.paths.paths.map((p) => [p.path, p]));
    expect(detail['REVIEW.md'].declarationFile).toBe(true);
    expect(review.paths.declarationChanged).toBe(true);

    // Reviewing the head's own copy instead would be the relaxed answer the
    // base-commit rule exists to prevent: the caller names the commit it read
    // the text from, and the head commit is not the base.
    const headSha = git(repo, ['rev-parse', 'HEAD']).trim();
    const headPolicy = cli('policy', { text: headText, baseSha, sourceSha: headSha });
    expect(headPolicy.ok).toBe(false);
    expect(headPolicy.reason).toBe('policy-not-from-base');
  });

  test('text read from a commit other than the base falls back to the strict defaults, never to a relaxed policy', () => {
    const { repo, sha } = repoWithDeclaration();

    // The caller read the policy text from another commit than the review's base.
    const otherCommit = 'f'.repeat(40);
    const rootText = showAt(repo, sha, 'REVIEW.md');
    const stale = cli('policy', { text: rootText, baseSha: sha, sourceSha: otherCommit });
    expect(stale.ok).toBe(false);
    expect(stale.reason).toBe('policy-not-from-base');
    expect(stale.policy).toEqual(DEFAULT_POLICY);
    expect(stale.policy.sensitivePaths).toEqual([]);

    // The fallback is the cautious one: the built-in floor still applies.
    const floor = cli('paths', {
      changedPaths: ['.github/workflows/release.yml'],
      declaration: { sourceSha: sha, sensitive: stale.policy.sensitivePaths, high: stale.policy.highPaths },
      baseSha: sha,
    });
    expect(floor.prSensitive).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-001-3 -- editing the rules file changes the next review, with no code
// change, rebuild or release
// ---------------------------------------------------------------------------

describe('AC-001-3: editing the scaffolded rules file changes the next review', () => {
  test('the next review reflects the edit; the older base still sees the older rules', () => {
    const repo = adoptingRepo();
    runInitProjectScaffolding(repo);
    const before = commitAll(repo, 'chore: adopt ensemble review files').sha;

    const codeBefore = libDigest();

    const firstReview = reviewAt(repo, before, {
      changedPaths: ['services/billing/charge.js'],
    });
    expect(firstReview.policy.policy.roundCap).toBe(3);
    expect(firstReview.paths.prSensitive).toBe(false);
    expect(firstReview.rules.applied).toEqual(['REVIEW.md']);
    expect(firstReview.rules.multiArea).toBe(false);

    // A maintainer edits the rules file, and only the rules files: no code,
    // no build, no release.
    const text = readFile(repo, 'REVIEW.md');
    writeFile(repo, 'REVIEW.md', withPolicyBlock(
      text.replace(
        '## What every review checks',
        '## What every review checks\n\n- Money paths carry an audit log entry.',
      ),
      { ...policyBlockOf(text), roundCap: 5, sensitivePaths: ['services/billing/**'] },
    ));
    writeFile(repo, 'services/billing/REVIEW.md', '# Billing review rules\n\nEvery charge path is reviewed by two people.\n');
    const after = commitAll(repo, 'docs: tune the review rules').sha;

    const changed = git(repo, ['diff', '--name-only', `${before}..${after}`])
      .split('\n')
      .filter((line) => line.trim() !== '');
    expect(changed.sort()).toEqual(['REVIEW.md', 'services/billing/REVIEW.md']);

    const secondReview = reviewAt(repo, after, {
      changedPaths: ['services/billing/charge.js'],
    });

    // The next review reflects every part of the edit.
    expect(secondReview.policy.ok).toBe(true);
    expect(secondReview.policy.policy.roundCap).toBe(5);
    expect(secondReview.paths.prSensitive).toBe(true);
    expect(secondReview.paths.sensitive).toEqual(['services/billing/charge.js']);
    expect(secondReview.rules.applied).toEqual(['REVIEW.md', 'services/billing/REVIEW.md']);
    expect(secondReview.rootText).toContain('Money paths carry an audit log entry.');

    // Nothing in the shipped code changed, and no build or install ran: the
    // same bytes produced both answers.
    expect(libDigest()).toBe(codeBefore);
    expect(fs.existsSync(path.join(DEV_ROOT, 'dist'))).toBe(false);
    expect(require(path.join(DEV_ROOT, 'package.json')).scripts.build).toBeUndefined();

    // Negative control: a review of the EARLIER base still gets the earlier
    // rules, so the change came from the file and not from the clock.
    const replay = reviewAt(repo, before, { changedPaths: ['services/billing/charge.js'] });
    expect(replay.policy.policy.roundCap).toBe(3);
    expect(replay.paths.prSensitive).toBe(false);
    expect(replay.rules.applied).toEqual(['REVIEW.md']);
  });

  test('an area rules file added as a file alone changes which rules apply', () => {
    const repo = adoptingRepo();
    runInitProjectScaffolding(repo);
    const before = commitAll(repo, 'chore: adopt ensemble review files').sha;

    const codeBefore = libDigest();

    writeFile(repo, 'src/REVIEW.md', '# App rules\n\nNo new global state.\n');
    const after = commitAll(repo, 'docs: add app area rules').sha;

    const review = reviewAt(repo, after, { changedPaths: ['src/app.js', 'services/billing/charge.js'] });
    expect(review.rules.ok).toBe(true);
    expect(review.rules.applied).toEqual(['REVIEW.md', 'src/REVIEW.md']);

    const perPath = Object.fromEntries(review.rules.paths.map((p) => [p.path, p]));
    expect(perPath['src/app.js'].nearest).toBe('src/REVIEW.md');
    // Negative control: a sibling area is NOT governed by the new file.
    expect(perPath['services/billing/charge.js'].nearest).toBeNull();
    expect(perPath['services/billing/charge.js'].rules).toEqual(['REVIEW.md']);

    // Negative control: at the earlier base the area file does not exist, so
    // the same PR is governed by the root file alone.
    const earlier = reviewAt(repo, before, { changedPaths: ['src/app.js'] });
    expect(earlier.rules.applied).toEqual(['REVIEW.md']);

    expect(libDigest()).toBe(codeBefore);
  });
});
