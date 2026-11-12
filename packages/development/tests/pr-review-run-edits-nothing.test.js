'use strict';

/**
 * A review run edits no file and pushes nothing
 * (docs/plans/pr-review-speedup-plan.md section 3H, acceptance test (a); kata sp4w, AC2).
 *
 * The skill is prose, so a run is an agent following it. What is mechanically provable is
 * the toolbox the review path uses: every `pr-review-cli.js` subcommand. This drives the
 * real CLI as a review run does, from inside a fixture repository that has a real bare
 * `origin`, and checks what a review run must leave alone: the working tree, the index,
 * every ref, the commits and the remote. The one thing a run may write, the review-state
 * report, goes under the gitignored `.ensemble/pr-review/`. `git`, `gh`, `br` and `curl`
 * are replaced by logging shims, so a subcommand that shells out (to commit, push or fetch)
 * is caught even when it would have failed.
 *
 * The prose half (the review path names no fix or push step) is in
 * pr-review-never-fixes-skill.test.js.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'lib', 'pr-review-cli.js');
const ISO = '2026-11-07T10:00:00Z';

/** Run real git with the shims off the PATH. */
function git(cwd, args, env = process.env) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', env });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
  return res.stdout.trim();
}

/** Every file under `root` (relative path -> contents), ignoring `.git` and the state-report dir. */
function snapshotTree(root) {
  const out = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);
      if (rel === '.git' || rel === '.ensemble' || rel === 'shims' || rel === 'shim.log') continue;
      if (entry.isDirectory()) walk(full);
      else out[rel] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(root);
  return out;
}

function repoState(cwd, origin) {
  return {
    head: git(cwd, ['rev-parse', 'HEAD']),
    refs: git(cwd, ['for-each-ref']),
    status: git(cwd, ['status', '--porcelain']),
    staged: git(cwd, ['diff', '--cached', '--name-only']),
    remote: git(cwd, ['ls-remote', origin]),
    log: git(cwd, ['log', '--format=%H %s', '--all']),
    tree: snapshotTree(cwd),
  };
}

let sandbox;
let repo;
let origin;
let baseSha;
let headSha;
let shimDir;
let shimLog;

beforeAll(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-review-no-edit-'));
  origin = path.join(sandbox, 'origin.git');
  repo = path.join(sandbox, 'repo');
  fs.mkdirSync(repo);
  git(sandbox, ['init', '--bare', '-b', 'main', origin]);
  git(repo, ['init', '-b', 'main']);
  git(repo, ['config', 'user.email', 'ci@example.invalid']);
  git(repo, ['config', 'user.name', 'ci']);
  git(repo, ['remote', 'add', 'origin', origin]);
  fs.writeFileSync(path.join(repo, '.gitignore'), '.ensemble/\nshims/\nshim.log\n');
  fs.writeFileSync(path.join(repo, 'a.js'), 'module.exports = 1;\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'base']);
  baseSha = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['checkout', '-b', 'feature']);
  fs.writeFileSync(path.join(repo, 'a.js'), 'module.exports = 2;\n');
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'b.js'), 'module.exports = 3;\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'feature']);
  headSha = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['push', 'origin', 'main:main', 'feature:feature']);

  // Logging shims for every command a review run could use to change something.
  shimDir = path.join(repo, 'shims');
  shimLog = path.join(repo, 'shim.log');
  fs.mkdirSync(shimDir);
  for (const name of ['git', 'gh', 'br', 'curl', 'npm']) {
    const file = path.join(shimDir, name);
    fs.writeFileSync(file, `#!/bin/sh\necho "${name} $*" >> "${shimLog}"\nexit 1\n`);
    fs.chmodSync(file, 0o755);
  }
});

afterAll(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

/** The CLI as a review run invokes it: cwd is the repository, git and the host CLIs are shims. */
function runCli(args, payload) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: repo,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, PATH: `${shimDir}${path.delimiter}${process.env.PATH}` },
  });
}

const finding = (overrides = {}) => ({
  id: 'F-1',
  source: 'reviewer-1',
  locationOrLink: 'src/b.js:1',
  severity: 'important',
  failureMode: 'unchecked input',
  disposition: 'fix',
  evidence: 'line 1',
  originalTextOrLink: 'https://example.invalid/r/1',
  ...overrides,
});

/** The review path in the order SKILL.md runs it, each with a payload that is accepted. */
function reviewPath() {
  const ledger = [finding()];
  return [
    ['scope', { baseSha, headSha }],
    ['policy', { text: null }],
    ['rules', { files: [] }],
    ['paths', { changedFiles: ['a.js', 'src/b.js'] }],
    ['ledger', { action: 'validate', findings: ledger }],
    ['ledger', { action: 'dedupe', findings: ledger }],
    ['ledger', { action: 'isActionable', finding: ledger[0] }],
    ['review-range', { baseSha, headSha, lastReviewedSha: baseSha, commits: [{ sha: headSha, parents: [baseSha] }], remediationShas: [] }],
    [
      'status',
      {
        baseSha,
        headSha,
        reviewedHeadSha: headSha,
        reviewedTreeSha: git(repo, ['rev-parse', `${headSha}^{tree}`]),
        findingCounts: { total: 1, actionable: 1, deferred: 0 },
        tests: { exitCode: 0, skipped: false, command: 'npm test' },
      },
    ],
    ['state-write', { prId: 'fixture-pr-1', state: { headSha, baseSha, ledger } }],
    ['state-read', { prId: 'fixture-pr-1', headSha }],
    ['gate', { headSha, ledger }],
  ];
}

/** The STORED state `ledger resolve` reads a finding from: its id, and the ledger that holds it (kata 0465). */
const stored = (entry) => ({ id: entry.id, ledger: [entry] });

describe('a review run edits no file and pushes nothing', () => {
  test('the review path through the real CLI leaves the tree, refs, commits and origin untouched and writes only the gitignored state report', () => {
    const before = repoState(repo, origin);

    const results = reviewPath().map(([sub, payload]) => ({ sub, res: runCli([sub], payload) }));

    // The run really ran: each step answered with JSON (a skipped or crashed step proves nothing).
    for (const { sub, res } of results) {
      expect(res.stderr).toBe('');
      expect(() => JSON.parse(res.stdout)).not.toThrow();
      expect([sub, res.status]).toEqual([sub, 0]);
    }

    const after = repoState(repo, origin);
    expect(after.head).toBe(before.head);
    expect(after.refs).toBe(before.refs);
    expect(after.log).toBe(before.log);
    expect(after.remote).toBe(before.remote);
    expect(after.staged).toBe('');
    expect(after.tree).toEqual(before.tree);
    // `git status` is clean: the only new file is the ignored state report.
    expect(after.status).toBe('');
    const report = path.join(repo, '.ensemble', 'pr-review', 'pr-fixture-pr-1.json');
    expect(fs.existsSync(report)).toBe(true);
    expect(git(repo, ['check-ignore', '.ensemble/pr-review/pr-fixture-pr-1.json'])).not.toBe('');
    // No step shelled out to git or a host CLI (a shim would have logged it, even failing).
    expect(fs.existsSync(shimLog) ? fs.readFileSync(shimLog, 'utf8') : '').toBe('');
  });

  test('no subcommand edits a file, runs git or a host CLI, or touches the remote, whatever it is given', () => {
    const usage = fs
      .readFileSync(CLI, 'utf8')
      .match(/Usage: node pr-review-cli\.js <([a-z|-]+)/);
    expect(usage).not.toBeNull();
    const subcommands = usage[1].split('|');
    expect(subcommands.length).toBeGreaterThan(10);

    const before = repoState(repo, origin);
    const garbage = [{}, { action: 'resolve', ...stored(finding()), resolution: { reason: 'r', by: 'someone', headSha, at: ISO } }];
    for (const sub of subcommands) {
      // state-write is the one subcommand allowed to write, and only the report: covered above.
      if (sub === 'state-write') continue;
      for (const payload of garbage) runCli([sub], payload);
    }
    const after = repoState(repo, origin);

    expect(after).toEqual(before);
    // A shell-out to commit, push, fetch or call the host would be logged even if the shim failed it.
    expect(fs.existsSync(shimLog) ? fs.readFileSync(shimLog, 'utf8') : '').toBe('');
  });
});
