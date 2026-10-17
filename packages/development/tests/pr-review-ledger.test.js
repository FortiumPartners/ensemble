const { validateLedger, isActionable, dedupeFindings, mergeFindings, scopeViolations } = require('../lib/pr-review-ledger');

function finding(overrides = {}) {
  return {
    id: 'f1',
    source: 'coderabbit',
    locationOrLink: 'src/foo.js:12',
    severity: 'major',
    failureMode: 'null-deref',
    disposition: 'fix',
    evidence: 'stack trace shows null',
    originalTextOrLink: 'https://github.com/org/repo/pull/1#comment-1',
    ...overrides,
  };
}

describe('pr-review-ledger: validateLedger', () => {
  test('complete finding accepted, incomplete rejected', () => {
    const complete = finding({ id: 'f1' });
    const incomplete = finding({ id: 'f2', evidence: '' });
    const result = validateLedger([complete, incomplete]);
    expect(result.ok).toBe(false);
    expect(result.offendingIds).toEqual(['f2']);
  });

  test('fully valid ledger reports ok', () => {
    const result = validateLedger([finding({ id: 'f1' }), finding({ id: 'f2', locationOrLink: 'src/bar.js:1' })]);
    expect(result.ok).toBe(true);
    expect(result.offendingIds).toEqual([]);
  });

  test('rejects an invalid disposition value', () => {
    const result = validateLedger([finding({ id: 'f3', disposition: 'ignore-it' })]);
    expect(result.ok).toBe(false);
    expect(result.offendingIds).toEqual(['f3']);
  });

  test('accepts adjudicate as a valid disposition for uncertain findings', () => {
    const result = validateLedger([finding({ id: 'f4', disposition: 'adjudicate' })]);
    expect(result.ok).toBe(true);
  });
});

describe('pr-review-ledger: isActionable', () => {
  test('unresolved thread is actionable regardless of severity', () => {
    expect(isActionable(finding({ severity: 'minor', unresolvedThread: true, disposition: 'deferred', reason: 'cosmetic' }))).toBe(true);
  });

  test('Critical finding is actionable', () => {
    expect(isActionable(finding({ severity: 'critical' }))).toBe(true);
  });

  test('Major finding is actionable', () => {
    expect(isActionable(finding({ severity: 'major' }))).toBe(true);
  });

  test('Minor finding deferred with a recorded reason is not actionable', () => {
    expect(isActionable(finding({ severity: 'minor', disposition: 'deferred', reason: 'style preference only' }))).toBe(false);
  });

  test('Minor finding without a disposition+reason remains actionable', () => {
    expect(isActionable(finding({ severity: 'minor', disposition: undefined, reason: undefined }))).toBe(true);
  });

  test('nitpick deferred with reason is not actionable', () => {
    expect(isActionable(finding({ severity: 'nitpick', disposition: 'deferred', reason: 'nit' }))).toBe(false);
  });

  test('uncertain finding is marked adjudicate and is never dropped (stays actionable)', () => {
    expect(isActionable(finding({ severity: 'minor', uncertain: true, disposition: 'deferred', reason: 'maybe fine' }))).toBe(true);
  });
});

describe('pr-review-ledger: dedupeFindings', () => {
  test('duplicates on the same location+failureMode share one fix id and retain both links', () => {
    const a = finding({ id: 'f1', locationOrLink: 'src/foo.js:12', failureMode: 'null-deref', originalTextOrLink: 'link-a' });
    const b = finding({ id: 'f2', locationOrLink: 'src/foo.js:12', failureMode: 'null-deref', originalTextOrLink: 'link-b' });
    const result = dedupeFindings([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].fixId).toBeTruthy();
    expect(result[0].originalLinks).toEqual(['link-a', 'link-b']);
  });

  test('distinct findings are left unmerged', () => {
    const a = finding({ id: 'f1', locationOrLink: 'src/foo.js:12', failureMode: 'null-deref' });
    const b = finding({ id: 'f2', locationOrLink: 'src/bar.js:1', failureMode: 'unused-var' });
    const result = dedupeFindings([a, b]);
    expect(result).toHaveLength(2);
  });
});

describe('pr-review-ledger: mergeFindings', () => {
  test('an already-dispositioned finding for the same head is not re-opened', () => {
    const existing = [finding({ id: 'f1', disposition: 'fix', headSha: 'head1' })];
    const incoming = [finding({ id: 'f1', disposition: undefined, headSha: 'head1' })];
    const merged = mergeFindings(existing, incoming, 'head1');
    const f1 = merged.find((f) => f.id === 'f1');
    expect(f1.disposition).toBe('fix');
  });

  test('only genuinely new findings are added', () => {
    const existing = [finding({ id: 'f1', disposition: 'fix', headSha: 'head1' })];
    const incoming = [
      finding({ id: 'f1', disposition: undefined, headSha: 'head1' }),
      finding({ id: 'f2', locationOrLink: 'src/baz.js:9', failureMode: 'leak', headSha: 'head1' }),
    ];
    const merged = mergeFindings(existing, incoming, 'head1');
    expect(merged.map((f) => f.id).sort()).toEqual(['f1', 'f2']);
  });
});

describe('pr-review-ledger: scopeViolations', () => {
  test('a changed file outside the declared scope with no ledger entry is a violation', () => {
    const violations = scopeViolations(['src/foo.js', 'src/unrelated.js'], ['src/foo.js'], []);
    expect(violations).toEqual(['src/unrelated.js']);
  });

  test('a changed out-of-scope file with a ledger entry referencing it is not a violation', () => {
    const ledger = [finding({ id: 'f1', locationOrLink: 'src/unrelated.js:3', file: 'src/unrelated.js' })];
    const violations = scopeViolations(['src/foo.js', 'src/unrelated.js'], ['src/foo.js'], ledger);
    expect(violations).toEqual([]);
  });
});

describe('pr-review-ledger: TRD-002-TEST scenario reconciliation', () => {
  test('uncertain finding is kept -- a finding of uncertain validity is marked adjudicate and remains in the ledger', () => {
    const uncertain = finding({ id: 'f5', uncertain: true, disposition: 'adjudicate' });
    const validation = validateLedger([uncertain]);
    expect(validation.ok).toBe(true);
    expect(validation.offendingIds).not.toContain('f5');
    expect(isActionable(uncertain)).toBe(true);
  });

  test('actionability boundary -- unresolved thread and Major finding are actionable; a Minor finding needs an explicit disposition to defer', () => {
    const unresolvedThread = finding({ id: 'f1', severity: 'minor', unresolvedThread: true });
    const majorFinding = finding({ id: 'f2', severity: 'major' });
    const minorNoDisposition = finding({ id: 'f3', severity: 'minor', disposition: undefined, reason: undefined });
    const minorDeferredWithReason = finding({ id: 'f4', severity: 'minor', disposition: 'deferred', reason: 'cosmetic only' });

    expect(isActionable(unresolvedThread)).toBe(true);
    expect(isActionable(majorFinding)).toBe(true);
    expect(isActionable(minorNoDisposition)).toBe(true);
    expect(isActionable(minorDeferredWithReason)).toBe(false);
  });
});

describe('pr-review-ledger: dedupeFindings collapses onto the most severe member', () => {
  const sameKey = { locationOrLink: 'src/foo.js:12', failureMode: 'null-deref' };
  const deferredMinor = finding({
    ...sameKey,
    id: 'f1',
    severity: 'minor',
    disposition: 'deferred',
    reason: 'style only',
    originalTextOrLink: 'link-minor',
  });
  const critical = finding({
    ...sameKey,
    id: 'f2',
    severity: 'critical',
    disposition: 'fix',
    originalTextOrLink: 'link-critical',
  });

  test.each([
    ['a deferred minor followed by a critical', [deferredMinor, critical]],
    ['a critical followed by a deferred minor', [critical, deferredMinor]],
  ])('%s collapses to one actionable critical entry -- the critical is never dropped', (_label, group) => {
    const result = dedupeFindings(group);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('critical');
    expect(isActionable(result[0])).toBe(true);
    expect(result[0].disposition).not.toBe('deferred');
  });

  test('keeps every original link and a fix id that does not depend on which member survives', () => {
    const minorFirst = dedupeFindings([deferredMinor, critical]);
    expect(minorFirst[0].originalLinks).toEqual(['link-minor', 'link-critical']);
    expect(minorFirst[0].fixId).toBe('f1');

    const criticalFirst = dedupeFindings([critical, deferredMinor]);
    expect(criticalFirst[0].originalLinks).toEqual(['link-critical', 'link-minor']);
    expect(criticalFirst[0].fixId).toBe('f2');
  });

  test('of two actionable members the more severe one survives, in either order', () => {
    const major = finding({ ...sameKey, id: 'f3', severity: 'major', disposition: 'fix' });
    expect(dedupeFindings([major, critical])[0].severity).toBe('critical');
    expect(dedupeFindings([critical, major])[0].severity).toBe('critical');
  });

  test('a group made only of deferred minors stays one deferred, non-actionable entry', () => {
    const nit = finding({ ...sameKey, id: 'f3', severity: 'nitpick', disposition: 'deferred', reason: 'nit' });
    const result = dedupeFindings([deferredMinor, nit]);
    expect(result).toHaveLength(1);
    expect(isActionable(result[0])).toBe(false);
    expect(result[0].disposition).toBe('deferred');
  });

  test('a member that is actionable only through an open thread keeps the merged entry actionable and not deferred', () => {
    const threadMinor = finding({
      ...sameKey,
      id: 'f3',
      severity: 'minor',
      disposition: 'deferred',
      reason: 'cosmetic',
      unresolvedThread: true,
    });
    const result = dedupeFindings([deferredMinor, threadMinor]);
    expect(result).toHaveLength(1);
    expect(isActionable(result[0])).toBe(true);
    expect(result[0].disposition).not.toBe('deferred');
  });

  test('a member of unrecognised severity is actionable, so it outranks a deferred minor', () => {
    const unknown = finding({ ...sameKey, id: 'f3', severity: 'blocker', disposition: 'fix' });
    const result = dedupeFindings([deferredMinor, unknown]);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('blocker');
    expect(isActionable(result[0])).toBe(true);
  });

  test('deduping never lowers actionability: for every ordered pair, merged is actionable iff any member is', () => {
    const pool = [];
    for (const severity of ['critical', 'major', 'minor', 'nitpick']) {
      pool.push(finding({ ...sameKey, id: `${severity}-fix`, severity, disposition: 'fix' }));
      pool.push(
        finding({ ...sameKey, id: `${severity}-deferred`, severity, disposition: 'deferred', reason: 'recorded' })
      );
    }
    for (const first of pool) {
      for (const second of pool) {
        const group = [first, second];
        const [merged] = dedupeFindings(group);
        const label = `${first.id} + ${second.id}`;
        const anyActionable = group.some((member) => isActionable(member));
        expect([label, isActionable(merged)]).toEqual([label, anyActionable]);
        if (anyActionable) expect([label, merged.disposition === 'deferred']).toEqual([label, false]);
      }
    }
  });
});

describe('pr-review-ledger: mergeFindings re-opens on a new head and escalates', () => {
  const key = { locationOrLink: 'src/foo.js:12', failureMode: 'null-deref' };
  const deferredMinor = (overrides = {}) =>
    finding({ ...key, id: 'f1', severity: 'minor', disposition: 'deferred', reason: 'cosmetic', ...overrides });
  const major = (overrides = {}) => finding({ ...key, id: 'f1', severity: 'major', disposition: 'fix', ...overrides });
  const critical = (overrides = {}) =>
    finding({ ...key, id: 'f2', severity: 'critical', disposition: 'fix', ...overrides });

  test('an entry from an older head does not block the same finding re-observed on the new head', () => {
    const merged = mergeFindings(
      [major({ id: 'f1', headSha: 'head-old' })],
      [major({ id: 'f2', headSha: 'head-new' })],
      'head-new'
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('f2');
    expect(merged[0].headSha).toBe('head-new');
  });

  test('an older-head deferral does not swallow a critical re-observed on the new head', () => {
    const merged = mergeFindings([deferredMinor({ headSha: 'old' })], [critical({ headSha: 'new' })], 'new');
    expect(merged).toHaveLength(1);
    expect(merged[0].severity).toBe('critical');
    expect(isActionable(merged[0])).toBe(true);
  });

  test('a deferred minor does not swallow an incoming critical with the same key on the same head', () => {
    const merged = mergeFindings([deferredMinor({ headSha: 'h1' })], [critical({ headSha: 'h1' })], 'h1');
    expect(merged).toHaveLength(1);
    expect(merged[0].severity).toBe('critical');
    expect(isActionable(merged[0])).toBe(true);
  });

  test('an incoming finding that is more severe escalates an actionable entry for the same head', () => {
    const merged = mergeFindings([major({ headSha: 'h1' })], [critical({ headSha: 'h1' })], 'h1');
    expect(merged).toHaveLength(1);
    expect(merged[0].severity).toBe('critical');
  });

  test('an incoming finding that is actionable escalates a deferral for the same head', () => {
    const merged = mergeFindings(
      [deferredMinor({ headSha: 'h1' })],
      [deferredMinor({ id: 'f2', headSha: 'h1', unresolvedThread: true })],
      'h1'
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('f2');
    expect(isActionable(merged[0])).toBe(true);
  });

  test('an incoming deferral of the same severity does not re-open an existing deferral for the same head', () => {
    const merged = mergeFindings(
      [deferredMinor({ headSha: 'h1' })],
      [deferredMinor({ id: 'f2', headSha: 'h1' })],
      'h1'
    );
    expect(merged.map((f) => f.id)).toEqual(['f1']);
  });

  test('a less severe incoming finding never downgrades an existing critical for the same head', () => {
    const merged = mergeFindings(
      [critical({ id: 'f1', headSha: 'h1' })],
      [deferredMinor({ id: 'f2', headSha: 'h1' })],
      'h1'
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('f1');
    expect(merged[0].severity).toBe('critical');
  });

  test('an existing entry with no recorded head counts as bound to the current head and is not re-opened', () => {
    const merged = mergeFindings([major({ id: 'f1' })], [major({ id: 'f2', headSha: 'h1', disposition: undefined })], 'h1');
    expect(merged.map((f) => f.id)).toEqual(['f1']);
    expect(merged[0].disposition).toBe('fix');
  });

  test('with no head argument the head carried by the incoming finding decides whether an entry is stale', () => {
    const merged = mergeFindings([major({ id: 'f1', headSha: 'old' })], [major({ id: 'f2', headSha: 'new' })]);
    expect(merged.map((f) => f.id)).toEqual(['f2']);
  });

  test('an incoming finding observed on a different head than the one being merged is ignored', () => {
    const merged = mergeFindings([], [critical({ headSha: 'some-other-head' })], 'h1');
    expect(merged).toEqual([]);
  });

  test('re-opening replaces in place, adds nothing for an unchanged key, and never mutates the input ledger', () => {
    const existing = [major({ id: 'f1', headSha: 'old' }), major({ id: 'f9', locationOrLink: 'src/other.js:1', headSha: 'old' })];
    const snapshot = JSON.parse(JSON.stringify(existing));
    const merged = mergeFindings(existing, [major({ id: 'f2', headSha: 'new' })], 'new');
    expect(merged.map((f) => f.id)).toEqual(['f2', 'f9']);
    expect(existing).toEqual(snapshot);
  });

  test('two incoming findings with the same key collapse onto the more severe one', () => {
    const merged = mergeFindings(
      [],
      [major({ id: 'f1', headSha: 'h1' }), critical({ id: 'f2', headSha: 'h1' })],
      'h1'
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].severity).toBe('critical');
  });
});

// ---------------------------------------------------------------------------
// Round 2. A missing, non-array or ill-typed input is never read as "an empty
// ledger" or "nothing to see": it is rejected, and a finding that cannot be
// read stays actionable.
// ---------------------------------------------------------------------------

/** What a payload can carry where something else was expected. */
const WRONG_VALUES = [undefined, null, '', '   ', 0, 1, -1, 0.5, NaN, Infinity, true, false, 'x', {}, [], [[]], ['x'], [null]];
/** jest spreads the rows of a table whose every row is an array; wrapping each list keeps it one argument. */
const asRows = (lists) => lists.map((list) => [list]);

const NOT_ARRAYS = WRONG_VALUES.filter((value) => !Array.isArray(value));
/** Arrays that are not a list of finding objects. */
const ARRAYS_OF_NON_OBJECTS = [[[]], ['x'], [null], [5], [true], [undefined]];
const REQUIRED = ['id', 'source', 'locationOrLink', 'severity', 'failureMode', 'disposition', 'evidence', 'originalTextOrLink'];

const isRejection = (result) =>
  result !== null &&
  typeof result === 'object' &&
  !Array.isArray(result) &&
  result.ok === false &&
  typeof result.reason === 'string' &&
  result.reason.trim() !== '';

describe('pr-review-ledger: validateLedger rejects what it cannot read', () => {
  test.each(NOT_ARRAYS)('findings that is %p is rejected with a reason, never ok', (findings) => {
    const result = validateLedger(findings);
    expect(result.ok).toBe(false);
    expect(typeof result.reason).toBe('string');
    expect(result.offendingIds).toEqual([]);
  });

  test('an empty array is a valid, empty ledger', () => {
    expect(validateLedger([])).toEqual({ ok: true, offendingIds: [] });
  });

  test.each([null, 5, 'x', true, [], [[]], undefined])('an entry that is not an object (%p) is an offending entry', (entry) => {
    const result = validateLedger([finding({ id: 'f1' }), entry]);
    expect(result.ok).toBe(false);
    expect(result.offendingIds).toHaveLength(1);
  });

  describe.each(REQUIRED.filter((field) => field !== 'id' && field !== 'disposition'))('required text field %s', (field) => {
    test.each([undefined, null, '', '   ', 0, 5, true, false, {}, [], ['text']])('%p is not usable', (value) => {
      const result = validateLedger([finding({ id: 'f9', [field]: value })]);
      expect(result.ok).toBe(false);
      expect(result.offendingIds).toEqual(['f9']);
    });
  });

  test.each([undefined, null, '', '   ', true, false, {}, [], NaN, Infinity])('an id of %p is not usable', (id) => {
    expect(validateLedger([finding({ id })]).ok).toBe(false);
  });

  test.each(['f1', 'finding-7', 12345, 0])('an id of %p is usable', (id) => {
    expect(validateLedger([finding({ id })]).ok).toBe(true);
  });

  test.each(['fix', 'duplicate', 'not-applicable', 'deferred', 'adjudicate'])('disposition %s is valid', (disposition) => {
    expect(validateLedger([finding({ disposition })]).ok).toBe(true);
  });

  test.each(['FIX', 'Fix', ' fix', 'fix ', 'ignore-it', 'defer', 'dismissed', 5, true, {}, [], ['fix'], null, undefined, ''])(
    'disposition %p is not one of the allowed set',
    (disposition) => {
      const result = validateLedger([finding({ id: 'f9', disposition })]);
      expect(result.ok).toBe(false);
      expect(result.offendingIds).toEqual(['f9']);
    }
  );

  test.each(['unresolvedThread', 'uncertain'])('%s, when present, must be a boolean', (flag) => {
    for (const value of ['true', 'false', 'yes', 1, 0, null, {}, []]) {
      expect([flag, value, validateLedger([finding({ [flag]: value })]).ok]).toEqual([flag, value, false]);
    }
    for (const value of [true, false, undefined]) {
      expect([flag, value, validateLedger([finding({ [flag]: value })]).ok]).toEqual([flag, value, true]);
    }
  });

  test('a hole in a sparse list is an unreadable entry, never a skipped one', () => {
    const sparse = [finding({ id: 'f1' })];
    sparse[2] = finding({ id: 'f3', locationOrLink: 'src/other.js:1' });
    expect(validateLedger(sparse).ok).toBe(false);
    expect(isRejection(dedupeFindings(sparse))).toBe(true);
    expect(isRejection(mergeFindings(sparse, [], 'h1'))).toBe(true);
    expect(isRejection(mergeFindings([], sparse, 'h1'))).toBe(true);
    expect(isRejection(scopeViolations(['src/a.js'], [], sparse))).toBe(true);
    const sparseFiles = ['src/a.js'];
    sparseFiles[2] = 'src/c.js';
    expect(isRejection(scopeViolations(sparseFiles, [], []))).toBe(true);
    expect(isRejection(scopeViolations(['src/a.js'], sparseFiles, []))).toBe(true);
  });

  test('an entry that only carries its fields on a smuggled __proto__ key is not a finding', () => {
    const smuggled = JSON.parse(
      `[{"__proto__":${JSON.stringify(finding())}}, {"constructor":${JSON.stringify(finding())}}]`
    );
    expect(validateLedger(smuggled).ok).toBe(false);
  });
});

describe('pr-review-ledger: isActionable keeps what it cannot read actionable', () => {
  const deferredMinor = (overrides = {}) =>
    finding({ severity: 'minor', disposition: 'deferred', reason: 'cosmetic only', ...overrides });

  test.each([undefined, null, [], 'x', 5, true, false, ''])('a finding that is %p cannot be dismissed: it is actionable', (value) => {
    expect(isActionable(value)).toBe(true);
  });

  test('control: a minor finding deferred with a reason is not actionable', () => {
    expect(isActionable(deferredMinor())).toBe(false);
    expect(isActionable(deferredMinor({ severity: 'nitpick' }))).toBe(false);
  });

  test.each(['unresolvedThread', 'uncertain'])('%s that is anything but false or absent keeps a deferral actionable', (flag) => {
    for (const value of [true, 'true', 'false', 'yes', 1, 0, null, {}, []]) {
      expect([flag, value, isActionable(deferredMinor({ [flag]: value }))]).toEqual([flag, value, true]);
    }
    for (const value of [false, undefined]) {
      expect([flag, value, isActionable(deferredMinor({ [flag]: value }))]).toEqual([flag, value, false]);
    }
  });

  test.each(['', '   ', '\n\t', 5, 0, true, {}, [], ['reason'], null, undefined])(
    'a deferral whose reason is %p is not a recorded reason: the finding stays actionable',
    (reason) => {
      expect(isActionable(deferredMinor({ reason }))).toBe(true);
    }
  );

  test.each(['fix', 'duplicate', 'not-applicable', 'adjudicate', 'DEFERRED', ' deferred', 'deferred ', 'defer', '', undefined, null, 5])(
    'a minor finding with disposition %p is not a deferral, so it stays actionable',
    (disposition) => {
      expect(isActionable(deferredMinor({ disposition }))).toBe(true);
    }
  );

  test.each([5, 0, null, undefined, {}, [], '', 'blocker', 'urgent', ' minor', 'minor ', ['minor'], ['nitpick']])(
    'a severity of %p is unrecognised: the finding is actionable even when deferred with a reason',
    (severity) => {
      expect(isActionable(deferredMinor({ severity }))).toBe(true);
    }
  );

  test('severity letter case is ignored', () => {
    expect(isActionable(deferredMinor({ severity: 'Minor' }))).toBe(false);
    expect(isActionable(deferredMinor({ severity: 'NITPICK' }))).toBe(false);
    expect(isActionable(deferredMinor({ severity: 'CRITICAL' }))).toBe(true);
    expect(isActionable(deferredMinor({ severity: 'Major' }))).toBe(true);
  });
});

describe('pr-review-ledger: dedupeFindings, mergeFindings and scopeViolations reject input they cannot read', () => {
  const GOOD = [finding({ headSha: 'h1' })];

  test.each(NOT_ARRAYS)('dedupeFindings of %p is a rejection, not an empty list', (findings) => {
    expect(isRejection(dedupeFindings(findings))).toBe(true);
  });

  test.each(asRows(ARRAYS_OF_NON_OBJECTS))('dedupeFindings of %p is a rejection: every entry must be an object', (findings) => {
    expect(isRejection(dedupeFindings(findings))).toBe(true);
  });

  test('dedupeFindings of an empty array is an empty list', () => {
    expect(dedupeFindings([])).toEqual([]);
  });

  test.each(NOT_ARRAYS)('mergeFindings with an existing ledger of %p is a rejection, not an empty ledger', (existing) => {
    expect(isRejection(mergeFindings(existing, GOOD, 'h1'))).toBe(true);
  });

  test.each(NOT_ARRAYS)('mergeFindings with incoming findings of %p is a rejection: findings are never silently dropped', (incoming) => {
    expect(isRejection(mergeFindings(GOOD, incoming, 'h1'))).toBe(true);
  });

  test.each(asRows(ARRAYS_OF_NON_OBJECTS))('mergeFindings with %p on either side is a rejection', (list) => {
    expect(isRejection(mergeFindings(list, GOOD, 'h1'))).toBe(true);
    expect(isRejection(mergeFindings(GOOD, list, 'h1'))).toBe(true);
  });

  test.each(['', '   ', 0, 5, true, false, null, {}, [], ['h1']])('mergeFindings with a head of %p is a rejection', (headSha) => {
    expect(isRejection(mergeFindings(GOOD, GOOD, headSha))).toBe(true);
  });

  test('mergeFindings still accepts an absent head and merges on the head the incoming finding carries', () => {
    expect(Array.isArray(mergeFindings(GOOD, GOOD))).toBe(true);
    expect(Array.isArray(mergeFindings([], GOOD, 'h1'))).toBe(true);
  });

  test.each([5, true, {}, [], ['h1']])('a finding whose own headSha is %p is a rejection in a merge', (headSha) => {
    expect(isRejection(mergeFindings([finding({ headSha })], GOOD, 'h1'))).toBe(true);
    expect(isRejection(mergeFindings(GOOD, [finding({ headSha })], 'h1'))).toBe(true);
  });

  test.each([null, '', '   ', undefined])('a finding whose own headSha is %p carries no head, as before', (headSha) => {
    expect(Array.isArray(mergeFindings([finding({ headSha })], GOOD, 'h1'))).toBe(true);
  });

  describe.each([
    ['changedFiles', (value) => scopeViolations(value, ['src/a.js'], [])],
    ['scope', (value) => scopeViolations(['src/a.js'], value, [])],
    ['ledger', (value) => scopeViolations(['src/a.js'], ['src/a.js'], value)],
  ])('scopeViolations %s', (_name, call) => {
    test.each(NOT_ARRAYS)('%p is a rejection, never an empty violation list', (value) => {
      expect(isRejection(call(value))).toBe(true);
    });
  });

  test.each(asRows([[5], [null], [''], ['   '], [{}], [['src/a.js']], [undefined]]))(
    'scopeViolations with %p among the changed files or the scope is a rejection',
    (entries) => {
      expect(isRejection(scopeViolations(entries, ['src/a.js'], []))).toBe(true);
      expect(isRejection(scopeViolations(['src/a.js'], entries, []))).toBe(true);
    }
  );

  test.each(asRows(ARRAYS_OF_NON_OBJECTS))('scopeViolations with a ledger of %p is a rejection', (ledger) => {
    expect(isRejection(scopeViolations(['src/a.js'], [], ledger))).toBe(true);
  });

  test('scopeViolations of valid input is still a plain array, empty when nothing is out of scope', () => {
    expect(scopeViolations([], [], [])).toEqual([]);
    expect(scopeViolations(['src/a.js'], ['src/a.js'], [])).toEqual([]);
    expect(scopeViolations(['src/a.js', 'src/b.js'], ['src/a.js'], [])).toEqual(['src/b.js']);
  });

  test('a ledger entry covers a file only through a text file or location, never through a value of another type', () => {
    const cover = (entry) => scopeViolations(['src/b.js'], [], [entry]);
    expect(cover(finding({ file: 'src/b.js', locationOrLink: 'src/other.js:1' }))).toEqual([]);
    expect(cover(finding({ file: undefined, locationOrLink: 'src/b.js:7' }))).toEqual([]);
    expect(cover(finding({ file: '', locationOrLink: 'src/b.js:7' }))).toEqual([]);
    expect(cover(finding({ file: 5, locationOrLink: 'src/other.js:1' }))).toEqual(['src/b.js']);
    expect(cover(finding({ file: undefined, locationOrLink: 5 }))).toEqual(['src/b.js']);
    expect(cover(finding({ file: undefined, locationOrLink: ['src/b.js'] }))).toEqual(['src/b.js']);
    expect(cover(finding({ file: {}, locationOrLink: undefined }))).toEqual(['src/b.js']);
    expect(cover(finding({ file: undefined, locationOrLink: '' }))).toEqual(['src/b.js']);
  });
});

describe('pr-review-ledger: adversarial sweep -- no invalid input yields a clean result', () => {
  const BAD_OBJECT_LISTS = [...NOT_ARRAYS, ...ARRAYS_OF_NON_OBJECTS];
  // A list of file names is invalid when an entry is not text or is blank; a list of strings is fine.
  const BAD_STRING_LISTS = [...NOT_ARRAYS, [[]], [null], [5], [true], [undefined], [''], ['   '], [{}], [['a']]];
  const BAD_HEADS = ['', '   ', 0, 1, -1, 0.5, NaN, Infinity, true, false, null, {}, [], [[]], ['x'], [null]];

  // Every call below passes one invalid argument and otherwise valid ones. `clean` says what a clean result looks like.
  const calls = [
    ...BAD_OBJECT_LISTS.map((value) => ['validateLedger', () => validateLedger(value), (r) => r.ok === true, value]),
    ...BAD_OBJECT_LISTS.map((value) => ['dedupeFindings', () => dedupeFindings(value), Array.isArray, value]),
    ...BAD_OBJECT_LISTS.map((value) => ['mergeFindings existing', () => mergeFindings(value, [], 'h1'), Array.isArray, value]),
    ...BAD_OBJECT_LISTS.map((value) => ['mergeFindings incoming', () => mergeFindings([], value, 'h1'), Array.isArray, value]),
    ...BAD_HEADS.map((value) => ['mergeFindings head', () => mergeFindings([], [], value), Array.isArray, value]),
    ...BAD_STRING_LISTS.map((value) => ['scopeViolations changedFiles', () => scopeViolations(value, [], []), Array.isArray, value]),
    ...BAD_STRING_LISTS.map((value) => ['scopeViolations scope', () => scopeViolations([], value, []), Array.isArray, value]),
    ...BAD_OBJECT_LISTS.map((value) => ['scopeViolations ledger', () => scopeViolations([], [], value), Array.isArray, value]),
    ...WRONG_VALUES.map((value) => ['isActionable', () => isActionable(value), (r) => r === false, value]),
  ];

  test('control: valid input is clean, so the sweep below can fail', () => {
    expect(validateLedger([finding()]).ok).toBe(true);
    expect(Array.isArray(dedupeFindings([finding()]))).toBe(true);
    expect(Array.isArray(mergeFindings([], [finding()], 'h1'))).toBe(true);
    expect(Array.isArray(scopeViolations(['a'], ['a'], []))).toBe(true);
    expect(isActionable(finding({ severity: 'minor', disposition: 'deferred', reason: 'cosmetic' }))).toBe(false);
  });

  test.each(calls.map((call) => [call[0], call[3], call[1], call[2]]))('%s with %p is never clean', (_name, _value, call, clean) => {
    let result;
    try {
      result = call();
    } catch {
      return; // throwing is not a clean result either
    }
    expect(clean(result)).toBe(false);
  });

  test('a ledger payload that smuggles __proto__ keys never yields a clean result', () => {
    const smuggled = JSON.parse(`[{"__proto__":${JSON.stringify(finding())}}]`);
    expect(validateLedger(smuggled).ok).toBe(false);
    const merged = mergeFindings(smuggled, smuggled, 'h1');
    expect(Array.isArray(merged) ? merged.every((entry) => validateLedger([entry]).ok === false) : true).toBe(true);
  });
});
