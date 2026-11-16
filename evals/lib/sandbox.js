'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const envlib = require('./env');

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
 * Returns { dir, root, baseline, cleanup }.
 */
function createSandbox(scenarioDir, scenario = {}, { workdir = resolveWorkdir() } = {}) {
  fs.mkdirSync(workdir, { recursive: true });
  const root = fs.mkdtempSync(path.join(workdir, 'ensemble-eval-'));
  const dir = path.join(root, 'project');
  fs.mkdirSync(dir);
  const fixture = path.join(scenarioDir, 'fixture');
  if (fs.existsSync(fixture)) fs.cpSync(fixture, dir, { recursive: true });

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

  return {
    dir,
    root,
    baseline: { mainSha, remoteMainSha, remotePath },
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/** Resolve the claude binary: EVALS_CLAUDE_BIN override, else search PATH. Returns path or null. */
function findClaude(env = process.env) {
  if (env.EVALS_CLAUDE_BIN) return fs.existsSync(env.EVALS_CLAUDE_BIN) ? env.EVALS_CLAUDE_BIN : null;
  for (const d of (env.PATH || '').split(path.delimiter)) {
    const p = path.join(d, 'claude');
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* next */ }
  }
  return null;
}

/** Build claude CLI argv for a scenario. */
function buildClaudeArgs(scenario, { repoRoot, model, maxUsd }) {
  const prompt = scenario.prompt.split('{{repo}}').join(repoRoot);
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
    '--permission-mode', scenario.permissionMode || 'acceptEdits',
    '--max-turns', String(scenario.maxTurns || 25)];
  if (maxUsd) args.push('--max-budget-usd', String(maxUsd));
  if (model) args.push('--model', model);
  if (scenario.allowedTools && scenario.allowedTools.length) args.push('--allowedTools', scenario.allowedTools.join(','));
  for (const pkg of scenario.plugins || []) args.push('--plugin-dir', path.join(repoRoot, 'packages', pkg));
  return args;
}

/** Pull turns / cost from the final `result` line of a stream-json transcript. */
function summarizeTranscript(transcript) {
  let summary = { turns: null, costUsd: null, isError: null, resultText: null };
  for (const line of String(transcript).split('\n')) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o && o.type === 'result') {
      summary = {
        turns: o.num_turns ?? null,
        costUsd: o.total_cost_usd ?? o.cost_usd ?? null,
        isError: o.is_error ?? null,
        resultText: typeof o.result === 'string' ? o.result.slice(0, 500) : null,
      };
    }
  }
  return summary;
}

module.exports = { createSandbox, resolveWorkdir, findClaude, buildClaudeArgs, summarizeTranscript, DEFAULT_WORKDIR };
