'use strict';

/**
 * TRD-035-TEST: on-demand sweeps without an ensemble scheduler (PRD scenarios).
 *
 * Validates PRD ACs: AC-021-1, AC-021-2 (REQ-021).
 *
 * TRD Reference: docs/TRD/TRD-2026-70e784f2-code-review-process.md#trd-035-test
 * PRD Reference: docs/PRD/PRD-2026-70e784f2-code-review-process.md#req-021
 *
 * The Implementation AC tests for the skill's prose live in
 * pr-review-sweep-skill.test.js. These are the PROCEDURE-LEVEL scenarios: the
 * steps `pr-review-sweep` documents, carried out as it documents them --
 *
 *   - the sweep set, the guidance and the rules files are resolved from a REAL
 *     throwaway git repository with REAL `git ls-tree` / `git show` at one
 *     commit, so "guidance comes from the swept commit, not the working tree"
 *     is shown by editing the working tree between two runs, not asserted;
 *   - every judgement -- policy, rules, sensitivity, depth, slices, ledger,
 *     votes, tier, approvals and the merge gate -- comes from a FRESH
 *     `node pr-review-cli.js <subcommand>` process, chained in the skill's own
 *     order (Step 1 -> Step 7), never from a value this file made up;
 *   - the Pre-existing tag is followed all the way to the consumer that the
 *     tag exists for: the same defect is run through the REAL merge gate
 *     tagged Pre-existing and tagged Important, and only the second blocks.
 *
 * Scenarios:
 *   - AC-021-1: a maintainer or the host repository's automation requests a
 *     sweep; when it runs, reviewers examine existing code and report findings
 *     with the Pre-existing tag.
 *   - AC-021-2: when no external trigger fires, ensemble itself runs no
 *     recurring job (Constitution Rule 4); recurrence is the host repository's
 *     or Foreman's, with a recommended cadence of weekly and sensitive areas
 *     (REQ-003) swept first.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const yaml = require('js-yaml');

const { EXPECTED_VERIFIERS } = require('../lib/pr-review-votes');
const { reviewedByOf } = require('./helpers/pr-review-reviewed-by');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CLI = path.join(__dirname, '..', 'lib', 'pr-review-cli.js');
const SKILL = fs.readFileSync(path.join(__dirname, '..', 'skills', 'pr-review-sweep', 'SKILL.md'), 'utf8');
const SKILL_FLAT = SKILL.replace(/\s+/g, ' ');
const INIT_PROJECT = fs.readFileSync(path.join(REPO_ROOT, 'packages/core/commands/ensemble/init-project.md'), 'utf8');
const INIT_FLAT = INIT_PROJECT.replace(/\s+/g, ' ');
const GUIDE_FLAT = fs.readFileSync(path.join(REPO_ROOT, 'docs/guides/pr-review-sweep.md'), 'utf8').replace(/\s+/g, ' ');

jest.setTimeout(120000);

// ---------------------------------------------------------------------------
// The procedure, carried out with the real CLI against a real repository
// ---------------------------------------------------------------------------

/** One CLI call, in its own process, exactly as the skill invokes it. */
function cli(subcommand, payload) {
  const run = spawnSync('node', [CLI, subcommand], { input: JSON.stringify(payload), encoding: 'utf8', cwd: REPO_ROOT });
  expect([subcommand, run.status, run.stderr]).toEqual([subcommand, 0, '']);
  return JSON.parse(run.stdout);
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function commitAll(root, message) {
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.email=sweep@example.invalid', '-c', 'user.name=Sweep Fixture', 'commit', '-qm', message]);
  return git(root, ['rev-parse', 'HEAD']).trim();
}

/** `git ls-tree -r --name-only <sha> -- <scope...>`: the sweep set, Step 1. */
function lsTree(root, sha, scope) {
  const out = git(root, ['ls-tree', '-r', '--name-only', sha, '--', ...scope]);
  return out.split('\n').filter((line) => line.trim() !== '');
}

/** `git show <sha>:<path>`, or null when the file does not exist at that commit. */
function showOrNull(root, sha, relative) {
  const run = spawnSync('git', ['show', `${sha}:${relative}`], { cwd: root, encoding: 'utf8' });
  return run.status === 0 ? run.stdout : null;
}

/**
 * A repository with code that is already merged: a High area, a sensitive
 * area, an area with its own rules file, and ordinary files that are neither.
 */
function sweepRepo(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-review-sweep-'));
  const files = {
    'README.md': 'Fixture repository for a sweep.\n',
    'REVIEW.md': [
      '# Review rules',
      '',
      '```ensemble-review-policy',
      JSON.stringify({
        roundCap: 3,
        maintainerLogins: ['@dana'],
        botLogins: ['@github-actions'],
        sensitivePaths: ['packages/payments/**', 'scripts/release-*'],
        highPaths: ['packages/payments/lib/**'],
        sliceThreshold: 1500,
      }, null, 2),
      '```',
      '',
      'Review the payments area with care.',
      '',
    ].join('\n'),
    'packages/payments/REVIEW.md': '# Payments rules\n\nMoney moves here; check idempotency.\n',
    'packages/payments/lib/refund.js': 'function refund() {\n  return charge();\n}\n',
    'packages/payments/lib/charge.js': 'function charge() {\n  return 1;\n}\n',
    'packages/payments/docs/notes.md': 'How refunds work.\n',
    'packages/ui/button.js': 'export const Button = () => null;\n',
    'docs/overview.md': 'Overview.\n',
    'scripts/release-notes.sh': '#!/bin/sh\necho release\n',
    '.github/workflows/ci.yml': 'name: CI\non:\n  pull_request:\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ci\n',
    '.github/CODEOWNERS': '* @acme/maintainers\n/packages/payments/ @dana @ren\n',
    ...overrides,
  };

  git(root, ['init', '-q', '.']);
  for (const [relative, content] of Object.entries(files)) {
    if (content === null) continue;
    fs.mkdirSync(path.join(root, path.dirname(relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), content);
  }
  const sha = commitAll(root, 'the tree a sweep reviews');
  return { root, sha };
}

/** A reviewer's candidate, as Step 5 records one (severity is set by the sweep, not by the caller). */
function candidate(overrides = {}) {
  return {
    id: 'SW1',
    source: 'sweep-reviewer-a',
    reviewer: 'sweep-reviewer-a',
    locationOrLink: 'packages/payments/lib/refund.js:2',
    severity: 'important',
    failureMode: 'the retry path can charge twice before the idempotency key is written',
    disposition: 'fix',
    evidence: 'refund() calls charge() with no key check at line 2',
    originalTextOrLink: 'sweep://run-1/finding-1',
    votes: [
      { verifier: 'v1', verdict: 'real' },
      { verifier: 'v2', verdict: 'real' },
      { verifier: 'v3', verdict: 'real' },
      { verifier: 'v4', verdict: 'real' },
      { verifier: 'v5', verdict: 'not-real' },
    ],
    ...overrides,
  };
}

/**
 * Steps 1-7 of the skill, run for real. Every grading answer is a fresh CLI
 * process; nothing here decides anything the modules decide.
 */
function sweep({ repo, sweepSha, scope = ['.'], tier, maxPaths, requestedBy = 'dana', verificationCapability = true, candidates = [], planned }) {
  const { root } = repo;
  const sha = sweepSha === undefined ? repo.sha : sweepSha;

  // --- Step 1: resolve what will be swept, at one commit -------------------
  const sweepSet = lsTree(root, sha, scope);
  const notFound = scope.filter((entry) => entry !== '.' && lsTree(root, sha, [entry]).length === 0);
  if (sweepSet.length === 0) {
    return { outcome: 'SWEEP_BLOCKED', reason: 'scope-empty', notFound, findings: undefined };
  }

  // --- Step 2: guidance from the SWEPT commit ------------------------------
  const policy = cli('policy', { text: showOrNull(root, sha, 'REVIEW.md'), baseSha: sha, sourceSha: sha });
  const ruleFiles = lsTree(root, sha, ['.']).filter((entry) => path.basename(entry) === 'REVIEW.md');
  const rules = cli('rules', { changedPaths: sweepSet, ruleFiles, rulesFileName: 'REVIEW.md', baseSha: sha, sourceSha: sha });
  const classified = cli('paths', {
    changedPaths: sweepSet,
    declaration: { sourceSha: sha, sensitive: policy.policy.sensitivePaths, high: policy.policy.highPaths },
    codeowners: showOrNull(root, sha, '.github/CODEOWNERS'),
    baseSha: sha,
  });

  if (!policy.ok || !rules.ok || !classified.ok) {
    return {
      outcome: 'SWEEP_BLOCKED',
      reason: [policy.ok ? null : `policy: ${policy.reason}`, rules.ok ? null : `rules: ${rules.reason}`, classified.ok ? null : `paths: ${classified.reason}`]
        .filter(Boolean)
        .join('; '),
      policy,
      rules,
      classified,
      findings: undefined,
    };
  }

  // --- Step 3: sensitive areas first (REQ-003) -----------------------------
  const high = classified.high.filter((entry) => sweepSet.includes(entry));
  const sensitive = classified.sensitive.filter((entry) => sweepSet.includes(entry) && !high.includes(entry));
  const rest = sweepSet.filter((entry) => !high.includes(entry) && !sensitive.includes(entry));
  const ordered = [...high, ...sensitive, ...rest];
  const bandOf = (entry) => (high.includes(entry) ? 'high' : sensitive.includes(entry) ? 'sensitive' : 'rest');

  const examined = maxPaths === undefined ? ordered : ordered.slice(0, maxPaths);
  const leftForNextRun = ordered.slice(examined.length);
  const sensitiveSkipped = leftForNextRun.filter((entry) => bandOf(entry) !== 'rest');

  // --- Step 4: depth and slices -------------------------------------------
  const mode = cli('depth', { tier: tier === undefined ? 'high' : tier }).mode;
  const depth = cli('depth', {
    tier: tier === undefined ? 'high' : tier,
    planned: planned === undefined ? { reviewers: 2, verifiers: EXPECTED_VERIFIERS[mode] } : planned,
  });
  if (!depth.ok) {
    return { outcome: 'SWEEP_BLOCKED', reason: 'depth-violations', depth, findings: undefined };
  }

  const slicePaths = examined.map((entry) => ({
    path: entry,
    lines: showOrNull(root, sha, entry).split('\n').length,
  }));
  const areas = [...new Set([
    ...rules.applied.map((entry) => (path.dirname(entry) === '.' ? '.' : path.dirname(entry))),
    ...classified.sensitive.map((entry) => path.dirname(entry)),
  ])];
  const threshold = policy.policy.sliceThreshold;
  const plan = cli('slices', { paths: slicePaths, areas, threshold, mode: depth.mode });
  if (!plan.ok) {
    return { outcome: 'SWEEP_BLOCKED', reason: `slices: ${plan.reason}`, plan, findings: undefined };
  }

  // --- Step 5: review, tagging every candidate Pre-existing ----------------
  const tagged = candidates.map((entry) => ({ ...entry, severity: 'Pre-existing' }));
  const validated = cli('ledger', { action: 'validate', findings: tagged });
  if (!validated.ok) {
    // A finding missing a required field is completed, never dropped -- and
    // never reported as a verified sweep result on the way.
    return { outcome: 'SWEEP_BLOCKED', reason: 'ledger-invalid', validated, findings: undefined };
  }
  const deduped = cli('ledger', { action: 'dedupe', findings: tagged });
  // Recorded exactly as pr-review-cycle Step 3 records a round: this is where
  // the tag stops being a word in a report and becomes `preExisting` on the
  // record every consumer reads.
  const recorded = cli('ledger', { action: 'recordRound', ledger: [], incoming: deduped.findings, round: 1 });

  // Coverage is proven after the review, not promised before it.
  const coverage = cli('slices', {
    paths: slicePaths,
    areas,
    threshold,
    mode: depth.mode,
    reviewedBy: reviewedByOf(plan),
    changedPaths: examined,
  });

  // --- Step 6: verify ------------------------------------------------------
  const votes = cli('votes', {
    findings: recorded.findings,
    depth: depth.mode,
    expectedVerifiers: EXPECTED_VERIFIERS[depth.mode],
    verificationCapability,
  });

  // --- Step 7: report ------------------------------------------------------
  return {
    outcome: 'SWEEP_COMPLETE',
    requestedBy,
    sweepSha: sha,
    scope,
    bands: { high, sensitive, rest },
    order: ordered,
    examined,
    examinedWithBand: examined.map((entry) => ({ path: entry, band: bandOf(entry) })),
    leftForNextRun,
    complete: leftForNextRun.length === 0,
    sensitiveSkipped,
    sliceInputs: { paths: slicePaths, areas, threshold, mode: depth.mode },
    notFound,
    policy,
    rules,
    classified,
    depth,
    plan,
    coverage,
    unswept: coverage.uncovered === undefined ? [] : coverage.uncovered,
    validated,
    ledger: recorded.findings,
    verification: votes.verification,
    findings: votes.findings,
    presented: votes.presented,
    reducedReview: votes.verification !== 'performed',
  };
}

// ---------------------------------------------------------------------------
// AC-021-1: a requested sweep reviews existing code and tags it Pre-existing
// ---------------------------------------------------------------------------

describe('Scenario AC-021-1: a maintainer requests a sweep, and it reviews existing code', () => {
  test('the sweep set is the merged tree at one commit, and a path that is not there is named, never dropped', () => {
    const repo = sweepRepo();
    const report = sweep({ repo, scope: ['packages/payments', 'packages/does-not-exist'] });

    expect(report.outcome).toBe('SWEEP_COMPLETE');
    // Only files that exist at SWEEP_SHA, and every one of them is merged code.
    expect(report.examined.sort()).toEqual([
      'packages/payments/REVIEW.md',
      'packages/payments/docs/notes.md',
      'packages/payments/lib/charge.js',
      'packages/payments/lib/refund.js',
    ]);
    expect(report.notFound).toEqual(['packages/does-not-exist']);
    // There is no diff anywhere in this: the reviewers get whole merged files.
    for (const entry of report.plan.slices.flatMap((slice) => slice.paths)) {
      expect(lsTree(repo.root, repo.sha, [entry])).toEqual([entry]);
    }
  });

  test('a sweep examines files that no PR touched today -- code already in the tree', () => {
    const repo = sweepRepo();
    // Nothing is in flight: the working tree is exactly the swept commit.
    expect(git(repo.root, ['status', '--porcelain']).trim()).toBe('');
    const report = sweep({ repo });
    expect(report.examined).toContain('packages/payments/lib/refund.js');
    expect(report.examined).toContain('docs/overview.md');
    expect(report.examined.length).toBe(lsTree(repo.root, repo.sha, ['.']).length);
  });

  test('guidance is the swept commit\'s copy: a working-tree edit does not change what the sweep reads', () => {
    const repo = sweepRepo();
    const before = sweep({ repo });
    expect(before.policy.policy.sensitivePaths).toContain('packages/payments/**');
    expect(before.bands.high).toEqual(['packages/payments/lib/charge.js', 'packages/payments/lib/refund.js']);

    // A maintainer edits REVIEW.md in the working tree but does not commit it.
    const reviewPath = path.join(repo.root, 'REVIEW.md');
    fs.writeFileSync(reviewPath, fs.readFileSync(reviewPath, 'utf8').replace('"packages/payments/lib/**"', '"packages/ui/**"'));
    expect(git(repo.root, ['status', '--porcelain']).trim()).not.toBe('');

    const afterEdit = sweep({ repo });
    expect(afterEdit.policy.policy.highPaths).toEqual(['packages/payments/lib/**']);
    expect(afterEdit.bands.high).toEqual(before.bands.high);

    // Committed, the new commit's copy is the one a sweep of THAT commit reads.
    const nextSha = commitAll(repo.root, 'move the High area');
    const afterCommit = sweep({ repo, sweepSha: nextSha });
    expect(afterCommit.policy.policy.highPaths).toEqual(['packages/ui/**']);
    expect(afterCommit.bands.high).toEqual(['packages/ui/button.js']);
  });

  test('a repository whose guidance cannot be read is BLOCKED, never reported clean', () => {
    const repo = sweepRepo({
      'REVIEW.md': '# Review rules\n\n```ensemble-review-policy\n{ "sensitivePaths": [ "packages/payments/**",\n```\n',
    });
    const report = sweep({ repo });

    expect(report.outcome).toBe('SWEEP_BLOCKED');
    expect(report.policy.ok).toBe(false);
    expect(report.policy.reason).toBe('policy-unparseable');
    expect(report.findings).toBeUndefined();
    expect(SKILL_FLAT).toContain('it never reports a clean repository');
  });

  test('the reviewers are the ones a PR gets: a one-reviewer plan is refused by the real depth gate', () => {
    const repo = sweepRepo();
    const thin = sweep({ repo, planned: { reviewers: 1, verifiers: 5 } });
    expect(thin.outcome).toBe('SWEEP_BLOCKED');
    expect(thin.depth.mode).toBe('deep');
    expect(thin.depth.violations.map((entry) => entry.role)).toContain('reviewers');

    // An unbounded sweep is Deep, not Quick: nobody gets a cheaper review by omitting TIER.
    const full = sweep({ repo });
    expect(full.depth.mode).toBe('deep');
    expect(full.depth.ok).toBe(true);
    expect(full.depth.violations).toEqual([]);
  });

  test('coverage is proven after the review: a slice nobody read is reported unswept, not clean', () => {
    const repo = sweepRepo();
    const report = sweep({ repo });
    expect(report.coverage.covered).toBe(true);
    expect(report.unswept).toEqual([]);

    // The same sweep set, sliced (a threshold this tree exceeds), with one
    // slice left unread: the CLI names exactly what went unexamined.
    const sliced = cli('slices', { ...report.sliceInputs, threshold: 1 });
    expect(sliced.reviewerAssignments.length).toBeGreaterThanOrEqual(2 * sliced.slices.length);
    expect(sliced.sliced).toBe(true);
    expect(sliced.slices.length).toBeGreaterThan(1);

    const partial = cli('slices', {
      ...report.sliceInputs,
      threshold: 1,
      reviewedBy: reviewedByOf(sliced, sliced.reviewerAssignments.filter((entry) => entry.sliceId !== sliced.slices[0].id)),
      changedPaths: report.examined,
    });
    expect(partial.covered).toBe(false);
    expect(partial.ok).toBe(false);
    expect(partial.uncovered.length).toBeGreaterThan(0);
    for (const missed of partial.uncovered) expect(report.examined).toContain(missed);

    // Reading every slice covers every swept path, so "clean" is earned.
    const whole = cli('slices', {
      ...report.sliceInputs,
      threshold: 1,
      reviewedBy: reviewedByOf(sliced),
      changedPaths: report.examined,
    });

    // One lens per slice is not enough at Deep: the sweep may not call it clean.
    const oneLens = cli('slices', {
      ...report.sliceInputs,
      threshold: 1,
      reviewedBy: reviewedByOf(sliced, sliced.slices.map((slice) => sliced.reviewerAssignments.find((entry) => entry.sliceId === slice.id))),
      changedPaths: report.examined,
    });
    expect(oneLens.covered).toBe(false);
    expect(oneLens.ok).toBe(false);
    expect(oneLens.underReviewed.length).toBeGreaterThan(0);
    expect(whole.covered).toBe(true);
    expect(whole.uncovered).toEqual([]);
  });

  test('every reported finding carries the Pre-existing tag, and the ledger normalises it', () => {
    const repo = sweepRepo();
    const report = sweep({ repo, candidates: [candidate(), candidate({ id: 'SW2', source: 'sweep-reviewer-b', reviewer: 'sweep-reviewer-b', severity: 'nit', locationOrLink: 'packages/payments/lib/charge.js:1', originalTextOrLink: 'sweep://run-1/finding-2' })] });

    expect(report.validated.ok).toBe(true);
    expect(report.findings.length).toBe(2);

    // The tag is the ledger's own closed-set word, so the RECORD -- not the
    // prose of the report -- says the defect was already in the tree.
    for (const finding of report.ledger) {
      expect(finding.severityRecognised).toBe(true);
      expect(finding.originalSeverity).toBe('Pre-existing');
      expect(finding.severity).toBe('pre-existing');
      expect(finding.preExisting).toBe(true);
    }
    for (const finding of report.findings) {
      expect(finding.preExisting).toBe(true);
      expect(cli('ledger', { action: 'isActionable', finding }).actionable).toBe(false);
    }

    // A candidate that reached the report WITHOUT the tag would be the one
    // misunderstanding this skill exists to prevent -- and is distinguishable:
    const untagged = cli('ledger', { action: 'recordRound', ledger: [], incoming: [candidate()], round: 1 });
    expect(untagged.findings[0].preExisting).toBe(false);
    expect(cli('ledger', { action: 'isActionable', finding: untagged.findings[0] }).actionable).toBe(true);

    // A reviewer's own severity opinion survives in the body of the finding...
    expect(report.findings.map((entry) => entry.failureMode)).toEqual([
      'the retry path can charge twice before the idempotency key is written',
      'the retry path can charge twice before the idempotency key is written',
    ]);
    // ...but the tag is set because the code was SWEPT, whatever the reviewer
    // said: one candidate came in Important, the other Nit, and both are tagged.
    expect(report.ledger.map((entry) => entry.originalSeverity)).toEqual(['Pre-existing', 'Pre-existing']);
  });

  test('a candidate missing a required field blocks the report; it is never quietly dropped', () => {
    const repo = sweepRepo();
    const incomplete = candidate();
    delete incomplete.evidence;
    const report = sweep({ repo, candidates: [candidate({ id: 'SW0' }), incomplete] });

    expect(report.outcome).toBe('SWEEP_BLOCKED');
    expect(report.reason).toBe('ledger-invalid');
    expect(report.validated.ok).toBe(false);
    expect(report.validated.offendingIds).toContain('SW1');
    // No findings list at all: a sweep that could not grade its own candidates
    // reports that, rather than reporting the one candidate it could read.
    expect(report.findings).toBeUndefined();
  });

  test('a swept finding cannot stop anybody\'s merge; the same defect tagged Important does', () => {
    const repo = sweepRepo();
    const report = sweep({ repo, candidates: [candidate()] });
    const swept = report.findings[0];

    const headSha = repo.sha;
    const tier = cli('tier', {
      kinds: [{ kind: 'bugfix', paths: ['packages/payments/lib/refund.js'] }],
      paths: report.classified,
      assignedBy: 'pr-review-cycle/classifier',
    });
    const approvals = cli('approvals', {
      reviews: [
        { author: 'dana', state: 'APPROVED', commitSha: headSha },
        { author: 'ren', state: 'APPROVED', commitSha: headSha },
      ],
      headSha,
      tier,
    });
    const description = { ok: true, missing: [], present: ['testing', 'risk', 'rollback'], empty: [], ready: true, warnings: [] };

    const withSweepFinding = cli('gate', { ledger: [swept], approvals, tier, description, security: { status: 'clean' }, headSha });
    expect(withSweepFinding.blockers.map((entry) => entry.code)).not.toContain('open-important-finding');

    // Negative control: the identical finding, tagged Important, blocks the gate.
    const asImportant = cli('gate', {
      ledger: [{ ...swept, severity: 'important', preExisting: false }],
      approvals,
      tier,
      description,
      security: { status: 'clean' },
      headSha,
    });
    expect(asImportant.blockers.map((entry) => entry.code)).toContain('open-important-finding');
    expect(asImportant.mergeable).toBe(false);
  });

  test('candidates are not findings until verified: the majority rule a PR gets applies here too', () => {
    const repo = sweepRepo();
    const report = sweep({
      repo,
      candidates: [
        candidate(),
        candidate({
          id: 'SW3',
          originalTextOrLink: 'sweep://run-1/finding-3',
          votes: [
            { verifier: 'v1', verdict: 'real' },
            { verifier: 'v2', verdict: 'not-real' },
            { verifier: 'v3', verdict: 'not-real' },
            { verifier: 'v4', verdict: 'not-real' },
            { verifier: 'v5', verdict: 'not-real' },
          ],
          locationOrLink: 'packages/ui/button.js:1',
        }),
      ],
    });

    const byId = Object.fromEntries(report.findings.map((entry) => [entry.id, entry]));
    expect(byId.SW1.outcome).toBe('present');
    expect(byId.SW1.tally).toMatchObject({ real: 4, notReal: 1, expected: EXPECTED_VERIFIERS.deep });
    expect(byId.SW3.outcome).toBe('filtered');
    expect(byId.SW3.authorLabel).toBe('verifier disagrees');
    // Filtered is not deleted: the ledger keeps it with its tally.
    expect(report.ledger.map((entry) => entry.id).sort()).toEqual(['SW1', 'SW3']);
    expect(report.presented.map((entry) => entry.id)).toEqual(['SW1']);
    expect(report.presented[0].preExisting).toBe(true);
  });

  test('a runtime with no subagents reports a reduced sweep, never a verified one', () => {
    const repo = sweepRepo();
    const report = sweep({ repo, candidates: [candidate()], verificationCapability: false });

    expect(report.verification).toBe('not-performed');
    expect(report.reducedReview).toBe(true);
    expect(report.findings[0].outcome).toBe('unverified');
    expect(report.findings[0].reason).toBe('no-subagent-capability');
    // Nothing is dropped, and the tag survives degradation.
    expect(report.presented.map((entry) => entry.id)).toEqual(['SW1']);
    expect(report.presented[0].preExisting).toBe(true);
  });

  test('the host repository\'s automation gets the same sweep a maintainer gets', () => {
    const repo = sweepRepo();
    const byMaintainer = sweep({ repo, requestedBy: 'dana', candidates: [candidate()] });
    const byAutomation = sweep({ repo, requestedBy: 'github-actions[bot]', candidates: [candidate()] });

    expect(byAutomation.requestedBy).toBe('github-actions[bot]');
    expect(byAutomation.examinedWithBand).toEqual(byMaintainer.examinedWithBand);
    expect(byAutomation.findings).toEqual(byMaintainer.findings);
    expect(byAutomation.depth.mode).toBe(byMaintainer.depth.mode);
  });

  test('a sweep changes nothing it reads: the repository is identical afterwards', () => {
    const repo = sweepRepo();
    const treeBefore = git(repo.root, ['rev-parse', 'HEAD^{tree}']).trim();
    sweep({ repo, candidates: [candidate()] });

    expect(git(repo.root, ['status', '--porcelain']).trim()).toBe('');
    expect(git(repo.root, ['rev-parse', 'HEAD^{tree}']).trim()).toBe(treeBefore);
    expect(git(repo.root, ['rev-list', '--count', 'HEAD']).trim()).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// AC-021-2: sensitive areas first, and nothing recurs on ensemble's side
// ---------------------------------------------------------------------------

describe('Scenario AC-021-2: sensitive areas (REQ-003) are swept first', () => {
  test('the order is High paths, then the rest of the sensitive set, then everything else', () => {
    const repo = sweepRepo();
    const report = sweep({ repo });

    expect(report.bands.high).toEqual(['packages/payments/lib/charge.js', 'packages/payments/lib/refund.js']);
    expect(report.bands.sensitive).toContain('packages/payments/docs/notes.md');
    expect(report.bands.sensitive).toContain('scripts/release-notes.sh');
    // The default floor applies even though the declaration never named them (AC-003-2).
    expect(report.bands.sensitive).toContain('.github/workflows/ci.yml');

    const bands = report.examinedWithBand.map((entry) => entry.band);
    const firstRest = bands.indexOf('rest');
    const lastSensitive = bands.lastIndexOf('sensitive');
    expect(bands.indexOf('high')).toBe(0);
    expect(bands.lastIndexOf('high')).toBeLessThan(bands.indexOf('sensitive'));
    expect(lastSensitive).toBeLessThan(firstRest);
    expect(report.examinedWithBand.filter((entry) => entry.band === 'rest').map((entry) => entry.path)).toContain('docs/overview.md');
  });

  test('a truncated run cuts from the END: sensitive bands are swept whole and the rest is named', () => {
    const repo = sweepRepo();
    const full = sweep({ repo });
    const sensitiveCount = full.bands.high.length + full.bands.sensitive.length;

    const truncated = sweep({ repo, maxPaths: sensitiveCount });
    expect(truncated.examined).toEqual(full.order.slice(0, sensitiveCount));
    expect(truncated.sensitiveSkipped).toEqual([]);
    expect(truncated.complete).toBe(false);
    expect(truncated.leftForNextRun.length).toBeGreaterThan(0);
    // What was left is named path by path, not summarised as a count.
    for (const left of truncated.leftForNextRun) expect(full.order).toContain(left);
    expect(truncated.examined.concat(truncated.leftForNextRun).sort()).toEqual(full.order.slice().sort());
  });

  test('a run that truncates INTO a sensitive band reports itself incomplete, whatever it found', () => {
    const repo = sweepRepo();
    const truncated = sweep({ repo, maxPaths: 1, candidates: [candidate()] });

    expect(truncated.examined).toEqual(['packages/payments/lib/charge.js']);
    expect(truncated.complete).toBe(false);
    expect(truncated.sensitiveSkipped).toContain('packages/payments/lib/refund.js');
    expect(truncated.findings[0].preExisting).toBe(true);
    expect(SKILL_FLAT).toContain('A sweep that skipped a sensitive path reports itself as incomplete, whatever else it found');
  });
});

describe('Scenario AC-021-2: no external trigger fires, so ensemble runs no recurring job', () => {
  /** Every shipped workflow of this repository, parsed rather than grepped. */
  function shippedWorkflows() {
    const dir = path.join(REPO_ROOT, '.github', 'workflows');
    return fs.readdirSync(dir)
      .filter((name) => /\.ya?ml$/.test(name))
      .map((name) => ({ name, text: fs.readFileSync(path.join(dir, name), 'utf8') }));
  }

  /** The `on:` triggers of a workflow. YAML 1.1 reads a bare `on` as the boolean true. */
  function triggersOf(text) {
    const document = yaml.load(text);
    const on = document.on === undefined ? document[true] : document.on;
    if (on === undefined || on === null) return [];
    if (typeof on === 'string') return [on];
    if (Array.isArray(on)) return on;
    return Object.keys(on);
  }

  /** The workflow template init-project OFFERS: the fenced YAML block that names the sweep. */
  function sweepTemplate() {
    const blocks = INIT_PROJECT.split('```yaml').slice(1).map((chunk) => chunk.split('```')[0]);
    const template = blocks.filter((block) => block.includes('pr-review-sweep'));
    expect(template).toHaveLength(1);
    return template[0];
  }

  test('not one of ensemble\'s own workflows carries a schedule trigger (Constitution Rule 4)', () => {
    const workflows = shippedWorkflows();
    expect(workflows.length).toBeGreaterThan(0);

    // codeql.yml is the repository's weekly CodeQL security scan (added on dev). It runs a scanner,
    // not a code review: no reviewer, ledger or review gate is behind it, so it is not a review recurrence.
    const scheduled = workflows.filter(({ text }) => triggersOf(text).includes('schedule'));
    expect(scheduled.map(({ name }) => name).filter((name) => name !== 'codeql.yml')).toEqual([]);
    // Every workflow is driven by something outside ensemble: a push, a PR, a human.
    for (const { name, text } of workflows) {
      expect([name, triggersOf(text).length > 0]).toEqual([name, true]);
    }
  });

  test('the detector is real: it finds the schedule in the template init-project offers', () => {
    expect(sweepTemplate()).toContain('Weekly code sweep');
    expect(triggersOf(sweepTemplate())).toContain('schedule');

    // And that template is NOT one of ensemble's own workflow files.
    expect(shippedWorkflows().map(({ name }) => name)).not.toContain('review-sweep.yml');
    expect(fs.existsSync(path.join(REPO_ROOT, '.github', 'workflows', 'review-sweep.yml'))).toBe(false);
  });

  test('the sweep skill itself holds no timer, schedule, watcher or poll in any runtime copy', () => {
    const copies = [
      path.join(REPO_ROOT, 'packages/development/skills/pr-review-sweep/SKILL.md'),
      path.join(REPO_ROOT, 'packages/pi/skills/pr-review-sweep/SKILL.md'),
    ];
    for (const file of copies) {
      const text = fs.readFileSync(file, 'utf8');
      expect([file, fs.existsSync(file)]).toEqual([file, true]);
      // No scheduling construct: no cron line, no sleep loop, no background wait.
      expect(text).not.toMatch(/^\s*-\s*cron:/m);
      expect(text).not.toMatch(/\bsetInterval\b|\bcrontab\b|\bsleep \d+\b|\bwatch -n\b/);
      expect(text.replace(/\s+/g, ' ')).toContain('It is invoked, it runs, it reports, it ends');
    }
  });

  test('the weekly cadence is a recommendation the host owns, not a job ensemble runs', () => {
    const parsed = yaml.load(sweepTemplate());
    const on = parsed.on === undefined ? parsed[true] : parsed.on;

    // Weekly: a day-of-week field that names one day, not every day.
    const cron = on.schedule[0].cron;
    const [, , dayOfMonth, , dayOfWeek] = cron.trim().split(/\s+/);
    expect(dayOfWeek).not.toBe('*');
    expect(dayOfMonth).toBe('*');
    // The host can run it by hand too; and it is inert until the host enables it.
    expect(Object.keys(on)).toContain('workflow_dispatch');
    expect(parsed.jobs.sweep.if).toContain('vars.ENSEMBLE_SWEEP_ENABLED');

    expect(SKILL_FLAT).toContain('The recommended cadence is **weekly**');
    expect(SKILL_FLAT).toContain('Recurrence is the **host repository\'s** job');
    expect(SKILL_FLAT).toContain('or **Foreman\'s**');
  });

  test('the template is written only on an explicit yes, and is the host\'s file once written', () => {
    expect(INIT_FLAT).toContain('**Never write this file unless the user asks for it.**');
    expect(INIT_FLAT).toContain('On anything but an explicit yes: write nothing, and say so in the completion report');
    expect(INIT_FLAT).toContain('recurrence belongs to the repository that owns the schedule, never to ensemble (Constitution Rule 4)');
    expect(INIT_FLAT).toContain('no recurring job was added; ensemble');
    // The asymmetry the AC turns on: the host's automation needs its own key;
    // the review path a maintainer runs needs no new CI secret at all.
    expect(INIT_FLAT).toContain('The core review needs no new CI secret');
    expect(GUIDE_FLAT).toContain('no new CI secret');
  });

  test('ensemble ships no scheduler of its own: no shipped package declares a cron, timer or watcher entry point', () => {
    const listed = execFileSync('git', ['ls-files', '--', 'packages/*/package.json'], { cwd: REPO_ROOT, encoding: 'utf8' })
      .split('\n')
      .filter((line) => line.trim() !== '' && line.split('/').length === 3);
    expect(listed.length).toBeGreaterThan(0);

    for (const relative of listed) {
      const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8'));
      const scripts = Object.keys(manifest.scripts === undefined ? {} : manifest.scripts);
      expect([relative, scripts.filter((name) => /cron|schedule|daemon/.test(name))]).toEqual([relative, []]);
      const dependencies = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
      expect([relative, dependencies.filter((name) => /^node-cron$|^cron$|^node-schedule$|^agenda$|^bull$/.test(name))]).toEqual([relative, []]);
    }
  });
});
