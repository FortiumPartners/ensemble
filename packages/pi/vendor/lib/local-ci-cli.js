#!/usr/bin/env node
'use strict';

/**
 * Local CI gate CLI (TRD-005). Thin JSON-in/JSON-out dispatcher over the
 * local-ci-* modules: one JSON payload on stdin per subcommand, one JSON
 * object on stdout. The only logic here is ORDERING (`gate`: prerequisites -> lock -> run -> record -> post) and the
 * merge-readiness decision (`merge`), both of which only combine verdicts the modules already produce. `gate` and `run`
 * are the two subcommands that run CI: each takes the lock (local-ci-lock.js), so they run one at a time per home
 * directory, and each reports its wait as `queued_ms`.
 *
 *   config   {source|repoRoot, baseRef}            validateConfig (source: text check only)
 *   record   {action: build|parse|verify, input}   buildRecord / parseRecord / verifyRecord
 *   run      {repoRoot, headSha, baseRef}          runGate (never publishes; takes the same lock as `gate`)
 *   post     {input:{repo,sha,state,context,description}}  postStatus (maintainer's own gh login)
 *   review   {action: classify|decide, reviews}    classifyReviews / decideBlock
 *   sweep    {facts, repoRoot, repo, pr, headSha, baseSha, dryRun?}  record each untracked finding/CI failure as a bead
 *   timing   {action: ready|verdict|record|fidelity|note, input}
 *   merge    {headSha, statuses, repoRoot, baseRef, reviews?}  merge readiness for a PR
 *   gate     {repoRoot, headSha, baseRef, repo, dryRun?}  full gate run
 *
 * TRUST: the approval set and the command list the runner executes come ONLY from
 * `.ensemble/local-ci.yaml` as committed at the PR's BASE ref (`git show <baseRef>:...`),
 * the same principle as GitHub's pull_request_target: a PR that edits the config is
 * graded by the old one. The maintainer's working tree, the checked-out branch, the
 * clone and the payload are never consulted for config. Payloads cannot carry config,
 * paths, scripts or runner options: unknown keys are rejected.
 *
 * TRUST (honest actor): the status is posted with the maintainer's own `gh` login. pr-merge verifies the head-SHA binding,
 * the run record and review state; it does NOT verify who posted the status. There is no GitHub App, key or token here.
 *
 * TRUST (sweep): `sweep` is the one subcommand here that writes to a tracker, so before it writes it asks what the PR-review
 * recorder asks (local-ci-sweep-record.js, which runs pr-review-beads-cli.js `checkTrust`): the host is asked about `repo`/`pr`
 * (a head on a fork, an unreadable pull request, a head that is not the PR's head and a `baseSha` that is not on its base branch
 * are REFUSED by name), the tracker runs in the repository's primary checkout, never in a worktree or clone of the head, with the
 * tracker choice read from `.ensemble/toolchain.yaml` as committed at `baseSha` and no adapter code loaded from any tree. The
 * dedupe set is built from the tracker, never from the payload: a `trackedKeys` key is rejected like any other unknown key.
 *
 * FAIL CLOSED: malformed or oversized (> MAX_STDIN_BYTES) JSON is rejected
 * before any handler runs (exit 1, `{error}`, no side effects). Every string
 * emitted passes through redact(). A result with `ok:false` exits 1.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { buildRecord, parseRecord, verifyRecord } = require('./local-ci-record');
const { postStatus, redact, MAX_DESCRIPTION, CANNOT_ATTEST } = require('./local-ci-status');
const { classifyReviews, decideBlock } = require('./local-ci-review');
const timing = require('./local-ci-timing');
const gateLock = require('./local-ci-lock');
const rollout = require('./local-ci-rollout');

// config and runner need js-yaml. They load on first use so the CLI still starts
// (and reports a usable error) where js-yaml is not resolvable, e.g. a bare vendor dir.
const validateConfig = (source) => require('./local-ci-config').validateConfig(source);
const runGate = (options, injected) => require('./local-ci-runner').runGate(options, injected);
const runnerWorstCaseMs = (approvalSet, options) => require('./local-ci-runner').worstCaseMs(approvalSet, options);

/** Largest accepted stdin payload: 1 MiB. */
const MAX_STDIN_BYTES = 1024 * 1024;
const DEFAULT_CONFIG_PATH = '.ensemble/local-ci.yaml';
const STEPS_LABEL = 'local-ci steps';
const SHA_RE = /^[0-9a-fA-F]{40}$/;
// Payload keys each handler accepts; anything else is rejected (fail closed).
const CONFIG_KEYS = ['source', 'repoRoot', 'baseRef'];
const RUN_KEYS = ['repoRoot', 'headSha', 'baseRef'];
const GATE_KEYS = ['repoRoot', 'headSha', 'baseRef', 'repo', 'pr', 'dryRun'];
const MERGE_KEYS = ['headSha', 'statuses', 'repoRoot', 'baseRef', 'repo', 'pr', 'reviews'];
const SWEEP_KEYS = ['facts', 'repoRoot', 'repo', 'pr', 'headSha', 'baseSha', 'dryRun'];

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';
// A baseRef names the PR's BASE BRANCH as a remote-tracking ref: `<remote>/<branch>` (what `git fetch` populates) or its
// full form `refs/remotes/<remote>/<branch>`. Nothing else is accepted: no local branch, no raw or abbreviated SHA, no
// HEAD or `@`, and no revision syntax (`@{n}` reflog, `^`, `~`, `:`, `..`), any of which would let a ref the head's author
// can move (or one only in the maintainer's reflog) choose which config is trusted. The branch part is limited to a safe
// character set; a base branch outside it is refused (fail closed). It is passed to git as ONE argv element.
const BASE_REF_RE = /^(?:refs\/remotes\/)?[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const isBaseRef = (v) =>
  typeof v === 'string' &&
  v.length <= 200 &&
  BASE_REF_RE.test(v) &&
  // `refs/heads/x` and `refs/tags/x` fit the `<remote>/<branch>` shape (remote "refs"); only the full refs/remotes/ form may start with refs/.
  (!v.startsWith('refs/') || v.startsWith('refs/remotes/')) &&
  !v.includes('..') &&
  !v.split('/').some((part) => part === '' || part === '.' || part.startsWith('.') || part.endsWith('.lock'));
/** `origin/dev` -> `refs/remotes/origin/dev`; an already-full name is unchanged. */
const fullRemoteRef = (v) => (v.startsWith('refs/remotes/') ? v : `refs/remotes/${v}`);
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const isRepo = (v) => typeof v === 'string' && v.length <= 140 && REPO_RE.test(v) && !v.startsWith('-') && !v.startsWith('.');
const isPrNumber = (v) => Number.isInteger(v) && v > 0 && v <= 2147483647;

function shown(name) {
  return typeof name === 'string' ? JSON.stringify(name.slice(0, 40)) : String(name);
}

function need(payload, key, check, what) {
  if (!isObject(payload)) throw new Error('payload must be a JSON object');
  if (!check(payload[key])) throw new Error(`${what}: ${key} is missing or malformed`);
  return payload[key];
}

/** Read stdin as JSON, rejecting payloads over MAX_STDIN_BYTES without parsing. */
function readStdinJson(fd = 0) {
  const chunks = [];
  let total = 0;
  const buf = Buffer.alloc(64 * 1024);
  for (;;) {
    let n;
    try {
      n = fs.readSync(fd, buf, 0, buf.length, null);
    } catch (err) {
      if (err.code === 'EAGAIN') continue;
      if (err.code === 'EOF') break;
      throw err;
    }
    if (n === 0) break;
    total += n;
    if (total > MAX_STDIN_BYTES) throw new Error(`payload exceeds ${MAX_STDIN_BYTES} bytes`);
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function defaultDeps() {
  const tool = (cmd, args, cwd) => {
    const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
    return { status: r.error ? 127 : r.status, stdout: r.stdout || '', stderr: r.stderr || (r.error ? String(r.error.message) : '') };
  };
  return {
    node: () => tool('node', ['--version']),
    git: (args, cwd) => tool('git', args, cwd),
    exists: (p) => fs.existsSync(p),
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    runGate,
    postStatus,
    prInfo: ({ repo, pr }) => {
      // argv elements, never a shell; `repo` and `pr` were validated by isRepo/isPrNumber before this is reached.
      const r = tool('gh', ['pr', 'view', String(pr), '--repo', repo, '--json', 'baseRefName,headRefOid,state']);
      if (r.status !== 0) return { ok: false, error: `gh pr view failed: ${String(r.stderr).trim().slice(0, 200) || `exit ${r.status}`}` };
      try {
        return { ok: true, info: JSON.parse(r.stdout) };
      } catch (_e) {
        return { ok: false, error: 'gh pr view returned output that is not JSON' };
      }
    },
    // Serializes CI runs (`gate` and `run`) per user home (see local-ci-lock.js). `hold` is the runner's worst-case hold
    // for the config at hand, which sizes a waiter's default patience. The policy knobs come from the process
    // environment: the lock belongs to whoever runs this CLI, not to the step environment `env` below.
    acquireGateLock: (hold) => gateLock.acquireFromEnv(process.env, undefined, hold),
    // The sweep's reads of the repository and of the host, and its tracker (local-ci-sweep-record.js). `repoGit` has the shape
    // pr-review-repo.js injects, `(args, {cwd})`, and no GIT_* variable of this process reaches it. Required lazily, so no other
    // subcommand loads any of it. The tracker is built per call: it needs the checkout and config the trust checks resolve.
    repoGit: (args, options) => require('./review-record-runtime').defaultGit()(args, options),
    readPr: (request) => require('./review-record-runtime').makeReadPr()(request),
    trackerFor: (options) => require('./tracker-findings').createToolchainDeps(options),
    env: process.env,
  };
}

/**
 * The approval set and trusted command list come ONLY from the config committed at the
 * PR's base ref: `git show <baseSha>:.ensemble/local-ci.yaml`. Never the working tree
 * (which may be the PR head's own file), never the clone, never a payload.
 * Returns the validateConfig result plus { configBlobSha, baseSha } when the ref resolves.
 */
function loadTrustedConfig(deps, repoRoot, baseRef) {
  const refuse = (problem) => ({ ok: false, problems: [problem] });
  if (!isBaseRef(baseRef)) {
    return refuse(
      `baseRef ${shown(baseRef)} is not a remote-tracking ref: pass the PR's base branch as origin/<branch> (or refs/remotes/<remote>/<branch>), fetched fresh; local branches, SHAs, HEAD and revision syntax are refused`
    );
  }
  const cwd = path.resolve(repoRoot);
  // `show-ref --verify` takes an EXACT full ref name (no DWIM, no @{n}, no ^), and refs/remotes/ is only populated by
  // fetches, so a local branch the head's author pushed or force-moved cannot satisfy it. Resolve that exact name.
  const full = fullRemoteRef(baseRef);
  const exists = deps.git(['show-ref', '--verify', '--quiet', full], cwd);
  if (!exists || exists.status !== 0) return refuse(`baseRef ${shown(baseRef)} is not a remote-tracking ref present in ${cwd} (fetch it first)`);
  const resolved = deps.git(['rev-parse', '--verify', '--end-of-options', `${full}^{commit}`], cwd);
  const baseSha = resolved && resolved.status === 0 ? String(resolved.stdout).trim() : '';
  if (!SHA_RE.test(baseSha)) return refuse(`baseRef ${shown(baseRef)} does not resolve to a commit in ${cwd}`);

  const blob = deps.git(['rev-parse', '--verify', '--end-of-options', `${baseSha}:${DEFAULT_CONFIG_PATH}`], cwd);
  const configBlobSha = blob && blob.status === 0 ? String(blob.stdout).trim() : '';
  const showCfg = deps.git(['show', `${baseSha}:${DEFAULT_CONFIG_PATH}`], cwd);
  const source = configBlobSha && showCfg && showCfg.status === 0 ? String(showCfg.stdout) : undefined;
  const cfg = validateConfig(source); // reports a missing config: no defaults
  return { ...cfg, baseSha, ...(source === undefined ? {} : { configBlobSha }) };
}

/**
 * Ask GitHub which branch this PR really targets and which commit its head really is, and refuse unless the caller's
 * `baseRef` and `headSha` say the same. Without this the gate would trust whichever remote-tracking branch the caller
 * names: a contributor who can push ANY branch could name their own as the base and have its committed config grade the
 * PR. The answer comes from GitHub, never from the payload, the clone or a config. Fails closed: a lookup that errors,
 * returns something unexpected, or names a different branch or commit is a refusal, not a pass.
 * Returns a problem text, or null when baseRef is exactly origin/<baseRefName> and headSha is the PR's current head.
 */
function verifyPullRequest(deps, { repo, pr, baseRef, headSha }) {
  if (typeof deps.prInfo !== 'function') return 'cannot verify the pull request: no GitHub lookup is available';
  const got = deps.prInfo({ repo, pr });
  if (!got || got.ok !== true || !isObject(got.info)) return `cannot verify pull request #${pr} of ${repo}: ${(got && got.error) || 'no answer'}`;
  const { baseRefName, headRefOid, state } = got.info;
  if (typeof baseRefName !== 'string' || !/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(baseRefName)) {
    return `pull request #${pr} reports a base branch this gate cannot use (${shown(baseRefName)})`;
  }
  if (typeof headRefOid !== 'string' || !SHA_RE.test(headRefOid)) return `pull request #${pr} reports no usable head commit`;
  if (state !== 'OPEN') return `pull request #${pr} is ${shown(state)}, not OPEN`;
  const wantRef = `refs/remotes/origin/${baseRefName}`;
  if (fullRemoteRef(baseRef) !== wantRef) {
    return `baseRef ${shown(baseRef)} is not the base branch of pull request #${pr}: GitHub says it targets ${shown(baseRefName)} (expected origin/${baseRefName})`;
  }
  if (headRefOid.toLowerCase() !== headSha.toLowerCase()) {
    return `headSha ${headSha} is not the current head of pull request #${pr} (GitHub reports ${headRefOid}); refusing to grade or merge a different commit`;
  }
  return null;
}

/**
 * The base must be an ANCESTOR of the head, or a commit the head diverged from that is NOT a descendant of it.
 * A legitimate base is the PR's base branch, which may have advanced since the PR forked, so "not an ancestor"
 * alone is not a refusal; but a base that CONTAINS the head (the head is an ancestor of the base) is a descendant
 * the head's author can push, and trusting it lets them choose the graded command list. Returns a problem text or null.
 * The graph can only reject those shapes; that the base is the real PR base is established by baseRef being a
 * remote-tracking ref (see isBaseRef), never by anything here.
 */
function checkBaseHead(deps, repoRoot, baseSha, headSha, baseRef) {
  const cwd = path.resolve(repoRoot);
  if (baseSha.toLowerCase() === headSha.toLowerCase()) {
    return `baseRef ${shown(baseRef)} resolves to ${baseSha}, which is the PR head ${headSha}: the head cannot be its own base`;
  }
  const headIsAncestor = deps.git(['merge-base', '--is-ancestor', headSha, baseSha], cwd);
  if (headIsAncestor && headIsAncestor.status === 0) {
    return `baseRef ${shown(baseRef)} (${baseSha}) is a descendant of the PR head ${headSha}: the head's author controls descendants of the head, so it cannot be the trusted base`;
  }
  const anc = deps.git(['merge-base', '--is-ancestor', baseSha, headSha], cwd);
  if (anc && anc.status === 0) return null;
  const mb = deps.git(['merge-base', baseSha, headSha], cwd);
  if (mb && mb.status === 0 && SHA_RE.test(String(mb.stdout).trim())) return null;
  return `PR head ${headSha} shares no history with base ${baseSha} (${shown(baseRef)}): no merge-base, refusing`;
}

/** Load the base-ref config and, given a head, enforce the base/head relationship. */
function loadGateConfig(deps, repoRoot, baseRef, headSha) {
  const cfg = loadTrustedConfig(deps, repoRoot, baseRef);
  if (!cfg.ok) return cfg;
  const problem = checkBaseHead(deps, repoRoot, cfg.baseSha, headSha, baseRef);
  return problem ? { ok: false, problems: [problem] } : cfg;
}

/** Fail closed on any payload key a caller could use to smuggle options. `because` says why the allowed keys are all there is. */
function rejectUnknownKeys(payload, allowed, what, because = `Configuration comes only from the maintainer's ${DEFAULT_CONFIG_PATH}`) {
  const unknown = Object.keys(payload).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) {
    throw new Error(`${what}: unknown payload key(s) ${unknown.map(shown).join(', ')}; allowed: ${allowed.join(', ')}. ${because}`);
  }
}

/* ------------------------------------------------------------ simple handlers */

function runConfig(payload, deps) {
  if (!isObject(payload)) throw new Error('payload must be a JSON object');
  rejectUnknownKeys(payload, CONFIG_KEYS, 'config');
  // `source` only validates text the caller hands over; it never feeds a gate or a merge.
  if (payload.source !== undefined) return validateConfig(payload.source);
  return loadTrustedConfig(deps, need(payload, 'repoRoot', isText, 'config'), need(payload, 'baseRef', isBaseRef, 'config'));
}

const RECORD_ACTIONS = Object.freeze({
  build: (input) => buildRecord(input),
  parse: (input) => parseRecord(input),
  verify: (input) => verifyRecord(input),
});

function runRecord(payload) {
  const action = need(payload, 'action', isText, 'record');
  if (!hasOwn(RECORD_ACTIONS, action)) throw new Error(`record: unknown action ${shown(action)}`);
  return RECORD_ACTIONS[action](payload.input);
}

/** Runner options built ONLY from the maintainer's validated config. */
function runnerOptions(repoRoot, headSha, cfg) {
  return {
    repoRoot,
    headSha,
    approvalSet: cfg.approvalSet,
    equivalents: cfg.approvalSet.equivalents,
    excludedSteps: cfg.approvalSet.excludedSteps,
    // Names from the BASE-ref config only; values come from the environment or the fixed gitignored secrets file.
    secretNames: cfg.approvalSet.secretNames,
    // A failing step's FULL output is kept here (redacted, capped, owner-only); the report keeps only a short tail. The
    // directory is under .ensemble/local-ci-runs/, which is gitignored, and the stale-clone sweep skips it (not a SHA name).
    failureLogDir: path.join(repoRoot, '.ensemble', 'local-ci-runs', 'logs'),
  };
}

/**
 * Run `work`, which starts the runner, while holding the gate lock. `gate` and `run` both go through here, so neither
 * starts CI without it. The lock covers `work` and nothing else and is released whether `work` returns or throws.
 * `cfg` sizes a waiting caller's patience: the runner's worst-case hold for this config. Resolves `{value, queuedMs}`
 * once `work` ran, or `{refusal: {error, fields}}` when the lock could not be had or is not available: `work` did not run.
 */
async function underGateLock(deps, cfg, options, work) {
  if (typeof deps.acquireGateLock !== 'function') {
    return { refusal: { error: 'gate lock is not available; refusing to run an unserialized gate', fields: {} } };
  }
  const lock = await deps.acquireGateLock({ worstCaseHoldMs: runnerWorstCaseMs(cfg.approvalSet, options) });
  if (!lock.acquired) {
    return {
      refusal: {
        error: `${lock.code}: ${lock.error}`,
        fields: { errorCode: lock.code, queued_ms: lock.queuedMs, ...(lock.holder ? { lockHolder: lock.holder } : {}) },
      },
    };
  }
  try {
    return { value: work(), queuedMs: lock.queuedMs };
  } finally {
    lock.release();
  }
}

async function runRun(payload, deps) {
  if (!isObject(payload)) throw new Error('payload must be a JSON object');
  rejectUnknownKeys(payload, RUN_KEYS, 'run');
  const repoRoot = path.resolve(need(payload, 'repoRoot', isText, 'run'));
  const headSha = need(payload, 'headSha', (v) => typeof v === 'string' && SHA_RE.test(v), 'run');
  const baseRef = need(payload, 'baseRef', isBaseRef, 'run');
  const cfg = loadGateConfig(deps, repoRoot, baseRef, headSha);
  if (!cfg.ok) return { ok: false, error: `local CI config invalid: ${cfg.problems.join('; ')}` };
  // `run` clones and runs the same CI as `gate`, so it queues behind the same lock and is refused the same way.
  const options = runnerOptions(repoRoot, headSha, cfg);
  const held = await underGateLock(deps, cfg, options, () => deps.runGate(options, deps.runnerDeps));
  if (held.refusal) return { ok: false, stage: 'lock', error: held.refusal.error, ...held.refusal.fields };
  return isObject(held.value) ? { ...held.value, queued_ms: held.queuedMs } : held.value;
}

async function runPost(payload, deps) {
  const input = need(payload, 'input', isObject, 'post');
  return deps.postStatus(input);
}

const REVIEW_ACTIONS = Object.freeze({
  classify: (reviews) => classifyReviews(reviews),
  decide: (reviews) => decideBlock(reviews),
});

function runReview(payload) {
  const action = need(payload, 'action', isText, 'review');
  if (!hasOwn(REVIEW_ACTIONS, action)) throw new Error(`review: unknown action ${shown(action)}`);
  return REVIEW_ACTIONS[action](payload.reviews);
}

/**
 * `sweep`: record each finding and CI failure the tracker does not hold yet as a bead (local-ci-sweep-record.js). The facts
 * are already fetched by the caller; the dedupe set is built from the tracker, so no `trackedKeys` is accepted. Never
 * ordered against the merge here: the caller runs it before and after, and a result never authorizes or blocks a merge.
 */
function runSweep(payload, deps) {
  if (!isObject(payload)) throw new Error('payload must be a JSON object');
  rejectUnknownKeys(payload, SWEEP_KEYS, 'sweep', 'The keys the tracker already holds come only from the tracker, and which tracker only from .ensemble/toolchain.yaml at baseSha');
  const isSha = (v) => typeof v === 'string' && SHA_RE.test(v);
  const facts = need(payload, 'facts', isObject, 'sweep');
  const repoRoot = need(payload, 'repoRoot', isText, 'sweep');
  const repo = need(payload, 'repo', isRepo, 'sweep');
  const pr = need(payload, 'pr', isPrNumber, 'sweep');
  const headSha = need(payload, 'headSha', isSha, 'sweep');
  const baseSha = need(payload, 'baseSha', isSha, 'sweep');
  if (payload.dryRun !== undefined && typeof payload.dryRun !== 'boolean') throw new Error('sweep: dryRun must be true or false when given');
  return require('./local-ci-sweep-record').sweep(
    { facts, repoRoot, repo, pr, headSha, baseSha, dryRun: payload.dryRun === true },
    { git: deps.repoGit, readPr: deps.readPr, trackerFor: deps.trackerFor, env: deps.env }
  );
}

const TIMING_ACTIONS = Object.freeze({
  ready: (input) => timing.checkEnablementReady(input),
  verdict: (input) => timing.verdict(input.localMs, input.hostedMs, input.toleranceMs),
  record: (input) => timing.recordTimings(input),
  fidelity: (input) => timing.fidelityGaps(input.local, input.hosted),
  note: (input) => timing.renderNote(input),
});

function runTiming(payload) {
  const action = need(payload, 'action', isText, 'timing');
  if (!hasOwn(TIMING_ACTIONS, action)) throw new Error(`timing: unknown action ${shown(action)}`);
  const input = need(payload, 'input', isObject, 'timing');
  const result = TIMING_ACTIONS[action](input);
  return action === 'note' ? { ok: typeof result === 'string', note: result } : result;
}

/* ------------------------------------------------------------ rollout / rollback */

const ROLLOUT_ACTIONS = Object.freeze({
  snapshot: (input) => rollout.snapshotProtection(input.response, { repo: input.repo, branch: input.branch, now: input.now }),
  'plan-enable': (input) => rollout.planEnable(input),
  'plan-rollback': (input) => rollout.planRollback(input),
  preconditions: (input) => rollout.checkEnablementPreconditions(input),
});

/** Plans are DATA: this subcommand never calls GitHub and never changes protection. */
function runRollout(payload) {
  const action = need(payload, 'action', isText, 'rollout');
  if (!hasOwn(ROLLOUT_ACTIONS, action)) throw new Error(`rollout: unknown action ${shown(action)}`);
  const input = need(payload, 'input', isObject, 'rollout');
  return ROLLOUT_ACTIONS[action](input);
}

/* -------------------------------------------------------------- merge readiness */

/**
 * Can this PR merge on the strength of the local gate alone?
 * payload: { headSha, statuses:[{context,state,description,sha}], repoRoot, reviews? }
 * `sha` is the commit each status was posted on. Ready only when a SUCCESS status
 * in the configured context verifies (verifyRecord) against the exact head and
 * the configured workflow set AND the trusted config blob at `baseRef`. Hosted CI is
 * never consulted. The configuration is read ONLY from the base ref's committed
 * .ensemble/local-ci.yaml; any other payload key (config, path, ...) is rejected.
 */
function runMerge(payload, deps) {
  if (!isObject(payload)) throw new Error('payload must be a JSON object');
  rejectUnknownKeys(payload, MERGE_KEYS, 'merge');
  const headSha = need(payload, 'headSha', (v) => typeof v === 'string' && SHA_RE.test(v), 'merge');
  const statuses = need(payload, 'statuses', Array.isArray, 'merge');
  const repoRoot = need(payload, 'repoRoot', isText, 'merge');
  const refuse = (reason, extra) => ({ ok: false, mergeReady: false, headSha, reason, ...(extra || {}) });

  const baseRef = need(payload, 'baseRef', isBaseRef, 'merge');
  const repo = need(payload, 'repo', isRepo, 'merge');
  const pr = need(payload, 'pr', isPrNumber, 'merge');
  const prProblem = verifyPullRequest(deps, { repo, pr, baseRef, headSha });
  if (prProblem) return refuse(prProblem);
  const cfg = loadGateConfig(deps, repoRoot, baseRef, headSha);
  if (!cfg.ok) return refuse(`local CI config invalid: ${cfg.problems.join('; ')}`);
  const workflowSet = cfg.approvalSet.workflows.map((w) => w.file);

  if (payload.reviews !== undefined) {
    const block = decideBlock(payload.reviews);
    if (block.blocked) return refuse(`blocked by review: ${block.reasons.join('; ')}`, { reviewers: block.reviewers });
  }

  // GitHub status contexts are case-insensitive: compare lower-cased (we post the exact configured string).
  const wantContext = cfg.approvalSet.statusContext.toLowerCase();
  const ours = statuses.filter((s) => isObject(s) && typeof s.context === 'string' && s.context.toLowerCase() === wantContext);
  if (ours.length === 0) {
    return refuse(`no local CI status (${cfg.approvalSet.statusContext}) found: the local gate has not run for ${headSha}`, { missingRun: true });
  }

  const problems = [];
  for (const s of ours) {
    if (s.state !== 'success') {
      problems.push(`status on ${s.sha} is ${s.state}`);
      continue;
    }
    const v = verifyRecord({ description: s.description, statusCommitSha: s.sha, headSha, workflowSet, runnerBlobSha: cfg.configBlobSha });
    if (v.ok) return { ok: true, mergeReady: true, headSha, context: cfg.approvalSet.statusContext, record: v.fields, hostedCiWaitRequired: false };
    problems.push(v.headMismatch || v.setMismatch || v.runnerMismatch || v.error || 'record did not verify');
  }
  const moved = ours.find((s) => s.state === 'success' && isText(s.sha) && s.sha.toLowerCase() !== headSha.toLowerCase());
  return refuse(problems.join('; '), {
    missingRun: !ours.some((s) => s.state === 'success'),
    ...(moved ? { statusSha: moved.sha, headMoved: true } : {}),
  });
}

/* ------------------------------------------------------------------------ gate */

function preflight(repoRoot, deps) {
  const missing = (prerequisite, detail) => ({
    ok: false,
    prerequisite,
    error: `prerequisite missing: ${prerequisite}${detail ? ` (${detail})` : ''}`,
  });
  const node = deps.node();
  if (!node || node.status !== 0 || !/^v\d+\./.test(String(node.stdout).trim())) return missing('node');
  const git = deps.git(['--version'], repoRoot);
  if (!git || git.status !== 0) return missing('git');
  return { ok: true };
}

/** Failures the report must name: workflow, job, step, head SHA. */
function describeFailures(result, equivalents) {
  const sha = result.sha;
  const out = [];
  for (const u of result.unmirrored || []) {
    out.push({ kind: 'unsupported-step', workflow: u.workflow, job: u.job, step: u.step, sha, message: u.reason });
  }
  for (const f of result.failures || []) {
    if (f.kind === 'unmirrored-step') continue; // already listed from result.unmirrored
    const eq = (equivalents || []).find((e) => e.runs === f.step);
    out.push({
      kind: f.kind,
      workflow: eq ? `covers workflow step "${eq.workflowStep}"` : STEPS_LABEL,
      job: f.node === null || f.node === undefined ? null : `node ${f.node}`,
      step: f.step,
      sha,
      message: f.message,
    });
  }
  return out;
}

const REPORTABLE_KINDS = new Set(['unsupported-step', 'step-failed']);

function clip(text) {
  return text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION - 1)}\u2026` : text;
}

async function runGateFlow(payload, deps) {
  if (!isObject(payload)) throw new Error('payload must be a JSON object');
  rejectUnknownKeys(payload, GATE_KEYS, 'gate');
  const repoRoot = path.resolve(need(payload, 'repoRoot', isText, 'gate'));
  const headSha = need(payload, 'headSha', (v) => typeof v === 'string' && SHA_RE.test(v), 'gate');
  const baseRef = need(payload, 'baseRef', isBaseRef, 'gate');
  const dryRun = payload.dryRun === true;
  const report = { ok: false, stage: 'preflight', headSha, dryRun, posted: false, mergeReady: false, failures: [] };
  const stop = (stage, error, extra) => ({ ...report, stage, error, ...(extra || {}) });

  // 1. Prerequisites: nothing is run or posted without them, and merging is never the fallback.
  const pre = preflight(repoRoot, deps);
  if (!pre.ok) return stop('preflight', pre.error, { prerequisite: pre.prerequisite });

  // 2. Which PR is this? GitHub, not the payload, says which branch it targets and which commit is its head; only then
  // is the config read, and only from that branch. (Applies to dry runs too: a dry run that reports mergeReady against
  // a base the author chose would be the same hole.)
  const repo = need(payload, 'repo', isRepo, 'gate');
  const pr = need(payload, 'pr', isPrNumber, 'gate');
  const prProblem = verifyPullRequest(deps, { repo, pr, baseRef, headSha });
  if (prProblem) return stop('config', prProblem);
  const cfg = loadGateConfig(deps, repoRoot, baseRef, headSha);
  if (!cfg.ok) return stop('config', `local CI config invalid: ${cfg.problems.join('; ')}`);

  // 3. Run in a clean clone at the exact head (the runner owns checkout and cleanup), one run per user home at a time:
  // wait for the lock (recording how long), run, and always release it, whether the run returns or throws. Nothing
  // else holds the lock: posting the status below happens after release. Config and PR checks above stay outside it so
  // an invalid request never queues behind a long run.
  const options = runnerOptions(repoRoot, headSha, cfg);
  const held = await underGateLock(deps, cfg, options, () => deps.runGate(options, deps.runnerDeps));
  if (held.refusal) return stop('lock', held.refusal.error, held.refusal.fields);
  report.queued_ms = held.queuedMs;
  const result = held.value;
  report.stage = 'run';
  report.nodes = (result.nodes || []).map((n) => ({ node: n.node, ok: n.ok }));

  const passed =
    result.ok === true &&
    (result.failures || []).length === 0 &&
    (result.unmirrored || []).length === 0 &&
    Array.isArray(result.nodes) &&
    result.nodes.length > 0 &&
    result.nodes.every((n) => n.ok === true);

  const post = (state, description) =>
    deps.postStatus({ repo: payload.repo, sha: headSha, state, context: cfg.approvalSet.statusContext, description });

  // 4. Anything but a clean pass is a refusal; at most a FAILURE status is published.
  if (!passed) {
    report.failures = describeFailures(result, cfg.approvalSet.equivalents);
    report.error = result.error || 'local CI did not pass';
    const reportable = report.failures.filter((f) => REPORTABLE_KINDS.has(f.kind));
    if (!dryRun && reportable.length > 0) {
      const f = reportable[0];
      const published = await post('failure', clip(`ci-local failed: ${f.workflow} / ${f.job} / ${f.step} @ ${headSha.slice(0, 8)}`));
      report.posted = published.published === true;
      report.post = published;
    }
    return report;
  }

  // 5. Success is only ever claimed by actually posting it with the maintainer's gh login.
  report.stage = 'attest';
  if (dryRun) return { ...report, ok: true, mergeReady: true, wouldPost: true };

  const record = buildRecord({
    runnerBlobSha: cfg.configBlobSha,
    workflowSet: cfg.approvalSet.workflows.map((w) => w.file),
    log: JSON.stringify({ sha: headSha, nodes: result.nodes }),
  });
  if (!record.ok) return stop('attest', `cannot build record: ${record.error}`);

  const published = await post('success', record.description);
  report.post = published;
  report.posted = published.published === true;
  report.record = record.fields;
  report.ok = report.posted;
  report.mergeReady = report.posted;
  if (!report.posted) {
    report.cannotAttest = true;
    report.error = `${CANNOT_ATTEST}: could not publish with gh: ${published.reason || 'status was not published'}; merge refused`;
  }
  return report;
}

/* -------------------------------------------------------------------- dispatch */

const HANDLERS = Object.freeze({
  config: runConfig,
  record: runRecord,
  run: runRun,
  post: runPost,
  review: runReview,
  sweep: runSweep,
  timing: runTiming,
  rollout: runRollout,
  merge: runMerge,
  gate: runGateFlow,
});

/**
 * Entry point: argv WITHOUT node + script. Resolves to the exit code
 * (0 success, 1 failure or an `ok:false` result). `io.readJson` and
 * `io.write` default to real stdin/stdout.
 */
async function main(argv, injected) {
  const deps = { ...defaultDeps(), ...(injected || {}) };
  const io = { readJson: readStdinJson, write: (s) => process.stdout.write(s), ...((injected && injected.io) || {}) };
  const emit = (value) => io.write(`${JSON.stringify(redact(value))}\n`);

  const subcommand = Array.isArray(argv) ? argv[0] : undefined;
  const handler = typeof subcommand === 'string' && hasOwn(HANDLERS, subcommand) ? HANDLERS[subcommand] : undefined;
  if (handler === undefined) {
    emit({ error: `Unknown subcommand ${shown(subcommand)}. Usage: local-ci-cli <${Object.keys(HANDLERS).join('|')}> < payload.json` });
    return 1;
  }

  let payload;
  try {
    payload = io.readJson();
  } catch (err) {
    emit({ error: `invalid JSON on stdin: ${err.message}` });
    return 1;
  }

  try {
    const result = await handler(payload, deps);
    if (typeof JSON.stringify(result) !== 'string') throw new Error('Result was not JSON-serializable');
    emit(result);
    return isObject(result) && result.ok === false ? 1 : 0;
  } catch (err) {
    emit({ error: err && err.message ? err.message : String(err) });
    return 1;
  }
}

module.exports = {
  main,
  runConfig,
  runRecord,
  runRun,
  runPost,
  runReview,
  runSweep,
  runTiming,
  runRollout,
  runMerge,
  runGateFlow,
  HANDLERS,
  MAX_STDIN_BYTES,
  defaultDeps,
  SWEEP_KEYS,
};

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
