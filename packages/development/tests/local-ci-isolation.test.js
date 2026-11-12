'use strict';

/**
 * Round 6 (PR 297, kata ehsm): the PR head's steps are isolated from the credential the gate posts its commit status with.
 *
 * The attack is a script COMMITTED IN THE HEAD (head code), run by a trusted step (`bash attack.sh`), through the REAL runner:
 * real git clone, real bash, real processes. The maintainer's side carries every credential a maintainer's shell could (variables,
 * gh/XDG directories, a HOME with a hosts.yml token) and a FAKE `gh` that, like the real one, only succeeds when it finds one.
 *
 *   a. by name         `gh api -X POST` / `gh auth token` in the head: the refusing stub runs (127), the fake gh is never invoked
 *   b. by absolute path the fake gh runs but finds no credential (env, HOME, GH_CONFIG_DIR, XDG_* are scratch): no POST
 *   c. environment     no credential variable, a closed variable list, scratch dirs, git global/system config empty, a per-run
 *                      marker, PATH = Node bin dir + shadow dir + the maintainer's PATH
 *   d. leftovers       a child the step leaves running (subshell, nohup, a child that leaves the process group with setsid, one
 *                      that scrubs its environment) is dead when runGate returns, on every return path; a control reports none
 *   e. the sweep       unit tests with an injected process lister, plus the Linux (/proc) and macOS (ps) listers
 *   f. real steps      git, node and npm still work inside the clone under the scrubbed environment
 *   wiring             runGate's own use of kill and the lister (injected), on every return path, before the clone is removed
 *   z. the effect      after the runs, no released leftover posted anything
 *
 * LIMITS this file does not hide (they are the documented residuals, not goals): head code runs as the maintainer's OS user, so
 * it can still learn the real home or name a credential file by absolute path, use the keychain, or run a child that scrubs its
 * environment AND leaves the process group. MEASURED on macOS 27.2: `ps -E` prints the environment of processes that are not
 * Apple platform binaries (Homebrew bash, node) and nothing for Apple's own (/bin/sh, /bin/sleep, /usr/bin/perl). The sweep
 * therefore cannot see those on macOS; a child that stays in the process group is still killed by the group kill. The leaver
 * below is a node process started through perl's setsid so it is visible to the sweep on both platforms.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const {
  defaultDeps,
  sweepMarkedProcesses,
  readProcEnvirons,
  parsePsEnvironments,
  listProcessEnvironments,
  RUN_MARKER_VAR,
} = require('../lib/local-ci-runner');
const { cleanupBaseRepos } = require('./helpers/local-ci-base-repo');
const W = require('./helpers/local-ci-wal');
const ISO = require('./helpers/local-ci-iso');

jest.setTimeout(120000);

afterAll(() => {
  W.cleanupWalFixtures();
  cleanupBaseRepos();
});

const { q, SHA40: SHA, CONTEXT } = ISO;
const HAVE_PERL = spawnSync('perl', ['-MPOSIX', '-e', '1']).status === 0;
const kinds = (r) => r.failures.map((f) => f.kind);

/* ------------------------------------------------------------------------------------- head code (the attack) */

const HEADER = ({ out }) => `#!/bin/bash\nset +e\nOUT=${q(out)}\necho "$ENSEMBLE_LOCAL_CI_RUN" >"$OUT/marker"\n`;
const WAIT_FOR = 'wait_for() { for i in $(seq 1 100); do [ -e "$1" ] && return 0; sleep 0.1; done; return 1; }\n';

/** A leftover of the head: announces itself, waits for <out>/go (the gate has returned), then posts with a credential of its OWN. */
const posterJs = () => `'use strict';
// Gives up after ~10 s: it can never outlive a failed test.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const [out, name, gh] = process.argv.slice(2);
fs.writeFileSync(path.join(out, name + '.tmp'), String(process.pid));
fs.renameSync(path.join(out, name + '.tmp'), path.join(out, name + '.ready'));
let ticks = 0;
const timer = setInterval(() => {
  if (fs.existsSync(path.join(out, 'go'))) {
    clearInterval(timer);
    cp.spawnSync(gh, ['api', '-X', 'POST', 'repos/o/r/statuses/${SHA}', '-f', 'state=success', '-f', 'context=${CONTEXT}'], { env: { PATH: process.env.PATH || '/usr/bin:/bin', GH_TOKEN: 'stolen-by-the-head' } });
    process.exit(0);
  }
  if (++ticks > 100) process.exit(0);
}, 100);
`;

/** Reports what the step sees; exits 1 when any never-forwarded credential variable is present. */
const observeJs = () => `'use strict';
const fs = require('fs');
const path = require('path');
const out = process.argv[2];
const env = process.env;
const stat = (p) => { try { const s = fs.lstatSync(p); return { dir: s.isDirectory(), file: s.isFile(), mode: s.mode & 0o777 }; } catch (e) { return null; } };
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } };
const list = (p) => { try { return fs.readdirSync(p); } catch (e) { return null; } };
const parts = (env.PATH || '').split(path.delimiter);
const shadow = parts[1];
const scratch = ['HOME', 'GH_CONFIG_DIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'TMPDIR'];
fs.writeFileSync(path.join(out, 'observed.json'), JSON.stringify({
  env,
  parts,
  stats: Object.fromEntries(scratch.map((k) => [k, stat(env[k])])),
  shadow: { dir: shadow, entries: list(shadow), gh: stat(path.join(shadow, 'gh')), text: read(path.join(shadow, 'gh')) },
  ghConfigEntries: list(env.GH_CONFIG_DIR),
}));
const never = ${JSON.stringify(ISO.NEVER_FORWARDED)};
const present = never.filter((n) => n in env);
if (present.length > 0) { console.error('credential variables reached the step: ' + present.join(', ')); process.exit(1); }
`;

const POST_ARGS = `api -X POST repos/o/r/statuses/${SHA} -f state=success -f context=${CONTEXT}`;
const attackByName = (ctx) => `${HEADER(ctx)}gh ${POST_ARGS} >"$OUT/post.out" 2>"$OUT/post.err"
echo $? >"$OUT/post.status"
gh auth token >"$OUT/token.out" 2>"$OUT/token.err"
echo $? >"$OUT/token.status"
command -v gh >"$OUT/which-gh"
echo "$PATH" >"$OUT/path"
echo "$HOME" >"$OUT/home"
exit 0
`;
const attackByPath = (ctx) => `${HEADER(ctx)}GH=${q(ctx.w.gh)}
"$GH" ${POST_ARGS} >"$OUT/post.out" 2>"$OUT/post.err"
echo $? >"$OUT/post.status"
"$GH" auth token >"$OUT/token.out" 2>"$OUT/token.err"
echo $? >"$OUT/token.status"
exit 0
`;
const attackObserve = (ctx) => `${HEADER(ctx)}node observe.js "$OUT"\n`;
const attackNothing = () => 'exit 0\n';

/** ( sleep; gh ) &  : a background subshell of the step, same process group, environment inherited. */
const leftoverSubshell = (ctx) => `${HEADER(ctx)}GH=${q(ctx.w.gh)}
( for i in $(seq 1 100); do [ -e "$OUT/go" ] && break; sleep 0.1; done; [ -e "$OUT/go" ] && GH_TOKEN=stolen-by-the-head "$GH" ${POST_ARGS} ) >/dev/null 2>&1 &
echo $! >"$OUT/child.pid"
exit 0
`;
/** nohup sh -c '...' &  : same process group, system sh. */
const leftoverNohup = (ctx) => `${HEADER(ctx)}GH=${q(ctx.w.gh)}
nohup sh -c 'for i in $(seq 1 100); do [ -e "$1/go" ] && break; sleep 0.1; done; [ -e "$1/go" ] && GH_TOKEN=stolen-by-the-head "$2" ${POST_ARGS}' sh "$OUT" "$GH" >/dev/null 2>&1 &
echo $! >"$OUT/child.pid"
exit 0
`;
/** A child that leaves the process group (setsid) and keeps the environment it inherited: only the marker sweep can reach it. */
const leftoverLeaver = (ctx) => `${HEADER(ctx)}${WAIT_FOR}GH=${q(ctx.w.gh)}
perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' ${q(ctx.node)} poster.js "$OUT" leaver "$GH" >/dev/null 2>&1 &
wait_for "$OUT/leaver.ready" || exit 3
LEAVER=$(cat "$OUT/leaver.ready")
ps -o pid= -o pgid= -p "$LEAVER" >"$OUT/leaver.ps"
ps -o pid= -o pgid= -p $$ >"$OUT/step.ps"
exit 0
`;
/** A child that stays in the group but scrubs its environment (env -i): no marker, only the group kill can reach it. */
const leftoverScrubbed = (ctx) => `${HEADER(ctx)}${WAIT_FOR}GH=${q(ctx.w.gh)}
env -i ${q(ctx.node)} poster.js "$OUT" scrub "$GH" >/dev/null 2>&1 &
wait_for "$OUT/scrub.ready" || exit 3
exit 0
`;
/** Both kinds at once (the leaver only where perl exists), then `tail`: how the step ends. */
const leftoversThen = (tail) => (ctx) => `${HEADER(ctx)}${WAIT_FOR}GH=${q(ctx.w.gh)}
env -i ${q(ctx.node)} poster.js "$OUT" scrub "$GH" >/dev/null 2>&1 &
wait_for "$OUT/scrub.ready" || exit 3
if command -v perl >/dev/null 2>&1; then
  perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' ${q(ctx.node)} poster.js "$OUT" leaver "$GH" >/dev/null 2>&1 &
  wait_for "$OUT/leaver.ready" || exit 3
fi
${tail}
`;
/** Cross-step daemon: step 1 starts it, step 2 uses it. */
const startDaemon = (ctx) => `${HEADER(ctx)}${WAIT_FOR}GH=${q(ctx.w.gh)}
env -i ${q(ctx.node)} poster.js "$OUT" daemon "$GH" >/dev/null 2>&1 &
wait_for "$OUT/daemon.ready" || exit 3
exit 0
`;
const useDaemon = (ctx) => `${HEADER(ctx)}PID=$(cat "$OUT/daemon.ready")
if kill -0 "$PID" 2>/dev/null; then echo alive >"$OUT/step2-saw-daemon"; else echo dead >"$OUT/step2-saw-daemon"; fi
exit 0
`;
/** What a maintainer's real steps do inside the clone. */
const realSteps = (ctx) => `${HEADER(ctx)}set -e
test -z "$(git status --porcelain)"
git rev-parse --verify HEAD >"$OUT/head"
test -z "$(git config --global --list)"
test -z "$(git config --system --list)"
node -e 'require("fs").writeFileSync(process.argv[1], process.version)' "$OUT/node-version"
npm --version >"$OUT/npm-version"
# BSD mktemp on macOS ignores TMPDIR, so name the template; Node's os.tmpdir() does honour it.
f=$(mktemp "$TMPDIR/probe.XXXXXX")
echo ok >"$f"
test "$(cat "$f")" = ok
rm -f "$f"
node -e 'if (require("os").tmpdir() !== process.env.TMPDIR) process.exit(1)'
echo ok >"$OUT/tmp-roundtrip"
`;

const withFiles = (attack, extra = {}) => (ctx) => ({ 'attack.sh': attack(ctx), 'poster.js': posterJs(), 'observe.js': observeJs(), ...extra });
const mk = (attack, opts) => ISO.scenario(withFiles(attack), opts);

/** Scenarios whose leftovers were released (`go`): the last test shows none of them posted anything. */
const released = [];

/**
 * Show every named child of `S` is dead NOW, while it is still waiting for `go` (a survivor that is released first would post and
 * exit by itself and look dead), and that the run reported what it killed. Then release the leftovers: the gate has returned, so
 * one that is somehow still alive posts now (and exits, so a failing test leaves nothing behind); the last test shows none did.
 */
function expectDead(S, r, names) {
  released.push(S);
  try {
    for (const name of names) {
      const pid = Number(S.read(name.endsWith('.pid') ? name : `${name}.ready`));
      expect({ child: name, pid, dead: ISO.waitDead(pid) }).toEqual({ child: name, pid, dead: true });
    }
    expect(r.leftoverProcessesKilled).toBeGreaterThan(0);
    // By marker: no live process on this machine still carries the environment entry of this run (where the platform lists it).
    const token = `${RUN_MARKER_VAR}=${S.read('marker')}`;
    const carrying = (listProcessEnvironments() || []).filter((p) => p.tokens.includes(token) && ISO.isAlive(p.pid)).map((p) => p.pid);
    expect(carrying).toEqual([]);
  } finally {
    S.go();
  }
}

/* ====================================================================================== a / b: gh by name and by path */

describe('a. gh by name', () => {
  it('a bare `gh` in the head resolves to the refusing stub (exit 127): the fake gh is never invoked', () => {
    const S = mk(attackByName);
    const r = S.run();
    expect(r.failures).toEqual([]);
    expect(r.ok).toBe(true); // the head script itself exits 0: the stub made `gh` fail, not the step
    expect(S.read('post.status')).toBe('127');
    expect(S.read('token.status')).toBe('127');
    expect(S.read('post.out')).toBe('');
    expect(S.read('token.out')).toBe('');
    expect(S.read('post.err')).toContain("does not give the PR head's code its GitHub credential");
    expect(S.w.invoked()).toEqual([]); // the maintainer's gh never ran, with or without a credential
    expect(S.w.succeeded()).toEqual([]);
    const parts = S.read('path').split(path.delimiter);
    const shadow = parts[1];
    expect(shadow.startsWith(S.read('home') + path.sep)).toBe(true); // the shadow dir lives in the scratch dir
    expect(S.read('which-gh')).toBe(path.join(shadow, 'gh')); // `command -v gh` resolves to it
  });
});

describe('b. gh by absolute path', () => {
  it('the fake gh runs but finds no credential: nothing is posted, and every place it looks is scratch', () => {
    const S = mk(attackByPath);
    const r = S.run();
    expect(r.failures).toEqual([]);
    expect(r.ok).toBe(true);
    expect(S.read('post.status')).toBe('1');
    expect(S.read('token.status')).toBe('1');
    expect(S.read('post.err')).toContain('no oauth token found');
    expect(S.read('token.out')).toBe('');
    expect(S.w.succeeded()).toEqual([]); // no POST, and no `gh auth token` that printed a token
    const calls = S.w.invoked();
    expect(calls).toHaveLength(2); // it DID run: the stub is a speed bump for a bare `gh`, not a wall
    for (const line of calls) {
      const m = /GH_TOKEN=(\S*) GITHUB_TOKEN=(\S*) HOME=(\S*) GH_CONFIG_DIR=(\S*) XDG_CONFIG_HOME=(\S*)$/.exec(line);
      expect(m).not.toBeNull();
      const [, ghToken, githubToken, home, ghConfigDir, xdgConfigHome] = m;
      expect([ghToken, githubToken]).toEqual(['', '']); // neither variable reached it
      expect(path.basename(home)).toMatch(/^local-ci-home-/);
      expect(home).not.toBe(S.w.env.HOME);
      expect(ghConfigDir).toBe(path.join(home, '.config', 'gh'));
      expect(xdgConfigHome).toBe(path.join(home, '.config'));
      expect(ghConfigDir).not.toBe(S.w.env.GH_CONFIG_DIR);
      expect(xdgConfigHome).not.toBe(S.w.env.XDG_CONFIG_HOME);
    }
  });
});

/* ===================================================================================================== c: environment */

const ADDED_BY_SHELL = new Set(['PWD', 'OLDPWD', 'SHLVL', '_', '__CF_USER_TEXT_ENCODING']);
/** The closed list of variable names a step may see (plus what bash itself adds). */
const EXPECTED_ENV = new Set([
  'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TERM', 'NODE_OPTIONS', 'npm_config_cache',
  'HOME', 'GH_CONFIG_DIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'TMPDIR',
  'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM', 'GIT_TERMINAL_PROMPT', 'GH_PROMPT_DISABLED', 'GH_NO_UPDATE_NOTIFIER',
  RUN_MARKER_VAR, 'CI', 'PATH',
]);

describe('c. the step environment', () => {
  // One real run, observed once: the tests below only READ what the head script saw.
  let observation;
  const observed = () => {
    if (!observation) {
      const S = mk(attackObserve);
      const r = S.run();
      observation = { S, r, seen: JSON.parse(S.read('observed.json')) };
    }
    return observation;
  };

  it('no credential variable of the maintainer reaches the step (it exits 1 if one does), and no variable outside the closed list does either', () => {
    const { S, r, seen } = observed();
    expect(r.failures).toEqual([]);
    expect(r.ok).toBe(true);
    for (const name of ISO.NEVER_FORWARDED) expect(seen.env).not.toHaveProperty(name);
    expect(Object.keys(seen.env).filter((k) => !EXPECTED_ENV.has(k) && !ADDED_BY_SHELL.has(k))).toEqual([]);
    for (const k of EXPECTED_ENV) expect(seen.env).toHaveProperty(k);
    const blob = JSON.stringify(seen.env);
    for (const name of ISO.NEVER_FORWARDED) expect(blob).not.toContain(S.w.env[name]); // no value either, under any name
  });

  it('a step that is handed a credential variable fails (the head script is the oracle for the closed list)', () => {
    // Control for the test above: the same head script DOES exit 1 when a never-forwarded name is present, so "ok" is not vacuous.
    const S = mk(attackObserve, { gate: { secretNames: ['GH_TOKEN'] } });
    const r = S.run();
    expect(r.ok).toBe(false);
    expect(kinds(r)).toEqual(['step-failed']);
    expect(r.failures[0].message).toContain('credential variables reached the step: GH_TOKEN');
  });

  it('HOME, GH_CONFIG_DIR, XDG_* and TMPDIR are fresh owner-only directories inside one scratch dir, never the maintainer\'s', () => {
    const { S, seen } = observed();
    const home = seen.env.HOME;
    expect(path.basename(home)).toMatch(/^local-ci-home-/);
    expect(seen.env.GH_CONFIG_DIR).toBe(path.join(home, '.config', 'gh'));
    expect(seen.env.XDG_CONFIG_HOME).toBe(path.join(home, '.config'));
    expect(seen.env.XDG_CACHE_HOME).toBe(path.join(home, '.cache'));
    expect(seen.env.XDG_DATA_HOME).toBe(path.join(home, '.local', 'share'));
    expect(seen.env.XDG_STATE_HOME).toBe(path.join(home, '.local', 'state'));
    expect(seen.env.TMPDIR).toBe(path.join(home, 'tmp'));
    for (const name of ISO.SCRATCH_REPLACED) {
      expect(seen.env[name]).not.toBe(S.w.env[name]);
      expect(seen.stats[name]).toEqual({ dir: true, file: false, mode: 0o700 });
    }
    expect(seen.ghConfigEntries).toEqual([]); // gh's config dir starts empty: no hosts.yml for a gh to find
    expect(fs.existsSync(home)).toBe(false); // and all of it is removed with the run
  });

  it('git global and system configuration are empty, nothing prompts, and the other switches are set', () => {
    const { seen } = observed();
    expect(seen.env.GIT_CONFIG_GLOBAL).toBe(os.devNull);
    expect(seen.env.GIT_CONFIG_SYSTEM).toBe(os.devNull);
    expect(seen.env.GIT_CONFIG_NOSYSTEM).toBe('1');
    expect(seen.env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(seen.env.GH_PROMPT_DISABLED).toBe('1');
    expect(seen.env.GH_NO_UPDATE_NOTIFIER).toBe('1');
    expect(seen.env.CI).toBe('true');
  });

  it('the run marker is a fresh random id per run', () => {
    const S = mk(attackObserve);
    const markerOfLastRun = () => JSON.parse(S.read('observed.json')).env[RUN_MARKER_VAR];
    S.run();
    const first = markerOfLastRun();
    S.run();
    const second = markerOfLastRun();
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(second).toMatch(/^[0-9a-f]{32}$/);
    expect(second).not.toBe(first);
  });

  it('PATH is the pinned Node bin dir, then the shadow dir with ONE executable gh, then the maintainer\'s PATH unchanged', () => {
    const { S, seen } = observed();
    expect(seen.parts[0]).toBe(ISO.BIN_DIR);
    expect(seen.parts[1].startsWith(seen.env.HOME + path.sep)).toBe(true);
    expect(seen.parts.slice(2).join(path.delimiter)).toBe(S.w.env.PATH);
    expect(seen.shadow.entries).toEqual(['gh']);
    expect(seen.shadow.gh).toEqual({ dir: false, file: true, mode: 0o755 });
    expect(seen.shadow.text.startsWith('#!/bin/sh\n')).toBe(true);
    expect(seen.shadow.text).toContain('exit 127');
  });

  it('the allowlisted variables and the warm npm cache are still forwarded', () => {
    const { S, seen } = observed();
    for (const name of ['USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TERM', 'NODE_OPTIONS']) expect(seen.env[name]).toBe(S.w.env[name]);
    expect(seen.env.npm_config_cache).toBe(path.join(S.w.env.HOME, '.npm'));
    expect(seen.env.TMPDIR).not.toBe(S.w.env.TMPDIR); // TMPDIR is allowlisted (the baseline run pins the same list) but always overridden: the scratch dir has its own
  });

  it('a configured secret is forwarded, but a secret can never undo the scratch HOME, the empty git config, the marker or CI', () => {
    const names = ['APP_KEY', 'HOME', 'GH_CONFIG_DIR', 'GIT_CONFIG_GLOBAL', RUN_MARKER_VAR, 'CI'];
    const S = mk(attackObserve, { gate: { secretNames: names } });
    const r = S.run({ env: { ...S.w.env, APP_KEY: 'configured-secret-value-1', [RUN_MARKER_VAR]: 'maintainer-chosen', CI: 'false', GIT_CONFIG_GLOBAL: '/maintainer/gitconfig' } });
    expect(r.failures).toEqual([]);
    const seen = JSON.parse(S.read('observed.json'));
    expect(seen.env.APP_KEY).toBe('configured-secret-value-1');
    expect(seen.env.HOME).not.toBe(S.w.env.HOME);
    expect(path.basename(seen.env.HOME)).toMatch(/^local-ci-home-/);
    expect(seen.env.GH_CONFIG_DIR).toBe(path.join(seen.env.HOME, '.config', 'gh'));
    expect(seen.env.GIT_CONFIG_GLOBAL).toBe(os.devNull);
    expect(seen.env[RUN_MARKER_VAR]).toMatch(/^[0-9a-f]{32}$/);
    expect(seen.env.CI).toBe('true');
  });

  it('what a step does to the scratch dirs is cleaned up with the run: chmod 000 trees in TMPDIR and under HOME are repaired and removed, no runner-error', () => {
    const S = mk((ctx) => `${HEADER(ctx)}echo "$HOME" >"$OUT/home"
mkdir -p "$TMPDIR/a/b" "$HOME/.config/gh/x" && touch "$TMPDIR/a/b/f" "$HOME/.config/gh/x/f" && chmod 000 "$TMPDIR/a/b" "$TMPDIR/a" "$HOME/.config/gh/x"
exit 0
`);
    let home;
    try {
      const r = S.run();
      home = S.read('home');
      expect(r.failures).toEqual([]);
      expect(r.ok).toBe(true);
      expect(fs.existsSync(home)).toBe(false);
    } finally {
      if (home) {
        spawnSync('chmod', ['-R', 'u+rwx', home]);
        fs.rmSync(home, { recursive: true, force: true });
      }
    }
  });
});

/* ===================================================================================================== d: leftovers */

describe('d. what a step leaves running is dead when runGate returns', () => {
  it('d1. a background subshell ( sleep; gh ) &', () => {
    const S = mk(leftoverSubshell);
    const r = S.run();
    expect(r.ok).toBe(true); // the step exits 0 at once; the verdict is not touched
    expectDead(S, r, ['child.pid']);
  });

  it('d2. nohup sh -c \'...\' &', () => {
    const S = mk(leftoverNohup);
    const r = S.run();
    expect(r.ok).toBe(true);
    expectDead(S, r, ['child.pid']);
  });

  const itPerl = HAVE_PERL ? it : it.skip;
  itPerl(`d3. a child that LEAVES the process group (perl POSIX::setsid) is swept by its marker${HAVE_PERL ? '' : ' (SKIPPED: perl is not on PATH)'}`, () => {
    const S = mk(leftoverLeaver);
    const r = S.run();
    expect(r.ok).toBe(true);
    // It really left: its own group, not the step's. Only the marker sweep can reach it.
    const [leaverPid, leaverPgid] = S.read('leaver.ps').split(/\s+/).map(Number);
    const [, stepPgid] = S.read('step.ps').split(/\s+/).map(Number);
    expect(leaverPgid).toBe(leaverPid);
    expect(leaverPgid).not.toBe(stepPgid);
    expectDead(S, r, ['leaver']);
  });

  it('d4. a child that stays in the group but scrubs its environment (env -i) is reached by the group kill', () => {
    const S = mk(leftoverScrubbed);
    const r = S.run();
    expect(r.ok).toBe(true);
    expectDead(S, r, ['scrub']);
  });

  it('control: a step with no leftover reports no leftoverProcessesKilled', () => {
    const S = mk(attackNothing);
    const r = S.run();
    expect(r.ok).toBe(true);
    expect(r).not.toHaveProperty('leftoverProcessesKilled');
  });

  describe('on every return path of a run that started a step', () => {
    const both = (tail) => mk(leftoversThen(tail));
    const reaped = (S, r) => expectDead(S, r, ['scrub', ...(HAVE_PERL ? ['leaver'] : [])]);

    it('pass: the verdict stays a pass', () => {
      const S = both('exit 0');
      const r = S.run();
      expect(r.failures).toEqual([]);
      expect(r.ok).toBe(true);
      reaped(S, r);
    });

    it('step failure', () => {
      const S = both('exit 1');
      const r = S.run();
      expect(kinds(r)).toEqual(['step-failed']);
      reaped(S, r);
    });

    it('timeout', () => {
      // The leftovers must be up (ready files) before the timeout fires, so the limit is generous for a loaded machine.
      const S = mk(leftoversThen('sleep 30'), { gate: { stepTimeoutMs: 5000 } });
      const r = S.run();
      expect(kinds(r)).toEqual(['step-failed']);
      expect(r.failures[0].message).toContain('timed out after 5s');
      reaped(S, r);
    });

    it('tamper refusal (the step rewrote a tracked file)', () => {
      const S = both('echo tampered >>README.md');
      const r = S.run();
      expect(r.ok).toBe(false);
      expect(kinds(r)).toContain('clone-tampered');
      reaped(S, r);
    });

    it('runner-error (git fails after the step)', () => {
      const S = both('exit 0');
      const real = defaultDeps();
      let stepRan = false;
      const r = S.run({}, {
        run: (cmd, o) => {
          const x = real.run(cmd, o);
          if (cmd === ISO.ATTACK_STEP.cmd) stepRan = true;
          return x;
        },
        git: (args, o) => {
          if (stepRan) throw new Error('injected: git died after the step');
          return real.git(args, o);
        },
      });
      expect(r.ok).toBe(false);
      expect(kinds(r)).toEqual(['runner-error']);
      reaped(S, r);
    });

    it('keep: true (the clone is left for debugging) still kills the leftovers', () => {
      const S = mk(leftoversThen('exit 0'), { gate: { keep: true } });
      const r = S.run();
      expect(r.ok).toBe(true);
      expect(fs.existsSync(S.clone)).toBe(true);
      reaped(S, r);
    });
  });

  it('a daemon one step starts keeps serving the next step: it dies at the END of the run, not between steps', () => {
    const steps = [{ name: 'start', cmd: 'bash start.sh' }, { name: 'use', cmd: 'bash use.sh' }];
    const S = ISO.scenario((ctx) => ({ 'start.sh': startDaemon(ctx), 'use.sh': useDaemon(ctx), 'poster.js': posterJs() }), { steps });
    const r = S.run();
    expect(r.failures).toEqual([]);
    expect(r.ok).toBe(true);
    expect(S.read('step2-saw-daemon')).toBe('alive');
    expectDead(S, r, ['daemon']);
  });
});

/* =========================================================================================== wiring (injected process control) */

describe('runGate wires the group kill and the sweep in (injected kill and lister, real clone)', () => {
  const ESRCH = Object.assign(new Error('no such process'), { code: 'ESRCH' });
  const EPERM = Object.assign(new Error('not permitted'), { code: 'EPERM' });

  /** A real clone and head, an injected process runner (it reports `pids`) and an injected kill/lister that records what it is asked. */
  function wiring({ pids = { probe: 910001, step: 910002 }, step = {}, onStep, gitThrowsAfterStep = false, kill, listing } = {}) {
    const S = ISO.scenario(() => ({ 'attack.sh': 'exit 0\n' }));
    const calls = [];
    const seen = { markers: [] };
    let stepRan = false;
    const real = defaultDeps();
    const deps = {
      run: (cmd, o) => {
        seen.markers.push(o.env[RUN_MARKER_VAR]);
        if (cmd === 'node --version') return { status: 0, stdout: `${process.version}\n`, stderr: '', pid: pids.probe };
        stepRan = true;
        if (onStep) onStep(o);
        return { status: 0, stdout: '', stderr: '', pid: pids.step, ...step };
      },
      kill: (pid, sig) => {
        calls.push({ op: 'kill', pid, sig, cloneExists: fs.existsSync(S.clone) });
        if (kill) return kill(pid, sig);
        return undefined;
      },
      listProcesses: () => {
        calls.push({ op: 'list', cloneExists: fs.existsSync(S.clone) });
        return listing ? listing(seen.markers[0]) : [];
      },
      git: (args, o) => {
        if (gitThrowsAfterStep && stepRan) throw new Error('injected: git died after the step');
        return real.git(args, o);
      },
    };
    return { S, calls, seen, deps, run: () => S.run({}, deps) };
  }

  const PATHS = {
    pass: { kinds: [] },
    'step failure': { step: { status: 1 }, kinds: ['step-failed'] },
    timeout: { step: { status: null, timedOut: true }, kinds: ['step-failed'] },
    'tamper refusal': { onStep: (o) => fs.appendFileSync(path.join(o.cwd, 'README.md'), 'tampered\n'), kinds: ['clone-tampered'] },
    'runner-error': { gitThrowsAfterStep: true, kinds: ['runner-error'] },
  };
  for (const [name, p] of Object.entries(PATHS)) {
    it(`${name}: every step process group seen alive is SIGKILLed, then the sweep runs, BEFORE the clone is removed`, () => {
      const { S, calls, run } = wiring(p);
      const r = run();
      expect(kinds(r)).toEqual(p.kinds);
      expect(calls.every((c) => c.cloneExists)).toBe(true); // nothing happened after the clone was removed
      const ends = calls.filter((c) => (c.op === 'kill' && c.sig === 'SIGKILL') || c.op === 'list');
      expect(ends.map((c) => (c.op === 'kill' ? [c.pid, c.sig] : c.op))).toEqual([[-910001, 'SIGKILL'], [-910002, 'SIGKILL'], 'list']);
      expect(r.leftoverProcessesKilled).toBe(2); // two groups were killed; reported, never judged
      expect(fs.existsSync(S.clone)).toBe(false);
    });
  }

  it('a group that was not seen alive when its step ended is never signalled (a recycled pid is not killed blindly)', () => {
    const { calls, run } = wiring({ kill: (pid, sig) => { if (sig === 0) throw ESRCH; } });
    const r = run();
    expect(r.ok).toBe(true);
    expect(calls.filter((c) => c.sig === 'SIGKILL')).toEqual([]);
    expect(calls.map((c) => c.op)).toContain('list'); // the sweep still runs: a child that left its group leaves no group behind
    expect(r).not.toHaveProperty('leftoverProcessesKilled');
  });

  it('a member we may not signal still counts as alive; its kill error is swallowed and not counted', () => {
    const { calls, run } = wiring({ kill: () => { throw EPERM; } });
    const r = run();
    expect(r.ok).toBe(true);
    expect(calls.filter((c) => c.sig === 'SIGKILL').map((c) => c.pid)).toEqual([-910001, -910002]);
    expect(r).not.toHaveProperty('leftoverProcessesKilled');
  });

  it('a process runner that reports no pid starts nothing the runner can own: nothing is probed, killed or listed', () => {
    const { calls, run } = wiring({ pids: {} });
    const r = run();
    expect(r.ok).toBe(true);
    expect(calls).toEqual([]);
    expect(r).not.toHaveProperty('leftoverProcessesKilled');
  });

  it('never signals the runner itself, its parent, pid 1, pid 0 or a negative pid, even if the process runner reports them', () => {
    for (const bad of [process.pid, process.ppid, 1, 0, -7]) {
      const { calls, run } = wiring({ pids: { probe: bad, step: bad } });
      expect(run().ok).toBe(true);
      expect(calls).toEqual([]);
    }
  });

  it('the sweep runs with the marker the steps carried and kills only the processes that carry it whole', () => {
    const w = wiring({
      listing: (marker) => [
        { pid: 777001, tokens: ['x', `${RUN_MARKER_VAR}=${marker}`] },
        { pid: 777002, tokens: [`${RUN_MARKER_VAR}=${marker}0`] },
        { pid: 777003, tokens: [`${RUN_MARKER_VAR}=${'0'.repeat(32)}`] },
      ],
    });
    const r = w.run();
    expect(new Set(w.seen.markers).size).toBe(1); // one marker for the probe and the step
    expect(w.seen.markers[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(w.calls.filter((c) => c.sig === 'SIGKILL').map((c) => c.pid)).toEqual([-910001, -910002, 777001]);
    expect(r.leftoverProcessesKilled).toBe(3); // two groups and one marked process
  });

  it('with no pid reported the sweep does not even run, whatever its lister would find', () => {
    const w = wiring({ pids: {}, listing: (marker) => [{ pid: 777001, tokens: [`${RUN_MARKER_VAR}=${marker}`] }] });
    expect(w.run().ok).toBe(true);
    expect(w.calls).toEqual([]);
  });

  it('a lister that throws and kills that throw change no verdict and escape nowhere', () => {
    const w = wiring({
      kill: (pid, sig) => {
        if (sig === 'SIGKILL') throw new Error('kill refused');
      },
      listing: () => {
        throw new Error('ps blew up');
      },
    });
    const r = w.run();
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
    expect(r).not.toHaveProperty('leftoverProcessesKilled');
    expect(w.calls.filter((c) => c.sig === 'SIGKILL')).toHaveLength(2); // both groups were tried
  });

  it('no step ran (a required step is unmirrored): nothing is probed, killed or listed', () => {
    const w = wiring();
    const r = w.S.run({ approvalSet: { ...w.S.approvalSet, steps: [{ name: 'other', cmd: 'true' }] } }, w.deps);
    expect(kinds(r)).toEqual(['unmirrored-step']);
    expect(w.calls).toEqual([]);
  });
});

/* ========================================================================================================== e: the sweep */

describe('e. sweepMarkedProcesses (injected lister)', () => {
  const MARKER = '0123456789abcdef0123456789abcdef';
  const TOKEN = `${RUN_MARKER_VAR}=${MARKER}`;
  const proc = (pid, ...tokens) => ({ pid, tokens });
  /** `processes` is the listing (or a function that produces it); every kill the sweep ATTEMPTS is recorded, so a wrongly attempted kill that fails is still seen. */
  const sweep = (processes, extra = {}) => {
    const killed = [];
    const list = typeof processes === 'function' ? processes : () => processes;
    const n = sweepMarkedProcesses({ marker: MARKER, list, kill: (pid, sig) => { killed.push([pid, sig]); }, ...extra });
    return { n, killed };
  };

  it('SIGKILLs exactly the processes whose environment carries the marker token', () => {
    const { n, killed } = sweep([proc(10, 'sh', '-c', 'x', 'A=1', TOKEN), proc(11, 'A=1'), proc(12, TOKEN, 'B=2'), proc(13)]);
    expect(killed).toEqual([[10, 'SIGKILL'], [12, 'SIGKILL']]);
    expect(n).toBe(2);
  });

  it('matches the whole NAME=value token: a similar id, a longer or shorter id, a glued name or another variable is not the marker', () => {
    const near = [
      proc(20, `${TOKEN}0`), // the marker is a prefix of this id
      proc(21, `${RUN_MARKER_VAR}=${MARKER.slice(0, -1)}`), // a shorter id
      proc(22, `X${TOKEN}`), // glued to the end of another entry
      proc(23, `${RUN_MARKER_VAR}=0${MARKER}`), // the marker is a suffix of this id
      proc(24, `OTHER_RUN=${MARKER}`), // the same id under another name
      proc(25, MARKER), // the bare id
      proc(26, `${RUN_MARKER_VAR}=${MARKER.toUpperCase()}`), // another case
      proc(27, `${TOKEN} `), // a token with a trailing space is another token
    ];
    expect(sweep(near)).toEqual({ n: 0, killed: [] });
  });

  it('never signals the runner itself, its parent, pid 1, pid 0 or a negative pid, even when they carry the marker', () => {
    const { n, killed } = sweep([proc(process.pid, TOKEN), proc(process.ppid, TOKEN), proc(1, TOKEN), proc(0, TOKEN), proc(-4, TOKEN), proc(4242, TOKEN)]);
    expect(killed).toEqual([[4242, 'SIGKILL']]);
    expect(n).toBe(1);
  });

  it('the runner itself and its parent are protected separately', () => {
    expect(sweep([proc(process.pid, TOKEN)]).killed).toEqual([]);
    expect(sweep([proc(process.ppid, TOKEN)]).killed).toEqual([]);
    // `protect` is what decides: with nothing protected the same two would be signalled (pid > 1 only)
    expect(sweep([proc(5001, TOKEN), proc(5002, TOKEN)], { protect: [] }).killed).toEqual([[5001, 'SIGKILL'], [5002, 'SIGKILL']]);
    expect(sweep([proc(5001, TOKEN), proc(5002, TOKEN)], { protect: [5002] }).killed).toEqual([[5001, 'SIGKILL']]);
  });

  it('never throws: a listing error, a junk listing and a kill error are swallowed (and a failed kill is not counted)', () => {
    expect(sweep(() => { throw new Error('ps blew up'); })).toEqual({ n: 0, killed: [] });
    for (const junk of [null, undefined, 'x', 5, {}]) expect(sweep(junk)).toEqual({ n: 0, killed: [] });
    // Entries that are not processes, or whose pid / tokens are not what a lister returns: nothing is attempted.
    const entries = [null, 5, 'x', {}, { pid: '12', tokens: [TOKEN] }, { pid: 12.5, tokens: [TOKEN] }, { pid: 99, tokens: TOKEN }, { pid: 98 }];
    expect(sweep(entries)).toEqual({ n: 0, killed: [] });
    const killed = [];
    const n = sweepMarkedProcesses({
      marker: MARKER,
      list: () => [proc(30, TOKEN), proc(31, TOKEN), proc(32, TOKEN)],
      kill: (pid) => {
        killed.push(pid);
        if (pid === 31) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      },
    });
    expect(killed).toEqual([30, 31, 32]); // the failure on 31 did not stop 32
    expect(n).toBe(2); // ...and a kill that failed is not counted
  });

  it('an unsupported platform (the lister answers null) is a no-op, and an empty or non-string marker matches nothing', () => {
    expect(listProcessEnvironments('win32')).toBeNull();
    expect(listProcessEnvironments('freebsd')).toBeNull();
    expect(sweep(null)).toEqual({ n: 0, killed: [] });
    const wrongIds = [proc(40, `${RUN_MARKER_VAR}=`), proc(41, `${RUN_MARKER_VAR}=undefined`), proc(42, `${RUN_MARKER_VAR}=null`), proc(43, `${RUN_MARKER_VAR}=5`)];
    for (const marker of ['', undefined, null, 5]) expect(sweep(wrongIds, { marker })).toEqual({ n: 0, killed: [] });
  });

  describe('the listers', () => {
    it('macOS: `ps -E` lines parse to pid + whole words (command line, then environment)', () => {
      const text = [
        '  101 /bin/sh -c sleep 1 A=1 ENSEMBLE_LOCAL_CI_RUN=abc B=two',
        ' 2002 node -e x FOO=bar baz ENSEMBLE_LOCAL_CI_RUN=abc',
        'a continuation without a pid',
        '303 bare',
        '',
      ].join('\n');
      expect(parsePsEnvironments(text)).toEqual([
        { pid: 101, tokens: ['/bin/sh', '-c', 'sleep', '1', 'A=1', 'ENSEMBLE_LOCAL_CI_RUN=abc', 'B=two'] },
        { pid: 2002, tokens: ['node', '-e', 'x', 'FOO=bar', 'baz', 'ENSEMBLE_LOCAL_CI_RUN=abc'] },
        { pid: 303, tokens: ['bare'] },
      ]);
    });

    it('Linux: reads <pid>/environ of numeric entries only (NUL separated), skipping what it cannot read', () => {
      const proc = W.scratchDir('local-ci-iso-proc-');
      const put = (name, text) => {
        fs.mkdirSync(path.join(proc, name), { recursive: true });
        if (text !== null) fs.writeFileSync(path.join(proc, name, 'environ'), text);
      };
      put('123', `A=1\0${TOKEN}\0B=two words\0`);
      put('456', ''); // a process with an empty environment
      put('789', null); // no environ file (gone, or not ours)
      put('self', `${TOKEN}\0`); // not a pid
      put('12abc', `${TOKEN}\0`); // not purely numeric
      fs.writeFileSync(path.join(proc, '999'), 'a plain file with a numeric name'); // environ under it cannot be read
      const listed = readProcEnvirons(proc).sort((a, b) => a.pid - b.pid);
      expect(listed).toEqual([
        { pid: 123, tokens: ['A=1', TOKEN, 'B=two words'] },
        { pid: 456, tokens: [] },
      ]);
      expect(sweep(listed).killed).toEqual([[123, 'SIGKILL']]);
    });

    const itReal = ['linux', 'darwin'].includes(process.platform) ? it : it.skip;
    itReal('this platform\'s real lister sees a marker-carrying node child, and the real sweep ends it and only it', () => {
      const marker = 'f'.repeat(32);
      const idle = ['-e', 'setTimeout(() => {}, 15000)'];
      const marked = spawn(process.execPath, idle, { env: { ...process.env, [RUN_MARKER_VAR]: marker }, stdio: 'ignore' });
      const other = spawn(process.execPath, idle, { env: { ...process.env, [RUN_MARKER_VAR]: 'e'.repeat(32) }, stdio: 'ignore' });
      try {
        const token = `${RUN_MARKER_VAR}=${marker}`;
        expect(ISO.waitFor(() => (listProcessEnvironments() || []).some((p) => p.pid === marked.pid && p.tokens.includes(token)), 8000)).toBe(true);
        const n = sweepMarkedProcesses({ marker, list: () => listProcessEnvironments(), kill: (pid, sig) => process.kill(pid, sig) });
        expect(n).toBe(1);
        expect(ISO.waitDead(marked.pid)).toBe(true);
        expect(ISO.isAlive(other.pid)).toBe(true); // another run's id is not ours
      } finally {
        marked.kill('SIGKILL');
        other.kill('SIGKILL');
      }
    });
  });
});

/* ============================================================================================================ f: real steps */

describe('f. the maintainer\'s real steps still work under the scrubbed environment', () => {
  it('git status / git config / node -e / npm --version / mktemp pass inside the clone', () => {
    const S = mk(realSteps);
    const r = S.run();
    expect(r.failures).toEqual([]);
    expect(r.ok).toBe(true);
    expect(S.read('head')).toBe(S.fx.headSha);
    expect(S.read('node-version')).toBe(process.version);
    expect(S.read('npm-version')).toMatch(/^\d+\.\d+\.\d+/);
    expect(S.read('tmp-roundtrip')).toBe('ok');
  });
});

/* ============================================================================================ the effect, shown once at the end */

describe('z. the effect', () => {
  it('after the gate returned and every leftover was released, none of them posted anything', () => {
    ISO.sleepMs(1500); // a surviving leftover polls every 100 ms and posts as soon as it sees `go`
    expect(released.length).toBeGreaterThan(0);
    for (const S of released) expect(S.w.succeeded()).toEqual([]);
  });
});
