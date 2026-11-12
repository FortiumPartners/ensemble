#!/usr/bin/env node
'use strict';

/**
 * Local CI gate CLI (TRD-005). Thin JSON-in/JSON-out dispatcher over the
 * local-ci-* modules: one JSON payload on stdin per subcommand, one JSON
 * object on stdout. The only logic here is ORDERING (`gate`: prerequisites -> config -> hosted CI if accepted, else lock ->
 * run -> record -> post) and the merge-readiness decision (`merge`), both of which only combine verdicts the modules
 * already produce. `gate` and `run` are the two subcommands that run CI: each takes the lock (local-ci-lock.js), so they
 * run one at a time per home directory, and each reports its wait as `queued_ms`. Accepting hosted results runs nothing.
 *
 *   config   {source|repoRoot, baseRef}            validateConfig (source: text check only)
 *   record   {action: build|parse|verify, input}   buildRecord / parseRecord / verifyRecord
 *   run      {repoRoot, headSha, baseRef}          runGate (never publishes; takes the same lock as `gate`)
 *   post     {input:{repo,sha,state,context,description}}  postStatus (maintainer's own gh login)
 *   review   {action: classify|decide, reviews}    classifyReviews / decideBlock
 *   sweep    {facts, repoRoot, repo, pr, headSha, baseSha, dryRun?}  record each untracked finding/CI failure as a bead
 *   timing   {action: ready|verdict|record|fidelity|note, input}
 *   merge    {headSha, statuses, repoRoot, baseRef, repo, pr, reviews?}  merge readiness: a verified local status, else hosted CI
 *   gate     {repoRoot, headSha, baseRef, repo, pr, dryRun?, forceLocal?}  hosted CI if accepted, else the full local run
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
 * TRUST (hosted reuse, opt-in via the base config's `hosted_reuse`): `merge` and `gate` may instead accept the hosted
 * jobs GitHub Actions ran on the exact head, which this CLI reads from GitHub itself (local-ci-hosted.js documents what
 * is and is not verified); the payload never carries hosted results.
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
const { verifyHosted } = require('./local-ci-hosted');

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
const GATE_KEYS = ['repoRoot', 'headSha', 'baseRef', 'repo', 'pr', 'dryRun', 'forceLocal'];
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
    // GET only, argv elements (no shell); `path` is built from validated repo, hex SHA and integer run id.
    ghApi: (apiPath) => {
      const r = tool('gh', ['api', apiPath]);
      if (r.status !== 0) return { ok: false, error: `gh api failed: ${String(r.stderr).trim().slice(0, 200) || `exit ${r.status}`}` };
      try {
        return { ok: true, json: JSON.parse(r.stdout) };
      } catch (_e) {
        return { ok: false, error: 'gh api returned output that is not JSON' };
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
    return { value: await work(), queuedMs: lock.queuedMs };
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
 * Can this PR merge on the strength of the local gate, or of hosted CI that verifies on the exact head?
 * payload: { headSha, statuses:[{context,state,description,sha}], repoRoot, baseRef, repo, pr, reviews? }
 * `sha` is the commit each status was posted on. Ready when a SUCCESS status in the configured context verifies
 * (verifyRecord) against the exact head and the configured workflow set AND the trusted config blob at `baseRef`; only
 * when none does, and the base config opted in (`hosted_reuse`), the hosted jobs GitHub Actions ran on the exact head
 * are read from GitHub (verifyHosted: the payload never carries them) and may stand in. The configuration is read ONLY
 * from the base ref's committed .ensemble/local-ci.yaml; any other payload key (config, path, ...) is rejected.
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

  // A verified local status wins (no network). Otherwise `localRefusal` says why not and hosted CI gets its turn.
  let localRefusal;
  if (ours.length === 0) {
    localRefusal = refuse(`no local CI status (${cfg.approvalSet.statusContext}) found: the local gate has not run for ${headSha}`, { missingRun: true });
  } else {
    const problems = [];
    for (const s of ours) {
      if (s.state !== 'success') {
        problems.push(`status on ${s.sha} is ${s.state}`);
        continue;
      }
      const v = verifyRecord({ description: s.description, statusCommitSha: s.sha, headSha, workflowSet, runnerBlobSha: cfg.configBlobSha });
      if (v.ok) {
        // A verified success in the payload is not enough: GitHub's newest status in this context decides. A newer failure,
        // pending or unverifiable success beats it (round 4, S1). GitHub listing nothing in the context leaves the payload
        // trusted, as before; a list that cannot be read refuses.
        const verdict = localRunVerdict(deps, { repo, headSha, cfg });
        if (verdict.kind === 'veto') return refuse(`${verdict.reason}; re-run the gate with forceLocal:true`, { localFailure: verdict.recorded });
        // The same payload rule the hosted route applies (G): the first verified success must not hide a later adverse entry.
        const adverse = payloadVeto(ours, { headSha, context: cfg.approvalSet.statusContext, verdict });
        if (adverse) return refuse(`${adverse}; re-run the gate with forceLocal:true`, { localFailure: true });
        return { ok: true, mergeReady: true, headSha, context: cfg.approvalSet.statusContext, record: v.fields, hostedCiWaitRequired: false };
      }
      problems.push(v.headMismatch || v.setMismatch || v.runnerMismatch || v.error || 'record did not verify');
    }
    const moved = ours.find((s) => s.state === 'success' && isText(s.sha) && s.sha.toLowerCase() !== headSha.toLowerCase());
    localRefusal = refuse(problems.join('; '), {
      missingRun: !ours.some((s) => s.state === 'success'),
      ...(moved ? { statusSha: moved.sha, headMoved: true } : {}),
    });
  }

  const hosted = verifyHosted({ repo, headSha, baseSha: cfg.baseSha, repoRoot, approvalSet: cfg.approvalSet, pr, baseRefName: baseBranchOf(baseRef) }, deps);
  if (hosted.ok) {
    // Negative local evidence outranks green hosted jobs: what the gate recorded on THIS head is never overridden.
    const vetoed = (reason, recorded) => ({
      ...localRefusal,
      reason: `${localRefusal.reason}; hosted CI is green on this head but is not accepted: ${reason}; re-run the gate with forceLocal:true`,
      hostedRefused: true,
      ...(recorded ? { localFailure: true } : {}),
    });
    // ONE statuses read per merge. The veto is read from GitHub (the same rule `gate` uses), never decided from the payload.
    const verdict = localRunVerdict(deps, { repo, headSha, cfg });
    if (verdict.kind === 'veto') return vetoed(verdict.reason, verdict.recorded);
    const adverse = payloadVeto(ours, { headSha, context: cfg.approvalSet.statusContext, verdict });
    if (adverse) return vetoed(adverse, true);
    // The head may have moved while GitHub was being asked: re-read the pull request and refuse if it did.
    const reread = verifyPullRequest(deps, { repo, pr, baseRef, headSha });
    if (reread) return refuse(`hosted CI verified, but ${reread} (re-read after the hosted lookups)`, { hostedRefused: true });
    return { ok: true, mergeReady: true, headSha, source: 'hosted', hostedJobs: hosted.jobs, hostedCiWaitRequired: false };
  }
  return hosted.disabled ? localRefusal : { ...localRefusal, reason: `${localRefusal.reason}; ${hosted.reason}`, hostedRefused: true };
}

/**
 * (G) The caller's own payload is evidence too, for BOTH routes of `merge`. A status in our context that is not a success
 * (failure, error, pending, any other or non-text state) is adverse. With no usable commit SHA it cannot be attributed to
 * another commit, so it counts against this head whatever GitHub says. On this head with GitHub silent (`verdict.kind` is
 * `none`) it also vetoes: fail closed relative to the caller's evidence. A verified success on GitHub is NEWER than anything
 * the caller can have sent, and a status on ANOTHER full commit never vetoes. `ours` is the payload's entries in the
 * configured context. Returns the reason (no advice text: the caller adds it) or null.
 */
function payloadVeto(ours, { headSha, context, verdict }) {
  for (const s of ours) {
    if (s.state === 'success') continue;
    const named = typeof s.state === 'string' && s.state !== '' ? s.state : 'unusable-state';
    if (!(typeof s.sha === 'string' && SHA_RE.test(s.sha))) {
      return `a ${named} status in ${context} carries no usable commit SHA, so it cannot be attributed to another commit`;
    }
    if (s.sha.toLowerCase() === headSha.toLowerCase() && verdict.kind === 'none') {
      return `the caller's own ${named} status in ${context} is on this head and GitHub lists none to supersede it`;
    }
  }
  return null;
}

/** The PR's base branch name, from a baseRef that verifyPullRequest already proved is exactly `origin/<that branch>`. */
const baseBranchOf = (baseRef) => fullRemoteRef(baseRef).slice('refs/remotes/origin/'.length);

/**
 * What does GitHub say the LOCAL gate did on this exact head? ONE function for `merge` (both routes) and `gate`, read from
 * GitHub (never from a payload): GitHub lists a commit's statuses NEWEST FIRST, so the first entry in the configured
 * context (compared case-insensitively) is the latest and decides. FAIL CLOSED: anything this cannot read, shape-check or
 * order is a veto, and the only thing that clears an older pending or failure is a LATER success whose record verifies
 * (verifyRecord, bound to the head, the workflow set and the trusted config blob). A bare or unverifiable success never
 * clears: anyone with write access can post one, and the gate's own success carries a record.
 *
 * Returns `{kind:'none'}` (a readable, shorter-than-a-page list with nothing in the context: nothing local ever ran),
 * `{kind:'verified', status}` (the latest is a success that verifies) or `{kind:'veto', reason, recorded}`; `recorded` is
 * true when something other than a verified success is on record in the context, false for a list that could not be
 * read or trusted. Reasons carry no advice text: `merge` adds it.
 */
function localRunVerdict(deps, { repo, headSha, cfg }) {
  const context = cfg.approvalSet.statusContext;
  const veto = (reason, recorded) => ({ kind: 'veto', reason, recorded });
  const unread = (why) => veto(`cannot read the commit statuses of ${headSha}: ${why}`, false);
  // 1. No lookup, a failed or missing answer, or something that is not a list.
  if (typeof deps.ghApi !== 'function') return unread('no GitHub lookup is available');
  let got;
  try {
    got = deps.ghApi(`repos/${repo}/commits/${headSha}/statuses?per_page=${STATUS_PAGE}`);
  } catch (err) {
    return unread(err && err.message ? err.message : String(err));
  }
  if (!got || got.ok !== true) return unread((got && got.error) || 'no answer');
  if (!Array.isArray(got.json)) return unread('the answer is not a list');
  const list = got.json;
  // 2. Every entry must have the shape GitHub documents.
  if (list.some((s) => !isObject(s) || typeof s.context !== 'string')) {
    return veto(`the commit statuses of ${headSha} are not in the shape GitHub documents (an entry has no text context); refusing rather than guessing`, false);
  }
  // 3. Contexts are case-insensitive. The first entry in ours is the latest, but only if the list really is newest first.
  const want = context.toLowerCase();
  const mine = list.filter((s) => s.context.toLowerCase() === want);
  // 4. Nothing in our context: a FULL page may hide it on a later page, a shorter one means nothing local ever ran.
  if (mine.length === 0) {
    return list.length >= STATUS_PAGE
      ? veto(`the first ${STATUS_PAGE} commit statuses of ${headSha} hold none in ${context}, and more may follow; refusing rather than guessing`, false)
      : { kind: 'none' };
  }
  const latest = mine[0];
  if (mine.every((s) => Number.isInteger(s.id)) && mine.some((s) => s.id > latest.id)) {
    return veto(`the commit statuses of ${headSha} are not listed newest first (an older ${context} entry has a larger id), so the latest cannot be told`, false);
  }
  // 5. A success clears only if its record verifies.
  if (latest.state === 'success') {
    const v = verifyRecord({
      description: latest.description,
      statusCommitSha: headSha,
      headSha,
      workflowSet: cfg.approvalSet.workflows.map((w) => w.file),
      runnerBlobSha: cfg.configBlobSha,
    });
    if (v.ok) return { kind: 'verified', status: latest };
    const why = v.headMismatch || v.setMismatch || v.runnerMismatch || v.error || 'record did not verify';
    return veto(`the latest ${context} status on ${headSha} is a success whose record does not verify (${why}), so it cannot clear anything`, true);
  }
  // 6. A pending status is a local run that is still going, or died.
  if (latest.state === 'pending') {
    return veto(`a local gate run on this head did not finish (the latest ${context} status is pending: it is still running, or it died)`, true);
  }
  // 7. failure, error, any other or non-text state.
  const state = typeof latest.state === 'string' && latest.state !== '' ? latest.state : 'a status with no usable state';
  return veto(`the local gate recorded ${state} for ${context} on ${headSha}, and green hosted jobs do not override it (the local run decides)`, true);
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

// Refusals that say nothing about the head: the environment was not fit to evaluate it. Nothing is published for them and
// the write-ahead `pending` stays (availability, not safety: it vetoes hosted acceptance until a forced run passes).
// Every other kind (and any future one) is head-bound: the head WAS evaluated, or the evaluation was not trustworthy, so it
// is published as a failure status, which vetoes hosted acceptance (localRunVerdict).
const TRANSIENT_KINDS = new Set(['invalid-input', 'prerequisite', 'secrets', 'cleanup', 'unfetchable-head', 'node-version']);
const STATUS_PAGE = 100;

/** What a runner that THREW (or returned nothing) is turned into: a failing, head-bound result with no nodes. */
function runnerFailed(headSha, why) {
  const message = `local CI runner threw: ${why}`;
  return { ok: false, sha: headSha, error: message, failures: [{ kind: 'runner-error', step: null, node: null, sha: headSha, message }], unmirrored: [], nodes: [] };
}

/** The failure status text: today's wording for a failed or unsupported step, a "refused (<kind>)" wording for the rest. */
function failureDescription(f, headSha) {
  const sha8 = headSha.slice(0, 8);
  if (f.kind === 'step-failed' || f.kind === 'unsupported-step') return clip(`ci-local failed: ${f.workflow} / ${f.job} / ${f.step} @ ${sha8}`);
  const where = [f.job, f.step].filter((p) => p !== null && p !== undefined).join(' / ') || 'clean clone';
  return clip(`ci-local refused (${f.kind}): ${where} @ ${sha8}`);
}

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

  // 2b. Hosted CI already ran these jobs on this exact head: accept them instead of repeating the work. Only when the base
  // config opted in and everything verifies (see local-ci-hosted.js); anything else falls through to the local run below.
  // This reads GitHub and runs nothing, so it stays outside the lock: a PR hosted CI already passed never queues behind a run.
  if (payload.forceLocal !== undefined && typeof payload.forceLocal !== 'boolean') throw new Error('gate: forceLocal must be a boolean');
  if (payload.forceLocal !== true) {
    const hosted = verifyHosted({ repo, headSha, baseSha: cfg.baseSha, repoRoot, approvalSet: cfg.approvalSet, pr, baseRefName: baseBranchOf(baseRef) }, deps);
    if (hosted.ok) {
      // Green hosted jobs do not override what the local gate recorded on this head (a pending or failed run, or a success
      // that does not verify): the local run decides then.
      const verdict = localRunVerdict(deps, { repo, headSha, cfg });
      if (verdict.kind === 'veto') {
        report.hostedRefused = `hosted CI not accepted: ${verdict.reason}`;
      } else {
        // The head may have moved while GitHub was being asked: re-read the pull request, as the first check did.
        const reread = verifyPullRequest(deps, { repo, pr, baseRef, headSha });
        if (reread) return stop('config', `${reread} (re-read after the hosted lookups)`);
        return { ...report, stage: 'hosted', ok: true, mergeReady: true, source: 'hosted', hostedJobs: hosted.jobs, ranLocally: false };
      }
    } else if (!hosted.disabled) {
      report.hostedRefused = hosted.reason;
    }
  }

  // Every post of the gate goes through here: a `postStatus` that throws (or is missing) is a post that did not publish.
  const post = async (state, description) => {
    if (typeof deps.postStatus !== 'function') return { published: false, reason: 'no postStatus is available' };
    try {
      const answer = await deps.postStatus({ repo: payload.repo, sha: headSha, state, context: cfg.approvalSet.statusContext, description });
      return isObject(answer) ? answer : { published: false, reason: 'postStatus returned no result' };
    } catch (err) {
      return { published: false, reason: `postStatus threw: ${err && err.message ? err.message : String(err)}` };
    }
  };

  // 3. Run in a clean clone at the exact head (the runner owns checkout and cleanup), one run per user home at a time:
  // wait for the lock (recording how long), run, and always release it, whether the run returns or throws. Config and PR
  // checks above stay outside it so an invalid request never queues behind a long run.
  //
  // WRITE-AHEAD: once the lock is HELD and before the runner starts, a non-dry gate posts `pending` on the exact head. A
  // crash, a SIGKILL, a timeout, a failed final post or a transient failure therefore leaves the LATEST status pending,
  // which vetoes hosted acceptance (localRunVerdict). A gate that cannot record that it is starting does not start: a run
  // it cannot record is a run that could fail unseen. The pending post is inside the lock, so a refused lock posts nothing.
  const options = runnerOptions(repoRoot, headSha, cfg);
  const held = await underGateLock(deps, cfg, options, async () => {
    if (!dryRun) {
      report.pending = await post('pending', `ci-local running @ ${headSha.slice(0, 8)}`);
      if (report.pending.published !== true) return { notStarted: report.pending };
    }
    // A runner that THROWS must not leave the pending as the only record: it becomes a failing, head-bound result below.
    try {
      const ran = deps.runGate(options, deps.runnerDeps);
      return { result: isObject(ran) ? ran : runnerFailed(headSha, 'the runner returned no result') };
    } catch (err) {
      return { result: runnerFailed(headSha, err && err.message ? err.message : String(err)) };
    }
  });
  if (held.refusal) return stop('lock', held.refusal.error, held.refusal.fields);
  report.queued_ms = held.queuedMs;
  if (held.value.notStarted) {
    return stop('pending', `cannot record that a local run is starting: ${held.value.notStarted.reason || 'the pending status was not published'}; refusing to run a local gate it cannot record`);
  }
  const result = held.value.result;
  report.stage = 'run';
  report.nodes = (result.nodes || []).map((n) => ({ node: n.node, ok: n.ok }));

  const passed =
    result.ok === true &&
    (result.failures || []).length === 0 &&
    (result.unmirrored || []).length === 0 &&
    Array.isArray(result.nodes) &&
    result.nodes.length > 0 &&
    result.nodes.every((n) => n.ok === true);

  // 4. Anything but a clean pass is a refusal. A head-bound refusal publishes ONE failure (the first); a TRANSIENT-only
  // one (the head was never evaluated) publishes nothing and the pending stays: that is availability, not safety, and it
  // keeps vetoing hosted acceptance until a later `forceLocal:true` run passes and posts a verified success.
  if (!passed) {
    report.failures = describeFailures(result, cfg.approvalSet.equivalents);
    report.error = result.error || 'local CI did not pass';
    if (!dryRun) {
      const headBound = report.failures.filter((f) => !TRANSIENT_KINDS.has(f.kind));
      if (headBound.length > 0) {
        const published = await post('failure', failureDescription(headBound[0], headSha));
        report.posted = published.published === true;
        report.post = published;
        if (!report.posted) {
          report.pendingRemains = true;
          report.error = `${report.error}; the failure status could not be published (${published.reason || 'not published'}), so the pending status remains and keeps vetoing hosted acceptance`;
        }
      } else {
        report.pendingRemains = true;
        report.error = `${report.error}; nothing was published about this head, so the pending status remains and keeps vetoing hosted acceptance until a gate run with forceLocal:true passes`;
      }
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
  if (!record.ok) {
    // The pending stays: no record was written, so the run is not attested and hosted acceptance stays vetoed.
    return stop('attest', `cannot build record: ${record.error}; the pending status remains`, { pendingRemains: true });
  }

  const published = await post('success', record.description);
  report.post = published;
  report.posted = published.published === true;
  report.record = record.fields;
  report.ok = report.posted;
  report.mergeReady = report.posted;
  if (!report.posted) {
    report.cannotAttest = true;
    report.pendingRemains = true;
    report.error = `${CANNOT_ATTEST}: could not publish with gh: ${published.reason || 'status was not published'}; merge refused; the pending status remains and keeps vetoing hosted acceptance`;
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
  localRunVerdict,
  HANDLERS,
  MAX_STDIN_BYTES,
  defaultDeps,
  SWEEP_KEYS,
};

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
