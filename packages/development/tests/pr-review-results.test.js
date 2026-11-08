'use strict';

/**
 * kata et2k: review results by file, deadlines and agent-failure classification
 * (lib/pr-review-results.js, plan section 3C).
 *
 * What is pinned, each against a guard that must fail when removed:
 *   AC1  an expired verifier leaves its candidate `unverified`; an expired
 *        reviewer leaves its slice's paths uncovered -- through the REAL
 *        `tallyVotes` and `runSlices`, not through a copy of their rules;
 *   AC2  a string-instead-of-object yield is accepted; a truncated, unparseable,
 *        wrong-schema or non-regular file is quarantined as invalid with a reason;
 *   AC3  re-running `collectResults` after a crash reproduces the classification,
 *        and a file the agent later rewrites or deletes changes nothing;
 *   AC4  every classification, the deadline policy bounds and the failure table;
 *   AC5  (review round 1) an agent that can write into `dir` cannot make the
 *        collector write through a symlink, read anything but the one result file,
 *        or trust a scratch directory it could have planted;
 *   AC6  (review round 1) a result arrives only when its CHANGE time, which no
 *        writer can set backwards, lies in [dispatchedAt, deadlineAt]: stale
 *        files, another round's scratch copies and backdated mtimes do not count;
 *   AC7  (review round 1) a sliced reviewer must name its paths, and a retry never
 *        waits past the agent's deadline or past the total wait cap;
 *   AC8  (review round 1) the docs say `maxConcurrentAgents` is not enforced and
 *        that nothing calls `results` yet.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const crypto = require('crypto');

const { reviewDeadlines, collectResults, toVotesInput, classifyAgentFailure, defaultDeps, defaultScratchDir } = require('../lib/pr-review-results');
const { loadPolicy, DEFAULT_POLICY } = require('../lib/pr-review-policy');
const { tallyVotes } = require('../lib/pr-review-votes');
const { runSlices, runResults, HANDLERS } = require('../lib/pr-review-cli');

const CLI = path.join(__dirname, '..', 'lib', 'pr-review-cli.js');
const BASE_SHA = 'b'.repeat(40);
const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 10, 6, 12, 0, 0);

let root;
let dir;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-review-results-'));
  dir = path.join(root, 'results');
  fs.mkdirSync(dir);
});
afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

/** Where the collector keeps its copies: beside `dir`, never inside it (the agents write inside `dir`). */
const scratch = () => defaultScratchDir(dir);

/** Writes an agent's result file, and stamps its modification time (when it "arrived"). */
function write(name, body, at = T0) {
  const file = path.join(dir, `out-${name}.json`);
  fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
  fs.utimesSync(file, at / 1000, at / 1000);
  return file;
}

const review = (findings = [], pathsReviewed = []) => ({ findings, pathsReviewed });
const ballot = (...votes) => ({ votes: votes.map(([candidateId, verdict]) => ({ candidateId, verdict })) });
const reviewer = (name, extra = {}) => ({ name, role: 'reviewer', dispatchedAt: T0, deadlineAt: T0 + 15 * MIN, ...extra });
const verifier = (name, extra = {}) => ({ name, role: 'verifier', dispatchedAt: T0, deadlineAt: T0 + 5 * MIN, ...extra });

/**
 * A result file's arrival is its inode change time, which a test cannot move backwards, so `write` stamps the arrival
 * the old way (the modification time) and this wrapper reports that stamp as the change time. Everything else is the
 * real file system: the real `readFile` (without the `lstat` it would be compared with, whose time is the stamp), the
 * real `writeFile` and the real scratch checks. Tests of the change time itself use no wrapper.
 */
const realIo = defaultDeps();
const stamped = {
  ...realIo,
  lstat: (file) => {
    const facts = realIo.lstat(file);
    return facts === null ? null : { ...facts, ctimeMs: facts.mtimeMs };
  },
  readFile: (file) => realIo.readFile(file),
};
const collect = (expected, now = T0 + MIN, extra = {}) => collectResults({ expected, dir, now, ...extra }, stamped);
const stateOf = (result, name) => result.agents.find((agent) => agent.name === name);

// ---------------------------------------------------------------------------
// Deadlines and policy
// ---------------------------------------------------------------------------

describe('reviewDeadlines', () => {
  test.each([
    ['reviewer', 15],
    ['verifier', 5],
    ['security', 15],
  ])('%s gets %i minutes from the start by default', (role, minutes) => {
    const result = reviewDeadlines({ role, now: T0, tier: 'high', depth: 'deep' });
    expect(result).toMatchObject({ ok: true, role, minutes, source: 'default', tier: 'high', depth: 'deep' });
    expect(result.deadlineAt).toBe(T0 + minutes * MIN);
    expect(result.deadlineAtIso).toBe(new Date(T0 + minutes * MIN).toISOString());
  });

  test('a policy override moves one role and leaves the others', () => {
    const { policy } = loadPolicy({
      baseSha: BASE_SHA,
      sourceSha: BASE_SHA,
      text: '```ensemble-review-policy\n{"deadlineMinutes":{"verifier":9}}\n```\n',
    });
    expect(reviewDeadlines({ role: 'verifier', now: T0, policy })).toMatchObject({ minutes: 9, source: 'policy' });
    expect(reviewDeadlines({ role: 'reviewer', now: T0, policy })).toMatchObject({ minutes: 15 });
    expect(reviewDeadlines({ role: 'reviewer', now: T0 })).toMatchObject({ minutes: 15, source: 'default' });
  });

  test('a policy value outside 1..60 is not used even when the caller hands it over unvalidated', () => {
    const result = reviewDeadlines({ role: 'reviewer', now: T0, policy: { deadlineMinutes: { reviewer: 600 } } });
    expect(result.minutes).toBe(15);
    expect(result.warnings.join(' ')).toMatch(/out of range/);
  });

  test.each([
    [{ role: 'janitor', now: T0 }, /unknown role/],
    [{ role: 'reviewer' }, /now must be/],
    [{ role: 'reviewer', now: 'yesterday' }, /now must be/],
    [{ role: 'reviewer', now: T0, tier: 'critical' }, /unknown tier/],
    [{ role: 'reviewer', now: T0, depth: 'shallow' }, /unknown depth/],
    ['reviewer', /invalid-input/],
  ])('refuses %j rather than guessing a deadline', (input, reason) => {
    const result = reviewDeadlines(input);
    expect(result.ok).toBe(false);
    expect(result.deadlineAt).toBeNull();
    expect(result.reason).toMatch(reason);
  });
});

describe('policy keys deadlineMinutes and maxConcurrentAgents', () => {
  const load = (policy) =>
    loadPolicy({ baseSha: BASE_SHA, sourceSha: BASE_SHA, text: `\`\`\`ensemble-review-policy\n${JSON.stringify(policy)}\n\`\`\`\n` });

  test('defaults: reviewer 15, verifier 5, security 15 and 8 concurrent agents', () => {
    expect(DEFAULT_POLICY.deadlineMinutes).toEqual({ reviewer: 15, verifier: 5, security: 15 });
    expect(DEFAULT_POLICY.maxConcurrentAgents).toBe(8);
  });

  test.each([0, 61, 1.5, '5', null, -3])('deadlineMinutes.reviewer = %j is rejected by name and the default stays', (value) => {
    const result = load({ deadlineMinutes: { reviewer: value, verifier: 7 } });
    expect(result.rejected.map((entry) => entry.key)).toEqual(['deadlineMinutes.reviewer']);
    expect(result.policy.deadlineMinutes).toEqual({ reviewer: 15, verifier: 7, security: 15 });
  });

  test('both bounds are accepted, and an unknown role or a non-object is rejected by name', () => {
    expect(load({ deadlineMinutes: { reviewer: 1, security: 60 } }).policy.deadlineMinutes).toEqual({ reviewer: 1, verifier: 5, security: 60 });
    expect(load({ deadlineMinutes: { janitor: 5 } }).rejected).toEqual([{ key: 'deadlineMinutes.janitor', reason: 'unknown-key', value: 5 }]);
    expect(load({ deadlineMinutes: 5 }).rejected.map((entry) => entry.key)).toEqual(['deadlineMinutes']);
  });

  test.each([0, 33, 2.5, '8', -1])('maxConcurrentAgents = %j is rejected and 8 stays', (value) => {
    const result = load({ maxConcurrentAgents: value });
    expect(result.rejected.map((entry) => entry.key)).toEqual(['maxConcurrentAgents']);
    expect(result.policy.maxConcurrentAgents).toBe(8);
  });

  test.each([1, 12, 32])('maxConcurrentAgents = %i is accepted', (value) => {
    expect(load({ maxConcurrentAgents: value }).policy.maxConcurrentAgents).toBe(value);
  });
});

// ---------------------------------------------------------------------------
// collectResults: classification
// ---------------------------------------------------------------------------

describe('collectResults classification', () => {
  test('a valid reviewer and verifier file arrive, are tagged with their agent and are copied to scratch', () => {
    write('rev1', review([{ id: 'f1', description: 'x' }], ['./a.js', 'b.js']));
    write('ver1', ballot(['f1', 'REAL']));
    const result = collect([reviewer('rev1'), verifier('ver1')]);

    expect(result.ok).toBe(true);
    expect(result.agents.map((agent) => agent.state)).toEqual(['arrived', 'arrived']);
    expect(result.findings).toEqual([{ id: 'f1', description: 'x', reviewer: 'rev1' }]);
    expect(result.votes).toEqual([{ verifier: 'ver1', candidateId: 'f1', verdict: 'real' }]);
    expect(fs.existsSync(path.join(scratch(), 'out-rev1.json'))).toBe(true);
    expect(fs.existsSync(path.join(scratch(), 'out-ver1.json'))).toBe(true);
  });

  test('a reviewer cannot sign its findings as someone else', () => {
    write('rev1', review([{ id: 'f1', reviewer: 'ver9' }], []));
    expect(collect([reviewer('rev1')]).findings[0].reviewer).toBe('rev1');
  });

  test('nothing written yet is missing and pending before the deadline, expired after it', () => {
    const early = collect([verifier('ver1')], T0 + 4 * MIN);
    expect(stateOf(early, 'ver1')).toMatchObject({ state: 'missing', pending: true });

    const late = collect([verifier('ver1')], T0 + 5 * MIN);
    expect(stateOf(late, 'ver1')).toMatchObject({ state: 'expired', reason: 'deadline-passed', pending: false });
    expect(late.ok).toBe(false);
    expect(late.reason).toBe('incomplete');
  });

  test('a valid file written after the deadline is expired, one written exactly at it arrived', () => {
    write('ver1', ballot(['f1', 'real']), T0 + 5 * MIN + 1);
    write('ver2', ballot(['f1', 'real']), T0 + 5 * MIN);
    const result = collect([verifier('ver1'), verifier('ver2')], T0 + 6 * MIN);
    expect(stateOf(result, 'ver1')).toMatchObject({ state: 'expired', reason: 'arrived-after-deadline' });
    expect(stateOf(result, 'ver2').state).toBe('arrived');
    expect(result.votes.map((vote) => vote.verifier)).toEqual(['ver2']);
  });

  test('a yield that is a JSON string holding the object is accepted; a string inside a string is not', () => {
    write('rev1', JSON.stringify(JSON.stringify(review([{ id: 'f1' }], ['a.js']))));
    write('rev2', JSON.stringify(JSON.stringify(JSON.stringify(review([], [])))));
    const result = collect([reviewer('rev1'), reviewer('rev2')]);
    expect(stateOf(result, 'rev1').state).toBe('arrived');
    expect(stateOf(result, 'rev2')).toMatchObject({ state: 'invalid', reason: 'yield-not-an-object' });
  });

  test.each([
    ['empty', '', 'empty-file'],
    ['truncated', '{"findings":[{"id":"f1"},', 'unparseable-json'],
    ['prose', 'I found three issues.', 'unparseable-json'],
    ['a bare number', '42', 'yield-not-an-object'],
    ['an array', '[]', 'yield-not-an-object'],
    ['findings as an object', JSON.stringify({ findings: { id: 'f1' }, pathsReviewed: [] }), 'invalid-findings'],
    ['a non-object finding', JSON.stringify({ findings: ['x'], pathsReviewed: [] }), 'invalid-findings'],
    ['missing pathsReviewed', JSON.stringify({ findings: [] }), 'invalid-paths-reviewed'],
    ['a blank reviewed path', JSON.stringify({ findings: [], pathsReviewed: [' '] }), 'invalid-paths-reviewed'],
  ])('a reviewer file that is %s is quarantined as invalid (%s)', (_label, body, reason) => {
    write('rev1', body);
    const result = collect([reviewer('rev1')]);
    expect(stateOf(result, 'rev1')).toMatchObject({ state: 'invalid', reason, pending: true });
    expect(result.findings).toEqual([]);
    expect(result.reviewedSlices).toEqual([]);
    const quarantined = path.join(scratch(), 'quarantine');
    expect(JSON.parse(fs.readFileSync(path.join(quarantined, 'out-rev1.reason.json'), 'utf8'))).toEqual({ name: 'rev1', reason });
    expect(fs.existsSync(path.join(scratch(), 'out-rev1.json'))).toBe(false);
  });

  test.each([
    ['votes missing', JSON.stringify({}), 'invalid-votes'],
    ['a vote with no candidate', JSON.stringify({ votes: [{ verdict: 'real' }] }), 'vote-needs-candidate-id'],
    ['an unknown verdict', JSON.stringify({ votes: [{ candidateId: 'f1', verdict: 'probably' }] }), 'unknown-verdict'],
    ['a verdict that is not text', JSON.stringify({ votes: [{ candidateId: 'f1', verdict: true }] }), 'unknown-verdict'],
  ])('a verifier file with %s is invalid (%s) and one bad vote spoils the whole file', (_label, body, reason) => {
    write('ver1', body);
    const result = collect([verifier('ver1')]);
    expect(stateOf(result, 'ver1')).toMatchObject({ state: 'invalid', reason });
    expect(result.votes).toEqual([]);
  });

  test('an invalid file is pending until the deadline (the agent may still be mid-write) and then final', () => {
    write('ver1', '{"votes":[');
    expect(stateOf(collect([verifier('ver1')], T0 + MIN), 'ver1').pending).toBe(true);
    expect(stateOf(collect([verifier('ver1')], T0 + 6 * MIN), 'ver1')).toMatchObject({ state: 'invalid', pending: false });
  });

  test('a file that appears complete on a later pass replaces an earlier invalid one', () => {
    write('ver1', '{"votes":[');
    expect(stateOf(collect([verifier('ver1')]), 'ver1').state).toBe('invalid');
    write('ver1', ballot(['f1', 'real']));
    expect(stateOf(collect([verifier('ver1')]), 'ver1').state).toBe('arrived');
  });

  test('a symlink is not a result: it is never followed', () => {
    const secret = path.join(dir, 'secret.json');
    fs.writeFileSync(secret, JSON.stringify(review([{ id: 'planted' }], [])));
    fs.symlinkSync(secret, path.join(dir, 'out-rev1.json'));
    const result = collect([reviewer('rev1')]);
    expect(stateOf(result, 'rev1')).toMatchObject({ state: 'invalid', reason: 'not-a-regular-file' });
    expect(result.findings).toEqual([]);
  });

  test('an oversized file is invalid without being read', () => {
    const reads = [];
    const deps = {
      lstat: () => ({ mtimeMs: T0, size: 9 * 1024 * 1024, isFile: true }),
      readFile: (file) => reads.push(file),
      writeFile: () => {},
    };
    const result = collectResults({ expected: [reviewer('rev1')], dir, now: T0 + MIN }, deps);
    expect(stateOf(result, 'rev1')).toMatchObject({ state: 'invalid', reason: 'result-too-large' });
    expect(reads).toEqual([]);
  });

  test('a read error is invalid with the error code, never a throw', () => {
    const deps = {
      lstat: () => ({ mtimeMs: T0, ctimeMs: T0, size: 10, isFile: true }),
      readFile: () => {
        const error = new Error('denied');
        error.code = 'EACCES';
        throw error;
      },
      writeFile: () => {},
    };
    const result = collectResults({ expected: [verifier('ver1')], dir, now: T0 + MIN }, deps);
    expect(stateOf(result, 'ver1')).toMatchObject({ state: 'invalid', reason: 'unreadable-file:EACCES' });
  });

  test('a scratch directory that cannot be written costs a warning, not the classification', () => {
    write('ver1', ballot(['f1', 'real']));
    const deps = {
      lstat: (file) => {
        const stat = fs.lstatSync(file, { throwIfNoEntry: false });
        return stat ? { mtimeMs: stat.mtimeMs, ctimeMs: stat.mtimeMs, size: stat.size, isFile: stat.isFile(), isDirectory: stat.isDirectory(), uid: stat.uid, mode: stat.mode } : null;
      },
      readFile: (file) => fs.readFileSync(file, 'utf8'),
      writeFile: () => {
        const error = new Error('read-only');
        error.code = 'EROFS';
        throw error;
      },
    };
    const result = collectResults({ expected: [verifier('ver1')], dir, now: T0 + MIN }, deps);
    expect(stateOf(result, 'ver1')).toMatchObject({ state: 'arrived', scratchError: 'EROFS' });
    expect(result.warnings.join(' ')).toMatch(/EROFS/);
  });
});

// ---------------------------------------------------------------------------
// collectResults: request validation (an unreadable request is never "all reviewed")
// ---------------------------------------------------------------------------

describe('collectResults refuses requests it cannot read', () => {
  const good = () => ({ expected: [verifier('ver1')], dir, now: T0 });

  test.each([
    ['not an object', () => ('x'), /invalid-input/],
    ['no agents at all', () => ({ ...good(), expected: [] }), /non-empty array/],
    ['no dir', () => ({ ...good(), dir: '' }), /dir must be/],
    ['no clock', () => ({ ...good(), now: undefined }), /now must be/],
    ['an agent without a deadline', () => ({ ...good(), expected: [{ name: 'ver1', role: 'verifier' }] }), /deadlineAt/],
    ['an unknown role', () => ({ ...good(), expected: [{ name: 'ver1', role: 'judge', deadlineAt: T0 }] }), /role must be/],
    ['a path-climbing name', () => ({ ...good(), expected: [verifier('../etc/passwd')] }), /safe file-name/],
    ['a name with a separator', () => ({ ...good(), expected: [verifier('a/b')] }), /safe file-name/],
    ['a hidden-file name', () => ({ ...good(), expected: [verifier('.x')] }), /safe file-name/],
    ['a duplicate name, case-folded', () => ({ ...good(), expected: [verifier('ver1'), verifier('VER1')] }), /listed twice/],
    ['candidateIds that are not a list', () => ({ ...good(), expected: [verifier('ver1', { candidateIds: 'f1' })] }), /candidateIds/],
    ['a slice id that is not text', () => ({ ...good(), expected: [reviewer('rev1', { sliceId: 3 })] }), /sliceId/],
  ])('%s', (_label, build, reason) => {
    const input = build();
    const result = collectResults(input);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(reason);
    expect(result.agents).toEqual([]);
    expect(result.reviewedSlices).toEqual([]);
  });

  test('an unsafe name never reaches the file system', () => {
    const touched = [];
    const deps = { lstat: (f) => touched.push(f), readFile: (f) => touched.push(f), writeFile: (f) => touched.push(f) };
    collectResults({ expected: [verifier('../x')], dir, now: T0 }, deps);
    expect(touched).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC1: not-arrived agents are "not reviewed", proven through the real consumers
// ---------------------------------------------------------------------------

describe('AC1: expired agents become not-reviewed automatically', () => {
  const candidates = [{ id: 'f1', severity: 'important' }, { id: 'f2', severity: 'important' }];
  const verifiers = ['v1', 'v2', 'v3'];
  const tally = (collected) => tallyVotes(toVotesInput(collected, { candidates, depth: 'standard' }));
  const outcomeOf = (result, id) => result.findings.find((finding) => finding.id === id);

  test('with all three verifiers in, a 3-of-3 finding is present', () => {
    for (const name of verifiers) write(name, ballot(['f1', 'real'], ['f2', 'not-real']));
    const result = tally(collect(verifiers.map((name) => verifier(name))));
    expect(outcomeOf(result, 'f1')).toMatchObject({ outcome: 'present', reason: 'verifier-majority' });
    expect(outcomeOf(result, 'f2')).toMatchObject({ outcome: 'filtered' });
  });

  test('an expired verifier makes the candidate unverified even though the votes that arrived are a majority', () => {
    write('v1', ballot(['f1', 'real'], ['f2', 'not-real']));
    write('v2', ballot(['f1', 'real'], ['f2', 'not-real']));
    const collected = collect(verifiers.map((name) => verifier(name)), T0 + 6 * MIN);
    expect(collected.incompleteVerifiers).toEqual([{ verifier: 'v3', reason: 'expired:deadline-passed', candidateIds: null }]);

    const result = tally(collected);
    expect(outcomeOf(result, 'f1')).toMatchObject({ outcome: 'unverified', reason: 'verifier-incomplete', presented: true });
    expect(outcomeOf(result, 'f2')).toMatchObject({ outcome: 'unverified', reason: 'verifier-incomplete', presented: true });
    expect(result.verification).toBe('not-performed');
  });

  test('an invalid verifier file degrades its candidates exactly like an expired one', () => {
    write('v1', ballot(['f1', 'real']));
    write('v2', ballot(['f1', 'real']));
    write('v3', '{"votes":[');
    const result = tally(collect(verifiers.map((name) => verifier(name)), T0 + 6 * MIN));
    expect(outcomeOf(result, 'f1')).toMatchObject({ outcome: 'unverified', reason: 'verifier-incomplete' });
  });

  test('assigned candidates: only the assigned candidates degrade, and a vote on an unassigned one is dropped', () => {
    write('v1', ballot(['f1', 'real'], ['f2', 'real']));
    const collected = collect(
      [verifier('v1', { candidateIds: ['f1'] }), verifier('v2', { candidateIds: ['f2'] }), verifier('v3', { candidateIds: ['f1', 'f2'] })],
      T0 + 6 * MIN
    );
    const input = toVotesInput(collected, { candidates, depth: 'standard' });
    expect(input.ignoredVotes).toEqual([{ verifier: 'v1', candidateId: 'f2', reason: 'candidate-not-assigned' }]);
    const f1 = input.findings.find((finding) => finding.id === 'f1');
    const f2 = input.findings.find((finding) => finding.id === 'f2');
    expect(f1.votes).toEqual([{ verifier: 'v1', verdict: 'real' }]);
    expect(f1.incompleteVerifiers.map((entry) => entry.verifier).sort()).toEqual(['v3']);
    expect(f2.votes).toEqual([]);
    expect(f2.incompleteVerifiers.map((entry) => entry.verifier).sort()).toEqual(['v2', 'v3']);
  });

  test('an assigned verifier that arrived without a vote on its candidate is incomplete for that candidate', () => {
    write('v1', ballot(['f1', 'real']));
    const collected = collect([verifier('v1', { candidateIds: ['f1', 'f2'] })]);
    const input = toVotesInput(collected, { candidates, depth: 'standard' });
    expect(input.findings.find((finding) => finding.id === 'f2').incompleteVerifiers).toEqual([
      { verifier: 'v1', reason: 'no-vote-for-candidate' },
    ]);
    expect(input.findings.find((finding) => finding.id === 'f1').incompleteVerifiers).toEqual([]);
  });

  describe('slices', () => {
    const paths = [
      { path: 'a/one.js', lines: 900 },
      { path: 'a/two.js', lines: 800 },
      { path: 'b/three.js', lines: 700 },
    ];
    const plan = runSlices({ paths, areas: ['a', 'b'], threshold: 1000 });
    const [sliceA, sliceB] = plan.slices;
    const slicePaths = (id) => plan.slices.find((slice) => slice.id === id).paths;
    // Every slice is crossed with two lenses (plan 3A): the reviewers of a slice are the plan's assignments for it.
    const assigned = (sliceId) => plan.reviewerAssignments.filter((assignment) => assignment.sliceId === sliceId);
    const expectedFor = (assignments) =>
      assignments.map(({ reviewer: name, sliceId, lens }) => reviewer(name, { sliceId, lens, paths: slicePaths(sliceId) }));
    const arrive = (assignments) => {
      for (const { reviewer: name, sliceId } of assignments) write(name, review([], slicePaths(sliceId)));
    };

    const slicesOf = (collected) =>
      runSlices({ paths, areas: ['a', 'b'], threshold: 1000, reviewedBy: collected.reviewedBy, changedPaths: paths.map((entry) => entry.path) });

    test('the plan really has two slices, each with two lenses (so the checks below cannot pass vacuously)', () => {
      expect(plan.slices.map((slice) => slice.id)).toHaveLength(2);
      expect(sliceA.paths).toEqual(['a/one.js', 'a/two.js']);
      expect(assigned(sliceA.id)).toHaveLength(2);
      expect(assigned(sliceB.id)).toHaveLength(2);
    });

    test('an expired reviewer pair leaves its slice reported uncovered by the real slices subcommand', () => {
      arrive(assigned(sliceA.id));
      const collected = collect(expectedFor([...assigned(sliceA.id), ...assigned(sliceB.id)]), T0 + 16 * MIN);
      expect(collected.reviewedSlices).toEqual([sliceA.id]);
      expect(collected.unreviewedSlices).toEqual([sliceB.id]);
      const coverage = slicesOf(collected);
      expect(coverage.ok).toBe(false);
      expect(coverage.uncovered).toEqual(['b/three.js']);
      expect(coverage.unreviewedSlices).toEqual([sliceB.id]);
    });

    test('every reviewer arriving covers the whole plan', () => {
      arrive(plan.reviewerAssignments);
      const collected = collect(expectedFor(plan.reviewerAssignments));
      expect(slicesOf(collected)).toMatchObject({ ok: true, covered: true, uncovered: [], underReviewed: [] });
    });

    test('a reviewer that arrived without covering every path of its slice leaves the slice unreviewed', () => {
      write('revA', review([], ['a/one.js']));
      const collected = collect([reviewer('revA', { sliceId: sliceA.id, lens: 'correctness', paths: sliceA.paths })]);
      expect(collected.reviewedSlices).toEqual([]);
      expect(collected.unreviewedDetail).toEqual([
        { sliceId: sliceA.id, reasons: [{ agent: 'revA', reason: 'paths-not-reviewed' }], missingPaths: ['a/two.js'] },
      ]);
      expect(collected.reviewedBy).toEqual([]);
    });

    test('one slice with two lenses is reviewed only when both lenses arrived', () => {
      write('lensCorrect', review([], sliceA.paths));
      const collected = collect(
        [
          reviewer('lensCorrect', { sliceId: sliceA.id, lens: 'correctness', paths: sliceA.paths }),
          reviewer('lensSecurity', { sliceId: sliceA.id, lens: 'security', paths: sliceA.paths }),
        ],
        T0 + 16 * MIN
      );
      expect(collected.reviewedSlices).toEqual([]);
      expect(collected.unreviewedDetail[0].reasons).toEqual([{ agent: 'lensSecurity', reason: 'expired:deadline-passed' }]);
    });

    test('a reviewer with no slice contributes findings and never marks a slice reviewed', () => {
      write('rev1', review([{ id: 'f1' }], ['a/one.js']));
      const collected = collect([reviewer('rev1')]);
      expect(collected.findings).toHaveLength(1);
      expect(collected.reviewedSlices).toEqual([]);
      expect(collected.reviewedBy).toEqual([]);
    });

    describe('reviewedBy (the per-lens record verifyCoverage counts distinct lenses from)', () => {
      test('an expired lens is absent from reviewedBy while its sibling lens on the same slice is present', () => {
        const [first, second] = assigned(sliceA.id);
        write(first.reviewer, review([], sliceA.paths));
        const collected = collect(expectedFor([first, second]), T0 + 16 * MIN);
        expect(collected.reviewedSlices).toEqual([]); // the slice itself is not reviewed ...
        expect(collected.reviewedBy).toEqual([{ sliceId: sliceA.id, lens: first.lens, reviewer: first.reviewer, paths: sliceA.paths }]); // ... but one lens is on record
      });

      test('a reviewer whose pathsReviewed misses a path is absent from reviewedBy, the complete one is present', () => {
        const [first, second] = assigned(sliceA.id);
        write(first.reviewer, review([], sliceA.paths));
        write(second.reviewer, review([], ['a/one.js']));
        const collected = collect(expectedFor([first, second]));
        expect(collected.reviewedBy).toEqual([{ sliceId: sliceA.id, lens: first.lens, reviewer: first.reviewer, paths: sliceA.paths }]);
      });

      test('lists every reviewer that arrived and covered its paths, lens lower-cased', () => {
        arrive(plan.reviewerAssignments);
        const upper = plan.reviewerAssignments.map((a) => ({ ...a, lens: ` ${a.lens.toUpperCase()} ` }));
        const collected = collect(expectedFor(upper));
        expect(collected.reviewedBy).toEqual(
          plan.reviewerAssignments.map(({ reviewer: name, sliceId, lens }) => ({ sliceId, lens, reviewer: name, paths: slicePaths(sliceId) }))
        );
      });

      test('end to end: collect -> slices reports a slice with only one lens arrived as under-reviewed, not covered', () => {
        arrive(assigned(sliceA.id));
        const [bFirst, bSecond] = assigned(sliceB.id);
        write(bFirst.reviewer, review([], sliceB.paths)); // slice b: only one of its two lenses arrives
        const collected = collect(expectedFor([...assigned(sliceA.id), bFirst, bSecond]), T0 + 16 * MIN);
        const coverage = slicesOf(collected);
        expect(coverage.ok).toBe(false);
        expect(coverage.covered).toBe(false);
        expect(coverage.underReviewed).toEqual([{ path: 'b/three.js', lenses: [bFirst.lens] }]);
        expect(coverage.reviewedSlices).toEqual([sliceA.id, sliceB.id]);
      });

      test('each entry carries the paths the reviewer was asked to read and reported, and none it only reported beyond them', () => {
        const [first, second] = assigned(sliceA.id);
        write(first.reviewer, review([], [...sliceA.paths, 'elsewhere/extra.js']));
        write(second.reviewer, review([], sliceA.paths));
        const collected = collect(expectedFor([first, second]));
        expect(collected.reviewedBy).toEqual([
          { sliceId: sliceA.id, lens: first.lens, reviewer: first.reviewer, paths: sliceA.paths },
          { sliceId: sliceA.id, lens: second.lens, reviewer: second.reviewer, paths: sliceA.paths },
        ]);
      });

      test('end to end: a list that leaves a path of the slice out cannot cover it, however many reviewers read the rest', () => {
        // The slice holds a/one.js and a/two.js, but the orchestrator named only a/one.js for its two reviewers. Both read
        // exactly that, so collect has nothing to refuse; the coverage check must still say that a/two.js was never read.
        const [aFirst, aSecond] = assigned(sliceA.id);
        const shortList = [aFirst, aSecond].map(({ reviewer: name, sliceId, lens }) => reviewer(name, { sliceId, lens, paths: ['a/one.js'] }));
        write(aFirst.reviewer, review([], ['a/one.js']));
        write(aSecond.reviewer, review([], ['a/one.js']));
        arrive(assigned(sliceB.id));
        const collected = collect([...shortList, ...expectedFor(assigned(sliceB.id))]);
        expect(collected.ok).toBe(true);
        expect(collected.reviewedBy.filter((entry) => entry.sliceId === sliceA.id).map((entry) => entry.paths)).toEqual([['a/one.js'], ['a/one.js']]);
        const coverage = slicesOf(collected);
        expect(coverage.ok).toBe(false);
        expect(coverage.covered).toBe(false);
        expect(coverage.underReviewed).toEqual([{ path: 'a/two.js', lenses: [] }]);
        expect(coverage.uncovered).toEqual([]);
      });
    });

    describe('Quick over the slice threshold: one reviewer, so one slice (review of #263, F1)', () => {
      const quickRequest = { paths, areas: ['a', 'b'], threshold: 1000, mode: 'quick' };
      const quickPlan = runSlices(quickRequest);

      test('the plan names one slice and one reviewer, which collect accepts, and the coverage check then answers covered', () => {
        expect(paths.reduce((sum, entry) => sum + entry.lines, 0)).toBeGreaterThan(quickRequest.threshold);
        expect(quickPlan.sliced).toBe(false);
        expect(quickPlan.slices.map((slice) => slice.id)).toEqual(['whole-pr']);
        expect(quickPlan.reviewerAssignments).toHaveLength(1);

        const [only] = quickPlan.reviewerAssignments;
        const sliceHoldingAll = quickPlan.slices[0].paths;
        write(only.reviewer, review([], sliceHoldingAll));
        const collected = collect([reviewer(only.reviewer, { sliceId: only.sliceId, lens: only.lens, paths: sliceHoldingAll })]);
        expect(collected.ok).toBe(true);
        expect(collected.reviewedSlices).toEqual(['whole-pr']);

        const coverage = runSlices({ ...quickRequest, reviewedBy: collected.reviewedBy, changedPaths: paths.map((entry) => entry.path) });
        expect(coverage).toMatchObject({ ok: true, covered: true, requiredLenses: 1, uncovered: [], underReviewed: [] });
      });

      test('the single reviewer that reads only part of the PR leaves the rest named, never covered', () => {
        const [only] = quickPlan.reviewerAssignments;
        write(only.reviewer, review([], ['a/one.js']));
        const collected = collect([reviewer(only.reviewer, { sliceId: only.sliceId, lens: only.lens, paths: quickPlan.slices[0].paths })]);
        expect(collected.reviewedBy).toEqual([]);
        expect(collected.unreviewedSlices).toEqual(['whole-pr']);
        const coverage = runSlices({ ...quickRequest, reviewedBy: collected.reviewedBy, changedPaths: paths.map((entry) => entry.path) });
        expect(coverage.covered).toBe(false);
        expect(coverage.uncovered).toEqual(['a/one.js', 'a/two.js', 'b/three.js']);
      });
    });

    describe('a reviewer given a sliceId must name its lens', () => {
      test('no lens at all is refused and nothing is collected', () => {
        write('rev1', review([], sliceA.paths));
        const result = collect([reviewer('rev1', { sliceId: sliceA.id, paths: sliceA.paths })]);
        expect(result).toMatchObject({ ok: false, agents: [], reviewedSlices: [], reviewedBy: [] });
        expect(result.reason).toMatch(/lens/);
      });

      test.each([
        ['an empty lens', ''],
        ['a blank lens', '   '],
        ['a lens that is not text', 7],
      ])('%s is refused', (_label, lens) => {
        write('rev1', review([], sliceA.paths));
        const result = collect([reviewer('rev1', { sliceId: sliceA.id, paths: sliceA.paths, lens })]);
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/lens/);
      });

      test.each([
        ['a lens with a space', 'two words'],
        ['a lens with a path separator', 'a/b'],
        ['a lens longer than 32 characters', 'x'.repeat(33)],
        ['a lens that starts with a dash', '-security'],
      ])('%s is refused: it is not a lens token, so it could not be briefed or counted as a distinct pass', (_label, lens) => {
        write('rev1', review([], sliceA.paths));
        const result = collect([reviewer('rev1', { sliceId: sliceA.id, paths: sliceA.paths, lens })]);
        expect(result).toMatchObject({ ok: false, agents: [], reviewedSlices: [], reviewedBy: [] });
        expect(result.reason).toMatch(/lens token/);
      });

      test('a lens on a verifier is refused', () => {
        write('ver1', ballot(['f1', 'real']));
        const result = collect([verifier('ver1', { lens: 'security' })]);
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/lens/);
      });

      test('a lens on a reviewer without a sliceId is refused', () => {
        write('rev1', review([], []));
        const result = collect([reviewer('rev1', { lens: 'security' })]);
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/lens/);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// AC3: a crashed orchestrator loses nothing
// ---------------------------------------------------------------------------

describe('AC3: re-collecting over the same directory reproduces the classification', () => {
  const expected = () => [reviewer('rev1', { sliceId: 's1', lens: 'correctness', paths: ['a.js'] }), verifier('ver1'), verifier('ver2'), verifier('ver3')];
  const setup = () => {
    write('rev1', review([{ id: 'f1' }], ['a.js']));
    write('ver1', ballot(['f1', 'real']));
    write('ver2', '{"votes":[');
  };
  const view = (result) => JSON.stringify({ ...result, warnings: [] });

  test('a second run over an untouched directory answers byte for byte the same', () => {
    setup();
    const first = collect(expected(), T0 + 6 * MIN);
    const second = collect(expected(), T0 + 6 * MIN);
    expect(view(second)).toBe(view(first));
    expect(first.agents.map((agent) => agent.state)).toEqual(['arrived', 'arrived', 'invalid', 'expired']);
  });

  test('after the agent deletes its file, the scratch copy still counts as the arrival', () => {
    setup();
    const first = collect(expected(), T0 + 6 * MIN);
    fs.rmSync(path.join(dir, 'out-ver1.json'));
    fs.rmSync(path.join(dir, 'out-rev1.json'));
    const second = collect(expected(), T0 + 6 * MIN);
    expect(second.votes).toEqual(first.votes);
    expect(second.findings).toEqual(first.findings);
    expect(stateOf(second, 'ver1')).toMatchObject({ state: 'arrived', scratchPath: path.join(scratch(), 'out-ver1.json') });
    expect(second.reviewedSlices).toEqual(['s1']);
    expect(second.reviewedBy).toEqual([{ sliceId: 's1', lens: 'correctness', reviewer: 'rev1', paths: ['a.js'] }]);
  });

  test('a later overwrite with garbage cannot un-arrive a result, nor a later rewrite change its votes', () => {
    setup();
    collect(expected(), T0 + MIN);
    write('ver1', '{"votes":[');
    expect(stateOf(collect(expected(), T0 + 6 * MIN), 'ver1').state).toBe('arrived');
    write('ver1', ballot(['f1', 'not-real']));
    expect(collect(expected(), T0 + 6 * MIN).votes).toEqual([{ verifier: 'ver1', candidateId: 'f1', verdict: 'real' }]);
  });

  test('a copy taken after the deadline stays expired on every later pass', () => {
    write('ver1', ballot(['f1', 'real']), T0 + 5 * MIN + 1);
    collect([verifier('ver1')], T0 + 6 * MIN);
    fs.rmSync(path.join(dir, 'out-ver1.json'));
    expect(stateOf(collect([verifier('ver1')], T0 + 7 * MIN), 'ver1')).toMatchObject({ state: 'expired', reason: 'arrived-after-deadline' });
  });
});

// ---------------------------------------------------------------------------
// classifyAgentFailure
// ---------------------------------------------------------------------------

describe('classifyAgentFailure', () => {
  test('a 429 with a short retry-after waits exactly that long and may use the alternate route', () => {
    expect(classifyAgentFailure({ status: 429, retryAfterSec: 20 })).toMatchObject({
      retry: true,
      delayMs: 20000,
      fallbackRoute: true,
      failFast: false,
      state: 'retry',
      kind: 'rate-limit',
    });
  });

  test('a retry-after of tens of hours fails fast to a recorded partial state instead of waiting', () => {
    const result = classifyAgentFailure({ status: 429, retryAfterSec: 27 * 3600 });
    expect(result).toMatchObject({ retry: false, delayMs: 0, fallbackRoute: false, failFast: true, state: 'partial', reason: 'retry-after-too-long' });
  });

  test('the threshold is inclusive at 300 s and configurable', () => {
    expect(classifyAgentFailure({ status: 429, retryAfterSec: 300 }).retry).toBe(true);
    expect(classifyAgentFailure({ status: 429, retryAfterSec: 301 }).failFast).toBe(true);
    expect(classifyAgentFailure({ status: 429, retryAfterSec: 301, failFastAfterSec: 600 }).retry).toBe(true);
    expect(classifyAgentFailure({ status: 429, retryAfterSec: 61, failFastAfterSec: 60 }).failFast).toBe(true);
  });

  test('a duration only in the message is honoured: "try again in 27 hours" fails fast', () => {
    expect(classifyAgentFailure({ message: 'Rate limit reached. Please try again in 27 hours.' })).toMatchObject({
      kind: 'rate-limit',
      failFast: true,
      reason: 'retry-after-too-long',
    });
    expect(classifyAgentFailure({ status: 429, message: 'retry after 45 seconds' })).toMatchObject({ retry: true, delayMs: 45000 });
    expect(classifyAgentFailure({ status: 429, message: 'try again in 2 minutes' })).toMatchObject({ retry: true, delayMs: 120000 });
  });

  test('the explicit retryAfterSec outranks a duration in the text', () => {
    expect(classifyAgentFailure({ status: 429, retryAfterSec: 5, message: 'try again in 27 hours' })).toMatchObject({ retry: true, delayMs: 5000 });
  });

  test('numeric strings are read, an infinite wait fails fast, garbage is ignored with a warning', () => {
    expect(classifyAgentFailure({ status: '429', retryAfterSec: '12' })).toMatchObject({ retry: true, delayMs: 12000 });
    expect(classifyAgentFailure({ status: 429, retryAfterSec: Infinity })).toMatchObject({ failFast: true });
    const garbage = classifyAgentFailure({ status: 429, retryAfterSec: 'soon' });
    expect(garbage).toMatchObject({ retry: true, reason: 'backoff', delayMs: 30000 });
    expect(garbage.warnings).toContain('unreadable-retry-after');
    expect(classifyAgentFailure({ status: 429, retryAfterSec: -4 }).warnings).toContain('unreadable-retry-after');
  });

  test('without a retry-after the backoff doubles per attempt and the third retry is the last', () => {
    expect([0, 1, 2].map((attempt) => classifyAgentFailure({ status: 429, attempt }).delayMs)).toEqual([30000, 60000, 120000]);
    expect(classifyAgentFailure({ status: 429, attempt: 3 })).toMatchObject({ retry: false, failFast: true, state: 'partial', reason: 'retries-exhausted' });
    expect(classifyAgentFailure({ status: 429, retryAfterSec: 1, attempt: 3 }).failFast).toBe(true);
  });

  test.each([
    [{ status: 529 }, 'overloaded', true, true],
    [{ status: 503 }, 'overloaded', true, true],
    [{ message: 'Overloaded' }, 'overloaded', true, true],
    [{ status: 500 }, 'server-error', true, false],
    [{ status: 502 }, 'server-error', true, false],
    [{ status: 408 }, 'timeout', true, false],
    [{ message: 'connect ETIMEDOUT 1.2.3.4:443' }, 'timeout', true, false],
    [{ message: 'socket hang up' }, 'timeout', true, false],
  ])('%j is %s: retried=%s, alternate route=%s', (input, kind, retry, fallbackRoute) => {
    expect(classifyAgentFailure(input)).toMatchObject({ kind, retry, fallbackRoute, failFast: false, state: 'retry' });
  });

  test.each([
    [{ status: 400 }, 'client-error-400'],
    [{ status: 401 }, 'client-error-401'],
    [{ status: 403 }, 'client-error-403'],
    [{ status: 404 }, 'client-error-404'],
    [{ message: 'something odd happened' }, 'unclassified-failure'],
    [{}, 'unclassified-failure'],
    [{ status: 'teapot' }, 'unclassified-failure'],
    [{ status: 999 }, 'unclassified-failure'],
  ])('%j can only fail fast (%s): a retry would not change it', (input, reason) => {
    expect(classifyAgentFailure(input)).toMatchObject({ retry: false, failFast: true, state: 'partial', reason, fallbackRoute: false });
  });

  test('a status outranks the message, and 429 text without a status is still a rate limit', () => {
    expect(classifyAgentFailure({ status: 401, message: 'rate limit' }).kind).toBe('client-error');
    expect(classifyAgentFailure({ message: 'HTTP 429 Too Many Requests' }).kind).toBe('rate-limit');
  });

  test.each([
    ['not an object', 'x'],
    ['a negative attempt', { status: 429, attempt: -1 }],
    ['a fractional attempt', { status: 429, attempt: 1.5 }],
    ['a negative threshold', { status: 429, failFastAfterSec: -1 }],
    ['a non-numeric threshold', { status: 429, failFastAfterSec: 'x' }],
  ])('%s fails closed, never to a retry', (_label, input) => {
    expect(classifyAgentFailure(input)).toMatchObject({ retry: false, failFast: true, state: 'partial' });
  });
});

// ---------------------------------------------------------------------------
// AC7: a retry is bounded by the agent's deadline and by the total wait (review round 1)
// ---------------------------------------------------------------------------

describe('AC7: classifyAgentFailure is bounded by the agent deadline and by the total wait', () => {
  const deadlineAt = T0 + 5 * MIN; // a verifier's whole budget
  const at = (seconds) => T0 + seconds * 1000;

  test('a retry-after that would end past the deadline fails fast (429 at 240 s, retry-after 299 s)', () => {
    expect(classifyAgentFailure({ status: 429, retryAfterSec: 299, now: at(240), deadlineAt })).toMatchObject({
      retry: false,
      delayMs: 0,
      failFast: true,
      state: 'partial',
      reason: 'retry-would-pass-deadline',
    });
  });

  test('a wait that ends before the deadline is retried; one that ends exactly at it is not', () => {
    expect(classifyAgentFailure({ status: 429, retryAfterSec: 59, now: at(240), deadlineAt })).toMatchObject({ retry: true, delayMs: 59000 });
    expect(classifyAgentFailure({ status: 429, retryAfterSec: 60, now: at(240), deadlineAt })).toMatchObject({
      retry: false,
      reason: 'retry-would-pass-deadline',
    });
  });

  test('a backoff the server did not specify is bounded the same way', () => {
    // attempt 2 backs off 120 s
    expect(classifyAgentFailure({ status: 429, attempt: 2, now: at(180), deadlineAt })).toMatchObject({ failFast: true, reason: 'retry-would-pass-deadline' });
    expect(classifyAgentFailure({ status: 429, attempt: 2, now: at(179), deadlineAt })).toMatchObject({ retry: true, delayMs: 120000 });
  });

  test('an agent whose deadline has passed is not retried at all', () => {
    expect(classifyAgentFailure({ status: 503, now: at(301), deadlineAt })).toMatchObject({ failFast: true, reason: 'deadline-passed' });
    expect(classifyAgentFailure({ status: 503, now: deadlineAt, deadlineAt })).toMatchObject({ failFast: true, reason: 'deadline-passed' });
  });

  test('ISO timestamps are read, and an unreadable deadline or clock fails closed instead of lifting the bound', () => {
    const iso = (ms) => new Date(ms).toISOString();
    expect(classifyAgentFailure({ status: 429, retryAfterSec: 299, now: iso(at(240)), deadlineAt: iso(deadlineAt) })).toMatchObject({
      failFast: true,
      reason: 'retry-would-pass-deadline',
    });
    expect(classifyAgentFailure({ status: 429, deadlineAt: 'soon', now: at(1) })).toMatchObject({ retry: false, failFast: true, reason: 'invalid-deadlineAt' });
    expect(classifyAgentFailure({ status: 429, deadlineAt })).toMatchObject({ retry: false, failFast: true, reason: 'invalid-now' });
  });

  test('without a deadline the answer says so: that retry is not bounded by one', () => {
    expect(classifyAgentFailure({ status: 429, retryAfterSec: 20 }).warnings).toContain('no-deadline-given');
    expect(classifyAgentFailure({ status: 429, retryAfterSec: 20, now: at(1), deadlineAt }).warnings).not.toContain('no-deadline-given');
  });

  test('the total wait is capped, not just each wait: a second 299 s wait would make 598 s of waiting', () => {
    expect(classifyAgentFailure({ status: 429, retryAfterSec: 299, attempt: 0 })).toMatchObject({ retry: true, delayMs: 299000 });
    expect(classifyAgentFailure({ status: 429, retryAfterSec: 299, attempt: 1, waitedSec: 299 })).toMatchObject({
      retry: false,
      failFast: true,
      state: 'partial',
      reason: 'total-wait-too-long',
    });
    expect(classifyAgentFailure({ status: 429, retryAfterSec: 100, attempt: 1, waitedSec: 200 }).retry).toBe(true); // 300 s in all: at the cap
    expect(classifyAgentFailure({ status: 429, retryAfterSec: 101, attempt: 1, waitedSec: 200 }).failFast).toBe(true);
    expect(classifyAgentFailure({ status: 429, retryAfterSec: 10, waitedSec: -1 })).toMatchObject({ failFast: true, reason: 'invalid-waitedSec' });
  });

  test('a caller that feeds back its own waits and clock never waits past the cap or the deadline (reviewer budget 900 s)', () => {
    const reviewerDeadline = T0 + 15 * MIN;
    let clock = T0 + 10 * 1000;
    let waitedSec = 0;
    const waits = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const answer = classifyAgentFailure({ status: 429, retryAfterSec: 299, attempt, waitedSec, now: clock, deadlineAt: reviewerDeadline });
      if (!answer.retry) break;
      waits.push(answer.delayMs / 1000);
      waitedSec += answer.delayMs / 1000;
      clock += answer.delayMs;
    }
    expect(waits).toEqual([299]);
    expect(clock).toBeLessThan(reviewerDeadline);
  });
});

// ---------------------------------------------------------------------------
// AC5: what an agent that can write into dir must not be able to do (review round 1)
// ---------------------------------------------------------------------------

const RESULTS_MODULE = path.join(__dirname, '..', 'lib', 'pr-review-results.js');
const posix = process.platform === 'win32' ? test.skip : test;

/** The `code` of the error `fn` throws, or `null` when it does not throw. */
const codeOf = (fn) => {
  try {
    fn();
    return null;
  } catch (error) {
    return error.code;
  }
};

/** Real-clock expectations around a file that was just written: its change time is real, so the window is built from it. */
const around = (file, extra = {}) => {
  const changed = fs.statSync(file).ctimeMs;
  return { dispatchedAt: changed - 5 * MIN, deadlineAt: changed + 5 * MIN, ...extra };
};

describe('AC5: an agent that can write into dir cannot make the collector write or read anywhere else', () => {
  const victimText = 'USER FILE, MUST SURVIVE';
  const victimFile = () => path.join(root, 'victim.txt');
  const victim = () => fs.readFileSync(victimFile(), 'utf8');
  beforeEach(() => fs.writeFileSync(victimFile(), victimText));

  /** A valid result an agent forged where the orchestrator keeps its copies. */
  const forgedCopy = (where) => {
    fs.mkdirSync(where, { recursive: true });
    const copy = path.join(where, 'out-rev1.json');
    fs.writeFileSync(copy, JSON.stringify(review([{ id: 'FORGED' }], ['a.js'])));
    fs.utimesSync(copy, (T0 + MIN) / 1000, (T0 + MIN) / 1000);
    return copy;
  };

  test('scratch and quarantine live beside dir, never inside it', () => {
    write('rev1', 'not json');
    const result = collect([reviewer('rev1')]);
    expect(stateOf(result, 'rev1')).toMatchObject({ state: 'invalid', quarantinePath: path.join(scratch(), 'quarantine', 'out-rev1.json') });
    expect(scratch()).toBe(path.join(root, '.results.collected'));
    expect(fs.readdirSync(dir)).toEqual(['out-rev1.json']);
    expect(fs.readdirSync(path.join(scratch(), 'quarantine')).sort()).toEqual(['out-rev1.json', 'out-rev1.reason.json']);
  });

  test('a symlink planted at the orchestrator\'s temp-file name is not written through (P3)', () => {
    write('rev1', 'AGENT WROTE THIS, NOT JSON');
    // The agent knows the orchestrator's pid and the layout: it plants a link at every old temp name, in both places.
    for (const base of [path.join(dir, '.collected'), scratch()]) {
      for (const leaf of ['out-rev1.json', 'out-rev1.reason.json']) {
        const link = path.join(base, 'quarantine', `${leaf}.${process.pid}.tmp`);
        fs.mkdirSync(path.dirname(link), { recursive: true });
        fs.symlinkSync(victimFile(), link);
      }
    }
    const result = collect([reviewer('rev1')]);
    expect(stateOf(result, 'rev1').state).toBe('invalid');
    expect(victim()).toBe(victimText);
    expect(fs.lstatSync(path.join(scratch(), 'quarantine', 'out-rev1.json')).isFile()).toBe(true);
  });

  test('writeFile creates its temp file exclusively: even a guessed name is never opened through a symlink', () => {
    fs.mkdirSync(scratch(), { mode: 0o700 });
    const target = path.join(scratch(), 'out-x.json');
    jest.spyOn(crypto, 'randomBytes').mockReturnValue(Buffer.alloc(8, 1)); // the attacker guessed the "random" name
    fs.symlinkSync(victimFile(), path.join(scratch(), '.out-x.json.0101010101010101.tmp'));
    expect(codeOf(() => realIo.writeFile(target, 'AGENT BYTES', T0))).toBe('EEXIST');
    expect(victim()).toBe(victimText);
    expect(fs.existsSync(target)).toBe(false);
  });

  test('writeFile replaces a symlink at the target instead of following it, and leaves no temp file behind', () => {
    fs.mkdirSync(scratch(), { mode: 0o700 });
    const target = path.join(scratch(), 'out-x.json');
    fs.symlinkSync(victimFile(), target);
    realIo.writeFile(target, 'FRESH', T0);
    expect(victim()).toBe(victimText);
    expect(fs.lstatSync(target).isFile()).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe('FRESH');
    expect(fs.statSync(target).mtimeMs).toBe(T0);
    expect(fs.readdirSync(scratch())).toEqual(['out-x.json']);
  });

  test('writeFile re-checks its directory: a symlink swapped in after the scratch check is not written through', () => {
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, scratch());
    expect(codeOf(() => realIo.writeFile(path.join(scratch(), 'out-x.json'), 'AGENT BYTES', T0))).toBe('EUNSAFE');
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  test('a symlink where the old in-dir scratch directory was is just an unrelated entry: nothing is read through it (P3b)', () => {
    const outside = path.join(root, 'outside');
    forgedCopy(outside);
    fs.symlinkSync(outside, path.join(dir, '.collected'));
    const result = collect([reviewer('rev1')]);
    expect(stateOf(result, 'rev1').state).toBe('missing');
    expect(result.findings).toEqual([]);
  });

  test('a symlink where the scratch directory belongs is refused: its forged copy is no arrival and nothing is written through it', () => {
    const outside = path.join(root, 'outside');
    forgedCopy(outside);
    fs.symlinkSync(outside, scratch());

    const early = collect([reviewer('rev1')]);
    expect(stateOf(early, 'rev1').state).toBe('missing');
    expect(early.findings).toEqual([]);
    expect(early.warnings.join(' ')).toMatch(/not a real directory/);

    write('rev1', review([{ id: 'REAL' }], ['a.js']));
    write('rev2', 'not json');
    const later = collect([reviewer('rev1'), reviewer('rev2')]);
    expect(stateOf(later, 'rev1')).toMatchObject({ state: 'arrived', scratchError: 'unsafe-scratch-dir' });
    expect(later.findings.map((finding) => finding.id)).toEqual(['REAL']);
    expect(fs.readdirSync(outside)).toEqual(['out-rev1.json']);
  });

  posix('a scratch directory that group or others can write to is not trusted', () => {
    forgedCopy(scratch());
    fs.chmodSync(scratch(), 0o777);
    const result = collect([reviewer('rev1')]);
    expect(stateOf(result, 'rev1').state).toBe('missing');
    expect(result.warnings.join(' ')).toMatch(/writable by group or others/);
  });

  posix('a scratch directory owned by someone else is not trusted', () => {
    forgedCopy(scratch());
    const foreign = {
      ...stamped,
      lstat: (file) => {
        const facts = stamped.lstat(file);
        return file === scratch() ? { ...facts, uid: process.getuid() + 1 } : facts;
      },
    };
    const result = collectResults({ expected: [reviewer('rev1')], dir, now: T0 + MIN }, foreign);
    expect(stateOf(result, 'rev1').state).toBe('missing');
    expect(result.warnings.join(' ')).toMatch(/owned by another user/);
  });

  test('a corrupted scratch copy is ignored with a warning, and the result file is read again', () => {
    write('ver1', ballot(['f1', 'real']));
    collect([verifier('ver1')]);
    fs.writeFileSync(path.join(scratch(), 'out-ver1.json'), 'garbage');
    const result = collect([verifier('ver1')]);
    expect(stateOf(result, 'ver1').state).toBe('arrived');
    expect(result.warnings.join(' ')).toMatch(/ignored an unusable scratch copy \(unparseable-json\)/);
  });

  test.each([
    ['inside dir', () => path.join(dir, 'scratch')],
    ['dir itself', () => dir],
    ['around dir', () => root],
  ])('a scratchDir %s is refused: the agents write there, so nothing kept in it can be trusted', (_label, where) => {
    const result = collectResults({ expected: [verifier('ver1')], dir, now: T0, scratchDir: where() });
    expect(result).toMatchObject({ ok: false, agents: [] });
    expect(result.reason).toMatch(/scratchDir must be outside dir/);
  });

  test('a filesystem root is not a result directory', () => {
    const result = collectResults({ expected: [verifier('ver1')], dir: path.parse(root).root, now: T0 });
    expect(result).toMatchObject({ ok: false, agents: [] });
    expect(result.reason).toMatch(/filesystem root/);
  });

  test('defaultScratchDir is the hidden sibling of dir, and a trailing slash changes nothing', () => {
    expect(defaultScratchDir('/runs/7/results')).toBe(path.resolve('/runs/7/.results.collected'));
    expect(defaultScratchDir('/runs/7/results/')).toBe(path.resolve('/runs/7/.results.collected'));
  });

  test('readFile never follows a symlink, whatever it points at', () => {
    fs.writeFileSync(path.join(root, 'secret.txt'), 'TOP SECRET');
    const link = path.join(dir, 'out-rev1.json');
    fs.symlinkSync(path.join(root, 'secret.txt'), link);
    expect(['ELOOP', 'EMLINK']).toContain(codeOf(() => realIo.readFile(link)));
  });

  test('a result swapped for a symlink between the type check and the read is not read (P4)', () => {
    const secret = path.join(root, 'secret.txt');
    fs.writeFileSync(secret, 'TOP SECRET USER DATA');
    write('rev1', review());
    const swapping = {
      ...stamped,
      readFile: (file) => {
        fs.rmSync(file);
        fs.symlinkSync(secret, file);
        return realIo.readFile(file);
      },
    };
    const result = collectResults({ expected: [reviewer('rev1')], dir, now: T0 + MIN }, swapping);
    expect(stateOf(result, 'rev1')).toMatchObject({ state: 'invalid', reason: 'not-a-regular-file' });
    const quarantine = path.join(scratch(), 'quarantine');
    for (const name of fs.readdirSync(quarantine)) expect(fs.readFileSync(path.join(quarantine, name), 'utf8')).not.toContain('TOP SECRET');
  });

  test('a result replaced by another file between the check and the read is refused, not read as the old one', () => {
    const file = write('rev1', review([{ id: 'EARLY' }], ['a.js']));
    const replacing = {
      ...realIo,
      readFile: (target, expected) => {
        fs.writeFileSync(`${target}.next`, JSON.stringify(review([{ id: 'SWAPPED-IN' }], ['a.js'])));
        fs.renameSync(`${target}.next`, target);
        return realIo.readFile(target, expected);
      },
    };
    const window = around(file);
    const result = collectResults({ expected: [reviewer('rev1', window)], dir, now: window.dispatchedAt + 6 * MIN }, replacing);
    expect(stateOf(result, 'rev1')).toMatchObject({ state: 'invalid', reason: 'file-changed-during-read' });
    expect(result.findings).toEqual([]);
  });

  test('a result rewritten while it is being read is refused, so the change time judged belongs to the bytes read', () => {
    const file = write('rev1', review([{ id: 'F' }], ['a.js']));
    const read = fs.readSync;
    jest.spyOn(fs, 'readSync').mockImplementationOnce((...args) => {
      const count = read(...args);
      fs.utimesSync(file, 1, 1); // the agent touches or rewrites its file mid-read
      return count;
    });
    expect(codeOf(() => realIo.readFile(file))).toBe('ECHANGED');
  });

  posix('a FIFO in place of a result is refused at once instead of blocking the collector', () => {
    const fifo = path.join(dir, 'out-rev1.json');
    expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
    const script = `const { defaultDeps } = require(${JSON.stringify(RESULTS_MODULE)}); try { defaultDeps().readFile(${JSON.stringify(fifo)}); console.log('read'); } catch (error) { console.log(error.code); }`;
    const child = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 10000 });
    expect(child.error).toBeUndefined();
    expect(child.stdout.trim()).toBe('ENOTREG');
  }, 20000);

  test('an oversized file is refused from its descriptor without being read', () => {
    const file = path.join(dir, 'out-big.json');
    const fd = fs.openSync(file, 'w');
    fs.ftruncateSync(fd, 9 * 1024 * 1024);
    fs.closeSync(fd);
    const reading = jest.spyOn(fs, 'readSync');
    expect(codeOf(() => realIo.readFile(file))).toBe('EFBIG');
    expect(reading).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AC6: arrival is the change time, inside [dispatchedAt, deadlineAt] (review round 1)
// ---------------------------------------------------------------------------

describe('AC6: a result counts only when its change time lies in [dispatchedAt, deadlineAt]', () => {
  test('a file that last changed before the dispatch is stale: nothing of this dispatch has been written (P1)', () => {
    write('ver1', ballot(['f1', 'real']), T0 - 120 * MIN);
    const early = collect([verifier('ver1')], T0 + MIN);
    expect(stateOf(early, 'ver1')).toMatchObject({ state: 'missing', reason: 'stale-result-before-dispatch', pending: true });
    expect(early.votes).toEqual([]);
    expect(early.ok).toBe(false);

    const late = collect([verifier('ver1')], T0 + 6 * MIN);
    expect(stateOf(late, 'ver1')).toMatchObject({ state: 'expired', reason: 'stale-result-before-dispatch', pending: false });
    expect(late.incompleteVerifiers).toEqual([{ verifier: 'ver1', reason: 'expired:stale-result-before-dispatch', candidateIds: null }]);
  });

  test('the dispatch itself is inside the window, the millisecond before it is not', () => {
    write('ver1', ballot(['f1', 'real']), T0);
    write('ver2', ballot(['f1', 'real']), T0 - 1);
    const result = collect([verifier('ver1'), verifier('ver2')], T0 + MIN);
    expect(stateOf(result, 'ver1').state).toBe('arrived');
    expect(stateOf(result, 'ver2')).toMatchObject({ state: 'missing', reason: 'stale-result-before-dispatch' });
  });

  test('round 2 in a reused directory reports round 2, not the first round\'s scratch copy (P10)', () => {
    const round1 = reviewer('rev1', { dispatchedAt: T0, deadlineAt: T0 + 15 * MIN });
    const T1 = T0 + 30 * MIN;
    const round2 = reviewer('rev1', { dispatchedAt: T1, deadlineAt: T1 + 15 * MIN });
    const ids = (result) => result.findings.map((finding) => finding.id);

    write('rev1', review([{ id: 'ROUND-1' }], ['a.js']), T0 + MIN);
    expect(ids(collect([round1], T0 + 2 * MIN))).toEqual(['ROUND-1']);

    write('rev1', review([{ id: 'ROUND-2' }], ['a.js']), T1 + MIN);
    const second = collect([round2], T1 + 2 * MIN);
    expect(ids(second)).toEqual(['ROUND-2']);
    expect(second.warnings.join(' ')).toMatch(/scratch copy from before this dispatch/);

    fs.rmSync(path.join(dir, 'out-rev1.json'));
    expect(ids(collect([round2], T1 + 3 * MIN))).toEqual(['ROUND-2']); // the scratch copy now holds round 2
  });

  test('a scratch copy from an earlier round never arrives by itself, and neither does the stale file beside it', () => {
    write('rev1', review([{ id: 'ROUND-1' }], ['a.js']), T0 + MIN);
    collect([reviewer('rev1')], T0 + 2 * MIN);
    const T1 = T0 + 30 * MIN;
    const round2 = reviewer('rev1', { dispatchedAt: T1, deadlineAt: T1 + 15 * MIN });

    const withStaleFile = collect([round2], T1 + MIN);
    expect(stateOf(withStaleFile, 'rev1')).toMatchObject({ state: 'missing', reason: 'stale-result-before-dispatch' });
    expect(withStaleFile.findings).toEqual([]);

    fs.rmSync(path.join(dir, 'out-rev1.json'));
    const withCopyOnly = collect([round2], T1 + MIN);
    expect(stateOf(withCopyOnly, 'rev1')).toMatchObject({ state: 'missing', reason: 'not-yet-written' });
    expect(withCopyOnly.findings).toEqual([]);
  });

  test('the modification time is not the arrival: a late file with a backdated mtime is late (touch -t, cp -p, a renamed early temp file)', () => {
    const base = Date.now();
    const file = write('rev1', review([{ id: 'LATE' }], ['a.js']), base - 90 * MIN); // the mtime says "90 minutes ago"
    const window = { dispatchedAt: base - 120 * MIN, deadlineAt: base - 60 * MIN }; // the deadline passed an hour ago
    expect(fs.statSync(file).mtimeMs).toBeLessThan(window.deadlineAt);
    const result = collectResults({ expected: [reviewer('rev1', window)], dir, now: base });
    expect(stateOf(result, 'rev1')).toMatchObject({ state: 'expired', reason: 'arrived-after-deadline' });
    expect(Math.abs(stateOf(result, 'rev1').arrivedAt - base)).toBeLessThan(MIN);
    expect(result.findings).toEqual([]);
  });

  test('with no stamping at all, a result inside its window arrives and the scratch copy keeps that arrival', () => {
    const file = write('rev1', review([{ id: 'OK' }], ['a.js']));
    const window = around(file);
    const now = window.dispatchedAt + 6 * MIN;
    const first = collectResults({ expected: [reviewer('rev1', window)], dir, now });
    expect(stateOf(first, 'rev1')).toMatchObject({ state: 'arrived', scratchPath: path.join(scratch(), 'out-rev1.json') });
    fs.rmSync(file);
    const second = collectResults({ expected: [reviewer('rev1', window)], dir, now });
    expect(stateOf(second, 'rev1').arrivedAt).toBe(stateOf(first, 'rev1').arrivedAt);
    expect(second.findings.map((finding) => finding.id)).toEqual(['OK']);
  });

  test('the arrival is whole milliseconds, so a scratch copy and the file it came from agree on every pass', () => {
    write('ver1', ballot(['f1', 'real']));
    const fractional = {
      ...stamped,
      lstat: (file) => {
        const facts = stamped.lstat(file);
        return facts !== null && facts.isFile ? { ...facts, mtimeMs: T0 + 0.7, ctimeMs: T0 + 0.7 } : facts;
      },
    };
    const first = collectResults({ expected: [verifier('ver1')], dir, now: T0 + MIN }, fractional);
    const second = collectResults({ expected: [verifier('ver1')], dir, now: T0 + MIN }, fractional);
    expect(stateOf(first, 'ver1').arrivedAt).toBe(T0 + 1);
    expect(stateOf(second, 'ver1').arrivedAt).toBe(T0 + 1);
  });

  test.each([
    ['no dispatchedAt', { dispatchedAt: undefined }, /dispatchedAt must be/],
    ['a dispatchedAt that is not a time', { dispatchedAt: 'yesterday' }, /dispatchedAt must be/],
    ['a deadline before the dispatch', { dispatchedAt: T0 + 15 * MIN }, /later than dispatchedAt/],
    ['a deadline equal to the dispatch', { dispatchedAt: T0 + 5 * MIN }, /later than dispatchedAt/],
  ])('refuses %s', (_label, extra, reason) => {
    const result = collectResults({ expected: [verifier('ver1', extra)], dir, now: T0 });
    expect(result).toMatchObject({ ok: false, agents: [] });
    expect(result.reason).toMatch(reason);
  });
});

describe('reviewDeadlines hands the dispatch time on and names what is not a time', () => {
  test('the answer carries dispatchedAt, the `now` it was given, which collectResults needs', () => {
    expect(reviewDeadlines({ role: 'reviewer', now: T0 })).toMatchObject({ dispatchedAt: T0, deadlineAt: T0 + 15 * MIN });
    expect(reviewDeadlines({ role: 'reviewer', now: new Date(T0).toISOString() }).dispatchedAt).toBe(T0);
  });

  test.each([[1e300], [Infinity], [8.64e15 + 1]])('now = %p is refused with a named reason, not a RangeError', (now) => {
    const result = reviewDeadlines({ role: 'reviewer', now });
    expect(result).toMatchObject({ ok: false, deadlineAt: null });
    expect(result.reason).toMatch(/now must be/);
  });

  test('a now so late that the deadline cannot be a date is refused too', () => {
    const result = reviewDeadlines({ role: 'reviewer', now: 8.64e15 });
    expect(result).toMatchObject({ ok: false, deadlineAt: null });
    expect(result.reason).toMatch(/too late/);
  });
});

// ---------------------------------------------------------------------------
// AC7 (slices): a slice is reviewed only when its paths are checked (review round 1)
// ---------------------------------------------------------------------------

describe('AC7: a reviewer given a sliceId must name its paths', () => {
  test.each([
    ['no paths at all', {}],
    ['an empty paths list', { paths: [] }],
  ])('%s: the request is refused and no slice is reported reviewed', (_label, extra) => {
    write('rev1', review([], []));
    const result = collect([reviewer('rev1', { sliceId: 's1', ...extra })]);
    expect(result).toMatchObject({ ok: false, agents: [], reviewedSlices: [] });
    expect(result.reason).toMatch(/paths must list the paths of slice "s1"/);
  });

  test('the security lane is held to the same rule', () => {
    const result = collect([{ name: 'sec1', role: 'security', dispatchedAt: T0, deadlineAt: T0 + 15 * MIN, sliceId: 's1' }]);
    expect(result).toMatchObject({ ok: false, reviewedSlices: [] });
    expect(result.reason).toMatch(/paths must list/);
  });
});

// ---------------------------------------------------------------------------
// AC8: the docs say what is enforced and what is not (review round 1)
// ---------------------------------------------------------------------------

describe('AC8: the docs do not claim what nothing implements', () => {
  const repoRoot = path.join(__dirname, '..', '..', '..');
  const guide = fs.readFileSync(path.join(repoRoot, 'docs', 'guides', 'user-guide.md'), 'utf8');
  const changelog = fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');
  const row = (key) => guide.split('\n').find((line) => line.startsWith(`| \`${key}\` |`));

  test('the maxConcurrentAgents row says the key is validated only and not enforced yet', () => {
    expect(row('maxConcurrentAgents')).toMatch(/not enforced yet/);
    expect(row('maxConcurrentAgents')).not.toMatch(/kept below/);
  });

  test('the deadlineMinutes row says no skill or command calls the subcommand yet', () => {
    expect(row('deadlineMinutes')).toMatch(/no skill or command calls the subcommand yet/);
  });

  test('the CHANGELOG entry does not claim a review no longer stalls: nothing calls results yet', () => {
    const entry = changelog.split('\n').find((line) => line.includes('`pr-review-cli.js results`'));
    expect(entry).toMatch(/no skill or command calls `results` yet/);
    expect(entry).toMatch(/nothing reads or enforces it yet/);
    expect(entry).not.toMatch(/no longer stalls/);
  });
});

// ---------------------------------------------------------------------------
// The real entry point
// ---------------------------------------------------------------------------

describe('pr-review-cli results (real process)', () => {
  const run = (payload, sub = 'results') => {
    const { status, stdout } = spawnSync('node', [CLI, sub], { input: JSON.stringify(payload), encoding: 'utf8' });
    return { status, body: JSON.parse(stdout) };
  };

  test('collect, then votes and slices consume what it answered', () => {
    // The real process judges arrival by the real change time, so the window is built from the files themselves.
    const files = [write('ver1', ballot(['f1', 'real'])), write('ver2', ballot(['f1', 'real']))];
    const changed = Math.max(...files.map((file) => fs.statSync(file).ctimeMs));
    const window = { dispatchedAt: changed - 5 * MIN, deadlineAt: changed + MIN };
    const { status, body } = run({
      action: 'collect',
      dir,
      now: window.deadlineAt + MIN,
      depth: 'standard',
      candidates: [{ id: 'f1', severity: 'important' }],
      expected: ['ver1', 'ver2', 'ver3'].map((name) => verifier(name, window)),
    });
    expect(status).toBe(0);
    expect(body.agents.map((agent) => agent.state)).toEqual(['arrived', 'arrived', 'expired']);
    expect(body.incompleteVerifiers.map((entry) => entry.verifier)).toEqual(['ver3']);

    const votes = run(body.votesInput, 'votes');
    expect(votes.status).toBe(0);
    expect(votes.body.findings[0]).toMatchObject({ outcome: 'unverified', reason: 'verifier-incomplete' });
  });

  test('through the real process a late file with a backdated mtime is late, and a request without dispatchedAt is refused', () => {
    const base = Date.now();
    write('rev1', review([{ id: 'LATE' }], ['a.js']), base - 90 * MIN);
    const late = { dispatchedAt: base - 120 * MIN, deadlineAt: base - 60 * MIN };
    const { body } = run({ action: 'collect', dir, now: base, expected: [reviewer('rev1', late)] });
    expect(body.agents[0]).toMatchObject({ state: 'expired', reason: 'arrived-after-deadline' });
    expect(body.findings).toEqual([]);

    const refused = run({ action: 'collect', dir, now: base, expected: [reviewer('rev1', { dispatchedAt: undefined })] }).body;
    expect(refused).toMatchObject({ ok: false, agents: [] });
    expect(refused.reason).toMatch(/dispatchedAt must be/);
  });

  test('deadlines and failure answer through the CLI, an unknown action is refused', () => {
    expect(run({ action: 'deadlines', role: 'verifier', now: T0 }).body).toMatchObject({ ok: true, dispatchedAt: T0, deadlineAt: T0 + 5 * MIN });
    expect(run({ action: 'failure', status: 429, retryAfterSec: 299, now: T0 + 240 * 1000, deadlineAt: T0 + 5 * MIN }).body).toMatchObject({
      failFast: true,
      reason: 'retry-would-pass-deadline',
    });
    expect(run({ action: 'failure', status: 429, retryAfterSec: 99999 }).body).toMatchObject({ failFast: true, state: 'partial' });
    // No `now` in the payload: the CLI supplies the clock, so the deadline is still checked against the real time.
    expect(run({ action: 'failure', status: 429, retryAfterSec: 299, deadlineAt: Date.now() + 60 * 1000 }).body).toMatchObject({
      failFast: true,
      reason: 'retry-would-pass-deadline',
    });
    expect(run({ action: 'kill-agent' }).body).toMatchObject({ ok: false });
    expect(run({}).body.reason).toMatch(/unknown results action/);
  });

  test('the CLI defaults the clock when the payload names none', () => {
    const result = run({ action: 'deadlines', role: 'reviewer' }).body;
    expect(Math.abs(result.deadlineAt - (Date.now() + 15 * MIN))).toBeLessThan(60 * 1000);
  });

  test('the subcommand is registered and listed in the usage text', () => {
    expect(HANDLERS.results).toBe(runResults);
    const { body } = run({}, 'no-such-subcommand');
    expect(body.error).toMatch(/reachability\|results\|timing\|walltime>/);
  });
});
