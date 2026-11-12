'use strict';

/**
 * TRD-005-TEST: Guidance CLI end to end.
 *
 * Verifies TRD-005 (the `policy`, `rules`, `paths` and `description`
 * subcommands of `pr-review-cli.js`).
 * Validates PRD ACs: AC-001-4 (REQ-001), AC-002-3 (REQ-002), AC-003-2 (REQ-003).
 *
 * TRD Reference: docs/TRD/TRD-2026-70e784f2-code-review-process.md#trd-005-test
 * PRD Reference: docs/PRD/PRD-2026-70e784f2-code-review-process.md#req-001
 *
 * The per-module scenario suites (pr-review-rules-scenarios,
 * pr-review-paths-scenarios, pr-review-description-scenarios) each prove one
 * module. This suite proves the SHIPPED GUIDANCE SURFACE END TO END:
 *
 *   - every call is a fresh `node pr-review-cli.js <subcommand>` PROCESS, fed
 *     JSON on stdin, graded on its exit code and the one JSON object it
 *     prints -- never an in-process handler export;
 *   - the inputs are REAL FILES in a fixture repository tree (root REVIEW.md
 *     with its policy block, area rules files, CODEOWNERS, the PR body), and
 *     the rules file list is DISCOVERED by walking that tree the way a review
 *     lists the rules files present at the base commit;
 *   - the subcommands are run CHAINED, in the order a review reaches them
 *     (policy -> rules -> paths -> description -> status), each step's output
 *     feeding the report and the next step's payload, so what is graded is the
 *     whole guidance pass and not four isolated calls;
 *   - no outbound network is reachable from any of those processes.
 *
 * Every scenario carries a negative control, so guidance that approved
 * everything -- or refused everything -- would fail here.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { NO_AREA_RULES_NOTE, ROOT_RULES_FILE } = require('../lib/pr-review-rules');
const { REQUIRED_SECTIONS } = require('../lib/pr-review-description');
const { DEFAULT_SENSITIVE_PATHS } = require('../lib/pr-review-paths');

const CLI = path.join(__dirname, '..', 'lib', 'pr-review-cli.js');

// Full object ids: the guidance modules read a base commit, never a bare ref.
const BASE_SHA = '8b87a6d71146cd2e36e09c4fc265b6bb336f8798';
const HEAD_SHA = 'b8fe66aeb70b304237e584311a2b481a3c990f91';

// Routes any accidental outbound call to an unreachable local port instead of
// the real internet: a process that still completes made no network access.
const NO_NETWORK_ENV = {
  ...process.env,
  http_proxy: 'http://127.0.0.1:1',
  https_proxy: 'http://127.0.0.1:1',
  HTTP_PROXY: 'http://127.0.0.1:1',
  HTTPS_PROXY: 'http://127.0.0.1:1',
  NO_PROXY: '',
};

/**
 * Runs one guidance subcommand as a real process and returns its exit code,
 * stderr and the parsed single JSON object it printed.
 */
function runCli(subcommand, payload) {
  const res = spawnSync('node', [CLI, subcommand], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: NO_NETWORK_ENV,
  });
  let result = null;
  if (typeof res.stdout === 'string' && res.stdout.trim() !== '') {
    result = JSON.parse(res.stdout);
  }
  return { code: res.status, stderr: res.stderr, stdout: res.stdout, result };
}

/** A subcommand that answered: exit 0, clean stderr, exactly one JSON object. */
function expectCleanProcess({ code, stderr, stdout, result }) {
  expect(code).toBe(0);
  expect(stderr).toBe('');
  expect(result).not.toBeNull();
  expect(Array.isArray(result)).toBe(false);
  expect(typeof result).toBe('object');
  // One object, not a stream of them.
  expect(stdout.trim().split('\n').filter((line) => line.trim().startsWith('{')).length).toBe(1);
}

/** The root REVIEW.md a maintainer edits: prose plus the fenced policy block. */
function rootReviewFile(overrides = {}) {
  const block = JSON.stringify({ sourceSha: BASE_SHA, roundCap: 2, maintainerLogins: ['ldangelo'], ...overrides }, null, 2);
  return [
    '# Review rules',
    '',
    'Two reviewers. Name the evidence for every finding.',
    '',
    '```ensemble-review-policy',
    block,
    '```',
    '',
  ].join('\n');
}

const AREA_RULES_TEXT = '# Core review rules\n\nThree reviewers. No new runtime dependency.\n';

const CODEOWNERS_TEXT = '# owners\npackages/core/** @sunstone/core-team\n';

/**
 * Builds a fixture repository on disk. `files` maps repository-relative paths
 * to contents; the source files a PR touches are written too, so the tree walk
 * has something to ignore.
 */
const fixtureRoots = [];

function fixtureRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-review-guidance-e2e-'));
  fixtureRoots.push(root);
  for (const [relative, body] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
  return root;
}

afterAll(() => {
  for (const root of fixtureRoots) fs.rmSync(root, { recursive: true, force: true });
});

/** Lists every rules file in the tree, the way a review lists them at the base commit. */
function discoverRuleFiles(root, fileName = ROOT_RULES_FILE) {
  const found = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const relative = directory === '' ? entry.name : `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(relative);
      else if (entry.name === fileName) found.push(relative);
    }
  };
  walk('');
  return found.sort();
}

/** Reads a file from the fixture tree, or null when the repository has none. */
function readFromBase(root, relative) {
  const target = path.join(root, relative);
  return fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
}

/** A PR body with only the sections named. */
function prBody({ sections = REQUIRED_SECTIONS, directedBy = 'ldangelo' } = {}) {
  const headings = {
    testing: '## Testing\n\n`npm test -w @sunstone-partners/ensemble-development` passes.\n',
    risk: '## Risk\n\nLow: the change is additive and behind an existing gate.\n',
    'how-to-revert': '## How to revert\n\n`git revert <sha>`; no data migration to undo.\n',
  };
  const parts = ['# Guidance CLI end to end', ''];
  for (const id of sections) parts.push(headings[id], '');
  if (directedBy !== null) parts.push(`Directed by: ${directedBy}`, '');
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// AC-001-4 -- no rules file exists for the area the PR touches.
// ---------------------------------------------------------------------------

describe('TRD-005-TEST / AC-001-4: with no area rules file, review proceeds on repository-wide guidance and says so', () => {
  const CHANGED = ['packages/web/app.js', 'packages/web/styles.css'];

  test('`rules` through the real CLI applies only the root file and states that no area rules were found', () => {
    const root = fixtureRepo({
      'REVIEW.md': rootReviewFile(),
      'packages/core/REVIEW.md': AREA_RULES_TEXT, // governs a DIFFERENT area
      'packages/web/app.js': 'module.exports = 1;\n',
      'packages/web/styles.css': 'body { color: red; }\n',
    });

    const run = runCli('rules', {
      changedPaths: CHANGED,
      ruleFiles: discoverRuleFiles(root),
      baseSha: BASE_SHA,
      sourceSha: BASE_SHA,
    });
    expectCleanProcess(run);

    // Review PROCEEDS: it is not blocked, and repository-wide guidance applies.
    expect(run.result.ok).toBe(true);
    expect(run.result.applied).toEqual(['REVIEW.md']);
    expect(run.result.rootFile).toBe('REVIEW.md');
    expect(run.result.multiArea).toBe(false);

    // ...and the report can state, in words, that no area rules were found.
    expect(run.result.notes).toContain(NO_AREA_RULES_NOTE);
    expect(NO_AREA_RULES_NOTE).toMatch(/no area-specific rules were found/i);

    // Per changed path: no nearest area file, root guidance still applied.
    for (const entry of run.result.paths) {
      expect(entry.nearest).toBeNull();
      expect(entry.rules).toEqual(['REVIEW.md']);
    }
  });

  test('negative control: when the area DOES have a rules file, it is applied and the note is gone', () => {
    const root = fixtureRepo({
      'REVIEW.md': rootReviewFile(),
      'packages/web/REVIEW.md': AREA_RULES_TEXT,
      'packages/web/app.js': 'module.exports = 1;\n',
      'packages/web/styles.css': 'body { color: red; }\n',
    });

    const run = runCli('rules', {
      changedPaths: CHANGED,
      ruleFiles: discoverRuleFiles(root),
      baseSha: BASE_SHA,
      sourceSha: BASE_SHA,
    });
    expectCleanProcess(run);

    expect(run.result.applied).toEqual(['REVIEW.md', 'packages/web/REVIEW.md']);
    expect(run.result.notes).not.toContain(NO_AREA_RULES_NOTE);
  });

  test('a repository with no rules file at all still proceeds: policy falls back to the strict defaults, rules names the gap', () => {
    const root = fixtureRepo({ 'packages/web/app.js': 'module.exports = 1;\n' });

    const policyRun = runCli('policy', { text: readFromBase(root, 'REVIEW.md'), baseSha: BASE_SHA });
    expectCleanProcess(policyRun);
    expect(policyRun.result.ok).toBe(true);
    expect(policyRun.result.source).toBe('defaults');
    expect(policyRun.result.warnings).toContain('no-policy-file');
    expect(policyRun.result.policy.roundCap).toBe(3);

    const rulesRun = runCli('rules', {
      changedPaths: ['packages/web/app.js'],
      ruleFiles: discoverRuleFiles(root),
      baseSha: BASE_SHA,
      sourceSha: BASE_SHA,
    });
    expectCleanProcess(rulesRun);
    expect(rulesRun.result.ok).toBe(true);
    expect(rulesRun.result.applied).toEqual([]);
    expect(rulesRun.result.notes).toContain(NO_AREA_RULES_NOTE);
    expect(rulesRun.result.notes.join(' ')).toMatch(/no root rules file/i);
  });
});

// ---------------------------------------------------------------------------
// AC-002-3 -- a PR description missing any of the three sections.
// ---------------------------------------------------------------------------

describe('TRD-005-TEST / AC-002-3: a description missing a section is not ready, and the section is named', () => {
  test.each([
    ['testing', ['risk', 'how-to-revert']],
    ['risk', ['testing', 'how-to-revert']],
    ['how-to-revert', ['testing', 'risk']],
  ])('`description` through the real CLI reports the PR not ready and names the missing %s section', (missing, kept) => {
    const root = fixtureRepo({ 'PR_BODY.md': prBody({ sections: kept }) });

    const run = runCli('description', { body: readFromBase(root, 'PR_BODY.md'), agentAuthored: true });
    expectCleanProcess(run);

    // Not ready for approval...
    expect(run.result.ok).toBe(true);
    expect(run.result.ready).toBe(false);
    // ...and it names the section that is missing, and only that one.
    expect(run.result.missing).toEqual([missing]);
    expect(run.result.present.sort()).toEqual([...kept].sort());
  });

  test('that gap travels into the computed review status: the PR cannot reach REVIEW_COMPLETE', () => {
    const root = fixtureRepo({ 'PR_BODY.md': prBody({ sections: ['testing', 'how-to-revert'] }) });

    const description = runCli('description', { body: readFromBase(root, 'PR_BODY.md'), agentAuthored: true });
    expectCleanProcess(description);
    expect(description.result.ready).toBe(false);
    expect(description.result.missing).toEqual(['risk']);

    // A review carries an unready description as an actionable finding, the
    // way any other blocking finding is carried, and asks the CLI for status.
    const status = runCli('status', {
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      reviewedHeadSha: HEAD_SHA,
      roundsUsed: 0,
      findingCounts: { total: description.result.missing.length, actionable: description.result.missing.length, deferred: 0 },
      coverage: { status: 'complete', gaps: [] },
      tests: { exitCode: 0, skipped: false, command: 'npm test' },
      remotePhase: 'REMOTE_REVIEW_COMPLETE',
    });
    expectCleanProcess(status);

    expect(status.result.status).not.toBe('REVIEW_COMPLETE');
    expect(status.result.status).toBe('REVIEW_PENDING');
    expect(status.result.localPhase).not.toBe('LOCAL_REVIEW_COMPLETE');
    expect(status.result.reasons).toContain('unresolved actionable finding');

    // The report the reviewer prints names the missing section by name.
    const report = `not ready for approval: missing ${description.result.missing.join(', ')}`;
    expect(report).toContain('risk');
  });

  test('negative control: a complete description is ready, names nothing missing, and clears the status gate', () => {
    const root = fixtureRepo({ 'PR_BODY.md': prBody() });

    const description = runCli('description', { body: readFromBase(root, 'PR_BODY.md'), agentAuthored: true });
    expectCleanProcess(description);
    expect(description.result.ready).toBe(true);
    expect(description.result.missing).toEqual([]);
    expect(description.result.directedBy).toBe('ldangelo');

    const status = runCli('status', {
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      reviewedHeadSha: HEAD_SHA,
      roundsUsed: 0,
      findingCounts: { total: 0, actionable: 0, deferred: 0 },
      coverage: { status: 'complete', gaps: [] },
      tests: { exitCode: 0, skipped: false, command: 'npm test' },
      remotePhase: 'REMOTE_REVIEW_COMPLETE',
    });
    expectCleanProcess(status);
    expect(status.result.status).toBe('REVIEW_COMPLETE');
  });

  test('an agent-authored PR with every section but no accountable human is still not ready', () => {
    const root = fixtureRepo({ 'PR_BODY.md': prBody({ directedBy: null }) });

    const run = runCli('description', { body: readFromBase(root, 'PR_BODY.md'), agentAuthored: true });
    expectCleanProcess(run);
    expect(run.result.ready).toBe(false);
    expect(run.result.missing).toEqual(['directed-by']);
  });

  test('a request that makes no claim about who wrote the PR is read as agent-authored: with no Directed by line it is not ready', () => {
    const root = fixtureRepo({ 'PR_BODY.md': prBody({ directedBy: null }) });
    const body = readFromBase(root, 'PR_BODY.md');

    // A caller that cannot know the author leaves the claim out (the key, or the whole payload object): only an explicit false is a person's.
    for (const payload of [{ body }, { body, agentAuthored: null }, body]) {
      const run = runCli('description', payload);
      expectCleanProcess(run);
      expect(run.result.agentAuthored).toBe(true);
      expect(run.result.ready).toBe(false);
      expect(run.result.missing).toEqual(['directed-by']);
    }

    // Negative control: the same body with an explicit false is a person's, and needs no accountable human.
    const person = runCli('description', { body, agentAuthored: false });
    expectCleanProcess(person);
    expect(person.result.agentAuthored).toBe(false);
    expect(person.result.ready).toBe(true);
    expect(person.result.missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-003-2 -- no owner has declared the sensitive areas.
// ---------------------------------------------------------------------------

describe('TRD-005-TEST / AC-003-2: with no owner declaration, the default sensitive areas are still sensitive', () => {
  // One path per area the AC names.
  const UNDECLARED = {
    'CI workflow definitions': '.github/workflows/ci.yml',
    'release gates': 'scripts/release-notes.sh',
    installers: 'scripts/install-cli.sh',
    'the generation pipeline': 'scripts/generate-commands.js',
    'the project constitution': 'constitution.md',
  };
  const CHANGED = Object.values(UNDECLARED);
  const ORDINARY = 'packages/development/lib/feature.js';

  function repoWithoutDeclaration() {
    const files = { '.github/CODEOWNERS': CODEOWNERS_TEXT, [ORDINARY]: 'module.exports = 1;\n' };
    for (const file of CHANGED) files[file] = '# generated\n';
    return fixtureRepo(files);
  }

  test('`paths` through the real CLI marks every one of them sensitive from the built-in floor', () => {
    const root = repoWithoutDeclaration();

    const run = runCli('paths', {
      changedPaths: [...CHANGED, ORDINARY],
      declaration: null, // no owner has declared anything
      codeowners: readFromBase(root, '.github/CODEOWNERS'),
      baseSha: BASE_SHA,
    });
    expectCleanProcess(run);

    expect(run.result.ok).toBe(true);
    expect(run.result.declarationSource).toBe('defaults');
    expect(run.result.prSensitive).toBe(true);
    expect(run.result.sensitive.sort()).toEqual([...CHANGED].sort());

    for (const [area, file] of Object.entries(UNDECLARED)) {
      const entry = run.result.paths.find((candidate) => candidate.path === file);
      expect(`${area}: ${entry.sensitive}`).toBe(`${area}: true`);
      // Sensitive because of the built-in floor, not because of a declaration.
      expect(entry.source).toBe('default');
      expect(DEFAULT_SENSITIVE_PATHS).toContain(entry.matchedBy);
    }
  });

  test('negative control: an ordinary source file in the same PR is NOT sensitive', () => {
    const root = repoWithoutDeclaration();

    const run = runCli('paths', {
      changedPaths: [...CHANGED, ORDINARY],
      declaration: null,
      codeowners: readFromBase(root, '.github/CODEOWNERS'),
      baseSha: BASE_SHA,
    });
    expectCleanProcess(run);

    const ordinary = run.result.paths.find((candidate) => candidate.path === ORDINARY);
    expect(ordinary.sensitive).toBe(false);
    expect(ordinary.source).toBeNull();
    expect(run.result.sensitive).not.toContain(ORDINARY);
  });

  test('a declaration that omits those areas cannot shrink the floor', () => {
    const root = repoWithoutDeclaration();

    const run = runCli('paths', {
      changedPaths: CHANGED,
      // An owner declared something else entirely; the defaults still apply.
      declaration: { sourceSha: BASE_SHA, path: 'REVIEW.md', sensitive: ['docs/**'], high: [] },
      codeowners: readFromBase(root, '.github/CODEOWNERS'),
      baseSha: BASE_SHA,
    });
    expectCleanProcess(run);

    expect(run.result.declarationSource).toBe('declaration');
    expect(run.result.sensitive.sort()).toEqual([...CHANGED].sort());
    for (const entry of run.result.paths) expect(entry.source).toBe('default');
  });
});

// ---------------------------------------------------------------------------
// The whole guidance pass, chained the way a review runs it.
// ---------------------------------------------------------------------------

describe('TRD-005-TEST: policy -> rules -> paths -> description -> status, each a separate real process', () => {
  test('one PR through the whole chain produces a report naming the rules, the sensitive paths and the missing section', () => {
    const changedPaths = ['.github/workflows/ci.yml', 'packages/web/app.js'];
    const root = fixtureRepo({
      'REVIEW.md': rootReviewFile({ roundCap: 2, sensitivePaths: ['docs/**'] }),
      '.github/CODEOWNERS': CODEOWNERS_TEXT,
      '.github/workflows/ci.yml': 'name: ci\n',
      'packages/web/app.js': 'module.exports = 1;\n',
      'PR_BODY.md': prBody({ sections: ['testing', 'risk'] }), // no How to revert
    });

    // 1. Policy, read from the base commit copy of the root rules file.
    const policy = runCli('policy', { text: readFromBase(root, 'REVIEW.md'), baseSha: BASE_SHA, sourceSha: BASE_SHA });
    expectCleanProcess(policy);
    expect(policy.result.ok).toBe(true);
    expect(policy.result.source).toBe('policy');
    expect(policy.result.policy.roundCap).toBe(2);

    // 2. Which rules files apply (AC-001-4: none for these areas).
    const rules = runCli('rules', {
      changedPaths,
      ruleFiles: discoverRuleFiles(root),
      baseSha: BASE_SHA,
      sourceSha: BASE_SHA,
    });
    expectCleanProcess(rules);
    expect(rules.result.applied).toEqual(['REVIEW.md']);
    expect(rules.result.notes).toContain(NO_AREA_RULES_NOTE);

    // 3. Sensitivity (AC-003-2: the workflow is sensitive with no declaration
    //    naming it; the policy's own sensitivePaths do not cover it).
    const paths = runCli('paths', {
      changedPaths,
      declaration: { sourceSha: BASE_SHA, path: 'REVIEW.md', sensitive: policy.result.policy.sensitivePaths, high: policy.result.policy.highPaths },
      codeowners: readFromBase(root, '.github/CODEOWNERS'),
      baseSha: BASE_SHA,
    });
    expectCleanProcess(paths);
    expect(paths.result.sensitive).toEqual(['.github/workflows/ci.yml']);
    expect(paths.result.prSensitive).toBe(true);

    // 4. Description (AC-002-3: How to revert is missing).
    const description = runCli('description', { body: readFromBase(root, 'PR_BODY.md'), agentAuthored: true });
    expectCleanProcess(description);
    expect(description.result.ready).toBe(false);
    expect(description.result.missing).toEqual(['how-to-revert']);

    // 5. Status, with the description gap carried as an actionable finding.
    const actionable = description.result.ready ? 0 : description.result.missing.length;
    const status = runCli('status', {
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      reviewedHeadSha: HEAD_SHA,
      roundsUsed: 0,
      findingCounts: { total: actionable, actionable, deferred: 0 },
      coverage: { status: 'complete', gaps: [] },
      tests: { exitCode: 0, skipped: false, command: 'npm test' },
      remotePhase: 'REMOTE_REVIEW_COMPLETE',
    });
    expectCleanProcess(status);
    expect(status.result.status).toBe('REVIEW_PENDING');

    // The report a reviewer prints from this chain, naming every fact.
    const report = [
      `rules applied: ${rules.result.applied.join(', ') || 'none'}`,
      ...rules.result.notes,
      `sensitive paths: ${paths.result.sensitive.join(', ')}`,
      `description not ready; missing: ${description.result.missing.join(', ')}`,
      `status: ${status.result.status}`,
    ].join('\n');

    expect(report).toContain('rules applied: REVIEW.md');
    expect(report).toContain('no area-specific rules were found');
    expect(report).toContain('sensitive paths: .github/workflows/ci.yml');
    expect(report).toContain('missing: how-to-revert');
    expect(report).toContain('status: REVIEW_PENDING');
  });

  test('negative control: the same chain on a clean PR reports no gap and completes', () => {
    const changedPaths = ['packages/core/engine.js'];
    const root = fixtureRepo({
      'REVIEW.md': rootReviewFile(),
      'packages/core/REVIEW.md': AREA_RULES_TEXT,
      '.github/CODEOWNERS': CODEOWNERS_TEXT,
      'packages/core/engine.js': 'module.exports = 1;\n',
      'PR_BODY.md': prBody(),
    });

    const rules = runCli('rules', {
      changedPaths,
      ruleFiles: discoverRuleFiles(root),
      baseSha: BASE_SHA,
      sourceSha: BASE_SHA,
    });
    expectCleanProcess(rules);
    expect(rules.result.applied).toEqual(['REVIEW.md', 'packages/core/REVIEW.md']);
    expect(rules.result.notes).not.toContain(NO_AREA_RULES_NOTE);

    const paths = runCli('paths', {
      changedPaths,
      declaration: null,
      codeowners: readFromBase(root, '.github/CODEOWNERS'),
      baseSha: BASE_SHA,
    });
    expectCleanProcess(paths);
    expect(paths.result.sensitive).toEqual([]);
    expect(paths.result.prSensitive).toBe(false);
    expect(paths.result.paths[0].owners).toEqual(['@sunstone/core-team']);

    const description = runCli('description', { body: readFromBase(root, 'PR_BODY.md'), agentAuthored: true });
    expectCleanProcess(description);
    expect(description.result.ready).toBe(true);

    const status = runCli('status', {
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      reviewedHeadSha: HEAD_SHA,
      roundsUsed: 0,
      findingCounts: { total: 0, actionable: 0, deferred: 0 },
      coverage: { status: 'complete', gaps: [] },
      tests: { exitCode: 0, skipped: false, command: 'npm test' },
      remotePhase: 'REMOTE_REVIEW_COMPLETE',
    });
    expectCleanProcess(status);
    expect(status.result.status).toBe('REVIEW_COMPLETE');
  });

  test('every guidance subcommand in the chain runs with no network reachable and fails closed on a hostile payload', () => {
    for (const subcommand of ['policy', 'rules', 'paths', 'description']) {
      const res = spawnSync('node', [CLI, subcommand], {
        input: '{"__proto__":{"ready":true},"body":123,"changedPaths":"all","text":42}',
        encoding: 'utf8',
        env: NO_NETWORK_ENV,
      });
      const printed = res.stdout.trim() === '' ? null : JSON.parse(res.stdout);
      // Either a non-zero exit, or a fail-closed result -- never a clean pass.
      const cleanPass = res.status === 0
        && printed !== null
        && printed.ok === true
        && printed.ready !== false
        && (printed.reason === undefined);
      expect(`${subcommand} clean pass: ${cleanPass}`).toBe(`${subcommand} clean pass: false`);
      if (printed !== null && printed.ok === false) expect(typeof printed.reason).toBe('string');
    }
  });
});
