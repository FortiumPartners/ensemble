'use strict';

/**
 * Tests for the bead recorder's executor and CLI (packages/development/lib/pr-review-beads-cli.js,
 * kata n350, plan 3H item 1 and acceptance tests (b) and (d)).
 *
 * The tracker is an in-memory stand-in for `br` that keeps the behaviours the recorder depends on:
 * an external reference is unique across the whole workspace and `create` refuses a second bead
 * with it, `update` appends notes, `label` only adds, and `close` records its reason and commit.
 * The real beads adapter and a real `br` are exercised by scripts/tests/tracker-findings.test.js
 * (replayed captured output) and by the smoke run recorded in the kata comment.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const { main, recordBeads } = require('../lib/pr-review-beads-cli');
const { evaluateGate } = require('../lib/pr-review-gate');
const { buildDispositionChoices, COLLAPSE_THRESHOLD } = require('../lib/pr-review-disposition');

const HEAD = 'a'.repeat(40);
const NEXT_HEAD = 'b'.repeat(40);
const FIX_COMMIT = 'c'.repeat(40);

function finding(overrides = {}) {
  return {
    id: 'F-1',
    source: 'code-reviewer',
    locationOrLink: 'src/widget.js:12',
    severity: 'important',
    failureMode: 'Unchecked path join',
    disposition: 'fix',
    evidence: 'line 12 joins user input',
    originalTextOrLink: 'https://example.invalid/pr/1#r1',
    ...overrides,
  };
}

const nits = (count, file = 'src/same.js') =>
  Array.from({ length: count }, (_, i) => finding({ id: `N-${i + 1}`, severity: 'nit', locationOrLink: `${file}:${i + 1}`, failureMode: `nit number ${i + 1}` }));

function payload(ledger, extra = {}) {
  return { repo: 'Acme/Widgets', prNumber: 7, headSha: HEAD, ledger, ...extra };
}

const WRITES = ['tracker.create-detailed', 'tracker.update-detailed', 'tracker.close-with-reason', 'tracker.label', 'tracker.set-status'];

/** An in-memory `br`: the deps `recordBeads` runs against. */
function fakeTracker({ fail = () => null } = {}) {
  const issues = [];
  const calls = [];
  const byId = (id) => issues.find((issue) => issue.id === id);
  return {
    issues,
    calls,
    writes: () => calls.filter((c) => WRITES.includes(c.capability)),
    run(capability, args) {
      calls.push({ capability, args });
      const failure = fail(capability, args);
      if (failure) return failure;
      switch (capability) {
        case 'tracker.find-by-key':
          return { ok: true, data: JSON.stringify({ issues: JSON.parse(JSON.stringify(issues)) }) };
        case 'tracker.create-detailed': {
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
            notes: '',
          };
          issues.push(issue);
          return { ok: true, data: { id: issue.id } };
        }
        case 'tracker.update-detailed': {
          const issue = byId(args.id);
          Object.assign(issue, { title: args.title, description: args.description, priority: Number(args.priority) });
          issue.notes += `${args.notes}\n`;
          return { ok: true, data: { id: issue.id } };
        }
        case 'tracker.close-with-reason': {
          const issue = byId(args.id);
          issue.status = 'closed';
          issue.close_reason = args.reason;
          issue.close_comment = `closed at commit ${args.commit}`;
          return { ok: true, data: { id: issue.id, status: 'closed' } };
        }
        case 'tracker.label': {
          const issue = byId(args.ids);
          for (const label of args.labels.split(',')) if (!issue.labels.includes(label)) issue.labels.push(label);
          return { ok: true, data: {} };
        }
        case 'tracker.set-status': {
          // What `br update --status open` does to a closed bead: it is open again and its close reason is gone.
          const issue = byId(args.id);
          issue.status = args.status;
          if (args.status === 'open') {
            delete issue.close_reason;
            delete issue.close_comment;
          }
          return { ok: true, data: { id: issue.id, status: issue.status } };
        }
        default:
          throw new Error(`unexpected capability ${capability}`);
      }
    },
  };
}

const UNAVAILABLE = { ok: false, unavailable: true, error: { code: 'UNAVAILABLE', message: "tracker is unavailable: no '.beads' workspace" } };

describe('re-review updates beads and creates none for an unchanged finding (acceptance test b)', () => {
  const ledger = [finding(), finding({ id: 'F-2', severity: 'nit', locationOrLink: 'src/other.js:3', failureMode: 'stray log' })];

  test('first review creates one bead per finding; the same review again writes nothing', () => {
    const tracker = fakeTracker();
    const first = recordBeads(payload(ledger), tracker);
    expect(first).toMatchObject({ ok: true, status: 'RECORDED', recorded: true, counts: { create: 2 } });
    expect(tracker.issues).toHaveLength(2);
    expect(tracker.issues[0]).toMatchObject({ labels: ['pr-review'], priority: 1, issue_type: 'bug' });
    expect(first.beads['F-1'].beadId).toBe('bd-1');
    expect(first.beads['F-2'].beadId).toBe('bd-2');

    const writesBefore = tracker.writes().length;
    const again = recordBeads(payload(ledger), tracker);
    expect(again).toMatchObject({ ok: true, status: 'RECORDED', counts: { create: 0, update: 0, close: 0, skip: 2 } });
    expect(tracker.writes()).toHaveLength(writesBefore);
    expect(again.beads['F-1'].beadId).toBe('bd-1');
  });

  test('a later head of the same PR updates the same beads, appends one note each, and creates none', () => {
    const tracker = fakeTracker();
    recordBeads(payload(ledger), tracker);
    const later = recordBeads(payload(ledger, { headSha: NEXT_HEAD }), tracker);
    expect(later).toMatchObject({ ok: true, counts: { create: 0, update: 2 } });
    expect(tracker.issues).toHaveLength(2);
    expect(tracker.issues[0].description).toContain(`at head ${NEXT_HEAD}`);
    expect(tracker.issues[0].notes).toBe(`Re-confirmed at head ${NEXT_HEAD} (PR #7): 1 location.\n`);
    expect(tracker.calls.filter((c) => c.capability === 'tracker.create-detailed')).toHaveLength(2);
  });

  test('another PR raising the same claim in the same file updates that bead, and the note names the record it replaced', () => {
    const tracker = fakeTracker();
    recordBeads(payload(ledger), tracker);
    const other = recordBeads(payload(ledger, { headSha: NEXT_HEAD, prNumber: 8 }), tracker);
    expect(other).toMatchObject({ ok: true, counts: { create: 0, update: 2 } });
    expect(tracker.issues).toHaveLength(2);
    expect(tracker.issues[0].description).toContain(`PR #8 at head ${NEXT_HEAD}`);
    expect(tracker.issues[0].notes).toBe(
      `Re-confirmed at head ${NEXT_HEAD} (PR #8): 1 location. Replaces the description's earlier record: acme/widgets PR #7 at head ${HEAD}.\n`
    );
  });

  test('the tracker is asked once for every key, however many findings there are', () => {
    const tracker = fakeTracker();
    recordBeads(payload([...ledger, ...nits(COLLAPSE_THRESHOLD + 3)]), tracker);
    expect(tracker.calls.filter((c) => c.capability === 'tracker.find-by-key')).toHaveLength(1);
  });

  test('a collapsed file is one bead that later heads update in place', () => {
    const tracker = fakeTracker();
    recordBeads(payload(nits(COLLAPSE_THRESHOLD + 2)), tracker);
    expect(tracker.issues).toHaveLength(1);
    expect(tracker.issues[0].title).toBe(`[nit] src/same.js: ${COLLAPSE_THRESHOLD + 2} Nit findings (collapsed)`);
    const later = recordBeads(payload(nits(COLLAPSE_THRESHOLD + 1), { headSha: NEXT_HEAD }), tracker);
    expect(later.counts).toMatchObject({ create: 0, update: 1 });
    expect(tracker.issues).toHaveLength(1);
    expect(tracker.issues[0].title).toContain(`${COLLAPSE_THRESHOLD + 1} Nit findings`);
  });

  test('a review with no findings at all records nothing and never touches the tracker', () => {
    const tracker = fakeTracker();
    expect(recordBeads(payload([]), tracker)).toMatchObject({ ok: true, status: 'RECORDED', counts: { create: 0 } });
    expect(tracker.calls).toEqual([]);
  });
});

describe('a finding verified fixed at a later head closes its bead with the commit (AC2)', () => {
  test('the bead is closed with a reason and the verified commit; an already closed bead is not touched again', () => {
    const tracker = fakeTracker();
    recordBeads(payload([finding()]), tracker);

    const fixed = payload([finding({ cleared: true, clearedBy: FIX_COMMIT })], { headSha: NEXT_HEAD, commitsOnPr: [FIX_COMMIT] });
    const result = recordBeads(fixed, tracker);
    expect(result).toMatchObject({ ok: true, status: 'RECORDED', counts: { close: 1, create: 0 } });
    expect(tracker.issues[0]).toMatchObject({ status: 'closed', close_comment: `closed at commit ${FIX_COMMIT}` });
    expect(tracker.issues[0].close_reason).toContain('PR #7');
    // The bead is closed now, so it is reported as closed and never as an open bead.
    expect(result.beads['F-1']).toMatchObject({ action: 'close', closedBeadId: 'bd-1' });
    expect(result.beads['F-1'].beadId).toBeUndefined();
    expect(result.actions[0]).toMatchObject({ action: 'close', closedBeadId: 'bd-1' });

    const writes = tracker.writes().length;
    expect(recordBeads(fixed, tracker).counts).toMatchObject({ close: 0, skip: 1 });
    expect(tracker.writes()).toHaveLength(writes);
  });

  test('a cleared mark whose commit nobody verified closes nothing', () => {
    const tracker = fakeTracker();
    recordBeads(payload([finding()]), tracker);
    const result = recordBeads(payload([finding({ cleared: true, clearedBy: FIX_COMMIT })], { headSha: NEXT_HEAD }), tracker);
    expect(result).toMatchObject({ ok: true, counts: { close: 0 } });
    expect(result.beads['F-1']).toMatchObject({ action: 'skip', reason: 'cleared-unverified' });
    expect(tracker.issues[0].status).toBe('open');
  });

  test('a finding that is only missing from the next review leaves its bead open', () => {
    const tracker = fakeTracker();
    recordBeads(payload([finding()]), tracker);
    recordBeads(payload([finding({ id: 'F-9', failureMode: 'something unrelated' })], { headSha: NEXT_HEAD }), tracker);
    expect(tracker.issues[0].status).toBe('open');
  });

  test('a bead this recorder closed as fixed is reopened, rewritten and noted when the finding comes back', () => {
    const tracker = fakeTracker();
    recordBeads(payload([finding()]), tracker);
    recordBeads(payload([finding({ cleared: true, clearedBy: FIX_COMMIT })], { headSha: NEXT_HEAD, commitsOnPr: [FIX_COMMIT] }), tracker);
    expect(tracker.issues[0].status).toBe('closed');

    const third = 'd'.repeat(40);
    const back = recordBeads(payload([finding({ id: 'F-9', locationOrLink: 'src/widget.js:40' })], { headSha: third }), tracker);
    expect(back).toMatchObject({ ok: true, status: 'RECORDED', counts: { update: 1, create: 0 } });
    expect(tracker.issues).toHaveLength(1);
    expect(tracker.issues[0]).toMatchObject({ status: 'open' });
    expect(tracker.issues[0].description).toContain('src/widget.js:40');
    expect(tracker.issues[0].notes).toContain(`Reopened at head ${third}`);
    expect(back.beads['F-9']).toMatchObject({ action: 'update', reason: 'reopened', beadId: 'bd-1' });
    expect(back.beads['F-9'].closedBeadId).toBeUndefined();
    expect(tracker.calls.filter((c) => c.capability === 'tracker.set-status')).toEqual([{ capability: 'tracker.set-status', args: { id: 'bd-1', status: 'open' } }]);
  });

  test('a bead a person closed stays closed and is reported as closed, never as an open bead', () => {
    const tracker = fakeTracker();
    recordBeads(payload([finding()]), tracker);
    tracker.issues[0].status = 'closed';
    tracker.issues[0].close_reason = 'wontfix: by design';
    const result = recordBeads(payload([finding()], { headSha: NEXT_HEAD }), tracker);
    expect(result).toMatchObject({ ok: true, status: 'RECORDED', counts: { create: 0, update: 0, close: 0, skip: 1 } });
    expect(result.beads['F-1']).toMatchObject({ action: 'skip', reason: 'bead-closed', closedBeadId: 'bd-1' });
    expect(result.beads['F-1'].beadId).toBeUndefined();
    expect(result.actions[0].beadId).toBeUndefined();
    expect(tracker.issues[0].status).toBe('closed');
    expect(tracker.calls.some((c) => c.capability === 'tracker.set-status')).toBe(false);
  });
});

describe('follow-on is applied to the beads the operator named, after the fact too', () => {
  test('choosing follow-on once the beads exist adds the label to the existing bead and nothing else', () => {
    const tracker = fakeTracker();
    const ledger = [finding({ id: 'A', failureMode: 'claim a' }), finding({ id: 'B', failureMode: 'claim b' })];
    recordBeads(payload(ledger), tracker);
    const before = JSON.stringify(tracker.issues[0].description);

    const result = recordBeads(payload(ledger, { followOnIds: ['A'] }), tracker);
    expect(result.counts).toMatchObject({ update: 1, create: 0 });
    expect(tracker.issues[0].labels).toEqual(['pr-review', 'follow-on']);
    expect(tracker.issues[1].labels).toEqual(['pr-review']);
    expect(JSON.stringify(tracker.issues[0].description)).toBe(before);
    expect(tracker.calls.filter((c) => c.capability === 'tracker.update-detailed')).toHaveLength(0);
  });
});

describe('--foreman / non-interactive: beads are recorded, nothing is fixed or decided, the gate still refuses (acceptance test d, unit level)', () => {
  function gateInput(ledger) {
    return {
      headSha: HEAD,
      ledger,
      approvals: {
        ok: true, headSha: HEAD, satisfied: true, reason: 'required-approvals-present', tier: 'medium', humansRequired: 1,
        humansCounted: 1, approvedBy: ['human-a'], directedBy: null, ignored: [], refusals: [], reasons: [], warnings: [],
      },
      tier: { ok: true, tier: 'medium', effectiveTier: 'medium', humansRequired: 1, refusals: [], reasons: [], warnings: [] },
      description: { ok: true, missing: [], present: ['testing', 'risk', 'rollback'], empty: [], ready: true, warnings: [] },
      security: { status: 'clean', findings: [] },
    };
  }

  const deepFreeze = (value) => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(deepFreeze);
      Object.freeze(value);
    }
    return value;
  };

  test('a blocking Important finding gets its bead, the ledger is untouched, and the gate is still not mergeable', () => {
    const ledger = deepFreeze([finding(), finding({ id: 'N-1', severity: 'nit', locationOrLink: 'src/n.js:1', failureMode: 'a nit' })]);
    expect(evaluateGate(gateInput(ledger)).mergeable).toBe(false);

    const tracker = fakeTracker();
    const result = recordBeads(payload(ledger), tracker);
    expect(result.status).toBe('RECORDED');

    // Only the tracker was touched: no other capability, no fix, nothing that could decide a finding.
    expect(new Set(tracker.calls.map((c) => c.capability))).toEqual(new Set(['tracker.find-by-key', 'tracker.create-detailed']));
    // The ledger is exactly what it was: no resolution, no cleared mark (it is frozen, so a write would have thrown).
    expect(ledger.every((f) => f.resolution === undefined && f.cleared === undefined && f.beadId === undefined)).toBe(true);

    // The caller records the bead ids on the findings and asks the gate again: still refused.
    const withBeads = ledger.map((f) => ({ ...f, beadId: result.beads[f.id].beadId }));
    const verdict = evaluateGate(gateInput(withBeads));
    expect(verdict.mergeable).toBe(false);
    expect(verdict.findings.open).toEqual(['F-1']);

    // And the operator's list shows both findings, each with its bead.
    const list = buildDispositionChoices({ ledger: withBeads, headSha: HEAD });
    expect(list.ok).toBe(true);
    expect(list.dispositionChoices.map((e) => [e.id, e.beadId])).toEqual([['F-1', 'bd-1'], ['N-1', 'bd-2']]);
    expect(list.mergeConfirmation).toMatchObject({ openBeads: 2, findingsWithoutBead: 0, undecidedBlocking: ['F-1'] });
  });
});

describe('a repository with no usable tracker skips the beads, and the list is still shown', () => {
  test('an unavailable tracker is UNAVAILABLE with the skip fallback, exit-clean, and nothing was written', () => {
    const calls = [];
    const deps = { run: (capability) => (calls.push(capability), UNAVAILABLE) };
    const ledger = [finding()];
    const result = recordBeads(payload(ledger), deps);
    expect(result).toMatchObject({ ok: true, status: 'UNAVAILABLE', recorded: false, fallback: 'skip-finding-beads', beads: {} });
    expect(result.reason).toContain('no \'.beads\' workspace');
    expect(calls).toEqual(['tracker.find-by-key']);

    const list = buildDispositionChoices({ ledger, headSha: HEAD });
    expect(list.ok).toBe(true);
    expect(list.mergeConfirmation).toMatchObject({ openBeads: 0, findingsWithoutBead: 1 });
  });

  test('an adapter that finds beads but cannot create them is UNAVAILABLE, not a half-recorded run', () => {
    const tracker = fakeTracker({ fail: (capability) => (capability === 'tracker.create-detailed' ? UNAVAILABLE : null) });
    const result = recordBeads(payload([finding()]), tracker);
    expect(result).toMatchObject({ ok: true, status: 'UNAVAILABLE', recorded: false, fallback: 'skip-finding-beads' });
    expect(tracker.issues).toEqual([]);
  });
});

describe('failures are reported, never swallowed', () => {
  test('a tracker that cannot be read fails the run before any write', () => {
    const tracker = fakeTracker({ fail: (capability) => (capability === 'tracker.find-by-key' ? { ok: false, error: { code: 'TOOL_FAILED', message: 'br exploded' } } : null) });
    const result = recordBeads(payload([finding()]), tracker);
    expect(result).toMatchObject({ ok: false, status: 'FAILED', recorded: false });
    expect(result.reason).toContain('br exploded');
    expect(tracker.writes()).toEqual([]);
  });

  test('one failing create does not stop the others, and the run is PARTIAL with the failure named', () => {
    const tracker = fakeTracker({ fail: (capability, args) => (capability === 'tracker.create-detailed' && /boom/.test(args.title) ? { ok: false, error: { code: 'TOOL_FAILED', message: 'disk full' } } : null) });
    const ledger = [finding({ id: 'A', failureMode: 'claim a' }), finding({ id: 'B', failureMode: 'boom claim' }), finding({ id: 'C', failureMode: 'claim c' })];
    const result = recordBeads(payload(ledger), tracker);
    expect(result).toMatchObject({ ok: false, status: 'PARTIAL', recorded: false });
    expect(tracker.issues).toHaveLength(2);
    const failed = result.actions.filter((a) => a.ok === false);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ findingIds: ['B'], error: { code: 'TOOL_FAILED', message: 'disk full' } });
    expect(result.beads.A.beadId).toBe('bd-1');
    expect(result.beads.B.beadId).toBeUndefined();
    expect(result.beads.C.beadId).toBe('bd-2');
  });

  test('two beads sharing a key make that finding an error and write nothing for it; the rest are recorded', () => {
    const tracker = fakeTracker();
    recordBeads(payload([finding({ id: 'A', failureMode: 'claim a' })]), tracker);
    tracker.issues.push({ ...tracker.issues[0], id: 'bd-dup' });
    const ledger = [finding({ id: 'A', failureMode: 'claim a' }), finding({ id: 'B', failureMode: 'claim b' })];
    const result = recordBeads(payload(ledger, { headSha: NEXT_HEAD }), tracker);
    expect(result).toMatchObject({ ok: false, status: 'PARTIAL' });
    expect(result.actions.find((a) => a.findingIds.includes('A'))).toMatchObject({ action: 'error', reason: 'ambiguous-key' });
    expect(tracker.issues.find((i) => i.title.includes('claim b'))).toBeDefined();
    expect(tracker.issues[0].notes).toBe('');
  });

  test('bad input is FAILED with a reason and the tracker is never called', () => {
    const tracker = fakeTracker();
    for (const bad of [{ ...payload([finding()]), repo: 'a b' }, { ...payload([finding()]), headSha: 'main' }, { ...payload([finding()]), ledger: 'x' }]) {
      const result = recordBeads(bad, tracker);
      expect(result).toMatchObject({ ok: false, status: 'FAILED', recorded: false });
    }
    expect(tracker.calls).toEqual([]);
  });
});

describe('dryRun', () => {
  test('plans and reports the actions and changes nothing', () => {
    const tracker = fakeTracker();
    const result = recordBeads(payload([finding()]), tracker, { dryRun: true });
    expect(result).toMatchObject({ ok: true, status: 'PLANNED', recorded: false, counts: { create: 1 } });
    expect(result.actions[0].create.title).toContain('Unchecked path join');
    expect(tracker.writes()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A REAL repository: what the trust checks and the fix verification read
// ---------------------------------------------------------------------------

// The fixture repositories must never see a GIT_* variable (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, ...) of the process that
// runs the tests.
const GIT_ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_TERMINAL_PROMPT: '0' };
const gitIn = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV }).trim();
const numbered = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
const CLEAR_CLI = path.join(__dirname, '..', 'lib', 'pr-review-clear-cli.js');
const sandboxes = [];

afterAll(() => {
  while (sandboxes.length) fs.rmSync(sandboxes.pop(), { recursive: true, force: true });
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
 * A repository the recorder reads for real. The PRIMARY checkout is on `main`: `root` is a commit with
 * no toolchain config, `base` adds the config (`tracker: beads`) and a `.beads` directory. The PR branch
 * `pr` is checked out in a LINKED worktree (the head under review) with three commits: `p1` adds
 * src/widget.js, `p2` edits its line 12 (the fix), and `p3` is a hostile head that commits a toolchain
 * config naming a tracker that does not exist.
 */
function makeRepo({ remote = 'https://github.com/Acme/Widgets.git' } = {}) {
  const sandbox = tempDir('pr-review-beads-repo-');
  const primary = path.join(sandbox, 'primary');
  fs.mkdirSync(primary);
  gitIn(primary, 'init', '-q', '-b', 'main');
  // The primary checkout's `origin` is the repository the recorder is bound to (`Acme/Widgets`, the payload's `repo`).
  if (remote !== null) gitIn(primary, 'remote', 'add', 'origin', remote);
  gitIn(primary, 'config', 'user.name', 'ci');
  gitIn(primary, 'config', 'user.email', 'ci@example.invalid');
  gitIn(primary, 'config', 'commit.gpgsign', 'false');
  writeFile(primary, 'README.md', 'root\n');
  const root = commitAll(primary, 'root');
  writeFile(primary, '.ensemble/toolchain.yaml', 'tracker: beads\n');
  writeFile(primary, '.beads/config.yaml', 'prefix: bd\n');
  const base = commitAll(primary, 'base');
  const worktree = path.join(sandbox, 'pr-worktree');
  gitIn(primary, 'worktree', 'add', '-q', '-b', 'pr', worktree, base);
  writeFile(worktree, 'src/widget.js', numbered(30));
  const p1 = commitAll(worktree, 'p1');
  writeFile(worktree, 'src/widget.js', numbered(30).replace('line 12\n', 'line 12 fixed\n'));
  const p2 = commitAll(worktree, 'p2');
  writeFile(worktree, '.ensemble/toolchain.yaml', 'tracker: no-such-tracker\n');
  const p3 = commitAll(worktree, 'p3');
  return { sandbox, primary, worktree, root, base, p1, p2, p3 };
}

/** A `br` on the PATH that logs the directory every call ran in and answers the two calls a first record needs. */
function fakeBr() {
  const dir = tempDir('pr-review-beads-br-');
  const log = path.join(dir, 'calls.log');
  const script = `#!/usr/bin/env node
const fs = require('fs');
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv, cwd: process.cwd() }) + '\\n');
if (argv[0] === 'list') process.stdout.write(JSON.stringify({ issues: [] }));
else if (argv[0] === 'create') process.stdout.write(JSON.stringify({ id: 'bd-1', title: 't', status: 'open' }));
else { process.stderr.write('fake br: unexpected ' + argv[0]); process.exit(2); }
`;
  fs.writeFileSync(path.join(dir, 'br'), script, { mode: 0o755 });
  return {
    calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []),
    env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}` },
  };
}

describe('main(): the process entry point', () => {
  let fx;
  beforeAll(() => {
    fx = makeRepo();
  });

  const mainPayload = (ledger, extra = {}) => ({ ...payload(ledger, { headSha: fx.p3 }), baseSha: fx.base, repoRoot: fx.worktree, ...extra });
  /** What the host says about the PR: a head on this repository, the head under review, and the base branch's tip. */
  const hostSays = (over = {}) => () => ({ ok: true, isCrossRepository: false, headRefOid: fx.p3, baseRefName: 'main', baseRefOid: fx.base, state: 'OPEN', ...over });

  function run(body, io = {}) {
    const out = [];
    const code = main({ readJson: () => body, emit: (value) => out.push(value), now: () => 0, readPr: hostSays(), ...io });
    return { code, out: out[0] };
  }

  test('records through the injected tracker, exits 0, and stores the state report as a repository-relative path', () => {
    const tracker = fakeTracker();
    const { code, out } = run(mainPayload([finding()]), { deps: tracker });
    expect(code).toBe(0);
    expect(out).toMatchObject({ ok: true, status: 'RECORDED', wallMs: 0 });
    const { description } = tracker.issues[0];
    expect(description).toContain('State report: .ensemble/pr-review/pr-7.json');
    // Nothing of this machine goes into the bead: no home directory, no checkout path.
    expect(description).not.toContain(fx.sandbox);
    expect(description).not.toContain(os.homedir());
  });

  test('a PARTIAL run and a FAILED run exit 1; an UNAVAILABLE run and a REFUSED run exit 0', () => {
    expect(run(mainPayload([finding()]), { deps: { run: () => UNAVAILABLE } }).code).toBe(0);
    expect(run(mainPayload([finding()]), { deps: fakeTracker({ fail: (c) => (c === 'tracker.create-detailed' ? { ok: false, error: { code: 'TOOL_FAILED', message: 'x' } } : null) }) }).code).toBe(1);
    expect(run(mainPayload([finding()], { repo: 'no good' }), { deps: fakeTracker() }).code).toBe(1);
    expect(run(mainPayload([finding()]), { deps: fakeTracker(), readPr: hostSays({ isCrossRepository: true }) }).code).toBe(0);
  });

  test('a repoRoot that is not a git repository is refused before any tracker is resolved', () => {
    const notRepo = tempDir('pr-review-beads-notrepo-');
    const { code, out } = run(mainPayload([finding()], { repoRoot: notRepo }));
    expect(code).toBe(1);
    expect(out).toMatchObject({ ok: false, status: 'FAILED' });
    expect(out.reason).toContain('not a git repository');
  });

  test('unreadable stdin and a payload that is not an object are FAILED, not thrown', () => {
    const readFail = () => {
      throw new SyntaxError('Unexpected token');
    };
    const bad = [];
    expect(main({ readJson: readFail, emit: (v) => bad.push(v), now: () => 0 })).toBe(1);
    expect(bad[0].reason).toContain('invalid JSON on stdin');
    expect(run([1, 2]).code).toBe(1);
    expect(run({ ...mainPayload([finding()]), dryRun: 'yes' }, { deps: fakeTracker() }).code).toBe(1);
    expect(run({ ...mainPayload([finding()]), repoRoot: '' }, { deps: fakeTracker() }).code).toBe(1);
  });

  test('repoRoot is required: it is never assumed to be the current directory, and nothing is read or written without it', () => {
    // Run from inside a git repository, wherever jest was started from: a default of the current directory would record there.
    const previous = process.cwd();
    process.chdir(fx.worktree);
    try {
      expect(fs.existsSync(path.join(process.cwd(), '.git'))).toBe(true);
      const tracker = fakeTracker();
      const git = jest.fn(() => {
        throw new Error('git must not be run without a repoRoot');
      });
      const readPr = jest.fn(hostSays());
      for (const repoRoot of [undefined, null, '', '   ', 7, {}]) {
        const body = { ...mainPayload([finding()]) };
        if (repoRoot === undefined) delete body.repoRoot;
        else body.repoRoot = repoRoot;
        const { code, out } = run(body, { deps: tracker, git, readPr });
        expect(code).toBe(1);
        expect(out).toMatchObject({ ok: false, status: 'FAILED', recorded: false });
        expect(out.reason).toContain("'repoRoot' is required");
      }
      expect(tracker.calls).toEqual([]);
      expect(git).not.toHaveBeenCalled();
      expect(readPr).not.toHaveBeenCalled();
    } finally {
      process.chdir(previous);
    }
  });

  test('baseSha is required and must be a full commit id: the tracker choice is read from it', () => {
    const tracker = fakeTracker();
    for (const baseSha of [undefined, null, '', 'main', fx.base.slice(0, 10), 7]) {
      const body = mainPayload([finding()]);
      if (baseSha === undefined) delete body.baseSha;
      else body.baseSha = baseSha;
      const { code, out } = run(body, { deps: tracker });
      expect(code).toBe(1);
      expect(out).toMatchObject({ ok: false, status: 'FAILED', recorded: false });
      expect(out.reason).toContain("'baseSha' is required");
    }
    expect(tracker.calls).toEqual([]);
  });

  test('without injected deps the tracker is resolved for the repository\'s PRIMARY checkout with the config as committed at the base, and never from the head\'s own adapters', () => {
    const trackerModule = require('../lib/tracker-findings');
    const tracker = fakeTracker();
    const spy = jest.spyOn(trackerModule, 'createToolchainDeps').mockReturnValue(tracker);
    try {
      // The head's worktree is named, but the tracker runs in the primary checkout, and its configuration is
      // what the BASE commit holds (`tracker: beads`), not what the head committed (`no-such-tracker`).
      const { code } = run(mainPayload([finding()], { timeoutMs: 1234 }));
      expect(code).toBe(0);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toMatchObject({ projectRoot: fx.primary, untrustedProjectRoot: true, timeoutMs: 1234 });
      expect(spy.mock.calls[0][0].baseConfig.text).toBe('tracker: beads\n');
      expect(fs.readFileSync(path.join(fx.worktree, '.ensemble', 'toolchain.yaml'), 'utf8')).toBe('tracker: no-such-tracker\n');
      expect(tracker.issues).toHaveLength(1);

      // A base with no config at all is a null config, not the head's.
      spy.mockClear();
      run(mainPayload([finding()], { baseSha: fx.root }));
      expect(spy.mock.calls[0][0].baseConfig).toMatchObject({ text: null });
    } finally {
      spy.mockRestore();
    }
  });

  test('a head that names another tracker cannot switch its own findings\' recording off, and the tracker never runs in the head\'s tree', () => {
    const trackerModule = require('../lib/tracker-findings');
    const br = fakeBr();
    // CONTROL: resolving from the head's tree, the way the recorder used to, makes the head's own findings unrecordable.
    const fromTree = trackerModule.createToolchainDeps({ projectRoot: fx.worktree, env: br.env, untrustedProjectRoot: true });
    expect(trackerModule.findByKeys(fromTree, { keys: ['k'] })).toMatchObject({ ok: false, unavailable: true });

    const { code, out } = run(mainPayload([finding()]), { env: br.env });
    expect(code).toBe(0);
    expect(out).toMatchObject({ ok: true, status: 'RECORDED', counts: { create: 1 } });
    const calls = br.calls();
    expect(calls.map((c) => c.argv[0])).toEqual(['list', 'create']);
    // Every br call ran in the primary checkout: the head's worktree (and its .beads) was never the store.
    expect(calls.every((c) => c.cwd === fx.primary)).toBe(true);
  });

  test('dryRun through main changes nothing', () => {
    const tracker = fakeTracker();
    const { code, out } = run(mainPayload([finding()], { dryRun: true }), { deps: tracker });
    expect(code).toBe(0);
    expect(out.status).toBe('PLANNED');
    expect(tracker.writes()).toEqual([]);
  });

  test('credential-shaped text in the result is redacted on the way out', () => {
    const secret = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
    const written = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => (written.push(String(chunk)), true));
    try {
      main({ readJson: () => mainPayload([finding({ failureMode: `leaks ${secret}` })], { dryRun: true }), deps: fakeTracker(), now: () => 0, readPr: hostSays() });
    } finally {
      spy.mockRestore();
    }
    expect(written.join('')).not.toContain(secret);
    expect(written.join('')).toContain('[REDACTED]');
  });
});

describe('what the head under review cannot control: the recorder refuses, by name, and writes nothing', () => {
  let fx;
  beforeAll(() => {
    fx = makeRepo();
  });

  const mainPayload = (ledger, extra = {}) => ({ ...payload(ledger, { headSha: fx.p3 }), baseSha: fx.base, repoRoot: fx.worktree, ...extra });
  const hostSays = (over = {}) => () => ({ ok: true, isCrossRepository: false, headRefOid: fx.p3, baseRefName: 'main', baseRefOid: fx.base, state: 'OPEN', ...over });
  function run(body, io = {}) {
    const out = [];
    const code = main({ readJson: () => body, emit: (value) => out.push(value), now: () => 0, readPr: hostSays(), ...io });
    return { code, out: out[0] };
  }
  const REFUSAL = { ok: true, status: 'REFUSED', recorded: false, fallback: 'skip-finding-beads', actions: [], beads: {} };

  test('a head on a fork is refused as cross-repository-head, before the tracker is touched', () => {
    const tracker = fakeTracker();
    const { code, out } = run(mainPayload([finding()]), { deps: tracker, readPr: hostSays({ isCrossRepository: true }) });
    expect(code).toBe(0);
    expect(out).toMatchObject({ ...REFUSAL, code: 'cross-repository-head' });
    expect(out.reason).toMatch(/fork/);
    expect(tracker.calls).toEqual([]);
  });

  test('a head whose repository the host did not state is refused as head-repository-unknown (only an explicit false passes)', () => {
    for (const isCrossRepository of [undefined, null, 'false', 0, 'no', {}]) {
      const tracker = fakeTracker();
      const { out } = run(mainPayload([finding()]), { deps: tracker, readPr: hostSays({ isCrossRepository }) });
      expect(out).toMatchObject({ ...REFUSAL, code: 'head-repository-unknown' });
      expect(tracker.calls).toEqual([]);
    }
  });

  test('a pull request the host could not be asked about is refused as pr-unreadable', () => {
    for (const readPr of [() => ({ ok: false, error: 'gh: not logged in' }), () => undefined, () => null]) {
      const tracker = fakeTracker();
      const { out } = run(mainPayload([finding()]), { deps: tracker, readPr });
      expect(out).toMatchObject({ ...REFUSAL, code: 'pr-unreadable' });
      expect(tracker.calls).toEqual([]);
    }
  });

  test('a dry run is refused too: even reading the tracker for a fork head is not done', () => {
    const tracker = fakeTracker();
    const { out } = run(mainPayload([finding()], { dryRun: true }), { deps: tracker, readPr: hostSays({ isCrossRepository: true }) });
    expect(out.status).toBe('REFUSED');
    expect(tracker.calls).toEqual([]);
  });

  test('the host is asked about the repository and the PR the payload names', () => {
    const readPr = jest.fn(hostSays());
    run(mainPayload([finding()]), { deps: fakeTracker(), readPr });
    expect(readPr).toHaveBeenCalledWith({ repo: 'Acme/Widgets', prNumber: 7 });
  });

  test('a head the host does not report as the pull request\'s head is refused as head-not-pr-head, before the tracker is touched', () => {
    // p1 and p2 are real commits of this repository and ancestors of the head the host reports (p3): still not THE head.
    for (const headSha of [fx.p1, fx.p2]) {
      const tracker = fakeTracker();
      const { code, out } = run(mainPayload([finding()], { headSha }), { deps: tracker });
      expect(code).toBe(0);
      expect(out).toMatchObject({ ...REFUSAL, code: 'head-not-pr-head' });
      expect(out.reason).toContain(headSha);
      expect(out.reason).toContain(fx.p3);
      expect(tracker.calls).toEqual([]);
    }
  });

  test('a head that exists only in the reviewing checkout (never part of the pull request) is refused as head-not-pr-head', () => {
    const local = makeRepo();
    writeFile(local.worktree, 'local-only.txt', 'never pushed\n');
    const localHead = commitAll(local.worktree, 'local only');
    const tracker = fakeTracker();
    const { out } = run({ ...payload([finding()], { headSha: localHead }), baseSha: local.base, repoRoot: local.worktree }, { deps: tracker, readPr: hostSays({ headRefOid: local.p3, baseRefOid: local.base }) });
    expect(out).toMatchObject({ ...REFUSAL, code: 'head-not-pr-head' });
    expect(tracker.calls).toEqual([]);
  });

  test('a head the host did not state is refused as head-unverified (only a full commit id can be compared)', () => {
    for (const headRefOid of [undefined, null, '', '   ', 'abc1234', 'z'.repeat(40), 7, {}]) {
      const tracker = fakeTracker();
      const { out } = run(mainPayload([finding()]), { deps: tracker, readPr: hostSays({ headRefOid }) });
      expect(out).toMatchObject({ ...REFUSAL, code: 'head-unverified' });
      expect(tracker.calls).toEqual([]);
    }
  });

  test('the host\'s head is compared as a commit id, not as text: case and surrounding space do not matter', () => {
    const { out } = run(mainPayload([finding()]), { deps: fakeTracker(), readPr: hostSays({ headRefOid: ` ${fx.p3.toUpperCase()}\n` }) });
    expect(out.status).toBe('RECORDED');
  });

  test('a baseSha that is not on the base branch (here: a commit of the pull request) is refused as base-not-on-base-branch', () => {
    const tracker = fakeTracker();
    const { out } = run(mainPayload([finding()], { baseSha: fx.p1 }), { deps: tracker });
    expect(out).toMatchObject({ ...REFUSAL, code: 'base-not-on-base-branch' });
    expect(out.reason).toContain(fx.p1);
    expect(tracker.calls).toEqual([]);
  });

  test('a base branch tip the host did not state is refused as base-unverified', () => {
    for (const baseRefOid of [undefined, null, '', 'abc', 7, {}]) {
      const tracker = fakeTracker();
      const { out } = run(mainPayload([finding()]), { deps: tracker, readPr: hostSays({ baseRefOid }) });
      expect(out).toMatchObject({ ...REFUSAL, code: 'base-unverified' });
      expect(tracker.calls).toEqual([]);
    }
  });

  test('a base branch tip this repository does not hold is refused as base-tip-unavailable (fetch it)', () => {
    const tracker = fakeTracker();
    const { out } = run(mainPayload([finding()]), { deps: tracker, readPr: hostSays({ baseRefOid: '2'.repeat(40) }) });
    expect(out).toMatchObject({ ...REFUSAL, code: 'base-tip-unavailable' });
    expect(out.reason).toMatch(/fetch/);
    expect(tracker.calls).toEqual([]);
  });

  test('makeReadPr asks gh for the fields the refusal needs and reads its answer strictly', () => {
    const { makeReadPr } = require('../lib/review-record-runtime');
    const calls = [];
    const reply = (stdout, status = 0, stderr = '') => (command, argv) => (calls.push([command, argv]), { status, stdout, stderr });
    const ok = makeReadPr(reply(JSON.stringify({ isCrossRepository: false, headRefOid: fx.p3, baseRefName: 'main', baseRefOid: fx.base, state: 'OPEN' })))({ repo: 'Acme/Widgets', prNumber: 7 });
    expect(ok).toEqual({ ok: true, isCrossRepository: false, headRefOid: fx.p3, baseRefName: 'main', baseRefOid: fx.base, state: 'OPEN' });
    expect(calls[0]).toEqual(['gh', ['pr', 'view', '7', '--repo', 'Acme/Widgets', '--json', 'isCrossRepository,headRefOid,baseRefName,baseRefOid,state']]);
    expect(makeReadPr(reply('', 1, 'gh: not found\nHTTP 404'))({ repo: 'a/b', prNumber: 1 })).toEqual({ ok: false, error: 'gh pr view failed: HTTP 404' });
    expect(makeReadPr(reply('not json'))({ repo: 'a/b', prNumber: 1 }).ok).toBe(false);
    expect(makeReadPr(reply('[]'))({ repo: 'a/b', prNumber: 1 }).ok).toBe(false);
    expect(makeReadPr(() => undefined)({ repo: 'a/b', prNumber: 1 }).ok).toBe(false);
  });

  test('a primary checkout that holds the head (or work built on it) is refused as head-checked-out, from the primary and from the linked worktree alike', () => {
    const held = makeRepo();
    gitIn(held.primary, 'checkout', '-q', '--detach', held.p3);
    // The host reports this repository's own head and base tip (the fixture repositories do not share commit ids).
    const readPr = hostSays({ headRefOid: held.p3, baseRefOid: held.base });
    for (const repoRoot of [held.primary, held.worktree]) {
      const tracker = fakeTracker();
      const { out } = run({ ...payload([finding()], { headSha: held.p3 }), baseSha: held.base, repoRoot }, { deps: tracker, readPr });
      expect(out).toMatchObject({ ...REFUSAL, code: 'head-checked-out' });
      expect(out.reason).toContain(held.primary);
      expect(tracker.calls).toEqual([]);
    }
    // Work BUILT ON the head counts as holding it.
    writeFile(held.primary, 'later.txt', 'later\n');
    commitAll(held.primary, 'later');
    const tracker = fakeTracker();
    const { out } = run({ ...payload([finding()], { headSha: held.p3 }), baseSha: held.base, repoRoot: held.primary }, { deps: tracker, readPr });
    expect(out.code).toBe('head-checked-out');

    // And the same repository is fine once the primary is back on the base's branch.
    gitIn(held.primary, 'checkout', '-q', 'main');
    const ok = run({ ...payload([finding()], { headSha: held.p3 }), baseSha: held.base, repoRoot: held.worktree }, { deps: fakeTracker(), readPr });
    expect(ok.out.status).toBe('RECORDED');
  });

  test('a repository with no primary checkout (a bare repository\'s worktree) is refused as no-primary-worktree', () => {
    const bare = path.join(fx.sandbox, 'bare.git');
    gitIn(fx.sandbox, 'clone', '-q', '--bare', fx.primary, bare);
    const wt = path.join(fx.sandbox, 'bare-wt');
    gitIn(bare, 'worktree', 'add', '-q', '--detach', wt, fx.p3);
    const tracker = fakeTracker();
    const { out } = run(mainPayload([finding()], { repoRoot: wt }), { deps: tracker });
    expect(out).toMatchObject({ ...REFUSAL, code: 'no-primary-worktree' });
    expect(tracker.calls).toEqual([]);
  });

  test('a base commit this repository does not hold is refused as base-unavailable: the tracker choice cannot be read from it', () => {
    const tracker = fakeTracker();
    const { out } = run(mainPayload([finding()], { baseSha: '1'.repeat(40) }), { deps: tracker });
    expect(out).toMatchObject({ ...REFUSAL, code: 'base-unavailable' });
    expect(tracker.calls).toEqual([]);
  });

  test('a git that cannot answer is a refusal, never a pass', () => {
    const tracker = fakeTracker();
    const broken = () => ({ status: 128, stdout: '', stderr: 'fatal: boom' });
    const { out } = run(mainPayload([finding()]), { deps: tracker, git: broken });
    expect(out.status).toBe('REFUSED');
    expect(tracker.calls).toEqual([]);
  });
});

describe("the recorder's checkout must be the pull request's repository (kata 97ra: the hole the merge sweep closed in kata mdfr)", () => {
  let fx;
  beforeAll(() => {
    fx = makeRepo();
  });

  /** Replace the primary's remotes (its linked worktrees share them) with exactly these. */
  const remotes = (...list) => {
    for (const name of gitIn(fx.primary, 'remote').split('\n').filter(Boolean)) gitIn(fx.primary, 'remote', 'remove', name);
    for (const [name, url] of list) gitIn(fx.primary, 'remote', 'add', name, url);
  };
  const realGit = require('../lib/review-record-runtime').defaultGit();
  /** The real entry point (`main`), the real git, a host that says everything is fine: only the repository can fail. */
  const run = (over = {}, io = {}) => {
    const tracker = fakeTracker();
    const readPr = jest.fn(() => ({ ok: true, isCrossRepository: false, headRefOid: fx.p3, baseRefName: 'main', baseRefOid: fx.base, state: 'OPEN' }));
    const out = [];
    const code = main({ readJson: () => ({ ...payload([finding()], { headSha: fx.p3 }), baseSha: fx.base, repoRoot: fx.worktree, ...over }), emit: (value) => out.push(value), now: () => 0, readPr, deps: tracker, ...io });
    return { code, out: out[0], tracker, readPr };
  };
  const REFUSAL = { ok: true, status: 'REFUSED', recorded: false, fallback: 'skip-finding-beads', actions: [], beads: {} };
  const nothingAsked = ({ readPr, tracker }) => {
    expect(readPr).not.toHaveBeenCalled();
    expect(tracker.calls).toEqual([]);
    expect(tracker.issues).toEqual([]);
  };

  test.each([
    ['another owner', 'https://github.com/Attacker/Widgets.git'],
    ['another name', 'https://github.com/Acme/Widgets-fork.git'],
    ['an owner that merely starts with it', 'git@github.com:Acme-evil/Widgets.git'],
    ['a name that merely starts with it', 'ssh://git@github.com/Acme/WidgetsX'],
  ])('a checkout of %s is REFUSED repository-mismatch: the host and the tracker are never asked and no bead is recorded', (_name, url) => {
    remotes(['origin', url]);
    const asked = run();
    expect(asked.code).toBe(0);
    expect(asked.out).toMatchObject({ ...REFUSAL, code: 'repository-mismatch' });
    expect(asked.out.reason).toContain('not Acme/Widgets');
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
  ])('a checkout whose remote is %s is the repository: the recorder goes on and records', (_name, url) => {
    remotes(['origin', url]);
    const { code, out, tracker } = run();
    expect(code).toBe(0);
    expect(out).toMatchObject({ ok: true, status: 'RECORDED' });
    expect(tracker.issues).toHaveLength(1);
  });

  test('a fork checkout is REFUSED even when another remote names the repository: the origin is what the checkout is', () => {
    remotes(['origin', 'https://github.com/someone/Widgets.git'], ['upstream', 'https://github.com/Acme/Widgets.git']);
    const asked = run();
    expect(asked.out).toMatchObject({ ...REFUSAL, code: 'repository-mismatch' });
    expect(asked.out.reason).toContain('someone/widgets');
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
      expect(asked.out).toMatchObject({ ...REFUSAL, code: 'repository-mismatch' });
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
    expect(asked.out).toMatchObject({ ...REFUSAL, code: 'repository-unknown' });
    expect(asked.out.reason).toContain(why);
    nothingAsked(asked);
  });

  test('a git that cannot list the remotes is REFUSED repository-unknown, and nothing is asked', () => {
    remotes(['origin', 'https://github.com/Acme/Widgets.git']);
    const asked = run({}, { git: (args, options) => (args[0] === 'remote' ? { status: 128, stdout: '', stderr: 'fatal: broken' } : realGit(args, options)) });
    expect(asked.out).toMatchObject({ ...REFUSAL, code: 'repository-unknown' });
    expect(asked.out.reason).toContain('could not be read');
    nothingAsked(asked);
  });

  test('a primary checkout that cannot be found is REFUSED no-primary-worktree, before the host is asked', () => {
    remotes(['origin', 'https://github.com/Acme/Widgets.git']);
    const asked = run({}, { git: () => ({ status: 128, stdout: '', stderr: 'fatal: boom' }) });
    expect(asked.out).toMatchObject({ ...REFUSAL, code: 'no-primary-worktree' });
    nothingAsked(asked);
  });

  test('a dry run is refused too: the tracker is not even read for another repository', () => {
    remotes(['origin', 'https://github.com/Attacker/Widgets.git']);
    const asked = run({ dryRun: true });
    expect(asked.out).toMatchObject({ ...REFUSAL, code: 'repository-mismatch' });
    nothingAsked(asked);
  });

  test('the repository is bound whether repoRoot is the primary checkout or its linked worktree', () => {
    remotes(['origin', 'https://github.com/Attacker/Widgets.git']);
    for (const repoRoot of [fx.primary, fx.worktree]) {
      const asked = run({ repoRoot });
      expect(asked.out).toMatchObject({ ...REFUSAL, code: 'repository-mismatch' });
      nothingAsked(asked);
    }
  });

  test("the identity checked is the PRIMARY checkout's, which holds the tracker: a linked worktree's own remote configuration cannot stand in for it", () => {
    const own = makeRepo({ remote: 'https://github.com/attacker/Widgets.git' });
    gitIn(own.primary, 'config', 'extensions.worktreeConfig', 'true');
    gitIn(own.worktree, 'config', '--worktree', 'url.https://github.com/Acme/.insteadOf', 'https://github.com/attacker/');
    // The precondition: from the worktree the repository looks like Acme/Widgets (its own configuration rewrites the URL), from the
    // primary checkout, where the tracker is, it does not.
    expect(gitIn(own.worktree, 'remote', 'get-url', 'origin')).toBe('https://github.com/Acme/Widgets.git');
    expect(gitIn(own.primary, 'remote', 'get-url', 'origin')).toBe('https://github.com/attacker/Widgets.git');
    const tracker = fakeTracker();
    const readPr = jest.fn(() => ({ ok: true, isCrossRepository: false, headRefOid: own.p3, baseRefName: 'main', baseRefOid: own.base, state: 'OPEN' }));
    const out = [];
    main({ readJson: () => ({ ...payload([finding()], { headSha: own.p3 }), baseSha: own.base, repoRoot: own.worktree }), emit: (value) => out.push(value), now: () => 0, readPr, deps: tracker });
    expect(out[0]).toMatchObject({ ...REFUSAL, code: 'repository-mismatch' });
    nothingAsked({ readPr, tracker });
  });

  test('the binding is what refuses: with the right origin the very same payload records', () => {
    remotes(['origin', 'https://github.com/Acme/Widgets.git']);
    const { out, tracker } = run();
    expect(out).toMatchObject({ ok: true, status: 'RECORDED' });
    expect(tracker.issues).toHaveLength(1);
  });
});

describe('a fix closes a bead only with a commit git says is on the PR', () => {
  let fx;
  beforeAll(() => {
    fx = makeRepo();
  });

  const body = (ledger, extra = {}) => ({ ...payload(ledger, { headSha: fx.p3 }), baseSha: fx.base, repoRoot: fx.worktree, ...extra });
  const hostSays = () => ({ ok: true, isCrossRepository: false, headRefOid: fx.p3, baseRefName: 'main', baseRefOid: fx.base, state: 'OPEN' });
  function run(request, io = {}) {
    const out = [];
    const code = main({ readJson: () => request, emit: (value) => out.push(value), now: () => 0, readPr: hostSays, ...io });
    return { code, out: out[0] };
  }

  /** A tracker that already holds the open bead of the default finding. */
  function withOpenBead() {
    const tracker = fakeTracker();
    expect(run(body([finding()]), { deps: tracker }).out.status).toBe('RECORDED');
    expect(tracker.issues).toHaveLength(1);
    return tracker;
  }

  test('a commit on the PR closes the bead, and the close names the full commit even when it was written short', () => {
    for (const clearedBy of [fx.p2, fx.p2.slice(0, 10), fx.p2.toUpperCase()]) {
      const tracker = withOpenBead();
      const { out } = run(body([finding({ cleared: true, clearedBy })]), { deps: tracker });
      expect(out).toMatchObject({ ok: true, status: 'RECORDED', counts: { close: 1 } });
      expect(out.unverifiedFixes).toBeUndefined();
      expect(tracker.issues[0]).toMatchObject({ status: 'closed', close_comment: `closed at commit ${fx.p2}` });
    }
  });

  test.each([
    ['a commit in the base\'s history', () => fx.base, 'in-base-history'],
    ['the base\'s own ancestor', () => fx.root, 'in-base-history'],
    ['a commit that does not exist', () => 'e'.repeat(40), 'commit-not-found'],
    ['an abbreviation that names nothing', () => 'e'.repeat(9), 'commit-not-found'],
  ])('%s is not a fix: the bead stays open and the refusal is reported', (_label, commit, reason) => {
    const tracker = withOpenBead();
    const clearedBy = commit();
    const { out } = run(body([finding({ cleared: true, clearedBy })]), { deps: tracker });
    expect(out).toMatchObject({ ok: true, status: 'RECORDED', counts: { close: 0 } });
    expect(out.beads['F-1']).toMatchObject({ action: 'skip', reason: 'cleared-unverified' });
    expect(out.unverifiedFixes).toEqual([{ commit: clearedBy, reason }]);
    expect(tracker.issues[0].status).toBe('open');
    expect(tracker.calls.some((c) => c.capability === 'tracker.close-with-reason')).toBe(false);
  });

  test('a commit on the PR that is newer than the head the request names is not a fix either', () => {
    const tracker = withOpenBead();
    // The host agrees that p2 is the head: the request names the pull request's head, and p3 is newer than it.
    const { out } = run(body([finding({ cleared: true, clearedBy: fx.p3 })], { headSha: fx.p2 }), { deps: tracker, readPr: () => ({ ...hostSays(), headRefOid: fx.p2 }) });
    expect(out.unverifiedFixes).toEqual([{ commit: fx.p3, reason: 'not-an-ancestor-of-head' }]);
    expect(tracker.issues[0].status).toBe('open');
  });

  test('a commitsOnPr list in the payload is ignored: only git can say a commit is on the PR', () => {
    const tracker = withOpenBead();
    const forged = fx.base;
    const { out } = run(body([finding({ cleared: true, clearedBy: forged })], { commitsOnPr: [forged] }), { deps: tracker });
    expect(out.counts.close).toBe(0);
    expect(out.unverifiedFixes).toEqual([{ commit: forged, reason: 'in-base-history' }]);
    expect(tracker.issues[0].status).toBe('open');
  });

  test('the verification covers the security lane\'s findings too', () => {
    const tracker = fakeTracker();
    const lane = finding({ id: 'S-1', failureMode: 'lane claim', severity: 'important' });
    expect(run(body([], { security: { status: 'findings', findings: [lane] } }), { deps: tracker }).out.counts.create).toBe(1);
    const { out } = run(body([], { security: { status: 'findings', findings: [{ ...lane, cleared: true, clearedBy: fx.base }] } }), { deps: tracker });
    expect(out.unverifiedFixes).toEqual([{ commit: fx.base, reason: 'in-base-history' }]);
    expect(tracker.issues[0].status).toBe('open');
  });
});

describe('end to end: a real diff, the clear CLI, then the recorder (acceptance test AC2)', () => {
  let fx;
  beforeAll(() => {
    fx = makeRepo();
  });

  /** The host's head is the head being recorded: a review is always of the pull request's head at that time. */
  const hostSays = (head) => () => ({ ok: true, isCrossRepository: false, headRefOid: head, baseRefName: 'main', baseRefOid: fx.base, state: 'OPEN' });
  const record = (ledger, headSha, tracker, extra = {}) => {
    const out = [];
    main({
      readJson: () => ({ ...payload(ledger, { headSha }), baseSha: fx.base, repoRoot: fx.worktree, ...extra }),
      emit: (value) => out.push(value),
      now: () => 0,
      readPr: hostSays(headSha),
      deps: tracker,
    });
    return out[0];
  };
  /** The CLI as a process: JSON on stdin, JSON on stdout. */
  const derive = (request) => {
    const child = spawnSync(process.execPath, [CLEAR_CLI], { input: JSON.stringify(request), encoding: 'utf8' });
    return { status: child.status, result: JSON.parse(child.stdout) };
  };
  const atP1 = () => finding({ headSha: fx.p1, locationOrLink: 'src/widget.js:12' });

  test('the finding recorded at p1 is cleared by the p2 edit of its line, and the recorder closes its bead with a commit on the PR', () => {
    const tracker = fakeTracker();
    expect(record([atP1()], fx.p1, tracker)).toMatchObject({ status: 'RECORDED', counts: { create: 1 } });

    const derived = derive({ repoRoot: fx.worktree, baseSha: fx.base, headSha: fx.p3, ledger: [atP1()], incoming: [] });
    expect(derived.status).toBe(0);
    expect(derived.result).toMatchObject({ ok: true, status: 'DERIVED', headSha: fx.p3, cleared: [{ id: 'F-1', clearedBy: fx.p3 }] });
    const [mark] = derived.result.ledger;
    expect(mark).toMatchObject({ id: 'F-1', cleared: true, clearedBy: fx.p3, clearedReason: 'location-changed' });

    const closed = record(derived.result.ledger, fx.p3, tracker);
    expect(closed).toMatchObject({ ok: true, status: 'RECORDED', counts: { close: 1 } });
    expect(closed.unverifiedFixes).toBeUndefined();
    expect(tracker.issues[0]).toMatchObject({ status: 'closed', close_comment: `closed at commit ${fx.p3}` });
    expect(closed.beads['F-1']).toMatchObject({ action: 'close', closedBeadId: 'bd-1' });
  });

  test('the documented payload: the carried entry has no head of its own and the prior round\'s reviewed head is lastReviewedSha', () => {
    const tracker = fakeTracker();
    record([finding({ locationOrLink: 'src/widget.js:12' })], fx.p1, tracker);

    const carried = finding({ locationOrLink: 'src/widget.js:12' });
    expect(carried.headSha).toBeUndefined();
    const kept = derive({ repoRoot: fx.worktree, baseSha: fx.base, headSha: fx.p3, ledger: [carried], incoming: [] });
    expect(kept.result).toMatchObject({ ok: true, cleared: [], kept: [{ id: 'F-1', reason: 'no-recorded-head' }] });

    const derived = derive({ repoRoot: fx.worktree, baseSha: fx.base, headSha: fx.p3, lastReviewedSha: fx.p1, ledger: [carried], incoming: [] });
    expect(derived.result).toMatchObject({ ok: true, cleared: [{ id: 'F-1', clearedBy: fx.p3 }] });
    const closed = record(derived.result.ledger, fx.p3, tracker);
    expect(closed).toMatchObject({ ok: true, status: 'RECORDED', counts: { close: 1 } });
    expect(tracker.issues[0].status).toBe('closed');
  });

  test('a finding the next review raised again is not cleared, so its bead stays open and is updated', () => {
    const tracker = fakeTracker();
    record([atP1()], fx.p1, tracker);
    // The review of p3 re-reports the defect two lines lower: the same defect, so not fixed.
    const reRaised = { ...atP1(), id: 'N-9', locationOrLink: 'src/widget.js:14', headSha: fx.p3 };
    const derived = derive({ repoRoot: fx.worktree, baseSha: fx.base, headSha: fx.p3, ledger: [atP1()], incoming: [reRaised] });
    expect(derived.result.cleared).toEqual([]);
    expect(derived.result.kept).toEqual([{ id: 'F-1', reason: 're-reported' }]);

    const result = record(derived.result.ledger, fx.p3, tracker);
    expect(result).toMatchObject({ ok: true, counts: { close: 0, update: 1 } });
    expect(tracker.issues[0].status).toBe('open');
  });

  test('a hand-written cleared mark naming the base closes no bead', () => {
    const tracker = fakeTracker();
    record([atP1()], fx.p1, tracker);
    const handWritten = { ...atP1(), cleared: true, clearedBy: fx.base, clearedReason: 'location-changed' };
    const result = record([handWritten], fx.p3, tracker);
    expect(result.counts.close).toBe(0);
    expect(result.unverifiedFixes).toEqual([{ commit: fx.base, reason: 'in-base-history' }]);
    expect(tracker.issues[0].status).toBe('open');
  });
});
