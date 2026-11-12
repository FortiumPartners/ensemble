'use strict';

/**
 * Review-run mode (kata 0s4a; docs/plans/pr-review-speedup-plan.md section 3G).
 *
 * The mode is `light` for Low and Medium and `full` for High, a sensitive
 * path, a raised tier and anything the module cannot read. The tier under test
 * is built the way a review builds it: this repository's own REVIEW.md policy
 * and CODEOWNERS classify real paths, and the CLI's own `tier` subcommand turns
 * them into the record `mode` reads -- no hand-typed tier words except in the
 * fail-closed cases, where a hand-built record is the point.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { selectMode, MODES } = require('../lib/pr-review-mode');
const { runTier, runMode, HANDLERS } = require('../lib/pr-review-cli');
const { resolveDepth } = require('../lib/pr-review-depth');
const { classifyPaths } = require('../lib/pr-review-paths');
const { loadPolicy } = require('../lib/pr-review-policy');

const CLI = path.join(__dirname, '..', 'lib', 'pr-review-cli.js');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CODEOWNERS = fs.readFileSync(path.join(REPO_ROOT, '.github/CODEOWNERS'), 'utf8');
const BASE_SHA = 'd'.repeat(40);

const POLICY = (() => {
  const loaded = loadPolicy({ text: fs.readFileSync(path.join(REPO_ROOT, 'REVIEW.md'), 'utf8'), sourceSha: BASE_SHA, baseSha: BASE_SHA });
  expect(loaded.ok).toBe(true);
  return loaded.policy;
})();

/** Real repository paths. */
const DOC = 'docs/guides/user-guide.md';
const PLAIN_SOURCE = 'packages/development/tests/pr-review-votes.test.js';
const APPROVAL_GATE = 'packages/development/lib/pr-review-gate.js';

/** The `tier` subcommand over real classified paths, exactly as the skill calls it. */
function tierFor({ kind, changedPaths, ...rest }) {
  const paths = classifyPaths({
    changedPaths,
    declaration: { sourceSha: BASE_SHA, sensitive: POLICY.sensitivePaths, high: POLICY.highPaths },
    codeowners: CODEOWNERS,
    baseSha: BASE_SHA,
  });
  return runTier({
    kinds: [{ kind, paths: changedPaths }],
    paths,
    policy: POLICY,
    assignedBy: 'pr-review-cycle/test',
    ...rest,
  });
}

/** A hand-built, well-formed tier record to damage one field at a time. */
const record = (overrides = {}) => ({
  ok: true,
  tier: 'medium',
  effectiveTier: 'medium',
  raised: [],
  paths: { sensitive: [], high: [], uncited: [] },
  reasons: [],
  warnings: [],
  ...overrides,
});

const NO_ASSESSMENT_NEEDED = { needsAnotherPerson: false, reason: 'nothing here needs a second person', evidencePaths: [] };

describe('light: Low and Medium', () => {
  test('a docs-only PR (#234-shaped: effective Medium at Standard, waiver off) selects light', () => {
    const tier = tierFor({ kind: 'docs', changedPaths: [DOC], secondAssessment: NO_ASSESSMENT_NEEDED });
    expect(tier).toMatchObject({ ok: true, tier: 'low', effectiveTier: 'medium' });

    const result = selectMode(tier);
    expect(result).toMatchObject({ ok: true, mode: 'light', tier: 'low', effectiveTier: 'medium' });
    expect(result.requires).toEqual({ depth: 'standard', minReviewers: 2, verifiersPerFinding: 3 });
    // The gate requires the security lane at Medium: light keeps it.
    expect(result.securityLane).toBe(true);
  });

  test('an ordinary product PR (Medium) selects light and still requires the security lane', () => {
    const tier = tierFor({ kind: 'product', changedPaths: [PLAIN_SOURCE], secondAssessment: NO_ASSESSMENT_NEEDED });
    expect(tier.tier).toBe('medium');

    const result = selectMode(tier);
    expect(result).toMatchObject({ ok: true, mode: 'light', tier: 'medium', securityLane: true });
  });

  test('a local review has no second assessment on record and still earns light', () => {
    // The assessor is a gate-mode step: a local review's tier result always
    // carries `second-assessment-missing`, and it must not push every review to full.
    const tier = tierFor({ kind: 'product', changedPaths: [PLAIN_SOURCE] });
    expect(tier.reasons).toContain('second-assessment-missing');
    expect(selectMode(tier).mode).toBe('light');
  });

  test('Low under an enabled waiver is light, and the security lane is not demanded of it', () => {
    const result = selectMode(record({ tier: 'low', effectiveTier: 'low' }));
    expect(result).toMatchObject({ ok: true, mode: 'light', securityLane: false });
  });

  test('the diff size is never read: a huge Medium change stays light', () => {
    const result = selectMode({ ...tierFor({ kind: 'product', changedPaths: [PLAIN_SOURCE] }), additions: 90000, changedFiles: 4000 });
    expect(result.mode).toBe('light');
  });
});

describe('full: High, a sensitive path, a raised tier', () => {
  test('an approval-gate edit (#235-shaped: 3 files, +33 lines, High) selects full', () => {
    const tier = tierFor({ kind: 'product', changedPaths: [APPROVAL_GATE], secondAssessment: NO_ASSESSMENT_NEEDED });
    expect(tier).toMatchObject({ ok: true, tier: 'high' });

    const result = selectMode({ ...tier, additions: 33, changedFiles: 3 });
    expect(result).toMatchObject({ ok: true, mode: 'full', tier: 'high', securityLane: true });
    expect(result.requires).toEqual({ depth: 'deep', minReviewers: 2, verifiersPerFinding: 5 });
    expect(result.reasons).toEqual(expect.arrayContaining(['sensitive-path', 'high-tier']));
  });

  test('a sensitive path selects full even when the record names a cheaper tier', () => {
    const result = selectMode(record({ paths: { sensitive: ['REVIEW.md'], high: [], uncited: [] } }));
    expect(result).toMatchObject({ mode: 'full' });
    expect(result.reasons).toContain('sensitive-path');
  });

  test('a path the policy lists as High selects full even when the record names a cheaper tier', () => {
    const result = selectMode(record({ paths: { sensitive: [], high: ['packages/agent-core/x.js'], uncited: [] } }));
    expect(result.mode).toBe('full');
    expect(result.reasons).toContain('high-path');
  });

  test('a second assessor that says another person must look raises the tier, and that selects full', () => {
    const calm = tierFor({ kind: 'docs', changedPaths: [DOC], secondAssessment: NO_ASSESSMENT_NEEDED });
    expect(selectMode(calm).mode).toBe('light');

    const raised = tierFor({
      kind: 'docs',
      changedPaths: [DOC],
      secondAssessment: { needsAnotherPerson: true, reason: 'touches a contract', evidencePaths: [DOC] },
    });
    expect(raised.raised).toHaveLength(1);
    const result = selectMode(raised);
    expect(result).toMatchObject({ ok: true, mode: 'full' });
    expect(result.reasons).toContain('tier-raised');
  });

  test.each([
    ['a non-answer (an object that never says no)', {}],
    ['a string instead of a record', 'yes'],
    ['an assessor that says needsAnotherPerson is the string "false"', { needsAnotherPerson: 'false', reason: 'x' }],
  ])('a second assessment that is %s raises, so it selects full', (_name, secondAssessment) => {
    const tier = tierFor({ kind: 'docs', changedPaths: [DOC], secondAssessment });
    expect(selectMode(tier).mode).toBe('full');
  });

  test('a proposed tier that raises the PR selects full', () => {
    const tier = tierFor({ kind: 'docs', changedPaths: [DOC], secondAssessment: NO_ASSESSMENT_NEEDED, proposedTier: 'high' });
    expect(selectMode(tier).mode).toBe('full');
  });
});

describe('fail closed: anything unreadable or ambiguous selects full', () => {
  test.each([
    ['undefined', undefined],
    ['null', null],
    ['a garbage string', 'not a tier result'],
    ['a number', 42],
    ['an array', [record()]],
    ['an empty object', {}],
    ['a partial object: a tier and nothing else', { tier: 'low' }],
    ['a partial object: ok and tier only', { ok: true, tier: 'low', effectiveTier: 'low' }],
    ['a record that says ok:false', record({ ok: false })],
    ['ok as the string "true"', record({ ok: 'true' })],
    ['an unknown tier value', record({ tier: 'critical', effectiveTier: 'critical' })],
    ['a tier in the wrong letter case', record({ tier: 'LOW', effectiveTier: 'LOW' })],
    ['a missing effective tier', record({ effectiveTier: undefined })],
    ['a garbage effective tier', record({ effectiveTier: 'whatever' })],
    ['a numeric tier', record({ tier: 1 })],
    ['an effective tier cheaper than the tier', record({ tier: 'medium', effectiveTier: 'low' })],
    ['an effective tier cheaper than a High tier', record({ tier: 'high', effectiveTier: 'medium' })],
    ['a raised list that is not a list', record({ raised: 'none' })],
    ['a raised list that is missing', record({ raised: undefined })],
    ['paths that are missing', record({ paths: undefined })],
    ['paths that carry no sensitive list', record({ paths: { high: [] } })],
    ['a sensitive list that is not a list', record({ paths: { sensitive: 'REVIEW.md', high: [] } })],
  ])('%s selects full with ok:false and a reason', (_name, input) => {
    const result = selectMode(input);
    expect(result.mode).toBe('full');
    expect(result.ok).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.securityLane).toBe(true);
    expect(MODES).toContain(result.mode);
  });

  test('the blocked record the tier subcommand itself returns for an unreadable request selects full', () => {
    const blocked = runTier('garbage');
    expect(blocked.ok).toBe(false);
    expect(selectMode(blocked).mode).toBe('full');
  });

  test('light is only ever the answer to a record that is whole: damage any one field of a light record and it flips', () => {
    expect(selectMode(record()).mode).toBe('light');
    for (const damage of [
      { ok: undefined },
      { tier: undefined },
      { effectiveTier: undefined },
      { raised: undefined },
      { paths: undefined },
    ]) {
      expect(selectMode(record(damage)).mode).toBe('full');
    }
  });
});

describe('fail closed: a tier the tier module reached on partial evidence selects full', () => {
  const calm = { secondAssessment: NO_ASSESSMENT_NEEDED };

  test('the calm baseline for these fixtures is light', () => {
    expect(selectMode(tierFor({ kind: 'docs', changedPaths: [DOC], ...calm })).mode).toBe('light');
  });

  test.each([
    ['no kinds cited', { changedPaths: [DOC], kinds: [] }, 'no-kinds-cited'],
    ['a kind word outside the closed set', { changedPaths: [DOC], kinds: [{ kind: 'refactor', paths: [DOC] }] }, 'unknown-kind'],
    ['a claim that covers one of two changed files', { changedPaths: [DOC, PLAIN_SOURCE], kinds: [{ kind: 'docs', paths: [DOC] }] }, 'uncited-path'],
    ['kind paths that are a string, not a list', { changedPaths: [DOC], kinds: [{ kind: 'docs', paths: DOC }] }, 'tier-warning:invalid-kind-paths'],
    ['a kind record that is not an object', { changedPaths: [DOC], kinds: ['docs'] }, 'tier-warning:invalid-kind-record'],
    ['a sensitive path passed git-quoted (non-verbatim)', { changedPaths: ['".github/workflows/\\303\\274.yml"'], kinds: [{ kind: 'docs', paths: ['".github/workflows/\\303\\274.yml"'] }] }, 'tier-warning:non-verbatim-changed-path'],
  ])('%s selects full with ok:false', (_name, input, reason) => {
    const tier = tierFor({ kind: 'docs', ...calm, ...input });
    expect(['low', 'medium']).toContain(tier.effectiveTier);
    const result = selectMode(tier);
    expect(result).toMatchObject({ ok: false, mode: 'full', securityLane: true });
    expect(result.reasons).toContain(reason);
  });

  test.each([
    ['a warning', record({ warnings: ['invalid-changed-paths'] }), 'tier-warning:invalid-changed-paths'],
    ['an uncited path with no reason', record({ paths: { sensitive: [], high: [], uncited: ['a.md'] } }), 'uncited-path'],
    ['a flagged reason', record({ reasons: ['unknown-kind'] }), 'unknown-kind'],
    ['a missing warnings list', record({ warnings: undefined }), 'warnings-unreadable'],
    ['a missing reasons list', record({ reasons: undefined }), 'reasons-unreadable'],
    ['a missing uncited list', record({ paths: { sensitive: [], high: [] } }), 'paths-unreadable'],
  ])('a hand-built record with %s selects full', (_name, input, reason) => {
    const result = selectMode(input);
    expect(result).toMatchObject({ ok: false, mode: 'full' });
    expect(result.reasons).toContain(reason);
  });

  test('the no-second-assessment and waiver-off reasons stay light', () => {
    const tier = tierFor({ kind: 'docs', changedPaths: [DOC], secondAssessment: undefined });
    expect(tier.reasons).toContain('second-assessment-missing');
    expect(selectMode(tier)).toMatchObject({ ok: true, mode: 'light' });
  });
});

describe('light requires what depth resolves for the effective tier', () => {
  test.each([
    ['Medium', 'medium', 'medium', 'standard', false],
    ['Low under the waiver', 'low', 'low', 'quick', true],
    ['Low read as Medium (waiver off)', 'low', 'medium', 'standard', false],
  ])('%s', (_name, tier, effectiveTier, depthMode, waiver) => {
    const result = selectMode(record({ tier, effectiveTier }));
    const depth = resolveDepth({ tier, effectiveTier, lowWaiverEnabled: waiver });
    expect(depth.mode).toBe(depthMode);
    expect(result.mode).toBe('light');
    expect(result.requires).toEqual({
      depth: depth.mode,
      minReviewers: depth.bounds.reviewers.min,
      verifiersPerFinding: depth.bounds.verifiers.min,
    });
  });

  test('a light plan at an effective Low is accepted by depth, so mode then depth converges', () => {
    const { requires } = selectMode(record({ tier: 'low', effectiveTier: 'low' }));
    expect(requires).toEqual({ depth: 'quick', minReviewers: 1, verifiersPerFinding: 0 });
    const verdict = HANDLERS.depth({
      tier: 'low',
      effectiveTier: 'low',
      lowWaiverEnabled: true,
      planned: { reviewers: requires.minReviewers, verifiers: requires.verifiersPerFinding },
    });
    expect(verdict.violations).toEqual([]);
  });
});

describe('the mode subcommand', () => {
  test('is registered, and answers exactly what the module answers for the payload\'s tierResult', () => {
    expect(HANDLERS.mode).toBe(runMode);
    const tierResult = tierFor({ kind: 'product', changedPaths: [PLAIN_SOURCE] });
    expect(runMode({ tierResult })).toEqual(selectMode(tierResult));
  });

  test.each([
    ['no payload', undefined],
    ['a payload that is not an object', 'light'],
    ['a payload with no tierResult', {}],
    ['a payload that smuggles the answer in as a mode word', { mode: 'light' }],
    ['a payload that is itself the record, not wrapped', record()],
  ])('%s answers full', (_name, payload) => {
    expect(runMode(payload)).toMatchObject({ mode: 'full', ok: false });
  });

  test('the real entry point: `tier` piped into `mode` answers light for docs and full for the gate edit', () => {
    const run = (sub, payload) => {
      const res = spawnSync('node', [CLI, sub], { input: JSON.stringify(payload), encoding: 'utf8' });
      expect(res.status).toBe(0);
      expect(res.stderr).toBe('');
      return JSON.parse(res.stdout);
    };
    const classified = (changedPaths) =>
      classifyPaths({
        changedPaths,
        declaration: { sourceSha: BASE_SHA, sensitive: POLICY.sensitivePaths, high: POLICY.highPaths },
        codeowners: CODEOWNERS,
        baseSha: BASE_SHA,
      });
    const viaCli = (kind, changedPaths) => {
      const tierResult = run('tier', {
        kinds: [{ kind, paths: changedPaths }],
        paths: classified(changedPaths),
        policy: POLICY,
        secondAssessment: NO_ASSESSMENT_NEEDED,
        assignedBy: 'pr-review-cycle/test',
      });
      return run('mode', { tierResult });
    };

    expect(viaCli('docs', [DOC])).toMatchObject({ ok: true, mode: 'light' });
    expect(viaCli('product', [APPROVAL_GATE])).toMatchObject({ ok: true, mode: 'full' });
    expect(run('mode', { tierResult: 'garbage' })).toMatchObject({ ok: false, mode: 'full' });
  });
});
