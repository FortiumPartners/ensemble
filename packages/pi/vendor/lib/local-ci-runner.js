'use strict';

/**
 * Isolated local-CI gate runner.
 *
 * Runs the maintainer's TRUSTED command list itself (`bash -c`, stdio piped) in a
 * clean clone of the PR head commit (`.ensemble/local-ci-runs/<sha>`), once per
 * required Node version, and returns a result. PASS/FAIL is derived ONLY from the
 * exit status the runner observes; it never loads, executes or parses a file from
 * the head as a step list or verdict. It NEVER publishes anything: the caller
 * decides what to do with the result. FAIL CLOSED: every unknown, missing or
 * unprovable thing (unfetchable commit, unavailable Node version, workflow step
 * that is not mirrored, executed set != trusted list, step that exits non-zero, unreadable config) yields
 * `ok:false` with the reason named; a pass only comes from every required step
 * passing on every required Node version.
 *
 * Process and git access is injected (`deps`) so failure cases can be driven
 * without downloading Node or running a real `npm ci`.
 *
 * runGate(options, deps?) -> {
 *   ok, sha, error?, failures:[{kind, step, node, sha, message}],
 *   unmirrored:[{workflow, job, step}], nodes:[{node, ok, steps:[{name,status}]}],
 *   staleRemoved:[dirName], clonePath
 * }
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

const RUNS_DIR = path.join('.ensemble', 'local-ci-runs');
const DEFAULT_STEP_TIMEOUT_MS = 10 * 60 * 1000;
const SHA_RE = /^[0-9a-f]{40}$/;
const DEFAULT_STALE_MS = 60 * 60 * 1000;
const DEFAULT_SECRETS_FILE = path.join('.ensemble', 'local-ci.secrets.env');
// Steps the runner itself provides: the clean clone and the explicit Node version.
const DEFAULT_IGNORED_ACTIONS = ['actions/checkout', 'actions/setup-node'];
const REDACTED = '[REDACTED]';
const OUTPUT_TAIL = 4000;

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function normalizeCmd(cmd) {
  return String(cmd).replace(/\s+/g, ' ').trim();
}

function defaultDeps() {
  return {
    git(args, { cwd, input } = {}) {
      const r = spawnSync('git', args, { cwd, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      return { status: r.error ? 127 : r.status, stdout: r.stdout || '', stderr: r.stderr || (r.error ? String(r.error.message) : '') };
    },
    run(cmd, { cwd, env, timeoutMs = DEFAULT_STEP_TIMEOUT_MS } = {}) {
      // Same fail-fast shell GitHub Actions uses for `shell: bash` steps (-e -o pipefail). Plain `bash -c` returns only the LAST
      // command's status, so a failure in the middle of a multi-command step (a loop, a script block) would be graded as a pass
      // here while hosted CI fails it. --noprofile --norc keeps the maintainer's shell startup files out of the step.
      // A hung step must fail, not block the gate forever: `timeout` SIGKILLs bash, and `detached` makes bash a process-group
      // leader so the whole group (its children) is SIGKILLed too. Limit: a descendant that calls setsid() escapes the group.
      const r = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', cmd], {
        cwd, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL', detached: true,
      });
      const timedOut = !!(r.error && r.error.code === 'ETIMEDOUT');
      if (timedOut && r.pid) {
        try { process.kill(-r.pid, 'SIGKILL'); } catch { /* group already gone */ }
      }
      return { status: r.error ? 127 : r.status, stdout: r.stdout || '', stderr: r.stderr || (r.error ? String(r.error.message) : ''), timedOut };
    },
    resolveNodeBinDir(major) {
      const r = spawnSync('npx', ['--yes', '-p', `node@${major}`, 'node', '-p', 'process.execPath'], { encoding: 'utf8' });
      if (r.error || r.status !== 0) {
        throw new Error(`could not obtain Node ${major} via npx: ${(r.stderr || (r.error && r.error.message) || '').trim()}`);
      }
      return path.dirname(r.stdout.trim().split('\n').pop());
    },
  };
}

/* ------------------------------------------------------------------ secrets */

function parseSecretsFile(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

/**
 * Load the named secrets from a gitignored local file or the environment.
 * Throws if the file exists but is tracked or not ignored (a tracked file must
 * never be a secret source). Environment values win over the file.
 */
function loadSecrets({ repoRoot, names, secretsFile, env, deps }) {
  const values = {};
  if (!names || names.length === 0) return values;
  const rel = secretsFile || DEFAULT_SECRETS_FILE;
  const abs = path.resolve(repoRoot, rel);
  if (fs.existsSync(abs)) {
    const tracked = deps.git(['ls-files', '--error-unmatch', '--', rel], { cwd: repoRoot });
    if (tracked.status === 0) throw new Error(`secrets file ${rel} is tracked by git; refusing to read secrets from a tracked file`);
    const ignored = deps.git(['check-ignore', '-q', '--', rel], { cwd: repoRoot });
    if (ignored.status !== 0) throw new Error(`secrets file ${rel} is not gitignored; refusing to read it (add it to .gitignore)`);
    const parsed = parseSecretsFile(fs.readFileSync(abs, 'utf8'));
    for (const n of names) if (typeof parsed[n] === 'string') values[n] = parsed[n];
  }
  for (const n of names) if (typeof env[n] === 'string' && env[n] !== '') values[n] = env[n];
  return values;
}

/** Replace every secret value in `text`. Longest values first. */
function redact(text, secretValues) {
  if (typeof text !== 'string') return text;
  let out = text;
  const vals = secretValues.filter((v) => typeof v === 'string' && v !== '').sort((a, b) => b.length - a.length);
  for (const v of vals) out = out.split(v).join(REDACTED);
  return out;
}

function redactDeep(value, secretValues) {
  if (typeof value === 'string') return redact(value, secretValues);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, secretValues));
  if (isObject(value)) {
    const o = {};
    for (const k of Object.keys(value)) o[k] = redactDeep(value[k], secretValues);
    return o;
  }
  return value;
}

/* ------------------------------------------------------------- stale sweep */

/**
 * Remove clones under <repoRoot>/.ensemble/local-ci-runs/ that are older than
 * `maxAgeMs`. Touches ONLY real directories whose name is a 40-hex commit sha;
 * every other entry (and everything outside the prefix) is left alone.
 * Returns the names removed.
 */
function sweepStaleClones({ repoRoot, maxAgeMs = DEFAULT_STALE_MS, now = Date.now() }) {
  const root = path.join(repoRoot, RUNS_DIR);
  let entries;
  try {
    entries = fs.readdirSync(root);
  } catch {
    return [];
  }
  const removed = [];
  for (const name of entries) {
    if (!SHA_RE.test(name)) continue;
    const p = path.join(root, name);
    let st;
    try {
      st = fs.lstatSync(p);
    } catch {
      continue;
    }
    if (!st.isDirectory() || st.isSymbolicLink()) continue;
    if (now - st.mtimeMs <= maxAgeMs) continue;
    fs.rmSync(p, { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

/* ------------------------------------------------------------------- clone */

/**
 * Create a clean clone of repoRoot at exactly `sha` in <repoRoot>/.ensemble/local-ci-runs/<sha>.
 * Returns {ok:true, dir} or {ok:false, error}. On failure nothing is left behind.
 */
function cloneAtSha({ repoRoot, sha, remote = 'origin', deps }) {
  const unfetchable = (why) => ({ ok: false, error: `cannot obtain head commit ${sha}: ${why}` });
  if (typeof sha !== 'string' || !SHA_RE.test(sha)) {
    return { ok: false, error: `head commit ${JSON.stringify(sha)} is not a full 40-hex commit sha` };
  }
  const have = (cwd) => deps.git(['cat-file', '-e', `${sha}^{commit}`], { cwd }).status === 0;
  if (!have(repoRoot)) {
    const f = deps.git(['fetch', '--quiet', remote, sha], { cwd: repoRoot });
    if (f.status !== 0 || !have(repoRoot)) return unfetchable((f.stderr || 'not present locally and fetch failed').trim());
  }
  const root = path.join(repoRoot, RUNS_DIR);
  const dir = path.join(root, sha);
  if (fs.existsSync(dir)) {
    return { ok: false, error: `clone directory ${dir} already exists (another run for ${sha} may be in progress); remove it if it is stale` };
  }
  fs.mkdirSync(root, { recursive: true });
  const discard = () => fs.rmSync(dir, { recursive: true, force: true });
  const c = deps.git(['clone', '--quiet', '--no-checkout', '--local', '--no-hardlinks', repoRoot, dir], {});
  if (c.status !== 0) {
    discard();
    return unfetchable(`git clone failed: ${c.stderr.trim()}`);
  }
  if (!have(dir)) {
    // Commit exists in the source repo but is not reachable from a ref: fetch it by sha.
    const f = deps.git(['-c', 'uploadpack.allowAnySHA1InWant=true', 'fetch', '--quiet', repoRoot, sha], { cwd: dir });
    if (f.status !== 0 || !have(dir)) {
      discard();
      return unfetchable((f.stderr || 'commit missing from clone').trim());
    }
  }
  const co = deps.git(['-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--detach', sha], { cwd: dir });
  if (co.status !== 0) {
    discard();
    return unfetchable(`git checkout failed: ${co.stderr.trim()}`);
  }
  const head = deps.git(['rev-parse', 'HEAD'], { cwd: dir });
  if (head.status !== 0 || head.stdout.trim() !== sha) {
    discard();
    return unfetchable(`clone HEAD is ${head.stdout.trim() || 'unknown'}, not the requested commit`);
  }
  return { ok: true, dir };
}

/**
 * Did the steps change what they claim to have tested? Compares the clone with the tree of `sha` by CONTENT, not by
 * git's opinion of it: `git diff` / `git status` are blind to `update-index --assume-unchanged` and `--skip-worktree`,
 * which a hostile step can set to hide a modified tracked file, so each tracked path is hashed from disk and compared
 * with the blob id in the tree. Untracked files are ignored on purpose: honest steps write them (node_modules, coverage/).
 * Returns a list of problems; [] means the tracked content is exactly the tree of `sha`.
 */
function trackedIntegrity({ dir, sha, deps }) {
  const problems = [];
  const tree = deps.git(['rev-parse', `${sha}^{tree}`], { cwd: dir });
  const idx = deps.git(['write-tree'], { cwd: dir });
  if (tree.status !== 0 || idx.status !== 0 || idx.stdout.trim() !== tree.stdout.trim()) {
    problems.push(`the index no longer matches the tree of ${sha.slice(0, 8)}`);
  }
  const ls = deps.git(['ls-tree', '-r', '-z', '--full-tree', sha], { cwd: dir });
  if (ls.status !== 0) return [...problems, `cannot list the tracked files of ${sha.slice(0, 8)}`];
  for (const rec of String(ls.stdout).split('\0').filter(Boolean)) {
    const tab = rec.indexOf('\t');
    const [mode, type, blob] = rec.slice(0, tab).split(' ');
    const rel = rec.slice(tab + 1);
    if (type !== 'blob') continue; // a submodule entry is not tracked file content
    const abs = path.join(dir, rel);
    let st;
    try {
      st = fs.lstatSync(abs);
    } catch (_e) {
      problems.push(`tracked file removed: ${rel}`);
      continue;
    }
    if (mode === '120000') {
      const want = st.isSymbolicLink() ? fs.readlinkSync(abs) : null;
      const h = want === null ? null : deps.git(['hash-object', '--stdin'], { cwd: dir, input: want }).stdout.trim();
      if (h !== blob) {
        problems.push(`tracked symlink changed: ${rel}`);
      } else if (!symlinkStaysInside(dir, abs)) {
        // The link text is what the tree records, but the steps read whatever it points at. A link that leaves the
        // clone makes them read the maintainer's disk, not the commit being graded.
        problems.push(`tracked symlink resolves outside the clone: ${rel}`);
      }
      continue;
    }
    const h = deps.git(['hash-object', '--no-filters', '--', rel], { cwd: dir });
    if (h.status !== 0 || h.stdout.trim() !== blob) problems.push(`tracked file modified: ${rel}`);
  }
  return problems;
}

/** True when `abs` (a symlink inside `dir`) resolves to a real path inside the real path of `dir`. Dangling counts as outside. */
function symlinkStaysInside(dir, abs) {
  try {
    const realDir = fs.realpathSync(dir);
    const real = fs.realpathSync(abs);
    return real === realDir || real.startsWith(realDir + path.sep);
  } catch (_e) {
    return false;
  }
}

/**
 * Every file in the clone that is not tracked, whatever the head's .gitignore says (`ls-files --others` without
 * `--exclude-standard` lists them all; `git status` honours the head's own ignore rules, so a head could hide a planted
 * file from it). Returns an array of repo-relative paths, or null when git could not answer (callers fail closed).
 */
function untrackedFiles({ dir, deps }) {
  const r = deps.git(['ls-files', '-z', '--others'], { cwd: dir });
  if (r.status !== 0) return null;
  return String(r.stdout).split('\0').filter(Boolean);
}

/** Is `rel` equal to, or inside, one of the allowed output paths (plain directory/file prefixes, no globs)? */
function isAllowedOutput(rel, outputPaths) {
  return outputPaths.some((p) => rel === p || rel.startsWith(`${p}/`));
}

/**
 * An untracked file is the one thing a step can plant that a later command, or the head's own test, reads as permission
 * to pass: tracked content is verified byte for byte, but a file that was never in the commit has nothing to compare
 * with. So after the steps, every untracked file that was not there before must sit under a path the BASE-ref config
 * lists as build output (`output_paths`). Returns the offending paths, or null when the clone could not be inspected.
 */
function unexpectedOutput({ dir, deps, before, outputPaths }) {
  const after = untrackedFiles({ dir, deps });
  if (after === null || before === null) return null;
  const known = new Set(before);
  return after.filter((rel) => !known.has(rel) && !isAllowedOutput(rel, outputPaths));
}

/** The clone's own git configuration, so a step that sets core.fsmonitor, hooksPath, sshCommand etc. is detected. */
function cloneGitConfig({ dir, deps }) {
  const r = deps.git(['config', '--local', '--list', '-z'], { cwd: dir });
  return r.status === 0 ? String(r.stdout) : null;
}

/* --------------------------------------------------------- step mirroring */

/** Label of a workflow step: its name, else its first run line, else its action. */
function stepLabel(step) {
  if (typeof step.name === 'string' && step.name.trim()) return step.name.trim();
  if (typeof step.run === 'string') return step.run.trim().split('\n')[0];
  if (typeof step.uses === 'string') return step.uses;
  return '(unnamed step)';
}

function actionName(uses) {
  return String(uses).split('@')[0].toLowerCase();
}

/**
 * Pure: compare the REQUIRED steps of the approval-set workflow jobs with the
 * steps the runner actually runs.
 *
 *   workflows:  [{file, doc}]  parsed workflow files (doc = parsed YAML)
 *   approvalSet.workflows: [{file, jobs:[{id}]}]
 *   runnable:   [{name, cmd}]  ci:local steps + configured extra steps
 *   equivalents:[{workflowStep, runs}]  workflowStep (label or run text) is
 *               covered by the runnable step named `runs`
 *   ignoredActions: actions the runner supplies itself (checkout, setup-node)
 *   excludedSteps: [{workflow, job, step, reason}] steps that cannot run locally
 *               and are recorded as deliberately excluded (AC-009-3). Matched by
 *               workflow file + job id + step label, so a same-named step in
 *               another job is NOT excluded.
 *
 * A workflow step is mirrored if its `run` text equals a runnable command, or an
 * equivalents entry maps it to an existing runnable step. Any other step (an
 * unsupported action, a run command nobody runs) is unmirrored.
 * Returns [{workflow, job, step, reason}].
 */
function findUnmirroredSteps({ workflows, approvalSet, runnable, equivalents = [], ignoredActions = DEFAULT_IGNORED_ACTIONS, excludedSteps = [] }) {
  const ignored = new Set(ignoredActions.map((a) => a.toLowerCase()));
  const byCmd = new Set(runnable.map((r) => normalizeCmd(r.cmd)));
  const byName = new Set(runnable.map((r) => r.name));
  const unmirrored = [];
  const parsed = new Map(workflows.map((w) => [w.file, w.doc]));

  for (const wf of approvalSet.workflows || []) {
    const doc = parsed.get(wf.file);
    for (const job of wf.jobs || []) {
      const jobDef = isObject(doc) && isObject(doc.jobs) ? doc.jobs[job.id] : undefined;
      if (!isObject(jobDef) || !Array.isArray(jobDef.steps)) {
        unmirrored.push({ workflow: wf.file, job: job.id, step: '(job not found or has no steps)', reason: 'workflow job cannot be read' });
        continue;
      }
      for (const step of jobDef.steps) {
        if (!isObject(step)) {
          unmirrored.push({ workflow: wf.file, job: job.id, step: '(malformed step)', reason: 'step is not a mapping' });
          continue;
        }
        const label = stepLabel(step);
        if (excludedSteps.some((x) => isObject(x) && x.workflow === wf.file && x.job === job.id && x.step === label)) continue;
        if (typeof step.uses === 'string' && ignored.has(actionName(step.uses))) continue;
        if (typeof step.run === 'string' && byCmd.has(normalizeCmd(step.run))) continue;
        const eq = equivalents.find(
          (e) => isObject(e) && (e.workflowStep === label || (typeof step.run === 'string' && normalizeCmd(e.workflowStep) === normalizeCmd(step.run)))
        );
        if (eq && byName.has(eq.runs)) continue;
        unmirrored.push({
          workflow: wf.file,
          job: job.id,
          step: label,
          reason: eq ? `equivalent step "${eq.runs}" is not in the configured step list` : 'no configured step mirrors it',
        });
      }
    }
  }
  return unmirrored;
}

/** Required Node majors: union of numeric `node-version` matrix values in the approval set. */
function requiredNodeVersions(approvalSet) {
  const set = new Set();
  for (const c of approvalSet.checks || []) {
    const v = isObject(c.matrix) ? c.matrix['node-version'] : undefined;
    const n = Number(v);
    if (v !== undefined && Number.isInteger(n) && n > 0) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * The longest one run can take inside its own limits: every required Node version runs `node --version`, then every
 * trusted step, and each command is cut off after DEFAULT_STEP_TIMEOUT_MS (a step after `stepTimeoutMs` when given).
 * There is no run-level deadline, and the clone and the Node download have no timeout, so this is what the step limits
 * allow, not a cap on the whole run. Whoever waits for a run (the gate lock) sizes its patience from it.
 */
function worstCaseMs(approvalSet, options) {
  const perStep = options && Number.isFinite(options.stepTimeoutMs) && options.stepTimeoutMs > 0 ? options.stepTimeoutMs : DEFAULT_STEP_TIMEOUT_MS;
  const steps = approvalSet && Array.isArray(approvalSet.steps) ? approvalSet.steps.length : 0;
  return requiredNodeVersions(approvalSet || {}).length * (DEFAULT_STEP_TIMEOUT_MS + steps * perStep);
}

/* --------------------------------------------------------------- reporting */

function tail(text) {
  const t = String(text || '').trim();
  return t.length > OUTPUT_TAIL ? `...${t.slice(-OUTPUT_TAIL)}` : t;
}

/** A failing step's retained output is capped: a runaway test must not fill the disk. */
const FAILURE_LOG_MAX = 2 * 1024 * 1024;

/**
 * Keep the FULL output of a failing step so the cause can be read later; the report itself keeps only a short tail, which
 * for a long test run is just the last passing lines. The file name is built from the commit SHA, an integer Node major and
 * the step name reduced to [A-Za-z0-9._-], never from anything else the head controls. The text is run through the same
 * redaction as the report (with the secret values known NOW), capped, and written owner-only. Writing a log must never
 * change a verdict, so any problem returns null instead of throwing.
 */
function writeFailureLog({ dir, sha, major, stepName, cmd, status, stdout, stderr, secretValues }) {
  try {
    if (typeof dir !== 'string' || dir === '') return null;
    const safeStep = String(stepName || 'step').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60) || 'step';
    const safeSha = /^[0-9a-fA-F]{7,64}$/.test(String(sha)) ? String(sha) : 'unknown';
    const node = Number.isInteger(major) ? major : 0;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${safeSha.slice(0, 12)}-node${node}-${safeStep}.log`);
    let body = `step: ${stepName}\nnode: ${node}\ncommit: ${sha}\nexit: ${status}\ncommand:\n${cmd}\n\n----- stdout -----\n${stdout || ''}\n\n----- stderr -----\n${stderr || ''}\n`;
    body = redact(body, secretValues);
    if (body.length > FAILURE_LOG_MAX) body = `${body.slice(0, FAILURE_LOG_MAX)}\n[truncated at ${FAILURE_LOG_MAX} characters]\n`;
    fs.writeFileSync(file, body, { mode: 0o600 });
    return file;
  } catch (_e) {
    return null;
  }
}

/**
 * Inherited variables whose NAME looks like a credential. Their VALUES (length
 * >= MIN_SECRET_LENGTH) are redacted from everything the runner returns.
 */
const SECRET_NAME_RE = /TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL|AUTH/i;
const MIN_SECRET_LENGTH = 6;

/**
 * The only inherited variables a step sees (plus CI, a scratch HOME, the Node-pinned PATH and the configured secret
 * names). The full maintainer environment is never passed on. HOME is NOT inherited: a step runs the PR head's code, and
 * with the real HOME it could rewrite ~/.gitconfig, ~/.npmrc or shell profiles (which outlive the run) or read ~/.ssh
 * and ~/.aws. Each run gets a fresh scratch HOME instead; the npm cache is pointed back at the maintainer's real cache so
 * installs stay warm (npm verifies cache entries by integrity hash).
 */
const ENV_ALLOWLIST = ['USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'NODE_OPTIONS'];

function inheritedSecretValues(env) {
  const out = [];
  for (const [name, value] of Object.entries(env || {})) {
    if (SECRET_NAME_RE.test(name) && typeof value === 'string' && value.length >= MIN_SECRET_LENGTH) out.push(value);
  }
  return out;
}

function buildStepEnv({ env, secrets, binDir, scratchHome }) {
  const stepEnv = {};
  for (const name of ENV_ALLOWLIST) if (typeof env[name] === 'string') stepEnv[name] = env[name];
  stepEnv.HOME = scratchHome;
  const realCache = typeof env.npm_config_cache === 'string' && env.npm_config_cache
    ? env.npm_config_cache
    : typeof env.HOME === 'string' && env.HOME ? path.join(env.HOME, '.npm') : null;
  if (realCache) stepEnv.npm_config_cache = realCache;
  Object.assign(stepEnv, secrets);
  stepEnv.CI = 'true';
  stepEnv.PATH = `${binDir}${path.delimiter}${env.PATH || ''}`;
  return stepEnv;
}

/** The trusted list must be a non-empty list of {name, cmd} with unique names. */
function validateSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return 'the trusted step list is missing or empty';
  const seen = new Set();
  for (const s of steps) {
    if (!isObject(s) || typeof s.name !== 'string' || s.name.trim() === '' || typeof s.cmd !== 'string' || s.cmd.trim() === '') {
      return 'every trusted step needs a non-empty name and cmd';
    }
    if (seen.has(s.name)) return `duplicate trusted step name "${s.name}"`;
    seen.add(s.name);
  }
  return null;
}

/* --------------------------------------------------------------------- run */

/**
 * Run the local CI gate for `headSha`.
 *
 * options:
 *   repoRoot       (required) the maintainer's repository
 *   headSha        (required) full 40-hex PR head commit
 *   approvalSet    (required) approvalSet from local-ci-config.validateConfig of the
 *                  MAINTAINER's config; approvalSet.steps is the trusted command list
 *                  [{name, cmd}] the runner executes itself, in order
 *   equivalents    [{workflowStep, runs}] workflow step -> trusted step name covering it
 *   ignoredActions actions the runner supplies (default checkout, setup-node)
 *   excludedSteps  [{workflow, job, step, reason}] steps recorded as not runnable locally
 *   secretNames    names of secrets steps need; values from secretsFile or env
 *   secretsFile    repo-relative gitignored file (default .ensemble/local-ci.secrets.env)
 *   env            the maintainer environment (default process.env); only ENV_ALLOWLIST,
 *                  the configured secrets, CI and PATH reach a step
 *   remote         git remote to fetch a missing head from (default origin)
 *   staleMs, now   stale-clone threshold and clock
 *   keep           keep the clone (debugging only)
 *   failureLogDir  directory to keep the FULL output of each failing step (redacted with the report's secret
 *                  values, capped at 2 MB, owner-only); the report names the file. Off when omitted.
 *
 * Required Node versions come ONLY from the approval set matrices. Nothing from the
 * PR head is loaded or executed by the runner itself: head files are read as data
 * (workflow YAML) to detect drift, never as a step list or a verdict.
 */
function runGate(options, injected) {
  const deps = { ...defaultDeps(), ...(injected || {}) };
  const opts = options || {};
  const sha = opts.headSha;
  const env = opts.env || process.env;
  const result = { ok: false, sha, failures: [], unmirrored: [], nodes: [], staleRemoved: [], clonePath: null };
  let secretValues = inheritedSecretValues(env);

  const fail = (kind, step, node, message) => {
    result.failures.push({ kind, step: step || null, node: node === undefined ? null : node, sha, message });
    result.ok = false;
  };
  const finish = () => redactDeep(result, secretValues);

  if (!opts.repoRoot || !isObject(opts.approvalSet) || !Array.isArray(opts.approvalSet.workflows)) {
    result.error = 'runGate requires repoRoot and a validated approvalSet';
    fail('invalid-input', null, undefined, result.error);
    return finish();
  }
  const repoRoot = path.resolve(opts.repoRoot);

  const steps = opts.approvalSet.steps;
  const stepsProblem = validateSteps(steps);
  if (stepsProblem) {
    result.error = `prerequisite missing: ${stepsProblem}`;
    fail('prerequisite', 'steps', undefined, result.error);
    return finish();
  }

  // Prerequisite: git.
  const gv = deps.git(['--version'], { cwd: repoRoot });
  if (gv.status !== 0) {
    result.error = `prerequisite missing: git is unavailable (${tail(gv.stderr)})`;
    fail('prerequisite', 'git', undefined, result.error);
    return finish();
  }

  // Secrets never come from a tracked file.
  let secrets;
  try {
    secrets = loadSecrets({ repoRoot, names: opts.secretNames || [], secretsFile: opts.secretsFile, env, deps });
  } catch (err) {
    result.error = err.message;
    fail('secrets', null, undefined, err.message);
    return finish();
  }
  secretValues = [...secretValues, ...Object.values(secrets)];

  // Clones left by a crashed earlier run (only sha-named dirs under the prefix).
  try {
    result.staleRemoved = sweepStaleClones({ repoRoot, maxAgeMs: opts.staleMs, now: opts.now });
  } catch (err) {
    result.error = `could not clean stale clones: ${err.message}`;
    fail('cleanup', null, undefined, result.error);
    return finish();
  }

  const clone = cloneAtSha({ repoRoot, sha, remote: opts.remote, deps });
  if (!clone.ok) {
    result.error = clone.error;
    fail('unfetchable-head', null, undefined, clone.error);
    return finish();
  }
  const dir = clone.dir;
  result.clonePath = dir;
  // Baseline of the clone's own git config, taken before any step runs; compared after (a step that sets core.fsmonitor,
  // core.hooksPath, core.sshCommand ... would otherwise change what later git calls in the clone execute).
  const configBefore = cloneGitConfig({ dir, deps });
  // Untracked files present before any step runs (a fresh clone has none). Output paths come from the base-ref config;
  // a caller that supplies none gets the defaults, never "everything is allowed".
  const untrackedBefore = untrackedFiles({ dir, deps });
  const outputPaths = Array.isArray(opts.approvalSet.outputPaths) ? opts.approvalSet.outputPaths : ['node_modules', 'coverage', '.cache', 'dist'];
  // A throwaway HOME outside the clone for the steps (see ENV_ALLOWLIST); removed in `finally` whatever happens.
  const scratchHome = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ci-home-'));

  try {
    // Read the REQUIRED workflows at the PR head as DATA and compare with the
    // trusted list. The head can only make this stricter.
    const workflows = [];
    const realDir = fs.realpathSync(dir);
    for (const wf of opts.approvalSet.workflows) {
      let doc;
      try {
        // The head controls what this path resolves to (a committed symlink, or a symlinked parent directory).
        // Resolve it and refuse anything that leaves the clone, so a head cannot make the gate read, and treat
        // as its own workflow, a file from the maintainer's disk.
        const real = fs.realpathSync(path.join(dir, wf.file));
        if (real !== realDir && !real.startsWith(realDir + path.sep)) {
          fail('unreadable-workflow', wf.file, undefined, `workflow ${wf.file} resolves outside the clone (symlink); refusing to read it`);
          doc = undefined;
        } else if (!fs.statSync(real).isFile()) {
          fail('unreadable-workflow', wf.file, undefined, `workflow ${wf.file} is not a regular file at the PR head`);
          doc = undefined;
        } else {
          doc = yaml.load(fs.readFileSync(real, 'utf8'));
        }
      } catch (err) {
        doc = undefined;
      }
      workflows.push({ file: wf.file, doc });
    }
    result.unmirrored = findUnmirroredSteps({
      workflows,
      approvalSet: opts.approvalSet,
      runnable: steps,
      equivalents: opts.equivalents,
      ignoredActions: opts.ignoredActions,
      excludedSteps: opts.excludedSteps,
    });
    for (const u of result.unmirrored) {
      fail('unmirrored-step', u.step, undefined, `required workflow step "${u.step}" (${u.workflow} job ${u.job}) is not mirrored: ${u.reason}`);
    }
    if (result.unmirrored.length > 0) return finish();

    const versions = requiredNodeVersions(opts.approvalSet);
    if (versions.length === 0) {
      fail('node-version', null, undefined, 'no required Node versions are configured; refusing to run on the machine default');
      return finish();
    }

    for (const major of versions) {
      const node = { node: major, ok: false, steps: [] };
      result.nodes.push(node);

      let binDir;
      try {
        binDir = deps.resolveNodeBinDir(major);
      } catch (err) {
        fail('node-version', null, major, `required Node ${major} cannot be provided: ${err.message}`);
        continue;
      }
      const stepEnv = buildStepEnv({ env, secrets, binDir, scratchHome });

      const ver = deps.run('node --version', { cwd: dir, env: stepEnv });
      const reported = ver.status === 0 ? /^v(\d+)\./.exec(ver.stdout.trim()) : null;
      if (!reported || Number(reported[1]) !== major) {
        fail('node-version', null, major, `required Node ${major} is not what ran (got ${tail(ver.stdout) || 'no version'}); not counting it`);
        continue;
      }

      // Every trusted command is run by the runner; the verdict is its exit status.
      for (const s of steps) {
        const r = deps.run(s.cmd, { cwd: dir, env: stepEnv, timeoutMs: opts.stepTimeoutMs });
        if (r.status === 0 && !r.timedOut) {
          node.steps.push({ name: s.name, status: 'PASS' });
        } else {
          node.steps.push({ name: s.name, status: 'FAIL' });
          const logFile = opts.failureLogDir
            ? writeFailureLog({ dir: opts.failureLogDir, sha, major, stepName: s.name, cmd: s.cmd, status: r.status, stdout: r.stdout, stderr: r.stderr, secretValues })
            : null;
          const why = r.timedOut
            ? `step ${s.name} timed out after ${Math.round((opts.stepTimeoutMs || DEFAULT_STEP_TIMEOUT_MS) / 1000)}s (hung?)`
            : `step "${s.name}" failed on Node ${major} at ${sha} (exit ${r.status})`;
          fail('step-failed', s.name, major, `${why}${logFile ? `; full output: ${logFile}` : ''}: ${tail(`${r.stdout}\n${r.stderr}`)}`);
        }
        // After EVERY step, whether it passed or not: a step may only leave untracked files under the base config's
        // output_paths. Anything else is a file the next command (or this step's own test) could read as permission.
        const stray = unexpectedOutput({ dir, deps, before: untrackedBefore, outputPaths });
        if (stray === null) {
          fail('clone-tampered', s.name, major, `could not inspect the clone for files left by step "${s.name}"; not counting the run`);
        } else if (stray.length > 0) {
          fail('unexpected-output', s.name, major, `step "${s.name}" left untracked files outside output_paths (${outputPaths.join(', ')}): ${stray.slice(0, 5).join(', ')}${stray.length > 5 ? `, and ${stray.length - 5} more` : ''}; not counting the run`);
        }
      }
      node.ok = executedMatches(node.steps, steps) && node.steps.every((x) => x.status === 'PASS');
    }

    // The attestation is bound to `sha`: a step that moved the clone's HEAD voids the run.
    const head = deps.git(['rev-parse', 'HEAD'], { cwd: dir });
    if (head.status !== 0 || head.stdout.trim() !== sha) {
      fail('clone-moved', null, undefined, `the clean clone no longer sits at ${sha} after the steps ran (got ${tail(head.stdout) || 'no HEAD'}); not counting the run`);
    }

    // The steps must not have rewritten what they claim to have tested: tracked content is compared by hash against the
    // tree of `sha` (see trackedIntegrity), and the clone's own git config must be unchanged. Untracked files are held
    // to the same standard after every step (see unexpectedOutput), so a step cannot plant one for a later step to read.
    const tampered = trackedIntegrity({ dir, sha, deps });
    if (tampered.length > 0) {
      fail('clone-tampered', null, undefined, `a step changed tracked content of the clean clone at ${sha}; not counting the run: ${tampered.slice(0, 5).join('; ')}${tampered.length > 5 ? `; and ${tampered.length - 5} more` : ''}`);
    }
    const configAfter = cloneGitConfig({ dir, deps });
    if (configBefore === null || configAfter === null || configAfter !== configBefore) {
      fail('clone-config-changed', null, undefined, `the clone's git configuration changed (or could not be read) while the steps ran; not counting the run`);
    }

    result.ok = result.failures.length === 0 && result.nodes.length === versions.length && result.nodes.every((n) => n.ok);
    return finish();
  } catch (err) {
    result.error = `local CI runner error: ${err.message}`;
    fail('runner-error', null, undefined, result.error);
    return finish();
  } finally {
    fs.rmSync(scratchHome, { recursive: true, force: true });
    if (!opts.keep) fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Fail closed: the executed names must be exactly the trusted list, in order. */
function executedMatches(executed, steps) {
  return executed.length === steps.length && steps.every((s, i) => executed[i].name === s.name);
}

module.exports = {
  defaultDeps,
  runGate,
  cloneAtSha,
  sweepStaleClones,
  findUnmirroredSteps,
  requiredNodeVersions,
  worstCaseMs,
  loadSecrets,
  parseSecretsFile,
  redact,
  RUNS_DIR,
  DEFAULT_STALE_MS,
  DEFAULT_IGNORED_ACTIONS,
};
