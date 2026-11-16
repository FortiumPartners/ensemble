'use strict';

/**
 * Isolated kata scratch workspace harness (TRD-2026-6995dc96 TRD-001, PRD REQ-012 AC-012-1,
 * REQ-016 AC-016-1 and AC-016-3).
 *
 * `kataScratch()` binds a throwaway directory to a synthetic project inside its own
 * `KATA_HOME` and git state, so kata reads and writes nothing belonging to a real project. It
 * returns the env every kata call needs, a recorder for the four read commands the mapping
 * tasks map, and a teardown that removes the scratch directory.
 *
 * Isolation works because of the env, not of any kata-side containment: `KATA_HOME` points
 * inside the scratch directory, so kata's daemon database, runtime directory and hooks are all
 * created there and removed with it, and `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` point at
 * files inside it, so binding the workspace can neither read nor write the developer's global
 * git config. `KATA_SERVER` and `KATA_AUTH_TOKEN` are never forwarded from the parent, so a
 * scratch call cannot be pointed at a gateway or at the developer's own running instance.
 *
 * Kata rejects a local-path git remote (`parse remote url "...": not a recognized form`, exit
 * 3), so the workspace origin is a URL on `example.invalid` (RFC 2606 reserved). Kata parses
 * that remote to derive a project alias and never contacts it; `--project` names the project
 * explicitly, so nothing depends on the host resolving.
 *
 * Nothing here requires the kata binary: the guard in ./kata-guard.js is what decides whether
 * a suite runs, so requiring this module stays side-effect free on a machine without kata.
 * `kataScratch()` throws on a missing binary rather than returning a half-working workspace.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { kataPath, SCRATCH_ROOT } = require('./kata-guard');

/** Project name a scratch workspace binds to; never a real project's name. */
const SCRATCH_PROJECT = 'trd-kata-scratch';

/** RFC 2606 reserved origin for the synthetic git remote; never contacted. */
const ORIGIN_URL_PREFIX = 'git@example.invalid';

/** The four read commands whose envelopes the mapping tasks consume (TRD-002..004). */
const READ_COMMANDS = ['list', 'show', 'ready', 'status'];

/**
 * Items seeded into a fresh scratch workspace: two open items joined by one blocking edge, one
 * of them closed carrying the dedupe key, so `list`, `ready` and `show` each have a realistic
 * shape to answer with. `gamma` is closed at seed time because AC 3 needs a closed item's
 * envelope too, and a scratch workspace must not depend on anything outside itself.
 */
const SEED_ITEMS = [
  { short: 'alpha', title: 'Scratch probe alpha', body: 'open item carrying two labels', priority: 2, labels: ['probe', 'seed'], owner: 'bot:probe' },
  { short: 'beta', title: 'Scratch probe beta', body: 'second open item, blocks alpha', priority: 3, labels: ['probe'] },
  { short: 'gamma', title: 'Scratch probe gamma', body: 'closed item carrying the dedupe key', priority: 1, labels: ['probe'], externalKey: 'TRD-SEED-0001', close: true },
];

/** Kata's own 40-character minimum for a `close --done` message (`kata close --help`). */
const CLOSE_REASON = 'seeded scratch item closed by the trd-001 harness recording probe';

/**
 * Parent variables that reach a scratch `kata` call, mirroring the shipped runner's own base
 * env allowlist (`lib/toolchain/runner.js` `BASE_ENV_ALLOWLIST`).
 */
const CHILD_ENV_BASE = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'TMPDIR', 'TERM', 'TZ'];

/**
 * Sleep `ms` synchronously; callers need it around kata's daemon auto-start, which is not
 * something a synchronous helper can await.
 * @param {number} ms
 */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(8)), 0, 0, ms);
}

/**
 * Run one argv under `env`, capturing stdout and stderr, and never throw.
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} env
 * @param {number} [timeoutMs]
 * @returns {{status:number|null, signal:string|null, stdout:string, stderr:string, error?:unknown}}
 */
function run(argv, env, timeoutMs = 20000) {
  const res = spawnSync(argv[0], argv.slice(1), {
    env,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: res.status,
    signal: res.signal ?? null,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    ...(res.error ? { error: res.error } : {}),
  };
}

/**
 * Parse stdout as a JSON envelope, returning null when it is not one.
 * @param {string} stdout
 * @returns {object|null}
 */
function parseJson(stdout) {
  try {
    const value = JSON.parse(stdout);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Remove a directory tree, tolerating it already being gone.
 *
 * Kata's daemon can hold `kata-home/kata.db` open for a moment after `daemon stop`, so the
 * removal is retried briefly before the failure is allowed to surface: a leftover directory
 * would mean AC-016-1's teardown promise was not kept.
 * @param {string} dir
 */
function removeTree(dir) {
  const deadline = Date.now() + 2000;
  for (;;) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      if (!fs.existsSync(dir)) return;
      if (Date.now() >= deadline) throw err;
      sleep(50);
    }
  }
}

/**
 * One isolated kata scratch workspace: bound directory, own `KATA_HOME`, own git state.
 *
 * Callers own the teardown. `withKataScratch()` does it automatically; a test that calls
 * `kataScratch()` directly must call `cleanup()` in a `finally`, otherwise the scratch
 * directory and its daemon outlive the run.
 *
 * @param {{root?:string, project?:string, originHost?:string, home?:string}} [opts]
 *   `root` is the parent directory the scratch directory is created under (a test may pass its
 *   own temp dir; defaults to `SCRATCH_ROOT`); `project` the bound project name;
 *   `originHost` the origin prefix for the synthetic remote URL;
 *   `home` overrides `KATA_HOME` for a deliberately-shared-daemon probe.
 * @returns {{dir:string, home:string, workspace:string, originUrl:string, project:string,
 *   env:NodeJS.ProcessEnv, errors:string[],
 *   kata:(args:string[], timeoutMs?:number)=>object,
 *   runInWorkspace:(args:string[], timeoutMs?:number)=>object,
 *   init:()=>void, seed:()=>string[], id:(shortId:string)=>string, ids:()=>string[],
 *   record:(opts?:{showId?:string})=>Record<string,object>,
 *   recordFixtures:(dir:string)=>string[],
 *   stopDaemon:()=>void, cleanup:()=>void}}
 */
function kataScratch(opts = {}) {
  if (!kataPath()) {
    throw new Error(
      'kataScratch(): no kata binary on PATH. Wrap the calling suite in guardKata() from ' +
        './kata-guard.js so it is reported skipped with reason "tool absent" instead (AC-016-1).',
    );
  }

  const root = opts.root || SCRATCH_ROOT;
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, 'kata-'));

  const home = opts.home || path.join(dir, 'kata-home');
  const workspace = path.join(dir, 'workspace');
  const project = opts.project || SCRATCH_PROJECT;
  const originHost = opts.originHost || ORIGIN_URL_PREFIX;
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });

  /** Commands that failed, so a caller can assert the harness itself was healthy. */
  const errors = [];

  const baseEnv = {};
  for (const name of CHILD_ENV_BASE) {
    if (typeof process.env[name] === 'string') baseEnv[name] = process.env[name];
  }
  const env = { ...baseEnv, KATA_HOME: home };
  const gitEnv = {
    ...baseEnv,
    GIT_CONFIG_GLOBAL: path.join(dir, 'gitconfig'),
    GIT_CONFIG_SYSTEM: path.join(dir, 'gitconfig-system'),
    GIT_TERMINAL_PROMPT: '0',
  };
  const originUrl = `${originHost}:${project}.git`;

  /**
   * Run one `kata` invocation in this workspace's isolated environment.
   * @param {string[]} args
   * @param {number} [timeoutMs]
   */
  const kata = (args, timeoutMs) => run(['kata', ...args], env, timeoutMs);

  /**
   * Run one `kata` invocation with the workspace as cwd, which is where kata reads the binding
   * file written by `init` from.
   * @param {string[]} args
   * @param {number} [timeoutMs]
   */
  function runInWorkspace(args, timeoutMs) {
    const res = spawnSync('kata', args, {
      env,
      cwd: workspace,
      encoding: 'utf8',
      timeout: timeoutMs || 20000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return {
      status: res.status,
      signal: res.signal ?? null,
      stdout: res.stdout || '',
      stderr: res.stderr || '',
      ...(res.error ? { error: res.error } : {}),
    };
  }

  /** True once `init()` has bound the workspace; keeps a second call a no-op. */
  let bound = false;

  /** Short ids created by `seed()`, in seed order; empty until seeded. */
  let seeded = [];
  /**
   * `git init` the workspace, commit once, add the synthetic origin, then `kata init` it.
   *
   * The commit exists because kata derives its project identity from the repo and an empty
   * repository has no HEAD to read.
   *
   * Idempotent: `withKataScratch()` binds the workspace before calling the body, and a body
   * that binds it again would otherwise trip `git remote add`'s "remote origin already exists"
   * and record a harness error that is really just a second call.
   */
  function init() {
    if (bound) return;
    const git = (args) => {
      const res = run(['git', ...args], gitEnv);
      if (res.status !== 0) {
        errors.push(`git ${args.join(' ')}: exit ${res.status} ${res.stderr.trim()}`);
      }
      return res;
    };
    git(['init', '--initial-branch=main', workspace]);
    git(['-C', workspace, 'config', 'user.email', 'kata-scratch@example.invalid']);
    git(['-C', workspace, 'config', 'user.name', 'kata-scratch']);
    git(['-C', workspace, 'commit', '--allow-empty', '-m', 'kata scratch binding']);
    git(['-C', workspace, 'remote', 'add', 'origin', originUrl]);

    const res = runInWorkspace(['init', '--project', project]);
    if (res.status !== 0) {
      errors.push(`kata init --project ${project}: exit ${res.status} ${res.stderr.trim()}`);
      return;
    }
    bound = true;
  }

  /**
   * Create `SEED_ITEMS`, the blocking edge, and the closed item's dedupe key.
   *
   * Idempotent: a second call returns the ids from the first instead of duplicating items.
   *
   * @returns {string[]} short ids in seed order (null entries where a create failed)
   */
  function seed() {
    if (seeded.length) return seeded;
    const ids = [];
    for (const item of SEED_ITEMS) {
      const args = ['create', item.title, '--body', item.body, '--priority', String(item.priority), '--json'];
      if (item.externalKey) args.push('--meta', `ensemble_external_key=${item.externalKey}`);
      for (const label of item.labels || []) args.push('--label', label);
      const created = runInWorkspace(args);
      const envelope = parseJson(created.stdout);
      const shortId = envelope && envelope.issue && envelope.issue.short_id;
      if (created.status !== 0 || !shortId) {
        errors.push(
          `kata create ${item.title}: exit ${created.status} ${(created.stderr || created.stdout).trim()}`,
        );
        ids.push(null);
        continue;
      }
      ids.push(shortId);
      if (item.owner) {
        // Ownership is what kata's own `status` envelope reports an item's state from, so a
        // seeded item that carries one is what makes that envelope's `owner` field non-empty.
        const assigned = runInWorkspace(['assign', shortId, item.owner, '--json']);
        if (assigned.status !== 0) {
          errors.push(`kata assign ${shortId} ${item.owner}: exit ${assigned.status} ${assigned.stderr.trim()}`);
        }
      }
      if (item.close) {
        const closed = runInWorkspace([
          'close', shortId, '--done', '-m', CLOSE_REASON,
          '--test', `kata show ${shortId}`, '--json',
        ]);
        if (closed.status !== 0) {
          errors.push(`kata close ${shortId}: exit ${closed.status} ${closed.stderr.trim()}`);
        }
      }
    }
    const [alpha, beta] = ids;
    if (alpha && beta) {
      const edge = runInWorkspace(['edit', alpha, '--blocked-by', beta, '--json']);
      if (edge.status !== 0) {
        errors.push(`kata edit ${alpha} --blocked-by ${beta}: exit ${edge.status} ${edge.stderr.trim()}`);
      }
    }
    seeded = ids;
    return ids;
  }

  /** The ids `seed()` created; empty until seeded. */
  const ids = () => seeded.slice();

  /** Full `project#short_id` ref, which is how kata's own envelopes address an item. */
  const id = (shortId) => `${project}#${shortId}`;

  /**
   * Run each of `READ_COMMANDS` over the seeded workspace and return the parsed envelopes.
   *
   * Seeds first when nothing has been seeded, so a caller that only wants fixtures gets a
   * populated workspace without driving `init()`/`seed()` by hand.
   *
   * @param {{showId?:string}} [opts] `showId` the short id `show` and `status` address;
   *   defaults to the first seeded item, and `status` is recorded against it.
   * @returns {Record<string, object>} one entry per command, keyed by command name
   */
  function record(opts = {}) {
    if (!seeded.length) seed();
    const target = opts.showId || seeded.find(Boolean);
    const argv = {
      // `--status` takes exactly one of open|closed|all — a CSV is rejected with exit 3 — and
      // the default row cap is 200, so `--limit 0` pins "every row" for a fixture.
      list: ['list', '--status', 'all', '--limit', '0', '--json'],
      show: target ? ['show', target, '--json'] : ['show', '--json'],
      ready: ['ready', '--json'],
      status: target ? ['status', target, '--json'] : ['status', '--json'],
    };
    const envelopes = {};
    for (const name of READ_COMMANDS) {
      const res = runInWorkspace(argv[name]);
      const envelope = parseJson(res.stdout);
      if (res.status !== 0 || !envelope) {
        errors.push(`kata ${argv[name].join(' ')}: exit ${res.status} ${(res.stderr || res.stdout).trim()}`);
      }
      envelopes[name] = envelope || { command: argv[name], status: res.status, stderr: res.stderr };
    }
    return envelopes;
  }

  /**
   * Record the four envelopes and write one fixture file per command, named `<command>.json`.
   *
   * The recorded envelope is written verbatim: these fixtures exist so the mapping tasks can be
   * written against the keys kata really returns, which a hand-written sample cannot establish.
   *
   * @param {string} dir directory to write into (created if absent)
   * @param {{showId?:string}} [opts] passed through to `record()`
   * @returns {string[]} the fixture paths written
   */
  function recordFixtures(dir, opts = {}) {
    fs.mkdirSync(dir, { recursive: true });
    const envelopes = record(opts);
    return Object.entries(envelopes).map(([name, envelope]) => {
      const file = path.join(dir, `${name}.json`);
      fs.writeFileSync(file, `${JSON.stringify(envelope, null, 2)}\n`);
      return file;
    });
  }

  /**
   * Ask kata to stop the daemon it started for this `KATA_HOME`.
   *
   * Kata auto-starts a daemon on the first call, so this is how the scratch daemon is told to
   * exit rather than being killed by pid: killing by pid would mean guessing which process
   * belongs to this scratch home, and a wrong guess would stop the developer's own instance.
   *
   * A failure to stop is recorded in `errors` instead of thrown, because the scratch home is
   * removed regardless — but it is recorded rather than swallowed, so a teardown that could not
   * confirm a clean shutdown is visible to the caller.
   */
  function stopDaemon() {
    const res = runInWorkspace(['daemon', 'stop'], 10000);
    if (res.status !== 0) {
      errors.push(`kata daemon stop: exit ${res.status} ${(res.stderr || res.stdout).trim()}`);
    }
  }

  /**
   * Stop the scratch daemon and remove the whole scratch directory, including `KATA_HOME`.
   * Idempotent; never touches anything outside `dir` (AC-016-1).
   */
  const cleanup = () => {
    stopDaemon();
    removeTree(dir);
  };

  return {
    dir,
    home,
    workspace,
    originUrl,
    project,
    env,
    errors,
    kata,
    runInWorkspace,
    init,
    seed,
    ids,
    id,
    record,
    recordFixtures,
    stopDaemon,
    cleanup,
  };
}

/**
 * Build, use and tear down one scratch workspace in a single call.
 *
 * The `finally` teardown is the reason this exists: a scratch workspace left behind is both a
 * leak under `SCRATCH_ROOT` and a kata project binding that later runs could pick up.
 *
 * @param {(ws: ReturnType<typeof kataScratch>) => void} body
 * @param {{root?:string, project?:string}} [opts] passed through to `kataScratch()`
 * @returns {*} whatever `body` returned
 */
function withKataScratch(body, opts = {}) {
  const ws = kataScratch(opts);
  try {
    ws.init();
    return body(ws);
  } finally {
    ws.cleanup();
  }
}

module.exports = {
  SCRATCH_PROJECT,
  ORIGIN_URL_PREFIX,
  READ_COMMANDS,
  SEED_ITEMS,
  CLOSE_REASON,
  SCRATCH_ROOT,
  sleep,
  run,
  parseJson,
  removeTree,
  kataScratch,
  withKataScratch,
};
