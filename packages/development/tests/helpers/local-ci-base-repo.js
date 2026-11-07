'use strict';

/**
 * Real temp git repo for the local CI gate tests. The trusted config
 * (.ensemble/local-ci.yaml) is committed at a BASE commit, exposed as the REMOTE-TRACKING ref
 * `origin/trusted-base` (refs/remotes/origin/trusted-base, which only a fetch populates, exactly
 * what the gate requires of a baseRef; a local branch of that name would be refused);
 * the PR head is a descendant commit and is left CHECKED OUT, which is exactly the
 * situation that used to let a PR grade itself. Optional `headFiles` are committed
 * on the head only (path -> text, null deletes).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE_BRANCH = 'trusted-base';
const BASE_REF = `origin/${BASE_BRANCH}`;
const CONFIG_PATH = '.ensemble/local-ci.yaml';
const roots = [];

// Every test that imports this helper drives `gate`. Keep them off the machine's real gate lock (~/.ensemble/locks):
// a maintainer's running gate must not stall the test run, and tests must not write into the home directory. Spawned
// CLI processes inherit this. A test that wants a specific lock directory sets its own.
if (!process.env.ENSEMBLE_LOCAL_CI_LOCK_DIR) {
  process.env.ENSEMBLE_LOCAL_CI_LOCK_DIR = path.join(os.tmpdir(), `ensemble-test-gate-locks-${process.pid}`);
}

function makeBaseRepo({ config, files = {}, headFiles = {}, baseRef = BASE_REF } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ci-base-'));
  roots.push(dir);
  const git = (...args) => String(execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'pipe' })).trim();
  const put = (rel, text) => {
    const abs = path.join(dir, rel);
    if (text === null) return fs.rmSync(abs, { force: true });
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  };
  git('init', '-q', '-b', 'main');
  if (config !== null && config !== undefined) put(CONFIG_PATH, config);
  put('README.md', 'x\n');
  for (const [rel, text] of Object.entries(files)) put(rel, text);
  git('add', '-A');
  git('commit', '-qm', 'base');
  const baseSha = git('rev-parse', 'HEAD');
  // A remote-tracking ref, as a fetch of the PR's base branch would leave it (no remote needed for the ref to exist).
  git('update-ref', `refs/remotes/${baseRef}`, baseSha);
  put('head.txt', 'pr head\n');
  for (const [rel, text] of Object.entries(headFiles)) put(rel, text);
  git('add', '-A');
  git('commit', '-qm', 'head');
  const headSha = git('rev-parse', 'HEAD');
  return { dir, baseSha, headSha, sha: headSha, baseRef, git };
}

function cleanupBaseRepos() {
  for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true });
}

/** The PR number and repository the tests pretend to be gating. */
const PR = 7;
const REPO = 'o/r';

/**
 * A `prInfo` dependency standing in for `gh pr view`: GitHub's answer for the PR under test. The default is the honest
 * one (the PR targets `trusted-base` and its head is the repo's head commit); a test states an attack by overriding a
 * field, e.g. { baseRefName: 'main' } or { headRefOid: '<other sha>' }. `calls` records every lookup.
 */
function prInfoFor(fx, answer = {}) {
  const calls = [];
  const prInfo = (args) => {
    calls.push(args);
    if (answer.error) return { ok: false, error: answer.error };
    return { ok: true, info: { baseRefName: BASE_BRANCH, headRefOid: fx.headSha, state: 'OPEN', ...answer } };
  };
  prInfo.calls = calls;
  return prInfo;
}

/**
 * An in-process stand-in for `postStatus` (the gate's one outward call). Synchronous, like the real one. By default it
 * records the request and reports it published; `fail` makes it report `{ published: false, reason }`, i.e. `gh` could
 * not post. `calls` is every request; `statuses()` the ones that were published, as { sha, body: {state,context,description} }.
 */
function fakePostStatus({ fail } = {}) {
  const calls = [];
  const fn = (req) => {
    calls.push(req);
    if (fail) return { published: false, reason: typeof fail === 'string' ? fail : 'gh could not post the status' };
    return { published: true, repo: req.repo, sha: req.sha, state: req.state, context: req.context, id: 99 };
  };
  fn.calls = calls;
  fn.statuses = () => calls.map((c) => ({ sha: c.sha, repo: c.repo, body: { state: c.state, context: c.context, description: c.description } }));
  return fn;
}

/**
 * A real `gh` executable in a temp dir, for tests that spawn the CLI as a process. It answers `gh pr view` with the
 * given JSON, answers `gh api -X POST repos/<repo>/statuses/<sha> -f k=v ...` (recording the argv, one arg per line, to
 * `<dir>/posted.txt`, and replying with an id) unless `postFails` is set, in which case it fails like a 403, and exits
 * non-zero for anything else. Returns the directory to put first on PATH; read `<dir>/posted.txt` for what was posted.
 */
function fakeGhDir(info, { postFails = false } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ci-fakegh-'));
  roots.push(d);
  const post = postFails
    ? `echo "gh: HTTP 403: Resource not accessible" >&2; exit 1`
    : `for a in "$@"; do printf '%s\\n' "$a" >> '${path.join(d, 'posted.txt')}'; done; printf '%s' '{"id":99}'; exit 0`;
  const script = `#!/bin/sh\nif [ "$1" = "pr" ] && [ "$2" = "view" ]; then printf '%s' '${JSON.stringify(info)}'; exit 0; fi\nif [ "$1" = "api" ] && [ "$2" = "-X" ] && [ "$3" = "POST" ]; then ${post}; fi\necho "unexpected gh call: $*" >&2\nexit 2\n`;
  fs.writeFileSync(path.join(d, 'gh'), script, { mode: 0o755 });
  return d;
}

/** The argv lines a fake `gh` recorded for its `api` POSTs ([] if none). */
function postedArgs(ghDir) {
  const f = path.join(ghDir, 'posted.txt');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
}

module.exports = { makeBaseRepo, cleanupBaseRepos, prInfoFor, fakePostStatus, fakeGhDir, postedArgs, PR, REPO, BASE_REF, BASE_BRANCH, CONFIG_PATH };
