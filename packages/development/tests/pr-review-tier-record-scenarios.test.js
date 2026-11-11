'use strict';

/**
 * TRD-026-TEST: Tier and gate CLI with recorded decision (PRD scenarios).
 *
 * Verifies TRD-026. Satisfies REQ-015. Validates PRD ACs: AC-015-1, AC-015-2.
 *
 *   - AC-015-1 Tier decision is recorded -- given a tier is assigned, when the
 *     PR's review state is read, then it contains the tier, the
 *     CHARACTERISTICS that drove it, and WHO OR WHAT assigned it.
 *   - AC-015-2 Tier decision is recorded -- given a tier was raised by a
 *     sensitive path or a second assessment, when the record is read, then it
 *     shows the ORIGINAL and FINAL tier and the REASON.
 *
 * Every scenario here runs the real `pr-review-cli.js` executable through
 * `spawnSync` -- never an exported handler -- and reads the report back in a
 * SEPARATE process, because "the PR's review state is read" is a later run of
 * the procedure, not the same function call that wrote it. The in-process
 * delegation and boundary tests for these subcommands are TRD-026's own
 * (pr-review-cli.test.js) and are not repeated.
 *
 * Each scenario carries the case that must be REFUSED as well as the one that
 * must be recorded: a record that invents an assigner, a raise that was never
 * made, a tier reused for a head nobody reviewed, and a lowering nobody with
 * the authority asked for are all shown not to happen.
 *
 * TRD Reference: docs/TRD/TRD-2026-70e784f2-code-review-process.md#trd-026-test
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'lib', 'pr-review-cli.js');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const HEAD_SHA = 'b8fe66aeb70b304237e584311a2b481a3c990f91';
const OTHER_HEAD = 'c'.repeat(40);

/** A throwaway working directory; every report is written under its own .ensemble/. */
function tmpCwd() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pr-review-tier-record-'));
}

/** One real CLI invocation: JSON in on stdin, JSON out on stdout. */
function cli(subcommand, payload) {
  const run = spawnSync('node', [CLI, subcommand], { input: JSON.stringify(payload), encoding: 'utf8' });
  if (run.status !== 0) {
    throw new Error(`pr-review-cli ${subcommand} exited ${run.status}: ${run.stderr}`);
  }
  return JSON.parse(run.stdout);
}

/** Assign a tier, then persist and re-read it the way the skill does: three separate processes. */
function recordAndRead(cwd, prId, tierPayload, { headSha = HEAD_SHA, readHeadSha = headSha } = {}) {
  const tier = cli('tier', tierPayload);
  const written = cli('state-write', { prId, cwd, state: { headSha, tier } });
  const read = cli('state-read', { prId, cwd, headSha: readHeadSha });
  return { tier, written, read };
}

const PRODUCT_CHANGE = [{ kind: 'product', paths: ['src/checkout/total.js'] }];
const DOCS_CHANGE = [{ kind: 'docs', paths: ['README.md'] }];
const AUTH_CHANGE = [{ kind: 'product', paths: ['src/auth/token.js'] }];
const SENSITIVE_PATHS = { ok: true, sensitive: ['src/auth/token.js'], high: [], paths: ['src/auth/token.js'] };
const NO_PATHS = { ok: true, sensitive: [], high: [], paths: ['src/checkout/total.js'] };

// ---------------------------------------------------------------------------
// AC-015-1: the record names the tier, the characteristics and the assigner
// ---------------------------------------------------------------------------

describe('Scenario AC-015-1: a tier is assigned, and the PR review state names it, what drove it and who assigned it', () => {
  test('the recorded decision carries the tier, the change characteristics with their cited paths, and the assigner', () => {
    const cwd = tmpCwd();
    const { read } = recordAndRead(cwd, '101', {
      kinds: PRODUCT_CHANGE,
      paths: NO_PATHS,
      assignedBy: 'pr-review-cycle/classifier',
    });

    expect(read.ok).toBe(true);
    expect(read.discarded).toBe(false);

    const record = read.state.tier;

    // The tier itself, and what it costs the author in reviewers.
    expect(record.tier).toBe('medium');
    expect(record.effectiveTier).toBe('medium');
    expect(record.humansRequired).toBe(1);

    // The characteristics that drove it: the kind of change, with the paths
    // it was cited from -- a reader never has to re-derive them.
    expect(record.characteristics).toEqual([{ kind: 'product', paths: ['src/checkout/total.js'] }]);
    expect(record.reasons).toContain('product-change');

    // Who or what assigned it.
    expect(record.assignedBy).toBe('pr-review-cycle/classifier');
  });

  test('the sensitive paths that drove a floor are named in the record, not just summarised', () => {
    const cwd = tmpCwd();
    const { read } = recordAndRead(cwd, '102', {
      kinds: AUTH_CHANGE,
      paths: SENSITIVE_PATHS,
      assignedBy: 'pr-review-cycle/classifier',
    });

    expect(read.state.tier.paths.sensitive).toEqual(['src/auth/token.js']);
    expect(read.state.tier.reasons).toContain('sensitive-path');
  });

  test('the case that must be refused: nothing invents an assigner when none was given', () => {
    const cwd = tmpCwd();
    const { read } = recordAndRead(cwd, '103', { kinds: PRODUCT_CHANGE, paths: NO_PATHS });

    // `null` is readable as "nobody recorded who assigned this"; a fabricated
    // name would be worse than an absent one.
    expect(read.state.tier.assignedBy).toBeNull();
    expect(read.state.tier.tier).toBe('medium');
  });

  test('the second case that must be refused: a classifier that cites no kind buys no cheaper review', () => {
    const cwd = tmpCwd();
    const { read } = recordAndRead(cwd, '104', { kinds: [], paths: NO_PATHS, assignedBy: 'pr-review-cycle/classifier' });

    // Nothing said is never "nothing to review": the record still grades
    // Medium or stricter and says so.
    expect(['medium', 'high']).toContain(read.state.tier.tier);
    expect(read.state.tier.humansRequired).toBeGreaterThanOrEqual(1);
  });

  test('the report is written under the untracked .ensemble/pr-review/ path, and git ignores it', () => {
    const cwd = tmpCwd();
    const { written } = recordAndRead(cwd, '105', { kinds: PRODUCT_CHANGE, paths: NO_PATHS });

    expect(written.ok).toBe(true);
    expect(written.path).toBe(path.join(cwd, '.ensemble', 'pr-review', 'pr-105.json'));
    expect(fs.existsSync(written.path)).toBe(true);

    // In this repository the same relative path is ignored, so recording a
    // decision can never alter the PR head it describes.
    const ignored = execFileSync('git', ['check-ignore', '.ensemble/pr-review/pr-105.json'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    });
    expect(ignored.trim()).toBe('.ensemble/pr-review/pr-105.json');
  });

  test('a later process reads back exactly what was recorded, byte for byte', () => {
    const cwd = tmpCwd();
    const { tier, written, read } = recordAndRead(cwd, '106', {
      kinds: AUTH_CHANGE,
      paths: SENSITIVE_PATHS,
      assignedBy: 'pr-review-cycle/classifier',
    });

    expect(read.state.tier).toEqual(tier);
    expect(JSON.parse(fs.readFileSync(written.path, 'utf-8')).tier).toEqual(tier);
  });
});

// ---------------------------------------------------------------------------
// AC-015-2: a raise shows the original tier, the final tier and the reason
// ---------------------------------------------------------------------------

describe('Scenario AC-015-2: a tier raised by a sensitive path or a second assessment shows original, final and reason', () => {
  test('a sensitive path raises the tier, and the record shows Medium -> High with the reason and the path', () => {
    const cwd = tmpCwd();
    const { read } = recordAndRead(cwd, '201', {
      kinds: AUTH_CHANGE,
      paths: SENSITIVE_PATHS,
      assignedBy: 'pr-review-cycle/classifier',
    });
    const record = read.state.tier;

    expect(record.originalTier).toBe('medium');
    expect(record.finalTier).toBe('high');
    expect(record.tier).toBe('high');
    expect(record.reasons).toContain('sensitive-path');
    expect(record.paths.sensitive).toEqual(['src/auth/token.js']);
    expect(record.humansRequired).toBe(2);
  });

  test('a second assessment raises the tier, and the record shows the from/to and the assessor’s stated reason', () => {
    const cwd = tmpCwd();
    const { read } = recordAndRead(cwd, '202', {
      kinds: DOCS_CHANGE,
      paths: { ok: true, sensitive: [], high: [], paths: ['README.md'] },
      secondAssessment: {
        needsAnotherPerson: true,
        reason: 'the copy change states a refund policy nobody on the team owns',
        evidencePaths: ['README.md'],
      },
      assignedBy: 'pr-review-cycle/second-assessment',
    });
    const record = read.state.tier;

    expect(record.originalTier).toBe('low');
    expect(record.finalTier).toBe('medium');
    expect(record.raised).toContainEqual(
      expect.objectContaining({
        from: 'low',
        to: 'medium',
        reason: 'the copy change states a refund policy nobody on the team owns',
      })
    );
    expect(record.assignedBy).toBe('pr-review-cycle/second-assessment');
  });

  test('a floor and an agreeing second assessment on one PR: the record shows one raise to the ceiling, not two', () => {
    const cwd = tmpCwd();
    const { read } = recordAndRead(cwd, '203', {
      kinds: AUTH_CHANGE,
      paths: SENSITIVE_PATHS,
      secondAssessment: { needsAnotherPerson: true, reason: 'touches the token lifetime', evidencePaths: ['src/auth/token.js'] },
      assignedBy: 'pr-review-cycle/classifier',
    });
    const record = read.state.tier;

    // The floor already took the PR to High, which is the top tier, so the
    // assessment has nothing left to raise. The record states the raise that
    // happened and its reason (AC-015-2) and records no second one: a `raised`
    // entry for a tier that never moved would be a fabricated history.
    expect(record.originalTier).toBe('medium');
    expect(record.finalTier).toBe('high');
    expect(record.reasons).toContain('sensitive-path');
    expect(record.raised).toEqual([]);
    expect(record.humansRequired).toBe(2);
  });

  test('the case that must be refused: an unraised PR never shows a raise it did not have', () => {
    const cwd = tmpCwd();
    const { read } = recordAndRead(cwd, '204', {
      kinds: PRODUCT_CHANGE,
      paths: NO_PATHS,
      secondAssessment: { needsAnotherPerson: false, reason: 'one reviewer is enough for a priced-out change' },
      assignedBy: 'pr-review-cycle/classifier',
    });
    const record = read.state.tier;

    expect(record.originalTier).toBe('medium');
    expect(record.finalTier).toBe('medium');
    expect(record.raised).toEqual([]);
  });

  test('the second case that must be refused: a lowering nobody had the authority to ask for is recorded as ignored, not applied', () => {
    const cwd = tmpCwd();
    const { read } = recordAndRead(cwd, '205', {
      kinds: AUTH_CHANGE,
      paths: SENSITIVE_PATHS,
      proposedTier: 'low',
      proposedBy: { login: 'author-a', isCodeOwner: false },
      assignedBy: 'pr-review-cycle/classifier',
    });
    const record = read.state.tier;

    expect(record.finalTier).toBe('high');
    expect(record.lowered).toEqual([]);
    expect(record.ignored).toContainEqual(expect.objectContaining({ proposedTier: 'low', by: 'author-a' }));
  });

  test('an unreadable second assessment raises anyway, and the record says why', () => {
    const cwd = tmpCwd();
    const { read } = recordAndRead(cwd, '206', {
      kinds: DOCS_CHANGE,
      paths: { ok: true, sensitive: [], high: [], paths: ['README.md'] },
      secondAssessment: { needsAnotherPerson: 'maybe' },
      assignedBy: 'pr-review-cycle/second-assessment',
    });
    const record = read.state.tier;

    // Fail toward more review, and never silently.
    expect(record.originalTier).toBe('low');
    expect(record.finalTier).toBe('medium');
    expect(record.raised).toContainEqual(expect.objectContaining({ reason: 'second-assessment-unreadable' }));
  });

  test('the recorded decision is bound to its head: a different head is discarded, never reused', () => {
    const cwd = tmpCwd();
    const { read } = recordAndRead(
      cwd,
      '207',
      { kinds: AUTH_CHANGE, paths: SENSITIVE_PATHS, assignedBy: 'pr-review-cycle/classifier' },
      { readHeadSha: OTHER_HEAD }
    );

    expect(read.discarded).toBe(true);
    expect(read.state).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The recorded decision is what the gate grades against
// ---------------------------------------------------------------------------

describe('Scenario AC-015-1 / AC-015-2: the gate CLI grades against the recorded decision, not a fresh guess', () => {
  const approvalOn = (author, commitSha = HEAD_SHA) => ({ author, state: 'APPROVED', commitSha });

  /** Read the record back, then run approvals and the gate against it, each in its own process. */
  function gateFromRecord(cwd, prId, tierPayload, reviews) {
    const { read } = recordAndRead(cwd, prId, tierPayload);
    const tier = read.state.tier;
    const approvals = cli('approvals', { reviews, headSha: HEAD_SHA, tier });
    const gate = cli('gate', {
      ledger: [],
      approvals,
      tier,
      description: { ok: true, missing: [], present: ['testing', 'risk', 'rollback'], empty: [], ready: true, warnings: [] },
      security: { status: 'clean' },
      coverage: { status: 'complete', gaps: [] },
      headSha: HEAD_SHA,
    });
    return { tier, approvals, gate };
  }

  test('a PR the record floored to High needs two humans: one approval does not merge it', () => {
    const cwd = tmpCwd();
    const { tier, approvals, gate } = gateFromRecord(
      cwd,
      '301',
      { kinds: AUTH_CHANGE, paths: SENSITIVE_PATHS, assignedBy: 'pr-review-cycle/classifier' },
      [approvalOn('human-a')]
    );

    expect(tier.finalTier).toBe('high');
    expect(approvals.humansRequired).toBe(2);
    expect(approvals.satisfied).toBe(false);
    expect(gate.mergeable).toBe(false);
    expect(gate.blockers.map((entry) => entry.code)).toContain('approvals-unsatisfied');
  });

  test('the same PR with the second human merges: the recorded tier is a threshold, not a veto', () => {
    const cwd = tmpCwd();
    const { gate } = gateFromRecord(
      cwd,
      '302',
      { kinds: AUTH_CHANGE, paths: SENSITIVE_PATHS, assignedBy: 'pr-review-cycle/classifier' },
      [approvalOn('human-a'), approvalOn('human-b')]
    );

    expect(gate.mergeable).toBe(true);
    expect(gate.blockers).toEqual([]);
  });

  test('a Medium PR with one approval merges, so the High refusal above was the tier, not the approval count', () => {
    const cwd = tmpCwd();
    const { tier, gate } = gateFromRecord(
      cwd,
      '303',
      { kinds: PRODUCT_CHANGE, paths: NO_PATHS, assignedBy: 'pr-review-cycle/classifier' },
      [approvalOn('human-a')]
    );

    expect(tier.finalTier).toBe('medium');
    expect(gate.mergeable).toBe(true);
  });

  test('the case that must be refused: an approval given before the last push does not satisfy the recorded tier', () => {
    const cwd = tmpCwd();
    const { approvals, gate } = gateFromRecord(
      cwd,
      '304',
      { kinds: PRODUCT_CHANGE, paths: NO_PATHS, assignedBy: 'pr-review-cycle/classifier' },
      [approvalOn('human-a', OTHER_HEAD)]
    );

    expect(approvals.satisfied).toBe(false);
    expect(approvals.ignored).toContainEqual(expect.objectContaining({ login: 'human-a', reason: 'stale-commit' }));
    expect(gate.mergeable).toBe(false);
  });
});
