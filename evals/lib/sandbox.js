'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const envlib = require('./env');
const claude = require('./runners/claude');
const arms = require('./arms');
const { copyFixture } = require('./fixture');
const setupLib = require('./setup');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_WORKDIR = path.join(os.homedir(), '.omp', 'evals-work');
const FORBIDDEN_ROOTS = ['/tmp', '/private/tmp', '/var/tmp', '/private/var/tmp', '/var/folders', '/private/var/folders'];

const within = (child, parent) => child === parent || child.startsWith(parent + path.sep);

/** realpath of the longest existing ancestor of `p`, with the missing remainder re-appended (so symlinks cannot hide a target). */
function realish(p) {
  const rest = [];
  let cur = path.resolve(p);
  for (;;) {
    try { return path.join(fs.realpathSync(cur), ...rest.reverse()); } catch { /* climb */ }
    const up = path.dirname(cur);
    if (up === cur) return path.join(cur, ...rest.reverse());
    rest.push(path.basename(cur));
    cur = up;
  }
}

/**
 * Directory under which every workspace and per-run CI HOME is created: EVALS_WORKDIR, default ~/.omp/evals-work/.
 * Symlinks are resolved first. Refuses /tmp, /var/tmp, /var/folders and $TMPDIR (wiped on reboot) and anything
 * inside the repository.
 */
function resolveWorkdir(env = process.env, repoRoot = REPO_ROOT) {
  const dir = realish(env.EVALS_WORKDIR || DEFAULT_WORKDIR);
  const temps = [...FORBIDDEN_ROOTS, os.tmpdir(), env.TMPDIR].filter(Boolean).flatMap((r) => [path.resolve(r), realish(r)]);
  if (temps.some((r) => within(dir, r))) throw new Error(`EVALS_WORKDIR must not be under /tmp or the temp directory: ${dir}`);
  if (within(dir, realish(repoRoot))) throw new Error(`EVALS_WORKDIR must be outside the repository: ${dir}`);
  return dir;
}

function git(cwd, args) {
  const r = spawnSync('git', [...envlib.GIT_HARDEN, ...args], { cwd, encoding: 'utf8', env: envlib.gitEnv() });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

/**
 * Create a throwaway git repo from scenarios/<id>/fixture on branch `main`, as a fresh copy under `workdir`
 * (default: EVALS_WORKDIR), never inside the repository.
 * With scenario.remote === true, also creates a bare `origin` and pushes main.
 * With scenario.branch (a name), then checks that branch out at the fixture commit and, with a remote, pushes it too (a scenario about a
 * pull request needs its head branch to exist; main stays where it is).
 * With scenario.setup (argv arrays, see lib/setup.js) runs them between the fixture commit and the baseline; with scenario.remote the sandbox git
 * config also gets push.autoSetupRemote=true.
 * Returns { dir, root, baseline, skipped, setupError (null, or the named reason a setup command failed), configBefore (the git config bytes before setup, for the late re-scan; null without setup), cleanup } (`skipped`: fixture entries not copied).
 */
function createSandbox(scenarioDir, scenario = {}, { workdir = resolveWorkdir(), setupTimeoutMs, setupTotalMs, parentEnv = process.env, _setupUnsafeAllowAny = false } = {}) {
  fs.mkdirSync(workdir, { recursive: true });
  const root = fs.mkdtempSync(path.join(workdir, 'ensemble-eval-'));
  const dir = path.join(root, 'project');
  const cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  try {
    fs.mkdirSync(dir);
    const fixture = path.join(scenarioDir, 'fixture');
    // Defensive copy: agent/git configuration and symlinks pointing outside the fixture are never copied (see lib/fixture.js).
    const skipped = fs.existsSync(fixture) ? copyFixture(fixture, dir) : [];

    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'user.email', 'eval@example.invalid']);
    git(dir, ['config', 'user.name', 'eval']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
    // Sandbox-local only (never the maintainer's global config): a bare `git push` of a new branch must work against the sandbox origin.
    if (scenario.remote) git(dir, ['config', 'push.autoSetupRemote', 'true']);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '--allow-empty', '-m', 'fixture']);

    let configBefore = null;
    let remotePath = null;
    if (scenario.remote) {
      const bare = path.join(root, 'origin.git');
      git(root, ['init', '-q', '--bare', '-b', 'main', bare]);
      git(dir, ['remote', 'add', 'origin', bare]);
      remotePath = bare;
    }

    // Setup runs after the fixture commit and before the baseline is taken, so a setup that commits (git add -A; git commit) moves the
    // baseline with it. A setup failure does not throw: the caller records an incomplete run with the named reason.
    if (Array.isArray(scenario.setup) && scenario.setup.length) {
      configBefore = fs.readFileSync(path.join(dir, '.git', 'config'));
      let failure = setupLib.runSetup(scenario.setup, { dir, home: path.join(root, 'setup-home'), parentEnv, timeoutMs: setupTimeoutMs, totalMs: setupTotalMs, _unsafeAllowAny: _setupUnsafeAllowAny });
      if (!failure) failure = setupLib.checkAfterSetup(dir, configBefore);
      if (failure) {
        return { dir, root, baseline: { mainSha: null, remoteMainSha: null, remotePath }, skipped, setupError: failure, configBefore, cleanup };
      }
    }

    const mainSha = git(dir, ['rev-parse', 'main']);
    let remoteMainSha = null;
    if (scenario.remote) {
      git(dir, ['push', '-q', 'origin', 'main']);
      remoteMainSha = git(remotePath, ['--git-dir', remotePath, 'rev-parse', 'refs/heads/main']);
    }

    if (scenario.branch) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(scenario.branch) || scenario.branch.includes('..') || scenario.branch === 'main') throw new Error(`invalid scenario branch: ${scenario.branch}`);
      git(dir, ['checkout', '-q', '-b', scenario.branch]);
      if (scenario.remote) git(dir, ['push', '-q', 'origin', scenario.branch]);
    }

    return {
      dir,
      root,
      baseline: { mainSha, remoteMainSha, remotePath },
      skipped,
      setupError: null,
      configBefore,
      cleanup,
    };
  } catch (e) {
    cleanup();
    throw e;
  }
}

/**
 * Compatibility wrappers: the claude invocation lives in runners/claude.js behind the runner interface.
 * `buildClaudeArgs` builds argv for a legacy scenario (same shape as before, plus --setting-sources project).
 */
function buildClaudeArgs(scenario, { repoRoot, model, maxUsd }) {
  return claude.buildArgs(arms.scenarioJob(scenario, { repoRoot, model, maxUsd }));
}

module.exports = {
  createSandbox, resolveWorkdir, findClaude: claude.findClaude, buildClaudeArgs, summarizeTranscript: claude.summarizeTranscript, DEFAULT_WORKDIR,
};
