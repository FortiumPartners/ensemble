'use strict';

/**
 * Fixtures for the step-isolation tests (PR 297, round 6, kata ehsm): local-ci-isolation.test.js.
 *
 *  - scenario():       a real head repo whose PR head COMMITS the attack (head code, as in production) and a trusted step list
 *                      that runs it (`bash attack.sh`), driven through the REAL runner: real git clone, real bash, real processes
 *  - maintainerWorld(): the maintainer's side: an environment that carries every credential a maintainer's shell could (variables,
 *                      gh/XDG directories, a HOME whose .config/gh/hosts.yml holds a token) and a FAKE `gh` on its PATH that
 *                      behaves like the real one for credentials: it succeeds (and logs a `POST ...` line) ONLY when it finds one
 *                      (GH_TOKEN / GITHUB_TOKEN in its environment, or an `oauth_token:` line in hosts.yml under $GH_CONFIG_DIR,
 *                      $XDG_CONFIG_HOME/gh or $HOME/.config/gh); otherwise it prints `no oauth token found` and exits 1. Every call
 *                      is logged (`INVOKED ...`) outside the clone.
 *  - process helpers:  liveness (a killed child that is only waiting to be reaped is dead)
 * Nothing here reaches the network.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const yaml = require('js-yaml');

const { runGate, RUNS_DIR } = require('../../lib/local-ci-runner');
const { makeBaseRepo } = require('./local-ci-base-repo');
const H = require('./local-ci-hosted');
const W = require('./local-ci-wal');

const MAJOR = Number(process.versions.node.split('.')[0]);
const BIN_DIR = path.dirname(process.execPath);
const CONTEXT = 'x/local-ci';
const WORKFLOW = '.github/workflows/iso.yml';
const SHA40 = 'a'.repeat(40);
const ATTACK_STEP = { name: 'attack', cmd: 'bash attack.sh' };

/** Variables of the maintainer's environment that must NEVER reach a step (the closed list the design names). */
const NEVER_FORWARDED = [
  'GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GITLAB_TOKEN', 'NPM_TOKEN', 'NODE_AUTH_TOKEN',
  'SSH_AUTH_SOCK', 'GIT_ASKPASS', 'SSH_ASKPASS', 'GH_HOST', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
  'AWS_PROFILE', 'UNLISTED_VARIABLE',
];
/** Variables the step DOES get, but as scratch values: never the maintainer's. */
const SCRATCH_REPLACED = ['HOME', 'GH_CONFIG_DIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'TMPDIR'];

/** A shell single-quoted word. */
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

const fakeGhText = (log) => `#!/bin/sh
LOG=${q(log)}
echo "INVOKED $* | GH_TOKEN=\${GH_TOKEN:+set} GITHUB_TOKEN=\${GITHUB_TOKEN:+set} HOME=$HOME GH_CONFIG_DIR=$GH_CONFIG_DIR XDG_CONFIG_HOME=$XDG_CONFIG_HOME" >>"$LOG"
found=
[ -n "$GH_TOKEN" ] && found=1
[ -n "$GITHUB_TOKEN" ] && found=1
for d in "$GH_CONFIG_DIR" "$XDG_CONFIG_HOME/gh" "$HOME/.config/gh"; do
  if [ -f "$d/hosts.yml" ] && grep -q 'oauth_token:' "$d/hosts.yml"; then found=1; fi
done
if [ -z "$found" ]; then
  echo "no oauth token found" >&2
  exit 1
fi
if [ "$1" = api ]; then echo "POST $*" >>"$LOG"; else echo "OK $*" >>"$LOG"; fi
echo "{}"
exit 0
`;

const mkdirs = (...parts) => {
  const p = path.join(...parts);
  fs.mkdirSync(p, { recursive: true });
  return p;
};
const readLines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);

/** The maintainer's side, under `root`: credentials everywhere, and the fake gh first on PATH. */
function maintainerWorld(root) {
  const home = mkdirs(root, 'maintainer-home');
  const ghConfig = mkdirs(home, '.config', 'gh');
  fs.writeFileSync(path.join(ghConfig, 'hosts.yml'), 'github.com:\n    user: maintainer\n    oauth_token: gho_maintainerHostsFileToken0001\n');
  const tmp = mkdirs(root, 'maintainer-tmp');
  const fakeBin = mkdirs(root, 'fake-bin');
  const log = path.join(root, 'gh.log');
  const gh = path.join(fakeBin, 'gh');
  fs.writeFileSync(gh, fakeGhText(log));
  fs.chmodSync(gh, 0o755);
  const env = {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    HOME: home,
    USER: 'maintainer',
    LOGNAME: 'maintainer',
    SHELL: '/bin/bash',
    LANG: 'C',
    LC_ALL: 'C',
    TERM: 'dumb',
    NODE_OPTIONS: '--no-warnings',
    TMPDIR: tmp,
    GH_TOKEN: 'ghp_maintainerLoginToken0001',
    GITHUB_TOKEN: 'ghp_maintainerGithubToken0002',
    GH_ENTERPRISE_TOKEN: 'ghe_maintainerEnterpriseToken0003',
    GITHUB_ENTERPRISE_TOKEN: 'ghe_maintainerGithubEnterprise0004',
    GITLAB_TOKEN: 'glpat_maintainerGitlabToken0005',
    NPM_TOKEN: 'npm_maintainerNpmToken0006',
    NODE_AUTH_TOKEN: 'npm_maintainerNodeAuthToken0007',
    SSH_AUTH_SOCK: path.join(root, 'agent.sock'),
    GIT_ASKPASS: path.join(root, 'git-askpass'),
    SSH_ASKPASS: path.join(root, 'ssh-askpass'),
    GH_HOST: 'ghe.example.test',
    GH_CONFIG_DIR: ghConfig,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
    AWS_ACCESS_KEY_ID: 'AKIAMAINTAINER0008',
    AWS_SECRET_ACCESS_KEY: 'aws-secret-maintainer-0009',
    AWS_SESSION_TOKEN: 'aws-session-maintainer-0010',
    AWS_PROFILE: 'aws-profile-0011',
    UNLISTED_VARIABLE: 'unlisted-value-0012',
  };
  return {
    home,
    ghConfig,
    tmp,
    gh,
    log,
    env,
    /** `INVOKED ...` lines: every call of the fake gh, credential or not. */
    invoked: () => readLines(log).filter((l) => l.startsWith('INVOKED')),
    /** `POST ...` / `OK ...` lines: calls that FOUND a credential and succeeded. */
    succeeded: () => readLines(log).filter((l) => /^(POST|OK) /.test(l)),
  };
}

const configOf = (steps) => ({
  workflows: [{ file: WORKFLOW, jobs: [{ id: 'iso', matrix: { 'node-version': [MAJOR] } }] }],
  steps,
  status_context: CONTEXT,
});
const workflowOf = (steps) =>
  yaml.dump({
    name: 'Iso',
    on: ['pull_request'],
    jobs: { iso: { 'runs-on': 'ubuntu-latest', strategy: { matrix: { 'node-version': [MAJOR] } }, steps: [{ uses: 'actions/checkout@v6' }, ...steps.map((s) => ({ run: s.cmd }))] } },
  });

/**
 * A head repo (real git) whose head commit holds `build(ctx)` (path -> text: the attack scripts), a maintainer world and the
 * runner call. `ctx` = { out, w, node }: `out` is a directory OUTSIDE the clone where the head's scripts report what they saw.
 *   steps     the trusted step list (default: `bash attack.sh`); the workflow mirrors it
 *   gate      extra runGate options (secretNames, stepTimeoutMs, keep ...)
 *   run(extra, depsExtra)  runs the REAL runner (only Node provisioning is injected: the running Node)
 *   read(name)/exists(name) read what a head script wrote into `out`
 *   go()      tells the leftovers of the head that the gate has returned: a leftover that is still alive posts now
 */
function scenario(build, { steps = [ATTACK_STEP], gate = {} } = {}) {
  const root = W.scratchDir('local-ci-iso-');
  const out = mkdirs(root, 'out');
  const w = maintainerWorld(root);
  const fx = makeBaseRepo({ config: yaml.dump(configOf(steps)), files: { [WORKFLOW]: workflowOf(steps) }, headFiles: build({ out, w, node: process.execPath }) });
  const approvalSet = H.approvalSetOf(configOf(steps));
  const run = (extra = {}, depsExtra = {}) =>
    runGate({ repoRoot: fx.dir, headSha: fx.headSha, approvalSet, env: w.env, ...gate, ...extra }, { resolveNodeBinDir: () => BIN_DIR, ...depsExtra });
  return {
    root,
    out,
    approvalSet,
    w,
    fx,
    clone: path.join(fx.dir, RUNS_DIR, fx.headSha),
    run,
    exists: (name) => fs.existsSync(path.join(out, name)),
    read: (name) => fs.readFileSync(path.join(out, name), 'utf8').trim(),
    go: () => fs.writeFileSync(path.join(out, 'go'), ''),
  };
}

/* ------------------------------------------------------------------------------------------- processes */

const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Alive means a process that can still run: a killed child that is only waiting to be reaped (state Z) is dead. */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
  } catch (err) {
    return err.code === 'EPERM';
  }
  const ps = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
  return !/^\s*Z/.test(ps.stdout || '');
}
/** True once `pid` is dead, polling up to `ms`; false if it is still alive then. */
function waitDead(pid, ms = 3000) {
  const end = Date.now() + ms;
  while (isAlive(pid)) {
    if (Date.now() > end) return false;
    sleepMs(20);
  }
  return true;
}
/** True once `check()` is truthy, polling up to `ms`. */
function waitFor(check, ms = 5000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) return false;
    sleepMs(20);
  }
  return true;
}

module.exports = {
  MAJOR,
  BIN_DIR,
  CONTEXT,
  SHA40,
  ATTACK_STEP,
  NEVER_FORWARDED,
  SCRATCH_REPLACED,
  q,
  maintainerWorld,
  scenario,
  readLines,
  sleepMs,
  isAlive,
  waitDead,
  waitFor,
};
