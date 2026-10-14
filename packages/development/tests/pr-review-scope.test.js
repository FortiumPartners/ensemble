const { resolveReviewScope, isObjectId } = require('../lib/pr-review-scope');
const { deriveStatus } = require('../lib/pr-review-status');

// Full object ids -- the only shape the resolver accepts: 40 hex (SHA-1) or 64 hex (SHA-256).
const BASE = '8b87a6d71146cd2e36e09c4fc265b6bb336f8798';
const HEAD = 'b8fe66aeb70b304237e584311a2b481a3c990f91';
const MERGE_BASE = '914369d8ebedb871a1f1f619f3ad410f48350642';
const PR_BASE = 'fc339eb496cd68ecab4ccab79cdcc65c540fd20c';
const PARENT_TIP = '2aa6fdf7dda287fe5b6212acb2e01a1c7ec4def7';
const SHA256_HEAD = 'ab12'.repeat(16);

describe('pr-review-scope: resolveReviewScope', () => {
  test('base and head recorded -- both SHAs are returned and the range is base..head', () => {
    const result = resolveReviewScope({ baseSha: BASE, headSha: HEAD });
    expect(result).toEqual({ ok: true, baseSha: BASE, headSha: HEAD, range: `${BASE}..${HEAD}` });
  });

  test('falls back to a computed merge-base when no explicit base SHA is recorded', () => {
    const result = resolveReviewScope({ mergeBaseSha: MERGE_BASE, headSha: HEAD });
    expect(result.ok).toBe(true);
    expect(result.baseSha).toBe(MERGE_BASE);
    expect(result.range).toBe(`${MERGE_BASE}..${HEAD}`);
  });

  test('unknown base blocks -- no base SHA or merge-base produces REVIEW_BLOCKED naming the missing base, no range', () => {
    const result = resolveReviewScope({ headSha: HEAD });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('REVIEW_BLOCKED');
    expect(result.missing).toContain('baseSha');
    expect(result.invalid).toEqual([]);
    expect(result.range).toBeUndefined();
  });

  test('unknown head blocks -- a missing head SHA is named', () => {
    const result = resolveReviewScope({ baseSha: BASE });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('REVIEW_BLOCKED');
    expect(result.missing).toContain('headSha');
    expect(result.invalid).toEqual([]);
  });

  test('never substitutes a guessed base from a bare ref name', () => {
    const result = resolveReviewScope({ baseRef: 'main', headSha: HEAD });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('REVIEW_BLOCKED');
    expect(result.missing).toContain('baseSha');
    expect(result.baseSha).toBeUndefined();
  });

  test('stacked phase excludes later phases -- the range starts at the parent phase tip', () => {
    const result = resolveReviewScope({
      baseSha: BASE,
      parentPhaseTipSha: PARENT_TIP,
      headSha: HEAD,
    });
    expect(result.ok).toBe(true);
    expect(result.baseSha).toBe(PARENT_TIP);
    expect(result.range).toBe(`${PARENT_TIP}..${HEAD}`);
  });

  test('prBaseSha resolves the base when no explicit baseSha or mergeBaseSha is given', () => {
    const result = resolveReviewScope({ prBaseSha: PR_BASE, headSha: HEAD });
    expect(result.ok).toBe(true);
    expect(result.baseSha).toBe(PR_BASE);
  });

  test('with no input at all both facts are missing and nothing is invalid', () => {
    const result = resolveReviewScope();
    expect(result).toEqual({ ok: false, status: 'REVIEW_BLOCKED', missing: ['baseSha', 'headSha'], invalid: [] });
  });
});

// ---------------------------------------------------------------------------
// Base precedence. Several optional bases can be supplied at once, and they
// legitimately differ: the PR base branch tip (prBaseSha) moves on every merge
// into it, the fork point (mergeBaseSha) does not, and a stacked phase's parent
// tip (parentPhaseTipSha) is by design neither. A range that starts at the
// moving tip contains the REVERSE of every commit that landed on the base branch
// after the fork, so it is not a base-correct review of the head.
// ---------------------------------------------------------------------------

describe('pr-review-scope: the base is the first provided candidate in a fixed precedence', () => {
  // Stated independently of the module: the stacked-phase tip, the explicit base, the fork point, the base branch tip.
  const PRECEDENCE = ['parentPhaseTipSha', 'baseSha', 'mergeBaseSha', 'prBaseSha'];
  const VALUES = { parentPhaseTipSha: PARENT_TIP, baseSha: BASE, mergeBaseSha: MERGE_BASE, prBaseSha: PR_BASE };

  /** Every subset of the four candidates, in the order PRECEDENCE lists them. */
  const SUBSETS = Array.from({ length: 2 ** PRECEDENCE.length }, (_unused, mask) => PRECEDENCE.filter((_name, bit) => mask & (1 << bit)));

  const resolveWith = (names, extra = {}) => resolveReviewScope({ headSha: HEAD, ...Object.fromEntries(names.map((name) => [name, VALUES[name]])), ...extra });

  test('the fork point wins over the moving base branch tip: the range is mergeBase..head, not prBase..head', () => {
    const result = resolveReviewScope({ headSha: HEAD, mergeBaseSha: MERGE_BASE, prBaseSha: PR_BASE });
    expect(result).toEqual({ ok: true, baseSha: MERGE_BASE, headSha: HEAD, range: `${MERGE_BASE}..${HEAD}` });
  });

  test('the order the caller lists the bases in changes nothing', () => {
    const forward = resolveReviewScope({ headSha: HEAD, mergeBaseSha: MERGE_BASE, prBaseSha: PR_BASE });
    const reversed = resolveReviewScope({ prBaseSha: PR_BASE, mergeBaseSha: MERGE_BASE, headSha: HEAD });
    expect(reversed).toEqual(forward);
  });

  test('the sweep is complete: 16 subsets of the four candidates, each resolving to the first one provided or naming the missing base', () => {
    expect(SUBSETS).toHaveLength(16);
    for (const names of SUBSETS) {
      const label = names.join('+') || 'no base';
      const result = resolveWith(names);
      if (names.length === 0) {
        expect([label, result]).toEqual([label, { ok: false, status: 'REVIEW_BLOCKED', missing: ['baseSha'], invalid: [] }]);
      } else {
        expect([label, result]).toEqual([label, { ok: true, baseSha: VALUES[names[0]], headSha: HEAD, range: `${VALUES[names[0]]}..${HEAD}` }]);
      }
    }
  });

  test('every candidate is the base when it is the only one, so no rung of the order is unreachable', () => {
    for (const name of PRECEDENCE) expect([name, resolveWith([name]).baseSha]).toEqual([name, VALUES[name]]);
  });

  test('candidates that differ are never a conflict: the stacked tip, the fork point and a moved base branch tip all legitimately differ', () => {
    // A block here would break the stacked case (the parent tip differs from the trunk bases by design) and every PR whose
    // base branch has advanced since the fork (prBaseSha differs from mergeBaseSha).
    const result = resolveWith(PRECEDENCE);
    expect(result.ok).toBe(true);
    expect(result.baseSha).toBe(PARENT_TIP);
    expect(new Set(PRECEDENCE.map((name) => VALUES[name])).size).toBe(PRECEDENCE.length);
  });

  test('an invalid candidate blocks whatever its rank: a valid one above or below it never rescues it', () => {
    for (const bad of PRECEDENCE) {
      for (const names of SUBSETS.filter((subset) => !subset.includes(bad))) {
        const result = resolveWith(names, { [bad]: 'main' });
        expect([bad, names.join('+'), result.ok, result.invalid]).toEqual([bad, names.join('+'), false, [bad]]);
        expect(result.range).toBeUndefined();
      }
    }
  });
});

describe('pr-review-scope: only full object ids resolve, never a moving ref', () => {
  test('bare refs as base and head are rejected instead of resolved into a moving range', () => {
    const result = resolveReviewScope({ baseSha: 'main', headSha: 'HEAD' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('REVIEW_BLOCKED');
    expect(result.invalid).toEqual(['baseSha', 'headSha']);
    expect(result.missing).toEqual([]);
    expect(result.range).toBeUndefined();
  });

  const NOT_OBJECT_IDS = [
    ['a branch name', 'main'],
    ['a remote-tracking ref', 'origin/main'],
    ['a relative ref', 'HEAD~1'],
    ['an abbreviated SHA', HEAD.slice(0, 7)],
    ['a 39-character hex string', HEAD.slice(0, 39)],
    ['a 41-character hex string', `${HEAD}a`],
    ['a 63-character hex string', SHA256_HEAD.slice(0, 63)],
    ['a 65-character hex string', `${SHA256_HEAD}a`],
    ['non-hex characters at full length', 'g'.repeat(40)],
    ['a SHA padded with whitespace', ` ${HEAD}`],
    ['a SHA with a trailing newline', `${HEAD}\n`],
    ['a number', 12345],
    ['an array wrapping a valid SHA', [HEAD]],
  ];

  test.each(NOT_OBJECT_IDS)('%s is rejected as headSha', (_label, value) => {
    const result = resolveReviewScope({ baseSha: BASE, headSha: value });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('REVIEW_BLOCKED');
    expect(result.invalid).toEqual(['headSha']);
    expect(result.missing).toEqual([]);
    expect(result.range).toBeUndefined();
  });

  test.each(NOT_OBJECT_IDS)('%s is rejected as baseSha', (_label, value) => {
    const result = resolveReviewScope({ baseSha: value, headSha: HEAD });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('REVIEW_BLOCKED');
    expect(result.invalid).toEqual(['baseSha']);
    expect(result.missing).toEqual([]);
    expect(result.range).toBeUndefined();
  });

  test('accepts 40-hex and 64-hex object ids, in either letter case', () => {
    expect(resolveReviewScope({ baseSha: BASE.toUpperCase(), headSha: HEAD }).ok).toBe(true);
    const sha256 = resolveReviewScope({ baseSha: SHA256_HEAD, headSha: SHA256_HEAD.toUpperCase() });
    expect(sha256.ok).toBe(true);
    expect(sha256.range).toBe(`${SHA256_HEAD}..${SHA256_HEAD.toUpperCase()}`);
  });

  test.each(['mergeBaseSha', 'prBaseSha', 'parentPhaseTipSha'])(
    'a provided %s that is not a full object id blocks even when baseSha and headSha are valid',
    (key) => {
      const result = resolveReviewScope({ baseSha: BASE, headSha: HEAD, [key]: 'phase-1-branch' });
      expect(result.ok).toBe(false);
      expect(result.status).toBe('REVIEW_BLOCKED');
      expect(result.invalid).toEqual([key]);
      expect(result.range).toBeUndefined();
    }
  );

  test.each(['mergeBaseSha', 'prBaseSha', 'parentPhaseTipSha'])(
    'a blank %s counts as not provided, so it neither blocks nor changes the base',
    (key) => {
      for (const blank of ['', '   ', null, undefined]) {
        const result = resolveReviewScope({ baseSha: BASE, headSha: HEAD, [key]: blank });
        expect(result).toEqual({ ok: true, baseSha: BASE, headSha: HEAD, range: `${BASE}..${HEAD}` });
      }
    }
  );

  test('an invalid optional base is reported as invalid, not silently ignored and not also as missing', () => {
    const result = resolveReviewScope({ mergeBaseSha: 'main' });
    expect(result.ok).toBe(false);
    expect(result.invalid).toEqual(['mergeBaseSha']);
    expect(result.missing).toEqual(['headSha']);
  });
});

// ---------------------------------------------------------------------------
// Adversarial sweep. Every input below is wrong in some way; the rule is fail
// closed: only a base and a head that are both full object ids resolve to a
// range, and nothing else -- in any slot, of any type -- ever does.
// ---------------------------------------------------------------------------

const ADVERSARIAL = [
  ['a branch name', 'main'],
  ['HEAD', 'HEAD'],
  ['a remote-tracking ref', 'origin/main'],
  ['a relative ref', 'HEAD~1'],
  ['an abbreviated SHA', HEAD.slice(0, 7)],
  ['39 hex characters', HEAD.slice(0, 39)],
  ['41 hex characters', `${HEAD}a`],
  ['63 hex characters', SHA256_HEAD.slice(0, 63)],
  ['65 hex characters', `${SHA256_HEAD}a`],
  ['two ids joined together', `${HEAD}${BASE}`],
  ['non-hex characters at full length', 'g'.repeat(40)],
  ['a 0x prefix', `0x${HEAD.slice(2)}`],
  ['padding', ` ${HEAD}`],
  ['a trailing newline', `${HEAD}\n`],
  ['an embedded newline', `${HEAD.slice(0, 20)}\n${HEAD.slice(20)}`],
  ['a number', 12345],
  ['zero', 0],
  ['NaN', NaN],
  ['true', true],
  ['false', false],
  ['an empty object', {}],
  ['an object whose toString yields a valid id', { toString: () => HEAD }],
  ['an empty array', []],
  ['an array wrapping a valid id', [HEAD]],
  ['a String object wrapping a valid id', Object(HEAD)],
  ['a function', () => HEAD],
];

const VALID = [
  ['a lowercase 40-hex id', HEAD],
  ['an uppercase 40-hex id', HEAD.toUpperCase()],
  ['a lowercase 64-hex id', SHA256_HEAD],
  ['an uppercase 64-hex id', SHA256_HEAD.toUpperCase()],
];

/** Independent of the module's own pattern: a string of exactly 40 or 64 hex digits. */
const isFullObjectId = (value) =>
  typeof value === 'string' && (value.length === 40 || value.length === 64) && [...value].every((char) => '0123456789abcdefABCDEF'.includes(char));

describe('pr-review-scope: isObjectId', () => {
  test('accepts exactly the strings the independent oracle accepts, over valid and adversarial values alike', () => {
    const grid = [...VALID, ...ADVERSARIAL];
    // The control: the grid really contains both kinds, so an always-true or always-false isObjectId cannot pass.
    expect(grid.filter(([, value]) => isFullObjectId(value)).length).toBe(VALID.length);
    expect(grid.filter(([, value]) => !isFullObjectId(value)).length).toBe(ADVERSARIAL.length);
    for (const [label, value] of grid) expect([label, isObjectId(value)]).toEqual([label, isFullObjectId(value)]);
  });

  test('never throws, whatever it is given', () => {
    for (const value of [undefined, null, Object.create(null), Symbol('x'), 10n, ...ADVERSARIAL.map(([, v]) => v)]) {
      expect(() => isObjectId(value)).not.toThrow();
    }
  });
});

describe('pr-review-scope: adversarial sweep over resolveReviewScope', () => {
  const SLOTS = ['baseSha', 'headSha', 'mergeBaseSha', 'prBaseSha', 'parentPhaseTipSha'];

  test('no adversarial value in any slot resolves a range: the slot is named invalid and nothing is returned to review', () => {
    const leaked = [];
    for (const slot of SLOTS) {
      for (const [label, value] of ADVERSARIAL) {
        const result = resolveReviewScope({ baseSha: BASE, headSha: HEAD, [slot]: value });
        const refused = result.ok === false && result.status === 'REVIEW_BLOCKED' && result.invalid.includes(slot);
        const nothingToReview = result.range === undefined && result.baseSha === undefined && result.headSha === undefined;
        if (!(refused && nothingToReview)) leaked.push(`${slot}=${label}`);
      }
    }
    expect(leaked).toEqual([]);
  });

  test('every valid id in the base and head slots still resolves, so the sweep above is not vacuous', () => {
    for (const [label, value] of VALID) {
      expect([label, resolveReviewScope({ baseSha: BASE, headSha: value }).ok]).toEqual([label, true]);
      expect([label, resolveReviewScope({ baseSha: value, headSha: HEAD }).ok]).toEqual([label, true]);
    }
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'baseSha'],
    ['a number', 7],
    ['true', true],
    ['an empty array', []],
    ['an array of the two ids', [BASE, HEAD]],
    ['a function', () => ({ baseSha: BASE, headSha: HEAD })],
  ])('%s as the whole input is blocked with both facts missing', (_label, input) => {
    expect(resolveReviewScope(input)).toEqual({ ok: false, status: 'REVIEW_BLOCKED', missing: ['baseSha', 'headSha'], invalid: [] });
  });

  test('a bad value is never rescued by a good one in another slot', () => {
    for (const [label, value] of ADVERSARIAL) {
      const everyBaseSlotBad = resolveReviewScope({ headSha: HEAD, parentPhaseTipSha: value, baseSha: BASE, prBaseSha: PR_BASE, mergeBaseSha: MERGE_BASE });
      expect([label, everyBaseSlotBad.ok]).toEqual([label, false]);
    }
  });
});

describe('pr-review-scope and pr-review-status never disagree about what a SHA is', () => {
  const statusFacts = (overrides) => ({
    baseSha: BASE,
    headSha: HEAD,
    reviewedHeadSha: HEAD,
    findingCounts: { total: 0, actionable: 0, deferred: 0 },
    tests: { passed: true, skipped: false },
    remotePhase: 'REMOTE_REVIEW_COMPLETE',
    roundsUsed: 0,
    ...overrides,
  });
  const localComplete = (facts) => deriveStatus(facts).localPhase === 'LOCAL_REVIEW_COMPLETE';

  test('for every candidate value, a head is accepted by the one exactly when it is accepted by the other', () => {
    for (const [label, value] of [...VALID, ...ADVERSARIAL]) {
      const byScope = resolveReviewScope({ baseSha: BASE, headSha: value }).ok;
      const byStatus = localComplete(statusFacts({ headSha: value, reviewedHeadSha: value }));
      expect([label, byScope]).toEqual([label, byStatus]);
    }
  });

  test('for every candidate value, a base is accepted by the one exactly when it is accepted by the other', () => {
    for (const [label, value] of [...VALID, ...ADVERSARIAL]) {
      const byScope = resolveReviewScope({ baseSha: value, headSha: HEAD }).ok;
      const byStatus = localComplete(statusFacts({ baseSha: value }));
      expect([label, byScope]).toEqual([label, byStatus]);
    }
  });

  test('for every candidate value, a tree fact is read by the grader exactly when it is a full object id (the same rule)', () => {
    for (const side of ['reviewedTreeSha', 'headTreeSha']) {
      for (const [label, value] of [...VALID, ...ADVERSARIAL]) {
        const result = deriveStatus(statusFacts({ [side]: value }));
        // An unreadable tree is a missing fact (blocked); a readable one leaves the otherwise complete facts complete.
        expect([side, label, result.next !== 'supply-review-facts', result.localPhase === 'LOCAL_REVIEW_COMPLETE']).toEqual([
          side,
          label,
          isObjectId(value),
          isObjectId(value),
        ]);
      }
    }
  });
});
