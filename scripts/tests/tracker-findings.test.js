'use strict';
/**
 * Tests for the findings-as-beads tracker capabilities (kata yfbg):
 *   - packages/development/lib/tracker-findings.js (find-by-key verdicts, validation, the
 *     defined "unavailable" result), driven with injected deps;
 *   - the REAL beads adapter manifest through the REAL runner against a replay `br` that prints
 *     outputs CAPTURED LIVE from br 0.6.0 (scripts/tests/fixtures/toolchain/
 *     adapter-tracker-beads-samples/), so a wrong `root`/`map` or a wrong argv flag fails here.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const { loadAdapter } = require('../../packages/development/lib/toolchain/adapters');
const { runCapabilitySync } = require('../../packages/development/lib/toolchain/runner');
const findings = require('../../packages/development/lib/tracker-findings');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SAMPLES = path.join(__dirname, 'fixtures', 'toolchain', 'adapter-tracker-beads-samples');
const TRACKER_CONTRACT = path.join(REPO_ROOT, 'packages', 'development', 'toolchain', 'categories', 'tracker.yaml');
const { manifest: BEADS } = loadAdapter('beads', { projectRoot: REPO_ROOT });

const FINDING_CAPABILITIES = [
  'tracker.create-detailed',
  'tracker.find-by-key',
  'tracker.update-detailed',
  'tracker.close-with-reason'
];

const sample = (name) => fs.readFileSync(path.join(SAMPLES, name), 'utf8');

// ---------------------------------------------------------------------------
// Replay br: prints a captured fixture and records the argv it was called with.
// ---------------------------------------------------------------------------

const tempDirs = [];
afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function mkTempDir(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

/**
 * @param {Record<string, string | [string, number]>} replay first-argv-word (or "dep add") ->
 *   fixture file name, or `[file name, exit code]` for a command that fails (br prints its error
 *   JSON on stdout and exits non-zero)
 *
 * `br list` honours `--label` (AND logic, repeatable) the way real br does (captured live), so a
 * label-scoped lookup sees only the beads real br would list for it.
 */
function replayBr(replay) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-findings-')));
  tempDirs.push(dir);
  const script = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
fs.appendFileSync(path.join(__dirname, 'argv.log'), JSON.stringify(argv) + '\\n');
const replay = JSON.parse(fs.readFileSync(path.join(__dirname, 'replay.json'), 'utf8'));
const key = argv[0] === 'dep' ? 'dep ' + argv[1] : argv[0];
if (!(key in replay)) { process.stderr.write('replay br: no fixture for ' + key + '\\n'); process.exit(2); }
let out = fs.readFileSync(replay[key].file, 'utf8');
if (key === 'list') {
  const wanted = argv.flatMap((a, i) => (a === '--label' || a === '-l' ? [argv[i + 1]] : []));
  if (wanted.length) {
    const listed = JSON.parse(out);
    listed.issues = listed.issues.filter((issue) => wanted.every((label) => (issue.labels || []).includes(label)));
    listed.total = listed.issues.length;
    out = JSON.stringify(listed);
  }
}
process.stdout.write(out);
process.exitCode = replay[key].exit;
`;
  fs.writeFileSync(path.join(dir, 'br'), script, { mode: 0o755 });
  const full = Object.fromEntries(
    Object.entries(replay).map(([k, v]) => {
      const [file, exit = 0] = [].concat(v);
      return [k, { file: path.join(SAMPLES, file), exit }];
    })
  );
  fs.writeFileSync(path.join(dir, 'replay.json'), JSON.stringify(full));
  const calls = () =>
    fs.existsSync(path.join(dir, 'argv.log'))
      ? fs.readFileSync(path.join(dir, 'argv.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
      : [];
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` };
  return { dir, calls, env };
}

function deps(replay, manifest = BEADS, categoriesDir) {
  const br = replayBr(replay);
  return {
    br,
    run: (capability, args) =>
      runCapabilitySync(manifest, capability, args, { parentEnv: br.env, timeoutMs: 10000, categoriesDir })
  };
}

// ---------------------------------------------------------------------------
// Contract: optional + fallback (the guard that makes "unavailable" structured)
// ---------------------------------------------------------------------------

describe('tracker category contract: findings capabilities degrade, never become required', () => {
  const contract = yaml.load(fs.readFileSync(TRACKER_CONTRACT, 'utf8')).capabilities;

  test.each(FINDING_CAPABILITIES)('%s is optional and declares the skip fallback', (id) => {
    expect(contract[id]).toBeDefined();
    expect(contract[id].required).toBe(false);
    expect(contract[id].fallback).toBe(findings.SKIP_FALLBACK);
  });

  test.each(FINDING_CAPABILITIES)('the beads adapter declares %s', (id) => {
    expect(BEADS.capabilities[id]).toBeDefined();
  });

  test('tracker.find-by-key takes only the key: it is not scoped to a label', () => {
    expect(contract['tracker.find-by-key'].inputs).toEqual(['key']);
  });
});

// ---------------------------------------------------------------------------
// Real manifest + real runner + captured br output
// ---------------------------------------------------------------------------

describe('beads adapter parses real captured br output', () => {
  test('tracker.create: a bare object (NOT array-of-one) yields the new id', () => {
    const { run, br } = deps({ create: 'br-create-plain.sample.json' });
    const result = run('tracker.create', { title: 't', description: 'd', type: 'task' });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ id: JSON.parse(sample('br-create-plain.sample.json')).id });
    expect(br.calls()[0]).toEqual(['create', '--title', 't', '--type', 'task', '-d', 'd', '--json']);
  });

  test('tracker.create-detailed: passes labels, priority and external ref in ONE create call', () => {
    const { run, br } = deps({ create: 'br-create-detailed.sample.json' });
    const result = run('tracker.create-detailed', {
      title: 'Finding',
      description: 'claim',
      type: 'bug',
      labels: 'pr-review,sev-important',
      priority: '1',
      externalKey: 'dk:acme/repo:src/a.js:unchecked-path'
    });
    expect(result.ok).toBe(true);
    expect(result.data.id).toBe(JSON.parse(sample('br-create-detailed.sample.json')).id);
    expect(br.calls()).toEqual([
      [
        'create', '--title', 'Finding', '--type', 'bug', '-d', 'claim',
        '-l', 'pr-review,sev-important', '-p', '1',
        '--external-ref', 'dk:acme/repo:src/a.js:unchecked-path', '--json'
      ]
    ]);
  });

  test('tracker.update-detailed: rewrites fields and APPENDS notes (never --notes, which replaces)', () => {
    const { run, br } = deps({ update: 'br-update-detailed.sample.json' });
    const result = run('tracker.update-detailed', {
      id: 'ws-17y', title: 'T', description: 'D', priority: '0', notes: 'head def5678: 3/3 real'
    });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ id: 'ws-17y' });
    const argv = br.calls()[0];
    expect(argv).toContain('--append-notes');
    expect(argv).not.toContain('--notes');
    // Labels and status are deliberately not touched by a re-review update.
    for (const flag of ['--add-label', '--set-labels', '--remove-label', '--status', '-s']) {
      expect(argv).not.toContain(flag);
    }
  });

  test('tracker.close-with-reason: records the reason and the commit, normalizes status to closed', () => {
    const { run, br } = deps({ close: 'br-close-with-reason.sample.json' });
    const result = run('tracker.close-with-reason', { id: 'ws-17y', reason: 'fixed by author', commit: 'def5678' });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ id: 'ws-17y', status: 'closed' });
    expect(br.calls()[0]).toEqual([
      'close', 'ws-17y', '--reason', 'fixed by author',
      '--transition-comment', 'closed at commit def5678', '--json'
    ]);
  });

  test.each([
    ['tracker.dep-add', { id: 'a', dependsOnId: 'b', type: 'blocks' }, 'dep add', 'br-dep-add.sample.json'],
    ['tracker.dep-remove', { id: 'a', dependsOnId: 'b' }, 'dep remove', 'br-dep-remove.sample.json']
  ])('%s: the real shape (bare object keyed by issue_id, no id field) maps to the issue id', (cap, args, key, file) => {
    const { run } = deps({ [key]: file });
    const result = run(cap, args);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ id: JSON.parse(sample(file)).issue_id });
  });
});

// ---------------------------------------------------------------------------
// findByKey: zero / one / many against captured `br list` output
// ---------------------------------------------------------------------------

describe('findByKey (AC3)', () => {
  // Captured live: three beads; the third holds its key under the label 'triaged' only.
  const LIST = JSON.parse(sample('br-list-unscoped.sample.json'));
  const KEY_A = 'dk:acme/repo:src/a.js:unchecked-path';
  const KEY_TRIAGED = 'dk:acme/repo:src/c.js:relabelled';

  test('exactly one bead for a key present once in the real captured list', () => {
    const { run, br } = deps({ list: 'br-list-unscoped.sample.json' });
    const result = findings.findByKey({ run }, { key: KEY_A });
    expect(result).toMatchObject({ ok: true, found: true, labels: ['pr-review', 'sev-important'] });
    expect(result.item.external_ref).toBe(KEY_A);
    expect(LIST.issues.length).toBeGreaterThan(1); // the other beads must NOT be returned
    expect(br.calls()[0]).toEqual(['list', '--all', '--limit', '0', '--json']);
  });

  test('finds the bead that holds the key under a different label: br keys are unique workspace-wide', () => {
    const { run, br } = deps({ list: 'br-list-unscoped.sample.json' });
    const holder = LIST.issues.find((issue) => issue.external_ref === KEY_TRIAGED);

    const result = findings.findByKey({ run }, { key: KEY_TRIAGED });
    expect(result).toMatchObject({ ok: true, found: true, labels: ['triaged'] });
    expect(result.item.id).toBe(holder.id);
    expect(br.calls()).toHaveLength(1);

    // Fidelity of the replay: a list scoped to 'pr-review' (the old argv) does not show this
    // bead at all, exactly as with real br (captured live), so scoping the lookup by label
    // would have reported "not found" for a key that br refuses to create again.
    const scoped = JSON.parse(
      execFileSync('br', ['list', '--all', '--limit', '0', '--label', 'pr-review', '--json'], {
        env: br.env,
        encoding: 'utf8'
      })
    );
    expect(scoped.issues.map((issue) => issue.external_ref)).not.toContain(KEY_TRIAGED);
  });

  test('creating a key that is held under another label is refused by br, as a tool failure and not as unavailable', () => {
    // Captured live: exit 7, CONFIG_ERROR "External reference ... already exists on issue ...".
    const { run } = deps({ create: ['br-create-duplicate-key.error.json', 7] });
    const result = findings.createFinding(
      { run },
      { title: 'Dup', description: 'd', labels: ['pr-review'], priority: 2, key: KEY_TRIAGED }
    );
    expect(result.ok).toBe(false);
    expect(result.unavailable).toBeUndefined();
    expect(result.error.code).toBe('TOOL_FAILED');
  });

  test('none for an absent key, and a key that is only a prefix of a real one', () => {
    const { run } = deps({ list: 'br-list-unscoped.sample.json' });
    expect(findings.findByKey({ run }, { key: 'dk:acme/repo:src/zzz.js:nope' })).toEqual({ ok: true, found: false });
    expect(findings.findByKey({ run }, { key: 'dk:acme/repo:src/a.js' })).toEqual({ ok: true, found: false });
  });

  test('a matched bead without a labels field reports an empty label list', () => {
    const run = () => ({ ok: true, data: JSON.stringify({ issues: [{ id: 'b-1', external_ref: 'k' }] }) });
    expect(findings.findByKey({ run }, { key: 'k' })).toMatchObject({ ok: true, found: true, labels: [] });
  });

  test('refuses (AMBIGUOUS_KEY, naming the ids) when several beads share the key', () => {
    const dup = { issues: [{ id: 'b-1', external_ref: 'k' }, { id: 'b-2', external_ref: 'k' }, { id: 'b-3', external_ref: 'other' }] };
    const run = () => ({ ok: true, data: JSON.stringify(dup) });
    const result = findings.findByKey({ run }, { key: 'k' });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('AMBIGUOUS_KEY');
    expect(result.error.ids).toEqual(['b-1', 'b-2']);
    expect(result.found).toBeUndefined();
  });

  test('an empty key is refused before any tracker call, so beads without a key are never matched', () => {
    const run = jest.fn(() => ({ ok: true, data: JSON.stringify({ issues: [{ id: 'b-1' }, { id: 'b-2', external_ref: '' }] }) }));
    const result = findings.findByKey({ run }, { key: '' });
    expect(result.error.code).toBe('INVALID_ARG');
    expect(run).not.toHaveBeenCalled();
  });

  test('accepts an older br bare-array list and refuses unparseable output', () => {
    expect(findings.findByKey({ run: () => ({ ok: true, data: '[{"id":"b-1","external_ref":"k"}]' }) }, { key: 'k' }))
      .toMatchObject({ ok: true, found: true });
    expect(findings.findByKey({ run: () => ({ ok: true, data: 'not json' }) }, { key: 'k' }).error.code).toBe('BAD_OUTPUT');
    expect(findings.findByKey({ run: () => ({ ok: true, data: '{"nope":1}' }) }, { key: 'k' }).error.code).toBe('BAD_OUTPUT');
  });
});

// ---------------------------------------------------------------------------
// AC4: no tracker / capability absent -> defined unavailable result, never an exception
// ---------------------------------------------------------------------------

describe('unavailable result (AC4)', () => {
  const ARGS = {
    createFinding: [{ title: 't', description: 'd', labels: ['pr-review'], priority: 1, key: 'k' }],
    findByKey: [{ key: 'k' }],
    updateFinding: [{ id: 'b-1', title: 't', description: 'd', priority: 1, note: 'n' }],
    closeFinding: [{ id: 'b-1', reason: 'r', commit: 'abc1234' }]
  };
  const UNAVAILABLE = {
    ok: false,
    unavailable: true,
    fallback: 'skip-finding-beads',
    error: { code: 'UNAVAILABLE', message: expect.any(String) }
  };

  // An adapter that declares NONE of the findings capabilities (any non-beads tracker).
  const BARE_ADAPTER = { adapter: 'bare', binaries: [], allowlist: [], capabilities: {} };

  test.each(Object.keys(ARGS))('%s: adapter without the capability -> structured unavailable from the real runner', (fn) => {
    const run = (capability, args) => runCapabilitySync(BARE_ADAPTER, capability, args, {});
    expect(findings[fn]({ run }, ...ARGS[fn])).toEqual(UNAVAILABLE);
  });

  test.each(Object.keys(ARGS))('%s: an older contract with no fallback (NOT_ALLOWED undeclared) is also unavailable', (fn) => {
    const dir = mkTempDir('tracker-findings-contract-');
    fs.writeFileSync(path.join(dir, 'tracker.yaml'), 'category: tracker\nversion: "1.0"\ncapabilities: {}\n');
    const run = (capability, args) => runCapabilitySync(BARE_ADAPTER, capability, args, { categoriesDir: dir });
    expect(findings[fn]({ run }, ...ARGS[fn])).toEqual(UNAVAILABLE);
  });

  // Reason: this replaces "a tracker that cannot be resolved (run throws) is unavailable". Only
  // the default deps resolve a tracker, and they now RETURN the unavailable envelope for a
  // resolution failure; an exception from `run` is a bug (next test) and must not read as
  // "no tracker here".
  test.each(Object.keys(ARGS))('%s: an explicit tracker setting naming an adapter that is not installed is unavailable, not thrown', (fn) => {
    const repo = mkTempDir('tracker-findings-repo-');
    fs.mkdirSync(path.join(repo, '.ensemble'));
    fs.writeFileSync(path.join(repo, '.ensemble', 'toolchain.yaml'), 'tracker: no-such-tracker-adapter\n');
    const br = replayBr({ list: 'br-list-unscoped.sample.json' });
    const result = findings[fn](findings.createToolchainDeps({ projectRoot: repo, env: br.env }), ...ARGS[fn]);
    expect(result).toEqual(UNAVAILABLE);
    expect(result.error.message).toContain('no-such-tracker-adapter');
    expect(br.calls()).toEqual([]);
  });

  test.each(Object.keys(ARGS))('%s: an exception thrown by the runner propagates and is never reported as unavailable', (fn) => {
    const run = () => {
      throw new TypeError("Cannot read properties of undefined (reading 'x')");
    };
    expect(() => findings[fn]({ run }, ...ARGS[fn])).toThrow(TypeError);
  });

  // Reason: this replaces "tracker binary not installed (real ENOENT) is unavailable", which
  // asserted that the wrapper recognises a missing binary by the text of the runner's
  // TOOL_FAILED message. That text echoes the finding, so finding text could flip the verdict;
  // absence is now established before anything is spawned (the next two tests pin the text).
  test.each(Object.keys(ARGS))('%s: tracker binary not installed is unavailable, established before anything is spawned', (fn) => {
    const repo = mkTempDir('tracker-findings-repo-');
    fs.mkdirSync(path.join(repo, '.beads'));
    const emptyBin = mkTempDir('tf-empty-');
    const result = findings[fn](
      findings.createToolchainDeps({ projectRoot: repo, env: { ...process.env, PATH: emptyBin } }),
      ...ARGS[fn]
    );
    expect(result).toEqual(UNAVAILABLE);
    expect(result.error.message).toContain("'br' is not installed");
  });

  test('a TOOL_FAILED envelope whose text looks like a missing binary is an error: no verdict from message text', () => {
    const run = () => ({
      ok: false,
      error: { code: 'TOOL_FAILED', message: "beads: capability 'tracker.create-detailed' failed: spawnSync br ENOENT" }
    });
    const result = findings.createFinding({ run }, ...ARGS.createFinding);
    expect(result.unavailable).toBeUndefined();
    expect(result.error.code).toBe('TOOL_FAILED');
  });

  test('finding text that looks like a spawn failure cannot make a real br failure unavailable', () => {
    // br fails (exit 3, ISSUE_NOT_FOUND on stdout); the runner's TOOL_FAILED message echoes the
    // argv, which carries the reason text.
    const { run } = deps({ close: ['br-close-missing.error.json', 3] });
    for (const reason of ['fixed', 'spawnSync br ENOENT']) {
      const result = findings.closeFinding({ run }, { id: 'ws-nope', reason, commit: 'abc1234' });
      expect(result.unavailable).toBeUndefined();
      expect(result.error.code).toBe('TOOL_FAILED');
    }
  });

  test('a genuine tool failure is NOT swallowed as unavailable', () => {
    const run = () => ({ ok: false, error: { code: 'TOOL_FAILED', message: 'beads: capability failed: database is locked' } });
    const result = findings.createFinding({ run }, ...ARGS.createFinding);
    expect(result.unavailable).toBeUndefined();
    expect(result.error.code).toBe('TOOL_FAILED');
  });

  test('createToolchainDeps: a repository with no initialised tracker workspace is unavailable and runs nothing', () => {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-findings-repo-')));
    tempDirs.push(repo);
    const br = replayBr({ list: 'br-list-unscoped.sample.json' });
    const result = findings.findByKey(
      findings.createToolchainDeps({ projectRoot: repo, env: br.env }),
      { key: 'k' }
    );
    expect(result).toEqual(UNAVAILABLE);
    expect(br.calls()).toEqual([]);
  });

  test('createToolchainDeps: with a .beads workspace the same call reaches br in that directory', () => {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-findings-repo-')));
    tempDirs.push(repo);
    fs.mkdirSync(path.join(repo, '.beads'));
    const br = replayBr({ list: 'br-list-unscoped.sample.json' });
    const result = findings.findByKey(
      findings.createToolchainDeps({ projectRoot: repo, env: br.env }),
      { key: 'dk:acme/repo:src/a.js:unchecked-path' }
    );
    expect(result).toMatchObject({ ok: true, found: true });
    expect(br.calls()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Input guards: refuse before any tracker call
// ---------------------------------------------------------------------------

describe('input validation refuses without calling the tracker', () => {
  const ok = { title: 't', description: 'd', labels: ['pr-review'], priority: 1, key: 'k' };
  const cases = [
    ['createFinding', { ...ok, key: '' }],
    ['createFinding', { ...ok, labels: [] }],
    ['createFinding', { ...ok, labels: ['a,b'] }],
    // A dash-led label is refused per label: the runner only checks the joined list, so a later
    // '-x' would otherwise be stored but never queryable.
    ['createFinding', { ...ok, labels: ['pr-review', '-x'] }],
    ['createFinding', { ...ok, labels: ['-x'] }],
    ['createFinding', { ...ok, priority: 5 }],
    ['createFinding', { ...ok, title: ' ' }],
    ['updateFinding', { id: 'b-1', title: 't', description: 'd', priority: 1, note: '' }],
    ['updateFinding', { id: 'b-1', title: 't', description: 'd', priority: -1, note: 'n' }],
    ['closeFinding', { id: 'b-1', reason: '   ', commit: 'abc1234' }],
    ['closeFinding', { id: 'b-1', reason: 'r', commit: 'not-a-sha' }],
    ['closeFinding', { id: 'b-1', reason: 'r' }]
  ];

  test.each(cases)('%s(%j) -> INVALID_ARG', (fn, input) => {
    const run = jest.fn();
    const result = findings[fn]({ run }, input);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_ARG');
    expect(run).not.toHaveBeenCalled();
  });

  // br refuses whitespace in an external reference (captured live: exit 4, "external_ref:
  // cannot contain whitespace", opaque once the runner has dropped br's message), so the key is
  // refused here. U+0085 is the case a plain JS `\s` misses.
  const WHITESPACE_KEYS = [
    ['a space', 'a b'],
    ['a tab', 'a\tb'],
    ['a newline', 'a\nb'],
    ['a no-break space (U+00A0)', 'a\u00a0b'],
    ['a next-line character (U+0085)', 'a\u0085b'],
    ['an ideographic space (U+3000)', 'a\u3000b'],
    ['a leading space', ' ab'],
    ['a trailing space', 'ab ']
  ];

  test.each(WHITESPACE_KEYS)('createFinding refuses a key with %s', (_name, key) => {
    const run = jest.fn();
    const result = findings.createFinding({ run }, { ...ok, key });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_ARG');
    expect(run).not.toHaveBeenCalled();
  });

  test.each(WHITESPACE_KEYS)('findByKey refuses a key with %s', (_name, key) => {
    const run = jest.fn();
    const result = findings.findByKey({ run }, { key });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_ARG');
    expect(run).not.toHaveBeenCalled();
  });

  test('a key with characters br does not treat as whitespace (U+200B, U+FEFF) is not refused', () => {
    const run = jest.fn(() => ({ ok: true, data: { id: 'b-1' } }));
    for (const key of ['dk:zero\u200bwidth', 'dk:bom\ufeffkey']) {
      expect(findings.createFinding({ run }, { ...ok, key }).ok).toBe(true);
    }
    expect(run).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Injection safety through the REAL runner: argv only, no shell, no re-expansion
// ---------------------------------------------------------------------------

describe('values reach br as literal argv entries, and a dash-led value never reaches br', () => {
  // Shell metacharacters, command substitution, quotes, a newline, and text that looks like the
  // manifest's own placeholders (naming the OTHER field's placeholder, so a second substitution
  // pass would visibly rewrite it). Every payload is INERT even if a shell did run it (`echo`,
  // `id`, redirection to /dev/null): a regression to a shell must fail this test, not act on it.
  const TITLE = 'T; echo injected && echo $(echo sub) `echo bt` | cat > /dev/null $HOME "q" \'r\' {description} ${description} {type}';
  const DESCRIPTION = 'D \\ * ? ~\nsecond line {title} ${title} {id} ${label} {labels}';
  const KEY = 'dk:`id`;$(id)|${label}{id}&&x>/dev/null';
  const at = (argv, flag) => argv[argv.indexOf(flag) + 1];

  test('createFinding: title, description and key round-trip unchanged', () => {
    const { run, br } = deps({ create: 'br-create-detailed.sample.json' });
    const result = findings.createFinding(
      { run },
      { title: TITLE, description: DESCRIPTION, labels: ['pr-review'], priority: 1, key: KEY }
    );
    expect(result.ok).toBe(true);
    const argv = br.calls()[0];
    expect(at(argv, '--title')).toBe(TITLE);
    expect(at(argv, '-d')).toBe(DESCRIPTION);
    expect(at(argv, '--external-ref')).toBe(KEY);
  });

  test('updateFinding and closeFinding: free text round-trips unchanged', () => {
    const update = deps({ update: 'br-update-detailed.sample.json' });
    expect(
      findings.updateFinding(
        { run: update.run },
        { id: 'ws-17y', title: TITLE, description: DESCRIPTION, priority: 0, note: DESCRIPTION }
      ).ok
    ).toBe(true);
    const updateArgv = update.br.calls()[0];
    expect(at(updateArgv, '--title')).toBe(TITLE);
    expect(at(updateArgv, '--description')).toBe(DESCRIPTION);
    expect(at(updateArgv, '--append-notes')).toBe(DESCRIPTION);

    const close = deps({ close: 'br-close-with-reason.sample.json' });
    expect(findings.closeFinding({ run: close.run }, { id: 'ws-17y', reason: DESCRIPTION, commit: 'def5678' }).ok).toBe(true);
    expect(at(close.br.calls()[0], '--reason')).toBe(DESCRIPTION);
  });

  test.each([
    ['key', { key: '-x' }],
    ['title', { title: '--help' }]
  ])('a dash-led %s is refused (INVALID_ARG) and br is never called', (_name, override) => {
    const { run, br } = deps({ create: 'br-create-detailed.sample.json' });
    const result = findings.createFinding(
      { run },
      { title: 't', description: 'd', labels: ['pr-review'], priority: 1, key: 'k', ...override }
    );
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_ARG');
    expect(br.calls()).toEqual([]);
  });
});
