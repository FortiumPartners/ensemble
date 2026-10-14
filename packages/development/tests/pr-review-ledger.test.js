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
