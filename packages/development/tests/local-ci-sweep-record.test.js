'use strict';

/**
 * Tests for the merge sweep that records (packages/development/lib/local-ci-sweep-record.js and the `sweep`
 * subcommand of local-ci-cli.js; kata mdfr, plan docs/plans/pr-review-speedup-plan.md section 3H and section 7,
 * correction 2). The pure half (`findUntracked`) is covered by local-ci-sweep.test.js.
 *
 * The tracker is an in-memory stand-in for `br` that keeps the behaviours the sweep depends on: an external reference
 * is unique across the whole workspace and `create` refuses a second bead with it, and a listing shows every bead,
 * closed ones included. The real beads adapter and a real `br` are exercised by the process test at the end (a stateful
 * stand-in `br` behind the real adapter and the real CLI) and by the smoke run recorded in the pull request.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const cli = require('../lib/local-ci-cli');
const { recordSweep, sweep, beadFor, SWEEP_LABEL } = require('../lib/local-ci-sweep-record');
const { findingKey, failureKey } = require('../lib/local-ci-sweep');
const { fakeGhDir, cleanupBaseRepos } = require('./helpers/local-ci-base-repo');

const CLI_PATH = path.join(__dirname, '..', 'lib', 'local-ci-cli.js');
const HEAD = 'a'.repeat(40);
// A credential-shaped value, assembled here so that no line of this file is one.
const FAKE_TOKEN = ['ghp', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('_');

const finding = (over = {}) => ({
  prNumber: 12,
  commentId: 345,
  body: 'Possible null dereference in foo()',
  path: 'src/foo.js',
  line: 10,
  url: 'https://github.com/acme/widgets/pull/12#discussion_r345',
  author: 'coderabbitai[bot]',
  ...over,
});

const failure = (over = {}) => ({
  checkRunId: 999,
  name: 'test (node 22)',
  sha: 'abcdef0123456789abcdef0123456789abcdef01',
  url: 'https://github.com/acme/widgets/runs/999',
  conclusion: 'failure',
  ...over,
});

const facts = (findings = [], failures = []) => ({ findings, failures });
const FACTS = facts([finding(), finding({ commentId: 346, body: 'Unused import' })], [failure()]);
const KEYS = [findingKey(12, 345), findingKey(12, 346), failureKey(999)];
const OPTIONS = { repo: 'Acme/Widgets', pr: 13, headSha: HEAD };

const WRITES = ['tracker.create-detailed'];

/** What a create answers when the key is held by a DELETED bead (captured from br 0.6.0, through the runner's TOOL_FAILED detail). */
const tombstoneRefusal = (key) => ({
  ok: false,
  error: {
    code: 'TOOL_FAILED',
    message: `beads: capability 'tracker.create-detailed' failed: {"error":{"code":"CONFIG_ERROR","message":"Configuration error: External reference '${key}' already exists on issue bd-9"}}`,
  },
});

/** An in-memory `br`: the deps `recordSweep` runs against. `issues` may be pre-seeded; `deleted` are keys of deleted beads (held, not listed); `fail` can refuse any call. */
function fakeTracker({ fail = () => null, issues = [], deleted = [] } = {}) {
  const calls = [];
  return {
    issues,
    calls,
    writes: () => calls.filter((c) => WRITES.includes(c.capability)),
    run(capability, args) {
      calls.push({ capability, args });
      const failed = fail(capability, args);
      if (failed) return failed;
      switch (capability) {
        case 'tracker.find-by-key':
          return { ok: true, data: JSON.stringify({ issues: JSON.parse(JSON.stringify(issues)) }) };
        case 'tracker.create-detailed': {
          if (deleted.includes(args.externalKey)) return tombstoneRefusal(args.externalKey);
          if (issues.some((issue) => issue.external_ref === args.externalKey)) {
            return { ok: false, error: { code: 'TOOL_FAILED', message: 'CONFIG_ERROR: external_ref already exists' } };
          }
          const issue = {
            id: `bd-${issues.length + 1}`,
            status: 'open',
            title: args.title,
            description: args.description,
            issue_type: args.type,
            priority: Number(args.priority),
            labels: args.labels.split(','),
            external_ref: args.externalKey,
          };
          issues.push(issue);
          return { ok: true, data: { id: issue.id } };
        }
        default:
          throw new Error(`the sweep must only ever list and create; it called ${capability}`);
      }
    },
  };
}

const UNAVAILABLE = { ok: false, unavailable: true, error: { code: 'UNAVAILABLE', message: "tracker is unavailable: no '.beads' workspace" } };
const failCreate = (code = 'TOOL_FAILED') => (capability) => (capability === 'tracker.create-detailed' ? { ok: false, error: { code, message: 'br said no' } } : null);

describe('a second sweep of the same facts creates nothing (acceptance)', () => {
  test('the first sweep creates one bead per entry under its sweep key; the second writes nothing at all', () => {
    const tracker = fakeTracker();
    const first = recordSweep(FACTS, tracker, OPTIONS);
    expect(first).toMatchObject({ ok: true, status: 'RECORDED', recorded: true, counts: { create: 3, skip: 0, error: 0 }, invalid: [] });
    expect(tracker.issues.map((issue) => issue.external_ref)).toEqual(KEYS);
    expect(first.beads[KEYS[0]]).toMatchObject({ kind: 'finding', action: 'create', beadId: 'bd-1' });
    expect(first.beads[KEYS[2]]).toMatchObject({ kind: 'failure', action: 'create', beadId: 'bd-3' });

    const writesBefore = tracker.writes().length;
    const second = recordSweep(FACTS, tracker, OPTIONS);
    expect(second).toMatchObject({ ok: true, status: 'RECORDED', recorded: true, counts: { create: 0, skip: 3, error: 0 } });
    expect(tracker.writes()).toHaveLength(writesBefore);
    expect(tracker.issues).toHaveLength(3);
    // The held beads are named, so the report can say what already tracks each entry.
    expect(second.beads[KEYS[0]]).toMatchObject({ action: 'skip', reason: 'tracked', beadId: 'bd-1', status: 'open' });
  });

  test('a later sweep creates only the entries that are new', () => {
    const tracker = fakeTracker();
    recordSweep(FACTS, tracker, OPTIONS);
    const grown = facts([...FACTS.findings, finding({ commentId: 400, body: 'A new thing' })], [...FACTS.failures, failure({ checkRunId: 1000 })]);
    const third = recordSweep(grown, tracker, OPTIONS);
    expect(third).toMatchObject({ ok: true, counts: { create: 2, skip: 3, error: 0 } });
    expect(tracker.issues.map((issue) => issue.external_ref)).toEqual([...KEYS, findingKey(12, 400), failureKey(1000)]);
  });

  test('a bead a person closed still counts as tracked: it is never recreated, never reopened, and the sweep is clean', () => {
    const tracker = fakeTracker();
    recordSweep(FACTS, tracker, OPTIONS);
    tracker.issues[0].status = 'closed';
    tracker.issues[0].close_reason = 'done';
    const again = recordSweep(FACTS, tracker, OPTIONS);
    expect(again).toMatchObject({ ok: true, status: 'RECORDED', counts: { create: 0, skip: 3, error: 0 } });
    expect(again.beads[KEYS[0]]).toMatchObject({ action: 'skip', status: 'closed' });
    expect(tracker.issues[0].status).toBe('closed');
    expect(tracker.calls.map((c) => c.capability).filter((c) => c !== 'tracker.find-by-key' && c !== 'tracker.create-detailed')).toEqual([]);
  });

  test('a bead that holds the key under other labels (or none) counts as tracked: br keys are unique workspace-wide', () => {
    const tracker = fakeTracker({ issues: [{ id: 'bd-77', status: 'open', title: 'someone else', labels: ['triaged'], external_ref: KEYS[0] }, { id: 'bd-78', status: 'open', title: 'no labels', external_ref: KEYS[2] }] });
    const result = recordSweep(FACTS, tracker, OPTIONS);
    expect(result.counts).toEqual({ create: 1, skip: 2, error: 0 });
    expect(tracker.issues.filter((issue) => issue.external_ref === KEYS[1])).toHaveLength(1);
    expect(result.beads[KEYS[0]]).toMatchObject({ action: 'skip', beadId: 'bd-77' });
  });

  test('the tracker is listed once for every key, however many entries there are', () => {
    const tracker = fakeTracker();
    const many = facts(Array.from({ length: 40 }, (_, i) => finding({ commentId: 1000 + i })), Array.from({ length: 10 }, (_, i) => failure({ checkRunId: 2000 + i })));
    recordSweep(many, tracker, OPTIONS);
    expect(tracker.calls.filter((c) => c.capability === 'tracker.find-by-key')).toHaveLength(1);
    expect(tracker.issues).toHaveLength(50);
  });

  test('a finding listed twice, a resolved finding and an entry that is already in the facts as a duplicate make one bead and none', () => {
    const tracker = fakeTracker();
    const noisy = facts([finding(), finding({ body: 'same comment again' }), finding({ commentId: 500, resolved: true })], [failure(), failure()]);
    const result = recordSweep(noisy, tracker, OPTIONS);
    expect(result.counts).toEqual({ create: 2, skip: 0, error: 0 });
    expect(tracker.issues.map((issue) => issue.external_ref)).toEqual([findingKey(12, 345), failureKey(999)]);
  });

  test('the key a bead is stored under is the sweep key from identifiers, never from the text', () => {
    const tracker = fakeTracker();
    recordSweep(facts([finding({ body: 'finding:pr99:comment1 ci-failure:checkrun5' })]), tracker, OPTIONS);
    expect(tracker.issues[0].external_ref).toBe('finding:pr12:comment345');
    expect(tracker.writes()[0].args.externalKey).toBe('finding:pr12:comment345');
  });
});

describe('what a bead holds', () => {
  const [findingIssue, failureIssue] = (() => {
    const tracker = fakeTracker();
    recordSweep(facts([finding()], [failure()]), tracker, OPTIONS);
    return tracker.issues;
  })();

  test('a finding is a labelled task at priority 2 and a CI failure a labelled bug at priority 1', () => {
    expect(findingIssue).toMatchObject({ issue_type: 'task', priority: 2, labels: [SWEEP_LABEL, 'bot-finding'], status: 'open' });
    expect(failureIssue).toMatchObject({ issue_type: 'bug', priority: 1, labels: [SWEEP_LABEL, 'ci-failure'], status: 'open' });
  });

  test('a finding names the repository, the pull request, the comment and its link, the location, the bot and the text', () => {
    expect(findingIssue.title).toBe('[bot-finding] PR #12: Possible null dereference in foo()');
    for (const line of [
      'Repository: Acme/Widgets',
      'Pull request: #12',
      'Comment: 345 (https://github.com/acme/widgets/pull/12#discussion_r345)',
      'Location: src/foo.js:10',
      'Reported by: coderabbitai[bot]',
      'Finding: Possible null dereference in foo()',
      `Found while merging Acme/Widgets PR #13 at head ${HEAD}.`,
      'Dedupe key: finding:pr12:comment345',
    ]) {
      expect(findingIssue.description).toContain(line);
    }
  });

  test('a CI failure links its run and names the check, the commit and the pull request', () => {
    expect(failureIssue.title).toBe('[ci-failure] test (node 22) failed on abcdef0 (check run 999)');
    for (const line of ['Check run: 999 (https://github.com/acme/widgets/runs/999)', 'Check: test (node 22)', 'Commit: abcdef0123456789abcdef0123456789abcdef01', 'Conclusion: failure', 'Dedupe key: ci-failure:checkrun999']) {
      expect(failureIssue.description).toContain(line);
    }
  });

  test('an entry with only its identifiers still makes a readable bead', () => {
    const tracker = fakeTracker();
    recordSweep(facts([{ prNumber: 3, commentId: 'IC_kwDOabc' }], [{ checkRunId: 'CR_kwDOabc' }]), tracker, OPTIONS);
    expect(tracker.issues.map((issue) => issue.title)).toEqual(['[bot-finding] PR #3: comment IC_kwDOabc', '[ci-failure] hosted CI failed (check run CR_kwDOabc)']);
    expect(tracker.issues[0].description).not.toMatch(/Location:|Reported by:|Finding:/);
  });

  test('every value reaches the tracker as one argument the runner will take: text is one line, bounded, redacted and never starts with a dash', () => {
    const token = FAKE_TOKEN;
    const nasty = finding({
      body: `-leading dash\nsecond line\u0000with NUL\ttab ${token} ${'x'.repeat(2000)}`,
      author: `evil\nname ${token}`,
      path: `-file\u0000.js`,
      line: 'not a number',
      url: 'javascript:alert(1)',
    });
    const tracker = fakeTracker();
    recordSweep(facts([nasty]), tracker, OPTIONS);
    const { title, description } = tracker.issues[0];
    expect(title.startsWith('[')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(120);
    expect(description.startsWith('-')).toBe(false);
    for (const text of [title, description]) {
      expect(text).not.toContain(token);
      expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f]/);
    }
    expect(description).toContain('[REDACTED]');
    expect(description).toContain('Finding: -leading dash second line with NUL tab');
    expect(description.split('\n').find((line) => line.startsWith('Finding: ')).length).toBeLessThanOrEqual(620);
    // A link that is not http(s) and a line that is not a number are dropped, not trusted and not a reason to refuse.
    expect(description).not.toContain('javascript:');
    expect(description).toMatch(/\nComment: 345\n/);
    expect(description).toContain('Location: -file .js\n');
  });

  test('a credential is redacted before the text is cut, so the cut can never leave a prefix of it that no pattern recognises', () => {
    // The title keeps 80 characters and the finding line 600: a token that starts just inside either window would be cut
    // to a stub shorter than any credential pattern, and a whole-text redaction afterwards could no longer see it.
    const tracker = fakeTracker();
    const cutInTitle = `${'x'.repeat(72)}${FAKE_TOKEN}`;
    const cutInBody = `${'y'.repeat(590)}${FAKE_TOKEN}`;
    recordSweep(facts([finding({ body: cutInTitle }), finding({ commentId: 346, body: cutInBody })]), tracker, OPTIONS);
    for (const issue of tracker.issues) {
      expect(issue.title + issue.description).not.toContain('ghp_');
      expect(issue.title + issue.description).not.toContain('A1b2C3');
    }
  });

  test('a JSON web token in a bot comment never reaches the bead (the git-tracked store), whichever field carries it', () => {
    const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJ4In0', 'abc123_-DEF456xyz'].join('.');
    const tracker = fakeTracker();
    recordSweep(facts([finding({ body: `the bot echoed ${jwt}`, author: jwt })], [failure({ name: `job ${jwt}`, url: `https://example.invalid/?t=${jwt}` })]), tracker, OPTIONS);
    expect(tracker.issues).toHaveLength(2);
    for (const issue of tracker.issues) {
      for (const part of jwt.split('.')) expect(issue.title + issue.description).not.toContain(part);
      expect(issue.title + issue.description).toContain('[REDACTED]');
    }
  });

  test('a link with credentials in it (user:pass@host) is left out of the bead, the rest of the finding is kept (kata mdfr review round 2)', () => {
    const tracker = fakeTracker();
    const withPassword = ['https://ci-user', 'pw123456@github.com/acme/widgets/pull/12#discussion_r345'].join(':');
    const withToken = ['https://tokenvalue123456', 'github.com/acme/widgets/pull/12#discussion_r346'].join('@');
    recordSweep(facts([finding({ url: withPassword }), finding({ commentId: 346, url: withToken })], [failure({ url: withPassword })]), tracker, OPTIONS);
    expect(tracker.issues).toHaveLength(3);
    for (const issue of tracker.issues) {
      for (const secret of ['pw123456', 'ci-user', 'tokenvalue123456']) expect(issue.title + issue.description).not.toContain(secret);
    }
    expect(tracker.issues[0].description).toContain('Finding: Possible null dereference in foo()');
  });

  test('a field that is not text (an object, a list) is ignored, not printed as [object Object]', () => {
    const tracker = fakeTracker();
    recordSweep(facts([finding({ body: { text: 'x' }, author: ['a'], path: {}, url: 7 })], [failure({ name: { n: 1 }, sha: 12, url: [] })]), tracker, OPTIONS);
    for (const issue of tracker.issues) expect(issue.title + issue.description).not.toMatch(/\[object|\[Object/);
  });

  test('beadFor builds exactly what createFinding takes', () => {
    const [entry] = require('../lib/local-ci-sweep').findUntracked(facts([finding()]), []).findings;
    expect(Object.keys(beadFor('finding', entry, OPTIONS)).sort()).toEqual(['description', 'key', 'labels', 'priority', 'title', 'type']);
  });
});

describe('the answer never echoes what the facts quoted (kata mdfr review round 2)', () => {
  const stripe = ['sk', 'live', 'A1b2C3d4E5f6G7h8I9j0K1'].join('_');
  const glpat = ['glpat', 'A1b2C3d4E5f6G7h8I9j0K1'].join('-');
  const unsignedJwt = ['eyJhbGciOiJub25lIn0', 'eyJzdWIiOiJ4In0', ''].join('.');

  test('an entry with no readable id is reported by kind, position and reason, never by its text', () => {
    const quoted = `leaked ${stripe} and ${glpat} and ${unsignedJwt}`;
    const tracker = fakeTracker();
    const result = recordSweep(facts([finding(), finding({ commentId: undefined, body: quoted, author: stripe })], [failure({ checkRunId: undefined, name: quoted })]), tracker, OPTIONS);
    expect(result).toMatchObject({ ok: false, status: 'PARTIAL', counts: { create: 1, skip: 0, error: 2 } });
    expect(result.invalid).toEqual([
      { kind: 'finding', index: 1, reason: expect.stringContaining('no readable commentId') },
      { kind: 'failure', index: 0, reason: expect.stringContaining('no readable checkRunId') },
    ]);
    const printed = JSON.stringify(result);
    for (const secret of [stripe, glpat, unsignedJwt, 'leaked']) expect(printed).not.toContain(secret);
  });

  test('a tool message that echoes a credential is redacted in the answer, as the beads are', () => {
    const tracker = fakeTracker({ fail: (capability) => (capability === 'tracker.create-detailed' ? { ok: false, error: { code: 'TOOL_FAILED', message: `br echoed ${stripe} and ${unsignedJwt}` } } : null) });
    const result = recordSweep(facts([finding()]), tracker, OPTIONS);
    expect(result).toMatchObject({ ok: false, status: 'PARTIAL' });
    expect(result.actions[0].error.message).toContain('br echoed');
    const printed = JSON.stringify(result);
    for (const secret of [stripe, unsignedJwt]) expect(printed).not.toContain(secret);
    expect(printed).toContain('[REDACTED]');
  });

  test.each([
    ['a Stripe live key', stripe],
    ['a GitLab token', glpat],
    ['a signed JSON web token', ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJ4In0', 'abc123_-DEF456xyz'].join('.')],
    ['a Google API key', `AIza${'A1b2C3d4E5'.repeat(3)}f6G7h`],
    ['text with a space', 'bad id'],
    ['a node id with a lowercase prefix', 'ic_kwDOabcdef'],
    ['more digits than any host id', '1'.repeat(19)],
    ['a path', '../../etc'],
  ])('%s is not a comment or check run id: the entry is invalid, and nothing of it reaches a key, a bead or the answer', (_name, value) => {
    const tracker = fakeTracker();
    const result = recordSweep(facts([finding({ commentId: value })], [failure({ checkRunId: value })]), tracker, OPTIONS);
    expect(result).toMatchObject({ ok: false, status: 'PARTIAL', counts: { create: 0, skip: 0, error: 2 } });
    expect(tracker.calls).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(value);
  });
});

describe('failures are reported, never swallowed', () => {
  test('a tracker that cannot be read fails the run before any write, and the failure names it', () => {
    const tracker = fakeTracker({ fail: (capability) => (capability === 'tracker.find-by-key' ? { ok: false, error: { code: 'TOOL_FAILED', message: 'br is broken' } } : null) });
    const result = recordSweep(FACTS, tracker, OPTIONS);
    expect(result).toMatchObject({ ok: false, status: 'FAILED', recorded: false });
    expect(result.reason).toContain('br is broken');
    expect(tracker.writes()).toEqual([]);
  });

  test('a repository with no usable tracker is UNAVAILABLE with the skip fallback, exit-clean, and nothing was written', () => {
    const tracker = fakeTracker({ fail: () => UNAVAILABLE });
    const result = recordSweep(FACTS, tracker, OPTIONS);
    expect(result).toMatchObject({ ok: true, status: 'UNAVAILABLE', recorded: false, fallback: 'skip-finding-beads', actions: [], beads: {} });
    expect(result.reason).toContain('.beads');
    expect(tracker.writes()).toEqual([]);
  });

  test('an adapter that can list but cannot create is UNAVAILABLE, not a half-recorded run', () => {
    const tracker = fakeTracker({ fail: (capability) => (capability === 'tracker.create-detailed' ? UNAVAILABLE : null) });
    const result = recordSweep(FACTS, tracker, OPTIONS);
    expect(result).toMatchObject({ ok: true, status: 'UNAVAILABLE', recorded: false, fallback: 'skip-finding-beads' });
    expect(tracker.issues).toEqual([]);
  });

  test('one create that fails does not stop the others: PARTIAL, the failure named under its key, and the next sweep retries only that one', () => {
    let refuse = true;
    const tracker = fakeTracker({ fail: (capability, args) => (refuse && capability === 'tracker.create-detailed' && args.externalKey === KEYS[1] ? { ok: false, error: { code: 'TOOL_FAILED', message: 'br said no' } } : null) });
    const first = recordSweep(FACTS, tracker, OPTIONS);
    expect(first).toMatchObject({ ok: false, status: 'PARTIAL', recorded: false, counts: { create: 2, skip: 0, error: 1 } });
    const bad = first.actions.find((a) => a.key === KEYS[1]);
    expect(bad).toMatchObject({ action: 'create', ok: false, reason: 'create-failed', error: { code: 'TOOL_FAILED', message: 'br said no' } });
    expect(first.beads[KEYS[1]]).toMatchObject({ action: 'error', reason: 'create-failed' });
    expect(tracker.issues.map((issue) => issue.external_ref)).toEqual([KEYS[0], KEYS[2]]);

    refuse = false;
    const retry = recordSweep(FACTS, tracker, OPTIONS);
    expect(retry).toMatchObject({ ok: true, status: 'RECORDED', counts: { create: 1, skip: 2, error: 0 } });
    expect(tracker.issues).toHaveLength(3);
  });

  test('two beads sharing a key are an error for that key and nothing is created for it; the rest are recorded', () => {
    const tracker = fakeTracker({ issues: [{ id: 'bd-1', status: 'open', labels: [], external_ref: KEYS[0] }, { id: 'bd-2', status: 'open', labels: [], external_ref: KEYS[0] }] });
    const result = recordSweep(FACTS, tracker, OPTIONS);
    expect(result).toMatchObject({ ok: false, status: 'PARTIAL', counts: { create: 2, skip: 0, error: 1 } });
    expect(result.beads[KEYS[0]]).toMatchObject({ action: 'error', reason: 'ambiguous-key' });
    expect(result.actions.find((a) => a.key === KEYS[0]).error).toMatchObject({ code: 'AMBIGUOUS_KEY', ids: ['bd-1', 'bd-2'] });
    expect(tracker.writes().map((c) => c.args.externalKey)).toEqual([KEYS[1], KEYS[2]]);
  });

  test('entries whose identity cannot be read are reported under invalid and make the sweep PARTIAL; the readable ones are still recorded', () => {
    const tracker = fakeTracker();
    const result = recordSweep(facts([finding(), { prNumber: 12 }, null], [{ checkRunId: 'bad id' }]), tracker, OPTIONS);
    expect(result).toMatchObject({ ok: false, status: 'PARTIAL', recorded: false, counts: { create: 1, skip: 0, error: 3 } });
    expect(result.invalid.map((x) => x.kind)).toEqual(['finding', 'finding', 'failure']);
    expect(tracker.issues).toHaveLength(1);
  });

  test('a tracker call that throws is a bug and propagates: it is never read as "no tracker"', () => {
    const tracker = { run: () => { throw new Error('boom'); } };
    expect(() => recordSweep(FACTS, tracker, OPTIONS)).toThrow('boom');
  });

  test('malformed facts throw before the tracker is touched', () => {
    const tracker = fakeTracker();
    expect(() => recordSweep(null, tracker, OPTIONS)).toThrow(TypeError);
    expect(() => recordSweep({ findings: 'x', failures: [] }, tracker, OPTIONS)).toThrow(TypeError);
    expect(tracker.calls).toEqual([]);
  });
});

describe('a deleted bead still holds its key (kata mdfr review F3)', () => {
  test('the entry is skipped as held-not-listed, the sweep stays RECORDED, and every later sweep answers the same', () => {
    const tracker = fakeTracker({ deleted: [KEYS[1]] });
    const first = recordSweep(FACTS, tracker, OPTIONS);
    expect(first).toMatchObject({ ok: true, status: 'RECORDED', recorded: true, counts: { create: 2, skip: 1, error: 0 } });
    expect(first.beads[KEYS[1]]).toEqual({ kind: 'finding', action: 'skip', reason: 'held-not-listed' });
    expect(first.actions.find((a) => a.key === KEYS[1])).toEqual({ action: 'skip', reason: 'held-not-listed', kind: 'finding', key: KEYS[1] });
    expect(tracker.issues.map((issue) => issue.external_ref)).toEqual([KEYS[0], KEYS[2]]);

    for (let round = 0; round < 2; round += 1) {
      const later = recordSweep(FACTS, tracker, OPTIONS);
      expect(later).toMatchObject({ ok: true, status: 'RECORDED', recorded: true, counts: { create: 0, skip: 3, error: 0 } });
      expect(later.beads[KEYS[1]]).toMatchObject({ action: 'skip', reason: 'held-not-listed' });
    }
    expect(tracker.issues).toHaveLength(2); // the deleted bead is never recreated
  });

  test("only a refusal naming this entry's own key counts: another key, a longer key, another code or another failure is still a failure", () => {
    const refusal = (code, message) => ({ ok: false, error: { code, message } });
    const cases = [
      ['another key', refusal('TOOL_FAILED', `External reference '${KEYS[2]}' already exists on issue bd-9`)],
      ['a longer key that starts with this one', refusal('TOOL_FAILED', `External reference '${KEYS[1]}9' already exists on issue bd-9`)],
      ['another code', refusal('BAD_OUTPUT', `External reference '${KEYS[1]}' already exists on issue bd-9`)],
      ['another failure', refusal('TOOL_FAILED', 'database is locked')],
    ];
    for (const [name, answer] of cases) {
      const tracker = fakeTracker({ fail: (capability, args) => (capability === 'tracker.create-detailed' && args.externalKey === KEYS[1] ? answer : null) });
      const result = recordSweep(FACTS, tracker, OPTIONS);
      expect({ name, status: result.status, ...result.counts }).toEqual({ name, status: 'PARTIAL', create: 2, skip: 0, error: 1 });
      expect(result.beads[KEYS[1]]).toMatchObject({ action: 'error', reason: 'create-failed' });
    }
  });
});

describe('dryRun', () => {
  test('looks the keys up and plans, and changes nothing', () => {
    const tracker = fakeTracker();
    const result = recordSweep(FACTS, tracker, { ...OPTIONS, dryRun: true });
    expect(result).toMatchObject({ ok: true, status: 'PLANNED', recorded: false, counts: { create: 3, skip: 0, error: 0 } });
    expect(result.actions.every((a) => a.action === 'create' && a.beadId === undefined && a.ok === undefined)).toBe(true);
    expect(tracker.writes()).toEqual([]);
    expect(tracker.calls.map((c) => c.capability)).toEqual(['tracker.find-by-key']);
  });

  test('plans only what is not tracked', () => {
    const tracker = fakeTracker();
    recordSweep(facts([finding()]), tracker, OPTIONS);
    const result = recordSweep(FACTS, tracker, { ...OPTIONS, dryRun: true });
    expect(result.counts).toEqual({ create: 2, skip: 1, error: 0 });
    expect(tracker.issues).toHaveLength(1);
  });

  test('a dry run only looks up, so it cannot see a deleted bead and plans the create (documented limit); it writes nothing', () => {
    const tracker = fakeTracker({ deleted: [KEYS[1]] });
    const result = recordSweep(FACTS, tracker, { ...OPTIONS, dryRun: true });
    expect(result).toMatchObject({ ok: true, status: 'PLANNED', counts: { create: 3, skip: 0, error: 0 } });
    expect(tracker.writes()).toEqual([]);
  });

  test('a plan that already holds an error is not clean: ok is false (exit 1), the status stays PLANNED, nothing is written (kata mdfr review F5)', () => {
    const tracker = fakeTracker({ issues: [{ id: 'bd-1', status: 'open', labels: [], external_ref: KEYS[0] }, { id: 'bd-2', status: 'open', labels: [], external_ref: KEYS[0] }] });
    const result = recordSweep(FACTS, tracker, { ...OPTIONS, dryRun: true });
    expect(result).toMatchObject({ ok: false, status: 'PLANNED', recorded: false, counts: { create: 2, skip: 0, error: 1 } });
    expect(tracker.writes()).toEqual([]);
  });
});

describe('nothing to record touches nothing', () => {
  const io = () => ({ git: jest.fn(), readPr: jest.fn(), trackerFor: jest.fn(), env: {} });
  const input = (over) => ({ facts: facts(), repoRoot: '/nowhere', repo: 'Acme/Widgets', pr: 7, headSha: HEAD, baseSha: 'b'.repeat(40), ...over });

  test.each([
    ['no facts', facts()],
    ['only resolved findings', facts([finding({ resolved: true })])],
  ])('%s: git, the host and the tracker are never asked, and the answer is a clean RECORDED', (_name, empty) => {
    const effects = io();
    expect(sweep(input({ facts: empty }), effects)).toMatchObject({ ok: true, status: 'RECORDED', recorded: true, counts: { create: 0, skip: 0, error: 0 }, actions: [], invalid: [] });
    expect(effects.git).not.toHaveBeenCalled();
    expect(effects.readPr).not.toHaveBeenCalled();
    expect(effects.trackerFor).not.toHaveBeenCalled();
  });

  test('only unreadable entries: still nothing is asked, but they are reported and the sweep is PARTIAL', () => {
    const effects = io();
    const result = sweep(input({ facts: facts([{ prNumber: 1 }]) }), effects);
    expect(result).toMatchObject({ ok: false, status: 'PARTIAL', counts: { error: 1 } });
    expect(effects.trackerFor).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// A REAL repository: where the beads may go
// ---------------------------------------------------------------------------

const GIT_ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_TERMINAL_PROMPT: '0' };
const gitIn = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV }).trim();
const sandboxes = [];

afterAll(() => {
  while (sandboxes.length) fs.rmSync(sandboxes.pop(), { recursive: true, force: true });
  cleanupBaseRepos();
});

function tempDir(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  sandboxes.push(dir);
  return dir;
}

function writeFile(root, rel, text) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function commitAll(cwd, message) {
  gitIn(cwd, 'add', '-A');
  gitIn(cwd, 'commit', '-q', '-m', message);
  return gitIn(cwd, 'rev-parse', 'HEAD');
}

/**
 * The repository the sweep reads for real. The PRIMARY checkout is on `main`: `root` has no toolchain config, `base`
 * adds the config (`tracker: beads`) and a `.beads` directory. The pull request branch `pr` is checked out in a LINKED
 * worktree (the head being merged) with two commits: `p1` adds a file and `head` (hostile) commits a toolchain config
 * naming a tracker that does not exist. `merged` is what main looks like after a squash merge of the PR.
 * The primary has the remote `origin` = github.com/Acme/Widgets, the repository every sweep here runs for (`remote: null`: none).
 */
function makeRepo({ remote = 'https://github.com/Acme/Widgets.git' } = {}) {
  const sandbox = tempDir('local-ci-sweep-repo-');
  const primary = path.join(sandbox, 'primary');
  fs.mkdirSync(primary);
  gitIn(primary, 'init', '-q', '-b', 'main');
  gitIn(primary, 'config', 'user.name', 'ci');
  gitIn(primary, 'config', 'user.email', 'ci@example.invalid');
  gitIn(primary, 'config', 'commit.gpgsign', 'false');
  if (remote !== null) gitIn(primary, 'remote', 'add', 'origin', remote);
  writeFile(primary, 'README.md', 'root\n');
  const root = commitAll(primary, 'root');
  writeFile(primary, '.ensemble/toolchain.yaml', 'tracker: beads\n');
  writeFile(primary, '.beads/config.yaml', 'prefix: bd\n');
  const base = commitAll(primary, 'base');
  const worktree = path.join(sandbox, 'pr-worktree');
  gitIn(primary, 'worktree', 'add', '-q', '-b', 'pr', worktree, base);
  writeFile(worktree, 'src/widget.js', 'widget\n');
  commitAll(worktree, 'p1');
  writeFile(worktree, '.ensemble/toolchain.yaml', 'tracker: no-such-tracker\n');
  const head = commitAll(worktree, 'head');
  writeFile(primary, 'src/widget.js', 'widget\n');
  const merged = commitAll(primary, 'squash merge of the PR');
  // The primary stays where a maintainer left it: on main, at `merged`. Tests that need the base tip move it back.
  return { sandbox, primary, worktree, root, base, head, merged };
}

const input = (fx, over = {}) => ({ facts: FACTS, repoRoot: fx.worktree, repo: 'Acme/Widgets', pr: 7, headSha: fx.head, baseSha: fx.base, ...over });
/** What the host says about the PR: a head on this repository, the head being merged, and the base branch's tip. */
const hostSays = (fx, over = {}) => () => ({ ok: true, isCrossRepository: false, headRefOid: fx.head, baseRefName: 'main', baseRefOid: fx.merged, state: 'MERGED', ...over });

describe('sweep(): the repository the beads may go into', () => {
  let fx;
  beforeAll(() => {
    fx = makeRepo();
  });

  function run(payload, io = {}) {
    const tracker = io.tracker || fakeTracker();
    const trackerFor = jest.fn(() => tracker);
    const result = sweep(payload, { git: cli.defaultDeps().repoGit, readPr: hostSays(fx), trackerFor, env: {}, ...io });
    return { result, tracker, trackerFor };
  }

  test('records through a tracker built for the repository\'s PRIMARY checkout, untrusted, with the config as committed at the base', () => {
    const { result, tracker, trackerFor } = run(input(fx));
    expect(result).toMatchObject({ ok: true, status: 'RECORDED', counts: { create: 3 } });
    expect(tracker.issues).toHaveLength(3);
    expect(trackerFor).toHaveBeenCalledTimes(1);
    const options = trackerFor.mock.calls[0][0];
    // The head's worktree is named, but the tracker is for the primary checkout, and its configuration is what the BASE
    // commit holds (`tracker: beads`), not what the head committed (`no-such-tracker`).
    expect(options).toMatchObject({ projectRoot: fx.primary, untrustedProjectRoot: true });
    expect(options.baseConfig.text).toBe('tracker: beads\n');
    expect(fs.readFileSync(path.join(fx.worktree, '.ensemble', 'toolchain.yaml'), 'utf8')).toBe('tracker: no-such-tracker\n');
    // Nothing of this machine goes into a bead: no checkout path, no home directory.
    for (const issue of tracker.issues) {
      expect(issue.title + issue.description).not.toContain(fx.sandbox);
      expect(issue.title + issue.description).not.toContain(os.homedir());
    }
  });

  test('the same repository can be named by its primary checkout too, and the post-merge host answer (a moved base tip) is accepted', () => {
    const { result, trackerFor } = run(input(fx, { repoRoot: fx.primary }));
    expect(result.status).toBe('RECORDED');
    expect(trackerFor.mock.calls[0][0].projectRoot).toBe(fx.primary);
  });

  test('the host is asked about the repository and the pull request the payload names', () => {
    const readPr = jest.fn(hostSays(fx));
    run(input(fx, { repo: 'Acme/Widgets', pr: 41 }), { readPr });
    expect(readPr).toHaveBeenCalledTimes(1);
    expect(readPr).toHaveBeenCalledWith({ repo: 'Acme/Widgets', prNumber: 41 });
  });

  test.each([
    ['a head on a fork', { isCrossRepository: true }, 'cross-repository-head'],
    ['a pull request whose head is not the one being merged', { headRefOid: 'c'.repeat(40) }, 'head-not-pr-head'],
    ['a host that does not say whether the head is on this repository', { isCrossRepository: undefined }, 'head-repository-unknown'],
  ])('%s is REFUSED by name, before the tracker is built or asked, and nothing is recorded', (_name, answer, code) => {
    const { result, tracker, trackerFor } = run(input(fx), { readPr: hostSays(fx, answer) });
    expect(result).toMatchObject({ ok: true, status: 'REFUSED', recorded: false, fallback: 'skip-finding-beads', code, actions: [], beads: {} });
    expect(trackerFor).not.toHaveBeenCalled();
    expect(tracker.calls).toEqual([]);
  });

  test('a pull request the host could not be asked about is REFUSED as pr-unreadable', () => {
    const { result, trackerFor } = run(input(fx), { readPr: () => ({ ok: false, error: 'gh pr view failed' }) });
    expect(result).toMatchObject({ status: 'REFUSED', code: 'pr-unreadable' });
    expect(trackerFor).not.toHaveBeenCalled();
  });

  test('a baseSha that is not on the base branch (here: a commit of the pull request itself) is REFUSED, so the head cannot choose the tracker', () => {
    const { result, trackerFor } = run(input(fx, { baseSha: fx.head }));
    expect(result).toMatchObject({ status: 'REFUSED', code: 'base-not-on-base-branch' });
    expect(trackerFor).not.toHaveBeenCalled();
  });

  test('a primary checkout that already holds the head is REFUSED: its .beads would be the head\'s own', () => {
    const second = makeRepo();
    gitIn(second.primary, 'merge', '--no-ff', '-q', '-m', 'merge the PR here', 'pr');
    const { result, trackerFor } = run(input(second), { readPr: hostSays(second, { baseRefOid: gitIn(second.primary, 'rev-parse', 'HEAD') }) });
    expect(result).toMatchObject({ status: 'REFUSED', code: 'head-checked-out' });
    expect(trackerFor).not.toHaveBeenCalled();
  });

  test('a repoRoot that is not a git repository is FAILED before git, the host or the tracker are asked', () => {
    const notRepo = tempDir('local-ci-sweep-notrepo-');
    const readPr = jest.fn(hostSays(fx));
    const { result, trackerFor } = run(input(fx, { repoRoot: notRepo }), { readPr });
    expect(result).toMatchObject({ ok: false, status: 'FAILED', recorded: false });
    expect(result.reason).toContain('not a git repository');
    expect(readPr).not.toHaveBeenCalled();
    expect(trackerFor).not.toHaveBeenCalled();
  });

  test('a second sweep through the same trust checks creates nothing', () => {
    const tracker = fakeTracker();
    expect(run(input(fx), { tracker }).result.counts).toMatchObject({ create: 3 });
    const again = run(input(fx), { tracker });
    expect(again.result).toMatchObject({ ok: true, status: 'RECORDED', counts: { create: 0, skip: 3, error: 0 } });
    expect(tracker.writes()).toHaveLength(3);
  });

  test('dryRun goes through the trust checks too, and writes nothing', () => {
    const refused = run(input(fx, { dryRun: true }), { readPr: hostSays(fx, { isCrossRepository: true }) });
    expect(refused.result.status).toBe('REFUSED');
    const planned = run(input(fx, { dryRun: true }));
    expect(planned.result).toMatchObject({ status: 'PLANNED', counts: { create: 3 } });
    expect(planned.tracker.writes()).toEqual([]);
  });
});

describe("sweep(): the checkout must be the pull request's repository (kata mdfr review F1 and round 2)", () => {
  let fx;
  beforeAll(() => {
    fx = makeRepo();
  });

  /** Replace the primary's remotes (its linked worktrees share them) with exactly these. */
  const remotes = (...list) => {
    for (const name of gitIn(fx.primary, 'remote').split('\n').filter(Boolean)) gitIn(fx.primary, 'remote', 'remove', name);
    for (const [name, url] of list) gitIn(fx.primary, 'remote', 'add', name, url);
  };
  const run = (over = {}, io = {}) => {
    const tracker = fakeTracker();
    const readPr = jest.fn(hostSays(fx));
    const trackerFor = jest.fn(() => tracker);
    const result = sweep(input(fx, over), { git: cli.defaultDeps().repoGit, readPr, trackerFor, env: {}, ...io });
    return { result, tracker, readPr, trackerFor };
  };
  const REFUSED = { ok: true, status: 'REFUSED', recorded: false, fallback: 'skip-finding-beads', actions: [], beads: {} };
  const nothingAsked = ({ readPr, trackerFor, tracker }) => {
    expect(readPr).not.toHaveBeenCalled();
    expect(trackerFor).not.toHaveBeenCalled();
    expect(tracker.calls).toEqual([]);
    expect(tracker.issues).toEqual([]);
  };

  test.each([
    ['another owner', 'https://github.com/Attacker/Widgets.git'],
    ['another name', 'https://github.com/Acme/Widgets-fork.git'],
    ['an owner that merely starts with it', 'git@github.com:Acme-evil/Widgets.git'],
    ['a name that merely starts with it', 'ssh://git@github.com/Acme/WidgetsX'],
  ])('a checkout of %s is REFUSED repository-mismatch: the host and the tracker are never asked and no bead is created', (_name, url) => {
    remotes(['origin', url]);
    const asked = run();
    expect(asked.result).toMatchObject({ ...REFUSED, code: 'repository-mismatch' });
    expect(asked.result.reason).toContain('not Acme/Widgets');
    nothingAsked(asked);
  });

  test.each([
    ['https', 'https://github.com/Acme/Widgets.git'],
    ['https without .git', 'https://github.com/Acme/Widgets'],
    ['https with a trailing slash', 'https://github.com/Acme/Widgets/'],
    ['https with credentials in it', ['https://ci-user', 'placeholder@github.com/Acme/Widgets.git'].join(':')],
    ['ssh', 'ssh://git@github.com/Acme/Widgets.git'],
    ['ssh with a port', 'ssh://git@github.com:22/Acme/Widgets.git'],
    ['scp-like', 'git@github.com:Acme/Widgets.git'],
    ['a different case', 'git@github.com:ACME/widgets.git'],
    ['an enterprise host', 'https://ghe.example.invalid/Acme/Widgets.git'],
  ])('a checkout whose remote is %s is the repository: the sweep goes on and records', (_name, url) => {
    remotes(['origin', url]);
    const { result, tracker } = run();
    expect(result).toMatchObject({ ok: true, status: 'RECORDED', counts: { create: 3 } });
    expect(tracker.issues).toHaveLength(3);
  });

  test('a fork checkout is REFUSED even when another remote names the repository: the origin is what the checkout is (kata mdfr review round 2)', () => {
    remotes(['origin', 'https://github.com/someone/Widgets.git'], ['upstream', 'https://github.com/Acme/Widgets.git']);
    const asked = run();
    expect(asked.result).toMatchObject({ ...REFUSED, code: 'repository-mismatch' });
    expect(asked.result.reason).toContain('someone/widgets');
    nothingAsked(asked);
  });

  test('an origin whose push URL names another repository than its fetch URL is REFUSED, whichever of the two is the repository', () => {
    for (const [fetchUrl, pushUrl] of [
      ['https://github.com/Acme/Widgets.git', 'https://github.com/attacker/Widgets.git'],
      ['https://github.com/attacker/Widgets.git', 'https://github.com/Acme/Widgets.git'],
    ]) {
      remotes(['origin', fetchUrl]);
      gitIn(fx.primary, 'remote', 'set-url', '--push', 'origin', pushUrl);
      const asked = run();
      expect(asked.result).toMatchObject({ ...REFUSED, code: 'repository-mismatch' });
      nothingAsked(asked);
    }
  });

  test.each([
    ['no remote at all', [], 'no remote named origin'],
    ['only a remote that is not called origin, even if it names the repository', [['github', 'https://github.com/Acme/Widgets.git']], 'no remote named origin'],
    ['an origin that is a local path', [['origin', '/srv/git/widgets.git']], 'not a URL that names an owner/name'],
  ])('%s is REFUSED repository-unknown, before the host or the tracker is asked', (_name, list, why) => {
    remotes(...list);
    const asked = run();
    expect(asked.result).toMatchObject({ ...REFUSED, code: 'repository-unknown' });
    expect(asked.result.reason).toContain(why);
    nothingAsked(asked);
  });

  test('a git that cannot list the remotes is REFUSED repository-unknown too, and nothing is asked', () => {
    remotes(['origin', 'https://github.com/Acme/Widgets.git']);
    const realGit = cli.defaultDeps().repoGit;
    const asked = run({}, { git: (args, options) => (args[0] === 'remote' ? { status: 128, stdout: '', stderr: 'fatal: broken' } : realGit(args, options)) });
    expect(asked.result).toMatchObject({ ...REFUSED, code: 'repository-unknown' });
    expect(asked.result.reason).toContain('could not be read');
    nothingAsked(asked);
  });

  test('a primary checkout that cannot be found is REFUSED no-primary-worktree before anything is asked', () => {
    remotes(['origin', 'https://github.com/Acme/Widgets.git']);
    const asked = run({}, { git: () => ({ status: 128, stdout: '', stderr: 'fatal: broken' }) });
    expect(asked.result).toMatchObject({ ...REFUSED, code: 'no-primary-worktree' });
    nothingAsked(asked);
  });

  test("the identity checked is the PRIMARY checkout's, which holds the tracker: a linked worktree's own remote configuration cannot stand in for it (kata mdfr review round 2)", () => {
    const own = makeRepo({ remote: 'https://github.com/attacker/Widgets.git' });
    gitIn(own.primary, 'config', 'extensions.worktreeConfig', 'true');
    gitIn(own.worktree, 'config', '--worktree', 'url.https://github.com/Acme/.insteadOf', 'https://github.com/attacker/');
    // The precondition: from the worktree the repository looks like Acme/Widgets (its own configuration rewrites the URL), from the
    // primary checkout, where the tracker is, it does not.
    expect(gitIn(own.worktree, 'remote', 'get-url', 'origin')).toBe('https://github.com/Acme/Widgets.git');
    expect(gitIn(own.primary, 'remote', 'get-url', 'origin')).toBe('https://github.com/attacker/Widgets.git');
    const tracker = fakeTracker();
    const trackerFor = jest.fn(() => tracker);
    const result = sweep(input(own), { git: cli.defaultDeps().repoGit, readPr: hostSays(own), trackerFor, env: {} });
    expect(result).toMatchObject({ ...REFUSED, code: 'repository-mismatch' });
    expect(trackerFor).not.toHaveBeenCalled();
    expect(tracker.issues).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The CLI
// ---------------------------------------------------------------------------

describe('local-ci-cli sweep', () => {
  let fx;
  beforeAll(() => {
    fx = makeRepo();
  });

  async function call(payload, over = {}) {
    let out = '';
    const tracker = over.tracker || fakeTracker();
    const deps = { ...cli.defaultDeps(), readPr: hostSays(fx), trackerFor: () => tracker, ...over, io: { readJson: () => payload, write: (s) => (out += s) } };
    const code = await cli.main(['sweep'], deps);
    return { code, body: JSON.parse(out), tracker };
  }

  test('is a subcommand, and the payload keys are the documented ones', () => {
    expect(Object.keys(cli.HANDLERS)).toContain('sweep');
    expect(cli.SWEEP_KEYS).toEqual(['facts', 'repoRoot', 'repo', 'pr', 'headSha', 'baseSha', 'dryRun']);
  });

  test('records the facts and exits 0; the same payload again creates nothing and exits 0', async () => {
    const tracker = fakeTracker();
    const first = await call(input(fx), { tracker });
    expect(first.code).toBe(0);
    expect(first.body).toMatchObject({ ok: true, status: 'RECORDED', counts: { create: 3, skip: 0, error: 0 } });
    const second = await call(input(fx), { tracker });
    expect(second.code).toBe(0);
    expect(second.body).toMatchObject({ ok: true, status: 'RECORDED', counts: { create: 0, skip: 3, error: 0 } });
    expect(tracker.writes()).toHaveLength(3);
  });

  test('a caller-supplied trackedKeys is rejected like any unknown key, and nothing is read or written', async () => {
    const readPr = jest.fn(hostSays(fx));
    const trackerFor = jest.fn(() => fakeTracker());
    // The old payload: everything the facts name is "tracked", so a sweep that honoured it would record nothing at all.
    const { code, body } = await call({ ...input(fx), trackedKeys: KEYS }, { readPr, trackerFor });
    expect(code).toBe(1);
    expect(body.error).toMatch(/sweep: unknown payload key\(s\) "trackedKeys"/);
    expect(body.error).toContain('allowed: facts, repoRoot, repo, pr, headSha, baseSha, dryRun');
    expect(readPr).not.toHaveBeenCalled();
    expect(trackerFor).not.toHaveBeenCalled();
  });

  test.each([
    ['facts', undefined],
    ['facts', 'x'],
    ['repoRoot', undefined],
    ['repoRoot', '  '],
    ['repo', 'no good'],
    ['repo', undefined],
    ['pr', 0],
    ['pr', '7'],
    ['headSha', 'abc'],
    ['baseSha', undefined],
    ['baseSha', 'main'],
  ])('%s = %p is refused before git, the host or the tracker are asked (a payload with no repoRoot never means "the current directory")', async (key, value) => {
    const readPr = jest.fn(hostSays(fx));
    const trackerFor = jest.fn(() => fakeTracker());
    const payload = input(fx);
    if (value === undefined) delete payload[key];
    else payload[key] = value;
    const { code, body } = await call(payload, { readPr, trackerFor });
    expect(code).toBe(1);
    expect(body.error).toContain(`sweep: ${key} is missing or malformed`);
    expect(readPr).not.toHaveBeenCalled();
    expect(trackerFor).not.toHaveBeenCalled();
  });

  test('dryRun must be true or false', async () => {
    const { code, body } = await call(input(fx, { dryRun: 'yes' }));
    expect(code).toBe(1);
    expect(body.error).toContain('dryRun must be true or false');
  });

  test.each([
    ['facts with no findings list', {}],
    ['facts whose failures are not a list', { findings: [], failures: 'x' }],
  ])('%s is an error before git, the host or the tracker are asked: malformed top-level input is never read as "nothing to record"', async (_name, bad) => {
    const readPr = jest.fn(hostSays(fx));
    const trackerFor = jest.fn(() => fakeTracker());
    const { code, body } = await call(input(fx, { facts: bad }), { readPr, trackerFor });
    expect(code).toBe(1);
    expect(body.error).toMatch(/facts\.(findings|failures) must be an array/);
    expect(readPr).not.toHaveBeenCalled();
    expect(trackerFor).not.toHaveBeenCalled();
  });

  test('dryRun plans and writes nothing', async () => {
    const { code, body, tracker } = await call(input(fx, { dryRun: true }));
    expect(code).toBe(0);
    expect(body).toMatchObject({ status: 'PLANNED', counts: { create: 3 } });
    expect(tracker.writes()).toEqual([]);
  });

  test('exit codes: RECORDED, PLANNED, UNAVAILABLE and REFUSED are 0; PARTIAL and FAILED are 1', async () => {
    expect((await call(input(fx), { trackerFor: () => fakeTracker({ fail: () => UNAVAILABLE }) })).code).toBe(0);
    expect((await call(input(fx), { readPr: hostSays(fx, { isCrossRepository: true }) })).code).toBe(0);
    const partial = await call(input(fx), { trackerFor: () => fakeTracker({ fail: failCreate() }) });
    expect(partial.code).toBe(1);
    expect(partial.body).toMatchObject({ ok: false, status: 'PARTIAL', counts: { create: 0, error: 3 } });
    const lookup = await call(input(fx), { trackerFor: () => fakeTracker({ fail: (c) => (c === 'tracker.find-by-key' ? { ok: false, error: { code: 'TOOL_FAILED', message: 'x' } } : null) }) });
    expect(lookup.code).toBe(1);
    expect(lookup.body).toMatchObject({ ok: false, status: 'FAILED' });
  });

  test('the default tracker deps are built for the primary checkout, untrusted, from the base commit\'s config', async () => {
    const trackerModule = require('../lib/tracker-findings');
    const spy = jest.spyOn(trackerModule, 'createToolchainDeps').mockReturnValue(fakeTracker());
    try {
      const { code } = await call(input(fx), { trackerFor: cli.defaultDeps().trackerFor });
      expect(code).toBe(0);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toMatchObject({ projectRoot: fx.primary, untrustedProjectRoot: true });
      expect(spy.mock.calls[0][0].baseConfig.text).toBe('tracker: beads\n');
    } finally {
      spy.mockRestore();
    }
  });

  test('credential-shaped text never reaches the answer: an invalid entry is not echoed, a tool message is redacted', async () => {
    const secret = FAKE_TOKEN;
    const echoed = await call(input(fx, { facts: facts([{ prNumber: 1, note: secret }]) }));
    expect(JSON.stringify(echoed.body)).not.toContain(secret);
    expect(echoed.body.invalid).toEqual([{ kind: 'finding', index: 0, reason: expect.any(String) }]);
    const trackerFor = () => fakeTracker({ fail: (c) => (c === 'tracker.create-detailed' ? { ok: false, error: { code: 'TOOL_FAILED', message: `br said ${secret}` } } : null) });
    const refused = await call(input(fx), { trackerFor });
    expect(JSON.stringify(refused.body)).not.toContain(secret);
    expect(JSON.stringify(refused.body)).toContain('[REDACTED]');
  });
});

// ---------------------------------------------------------------------------
// The real process, the real beads adapter, a stand-in `br`
// ---------------------------------------------------------------------------

/**
 * A stateful `br` on the PATH: a real-shaped workspace in a JSON file (captured shapes of br 0.6.0: `list --all` shows
 * closed beads, `create` refuses a second bead with an external reference with exit 7). It logs every call and the
 * directory it ran in.
 */
function statefulBr() {
  const dir = tempDir('local-ci-sweep-br-');
  const script = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
const log = path.join(__dirname, 'calls.log');
const stateFile = path.join(__dirname, 'state.json');
fs.appendFileSync(log, JSON.stringify({ argv, cwd: process.cwd() }) + '\\n');
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { issues: [] };
const flag = (name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; };
if (argv[0] === 'list' && argv.includes('--all')) {
  process.stdout.write(JSON.stringify({ issues: state.issues, total: state.issues.length }));
} else if (argv[0] === 'create') {
  const ref = flag('--external-ref');
  const holder = state.issues.concat(state.deleted || []).find((i) => i.external_ref === ref);
  if (holder) {
    process.stdout.write(JSON.stringify({ error: { code: 'CONFIG_ERROR', message: "Configuration error: External reference '" + ref + "' already exists on issue " + holder.id } }));
    process.exit(7);
  }
  const issue = { id: 'bd-' + (state.issues.length + 1), title: flag('--title'), description: flag('-d'), issue_type: flag('--type'), status: 'open', priority: Number(flag('-p')), labels: flag('-l').split(','), external_ref: ref };
  state.issues.push(issue);
  fs.writeFileSync(stateFile, JSON.stringify(state));
  process.stdout.write(JSON.stringify(issue));
} else {
  process.stderr.write('stand-in br: unexpected ' + argv.join(' '));
  process.exit(2);
}
`;
  fs.writeFileSync(path.join(dir, 'br'), script, { mode: 0o755 });
  const read = (name) => (fs.existsSync(path.join(dir, name)) ? fs.readFileSync(path.join(dir, name), 'utf8') : '');
  return {
    dir,
    calls: () => read('calls.log').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)),
    issues: () => (read('state.json') ? JSON.parse(read('state.json')).issues : []),
    /** Delete the bead with this external reference the way br does: it leaves `list --all`, and its key stays taken. */
    remove(ref) {
      const state = JSON.parse(read('state.json'));
      state.deleted = (state.deleted || []).concat(state.issues.filter((i) => i.external_ref === ref));
      state.issues = state.issues.filter((i) => i.external_ref !== ref);
      fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state));
    },
  };
}

describe('through the real process: the real entry point, the real adapter, a stand-in br', () => {
  let fx;
  beforeAll(() => {
    fx = makeRepo();
  });

  const sweepProcess = (payload, br, host) => {
    const gh = fakeGhDir({ isCrossRepository: false, headRefOid: fx.head, baseRefName: 'main', baseRefOid: fx.merged, state: 'MERGED', ...host });
    const env = { ...process.env, PATH: [gh, br.dir, process.env.PATH].join(path.delimiter) };
    // Run from a directory that is not a repository: nothing may be taken from the current directory.
    const r = spawnSync(process.execPath, [CLI_PATH, 'sweep'], { input: JSON.stringify(payload), encoding: 'utf8', env, cwd: fx.sandbox });
    return { status: r.status, body: JSON.parse(r.stdout), stderr: r.stderr };
  };

  test('the first sweep records every entry, the second creates nothing, and every br call ran in the primary checkout', () => {
    const br = statefulBr();
    const first = sweepProcess(input(fx), br);
    expect(first.status).toBe(0);
    expect(first.body).toMatchObject({ ok: true, status: 'RECORDED', counts: { create: 3, skip: 0, error: 0 } });
    expect(br.issues().map((issue) => issue.external_ref)).toEqual(KEYS);
    expect(br.issues()[0]).toMatchObject({ issue_type: 'task', priority: 2, labels: [SWEEP_LABEL, 'bot-finding'] });
    expect(br.calls().map((c) => c.argv[0])).toEqual(['list', 'create', 'create', 'create']);

    const second = sweepProcess(input(fx), br);
    expect(second.status).toBe(0);
    expect(second.body).toMatchObject({ ok: true, status: 'RECORDED', counts: { create: 0, skip: 3, error: 0 } });
    expect(br.issues()).toHaveLength(3);
    // The second sweep only listed.
    expect(br.calls().slice(4).map((c) => c.argv[0])).toEqual(['list']);

    // The head committed a toolchain config naming a tracker that does not exist: it was not the head's tree that decided.
    expect(br.calls().every((c) => fs.realpathSync(c.cwd) === fx.primary)).toBe(true);
  });

  test('a bead that was deleted keeps its key: later sweeps skip it (held-not-listed) instead of being PARTIAL for good', () => {
    const br = statefulBr();
    expect(sweepProcess(input(fx), br).body).toMatchObject({ status: 'RECORDED', counts: { create: 3 } });
    br.remove(KEYS[1]);
    for (let round = 0; round < 2; round += 1) {
      const swept = sweepProcess(input(fx), br);
      expect(swept.status).toBe(0);
      expect(swept.body).toMatchObject({ ok: true, status: 'RECORDED', counts: { create: 0, skip: 3, error: 0 } });
      expect(swept.body.beads[KEYS[1]]).toEqual({ kind: 'finding', action: 'skip', reason: 'held-not-listed' });
    }
    expect(br.issues().map((issue) => issue.external_ref)).toEqual([KEYS[0], KEYS[2]]);
  });

  test("a pull request of another repository than the checkout's is REFUSED repository-mismatch: exit 0, the fallback, br never run (kata mdfr review F1)", () => {
    const br = statefulBr();
    const refused = sweepProcess(input(fx, { repo: 'Acme/Other' }), br);
    expect(refused.status).toBe(0);
    expect(refused.body).toMatchObject({ status: 'REFUSED', code: 'repository-mismatch', fallback: 'skip-finding-beads' });
    expect(br.calls()).toEqual([]);
    expect(br.issues()).toEqual([]);
  });

  test('a refusal exits 0 with the fallback and br is never run', () => {
    const br = statefulBr();
    const refused = sweepProcess(input(fx), br, { isCrossRepository: true });
    expect(refused.status).toBe(0);
    expect(refused.body).toMatchObject({ status: 'REFUSED', code: 'cross-repository-head', fallback: 'skip-finding-beads' });
    expect(br.calls()).toEqual([]);
  });

  test('a repository whose primary checkout has no tracker workspace is UNAVAILABLE: skipped, said so, nothing run', () => {
    const br = statefulBr();
    const bare = makeRepo();
    fs.rmSync(path.join(bare.primary, '.beads'), { recursive: true });
    const payload = input(bare);
    const gh = fakeGhDir({ isCrossRepository: false, headRefOid: bare.head, baseRefName: 'main', baseRefOid: bare.merged, state: 'MERGED' });
    const env = { ...process.env, PATH: [gh, br.dir, process.env.PATH].join(path.delimiter) };
    const r = spawnSync(process.execPath, [CLI_PATH, 'sweep'], { input: JSON.stringify(payload), encoding: 'utf8', env, cwd: bare.sandbox });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, status: 'UNAVAILABLE', recorded: false, fallback: 'skip-finding-beads' });
    expect(br.calls()).toEqual([]);
  });

  test('an old-style payload (trackedKeys, no repoRoot) is refused with exit 1 and nothing is recorded', () => {
    const br = statefulBr();
    const r = sweepProcess({ facts: FACTS, trackedKeys: [] }, br);
    expect(r.status).toBe(1);
    expect(r.body.error).toContain('unknown payload key(s) "trackedKeys"');
    expect(br.calls()).toEqual([]);
  });

  test('an entry with no readable id whose body quotes credentials: exit 1, PARTIAL, and no credential on stdout or stderr (kata mdfr review round 2)', () => {
    const br = statefulBr();
    const stripe = ['sk', 'live', 'A1b2C3d4E5f6G7h8I9j0K1'].join('_');
    const glpat = ['glpat', 'A1b2C3d4E5f6G7h8I9j0K1'].join('-');
    const unsignedJwt = ['eyJhbGciOiJub25lIn0', 'eyJzdWIiOiJ4In0', ''].join('.');
    const quoting = { findings: [{ prNumber: 12, body: `leaked ${stripe} ${glpat} ${unsignedJwt}`, author: stripe }], failures: [] };
    const r = sweepProcess(input(fx, { facts: quoting }), br);
    expect(r.status).toBe(1);
    expect(r.body).toMatchObject({ ok: false, status: 'PARTIAL', counts: { create: 0, skip: 0, error: 1 } });
    expect(r.body.invalid).toEqual([{ kind: 'finding', index: 0, reason: expect.stringContaining('no readable commentId') }]);
    for (const secret of [stripe, glpat, unsignedJwt, 'leaked']) {
      expect(JSON.stringify(r.body)).not.toContain(secret);
      expect(r.stderr).not.toContain(secret);
    }
    expect(br.calls()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The instructions that drive it
// ---------------------------------------------------------------------------

describe('the instructions that drive the sweep agree with the code', () => {
  const { COMMAND: PR_MERGE, SKILL_TEXT } = require('./helpers/pr-merge-skill');
  const REPO_ROOT = path.resolve(__dirname, '../../..');
  const SKILL_DIR = 'packages/development/skills/local-ci-gate';
  const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
  const SWEEP_DOC = read(`${SKILL_DIR}/SWEEP.md`);
  const SKILL = read(`${SKILL_DIR}/SKILL.md`);
  // The pr-merge prompt lives in its skill (the command YAML is a manifest with no prompt).
  const COMMAND = SKILL_TEXT;
  const mergeActions = PR_MERGE.workflow.phases.find((p) => p.name === 'Merge and Report').steps.find((s) => s.title === 'Merge').actions;
  const sweepActions = mergeActions.filter((a) => /local-ci-cli\.js sweep/.test(a));

  test('SWEEP.md documents exactly the payload keys the CLI accepts, in order', () => {
    const callSection = SWEEP_DOC.slice(SWEEP_DOC.indexOf('## Call'), SWEEP_DOC.indexOf('## Facts'));
    expect([...callSection.matchAll(/^\| `(\w+)` \|/gm)].map((m) => m[1])).toEqual(cli.SWEEP_KEYS);
  });

  test('SWEEP.md names exactly the statuses the sweep can answer', () => {
    const fx = makeRepo();
    const answered = new Set([
      recordSweep(FACTS, fakeTracker(), OPTIONS).status,
      recordSweep(FACTS, fakeTracker(), { ...OPTIONS, dryRun: true }).status,
      recordSweep(FACTS, fakeTracker({ fail: () => UNAVAILABLE }), OPTIONS).status,
      recordSweep(facts([{ prNumber: 1 }]), fakeTracker(), OPTIONS).status,
      recordSweep(FACTS, fakeTracker({ fail: (c) => (c === 'tracker.find-by-key' ? { ok: false, error: { code: 'TOOL_FAILED', message: 'x' } } : null) }), OPTIONS).status,
      sweep(input(fx), { git: cli.defaultDeps().repoGit, readPr: hostSays(fx, { isCrossRepository: true }), trackerFor: () => fakeTracker(), env: {} }).status,
    ]);
    expect([...answered].sort()).toEqual(['FAILED', 'PARTIAL', 'PLANNED', 'RECORDED', 'REFUSED', 'UNAVAILABLE']);
    const documented = [...SWEEP_DOC.matchAll(/^\| `([A-Z]+)` \|/gm)].map((m) => m[1]);
    expect(documented.sort()).toEqual([...answered].sort());
  });

  test('pr-merge runs the sweep before and after the merge, points BOTH at SWEEP.md with the report rule, and passes dryRun only where a dry run can reach (kata mdfr review F4)', () => {
    expect(sweepActions).toHaveLength(2);
    const [before, after] = sweepActions;
    for (const action of sweepActions) {
      expect(action).toContain('SWEEP.md');
      expect(action).toMatch(/Beads[^"]*\(br\)/);
    }
    expect(before).toContain('dryRun:true if dry-run');
    expect(before).toContain('report any status but RECORDED; never blocks the merge');
    // The post-merge action names the same report rule instead of repeating it, and SWEEP.md states it.
    expect(after).toContain('report rule');
    expect(SWEEP_DOC).toContain('Report any status but `RECORDED`');
    // After the merge there is no dry run: the run stopped before it.
    expect(after).not.toContain('dryRun');
  });

  test('the pre-merge sweep sits before the merge, the post-merge sweep after it and before the source branch is deleted', () => {
    const at = (re) => mergeActions.findIndex((a) => re.test(a));
    const [before, after] = sweepActions.map((a) => mergeActions.indexOf(a));
    expect(at(/^Merge: run node/)).toBeGreaterThan(-1);
    expect(before).toBeLessThan(at(/^Merge: run node/));
    expect(at(/^Merge: run node/)).toBeLessThan(after);
    expect(after).toBeLessThan(at(/delete the source branch unless it is long-lived/));
  });

  test('SWEEP.md documents what this sweep adds to the recorder it reuses: the repository binding, held-not-listed, unverified facts', () => {
    for (const text of ['repository-mismatch', 'repository-unknown', 'held-not-listed', 'claims the caller read']) {
      expect(SWEEP_DOC).toContain(text);
    }
    // What `head-checked-out` really checks (the primary's HEAD contains the head), not "keep the primary on the base branch".
    expect(SWEEP_DOC).toMatch(/whose HEAD\s+already contains the head/);
    // Wrapped lines do not matter: the statements are read with the whitespace collapsed.
    const flat = SWEEP_DOC.replace(/\s+/g, ' ');
    for (const text of [
      'its `origin` remote, every fetch and push URL of it, names `repo`',
      'a checkout of a fork is one, whatever other remote names `repo`',
      'REFUSED `no-primary-worktree`',
      'never recreates a deleted bead',
      'its text is never echoed',
      'or a `PLANNED` dry run that already holds an error',
      '`REFUSED` and `UNAVAILABLE` included',
    ]) {
      expect(flat).toContain(text);
    }
  });

  test('SKILL.md points at SWEEP.md, which sits beside it, and nothing carries the old contract', () => {
    expect(SKILL).toContain('`SWEEP.md`');
    expect(SKILL).not.toMatch(/`sweep` lists/);
    for (const text of [SKILL, COMMAND, ...sweepActions]) expect(text).not.toContain('trackedKeys');
  });
});
