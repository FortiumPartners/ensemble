'use strict';

/**
 * TRD-023-TEST: Tier from change and floor (PRD scenarios).
 *
 * Validates PRD ACs: AC-012-1, AC-012-2, AC-012-3, AC-013-2, AC-013-3
 * (REQ-012, REQ-013, REQ-015).
 *
 * The Implementation AC tests for the module live in pr-review-tier.test.js.
 * These are the PRD-LEVEL scenarios, and every rule they are graded by is
 * this repository's real one:
 *
 *   - the sensitive and High path lists come from the REAL policy block in
 *     this repository's `REVIEW.md`, parsed by `loadPolicy`;
 *   - the classification is done by the REAL `classifyPaths`, with the
 *     declaration graded against a base SHA the way a review does it, so the
 *     built-in floor and the owner declaration both apply;
 *   - ownership for the "only a code owner may lower a tier" scenario is read
 *     from the REAL `.github/CODEOWNERS`;
 *   - the paths under test are REAL repository paths (a real workflow file, a
 *     real library file, a real doc), so a tier here is a tier a PR on this
 *     repository would actually receive.
 *
 * Scenarios:
 *   - AC-012-1: the tier comes from the kind of change -- Low for docs, copy
 *     and additive-behind-a-flag, Medium for ordinary product changes, High
 *     for sensitive and owner-listed High paths.
 *   - AC-012-2: identical changes from different authors get the same tier.
 *   - AC-012-3: a second assessment that says another person is needed raises
 *     the tier.
 *   - AC-013-2: a proposed tier below the assigned one is ignored; only a
 *     code owner can lower a tier.
 *   - AC-013-3: a PR touching a sensitive area is High and needs two humans,
 *     whatever the classifier concluded.
 */

const fs = require('fs');
const path = require('path');

const { assignTier, effectiveTier } = require('../lib/pr-review-tier');
const { classifyPaths, ownersFor } = require('../lib/pr-review-paths');
const { loadPolicy } = require('../lib/pr-review-policy');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const REVIEW_MD = fs.readFileSync(path.join(REPO_ROOT, 'REVIEW.md'), 'utf8');
const CODEOWNERS = fs.readFileSync(path.join(REPO_ROOT, '.github/CODEOWNERS'), 'utf8');
const BASE_SHA = 'd'.repeat(40);

const POLICY = (() => {
  const loaded = loadPolicy({ text: REVIEW_MD, sourceSha: BASE_SHA, baseSha: BASE_SHA });
  expect(loaded.ok).toBe(true);
  return loaded.policy;
})();

/** Real repository paths, each chosen for what this repository's own policy says about it. */
const A_DOC = 'docs/guides/user-guide.md';
const A_LIBRARY_FILE = 'packages/development/lib/pr-review-votes.js';
const A_WORKFLOW = '.github/workflows/ci.yml';
const A_TEST_FILE = 'packages/development/tests/pr-review-votes.test.js';

/** The classification a review really performs, from the repository's own declaration. */
function classify(changedPaths) {
  return classifyPaths({
    changedPaths,
    declaration: { sourceSha: BASE_SHA, sensitive: POLICY.sensitivePaths, high: POLICY.highPaths },
    codeowners: CODEOWNERS,
    baseSha: BASE_SHA,
  });
}

function tierFor({ kinds, changedPaths, ...rest }) {
  return assignTier({ kinds, paths: classify(changedPaths), ...rest });
}

describe('AC-012-1: the tier comes from the kind of change', () => {
  test('a documentation-only change is Low', () => {
    const result = tierFor({ kinds: [{ kind: 'docs', paths: [A_DOC] }], changedPaths: [A_DOC] });

    expect(result.ok).toBe(true);
    expect(result.tier).toBe('low');
    expect(result.reasons).toContain('all-kinds-low-risk');
  });

  test('copy and additive-behind-a-flag changes are Low too', () => {
    expect(tierFor({ kinds: [{ kind: 'copy', paths: [A_DOC] }], changedPaths: [A_DOC] }).tier).toBe('low');
    expect(
      tierFor({ kinds: [{ kind: 'additive-behind-flag', paths: [A_TEST_FILE] }], changedPaths: [A_TEST_FILE] }).tier
    ).toBe('low');
  });

  test('an ordinary product change is Medium', () => {
    const result = tierFor({ kinds: [{ kind: 'product', paths: [A_TEST_FILE] }], changedPaths: [A_TEST_FILE] });

    expect(result.tier).toBe('medium');
    expect(result.reasons).toContain('product-change');
  });

  test('a real sensitive path from this repository\'s declaration is High', () => {
    const classified = classify([A_WORKFLOW]);
    expect(classified.sensitive).toContain(A_WORKFLOW);

    const result = tierFor({ kinds: [{ kind: 'product', paths: [A_WORKFLOW] }], changedPaths: [A_WORKFLOW] });
    expect(result.tier).toBe('high');
    expect(result.reasons).toContain('sensitive-path');
  });

  test('a path this repository lists as High is High', () => {
    const classified = classify([A_LIBRARY_FILE]);
    expect(classified.high.concat(classified.sensitive)).toContain(A_LIBRARY_FILE);

    const result = tierFor({ kinds: [{ kind: 'product', paths: [A_LIBRARY_FILE] }], changedPaths: [A_LIBRARY_FILE] });
    expect(result.tier).toBe('high');
  });

  test('a docs claim that cites nothing checkable does not buy a cheaper review', () => {
    const result = tierFor({ kinds: [{ kind: 'docs', paths: [] }], changedPaths: [A_LIBRARY_FILE] });

    expect(result.tier).toBe('high');
    expect(result.reasons).toContain('uncited-path');
  });

  test('an unknown kind is read as other, which is Medium', () => {
    const result = tierFor({ kinds: [{ kind: 'harmless-refactor', paths: [A_TEST_FILE] }], changedPaths: [A_TEST_FILE] });

    expect(result.tier).toBe('medium');
    expect(result.reasons).toContain('unknown-kind');
  });
});

describe('AC-012-2: identical changes get identical tiers, whoever wrote them', () => {
  const change = { kinds: [{ kind: 'product', paths: [A_TEST_FILE] }], changedPaths: [A_TEST_FILE] };

  test('two authors, one change, one tier', () => {
    const byMaintainer = tierFor({ ...change, author: 'ldangelo' });
    const byStranger = tierFor({ ...change, author: 'a-first-time-contributor' });

    expect(byMaintainer.tier).toBe(byStranger.tier);
    expect(byMaintainer.reasons).toEqual(byStranger.reasons);
  });

  test('the author changes nothing about the assignment at all', () => {
    const withAuthor = tierFor({ ...change, author: 'ldangelo' });
    const withoutAuthor = tierFor(change);

    expect(withAuthor).toEqual(withoutAuthor);
  });

  test('a sensitive change is High for the maintainer who owns it as well', () => {
    const owners = ownersFor('.github/workflows/ci.yml', CODEOWNERS).owners;
    expect(owners).toContain('@ldangelo');

    expect(tierFor({ kinds: [{ kind: 'docs', paths: [A_WORKFLOW] }], changedPaths: [A_WORKFLOW], author: 'ldangelo' }).tier).toBe('high');
  });
});

describe('AC-012-3: a second assessment that says another person is needed raises the tier', () => {
  test('a Low PR with a second assessment becomes Medium, with the raise recorded', () => {
    const result = tierFor({
      kinds: [{ kind: 'docs', paths: [A_DOC] }],
      changedPaths: [A_DOC],
      secondAssessment: { needsAnotherPerson: true, reason: 'the wording changes a published promise', evidencePaths: [A_DOC] },
    });

    expect(result.tier).toBe('medium');
    expect(result.raised).toEqual([{ from: 'low', to: 'medium', reason: 'the wording changes a published promise' }]);
  });

  test('a Medium PR with a second assessment becomes High', () => {
    const result = tierFor({
      kinds: [{ kind: 'product', paths: [A_TEST_FILE] }],
      changedPaths: [A_TEST_FILE],
      secondAssessment: { needsAnotherPerson: true, reason: 'touches the review loop' },
    });

    expect(result.tier).toBe('high');
  });

  test('negative control: an explicit "no" leaves the tier where it was', () => {
    const result = tierFor({
      kinds: [{ kind: 'docs', paths: [A_DOC] }],
      changedPaths: [A_DOC],
      secondAssessment: { needsAnotherPerson: false, reason: 'a typo fix' },
    });

    expect(result.tier).toBe('low');
    expect(result.raised).toEqual([]);
  });

  test('an assessment that is not a clear "no" raises the tier: the fail-closed direction is more review', () => {
    for (const needsAnotherPerson of [undefined, null, 'no', 0, {}]) {
      const result = tierFor({
        kinds: [{ kind: 'docs', paths: [A_DOC] }],
        changedPaths: [A_DOC],
        secondAssessment: { needsAnotherPerson, reason: 'unclear' },
      });
      expect(result.tier).toBe('medium');
    }
  });
});

describe('AC-013-2: a proposal may raise a tier, never lower it', () => {
  const sensitiveChange = { kinds: [{ kind: 'product', paths: [A_WORKFLOW] }], changedPaths: [A_WORKFLOW] };
  const productChange = { kinds: [{ kind: 'product', paths: [A_TEST_FILE] }], changedPaths: [A_TEST_FILE] };

  test('an agent proposing a cheaper tier is ignored and the proposal is recorded', () => {
    const result = tierFor({ ...productChange, proposedTier: 'low', proposedBy: { login: 'an-agent', isCodeOwner: false } });

    expect(result.tier).toBe('medium');
    expect(result.ignored).toEqual([{ proposedTier: 'low', by: 'an-agent', reason: 'lowering-needs-code-owner' }]);
  });

  test('a proposal to raise the tier is accepted from anyone', () => {
    const result = tierFor({ ...productChange, proposedTier: 'high', proposedBy: { login: 'an-agent', isCodeOwner: false } });

    expect(result.tier).toBe('high');
    expect(result.raised).toEqual([{ from: 'medium', to: 'high', reason: 'proposed-tier' }]);
  });

  test('a code owner of the area may lower an ordinary tier', () => {
    const owner = ownersFor(A_TEST_FILE, CODEOWNERS).owners[0];
    expect(owner).toBe('@ldangelo');

    const result = tierFor({ ...productChange, proposedTier: 'low', proposedBy: { login: owner, isCodeOwner: true } });
    expect(result.tier).toBe('low');
    expect(result.lowered).toEqual([{ from: 'medium', to: 'low', by: owner }]);
  });

  test('not even a code owner may lower a tier below the sensitive floor', () => {
    const result = tierFor({ ...sensitiveChange, proposedTier: 'low', proposedBy: { login: '@ldangelo', isCodeOwner: true } });

    expect(result.tier).toBe('high');
    expect(result.ignored).toEqual([{ proposedTier: 'low', by: '@ldangelo', reason: 'sensitive-floor-holds' }]);
  });
});

describe('AC-013-3: a sensitive PR is High and needs two humans, whatever the classifier said', () => {
  test('a classifier calling a workflow change "docs" does not make it Low', () => {
    const result = tierFor({ kinds: [{ kind: 'docs', paths: [A_WORKFLOW] }], changedPaths: [A_WORKFLOW] });

    expect(result.tier).toBe('high');
    expect(result.floor).toBe('high');
  });

  test('High means two distinct humans, and no waiver touches it', () => {
    const assignment = tierFor({ kinds: [{ kind: 'docs', paths: [A_WORKFLOW] }], changedPaths: [A_WORKFLOW] });
    const effective = effectiveTier({
      assignment,
      policy: { ...POLICY, lowWaiverEnabled: true },
      evidence: { lowPrs: 100, days: 365, reverts: 0, incidents: 0 },
      enabledBy: { login: '@ldangelo', isCodeOwner: true },
      author: 'ldangelo',
    });

    expect(effective.effectiveTier).toBe('high');
    expect(effective.humansRequired).toBe(2);
    expect(effective.waiver.applies).toBe(false);
  });

  test('the sensitivity declaration itself is a sensitive path: a PR editing it is High', () => {
    const classified = classify(['REVIEW.md']);
    expect(classified.declarationChanged).toBe(true);

    expect(tierFor({ kinds: [{ kind: 'docs', paths: ['REVIEW.md'] }], changedPaths: ['REVIEW.md'] }).tier).toBe('high');
  });

  test('the built-in floor holds even when the declaration omits an area', () => {
    const withoutDeclaration = assignTier({
      kinds: [{ kind: 'docs', paths: [A_WORKFLOW] }],
      paths: classifyPaths({ changedPaths: [A_WORKFLOW], baseSha: BASE_SHA }),
    });

    expect(withoutDeclaration.tier).toBe('high');
  });
});
