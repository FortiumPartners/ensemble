'use strict';

/**
 * Eval `setup`: argv arrays run in the sandbox project directory after the fixture is copied and committed and before the agent
 * starts (see sandbox.createSandbox for the exact position). Repo-authored and trusted at the same level as the fixture, but guarded
 * against mistakes and abuse: an ALLOWLIST of binaries (br, git with an allowlisted subcommand set, and plain filesystem tools confined to the
 * project), no shell, a bare binary name resolved only on absolute PATH entries outside the workspace, the sanitized environment of a check
 * (no credentials, throwaway HOME), one process group per command killed when it ends, bounded time and output, and a re-scan of the
 * resulting tree with the fixture rules (run again immediately before the agent starts).
 */

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const envlib = require('./env');
const { scanFixture } = require('./fixture');

const MAX_COMMANDS = 20;
const MAX_ARGS = 50;
const MAX_ARG_LENGTH = 2000;
// spawnSync blocks the Node event loop, and other concurrent runs' agents are in flight while a sandbox is created. Allowlisted setup commands
// take milliseconds, so the limits are short instead of the code being asynchronous (see the guide, "Long, multi-step evals").
const COMMAND_TIMEOUT_MS = 20 * 1000;
const TOTAL_TIMEOUT_MS = 60 * 1000;
const MAX_OUTPUT_BYTES = 64 * 1024;

const BINARY_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
// ALLOWLIST: nothing else (no interpreter, build tool, shell, wrapper or network client) can be named in `setup`.
const ALLOWED_BINARIES = ['br', 'git', 'mkdir', 'cp', 'mv', 'touch', 'chmod', 'rm'];
const GIT_SUBCOMMANDS = new Set(['add', 'commit', 'branch', 'checkout', 'switch', 'tag', 'mv', 'rm', 'status', 'config']);
const GIT_PATH_SUBCOMMANDS = new Set(['add', 'mv', 'rm']);
const GIT_CONFIG_KEYS = new Set(['user.name', 'user.email', 'commit.gpgsign']);
const GIT_DENIED_OPTIONS = ['--exec-path', '--git-dir', '--work-tree', '--namespace', '--config-env', '--super-prefix', '--attr-source'];
const BR_SUBCOMMANDS = new Set(['init', 'create', 'q', 'update', 'close', 'reopen', 'dep', 'label', 'comments', 'list', 'ready', 'show', 'count', 'stats', 'status', 'blocked', 'search', 'sync', 'defer', 'undefer', 'epic']);
// br options that take a path or leave the workspace (database elsewhere, files read from or written to other places).
const BR_DENIED_OPTIONS = ['--db', '--description-file', '--file', '-f', '--allow-external-jsonl', '--source-repo-path', '--source-repo', '--migrate-source-repo-path', '--beads-dir'];
// Plain filesystem tools: the options each may take (a tiny allowlist) and how many path operands it needs.
const FS_TOOLS = {
  mkdir: { flag: /^-p$/, min: 1 },
  cp: { flag: /^-[rRfp]+$/, min: 2 },
  mv: { flag: /^-f$/, min: 2 },
  touch: { flag: null, min: 1 },
  chmod: { flag: null, min: 1, mode: /^([0-7]{3}|[ugoa]*[-+=][rwxX]+(,[ugoa]*[-+=][rwxX]+)*)$/ },
  rm: { flag: /^-[rf]+$/, min: 1 },
};
const PROTECTED_NAMES = new Set(['.git', '.claude', '.claude.json', '.mcp.json', '.gitmodules', '.gitattributes', '.gitconfig']);

const notAllowed = (where, bin) => new Error(`${where}: \`${bin}\` is not on the setup allowlist (allowed binaries: ${ALLOWED_BINARIES.join(', ')})`);

/** The protected name (`.git`, `.claude`, `.mcp.json`, `.beads/hooks`, ...) that the relative path `rel` goes through, or null. */
function protectedTarget(rel) {
  const segs = rel.split(/[\\/]+/).filter((x) => x && x !== '.');
  const named = segs.find((x) => PROTECTED_NAMES.has(x.toLowerCase()));
  if (named) return named;
  if (segs[0] && segs[0].toLowerCase() === '.beads' && segs[1] && segs[1].toLowerCase() === 'hooks') return '.beads/hooks';
  return null;
}

/** Static check of a path operand (no filesystem): relative, no `~`, no `..`, not protected. Throws a named Error. */
function checkPathOperand(arg, where) {
  if (arg === '') throw new Error(`${where}: an empty path operand`);
  if (path.isAbsolute(arg) || arg.startsWith('/') || /^[A-Za-z]:[\\/]/.test(arg)) throw new Error(`${where}: path ${JSON.stringify(arg.slice(0, 60))} must be relative to the project (no absolute paths)`);
  if (arg.startsWith('~')) throw new Error(`${where}: path ${JSON.stringify(arg.slice(0, 60))} must not start with ~`);
  if (arg.split(/[\\/]+/).includes('..')) throw new Error(`${where}: path ${JSON.stringify(arg.slice(0, 60))} must not contain a .. segment`);
  const hit = protectedTarget(path.posix.normalize(arg));
  if (hit) throw new Error(`${where}: path ${JSON.stringify(arg.slice(0, 60))} is under ${hit}, which setup may not touch`);
}

/** For a non-path argument (a message, a name): its value, after any `--opt=`, must not look like an absolute, home or parent path. */
function checkLooseValue(arg, where) {
  const v = arg.startsWith('--') && arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : arg;
  if (v.startsWith('/') || v.startsWith('~') || v.split(/[\\/]+/).includes('..') || path.isAbsolute(v)) {
    throw new Error(`${where}: argument ${JSON.stringify(arg.slice(0, 60))} looks like an absolute, home or parent path; \`setup\` stays inside the project`);
  }
}

function vetFs(bin, args, where) {
  const spec = FS_TOOLS[bin];
  let rest = args;
  if (spec.mode) {
    if (!rest.length || !spec.mode.test(rest[0])) throw new Error(`${where}: \`chmod\` needs a plain mode first (for example +x, u+x, 755)`);
    rest = rest.slice(1);
  }
  const operands = [];
  for (const a of rest) {
    if (a.startsWith('-')) {
      if (!spec.flag || !spec.flag.test(a)) throw new Error(`${where}: option ${JSON.stringify(a.slice(0, 20))} is not on the allowlist for \`${bin}\``);
    } else operands.push(a);
  }
  if (operands.length < spec.min) throw new Error(`${where}: \`${bin}\` needs at least ${spec.min} path operand(s)`);
  for (const o of operands) checkPathOperand(o, where);
  if (bin === 'rm' || bin === 'mv') {
    for (const o of bin === 'mv' ? operands.slice(0, -1) : operands) {
      if (path.posix.normalize(o) === '.') throw new Error(`${where}: \`${bin}\` may not remove or move the project directory itself`);
    }
  }
}

function vetGit(args, where) {
  if (args.length < 1 || args[0].startsWith('-')) throw new Error(`${where}: \`git\` must be followed by a subcommand (no -c, -C or other leading option)`);
  const sub = args[0];
  if (!GIT_SUBCOMMANDS.has(sub)) throw new Error(`${where}: \`git ${sub.slice(0, 40)}\` is not on the setup allowlist (allowed subcommands: ${[...GIT_SUBCOMMANDS].join(', ')})`);
  const rest = args.slice(1);
  for (const a of rest) {
    if (GIT_DENIED_OPTIONS.some((o) => a === o || a.startsWith(`${o}=`))) throw new Error(`${where}: git option ${a.split('=')[0]} is not allowed in \`setup\``);
  }
  if (sub === 'config') {
    const r = rest[0] === '--local' ? rest.slice(1) : rest;
    if (r.length !== 2 || !GIT_CONFIG_KEYS.has(r[0].toLowerCase())) throw new Error(`${where}: \`git config\` is allowed only as \`git config [--local] <key> <value>\` for user.name, user.email or commit.gpgsign`);
    if (r[0].toLowerCase() === 'commit.gpgsign' && !['true', 'false'].includes(r[1])) throw new Error(`${where}: commit.gpgsign must be true or false`);
    return;
  }
  let afterDashes = false;
  for (const a of rest) {
    if (a === '--') { afterDashes = true; continue; }
    if (GIT_PATH_SUBCOMMANDS.has(sub) && (afterDashes || !a.startsWith('-'))) checkPathOperand(a, where);
    else checkLooseValue(a, where);
  }
}

function vetBr(args, where) {
  if (args.length < 1 || args[0].startsWith('-')) throw new Error(`${where}: \`br\` must be followed by a subcommand (no leading option)`);
  if (!BR_SUBCOMMANDS.has(args[0])) throw new Error(`${where}: \`br ${args[0].slice(0, 40)}\` is not on the setup allowlist (allowed subcommands: ${[...BR_SUBCOMMANDS].join(', ')})`);
  for (const a of args.slice(1)) {
    if (BR_DENIED_OPTIONS.some((o) => a === o || a.startsWith(`${o}=`))) throw new Error(`${where}: br option ${a.split('=')[0]} takes a path or leaves the workspace and is not allowed in \`setup\``);
    checkLooseValue(a, where);
  }
}

/**
 * Validate an eval's `setup` (array of argv arrays) at load time against the ALLOWLIST. Returns a deep copy; throws an Error naming the problem.
 */
function validateSetup(setup) {
  if (!Array.isArray(setup) || setup.length === 0) throw new Error('`setup` must be a non-empty array of argv arrays, for example [["br","init"]]');
  if (setup.length > MAX_COMMANDS) throw new Error(`\`setup\` may hold at most ${MAX_COMMANDS} commands`);
  return setup.map((argv, i) => {
    const where = `\`setup[${i}]\``;
    if (!Array.isArray(argv) || argv.length === 0) throw new Error(`${where} must be a non-empty array of strings (an argv; there is no shell)`);
    if (argv.length > MAX_ARGS) throw new Error(`${where} has more than ${MAX_ARGS} elements`);
    for (const a of argv) {
      if (typeof a !== 'string') throw new Error(`${where} must hold only strings`);
      if (a.length > MAX_ARG_LENGTH) throw new Error(`${where} has an element longer than ${MAX_ARG_LENGTH} characters`);
      if (a.includes('\0')) throw new Error(`${where} has an element containing a NUL byte`);
    }
    const bin = argv[0];
    if (/[/\\]/.test(bin) || path.isAbsolute(bin)) throw new Error(`${where}: the binary must be a bare name resolved on the safe PATH, not a path (got ${JSON.stringify(bin.slice(0, 60))})`);
    if (!BINARY_RE.test(bin)) throw new Error(`${where}: binary name ${JSON.stringify(bin.slice(0, 60))} must match ${BINARY_RE}`);
    if (!ALLOWED_BINARIES.includes(bin)) throw notAllowed(where, bin);
    if (bin === 'git') vetGit(argv.slice(1), where);
    else if (bin === 'br') vetBr(argv.slice(1), where);
    else vetFs(bin, argv.slice(1), where);
    return [...argv];
  });
}

/** realpath of the longest existing ancestor of `p` with the missing remainder re-appended (a symlink cannot hide a target). */
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
 * Run-time half of the path rules (the filesystem is real now): every path operand must still resolve, through any symlink, to a place
 * inside the project and not to a protected name. Returns null, or a reason.
 */
function vetOperandsAtRun(argv, dir) {
  const bin = argv[0];
  let operands = [];
  if (FS_TOOLS[bin]) operands = argv.slice(bin === 'chmod' ? 2 : 1).filter((a) => !a.startsWith('-'));
  else if (bin === 'git' && GIT_PATH_SUBCOMMANDS.has(argv[1])) operands = argv.slice(2).filter((a) => a !== '--' && !a.startsWith('-'));
  const root = realish(dir);
  for (const o of operands) {
    const real = realish(path.resolve(dir, o));
    if (real !== root && !real.startsWith(root + path.sep)) return `path ${JSON.stringify(o.slice(0, 60))} resolves outside the project`;
    const hit = protectedTarget(path.relative(root, real));
    if (hit) return `path ${JSON.stringify(o.slice(0, 60))} resolves under ${hit}, which setup may not touch`;
  }
  return null;
}

/** PATH entries safe to search: absolute, not `.` or empty (those mean the current directory, which is the fixture), outside `workspace`. */
function safePathEntries(parentPath, workspace) {
  const ws = path.resolve(workspace);
  return String(parentPath || '').split(path.delimiter).filter((d) => {
    if (!d || !path.isAbsolute(d)) return false;
    const r = path.resolve(d);
    return !(r === ws || r.startsWith(ws + path.sep));
  });
}

/** Absolute path of the executable `name` on `entries`, or null. */
function resolveBinary(name, entries) {
  for (const d of entries) {
    const p = path.join(d, name);
    try {
      if (!fs.statSync(p).isFile()) continue;
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch { /* next */ }
  }
  return null;
}

/** Environment for setup commands: a check's (no credentials, throwaway HOME, safe PATH) plus the git lockdown variables. */
function setupEnv({ parentEnv, home, workspace }) {
  const env = envlib.buildEnv({ parent: parentEnv, credentials: [], home });
  env.PATH = safePathEntries(parentEnv.PATH || '/usr/bin:/bin', workspace).join(path.delimiter);
  return {
    ...env, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'false', GIT_ALLOW_PROTOCOL: 'file',
  };
}

const oneLine = (text, n = 160) => envlib.shortReason(text).slice(0, n);

/** Kill every process left in the process group led by `pid` (the command and anything it started or detached from the shell). */
function killGroup(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return;
  try { process.kill(-pid, 'SIGKILL'); } catch { /* the group is already empty */ }
}

/**
 * Run `commands` in order in `dir`. Stops at the first failure. Each command is its own process group (`detached`), and the whole group is
 * killed when the command ends, normally or on timeout, so nothing it started in the background outlives it.
 * opts: { dir, home, parentEnv, timeoutMs (per command), totalMs, _unsafeAllowAny }. `_unsafeAllowAny` is a test-only door that skips the
 * run-time allowlist re-check; nothing in eval.json can set it (validateSetup is the only gate there).
 * Returns null on success, else a one-line reason naming the command index and binary.
 */
function runSetup(commands, { dir, home, parentEnv = process.env, timeoutMs = COMMAND_TIMEOUT_MS, totalMs = TOTAL_TIMEOUT_MS, _unsafeAllowAny = false }) {
  fs.mkdirSync(home, { recursive: true });
  const env = setupEnv({ parentEnv, home, workspace: dir });
  const entries = env.PATH.split(path.delimiter).filter(Boolean);
  const deadline = Date.now() + totalMs;
  for (let i = 0; i < commands.length; i++) {
    const argv = commands[i];
    const label = `setup[${i}] ${argv[0]}${argv[0] === 'git' ? ` ${argv[1]}` : ''}`;
    if (!_unsafeAllowAny) {
      try { validateSetup([argv]); } catch (e) { return `${label}: ${oneLine(e.message)}`; }
      const bad = vetOperandsAtRun(argv, dir);
      if (bad) return `${label}: ${bad}`;
    }
    const bin = resolveBinary(argv[0], entries);
    if (!bin) return `${label}: \`${argv[0]}\` was not found on the safe PATH`;
    const left = deadline - Date.now();
    if (left <= 0) return `${label}: the setup time budget of ${Math.round(totalMs / 1000)}s was used up`;
    const args = argv[0] === 'git' ? [...envlib.GIT_HARDEN, ...argv.slice(1)] : argv.slice(1);
    const r = childProcess.spawnSync(bin, args, {
      cwd: dir, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', detached: true,
      timeout: Math.min(timeoutMs, left), killSignal: 'SIGKILL', maxBuffer: MAX_OUTPUT_BYTES,
    });
    killGroup(r.pid);
    if (r.error) {
      const code = r.error.code;
      if (code === 'ETIMEDOUT') return `${label}: timed out`;
      if (code === 'ENOBUFS') return `${label}: output exceeded ${MAX_OUTPUT_BYTES} bytes`;
      return `${label}: could not start (${code || oneLine(r.error.message)})`;
    }
    if (r.status !== 0) {
      const tail = oneLine(`${r.stderr || ''} ${r.stdout || ''}`.slice(-400));
      return `${label}: exit ${r.status === null ? `signal ${r.signal}` : r.status}${tail ? `: ${tail}` : ''}`;
    }
  }
  return null;
}

/** Hooks other than git's `.sample` files in the repository at `dir`. */
function planted(dir) {
  const hooks = path.join(dir, '.git', 'hooks');
  if (!fs.existsSync(hooks)) return [];
  return fs.readdirSync(hooks).filter((n) => !n.endsWith('.sample')).map((n) => `.git/hooks/${n}`);
}

/**
 * Re-check the tree after setup with the fixture rules: no `.claude`, `.mcp.json`, `.gitmodules`... anywhere but the repository's own
 * top-level `.git`, no symlink out of the tree, no git hook, and `.git/config` byte-identical to `configBefore`.
 * Returns null when clean, else a reason.
 */
function checkAfterSetup(dir, configBefore) {
  const problems = scanFixture(dir).filter((p) => p.file !== '.git' && !p.file.startsWith(`.git${path.sep}`));
  if (problems.length) return `setup wrote rejected paths: ${problems.map((p) => `${p.file} (${p.reason})`).join('; ')}`;
  const hooks = planted(dir);
  if (hooks.length) return `setup wrote git hooks: ${hooks.join(', ')}`;
  const now = fs.readFileSync(path.join(dir, '.git', 'config'));
  if (!now.equals(configBefore)) return 'setup changed the repository git config (only the sandbox\'s own settings are allowed)';
  return null;
}

module.exports = { validateSetup, runSetup, killGroup, ALLOWED_BINARIES, checkAfterSetup, safePathEntries, resolveBinary, setupEnv, COMMAND_TIMEOUT_MS, TOTAL_TIMEOUT_MS, MAX_OUTPUT_BYTES, MAX_COMMANDS };
