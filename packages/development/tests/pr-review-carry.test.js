const crypto = require('crypto');
const { planCarry, recordVerdicts, stampLedger, normalizeClaim, REASONS, SETTLED_OUTCOMES } = require('../lib/pr-review-carry');
const { mergeFindings, clearFixedFindings } = require('../lib/pr-review-ledger');
const { scoreEval } = require('../lib/pr-review-eval');
const { simulateCarryRound, loadBaseline, loadCases, fileOf } = require('./helpers/carry-eval-round');

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const H1 = 'a'.repeat(40);
const H2 = 'b'.repeat(40);
const H3 = 'c'.repeat(40);
const OTHER = 'd'.repeat(40);
const BASE = 'e'.repeat(40);
const OTHER_BASE = 'f'.repeat(40);
const HUNK = sha('hunk');
const DEP = sha('dep');
const PR = '268';
const CLAIM = 'Null deref on empty input';

/** Standard depth: 3 verifiers, a strict majority is 2. These are the votes of a `present` verdict and of a `filtered` one. */
const VOTES = [
  { verifier: 'verifier-1', verdict: 'real' },
  { verifier: 'verifier-2', verdict: 'real' },
  { verifier: 'verifier-3', verdict: 'not-real' },
];
const REJECTED_VOTES = [
  { verifier: 'verifier-1', verdict: 'real' },
  { verifier: 'verifier-2', verdict: 'not-real' },
  { verifier: 'verifier-3', verdict: 'not-real' },
];

const ledgerEntry = (id, file, line, claim) => ({ id, locationOrLink: `${file}:${line}`, failureMode: claim, severity: 'Important', headSha: H1 });

/** One prior verdict at H1, recorded the way `recordVerdicts` stamps it. */
const priorOf = (over = {}) => ({
  id: 'p1',
  file: 'src/a.js',
  claim: CLAIM,
  lines: [10, 12],
  hunkHash: HUNK,
  depHashes: { 'src/dep.js': DEP },
  head: H1,
  outcome: 'present',
  votes: VOTES,
  prId: PR,
  baseSha: BASE,
  depth: 'standard',
  expectedVerifiers: 3,
  ...over,
});

/** The candidate that re-presents it at H2. */
const candidateOf = (over = {}) => ({
  id: 'p1',
  file: 'src/a.js',
  claim: CLAIM,
  lines: [10, 12],
  hunkHash: HUNK,
  depHashes: { 'src/dep.js': DEP },
  dependents: ['src/caller.js'],
  headSha: H2,
  ...over,
});

/** One prior verdict at H1 and the one candidate that re-presents it at H2; nothing relevant changed, so it carries. */
function baseline() {
  return {
    prId: PR,
    baseSha: BASE,
    headSha: H2,
    lastReviewedSha: H1,
    depth: 'standard',
    deltaPlan: { mode: 'delta', readSet: [{ path: 'src/other.js', reasons: ['changed'] }] },
    deltaPaths: ['src/other.js'],
    deltaRange: { headSha: H2, lastReviewedSha: H1 },
    highPaths: ['src/auth.js'],
    priorLedger: [ledgerEntry('p1', 'src/a.js', 10, CLAIM)],
    priorVerdicts: [priorOf()],
    candidates: [candidateOf()],
  };
}

/** The delta changes exactly `paths`, and the planner's read set says so (`extra` are its other entries). */
function withDelta(input, paths, extra = []) {
  input.deltaPaths = paths;
  input.deltaPlan = { mode: 'delta', readSet: [...paths.map((path) => ({ path, reasons: ['changed'] })), ...extra] };
  return input;
}

/** The baseline with ONE condition flipped by `mutate`. */
function flipped(mutate) {
  const input = baseline();
  mutate(input);
  return input;
}

/** The round is at `head` (after `last` when given): its candidates were hashed there and the delta facts are those of `last..head`. */
function atHead(input, head, last = input.lastReviewedSha) {
  input.headSha = head;
  input.lastReviewedSha = last;
  input.deltaRange = { headSha: head, lastReviewedSha: last };
  for (const candidate of input.candidates) candidate.headSha = head;
  return input;
}

function expectOnlyReverify(input, reasons) {
  const result = planCarry(input);
  expect(result.ok).toBe(true);
  expect(result.carried).toEqual([]);
  expect(result.reverify).toHaveLength(1);
  expect(result.reverify[0].reasons).toEqual(reasons);
  return result;
}

describe('planCarry: the baseline carries (every flipped condition below starts from this)', () => {
  test('a verdict whose hunk, dependencies, dependents, binding and head are unchanged is carried with the current head and its original head', () => {
    const result = planCarry(baseline());
    expect(result.ok).toBe(true);
    expect(result.reverify).toEqual([]);
    expect(result.unmatched).toEqual([]);
    expect(result.reasons).toEqual([]);
    expect(result.carried).toEqual([
      {
        id: 'p1',
        file: 'src/a.js',
        claim: CLAIM,
        lines: [10, 12],
        hunkHash: HUNK,
        depHashes: { 'src/dep.js': DEP },
        head: H2,
        carriedFrom: H1,
        outcome: 'present',
        votes: VOTES,
        prId: PR,
        baseSha: BASE,
        depth: 'standard',
        expectedVerifiers: 3,
      },
    ]);
  });

  test('a `filtered` verdict carries too, and a carried record keeps its ORIGINAL head through a second carry', () => {
    const first = planCarry(flipped((input) => { input.priorVerdicts[0] = priorOf({ outcome: 'filtered', votes: REJECTED_VOTES }); }));
    expect(first.carried).toHaveLength(1);
    expect(first.carried[0].outcome).toBe('filtered');
    const second = planCarry({ ...atHead(baseline(), H3, H2), priorVerdicts: first.carried });
    expect(second.carried).toHaveLength(1);
    expect(second.carried[0].head).toBe(H3);
    expect(second.carried[0].carriedFrom).toBe(H1);
  });

  test('the carried record keeps the verdict\'s id (the ledger finding it is about); a candidate with no id carries under it', () => {
    expect(planCarry(baseline()).carried[0].id).toBe('p1');
    expect(planCarry(flipped((input) => { delete input.candidates[0].id; })).carried[0].id).toBe('p1');
  });

  test('numeric ids are the same id as their text', () => {
    const input = flipped((i) => { i.priorVerdicts[0].id = 7; i.priorLedger[0].id = '7'; i.candidates[0].id = '7'; i.prId = 268; });
    expect(planCarry(input).carried).toHaveLength(1);
  });

  test('keys ignore a leading ./ and backslashes on the path, and runs of whitespace in the claim', () => {
    const input = flipped((i) => {
      i.priorVerdicts[0].file = './src/a.js';
      i.priorVerdicts[0].claim = 'Null  deref   on empty\tinput';
      i.candidates[0].file = 'src\\a.js';
    });
    const result = planCarry(input);
    expect(result.carried).toHaveLength(1);
    expect(result.reverify).toEqual([]);
  });

  test('upper-case hashes equal their lower-case spelling and a carried record is lower-cased', () => {
    const result = planCarry(flipped((i) => { i.candidates[0].hunkHash = HUNK.toUpperCase(); i.candidates[0].depHashes['src/dep.js'] = DEP.toUpperCase(); }));
    expect(result.carried).toHaveLength(1);
    expect(result.carried[0].hunkHash).toBe(HUNK);
    expect(result.carried[0].depHashes).toEqual({ 'src/dep.js': DEP });
  });

  test('an empty dependency map is "no dependencies", an empty dependents list is "no dependents", and both carry', () => {
    const result = planCarry(flipped((i) => { i.priorVerdicts[0].depHashes = {}; i.candidates[0].depHashes = {}; i.candidates[0].dependents = []; }));
    expect(result.carried).toHaveLength(1);
  });

  test('a High path that exists but was not touched does not stop a carry', () => {
    expect(planCarry(flipped((i) => { i.highPaths = ['src/auth.js', 'src/other2.js']; })).carried).toHaveLength(1);
  });

  test('empty `incompleteVerifiers` is settled; the planner does not mutate its input', () => {
    const input = flipped((i) => { i.priorVerdicts[0].incompleteVerifiers = []; });
    const before = JSON.stringify(input);
    expect(planCarry(input).carried).toHaveLength(1);
    expect(JSON.stringify(input)).toBe(before);
  });

  test('`line` and `lines` name the same region: a verdict recorded with `lines: [n, n]` carries onto a candidate citing `line: n`', () => {
    const input = flipped((i) => { i.priorVerdicts[0].lines = [10, 10]; delete i.candidates[0].lines; i.candidates[0].line = 10; });
    const result = planCarry(input);
    expect(result.carried).toHaveLength(1);
    expect(result.carried[0].lines).toEqual([10, 10]);
  });

  test('SETTLED_OUTCOMES is exactly present and filtered', () => {
    expect([...SETTLED_OUTCOMES].sort()).toEqual(['filtered', 'present']);
  });
});

describe('claim identity: every symbol is part of what a claim says', () => {
  test('normalizeClaim collapses whitespace and nothing else (case included), and refuses a claim with no word', () => {
    expect(normalizeClaim('  The   Foo, BAR!! ')).toBe('The Foo, BAR!!');
    expect(normalizeClaim('a\tb\n c')).toBe('a b c');
    expect(normalizeClaim('!!!')).toBeNull();
    expect(normalizeClaim('--- !!! < >')).toBeNull();
    expect(normalizeClaim(undefined)).toBeNull();
    expect(normalizeClaim('   ')).toBeNull();
  });

  test('a word in any script is a word (a non-Latin claim is not erased to nothing)', () => {
    expect(normalizeClaim('空の入力でnull参照')).toBe('空の入力でnull参照');
    expect(normalizeClaim('Ошибка при пустом вводе')).not.toBe(normalizeClaim('Ошибка при пустом выводе'));
  });

  const OPPOSITES = [
    ['x < y should be x > y', 'x > y should be x < y'],
    ['x == y is wrong', 'x != y is wrong'],
    ['x === y is wrong', 'x !== y is wrong'],
    ['if (!ok) return skips the check', 'if (ok) return skips the check'],
    ['a && b guards the call', 'a || b guards the call'],
    ['count >= limit is off by one', 'count <= limit is off by one'],
    ['i++ overruns the buffer', 'i-- overruns the buffer'],
    ['x + y overflows', 'x - y overflows'],
    ['x * y overflows', 'x / y overflows'],
    ['x % y is zero', 'x ^ y is zero'],
    ['the code uses a?.b', 'the code uses a.b'],
    ['returns \'\' instead of null', 'returns instead of null'],
    ['does not validate input', 'does validate input'],
    ['the call (a || b) && c is wrong', 'the call a || (b && c) is wrong'],
    ['arr[0] is read', 'arr(0) is read'],
    ['`x` ~ y', '`x` y'],
  ];

  test.each(OPPOSITES)('%s / %s are different claims', (a, b) => {
    expect(normalizeClaim(a)).not.toBe(normalizeClaim(b));
  });

  test.each(OPPOSITES)('a verdict for "%s" is NOT carried onto "%s": the new claim is verified, the old verdict is unmatched', (a, b) => {
    const input = flipped((i) => {
      i.priorVerdicts[0].claim = a;
      i.priorLedger[0].failureMode = a;
      i.candidates[0].claim = b;
    });
    const result = planCarry(input);
    expect(result.carried).toEqual([]);
    expect(result.reverify).toHaveLength(1);
    expect(result.reverify[0].reasons).toEqual([REASONS.NEW_CANDIDATE]);
    expect(result.unmatched.map((entry) => entry.id)).toEqual(['p1']);
  });

  test.each(['<', '>', '=', '!', '&', '|', '+', '-', '*', '/', '%', '^', '~', '?', ':', '(', ')', '[', ']', '{', '}', '\'', '"', '`', '.', ',', ';', '@', '#', '$', '\\'])(
    'the symbol %s is never erased from a claim',
    (symbol) => {
      expect(normalizeClaim(`a ${symbol} b`)).not.toBe(normalizeClaim('a b'));
      expect(normalizeClaim(`a ${symbol} b`)).toContain(symbol);
    }
  );

  test('claims that differ only in whitespace are still one claim', () => {
    expect(normalizeClaim('If (!OK)  \t Return')).toBe(normalizeClaim('If (!OK) Return'));
  });

  test.each([
    ['Foo is unchecked', 'foo is unchecked'],
    ['FOO is unchecked', 'Foo is unchecked'],
    ['If (!OK) return', 'if (!ok) return'],
    ['Ошибка при пустом вводе', 'ошибка при пустом вводе'],
    ['Straße is unchecked', 'STRASSE is unchecked'],
  ])('case is part of what a claim says: "%s" and "%s" are different claims (not only ASCII, not only the first letter)', (a, b) => {
    expect(normalizeClaim(a)).toBe(a);
    expect(normalizeClaim(a)).not.toBe(normalizeClaim(b));
  });

  test('an id-less candidate at identical lines and window whose claim differs only in case does not inherit the verdict: it is a new candidate, the old verdict unmatched', () => {
    const input = flipped((i) => {
      i.priorVerdicts[0] = priorOf({ outcome: 'filtered', votes: REJECTED_VOTES, claim: 'Foo is unchecked' });
      i.priorLedger[0].failureMode = 'Foo is unchecked';
      i.candidates[0].claim = 'foo is unchecked';
      delete i.candidates[0].id;
    });
    const result = planCarry(input);
    expect(result.carried).toEqual([]);
    expect(result.reverify).toHaveLength(1);
    expect(result.reverify[0].reasons).toEqual([REASONS.NEW_CANDIDATE]);
    expect(result.unmatched.map((entry) => entry.id)).toEqual(['p1']);
  });

  test('control: the same id-less candidate with the SAME capitalisation carries the filtered verdict', () => {
    const input = flipped((i) => {
      i.priorVerdicts[0] = priorOf({ outcome: 'filtered', votes: REJECTED_VOTES, claim: 'Foo is unchecked' });
      i.priorLedger[0].failureMode = 'Foo is unchecked';
      i.candidates[0].claim = 'Foo is unchecked';
      delete i.candidates[0].id;
    });
    expect(planCarry(input).carried).toHaveLength(1);
  });
});

describe('AC1 range-not-delta: only a delta carries', () => {
  test.each([[{ mode: 'full' }], [{}], [undefined], [null], ['delta'], [{ mode: 'DELTA' }]])('deltaPlan %j carries nothing', (deltaPlan) => {
    const result = planCarry(flipped((i) => { i.deltaPlan = deltaPlan; }));
    expect(result.carried).toEqual([]);
    expect(result.reasons).toEqual([REASONS.RANGE_NOT_DELTA]);
    expect(result.reverify[0].reasons).toEqual([REASONS.RANGE_NOT_DELTA]);
  });
});

describe('AC1 head-unknown', () => {
  test.each([[undefined], [null], [''], ['abc'], ['g'.repeat(40)], [123], [{}]])('a verdict head of %j is head-unknown', (head) => {
    expectOnlyReverify(flipped((i) => { i.priorVerdicts[0].head = head; }), [REASONS.HEAD_UNKNOWN]);
  });

  test.each([[null], ['abc'], [42]])('a carriedFrom of %j is head-unknown', (carriedFrom) => {
    expectOnlyReverify(flipped((i) => { i.priorVerdicts[0].carriedFrom = carriedFrom; }), [REASONS.HEAD_UNKNOWN]);
  });

  test.each([[undefined], [null], ['abc'], ['']])('a current head of %j carries nothing and says head-unknown', (headSha) => {
    const result = planCarry(flipped((i) => { i.headSha = headSha; }));
    expect(result.carried).toEqual([]);
    expect(result.reasons).toContain(REASONS.HEAD_UNKNOWN);
    expect(result.reverify[0].reasons).toContain(REASONS.HEAD_UNKNOWN);
  });

  test.each([[undefined], [null], ['abc'], ['']])('a last reviewed head of %j carries nothing and says head-unknown', (lastReviewedSha) => {
    const result = planCarry(flipped((i) => { i.lastReviewedSha = lastReviewedSha; }));
    expect(result.carried).toEqual([]);
    expect(result.reasons).toContain(REASONS.HEAD_UNKNOWN);
  });

  test('a 64-hex object id is a head', () => {
    const long = 'e'.repeat(64);
    const result = planCarry(atHead(flipped((i) => { i.priorVerdicts[0].head = long; }), H2, long));
    expect(result.carried).toHaveLength(1);
  });
});

describe('AC1 head-not-last-reviewed', () => {
  test('a verdict confirmed on a head other than the delta start is not carried', () => {
    expectOnlyReverify(flipped((i) => { i.priorVerdicts[0].head = OTHER; }), [REASONS.HEAD_NOT_LAST_REVIEWED]);
  });

  test('a verdict from two heads back is not carried even when its hashes still match', () => {
    const round1 = planCarry(baseline());
    // round 2 carried it to H2; round 3's delta starts at H3, which this verdict was never confirmed on
    const result = planCarry({ ...atHead(baseline(), OTHER, H3), priorVerdicts: round1.carried });
    expect(result.carried).toEqual([]);
    expect(result.reverify[0].reasons).toEqual([REASONS.HEAD_NOT_LAST_REVIEWED]);
  });

  test('the comparison ignores the case of the object id', () => {
    expect(planCarry(flipped((i) => { i.priorVerdicts[0].head = H1.toUpperCase(); })).carried).toHaveLength(1);
  });
});

describe('AC1 delta-paths-unreadable and high-paths-unreadable', () => {
  test.each([[undefined], [null], ['src/a.js'], [[1]], [['']], [[null]], [{}]])('deltaPaths %j carries nothing', (deltaPaths) => {
    const result = planCarry(flipped((i) => { i.deltaPaths = deltaPaths; }));
    expect(result.carried).toEqual([]);
    expect(result.reasons).toEqual([REASONS.DELTA_PATHS_UNREADABLE]);
    expect(result.reverify[0].reasons).toEqual([REASONS.DELTA_PATHS_UNREADABLE]);
  });

  test.each([[undefined], [null], ['src/auth.js'], [[1]], [['']], [{}]])('highPaths %j carries nothing', (highPaths) => {
    const result = planCarry(flipped((i) => { i.highPaths = highPaths; }));
    expect(result.carried).toEqual([]);
    expect(result.reasons).toEqual([REASONS.HIGH_PATHS_UNREADABLE]);
    expect(result.reverify[0].reasons).toEqual([REASONS.HIGH_PATHS_UNREADABLE]);
  });

  test('an empty delta and an empty High list are readable and carry', () => {
    expect(planCarry(withDelta(flipped((i) => { i.highPaths = []; }), [])).carried).toHaveLength(1);
  });
});

describe('AC1 delta-range-mismatch: the delta must be the one computed for THIS range', () => {
  // `prepare`'s facts carry the delta of the range they were computed for. Facts of an EARLIER push (OTHER..H1) handed to a plan
  // of H2 (lastReviewedSha H1) are consistent inside themselves, and say nothing about what the push to H2 changed.
  const FRESH = { headSha: H2, lastReviewedSha: H1 };
  const STALE = { headSha: H1, lastReviewedSha: OTHER };
  const inRange = (input, range) => { input.deltaRange = range; return input; };

  test('probe (a): a NEW caller added by this push is caught by this push\'s own delta, and carried past by the previous push\'s', () => {
    const round = (paths, range) => inRange(withDelta(flipped((i) => {
      i.priorVerdicts[0] = priorOf({ outcome: 'filtered', votes: REJECTED_VOTES });
      i.candidates[0].dependents = ['src/caller.js', 'src/new-caller.js'];
    }), paths), range);
    expectOnlyReverify(round(['src/new-caller.js'], FRESH), [REASONS.DEPENDENT_CHANGED]);
    const result = planCarry(round(['docs/note.md'], STALE));
    expect(result.ok).toBe(true);
    expect(result.carried).toEqual([]);
    expect(result.reasons).toEqual([REASONS.DELTA_RANGE_MISMATCH]);
    expect(result.reverify.map((entry) => entry.reasons)).toEqual([[REASONS.DELTA_RANGE_MISMATCH]]);
  });

  test('probe (b): an edit to the cited file OUTSIDE the cited window (the hunk hash cannot see it) is cited-file-in-delta with this push\'s delta, and carried past with the previous one\'s', () => {
    const round = (paths, range) => inRange(withDelta(baseline(), paths), range);
    expectOnlyReverify(round(['src/a.js'], FRESH), [REASONS.CITED_FILE_IN_DELTA]);
    const result = planCarry(round(['docs/note.md'], STALE));
    expect(result.carried).toEqual([]);
    expect(result.reasons).toEqual([REASONS.DELTA_RANGE_MISMATCH]);
    expect(result.reverify.map((entry) => entry.reasons)).toEqual([[REASONS.DELTA_RANGE_MISMATCH]]);
  });

  test.each([
    ['absent', undefined],
    ['null', null],
    ['text', H2],
    ['a list of the two heads', [H2, H1]],
    ['an empty object', {}],
    ['without a headSha', { lastReviewedSha: H1 }],
    ['without a lastReviewedSha', { headSha: H2 }],
    ['an abbreviated head', { headSha: H2.slice(0, 7), lastReviewedSha: H1 }],
    ['an abbreviated last reviewed head', { headSha: H2, lastReviewedSha: H1.slice(0, 7) }],
    ['heads that are numbers', { headSha: 2, lastReviewedSha: 1 }],
    ['the two heads swapped', { headSha: H1, lastReviewedSha: H2 }],
  ])('a deltaRange that is %s carries nothing: delta-range-mismatch', (_name, range) => {
    const result = planCarry(inRange(baseline(), range));
    expect(result.ok).toBe(true);
    expect(result.carried).toEqual([]);
    expect(result.reasons).toEqual([REASONS.DELTA_RANGE_MISMATCH]);
    expect(result.reverify[0].reasons).toEqual([REASONS.DELTA_RANGE_MISMATCH]);
  });

  test.each([
    ['only the head differs', { headSha: OTHER, lastReviewedSha: H1 }],
    ['only the last reviewed head differs', { headSha: H2, lastReviewedSha: OTHER }],
    ['both differ', { headSha: OTHER, lastReviewedSha: OTHER }],
    ['the range is the previous push\'s', STALE],
  ])('a range where %s is delta-range-mismatch, the one reason, for every candidate', (_name, range) => {
    const input = inRange(flipped((i) => {
      i.priorVerdicts.push(priorOf({ id: 'p2', file: 'src/b.js', claim: 'Other defect' }));
      i.priorLedger.push(ledgerEntry('p2', 'src/b.js', 10, 'Other defect'));
      i.candidates.push(candidateOf({ id: 'p2', file: 'src/b.js', claim: 'Other defect' }));
    }), range);
    const result = planCarry(input);
    expect(result.carried).toEqual([]);
    expect(result.reasons).toEqual([REASONS.DELTA_RANGE_MISMATCH]);
    expect(result.reverify.map((entry) => [entry.id, entry.reasons])).toEqual([['p1', [REASONS.DELTA_RANGE_MISMATCH]], ['p2', [REASONS.DELTA_RANGE_MISMATCH]]]);
    expect(result.unmatched).toEqual([]);
  });

  test('the comparison ignores the case of the object id: the same range spelt in capitals binds', () => {
    expect(planCarry(inRange(baseline(), { headSha: H2.toUpperCase(), lastReviewedSha: H1.toUpperCase() })).carried).toHaveLength(1);
  });

  test('the range of the delta is part of the round: a round at another head says delta-range-mismatch even when every other fact is carried over unchanged', () => {
    const round1 = planCarry(baseline());
    expect(round1.carried).toHaveLength(1);
    // round 2 at H3 (delta H2..H3): the carried record and the candidates are re-stamped for it, but the range is still H1..H2
    const input = { ...baseline(), headSha: H3, lastReviewedSha: H2, priorVerdicts: round1.carried };
    for (const candidate of input.candidates) candidate.headSha = H3;
    const result = planCarry(input);
    expect(result.carried).toEqual([]);
    expect(result.reasons).toEqual([REASONS.DELTA_RANGE_MISMATCH]);
    expect(planCarry(inRange(input, { headSha: H3, lastReviewedSha: H2 })).carried).toHaveLength(1);
  });
});

describe('AC1 high-path-touched: nothing carries', () => {
  test('a High path in the delta sends EVERY candidate to reverify, including ones in untouched files', () => {
    const input = withDelta(flipped((i) => {
      i.priorVerdicts.push(priorOf({ id: 'p2', file: 'src/b.js', claim: 'Other defect', hunkHash: sha('b') }));
      i.priorLedger.push(ledgerEntry('p2', 'src/b.js', 10, 'Other defect'));
      i.candidates.push(candidateOf({ id: 'p2', file: 'src/b.js', claim: 'Other defect', hunkHash: sha('b') }));
    }), ['src/auth.js']);
    const result = planCarry(input);
    expect(result.carried).toEqual([]);
    expect(result.reverify.map((entry) => entry.id)).toEqual(['p1', 'p2']);
    for (const entry of result.reverify) expect(entry.reasons).toEqual([REASONS.HIGH_PATH_TOUCHED]);
    expect(result.reasons).toEqual([REASONS.HIGH_PATH_TOUCHED]);
  });

  test('the match ignores a ./ prefix on either side', () => {
    const result = planCarry(flipped((i) => { i.deltaPaths = ['./src/auth.js']; i.deltaPlan.readSet = [{ path: 'src/auth.js', reasons: ['changed'] }]; i.highPaths = ['src/auth.js']; }));
    expect(result.carried).toEqual([]);
    expect(result.reasons).toEqual([REASONS.HIGH_PATH_TOUCHED]);
  });
});

describe('AC1 new-candidate and candidate-unreadable', () => {
  test('a candidate with no prior verdict is verified; the one with a verdict still carries', () => {
    const input = flipped((i) => { i.candidates.push(candidateOf({ id: 'c2', file: 'src/new.js', claim: 'Brand new', hunkHash: sha('n'), depHashes: {} })); });
    const result = planCarry(input);
    expect(result.carried.map((record) => record.id)).toEqual(['p1']);
    expect(result.reverify).toEqual([{ id: 'c2', file: 'src/new.js', claim: 'Brand new', reasons: [REASONS.NEW_CANDIDATE] }]);
  });

  test('the same file with a different claim is a new candidate, not a carry of the old verdict', () => {
    const result = planCarry(flipped((i) => { i.candidates[0].claim = 'A different defect in the same file'; }));
    expect(result.carried).toEqual([]);
    expect(result.reverify[0].reasons).toEqual([REASONS.NEW_CANDIDATE]);
    expect(result.unmatched.map((entry) => entry.id)).toEqual(['p1']);
  });

  test('the same claim in a different file is a new candidate', () => {
    const result = planCarry(flipped((i) => { i.candidates[0].file = 'src/elsewhere.js'; }));
    expect(result.carried).toEqual([]);
    expect(result.reverify[0].reasons).toEqual([REASONS.NEW_CANDIDATE]);
  });

  test.each([
    ['no file', { file: undefined }],
    ['a blank file', { file: '  ' }],
    ['no claim', { claim: undefined }],
    ['a claim with no words', { claim: '--- !!!' }],
  ])('a candidate with %s is unreadable and never carried', (_name, patch) => {
    const result = planCarry(flipped((i) => { Object.assign(i.candidates[0], patch); }));
    expect(result.carried).toEqual([]);
    expect(result.reverify).toHaveLength(1);
    expect(result.reverify[0].reasons).toEqual([REASONS.CANDIDATE_UNREADABLE]);
  });

  test('two candidates with one key are both verified, even though a prior verdict matches that key', () => {
    const input = flipped((i) => { i.candidates.push({ ...i.candidates[0], id: 'c1-again', claim: 'Null  deref on empty input' }); });
    const result = planCarry(input);
    expect(result.carried).toEqual([]);
    expect(result.reverify.map((entry) => entry.id)).toEqual(['p1', 'c1-again']);
    for (const entry of result.reverify) expect(entry.reasons).toEqual([REASONS.CANDIDATE_UNREADABLE, REASONS.ID_MISMATCH].filter((reason) => entry.id !== 'p1' || reason === REASONS.CANDIDATE_UNREADABLE));
  });
});

describe('AC1 candidate-head-mismatch: a candidate is hashed at one head, and only one hashed at THIS head can carry a verdict', () => {
  // The reviewer's repro. A verdict was settled at H1 for src/a.js: the claim was filtered because every caller guards the input.
  // The push to H2 adds src/new-caller.js, an UNGUARDED caller, so the delta lists it and the claim is real again. Candidates hashed
  // at H2 list the new caller as a dependent. Candidates hashed at H1 cannot, and used to carry the stale verdict with no reason.
  const newCallerRound = (over = {}) => withDelta(flipped((i) => {
    i.priorVerdicts[0] = priorOf({ outcome: 'filtered', votes: REJECTED_VOTES });
    i.candidates[0].dependents = ['src/caller.js', 'src/new-caller.js'];
    Object.assign(i.candidates[0], over);
  }), ['src/new-caller.js']);

  test('control: candidates hashed at the head under review list the new caller, so the filtered verdict is verified again (dependent-changed)', () => {
    expectOnlyReverify(newCallerRound(), [REASONS.DEPENDENT_CHANGED]);
  });

  test('the same delta with candidates hashed at the PREVIOUS head (the new caller is not among their dependents) carries nothing: candidate-head-mismatch', () => {
    const result = expectOnlyReverify(newCallerRound({ headSha: H1, dependents: ['src/caller.js'] }), [REASONS.CANDIDATE_HEAD_MISMATCH]);
    // a per-candidate reason: the round itself is readable, and the finding is verified again, never dropped
    expect(result.reasons).toEqual([]);
    expect(result.unmatched).toEqual([]);
  });

  test.each([
    ['no head', { headSha: undefined }],
    ['a null head', { headSha: null }],
    ['a blank head', { headSha: '' }],
    ['an abbreviated head', { headSha: 'abc' }],
    ['a head that is not hex', { headSha: 'g'.repeat(40) }],
    ['a head that is a number', { headSha: 42 }],
    ['the head of the previous round', { headSha: H1 }],
    ['some other head', { headSha: OTHER }],
  ])('a candidate stamped with %s is candidate-head-mismatch and never carried', (_name, patch) => {
    expectOnlyReverify(flipped((i) => { Object.assign(i.candidates[0], patch); }), [REASONS.CANDIDATE_HEAD_MISMATCH]);
  });

  test('a candidate with no `headSha` key at all is the same', () => {
    expectOnlyReverify(flipped((i) => { delete i.candidates[0].headSha; }), [REASONS.CANDIDATE_HEAD_MISMATCH]);
  });

  test('the comparison ignores the case of the object id', () => {
    expect(planCarry(flipped((i) => { i.candidates[0].headSha = H2.toUpperCase(); })).carried).toHaveLength(1);
  });

  test('only the stale candidate is verified again: a fresh one beside it still carries', () => {
    const result = planCarry(flipped((i) => {
      i.priorVerdicts.push(priorOf({ id: 'p2', file: 'src/b.js', claim: 'Other defect' }));
      i.priorLedger.push(ledgerEntry('p2', 'src/b.js', 10, 'Other defect'));
      i.candidates.push(candidateOf({ id: 'p2', file: 'src/b.js', claim: 'Other defect', headSha: H1 }));
    }));
    expect(result.carried.map((record) => record.id)).toEqual(['p1']);
    expect(result.reverify.map((entry) => [entry.id, entry.reasons])).toEqual([['p2', [REASONS.CANDIDATE_HEAD_MISMATCH]]]);
  });

  test('a stale candidate that is also new, or unreadable, lists the head mismatch beside its other reason', () => {
    const result = planCarry(flipped((i) => {
      i.candidates.push(candidateOf({ id: 'c2', file: 'src/new.js', claim: 'Brand new', headSha: H1 }));
      i.candidates.push(candidateOf({ id: 'c3', file: undefined, headSha: H1 }));
    }));
    expect(result.carried.map((record) => record.id)).toEqual(['p1']);
    expect(result.reverify.map((entry) => [entry.id, entry.reasons])).toEqual([
      ['c2', [REASONS.CANDIDATE_HEAD_MISMATCH, REASONS.NEW_CANDIDATE]],
      ['c3', [REASONS.CANDIDATE_UNREADABLE, REASONS.CANDIDATE_HEAD_MISMATCH]],
    ]);
  });

  test('the stale candidate is still the one that re-presents the verdict: the verdict is not "unmatched", it is verified again', () => {
    const result = planCarry(flipped((i) => { i.candidates[0].headSha = H1; }));
    expect(result.unmatched).toEqual([]);
    expect(result.reverify.map((entry) => entry.id)).toEqual(['p1']);
  });
});

describe('AC1 ambiguous-prior-verdict and id-mismatch', () => {
  test('two prior verdicts for one key: neither is trusted', () => {
    const input = flipped((i) => { i.priorVerdicts.push({ ...i.priorVerdicts[0], id: 'p1-dup', claim: 'Null  deref on empty input' }); });
    const result = planCarry(input);
    expect(result.carried).toEqual([]);
    expect(result.reverify[0].reasons).toEqual([REASONS.AMBIGUOUS_PRIOR_VERDICT]);
    expect(result.unmatched).toEqual([]);
  });

  test('a candidate whose id is not the verdict\'s id would inherit another finding\'s verdict: it is verified', () => {
    expectOnlyReverify(flipped((i) => { i.candidates[0].id = 'p9'; }), [REASONS.ID_MISMATCH]);
  });
});

describe('AC1 verdict-not-settled', () => {
  test.each([['disputed'], ['unverified'], ['confirmed'], [undefined], [null], ['']])('an outcome of %j is not settled', (outcome) => {
    expectOnlyReverify(flipped((i) => { i.priorVerdicts[0].outcome = outcome; }), [REASONS.VERDICT_NOT_SETTLED]);
  });

  test.each([
    ['empty', []],
    ['absent', undefined],
    ['not a list', 'present'],
    ['a vote with no verifier', [{ verdict: 'real' }, ...VOTES.slice(1)]],
    ['a vote with no verdict', [{ verifier: 'verifier-1' }, ...VOTES.slice(1)]],
    ['a vote that is not an object', ['real', ...VOTES.slice(1)]],
    ['a good vote beside a bad one', [VOTES[0], VOTES[1], { verifier: '', verdict: 'real' }]],
    ['a vote whose verdict is not a verdict `votes` knows', [VOTES[0], VOTES[1], { verifier: 'verifier-3', verdict: 'confirmed' }]],
    ['the same verifier voting twice', [VOTES[0], VOTES[1], { verifier: 'VERIFIER-1', verdict: 'real' }]],
  ])('votes that are %s are not settled', (_name, votes) => {
    expectOnlyReverify(flipped((i) => { i.priorVerdicts[0].votes = votes; }), [REASONS.VERDICT_NOT_SETTLED]);
  });

  test.each([[['verifier-3']], ['verifier-3'], [null], [{}]])('incompleteVerifiers %j is not settled', (incomplete) => {
    expectOnlyReverify(flipped((i) => { i.priorVerdicts[0].incompleteVerifiers = incomplete; }), [REASONS.VERDICT_NOT_SETTLED]);
  });
});

describe('AC1 hash-missing', () => {
  const BAD_HASHES = [[undefined], [null], [''], ['abc'], ['z'.repeat(64)], [HUNK.slice(1)], [HUNK + 'a'], [123], [{}]];

  test.each(BAD_HASHES)('a prior hunkHash of %j is hash-missing', (hash) => {
    expectOnlyReverify(flipped((i) => { i.priorVerdicts[0].hunkHash = hash; }), [REASONS.HASH_MISSING]);
  });

  test.each(BAD_HASHES)('a candidate hunkHash of %j is hash-missing', (hash) => {
    expectOnlyReverify(flipped((i) => { i.candidates[0].hunkHash = hash; }), [REASONS.HASH_MISSING]);
  });

  test('two missing hunk hashes are not "equal": missing never matches missing', () => {
    expectOnlyReverify(flipped((i) => { delete i.priorVerdicts[0].hunkHash; delete i.candidates[0].hunkHash; }), [REASONS.HASH_MISSING]);
  });

  const BAD_DEPS = [
    [undefined],
    [null],
    ['src/dep.js'],
    [['src/dep.js']],
    [{ 'src/dep.js': null }],
    [{ 'src/dep.js': 'not-a-hash' }],
    [{ 'src/dep.js': DEP, 'src/other-dep.js': undefined }],
    [{ 'src/dep.js': DEP, 'src/other-dep.js': '' }],
  ];

  test.each(BAD_DEPS)('prior depHashes %j is hash-missing', (deps) => {
    expectOnlyReverify(flipped((i) => { i.priorVerdicts[0].depHashes = deps; }), [REASONS.HASH_MISSING]);
  });

  test.each(BAD_DEPS)('candidate depHashes %j is hash-missing', (deps) => {
    expectOnlyReverify(flipped((i) => { i.candidates[0].depHashes = deps; }), [REASONS.HASH_MISSING]);
  });

  test('a dependency with an unreadable hash on BOTH sides still does not carry', () => {
    expectOnlyReverify(
      flipped((i) => { i.priorVerdicts[0].depHashes = { 'src/dep.js': 'x' }; i.candidates[0].depHashes = { 'src/dep.js': 'x' }; }),
      [REASONS.HASH_MISSING]
    );
  });

  const BAD_LOCATIONS = [
    [{ lines: undefined }],
    [{ lines: [0, 3] }],
    [{ lines: [5, 3] }],
    [{ lines: [10] }],
    [{ lines: '10-12' }],
    [{ lines: [10.5, 12] }],
    [{ line: 10 }], // both `line` and `lines`: ambiguous
    [{ lines: undefined, line: 0 }],
    [{ lines: undefined, line: '10' }],
  ];

  test.each(BAD_LOCATIONS)('a prior location of %j is hash-missing', (patch) => {
    expectOnlyReverify(flipped((i) => { Object.assign(i.priorVerdicts[0], patch); }), [REASONS.HASH_MISSING]);
  });

  test.each(BAD_LOCATIONS)('a candidate location of %j is hash-missing', (patch) => {
    expectOnlyReverify(flipped((i) => { Object.assign(i.candidates[0], patch); }), [REASONS.HASH_MISSING]);
  });
});

describe('AC1 hunk-changed and hunk-moved', () => {
  test('a different hunk hash is hunk-changed and nothing else', () => {
    expectOnlyReverify(flipped((i) => { i.candidates[0].hunkHash = sha('edited hunk'); }), [REASONS.HUNK_CHANGED]);
  });

  test('a one-character difference in the hash counts', () => {
    const edited = (HUNK[0] === 'f' ? '0' : 'f') + HUNK.slice(1);
    expectOnlyReverify(flipped((i) => { i.candidates[0].hunkHash = edited; }), [REASONS.HUNK_CHANGED]);
  });

  test.each([
    ['the start moved', [40, 42]],
    ['only the start moved', [11, 12]],
    ['the end moved', [10, 13]],
    ['a window of identical text 40 lines down', [50, 52]],
  ])('the same hunk hash at other lines is hunk-moved (%s): identical windows are not one finding', (_name, lines) => {
    expectOnlyReverify(flipped((i) => { i.candidates[0].lines = lines; }), [REASONS.HUNK_MOVED]);
  });
});

describe('AC1 dependency-changed', () => {
  test('a dependency whose hash changed is dependency-changed and nothing else', () => {
    expectOnlyReverify(flipped((i) => { i.candidates[0].depHashes = { 'src/dep.js': sha('dep v2') }; }), [REASONS.DEPENDENCY_CHANGED]);
  });

  test('a dependency file among the changed paths, hashes equal, is dependency-changed', () => {
    expectOnlyReverify(withDelta(baseline(), ['src/dep.js']), [REASONS.DEPENDENCY_CHANGED]);
  });

  test('the dependency / delta comparison ignores a ./ prefix', () => {
    expectOnlyReverify(flipped((i) => { i.deltaPaths = ['./src/dep.js']; i.deltaPlan.readSet = [{ path: 'src/dep.js', reasons: ['changed'] }]; }), [REASONS.DEPENDENCY_CHANGED]);
  });

  test('a dependency added since the verdict is dependency-changed', () => {
    expectOnlyReverify(
      flipped((i) => { i.candidates[0].depHashes = { 'src/dep.js': DEP, 'src/new-dep.js': sha('new') }; }),
      [REASONS.DEPENDENCY_CHANGED]
    );
  });

  test('a dependency removed since the verdict is dependency-changed', () => {
    expectOnlyReverify(flipped((i) => { i.candidates[0].depHashes = {}; }), [REASONS.DEPENDENCY_CHANGED]);
  });

  test('a dependency swapped for another with the same hash is a different set', () => {
    expectOnlyReverify(flipped((i) => { i.candidates[0].depHashes = { 'src/renamed-dep.js': DEP }; }), [REASONS.DEPENDENCY_CHANGED]);
  });

  test('a dependency the PRIOR verdict had that the delta touched is dependency-changed even when the candidate dropped it', () => {
    expectOnlyReverify(withDelta(flipped((i) => { i.candidates[0].depHashes = {}; }), ['src/dep.js']), [REASONS.DEPENDENCY_CHANGED]);
  });
});

describe('AC1 cited-file-in-delta', () => {
  test('the cited file among the changed paths is reverified even when every hash is equal', () => {
    expectOnlyReverify(withDelta(baseline(), ['src/a.js']), [REASONS.CITED_FILE_IN_DELTA]);
  });

  test('the comparison ignores a ./ prefix on the changed path and on the candidate', () => {
    expectOnlyReverify(flipped((i) => { i.deltaPaths = ['./src/a.js']; i.deltaPlan.readSet = [{ path: 'src/a.js', reasons: ['changed'] }]; }), [REASONS.CITED_FILE_IN_DELTA]);
    expectOnlyReverify(withDelta(flipped((i) => { i.candidates[0].file = './src/a.js'; i.priorVerdicts[0].file = './src/a.js'; }), ['src/a.js']), [REASONS.CITED_FILE_IN_DELTA]);
  });

  test('only the candidate whose file changed is reverified; the other carries', () => {
    const input = withDelta(flipped((i) => {
      i.priorVerdicts.push(priorOf({ id: 'p2', file: 'src/b.js', claim: 'Other defect' }));
      i.priorLedger.push(ledgerEntry('p2', 'src/b.js', 10, 'Other defect'));
      i.candidates.push(candidateOf({ id: 'p2', file: 'src/b.js', claim: 'Other defect' }));
    }), ['src/b.js']);
    const result = planCarry(input);
    expect(result.carried.map((record) => record.id)).toEqual(['p1']);
    expect(result.reverify.map((entry) => [entry.id, entry.reasons])).toEqual([['p2', [REASONS.CITED_FILE_IN_DELTA]]]);
  });
});

describe('blast radius: the planner\'s read set and the cited file\'s dependents', () => {
  test.each([
    ['a caller of a changed file', 'caller-of:src/other.js'],
    ['a test of a changed file (by import or by name)', 'test-of:src/other.js'],
    ['a computed-specifier file that names a changed file', 'names:src/other.js'],
  ])('a candidate in %s is in the read set and is verified again (blast-radius)', (_name, why) => {
    const result = expectOnlyReverify(flipped((i) => { i.deltaPlan.readSet.push({ path: 'src/a.js', reasons: [why] }); }), [REASONS.BLAST_RADIUS]);
    expect(result.reasons).toEqual([]);
  });

  test('a file in the read set for several reasons is verified again as long as one of them is not `changed`', () => {
    expectOnlyReverify(
      flipped((i) => { i.deltaPlan.readSet.push({ path: 'src/a.js', reasons: ['changed', 'caller-of:src/other.js'] }); i.deltaPaths.push('src/a.js'); }),
      [REASONS.CITED_FILE_IN_DELTA, REASONS.BLAST_RADIUS]
    );
  });

  test('a file read for `changed` alone is cited-file-in-delta, not blast-radius', () => {
    expectOnlyReverify(withDelta(baseline(), ['src/a.js']), [REASONS.CITED_FILE_IN_DELTA]);
  });

  test('the read-set match ignores a ./ prefix on the entry', () => {
    expectOnlyReverify(flipped((i) => { i.deltaPlan.readSet.push({ path: './src/a.js', reasons: ['test-of:src/other.js'] }); }), [REASONS.BLAST_RADIUS]);
  });

  test('a read-set entry for another file does not touch this candidate', () => {
    expect(planCarry(flipped((i) => { i.deltaPlan.readSet.push({ path: 'src/b.js', reasons: ['caller-of:src/other.js'] }); })).carried).toHaveLength(1);
  });

  test.each([
    ['absent', undefined],
    ['null', null],
    ['not a list', 'src/a.js'],
    ['an entry that is not an object', ['src/a.js']],
    ['an entry with no path', [{ reasons: ['changed'] }]],
    ['an entry with a blank path', [{ path: ' ', reasons: ['changed'] }]],
    ['an entry with no reasons', [{ path: 'src/other.js', reasons: [] }]],
    ['an entry whose reasons are not a list', [{ path: 'src/other.js', reasons: 'changed' }]],
    ['an entry with a blank reason', [{ path: 'src/other.js', reasons: [''] }]],
  ])('a delta plan whose readSet is %s has an unknown blast radius: nothing carries', (_name, readSet) => {
    const result = planCarry(flipped((i) => { i.deltaPlan = { mode: 'delta', readSet }; }));
    expect(result.carried).toEqual([]);
    expect(result.reasons).toEqual([REASONS.READ_SET_UNREADABLE]);
    expect(result.reverify[0].reasons).toEqual([REASONS.READ_SET_UNREADABLE]);
  });

  test('a changed path the read set does not list, or a changed entry the paths do not list, means two different deltas: nothing carries', () => {
    const extraPath = planCarry(flipped((i) => { i.deltaPaths = ['src/other.js', 'src/third.js']; }));
    expect(extraPath.carried).toEqual([]);
    expect(extraPath.reasons).toEqual([REASONS.DELTA_INCONSISTENT]);
    const extraEntry = planCarry(flipped((i) => { i.deltaPlan.readSet.push({ path: 'src/third.js', reasons: ['changed'] }); }));
    expect(extraEntry.carried).toEqual([]);
    expect(extraEntry.reasons).toEqual([REASONS.DELTA_INCONSISTENT]);
    const emptyPaths = planCarry(flipped((i) => { i.deltaPaths = []; }));
    expect(emptyPaths.carried).toEqual([]);
    expect(emptyPaths.reasons).toEqual([REASONS.DELTA_INCONSISTENT]);
    // the same NUMBER of paths, a different one: a size check alone would call these one delta
    const swapped = planCarry(flipped((i) => { i.deltaPaths = ['src/third.js']; }));
    expect(swapped.carried).toEqual([]);
    expect(swapped.reasons).toEqual([REASONS.DELTA_INCONSISTENT]);
  });

  test('entries read for another reason than `changed` are not changed paths', () => {
    expect(planCarry(flipped((i) => { i.deltaPlan.readSet.push({ path: 'src/b.js', reasons: ['caller-of:src/other.js'] }); })).reasons).toEqual([]);
  });

  test('a changed dependent is dependent-changed: a caller that dropped its guard invalidates the callee\'s verdict', () => {
    expectOnlyReverify(withDelta(baseline(), ['src/caller.js']), [REASONS.DEPENDENT_CHANGED]);
  });

  test.each([
    ['a test file that tests it by name', 'tests/a.test.js'],
    ['an unrelated dependent beside the changed one', 'src/caller.js'],
  ])('%s is a dependent too', (_name, dependent) => {
    expectOnlyReverify(withDelta(flipped((i) => { i.candidates[0].dependents = ['src/caller.js', 'tests/a.test.js']; }), [dependent]), [REASONS.DEPENDENT_CHANGED]);
  });

  test('the dependents comparison ignores a ./ prefix', () => {
    expectOnlyReverify(flipped((i) => { i.candidates[0].dependents = ['./src/caller.js']; i.deltaPaths = ['src/caller.js']; i.deltaPlan.readSet = [{ path: 'src/caller.js', reasons: ['changed'] }]; }), [REASONS.DEPENDENT_CHANGED]);
  });

  test('a changed file that is not a dependent leaves the verdict standing', () => {
    expect(planCarry(withDelta(baseline(), ['src/unrelated.js'])).carried).toHaveLength(1);
  });

  test.each([[undefined], [null], ['src/caller.js'], [[1]], [['']], [{}]])('dependents %j are unreadable: dependents-missing', (dependents) => {
    expectOnlyReverify(flipped((i) => { i.candidates[0].dependents = dependents; }), [REASONS.DEPENDENTS_MISSING]);
  });
});

describe('binding: a verdict carries only into the PR, base, depth and ledger it was settled for', () => {
  test.each([[undefined], [null], [''], ['267'], [269], ['268x']])('a verdict recorded for PR %j is verdict-other-pr', (prId) => {
    expectOnlyReverify(flipped((i) => { i.priorVerdicts[0].prId = prId; }), [REASONS.VERDICT_OTHER_PR]);
  });

  test.each([[undefined], [null], [''], ['abc'], [OTHER_BASE], [H1]])('a verdict recorded against base %j is verdict-other-base', (baseSha) => {
    expectOnlyReverify(flipped((i) => { i.priorVerdicts[0].baseSha = baseSha; }), [REASONS.VERDICT_OTHER_BASE]);
  });

  test('the base comparison ignores the case of the object id', () => {
    expect(planCarry(flipped((i) => { i.priorVerdicts[0].baseSha = BASE.toUpperCase(); })).carried).toHaveLength(1);
  });

  test.each([
    ['no depth', { depth: undefined }],
    ['another depth word', { depth: 'deep' }],
    ['a blank depth', { depth: '' }],
    ['no verifier count', { expectedVerifiers: undefined }],
    ['another verifier count', { expectedVerifiers: 5 }],
    ['a verifier count as text', { expectedVerifiers: '3' }],
  ])('a verdict settled with %s is verdict-other-depth', (_name, patch) => {
    expectOnlyReverify(flipped((i) => { Object.assign(i.priorVerdicts[0], patch); }), [REASONS.VERDICT_OTHER_DEPTH]);
  });

  test('a Standard verdict (2 of 3 verifiers) is not carried into a Deep round (3 of 5): the depth differs and its votes are too few', () => {
    const result = planCarry(flipped((i) => { i.depth = 'deep'; }));
    expect(result.carried).toEqual([]);
    expect(result.reverify[0].reasons).toEqual([REASONS.VERDICT_OTHER_DEPTH, REASONS.VERDICT_RETALLY_DIFFERS]);
  });

  test('a Deep verdict is not carried into a Standard round either (the verifier count the round runs is the one that counts)', () => {
    const deepVotes = ['1', '2', '3', '4', '5'].map((n, index) => ({ verifier: `verifier-${n}`, verdict: index < 3 ? 'real' : 'not-real' }));
    const input = flipped((i) => { i.priorVerdicts[0] = priorOf({ depth: 'deep', expectedVerifiers: 5, votes: deepVotes }); });
    const result = planCarry(input);
    expect(result.carried).toEqual([]);
    expect(result.reverify[0].reasons).toContain(REASONS.VERDICT_OTHER_DEPTH);
    // ...and the same verdict carries into the Deep round it was settled in
    expect(planCarry({ ...input, depth: 'deep' }).carried).toHaveLength(1);
  });

  test('an expectedVerifiers override is the round\'s verifier count, as it is for `votes`', () => {
    const fiveVotes = ['1', '2', '3', '4', '5'].map((n, index) => ({ verifier: `verifier-${n}`, verdict: index < 3 ? 'real' : 'not-real' }));
    const input = flipped((i) => { i.expectedVerifiers = 5; i.priorVerdicts[0] = priorOf({ expectedVerifiers: 5, votes: fiveVotes }); });
    expect(planCarry(input).carried).toHaveLength(1);
    expect(planCarry({ ...input, expectedVerifiers: 3 }).reverify[0].reasons).toContain(REASONS.VERDICT_OTHER_DEPTH);
  });

  test.each([
    ['two of three votes fewer than the stamped count', VOTES.slice(0, 2)],
    ['one vote', VOTES.slice(0, 1)],
    ['four votes', [...VOTES, { verifier: 'verifier-4', verdict: 'real' }]],
    ['a present verdict whose votes are not a majority', REJECTED_VOTES],
    ['a present verdict decided by abstentions', [VOTES[0], { verifier: 'verifier-2', verdict: 'abstain' }, { verifier: 'verifier-3', verdict: 'abstain' }]],
  ])('a present verdict with %s does not re-tally: verdict-retally-differs (a forged stamp does not help)', (_name, votes) => {
    expectOnlyReverify(flipped((i) => { i.priorVerdicts[0].votes = votes; }), [REASONS.VERDICT_RETALLY_DIFFERS]);
  });

  test('a filtered verdict whose votes are a majority does not re-tally', () => {
    expectOnlyReverify(flipped((i) => { i.priorVerdicts[0].outcome = 'filtered'; }), [REASONS.VERDICT_RETALLY_DIFFERS]);
  });

  test('a filtered verdict with a vote short of the count does not re-tally', () => {
    expectOnlyReverify(flipped((i) => { i.priorVerdicts[0] = priorOf({ outcome: 'filtered', votes: REJECTED_VOTES.slice(0, 2) }); }), [REASONS.VERDICT_RETALLY_DIFFERS]);
  });

  test.each([
    ['no finding with its id', (i) => { i.priorLedger = []; }],
    ['a finding with another id', (i) => { i.priorLedger[0].id = 'p9'; }],
    ['a finding for another file', (i) => { i.priorLedger[0].locationOrLink = 'src/b.js:10'; }],
    ['a finding with another failure mode', (i) => { i.priorLedger[0].failureMode = 'A different defect'; }],
    ['two findings with the id', (i) => { i.priorLedger.push({ ...i.priorLedger[0] }); }],
    ['a finding with a link and no file', (i) => { i.priorLedger[0] = { id: 'p1', locationOrLink: 'https://example.test/p1', failureMode: CLAIM }; }],
    ['a verdict with no id', (i) => { delete i.priorVerdicts[0].id; delete i.candidates[0].id; }],
  ])('a verdict with %s in the prior ledger is verdict-not-in-ledger', (_name, mutate) => {
    expectOnlyReverify(flipped(mutate), [REASONS.VERDICT_NOT_IN_LEDGER]);
  });

  test('a ledger finding anchored by `file` (no location) or with a claim spelt with other whitespace is still the same finding', () => {
    expect(planCarry(flipped((i) => { i.priorLedger[0] = { id: 'p1', file: './src/a.js', failureMode: 'Null deref   on empty input' }; })).carried).toHaveLength(1);
  });

  test.each([
    ['no PR', { prId: undefined }, REASONS.PR_UNKNOWN],
    ['a blank PR', { prId: '  ' }, REASONS.PR_UNKNOWN],
    ['no base', { baseSha: undefined }, REASONS.BASE_UNKNOWN],
    ['a base that is a branch name', { baseSha: 'main' }, REASONS.BASE_UNKNOWN],
    ['no depth', { depth: undefined }, REASONS.DEPTH_UNREADABLE],
    ['an unknown depth', { depth: 'thorough' }, REASONS.DEPTH_UNREADABLE],
    ['the Quick depth, which settles nothing', { depth: 'quick' }, REASONS.DEPTH_UNREADABLE],
    ['a verifier count of 0', { expectedVerifiers: 0 }, REASONS.DEPTH_UNREADABLE],
    ['a negative verifier count', { expectedVerifiers: -1 }, REASONS.DEPTH_UNREADABLE],
    ['a fractional verifier count', { expectedVerifiers: 2.5 }, REASONS.DEPTH_UNREADABLE],
    ['no prior ledger', { priorLedger: undefined }, REASONS.LEDGER_UNREADABLE],
    ['a prior ledger that is not a list', { priorLedger: 'p1' }, REASONS.LEDGER_UNREADABLE],
    ['a prior ledger with a non-object entry', { priorLedger: ['p1'] }, REASONS.LEDGER_UNREADABLE],
  ])('a round with %s binds nothing: nothing carries and the one reason is given', (_name, patch, reason) => {
    const result = planCarry({ ...baseline(), ...patch });
    expect(result.ok).toBe(true);
    expect(result.carried).toEqual([]);
    expect(result.reasons).toEqual([reason]);
    expect(result.reverify[0].reasons).toEqual([reason]);
  });
});

describe('unmatched prior verdicts and an unreadable request', () => {
  test('a prior verdict nobody re-presents is unmatched, never carried', () => {
    const result = planCarry(flipped((i) => { i.candidates = []; }));
    expect(result.carried).toEqual([]);
    expect(result.reverify).toEqual([]);
    expect(result.unmatched).toEqual([{ id: 'p1', file: 'src/a.js', claim: CLAIM, reasons: [REASONS.NO_CURRENT_CANDIDATE] }]);
  });

  test.each([
    ['priorVerdicts missing', (i) => { delete i.priorVerdicts; }],
    ['priorVerdicts not a list', (i) => { i.priorVerdicts = 'p1'; }],
    ['a prior verdict that is not an object', (i) => { i.priorVerdicts.push('p2'); }],
    ['candidates missing', (i) => { delete i.candidates; }],
    ['a candidate that is null', (i) => { i.candidates.push(null); }],
  ])('%s is an unreadable request: ok false, nothing carried', (_name, mutate) => {
    const result = planCarry(flipped(mutate));
    expect(result.ok).toBe(false);
    expect(result.carried).toEqual([]);
    expect(result.reverify).toEqual([]);
  });

  test.each([[null], [undefined], ['x'], [[]]])('an input of %j is unreadable', (input) => {
    expect(planCarry(input).ok).toBe(false);
  });
});

describe('AC2 invariant over a generated grid', () => {
  const FACTORS = {
    mode: ['delta', 'full'],
    priorHead: [H1, OTHER],
    outcome: ['present', 'filtered', 'disputed'],
    votes: ['k', 'none'],
    hunk: ['same', 'different', 'missing'],
    deps: ['same', 'changed', 'added', 'missing'],
    citedInDelta: [false, true],
    depInDelta: [false, true],
    highTouched: [false, true],
  };
  const PRODUCT = (factors) => Object.values(factors).reduce((n, values) => n * values.length, 1);

  function* grid(factors) {
    const names = Object.keys(factors);
    const walk = function* (index, chosen) {
      if (index === names.length) { yield { ...chosen }; return; }
      for (const value of factors[names[index]]) { chosen[names[index]] = value; yield* walk(index + 1, chosen); }
    };
    yield* walk(0, {});
  }

  function build(f) {
    const input = baseline();
    input.priorVerdicts[0].head = f.priorHead;
    input.priorVerdicts[0].outcome = f.outcome;
    input.priorVerdicts[0].votes = f.votes === 'k' ? (f.outcome === 'filtered' ? REJECTED_VOTES : VOTES) : [];
    if (f.hunk === 'different') input.candidates[0].hunkHash = sha('different');
    if (f.hunk === 'missing') delete input.candidates[0].hunkHash;
    if (f.deps === 'changed') input.candidates[0].depHashes = { 'src/dep.js': sha('changed dep') };
    if (f.deps === 'added') input.candidates[0].depHashes = { 'src/dep.js': DEP, 'src/more.js': sha('more') };
    if (f.deps === 'missing') delete input.candidates[0].depHashes;
    const paths = ['src/unrelated.js'];
    if (f.citedInDelta) paths.push('src/a.js');
    if (f.depInDelta) paths.push('src/dep.js');
    if (f.highTouched) paths.push('src/auth.js');
    withDelta(input, paths);
    input.deltaPlan.mode = f.mode;
    // a second, never-verified candidate: it must be verified in every cell
    input.candidates.push(candidateOf({ id: 'new', file: 'src/new.js', claim: 'A new defect', hunkHash: sha('new'), depHashes: {} }));
    return input;
  }

  /** The invariant, written from the input alone (not from the factors that generated it). */
  function everyConditionHolds(input, record) {
    const prior = input.priorVerdicts.find((entry) => entry.id === 'p1');
    const candidate = input.candidates.find((entry) => entry.id === record.id);
    const delta = new Set(input.deltaPaths);
    const sameDeps = JSON.stringify(Object.entries(prior.depHashes).sort()) === JSON.stringify(Object.entries(candidate.depHashes || {}).sort());
    const real = prior.votes.filter((vote) => vote.verdict === 'real').length;
    return (
      input.deltaPlan.mode === 'delta' &&
      prior.head === input.lastReviewedSha &&
      SETTLED_OUTCOMES.includes(prior.outcome) &&
      Array.isArray(prior.votes) && prior.votes.length === 3 && (prior.outcome === 'present') === (real >= 2) &&
      typeof candidate.hunkHash === 'string' && prior.hunkHash === candidate.hunkHash &&
      sameDeps &&
      !delta.has(candidate.file) &&
      Object.keys(candidate.depHashes).every((dep) => !delta.has(dep)) &&
      !input.highPaths.some((high) => delta.has(high))
    );
  }

  test('whenever a record is carried every condition holds; each candidate is in exactly one of carried / reverify', () => {
    let cells = 0;
    let carriedCells = 0;
    for (const factors of grid(FACTORS)) {
      cells += 1;
      const input = build(factors);
      const result = planCarry(input);
      expect(result.ok).toBe(true);

      for (const record of result.carried) {
        carriedCells += 1;
        if (!everyConditionHolds(input, record)) throw new Error(`carried although a condition fails: ${JSON.stringify(factors)}`);
        expect(record.head).toBe(input.headSha);
        expect(record.carriedFrom).toBe(H1);
      }
      const places = input.candidates.map((candidate) => [result.carried, result.reverify].filter((list) => list.some((entry) => entry.id === candidate.id)).length);
      expect(places).toEqual(input.candidates.map(() => 1));
      expect(result.carried.length + result.reverify.length).toBe(input.candidates.length);
      expect(result.carried.some((record) => record.id === 'new')).toBe(false);
    }
    // the generator walks every cell of the product (a truncated walk would pass the checks above vacuously)
    expect(cells).toBe(PRODUCT(FACTORS));
    // the grid is not vacuous: exactly the all-good cells carry (the converse of the invariant, for this grid)
    expect(carriedCells).toBe(FACTORS.outcome.filter((o) => SETTLED_OUTCOMES.includes(o)).length);
  });

  test('every cell where at least one factor is bad is reverified, and says why', () => {
    for (const factors of grid(FACTORS)) {
      const result = planCarry(build(factors));
      const good = factors.mode === 'delta' && factors.priorHead === H1 && factors.outcome !== 'disputed' && factors.votes === 'k' &&
        factors.hunk === 'same' && factors.deps === 'same' && !factors.citedInDelta && !factors.depInDelta && !factors.highTouched;
      const entry = result.reverify.find((candidate) => candidate.id === 'p1');
      if (good) expect(entry).toBeUndefined();
      else expect(entry.reasons.length).toBeGreaterThan(0);
    }
  });
});

describe('AC2 invariant over a second grid: blast radius, binding, ledger, location', () => {
  const DEEP_VOTES = ['1', '2', '3', '4', '5'].map((n, index) => ({ verifier: `verifier-${n}`, verdict: index < 3 ? 'real' : 'not-real' }));
  const FACTORS = {
    pr: ['same', 'other', 'missing'],
    base: ['same', 'other'],
    depth: ['same', 'otherWord', 'otherCount'],
    ledger: ['ok', 'absent', 'otherClaim'],
    votes: ['consistent', 'short', 'forged'],
    readSet: ['none', 'caller-of', 'test-of', 'names', 'changed-only'],
    dependents: ['clean', 'changed', 'missing'],
    location: ['same', 'moved'],
    candidateHead: ['same', 'other', 'missing'],
    range: ['bound', 'otherHead', 'otherLast', 'missing'],
  };
  const PRODUCT = Object.values(FACTORS).reduce((n, values) => n * values.length, 1);

  function* grid() {
    const names = Object.keys(FACTORS);
    const walk = function* (index, chosen) {
      if (index === names.length) { yield { ...chosen }; return; }
      for (const value of FACTORS[names[index]]) { chosen[names[index]] = value; yield* walk(index + 1, chosen); }
    };
    yield* walk(0, {});
  }

  function build(f) {
    const input = baseline();
    const prior = input.priorVerdicts[0];
    if (f.pr === 'other') prior.prId = '1';
    if (f.pr === 'missing') delete prior.prId;
    if (f.base === 'other') prior.baseSha = OTHER_BASE;
    if (f.depth === 'otherWord') prior.depth = 'deep';
    if (f.depth === 'otherCount') prior.expectedVerifiers = 5;
    if (f.ledger === 'absent') input.priorLedger = [];
    if (f.ledger === 'otherClaim') input.priorLedger[0].failureMode = 'something else';
    if (f.votes === 'short') prior.votes = VOTES.slice(0, 2);
    if (f.votes === 'forged') { prior.votes = DEEP_VOTES; prior.depth = 'standard'; prior.expectedVerifiers = 3; }
    const paths = ['src/unrelated.js'];
    const extra = [];
    if (f.readSet === 'changed-only') paths.push('src/a.js');
    else if (f.readSet !== 'none') extra.push({ path: 'src/a.js', reasons: [`${f.readSet}:src/unrelated.js`] });
    if (f.dependents === 'changed') { paths.push('src/caller.js'); }
    if (f.dependents === 'missing') delete input.candidates[0].dependents;
    if (f.location === 'moved') input.candidates[0].lines = [30, 32];
    if (f.candidateHead === 'other') input.candidates[0].headSha = H1;
    if (f.candidateHead === 'missing') delete input.candidates[0].headSha;
    if (f.range === 'otherHead') input.deltaRange = { headSha: OTHER, lastReviewedSha: H1 };
    if (f.range === 'otherLast') input.deltaRange = { headSha: H2, lastReviewedSha: OTHER };
    if (f.range === 'missing') delete input.deltaRange;
    return withDelta(input, paths, extra);
  }

  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

  /** Written from the input alone: what must hold for the verdict to stand. */
  function everyConditionHolds(input) {
    const prior = input.priorVerdicts[0];
    const candidate = input.candidates[0];
    const delta = new Set(input.deltaPaths);
    const radius = new Map(input.deltaPlan.readSet.map((entry) => [entry.path, entry.reasons]));
    const entry = input.priorLedger.find((finding) => finding.id === prior.id);
    const real = prior.votes.filter((vote) => vote.verdict === 'real').length;
    const K = { standard: 3, deep: 5 }[input.depth];
    return (
      String(prior.prId) === String(input.prId) &&
      prior.baseSha === input.baseSha &&
      prior.depth === input.depth && prior.expectedVerifiers === K &&
      prior.votes.length === K && (prior.outcome === 'present') === (real >= Math.floor(K / 2) + 1) &&
      entry !== undefined && entry.locationOrLink.split(':')[0] === prior.file && entry.failureMode === prior.claim &&
      Array.isArray(candidate.dependents) && candidate.dependents.every((dependent) => !delta.has(dependent)) &&
      !delta.has(candidate.file) &&
      (radius.get(candidate.file) || []).every((why) => why === 'changed') &&
      JSON.stringify(prior.lines) === JSON.stringify(candidate.lines) &&
      typeof candidate.headSha === 'string' && candidate.headSha.toLowerCase() === input.headSha.toLowerCase() &&
      isObject(input.deltaRange) && String(input.deltaRange.headSha).toLowerCase() === input.headSha.toLowerCase() &&
      String(input.deltaRange.lastReviewedSha).toLowerCase() === input.lastReviewedSha.toLowerCase()
    );
  }

  test('whenever the record is carried every condition holds; every cell with a bad factor is reverified', () => {
    let cells = 0;
    let carriedCells = 0;
    for (const factors of grid()) {
      cells += 1;
      const input = build(factors);
      const result = planCarry(input);
      expect(result.ok).toBe(true);
      const holds = everyConditionHolds(input);
      if (result.carried.length > 0) {
        carriedCells += 1;
        if (!holds) throw new Error(`carried although a condition fails: ${JSON.stringify(factors)}`);
      } else {
        expect(result.reverify).toHaveLength(1);
        expect(result.reverify[0].reasons.length).toBeGreaterThan(0);
        // the converse: nothing is reverified for no reason
        if (holds) throw new Error(`reverified although every condition holds: ${JSON.stringify(factors)}`);
      }
    }
    expect(cells).toBe(PRODUCT);
    // not vacuous: exactly one cell carries (every factor at its good value)
    expect(carriedCells).toBe(1);
  });
});

describe('recordVerdicts: the one producer of verdict records, and what it stamps', () => {
  const finding = (over = {}) => ({ id: 'p1', locationOrLink: 'src/a.js:10', failureMode: CLAIM, severity: 'Important', outcome: 'present', votes: VOTES, ...over });
  const hashed = (over = {}) => ({ id: 'p1', file: 'src/a.js', lines: [10, 12], claim: CLAIM, hunkHash: HUNK, depHashes: { 'src/dep.js': DEP }, dependents: [], headSha: H1, ...over });
  const request = (over = {}) => ({ prId: PR, baseSha: BASE, headSha: H1, depth: 'standard', findings: [finding()], candidates: [hashed()], ...over });

  test('a settled finding becomes a record stamped with the PR, base, depth, verifier count and head', () => {
    const result = recordVerdicts(request());
    expect(result).toEqual({
      ok: true,
      skipped: [],
      verdicts: [priorOf({ lines: [10, 12] })],
    });
  });

  test('the record planCarry reads is exactly the record recordVerdicts writes: a round trip carries it', () => {
    const recorded = recordVerdicts(request());
    const plan = planCarry({ ...baseline(), priorVerdicts: recorded.verdicts });
    expect(plan.carried).toHaveLength(1);
    expect(plan.reverify).toEqual([]);
  });

  test('a filtered finding is recorded; a citation by `line` is recorded as `lines: [n, n]`', () => {
    const result = recordVerdicts(request({ findings: [finding({ outcome: 'filtered', votes: REJECTED_VOTES })], candidates: [hashed({ lines: undefined, line: 10 })] }));
    expect(result.verdicts).toHaveLength(1);
    expect(result.verdicts[0]).toMatchObject({ outcome: 'filtered', lines: [10, 10] });
  });

  test('the record carries only verifier and verdict of each vote, and lower-cases the hash', () => {
    const result = recordVerdicts(request({
      findings: [finding({ votes: VOTES.map((vote) => ({ ...vote, reason: 'because' })) })],
      candidates: [hashed({ hunkHash: HUNK.toUpperCase(), depHashes: { 'src/dep.js': DEP.toUpperCase() } })],
    }));
    expect(result.verdicts[0].votes).toEqual(VOTES);
    expect(result.verdicts[0].hunkHash).toBe(HUNK);
    expect(result.verdicts[0].depHashes).toEqual({ 'src/dep.js': DEP });
  });

  test('the depth and the verifier count of the round are what is stamped', () => {
    const fiveVotes = ['1', '2', '3', '4', '5'].map((n, index) => ({ verifier: `verifier-${n}`, verdict: index < 3 ? 'real' : 'not-real' }));
    const result = recordVerdicts(request({ depth: 'Deep', findings: [finding({ votes: fiveVotes })] }));
    expect(result.verdicts[0]).toMatchObject({ depth: 'deep', expectedVerifiers: 5 });
    const overridden = recordVerdicts(request({ expectedVerifiers: 5, findings: [finding({ votes: fiveVotes })] }));
    expect(overridden.verdicts[0]).toMatchObject({ depth: 'standard', expectedVerifiers: 5 });
  });

  test.each([
    ['disputed', { findings: [finding({ outcome: 'disputed' })] }, 'not-settled'],
    ['unverified', { findings: [finding({ outcome: 'unverified' })] }, 'not-settled'],
    ['a finding with no id', { findings: [finding({ id: undefined })] }, 'no-id'],
    ['no hashed candidate of that id', { candidates: [hashed({ id: 'p9' })] }, 'no-candidate'],
    ['two hashed candidates of that id', { candidates: [hashed(), hashed()] }, 'ambiguous-candidate'],
    ['a candidate that could not be hashed', { candidates: [{ id: 'p1', file: 'src/a.js', line: 10, claim: CLAIM, headSha: H1, hashError: 'boom' }] }, 'no-hash'],
    ['a candidate hashed at another head', { candidates: [hashed({ headSha: H2 })] }, 'candidate-head-mismatch'],
    ['a candidate with no head', { candidates: [hashed({ headSha: undefined })] }, 'candidate-head-mismatch'],
    ['a candidate whose head is abbreviated', { candidates: [hashed({ headSha: H1.slice(0, 7) })] }, 'candidate-head-mismatch'],
    ['a candidate with no dependency hashes', { candidates: [hashed({ depHashes: undefined })] }, 'no-hash'],
    ['a candidate with no location', { candidates: [hashed({ lines: undefined })] }, 'no-hash'],
    ['a candidate that cites another file than the finding', { candidates: [hashed({ file: 'src/b.js' })] }, 'candidate-differs'],
    ['a candidate that makes another claim than the finding', { candidates: [hashed({ claim: 'something else' })] }, 'candidate-differs'],
    ['a finding with no failure mode', { findings: [finding({ failureMode: undefined })] }, 'candidate-differs'],
    ['votes short of the verifier count', { findings: [finding({ votes: VOTES.slice(0, 2) })] }, 'votes-unsupported'],
    ['votes that do not give the outcome', { findings: [finding({ outcome: 'present', votes: REJECTED_VOTES })] }, 'votes-unsupported'],
    ['votes that are not a list', { findings: [finding({ votes: 'real' })] }, 'votes-unsupported'],
    ['a finding settled on a majority with a verifier missing (kata dx53), even when its votes number the expected count', { findings: [finding({ settledOnMajority: true })] }, 'settled-on-majority'],
  ])('%s is skipped (%s) and recorded nowhere', (_name, over, reason) => {
    const result = recordVerdicts(request(over));
    expect(result.ok).toBe(true);
    expect(result.verdicts).toEqual([]);
    expect(result.skipped.map((entry) => entry.reason)).toEqual([reason]);
  });

  test('one skipped finding does not stop the others', () => {
    const result = recordVerdicts(request({
      findings: [finding({ id: 'p2', outcome: 'unverified' }), finding()],
      candidates: [hashed(), hashed({ id: 'p2', file: 'src/b.js' })],
    }));
    expect(result.verdicts.map((record) => record.id)).toEqual(['p1']);
    expect(result.skipped).toEqual([{ id: 'p2', reason: 'not-settled' }]);
  });

  test('the very candidates that record at the head they were hashed at are skipped at any other head: no record is built from another head\'s hashes', () => {
    expect(recordVerdicts(request()).verdicts).toHaveLength(1);
    const elsewhere = recordVerdicts(request({ headSha: H2 }));
    expect(elsewhere.ok).toBe(true);
    expect(elsewhere.verdicts).toEqual([]);
    expect(elsewhere.skipped).toEqual([{ id: 'p1', reason: REASONS.CANDIDATE_HEAD_MISMATCH }]);
  });

  test('the comparison ignores the case of the object id; one stale candidate does not stop a fresh one', () => {
    const result = recordVerdicts(request({
      findings: [finding(), finding({ id: 'p2', locationOrLink: 'src/b.js:10', failureMode: 'Other defect' })],
      candidates: [hashed({ headSha: H1.toUpperCase() }), hashed({ id: 'p2', file: 'src/b.js', claim: 'Other defect', headSha: H2 })],
    }));
    expect(result.verdicts.map((record) => record.id)).toEqual(['p1']);
    expect(result.skipped).toEqual([{ id: 'p2', reason: REASONS.CANDIDATE_HEAD_MISMATCH }]);
  });

  test.each([
    ['no input', null],
    ['no PR', { prId: undefined }],
    ['a base that is a branch name', { baseSha: 'main' }],
    ['a head that is abbreviated', { headSha: 'abc123' }],
    ['no depth', { depth: undefined }],
    ['the Quick depth', { depth: 'quick' }],
    ['findings that are not a list', { findings: 'p1' }],
    ['a finding that is not an object', { findings: ['p1'] }],
    ['candidates that are not a list', { candidates: {} }],
  ])('%s is a refused request, not an empty answer', (_name, over) => {
    const result = recordVerdicts(over === null ? null : request(over));
    expect(result.ok).toBe(false);
    expect(result.verdicts).toEqual([]);
    expect(typeof result.reason).toBe('string');
  });
});

describe('stampLedger: the only stamps are the ones a carried record produces', () => {
  const entry = (id, head, extra = {}) => ({ id, locationOrLink: `src/${id}.js:1`, failureMode: `f ${id}`, headSha: head, ...extra });
  const record = (id, over = {}) => ({ id, head: H2, carriedFrom: H1, ...over });

  test('a carried finding is stamped with the current head and where it was first settled; the others are left as they were', () => {
    const result = stampLedger({ ledger: [entry('a', H1), entry('b', H1)], carried: [record('a')], headSha: H2 });
    expect(result).toEqual({ ok: true, ledger: [entry('a', H2, { carriedFrom: H1 }), entry('b', H1)] });
  });

  test('an earlier carry\'s `carriedFrom` is removed from a finding that is not carried now', () => {
    const result = stampLedger({ ledger: [entry('a', H1, { carriedFrom: OTHER }), entry('b', H1, { carriedFrom: OTHER })], carried: [record('a')], headSha: H2 });
    expect(result.ledger[0]).toMatchObject({ headSha: H2, carriedFrom: H1 });
    expect(result.ledger[1]).not.toHaveProperty('carriedFrom');
    expect(result.ledger[1].headSha).toBe(H1);
  });

  test('numeric and text ids are one id', () => {
    const result = stampLedger({ ledger: [entry(7, H1)], carried: [record('7')], headSha: H2 });
    expect(result.ledger[0]).toMatchObject({ headSha: H2, carriedFrom: H1 });
  });

  test('it does not mutate its input', () => {
    const input = { ledger: [entry('a', H1, { carriedFrom: OTHER })], carried: [record('a')], headSha: H2 };
    const before = JSON.stringify(input);
    stampLedger(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  test('a ledger finding already stamped with the current head is refused: no carried record produced that stamp', () => {
    const result = stampLedger({ ledger: [entry('a', H1), entry('b', H2)], carried: [record('a')], headSha: H2 });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/already stamped with the current head/);
  });

  test('a forged stamp is refused even when it carries a carriedFrom of its own', () => {
    const result = stampLedger({ ledger: [entry('a', H2, { carriedFrom: H1 })], carried: [], headSha: H2 });
    expect(result.ok).toBe(false);
  });

  test.each([
    ['a carried record with no finding in the ledger', { ledger: [entry('b', H1)], carried: [record('a')] }],
    ['a carried record for another head', { ledger: [entry('a', H1)], carried: [record('a', { head: H3 })] }],
    ['a carried record with no origin head', { ledger: [entry('a', H1)], carried: [record('a', { carriedFrom: 'abc' })] }],
    ['a carried record with no id', { ledger: [entry('a', H1)], carried: [record(undefined)] }],
    ['two carried records for one finding', { ledger: [entry('a', H1)], carried: [record('a'), record('a')] }],
    ['a ledger that is not a list', { ledger: 'a', carried: [] }],
    ['carried that is not a list', { ledger: [], carried: 'a' }],
    ['a ledger entry that is not an object', { ledger: ['a'], carried: [] }],
  ])('%s is refused', (_name, over) => {
    expect(stampLedger({ headSha: H2, ...over }).ok).toBe(false);
  });

  test.each([[null], [undefined], ['x']])('an input of %j is refused', (input) => {
    expect(stampLedger(input).ok).toBe(false);
  });

  test('a blank head is refused', () => {
    expect(stampLedger({ ledger: [], carried: [], headSha: ' ' }).ok).toBe(false);
  });
});

describe('AC3 interaction with mergeFindings and clearFixedFindings', () => {
  const finding = (id, file, line, headSha, extra = {}) => ({
    id,
    source: 'verifier',
    locationOrLink: `${file}:${line}`,
    severity: 'Important',
    failureMode: `failure of ${id}`,
    disposition: 'fix',
    evidence: `evidence for ${id}`,
    originalTextOrLink: `https://example.test/${id}`,
    headSha,
    ...extra,
  });
  const verdictOf = (f) => ({ outcome: 'present', votes: VOTES, hunk: sha(f.id) });

  // Four Important findings recorded at H1, each with a settled verdict.
  const FILES = { A: ['src/a.js', 10], B: ['src/b.js', 20], C: ['src/c.js', 30], D: ['src/d.js', 40] };
  const ledgerAtH1 = () => Object.entries(FILES).map(([id, [file, line]]) => { const f = finding(id, file, line, H1); return { ...f, verdict: verdictOf(f) }; });

  const priorFor = (f) => priorOf({
    id: f.id,
    file: f.locationOrLink.split(':')[0],
    claim: f.failureMode,
    lines: [Number(f.locationOrLink.split(':')[1]), Number(f.locationOrLink.split(':')[1])],
    hunkHash: sha(f.id),
    depHashes: {},
  });
  const candidateFor = (f) => candidateOf({
    id: f.id,
    file: f.locationOrLink.split(':')[0],
    claim: f.failureMode,
    lines: [Number(f.locationOrLink.split(':')[1]), Number(f.locationOrLink.split(':')[1])],
    hunkHash: sha(f.id),
    depHashes: {},
    dependents: [],
  });

  /**
   * The fix push H2 changes: src/b.js (line 99, not the cited line 20), src/c.js (line 30, the cited line: fixed, nobody
   * re-reports it) and src/d.js (line 40: edited, the defect is still reported). src/a.js is untouched.
   * Candidates this round: A, B and D (C is gone).
   */
  function round() {
    const ledger = ledgerAtH1();
    const byId = Object.fromEntries(ledger.map((f) => [f.id, f]));
    const plan = planCarry({
      prId: PR,
      baseSha: BASE,
      headSha: H2,
      lastReviewedSha: H1,
      depth: 'standard',
      deltaPlan: { mode: 'delta', readSet: ['src/b.js', 'src/c.js', 'src/d.js'].map((path) => ({ path, reasons: ['changed'] })) },
      deltaPaths: ['src/b.js', 'src/c.js', 'src/d.js'],
      deltaRange: { headSha: H2, lastReviewedSha: H1 },
      highPaths: [],
      priorVerdicts: ledger.map(priorFor),
      priorLedger: ledger,
      candidates: [byId.A, byId.B, byId.D].map(candidateFor),
    });
    // How the carry is applied: the finding is stamped with the current head and where it was first settled.
    const applied = stampLedger({ ledger, carried: plan.carried, headSha: H2 });
    const stamped = applied.ledger;
    const changedLocations = [{ path: 'src/b.js', lines: [99] }, { path: 'src/c.js', lines: [30] }, { path: 'src/d.js', lines: [40] }];
    // The verifiers re-confirm D; B's re-verification is still pending, so nobody has re-reported it.
    const reReported = [finding('D', 'src/d.js', 40, H2)];
    const cleared = clearFixedFindings({ ledger: stamped, changedLocations, headSha: H2, reReported });
    return { ledger, plan, applied, stamped, cleared, changedLocations, reReported };
  }

  test('the planner splits the round as intended', () => {
    const { plan } = round();
    expect(plan.carried.map((r) => r.id)).toEqual(['A']);
    expect(plan.reverify.map((r) => r.id)).toEqual(['B', 'D']);
    expect(plan.unmatched.map((r) => r.id)).toEqual(['C']);
  });

  test('a carried finding is not re-opened by mergeFindings when the same finding is re-observed at the new head', () => {
    const { stamped } = round();
    const reObservation = finding('A', 'src/a.js', 10, H2, { disposition: undefined, evidence: 'seen again' });
    const merged = mergeFindings(stamped, [reObservation], H2);
    const a = merged.find((f) => f.id === 'A');
    expect(a.disposition).toBe('fix');
    expect(a.verdict).toEqual(verdictOf(a));
    expect(a.evidence).toBe('evidence for A');
    expect(a.carriedFrom).toBe(H1);
    expect(merged).toHaveLength(stamped.length);
  });

  test('why `head` is restamped: the same carried finding left at its old head IS re-opened and loses its verdict', () => {
    const { ledger } = round();
    const reObservation = finding('A', 'src/a.js', 10, H2, { disposition: undefined, evidence: 'seen again' });
    const merged = mergeFindings(ledger, [reObservation], H2);
    const a = merged.find((f) => f.id === 'A');
    expect(a.verdict).toBeUndefined();
    expect(a.disposition).toBeUndefined();
  });

  test('clearFixedFindings never clears a carried finding, even when the push touched its file', () => {
    const { stamped, changedLocations } = round();
    // widen the touched set to the carried finding's own cited line, as a hostile worst case
    const result = clearFixedFindings({ ledger: stamped, changedLocations: [...changedLocations, 'src/a.js:10'], headSha: H2 });
    expect(result.cleared).not.toContain('A');
    expect(result.findings.find((f) => f.id === 'A').cleared).toBeUndefined();
  });

  test('an unmatched finding whose line the push touched and nobody re-reported is cleared (explicit reconcile)', () => {
    const { cleared, plan } = round();
    expect(plan.unmatched.map((r) => r.id)).toContain('C');
    expect(cleared.ok).toBe(true);
    expect(cleared.cleared).toContain('C');
    expect(cleared.findings.find((f) => f.id === 'C')).toMatchObject({ cleared: true, clearedBy: H2 });
  });

  test('a reverify finding whose cited line the delta did not touch stays open', () => {
    const { cleared, plan } = round();
    expect(plan.reverify.map((r) => r.id)).toContain('B');
    expect(cleared.cleared).not.toContain('B');
    expect(cleared.findings.find((f) => f.id === 'B').cleared).toBeUndefined();
  });

  test('a reverify finding the verifiers re-report is not cleared; with nobody re-reporting it, it is', () => {
    const { stamped, changedLocations, reReported } = round();
    expect(clearFixedFindings({ ledger: stamped, changedLocations, headSha: H2, reReported }).cleared).not.toContain('D');
    expect(clearFixedFindings({ ledger: stamped, changedLocations, headSha: H2 }).cleared).toContain('D');
  });

  test('no finding is both carried and cleared, and each ends the round carried-with-verdict, in reverify, or cleared', () => {
    const { ledger, plan, cleared } = round();
    const carried = new Set(plan.carried.map((r) => r.id));
    const reverify = new Set([...plan.reverify, ...plan.unmatched].map((r) => r.id));
    const clearedIds = new Set(cleared.cleared);
    for (const id of carried) expect(clearedIds.has(id)).toBe(false);
    const outcomes = ledger.map((f) => {
      if (clearedIds.has(f.id)) return [f.id, 'cleared'];
      if (carried.has(f.id)) {
        const after = cleared.findings.find((g) => g.id === f.id);
        return [f.id, after.verdict && after.carriedFrom === H1 && after.headSha === H2 ? 'carried' : 'carried-without-verdict'];
      }
      return [f.id, reverify.has(f.id) ? 'reverify' : 'LOST'];
    });
    expect(Object.fromEntries(outcomes)).toEqual({ A: 'carried', B: 'reverify', C: 'cleared', D: 'reverify' });
  });
});

describe('AC4 quality guard simulation over the committed eval cases', () => {
  const baseline = loadBaseline();
  const cases = loadCases();
  const importantIds = Object.values(baseline.findingsByCase).flat().filter((f) => f.severity === 'Important').map((f) => f.id);

  const scoreOf = (findingsByCase) => scoreEval({ cases, findingsByCase });

  test('the baseline itself finds every committed case (so the comparison below is meaningful)', () => {
    const score = scoreOf(baseline.findingsByCase);
    expect(score.total.found).toBe(cases.length);
    expect(importantIds.length).toBeGreaterThanOrEqual(cases.length);
  });

  test('a push touching only unrelated files carries everything, and drops nothing', () => {
    const round = simulateCarryRound({ findingsByCase: baseline.findingsByCase, deltaPaths: ['packages/unrelated/other.js'] });
    expect(round.dropped).toEqual([]);
    expect(round.plan.reverify).toEqual([]);
    expect(round.plan.carried).toHaveLength(round.flat.length);
    expect(scoreOf(round.findingsByCase).total.found).toBe(cases.length);
  });

  test('a push touching the file of one case sends that case to reverify (never carried) and every Important finding survives', () => {
    const target = cases.find((c) => c.id.startsWith('pr233-f02'));
    const round = simulateCarryRound({ findingsByCase: baseline.findingsByCase, deltaPaths: [target.location.path], changedHunkFiles: [target.location.path] });
    const touched = round.flat.filter((f) => fileOf(f) === target.location.path).map((f) => f.id);
    expect(touched.length).toBeGreaterThan(0);
    for (const id of touched) {
      expect(round.plan.carried.map((r) => r.id)).not.toContain(id);
      expect(round.plan.reverify.find((r) => r.id === id).reasons).toEqual(expect.arrayContaining([REASONS.CITED_FILE_IN_DELTA, REASONS.HUNK_CHANGED]));
    }
    expect(round.plan.carried.length).toBeGreaterThan(0);
    expect(round.dropped).toEqual([]);
    for (const id of importantIds) {
      const inRound = [...round.plan.carried, ...round.plan.reverify].some((r) => r.id === id);
      expect(inRound).toBe(true);
    }
    expect(scoreOf(round.findingsByCase).total.found).toBe(cases.length);
  });

  test('a push that touches a High path reverifies every finding: nothing is carried and nothing is lost', () => {
    const round = simulateCarryRound({
      findingsByCase: baseline.findingsByCase,
      deltaPaths: ['REVIEW.md'],
      highPaths: ['REVIEW.md'],
    });
    expect(round.plan.carried).toEqual([]);
    expect(round.plan.reverify).toHaveLength(round.flat.length);
    expect(round.dropped).toEqual([]);
    expect(scoreOf(round.findingsByCase).total.found).toBe(cases.length);
  });

  test('a push that changes a case file with unchanged hashes still does not carry that file (cited-file-in-delta)', () => {
    // guards the helper itself: a round that changes a case's file must not report that case as carried
    const target = cases.find((c) => c.id.startsWith('pr228'));
    const round = simulateCarryRound({ findingsByCase: baseline.findingsByCase, deltaPaths: [target.location.path] });
    const carriedFiles = round.plan.carried.map((r) => r.file);
    expect(carriedFiles).not.toContain(target.location.path);
  });
});
