#!/usr/bin/env node
'use strict';

/**
 * pr-review-beads-cli.js -- record the findings of a PR review as beads in the tracker of the
 * repository UNDER REVIEW (kata n350, docs/plans/pr-review-speedup-plan.md section 3H item 1).
 * JSON in on stdin, one JSON object out on stdout.
 *
 * It is NOT a subcommand of pr-review-cli.js: that CLI's modules are pure (no shell, no file
 * reads), and this one runs the tracker (`br`) through the toolchain and reads git. What to do is
 * decided by the pure `pr-review-beads.js`; this file asks the tracker what it already holds, runs
 * the plan and reports what happened. It never edits a file, commits, pushes, spawns a fix agent or
 * asks a question, so it behaves the same under `--foreman` and interactively: it only RECORDS. It
 * does not decide or resolve anything either: a finding's `resolution`, `cleared` mark and the
 * gate's verdict are untouched, so a blocking finding still blocks after its bead is recorded. The
 * `cleared` marks it acts on come from `pr-review-clear-cli.js`, which derives them from git.
 *
 * Usage: node pr-review-beads-cli.js < payload.json
 *
 *   payload  { repoRoot, baseSha, repo, prNumber, headSha, ledger[], security?{findings[]}, votes?,
 *              followOnIds?[], reportLink?, dryRun?, timeoutMs? }
 *     repoRoot     REQUIRED, the repository under review: a git repository or linked-worktree root,
 *                  exactly as `toolchain-cli --project-root` requires. It is never assumed to be the
 *                  current directory (a missing one is FAILED: beads must not land in whichever
 *                  repository the shell happens to be in). It names the repository only: the tracker
 *                  is NOT taken from this tree (see "What the head under review controls").
 *     baseSha      REQUIRED, the full commit id of the base the review resolved (`BASE_SHA`, Step 1).
 *                  The tracker's configuration is read as committed there, and a fix is a commit on
 *                  the PR: in `baseSha..headSha`.
 *     repo         `owner/name`, the repository identity half of every dedupe key, and the repository
 *                  the host is asked about
 *     ledger       the ledger's findings; `cleared`/`clearedBy` (from `pr-review-clear-cli.js`) mark a
 *                  finding fixed at a later head. A bead is closed only when `clearedBy` is a commit
 *                  this process verified with git is on the PR (an ancestor of `headSha`, not of
 *                  `baseSha`); the payload cannot supply that fact (a `commitsOnPr` key is ignored)
 *     votes        the `votes` result (each finding's tally and whether it is presented)
 *     followOnIds  the findings the OPERATOR chose to defer; they get the `follow-on` label. Never
 *                  fill this from an agent's own judgement
 *     reportLink   the state report; default: its path relative to the repository (never an
 *                  absolute path: the bead lives in git history)
 *     dryRun       plan only: look the keys up, print the actions, change nothing
 *
 *   WHAT THE HEAD UNDER REVIEW CONTROLS: nothing about whether or where its own findings are
 *   recorded. Before anything is read from or written to the tracker this process
 *     0. binds the checkout to the pull request's repository, before the host is asked anything: the
 *        repository's PRIMARY checkout (`repoRoot` may be a linked worktree of it) must have an
 *        `origin` remote, every fetch and push URL of it, that names `repo` (`owner/name`, compared
 *        without regard to case; https, ssh and scp-like URLs). An `origin` that names another
 *        repository (a fork checkout, whatever other remote names `repo`) is REFUSED
 *        `repository-mismatch`; no `origin`, URLs that name no `owner/name`, or a git that cannot
 *        list them is REFUSED `repository-unknown`; a repository with no primary checkout is
 *        REFUSED `no-primary-worktree`: beads never land in another repository's tracker
 *        (`pr-review-repo.js` `bindRepository`, the same binding the merge sweep uses);
 *     1. asks the HOST (`gh pr view`) about the pull request and refuses, by name, a head on a fork
 *        (`cross-repository-head`), a head whose repository the host did not state
 *        (`head-repository-unknown`), a pull request it could not read (`pr-unreadable`), a
 *        `headSha` that is not the head the host reports (`head-not-pr-head`; `head-unverified`
 *        when the host stated none) and a `baseSha` that is not on the base branch the host
 *        reports (`base-not-on-base-branch`; `base-unverified` when the host stated no tip,
 *        `base-tip-unavailable` when that tip is not in the repository: fetch it), the way the
 *        precheck and the review runner refuse them (the head's own files must not steer what is
 *        written for it, and a commit the pull request does not hold, or one it authored as the
 *        "base", is not the review's);
 *     2. runs the tracker in the repository's PRIMARY checkout, never in a linked worktree or clone
 *        of the head (`git rev-parse --git-common-dir`), and refuses that checkout when it holds the
 *        head or anything built on it (`head-checked-out`: its `.beads` would be the head's own);
 *     3. reads the tracker choice from `.ensemble/toolchain.yaml` AS COMMITTED AT `baseSha`, never
 *        from the tree and never by detection against it (a head that names another tracker, or no
 *        tracker, cannot switch its own findings' recording off).
 *   Any other repository state it cannot establish is a refusal too, never a guess.
 *
 *   result   { ok, status, recorded, counts, actions[], beads{ <findingId>: { action, reason, key, beadId?, closedBeadId? } } }
 *     status   RECORDED     every action ran (exit 0)
 *              PLANNED      `dryRun` (exit 0)
 *              UNAVAILABLE  the repository has no usable tracker, or its adapter lacks a capability
 *                           the plan needs: NO bead was recorded, `fallback` is `skip-finding-beads`;
 *                           the caller says so and still shows the findings list (exit 0)
 *              REFUSED      a trust check above failed (`code` names it, `reason` says why): NO bead
 *                           was recorded and nothing was written, same fallback (exit 0)
 *              PARTIAL      some actions failed, each `actions[i].error` says which (exit 1)
 *              FAILED       the plan could not be made: bad input, a missing `repoRoot` or `baseSha`,
 *                           or the tracker could not be read (exit 1)
 *   `unverifiedFixes[]` (when any) names each `clearedBy` commit that is not on the PR and why: that
 *   finding's bead was NOT closed.
 *   Put `beads[id].beadId` on each ledger entry as `beadId` and `beads[id].closedBeadId` as
 *   `closedBeadId` before calling `gate`: the operator's decision list shows them. `beadId` is only
 *   ever an OPEN bead; a live finding whose bead is closed carries `closedBeadId` instead.
 */

const fs = require('fs');
const path = require('path');

const tracker = require('./tracker-findings');
const { beadKeys, planBeads } = require('./pr-review-beads');
const { redact, statePath } = require('./pr-review-state');
const repoFacts = require('./pr-review-repo');
const runtime = require('./review-record-runtime');
const { isObjectId } = require('./pr-review-scope');

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';

function failed(reason, extra) {
  return { ok: false, status: 'FAILED', recorded: false, reason, ...extra };
}

/** A trust check said no: nothing was read from or written to the tracker. Same fallback as no tracker. */
function refused(code, reason) {
  return { ok: true, status: 'REFUSED', recorded: false, fallback: tracker.SKIP_FALLBACK, code, reason, actions: [], beads: {} };
}

function unavailableResult(envelope, plan) {
  const message = envelope.error && envelope.error.message ? envelope.error.message : 'the tracker is unavailable';
  return {
    ok: true,
    status: 'UNAVAILABLE',
    recorded: false,
    fallback: tracker.SKIP_FALLBACK,
    reason: message,
    ...(plan === undefined ? {} : { counts: plan.counts }),
    actions: [],
    beads: {},
  };
}

/** Run one planned action through the tracker. Returns `{ok, beadId?, error?, unavailable?}`. */
function execute(deps, action) {
  if (action.action === 'create') {
    const result = tracker.createFinding(deps, action.create);
    if (!result.ok) return result;
    return { ok: true, beadId: result.data && result.data.id };
  }
  if (action.action === 'update') {
    // A bead this recorder closed as a fix, whose finding is back: open it first, then rewrite it.
    if (action.reopen) {
      const reopened = tracker.reopenFinding(deps, { id: action.beadId });
      if (!reopened.ok) return reopened;
    }
    if (action.update) {
      const updated = tracker.updateFinding(deps, action.update);
      if (!updated.ok) return updated;
    }
    if (action.addLabels) {
      const labelled = tracker.labelFinding(deps, { id: action.beadId, labels: action.addLabels });
      if (!labelled.ok) return labelled;
    }
    return { ok: true, beadId: action.beadId };
  }
  if (action.action === 'close') {
    const closed = tracker.closeFinding(deps, action.close);
    return closed.ok ? { ok: true, beadId: action.beadId } : closed;
  }
  return { ok: true, beadId: action.beadId };
}

/**
 * Look up every key, plan, and run the plan.
 *
 * @param {object} input  the payload (see the file header), minus the CLI-only keys; `commitsOnPr`
 *   (full commit ids verified to be on the PR) is what lets a cleared finding close its bead
 * @param {{run: Function}} deps  tracker deps (`createToolchainDeps`, or a fake in tests)
 * @param {{dryRun?: boolean}} [options]
 */
function recordBeads(input, deps, options = {}) {
  const wanted = beadKeys(input);
  if (!wanted.ok) return failed(wanted.reason);

  let byKey = {};
  if (wanted.keys.length > 0) {
    const listed = tracker.findByKeys(deps, { keys: wanted.keys });
    if (!listed.ok) {
      if (listed.unavailable) return unavailableResult(listed);
      return failed(`tracker lookup failed: ${listed.error && listed.error.message}`, { error: listed.error });
    }
    byKey = listed.byKey;
  }

  const plan = planBeads(input, byKey);
  if (!plan.ok) return failed(plan.reason);
  if (options.dryRun === true) {
    return { ok: true, status: 'PLANNED', recorded: false, counts: plan.counts, actions: plan.actions, beads: plan.byFinding };
  }

  const beads = { ...plan.byFinding };
  let unavailable = null;
  let errors = 0;
  const actions = plan.actions.map((action) => {
    const { create, update, close, ...summary } = action;
    if (action.action === 'error') {
      errors += 1;
      return summary;
    }
    const outcome = execute(deps, action);
    if (!outcome.ok) {
      errors += 1;
      if (outcome.unavailable && unavailable === null) unavailable = outcome;
      return { ...summary, ok: false, error: outcome.error, ...(outcome.unavailable ? { unavailable: true } : {}) };
    }
    if (outcome.beadId !== undefined) {
      // A close leaves a CLOSED bead: `beadId` only ever names an open one.
      const field = action.action === 'close' ? 'closedBeadId' : 'beadId';
      delete summary.beadId;
      summary[field] = outcome.beadId;
      for (const id of action.findingIds) beads[id] = { ...beads[id], [field]: outcome.beadId };
    }
    return { ...summary, ok: true };
  });

  // Nothing ran at all because the tracker lacks what the plan needs: that is "skip the beads",
  // the same answer as a repository with no tracker, not a half-recorded run.
  const ran = actions.some((a) => a.ok === true && (a.action === 'create' || a.action === 'update' || a.action === 'close'));
  if (unavailable !== null && !ran) return unavailableResult(unavailable, plan);

  return {
    ok: errors === 0,
    status: errors === 0 ? 'RECORDED' : 'PARTIAL',
    recorded: errors === 0,
    counts: plan.counts,
    actions,
    beads,
  };
}

// ---------------------------------------------------------------------------
// What the head under review must not control
// ---------------------------------------------------------------------------

const TOOLCHAIN_CONFIG = path.posix.join('.ensemble', 'toolchain.yaml');

/**
 * The trust checks. `{ok:true, trackerRoot, baseConfig}` or `{ok:false, result}` (a REFUSED result).
 * See the file header, "What the head under review controls". The repository binding comes first: nothing is asked of the host
 * or the tracker for a checkout that is not the pull request's repository.
 */
function checkTrust({ input, repoRoot, baseSha, git, readPr }) {
  const refuse = (code, reason) => ({ ok: false, result: refused(code, reason) });

  const repo = input.repo.trim();

  // The checkout the beads land in must BE the pull request's repository, and that is settled before the host or the tracker is
  // asked anything. The tracker is in the PRIMARY checkout (`repoRoot` may be a linked worktree of it, which can carry its own
  // remote configuration), so that is the checkout whose `origin` is compared: a fork checkout, or a checkout of any other
  // repository, would otherwise receive the findings of a pull request that is not its own.
  const primary = repoFacts.primaryWorktree(git, repoRoot);
  if (!primary.ok) {
    return refuse('no-primary-worktree', `the repository's primary checkout, which holds its tracker, could not be found from ${repoRoot} (${primary.reason}): nothing was recorded`);
  }
  const bound = repoFacts.bindRepository(git, primary.path, repo);
  if (!bound.ok) return refuse(bound.code, bound.reason);

  const pr = readPr({ repo, prNumber: input.prNumber });
  if (!isObject(pr) || pr.ok !== true) {
    const why = isObject(pr) && pr.error ? pr.error : 'no answer';
    return refuse('pr-unreadable', `the pull request could not be read from the host (${why}), so its head is not known to be on this repository: nothing was recorded`);
  }
  if (pr.isCrossRepository !== false) {
    return pr.isCrossRepository === true
      ? refuse('cross-repository-head', 'the head of this pull request is on a fork: its files must not decide what is recorded in this repository\'s tracker, so no bead was recorded; read the findings from the list')
      : refuse('head-repository-unknown', 'the host did not say whether the head of this pull request is on this repository, so no bead was recorded');
  }

  // The review is of THIS head: the host's own head must be the commit the payload names. A head the pull request
  // does not hold (a stale one, a fork's, a commit the host never saw) must not decide what is recorded for it.
  const headSha = input.headSha.trim();
  const hostHead = typeof pr.headRefOid === 'string' ? pr.headRefOid.trim().toLowerCase() : '';
  if (!isObjectId(hostHead)) {
    return refuse('head-unverified', 'the host did not state the head commit of this pull request, so the head under review could not be checked against it: nothing was recorded');
  }
  if (hostHead !== headSha.toLowerCase()) {
    return refuse('head-not-pr-head', `headSha ${headSha} is not the current head of the pull request (the host reports ${hostHead}): nothing was recorded; review the current head, then record`);
  }

  const holds = repoFacts.holdsHead(git, primary.path, headSha);
  if (holds !== false) {
    return refuse(
      holds === true ? 'head-checked-out' : 'head-checkout-unknown',
      holds === true
        ? `the checkout at ${primary.path} holds the head under review (${headSha}) or work built on it, so its .beads would be the head's own: review from a checkout of the base (a linked worktree of it is fine), nothing was recorded`
        : `whether the checkout at ${primary.path} holds the head under review could not be established, so nothing was recorded`
    );
  }

  const base = repoFacts.resolveCommit(git, repoRoot, baseSha);
  if (base === null) {
    return refuse('base-unavailable', `baseSha ${baseSha} is not a commit of the repository at ${repoRoot} (fetch it), so the tracker's configuration cannot be read from the base: nothing was recorded`);
  }

  // And the base must be the base branch's own: a commit the pull request authored would let its own
  // .ensemble/toolchain.yaml choose the tracker. The host states the base branch's tip; baseSha must be on it.
  const hostBaseTip = typeof pr.baseRefOid === 'string' ? pr.baseRefOid.trim().toLowerCase() : '';
  if (!isObjectId(hostBaseTip)) {
    return refuse('base-unverified', 'the host did not state the tip of the base branch, so baseSha could not be checked to be on it: nothing was recorded');
  }
  const onBase = repoFacts.isAncestor(git, repoRoot, base, hostBaseTip);
  if (onBase !== true) {
    return refuse(
      onBase === false ? 'base-not-on-base-branch' : 'base-tip-unavailable',
      onBase === false
        ? `baseSha ${base} is not on the base branch (${pr.baseRefName || 'the base branch'} is at ${hostBaseTip}): a commit of the pull request itself would let its own files choose the tracker, so nothing was recorded`
        : `the base branch's tip ${hostBaseTip} is not in the repository at ${repoRoot} (fetch it), so baseSha could not be checked to be on the base branch: nothing was recorded`
    );
  }
  const config = repoFacts.readBlobAt(git, repoRoot, base, TOOLCHAIN_CONFIG);
  if (!config.ok) {
    return refuse('base-config-unreadable', `${TOOLCHAIN_CONFIG} could not be read as committed at ${base} (${config.reason}): nothing was recorded`);
  }
  return { ok: true, trackerRoot: primary.path, baseConfig: { text: config.text, label: `${base.slice(0, 12)}:${TOOLCHAIN_CONFIG}` } };
}

/**
 * The commits the ledger says fixed something that git says are ON THE PR. The shape of a hex string
 * proves nothing: a close needs a commit that exists, is an ancestor of the head and is not in the
 * base's history.
 *
 * @returns {{verified: string[], refused: Array<{commit: string, reason: string}>}}
 */
function verifyFixes(input, { git, repoRoot, baseSha }) {
  const findings = [...(Array.isArray(input.ledger) ? input.ledger : []), ...(isObject(input.security) && Array.isArray(input.security.findings) ? input.security.findings : [])];
  const written = new Set();
  for (const finding of findings) {
    if (isObject(finding) && finding.cleared === true && isText(finding.clearedBy)) written.add(finding.clearedBy.trim());
  }
  const verified = [];
  const refusedCommits = [];
  for (const commit of written) {
    const result = repoFacts.commitOnPr(git, repoRoot, { commit, headSha: input.headSha.trim(), baseSha });
    if (result.ok) verified.push(result.commit);
    else refusedCommits.push({ commit, reason: result.reason });
  }
  return { verified: [...new Set(verified)], refused: refusedCommits };
}

/** The state report's path relative to the repository, with `/` separators. */
function relativeReportLink(prNumber, projectRoot) {
  return path.relative(projectRoot, statePath(prNumber, projectRoot)).split(path.sep).join('/');
}

/**
 * @param {Object} [io]  `{ readJson, emit, deps, env, now, git, readPr }`, replaced by tests. `deps` are
 *   the tracker deps: when absent they are built for the repository's primary checkout. `git` is
 *   `pr-review-repo.js`'s injected git, `readPr` the host read (`makeReadPr` in `review-record-runtime.js`).
 */
function main(io = {}) {
  const readJson = io.readJson || (() => JSON.parse(fs.readFileSync(0, 'utf8')));
  const emit = io.emit || ((value) => process.stdout.write(`${JSON.stringify(redact(value))}\n`));
  const now = io.now || Date.now;
  const started = now();
  const finish = (result) => {
    emit({ ...result, wallMs: now() - started });
    return result.ok === true ? 0 : 1;
  };

  let payload;
  try {
    payload = readJson();
  } catch (err) {
    return finish(failed(`invalid JSON on stdin: ${err.message}`));
  }
  if (!isObject(payload)) return finish(failed('payload must be a JSON object'));

  // A `commitsOnPr` in the payload is dropped: that fact comes from git here, never from the caller.
  const { repoRoot, baseSha, dryRun, timeoutMs, commitsOnPr: ignoredCommitsOnPr, ...input } = payload;
  if (dryRun !== undefined && typeof dryRun !== 'boolean') return finish(failed("'dryRun' must be true or false when given"));
  if (!isText(repoRoot)) {
    return finish(failed("'repoRoot' is required: the repository under review (a git repository or linked-worktree root); it is never assumed to be the current directory"));
  }
  if (!isText(baseSha) || !isObjectId(baseSha.trim())) {
    return finish(failed("'baseSha' is required: the full commit id of the base the review resolved (the tracker's configuration is read as committed there, never from the head)"));
  }

  const wanted = beadKeys(input);
  if (!wanted.ok) return finish(failed(wanted.reason));

  const { resolveProjectRootFlag } = require('./toolchain-cli');
  const resolved = resolveProjectRootFlag(repoRoot);
  if (resolved.error) return finish(failed(resolved.error.message));
  const projectRoot = resolved.projectRoot;

  const git = io.git || runtime.defaultGit();
  const readPr = io.readPr || runtime.makeReadPr();
  const trust = checkTrust({ input, repoRoot: projectRoot, baseSha: baseSha.trim(), git, readPr });
  if (!trust.ok) return finish(trust.result);

  const deps =
    io.deps ||
    tracker.createToolchainDeps({
      projectRoot: trust.trackerRoot,
      env: io.env || process.env,
      timeoutMs,
      // The head under review is never a source of the adapter, of the tracker choice or of the
      // tracker's state (see the file header).
      untrustedProjectRoot: true,
      baseConfig: trust.baseConfig,
    });

  const fixes = verifyFixes(input, { git, repoRoot: projectRoot, baseSha: baseSha.trim() });
  const request = { ...input, commitsOnPr: fixes.verified };
  if (request.reportLink === undefined && Number.isInteger(request.prNumber) && request.prNumber >= 1) {
    request.reportLink = relativeReportLink(request.prNumber, projectRoot);
  }

  const result = recordBeads(request, deps, { dryRun: dryRun === true });
  if (fixes.refused.length > 0) result.unverifiedFixes = fixes.refused;
  return finish(result);
}

module.exports = { main, recordBeads, checkTrust, verifyFixes };

if (require.main === module) {
  process.exit(main());
}
