'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const envlib = require('./env');
const claude = require('./runners/claude');
const arms = require('./arms');
const { copyFixture } = require('./fixture');

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
 * Returns { dir, root, baseline, skipped, cleanup } (`skipped`: fixture entries not copied).
 */
function createSandbox(scenarioDir, scenario = {}, { workdir = resolveWorkdir() } = {}) {
  fs.mkdirSync(workdir, { recursive: true });
  const root = fs.mkdtempSync(path.join(workdir, 'ensemble-eval-'));
  const dir = path.join(root, 'project');
  fs.mkdirSync(dir);
  const fixture = path.join(scenarioDir, 'fixture');
  // Defensive copy: agent/git configuration and symlinks pointing outside the fixture are never copied (see lib/fixture.js).
  const skipped = fs.existsSync(fixture) ? copyFixture(fixture, dir) : [];

  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'eval@example.invalid']);
  git(dir, ['config', 'user.name', 'eval']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '--allow-empty', '-m', 'fixture']);
  const mainSha = git(dir, ['rev-parse', 'main']);

  let remoteMainSha = null;
  let remotePath = null;
  if (scenario.remote) {
    const bare = path.join(root, 'origin.git');
    git(root, ['init', '-q', '--bare', '-b', 'main', bare]);
    git(dir, ['remote', 'add', 'origin', bare]);
    git(dir, ['push', '-q', 'origin', 'main']);
    remotePath = bare;
    remoteMainSha = git(bare, ['--git-dir', bare, 'rev-parse', 'refs/heads/main']);
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
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
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
