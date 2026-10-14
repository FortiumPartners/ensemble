const fs = require('fs');
const os = require('os');
const path = require('path');
const { statePath, writeState, readState, redact } = require('../lib/pr-review-state');

function tmpCwd() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pr-review-state-'));
}

function pendingState(overrides = {}) {
  return {
    baseSha: 'base-sha-1',
    headSha: 'head-sha-1',
    ledger: [{ id: 'f1', disposition: 'fix', evidence: 'stack trace' }],
    localPhase: 'LOCAL_REVIEW_PENDING',
    remotePhase: 'REMOTE_REVIEW_PENDING',
    rounds: { used: 1, max: 2 },
    next: 'run-fix-round',
    ...overrides,
  };
}

describe('pr-review-state: redact', () => {
  test('redacts a GitHub-token-shaped value embedded in text', () => {
    const redacted = redact({ evidence: 'leaked token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' });
    expect(redacted.evidence).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
    expect(redacted.evidence).toContain('[REDACTED]');
  });

  test('redacts any field whose key names a credential regardless of shape', () => {
    const redacted = redact({ apiKey: 'plain-looking-value', password: 'hunter2' });
    expect(redacted.apiKey).toBe('[REDACTED]');
    expect(redacted.password).toBe('[REDACTED]');
  });

  test('redacts an Authorization header value', () => {
    const redacted = redact({ note: 'Authorization: Bearer abc123.def456' });
    expect(redacted.note).not.toContain('abc123.def456');
  });
});

describe('pr-review-state: writeState / readState', () => {
  test('secrets are redacted on disk -- a ledger entry containing a token leaves no token value in the file', () => {
    const cwd = tmpCwd();
    const target = statePath('42', cwd);
    const state = pendingState({
      ledger: [{ id: 'f1', disposition: 'fix', evidence: 'token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' }],
    });
    const result = writeState(target, state, { cwd });
    expect(result.ok).toBe(true);
    const raw = fs.readFileSync(target, 'utf8');
    expect(raw).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
  });

  test('report holds the required fields and lives under .ensemble/pr-review/', () => {
    const cwd = tmpCwd();
    const target = statePath('42', cwd);
    expect(target).toContain(path.join('.ensemble', 'pr-review'));
    writeState(target, pendingState(), { cwd });
    const raw = JSON.parse(fs.readFileSync(target, 'utf8'));
    expect(raw.headSha).toBe('head-sha-1');
    expect(raw.baseSha).toBe('base-sha-1');
    expect(raw.ledger).toHaveLength(1);
    expect(raw.localPhase).toBe('LOCAL_REVIEW_PENDING');
    expect(raw.remotePhase).toBe('REMOTE_REVIEW_PENDING');
    expect(raw.next).toBe('run-fix-round');
  });

  test('resume re-checks the same head -- dispositioned findings are returned', () => {
    const cwd = tmpCwd();
    const target = statePath('42', cwd);
    writeState(target, pendingState({ headSha: 'head-H' }), { cwd });
    const result = readState(target, 'head-H', { cwd });
    expect(result.ok).toBe(true);
    expect(result.discarded).toBe(false);
    expect(result.dispositionedFindings).toHaveLength(1);
    expect(result.dispositionedFindings[0].id).toBe('f1');
  });

  test('new head discards old state -- a different head does not return the prior review state', () => {
    const cwd = tmpCwd();
    const target = statePath('42', cwd);
    writeState(target, pendingState({ headSha: 'head-A' }), { cwd });
    const result = readState(target, 'head-B', { cwd });
    expect(result.ok).toBe(true);
    expect(result.discarded).toBe(true);
    expect(result.state).toBeNull();
    expect(result.dispositionedFindings).toEqual([]);
  });

  test('reading a path with no report yet reports not-exists without error', () => {
    const cwd = tmpCwd();
    const target = statePath('no-such-pr', cwd);
    const result = readState(target, 'any-head', { cwd });
    expect(result.ok).toBe(true);
    expect(result.exists).toBe(false);
  });

  test('refuses to write to a path outside .ensemble/pr-review/', () => {
    const cwd = tmpCwd();
    const outside = path.join(cwd, 'evil.json');
    const result = writeState(outside, pendingState(), { cwd });
    expect(result.ok).toBe(false);
    expect(fs.existsSync(outside)).toBe(false);
  });

  test('refuses to read from a path outside .ensemble/pr-review/', () => {
    const cwd = tmpCwd();
    const outside = path.join(cwd, 'evil.json');
    fs.writeFileSync(outside, JSON.stringify(pendingState()));
    const result = readState(outside, 'head-sha-1', { cwd });
    expect(result.ok).toBe(false);
  });
});

describe('pr-review-state: writeState publishes atomically', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('a successful write leaves exactly the report behind -- no temp files', () => {
    const cwd = tmpCwd();
    const target = statePath('42', cwd);
    expect(writeState(target, pendingState(), { cwd }).ok).toBe(true);
    expect(fs.readdirSync(path.dirname(target))).toEqual([path.basename(target)]);
  });

  test('overwriting a report replaces it whole', () => {
    const cwd = tmpCwd();
    const target = statePath('42', cwd);
    writeState(target, pendingState({ headSha: 'head-v1' }), { cwd });
    writeState(target, pendingState({ headSha: 'head-v2' }), { cwd });
    expect(JSON.parse(fs.readFileSync(target, 'utf8')).headSha).toBe('head-v2');
  });

  test('the report only changes at the rename: the new content is complete in a same-directory temp file first', () => {
    const cwd = tmpCwd();
    const target = statePath('42', cwd);
    writeState(target, pendingState({ headSha: 'head-v1' }), { cwd });
    const previous = fs.readFileSync(target, 'utf8');

    const realRename = fs.renameSync;
    const publishes = [];
    jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      publishes.push({
        from,
        to,
        targetBeforePublish: fs.readFileSync(to, 'utf8'),
        stagedContent: fs.readFileSync(from, 'utf8'),
      });
      return realRename(from, to);
    });

    writeState(target, pendingState({ headSha: 'head-v2' }), { cwd });

    expect(publishes).toHaveLength(1);
    expect(publishes[0].to).toBe(target);
    expect(path.dirname(publishes[0].from)).toBe(path.dirname(target));
    expect(publishes[0].from).not.toBe(target);
    expect(publishes[0].targetBeforePublish).toBe(previous);
    expect(JSON.parse(publishes[0].stagedContent).headSha).toBe('head-v2');
  });

  test('a write that fails before the report is published leaves the previous report intact and no temp debris', () => {
    const cwd = tmpCwd();
    const target = statePath('42', cwd);
    writeState(target, pendingState({ headSha: 'head-v1' }), { cwd });
    const previous = fs.readFileSync(target, 'utf8');

    jest.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('simulated crash before publish');
    });
    expect(() => writeState(target, pendingState({ headSha: 'head-v2' }), { cwd })).toThrow(
      'simulated crash before publish'
    );
    jest.restoreAllMocks();

    expect(fs.readFileSync(target, 'utf8')).toBe(previous);
    expect(fs.readdirSync(path.dirname(target))).toEqual([path.basename(target)]);
  });

  test('a failed first write leaves no report and no temp debris behind', () => {
    const cwd = tmpCwd();
    const target = statePath('fresh', cwd);
    jest.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('simulated crash before publish');
    });
    expect(() => writeState(target, pendingState(), { cwd })).toThrow('simulated crash before publish');
    jest.restoreAllMocks();

    expect(fs.readdirSync(path.dirname(target))).toEqual([]);
  });
});

describe('pr-review-state: readState survives a corrupt report', () => {
  const CORRUPT_REPORTS = [
    ['truncated JSON', '{"headSha":"head-sha-1","ledger":[{"id":'],
    ['an empty file', ''],
    ['non-JSON text', 'not json at all'],
    ['JSON null', 'null'],
    ['a JSON array', '[]'],
    ['a JSON string', '"head-sha-1"'],
  ];

  function plantReport(content) {
    const cwd = tmpCwd();
    const target = statePath('corrupt', cwd);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    return { cwd, target };
  }

  test.each(CORRUPT_REPORTS)(
    'a corrupt report (%s) yields a structured not-ok result instead of throwing',
    (_label, content) => {
      const { cwd, target } = plantReport(content);
      let result;
      expect(() => {
        result = readState(target, 'head-sha-1', { cwd });
      }).not.toThrow();
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('corrupt');
      expect(result.state).toBeNull();
      expect(result.dispositionedFindings).toEqual([]);
    }
  );

  test('a corrupt report does not wedge resume: it can be rewritten and then read back', () => {
    const { cwd, target } = plantReport('{"headSha":');
    expect(readState(target, 'head-sha-1', { cwd }).ok).toBe(false);
    expect(writeState(target, pendingState(), { cwd }).ok).toBe(true);
    const result = readState(target, 'head-sha-1', { cwd });
    expect(result.ok).toBe(true);
    expect(result.discarded).toBe(false);
    expect(result.dispositionedFindings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Round 2. A report resumes only for a head that is named and equals the head
// the report was written for; anything else is refused or discarded.
// ---------------------------------------------------------------------------

describe('pr-review-state: readState needs a head to resume for', () => {
  const NO_HEAD = [undefined, null, '', '   ', 0, 1, NaN, true, false, {}, [], ['head-sha-1']];
  const LEDGER = [{ id: 'f1', disposition: 'fix', evidence: 'stack trace' }];
  const DISCARDED = { ok: true, exists: true, discarded: true, state: null, dispositionedFindings: [] };

  test.each(NO_HEAD)('a headSha of %p is refused whatever report is on disk', (headSha) => {
    const cwd = tmpCwd();
    const target = statePath('7', cwd);
    // No report yet, a report for a head, and a report that carries no head at all.
    expect(readState(target, headSha, { cwd })).toEqual({ ok: false, reason: 'headSha required' });
    writeState(target, pendingState({ headSha: 'head-sha-1' }), { cwd });
    expect(readState(target, headSha, { cwd })).toEqual({ ok: false, reason: 'headSha required' });
    writeState(target, { ledger: LEDGER }, { cwd });
    expect(readState(target, headSha, { cwd })).toEqual({ ok: false, reason: 'headSha required' });
  });

  test('the report that used to resume for any head when none was named no longer does', () => {
    const cwd = tmpCwd();
    const target = statePath('7', cwd);
    writeState(target, { ledger: LEDGER }, { cwd });
    const result = readState(target, undefined, { cwd });
    expect(result.ok).toBe(false);
    expect(result.state).toBeUndefined();
    expect(result.dispositionedFindings).toBeUndefined();
  });

  test.each([
    ['no headSha at all', { ledger: LEDGER }],
    ['a null headSha', { headSha: null, ledger: LEDGER }],
    ['a blank headSha', { headSha: '', ledger: LEDGER }],
    ['a whitespace headSha', { headSha: '   ', ledger: LEDGER }],
    ['a numeric headSha', { headSha: 5, ledger: LEDGER }],
    ['an array headSha', { headSha: ['head-H'], ledger: LEDGER }],
    ['an object headSha', { headSha: { sha: 'head-H' }, ledger: LEDGER }],
    ['a headSha that differs in letter case', { headSha: 'HEAD-h', ledger: LEDGER }],
    ['a headSha with padding', { headSha: ' head-H', ledger: LEDGER }],
  ])('a stored report with %s is discarded for the head named, never resumed', (_label, stored) => {
    const cwd = tmpCwd();
    const target = statePath('7', cwd);
    writeState(target, stored, { cwd });
    expect(readState(target, 'head-H', { cwd })).toEqual(DISCARDED);
  });

  test('a stored report resumes only for exactly its own head, with its dispositioned findings', () => {
    const cwd = tmpCwd();
    const target = statePath('7', cwd);
    writeState(target, pendingState({ headSha: 'head-H', ledger: LEDGER }), { cwd });
    const result = readState(target, 'head-H', { cwd });
    expect(result).toMatchObject({ ok: true, exists: true, discarded: false });
    expect(result.dispositionedFindings.map((finding) => finding.id)).toEqual(['f1']);
  });
});

describe('pr-review-state: a report that could not be read back is not written', () => {
  test.each([undefined, null, 'x', 5, true, [], [{ headSha: 'h' }]])(
    'a state of %p is refused, and nothing is created on disk',
    (state) => {
      const cwd = tmpCwd();
      const target = statePath('w', cwd);
      expect(writeState(target, state, { cwd })).toEqual({ ok: false, reason: 'state must be an object' });
      expect(fs.readdirSync(cwd)).toEqual([]);
    }
  );

  test.each([undefined, null, '', '   ', 5, true, {}, []])('a targetPath of %p is refused by both write and read', (targetPath) => {
    const cwd = tmpCwd();
    expect(writeState(targetPath, pendingState(), { cwd })).toEqual({ ok: false, reason: 'targetPath required' });
    expect(readState(targetPath, 'head-sha-1', { cwd })).toEqual({ ok: false, reason: 'targetPath required' });
    expect(fs.readdirSync(cwd)).toEqual([]);
  });

  test('options that are not an object fall back to the working directory instead of throwing', () => {
    const cwd = tmpCwd();
    const target = statePath('w', cwd);
    for (const options of [null, 0, '', undefined]) {
      expect(() => writeState(target, pendingState(), options)).not.toThrow();
      expect(() => readState(target, 'head-sha-1', options)).not.toThrow();
    }
    // The report path is outside the working directory's state dir, so nothing was written there.
    expect(fs.readdirSync(cwd)).toEqual([]);
  });

  test('a valid state is still written and read back', () => {
    const cwd = tmpCwd();
    const target = statePath('w', cwd);
    expect(writeState(target, pendingState({ headSha: 'head-H' }), { cwd }).ok).toBe(true);
    expect(readState(target, 'head-H', { cwd }).discarded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Round 3. fix-issue's local report is written for the reviewed SNAPSHOT head; PR creation then makes the one real commit, so
// the remote run resumes under a different head. A report must still carry forward when that commit holds the reviewed
// content: it resumes for its own head OR for any head whose tree is the tree it records as reviewed.
// ---------------------------------------------------------------------------

describe('pr-review-state: a report resumes for the head it was written for or for a head holding its reviewed tree', () => {
  // Full object ids, the only shape either side's tree may take.
  const SNAPSHOT = 'a'.repeat(40);
  const PUBLISHED = 'b'.repeat(40);
  const TREE_A = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
  const TREE_B = '9daeafb9864cf43055ae93beb0afd6c7d144bfa4';
  const TREE_256 = 'cd34'.repeat(16);
  const LEDGER = [{ id: 'f1', disposition: 'fix', evidence: 'stack trace' }];
  const DISCARDED = { ok: true, exists: true, discarded: true, state: null, dispositionedFindings: [] };

  /** What the local phase records for the reviewed snapshot S whose tree is `reviewedTreeSha`. */
  const localReport = (overrides = {}) => ({
    headSha: SNAPSHOT,
    reviewedHeadSha: SNAPSHOT,
    reviewedTreeSha: TREE_A,
    localPhase: 'LOCAL_REVIEW_COMPLETE',
    ledger: LEDGER,
    ...overrides,
  });

  /** Writes `report` for a fresh PR and reads it back for `headSha`, naming `treeSha` when given. */
  function roundTrip(report, headSha, treeSha) {
    const cwd = tmpCwd();
    const target = statePath('42', cwd);
    expect(writeState(target, report, { cwd }).ok).toBe(true);
    return readState(target, headSha, treeSha === undefined ? { cwd } : { cwd, treeSha });
  }

  /** Plants a report on disk as written, bypassing writeState's own checks: what a damaged or hand-edited file looks like. */
  function plant(report, headSha, treeSha) {
    const cwd = tmpCwd();
    const target = statePath('42', cwd);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(report));
    return readState(target, headSha, { cwd, treeSha });
  }

  test('a commit holding the reviewed tree resumes the report, with its recorded facts and dispositioned findings', () => {
    const result = roundTrip(localReport(), PUBLISHED, TREE_A);
    expect(result).toMatchObject({ ok: true, exists: true, discarded: false });
    expect(result.state.reviewedHeadSha).toBe(SNAPSHOT);
    expect(result.state.reviewedTreeSha).toBe(TREE_A);
    expect(result.dispositionedFindings.map((finding) => finding.id)).toEqual(['f1']);
  });

  test('64-hex trees resume the same way', () => {
    expect(roundTrip(localReport({ reviewedTreeSha: TREE_256 }), PUBLISHED, TREE_256).discarded).toBe(false);
  });

  test('the same head still resumes without any tree, exactly as before', () => {
    expect(roundTrip(localReport({ reviewedTreeSha: undefined }), SNAPSHOT).discarded).toBe(false);
    expect(roundTrip(localReport(), SNAPSHOT).discarded).toBe(false);
  });

  test('the same head resumes whatever tree is named: head equality suffices (decided, not accidental)', () => {
    // A tree only ever adds a way to resume; it never takes the head's way away.
    expect(roundTrip(localReport(), SNAPSHOT, TREE_B).discarded).toBe(false);
    expect(roundTrip(localReport(), SNAPSHOT, 'main').discarded).toBe(false);
  });

  test.each([
    ['a different tree', localReport(), TREE_B],
    ['a 64-hex tree against a 40-hex one', localReport(), TREE_256],
    ['a tree that differs only in letter case', localReport(), TREE_A.toUpperCase()],
    ['no tree named when one is recorded', localReport(), undefined],
    ['a tree named when none is recorded', localReport({ reviewedTreeSha: undefined }), TREE_A],
    ['a null tree recorded', localReport({ reviewedTreeSha: null }), TREE_A],
    ['neither side having a tree', localReport({ reviewedTreeSha: undefined }), undefined],
    ['both sides null', localReport({ reviewedTreeSha: null }), null],
  ])('a different head with %s is discarded, never resumed', (_label, report, treeSha) => {
    expect(roundTrip(report, PUBLISHED, treeSha)).toEqual(DISCARDED);
  });

  const UNREADABLE = [
    ['a branch name', 'main'],
    ['a blank string', ''],
    ['whitespace only', '   '],
    ['an abbreviated id', TREE_A.slice(0, 7)],
    ['a 39-hex string', TREE_A.slice(0, 39)],
    ['a 41-hex string', `${TREE_A}a`],
    ['an id padded with whitespace', ` ${TREE_A}`],
    ['an id with a trailing newline', `${TREE_A}\n`],
    ['a number', 5],
    ['true', true],
    ['an object', { sha: TREE_A }],
    ['an array wrapping a valid id', [TREE_A]],
  ];

  test.each(UNREADABLE)('two trees that are equal because both are %s are not the same tree: discarded', (_label, value) => {
    expect(plant(localReport({ reviewedTreeSha: value }), PUBLISHED, value)).toEqual(DISCARDED);
  });

  test.each(UNREADABLE)('a recorded tree that is %s never matches a readable one: discarded', (_label, value) => {
    expect(plant(localReport({ reviewedTreeSha: value }), PUBLISHED, TREE_A)).toEqual(DISCARDED);
  });

  test.each(UNREADABLE)('a named tree that is %s never matches a readable recorded one: discarded', (_label, value) => {
    expect(plant(localReport(), PUBLISHED, value)).toEqual(DISCARDED);
  });

  test('a tree never stands in for the head: a missing head is still refused', () => {
    const cwd = tmpCwd();
    const target = statePath('42', cwd);
    writeState(target, localReport(), { cwd });
    for (const headSha of [undefined, null, '', '   ', 5, {}]) {
      expect(readState(target, headSha, { cwd, treeSha: TREE_A })).toEqual({ ok: false, reason: 'headSha required' });
    }
  });

  test('a damaged report is still reported corrupt when a tree is named', () => {
    const cwd = tmpCwd();
    const target = statePath('42', cwd);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '{"reviewedTreeSha":');
    expect(readState(target, PUBLISHED, { cwd, treeSha: TREE_A })).toMatchObject({ ok: false, reason: 'corrupt' });
  });

  test('a tree option of any type is read without throwing', () => {
    for (const treeSha of [undefined, null, 0, 5, true, '', {}, [], Object.create(null), Symbol.iterator]) {
      expect(() => plant(localReport(), PUBLISHED, treeSha)).not.toThrow();
    }
  });

  test("the object-id rule is the scope module's own: state delegates to it instead of keeping a copy", () => {
    const accepted = 'accepted-by-the-scope-module';
    let isolated;
    jest.isolateModules(() => {
      jest.doMock('../lib/pr-review-scope', () => ({
        ...jest.requireActual('../lib/pr-review-scope'),
        isObjectId: (value) => value === accepted,
      }));
      isolated = require('../lib/pr-review-state');
    });
    jest.dontMock('../lib/pr-review-scope');

    const cwd = tmpCwd();
    const target = isolated.statePath('42', cwd);
    // A tree the shared rule accepts is recorded, and resumes the report for a different head ...
    expect(isolated.writeState(target, localReport({ reviewedTreeSha: accepted }), { cwd }).ok).toBe(true);
    expect(isolated.readState(target, PUBLISHED, { cwd, treeSha: accepted }).discarded).toBe(false);
    // ... and a real hex id is refused once the shared rule says so.
    expect(isolated.writeState(target, localReport({ reviewedTreeSha: TREE_A }), { cwd }).ok).toBe(false);
  });

  describe('writeState records the reviewed tree only when it is a full object id', () => {
    test('a readable reviewedTreeSha is written verbatim', () => {
      for (const tree of [TREE_A, TREE_256, TREE_A.toUpperCase()]) {
        const cwd = tmpCwd();
        const target = statePath('42', cwd);
        expect(writeState(target, localReport({ reviewedTreeSha: tree }), { cwd }).ok).toBe(true);
        expect(JSON.parse(fs.readFileSync(target, 'utf8')).reviewedTreeSha).toBe(tree);
      }
    });

    test.each([undefined, null])('a reviewedTreeSha of %p means no tree was supplied: the report is written', (tree) => {
      const cwd = tmpCwd();
      const target = statePath('42', cwd);
      expect(writeState(target, localReport({ reviewedTreeSha: tree }), { cwd }).ok).toBe(true);
    });

    test.each(UNREADABLE)('a reviewedTreeSha that is %s is refused, naming it, and nothing is created on disk', (_label, value) => {
      const cwd = tmpCwd();
      const target = statePath('42', cwd);
      const result = writeState(target, localReport({ reviewedTreeSha: value }), { cwd });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('reviewedTreeSha');
      expect(fs.readdirSync(cwd)).toEqual([]);
    });

    test('a refused write leaves the previous report exactly as it was', () => {
      const cwd = tmpCwd();
      const target = statePath('42', cwd);
      writeState(target, localReport(), { cwd });
      const before = fs.readFileSync(target, 'utf8');
      expect(writeState(target, localReport({ headSha: PUBLISHED, reviewedTreeSha: 'main' }), { cwd }).ok).toBe(false);
      expect(fs.readFileSync(target, 'utf8')).toBe(before);
      expect(fs.readdirSync(path.dirname(target))).toEqual([path.basename(target)]);
    });
  });
});
