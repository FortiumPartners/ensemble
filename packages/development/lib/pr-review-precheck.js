'use strict';

/**
 * PR review precheck (kata 4ev6, docs/plans/pr-review-speedup-plan.md section 3A third bullet and 3G).
 *
 * Minute-1 work, before any reviewer or the tier classifier has run:
 *   1. work out which blockers a HUMAN can already act on (approvals shortfall, missing PR-description sections,
 *      branch protection that does not enforce approvals);
 *   2. start the local-CI gate for the CURRENT head exactly once, in the background;
 *   3. post the list as ONE PR comment, updated in place.
 *
 * NO shell, NO network, NO file reads here. Every read and write goes through `deps` (the pattern of
 * local-ci-runner.js `deps.run`), so this module is a pure function of what the caller's deps return and is tested
 * with fakes; `review-precheck-cli.js` supplies the real `gh`/`git`/filesystem deps.
 *
 * HONEST LIMITS, kept in the comment text itself:
 *   - The approvals count needs the tier, which needs the classifier agent, and the `Directed by` credit needs to know
 *     whether an agent wrote the PR. Neither is known at minute 1, so approvals are never reported as satisfied there:
 *     until a tier is supplied the requirement is a LOWER BOUND ("at least N") and the count an UPPER BOUND (it
 *     includes the director credit), so the only things that hold are a shortfall ("at least N more") or "not
 *     established", never "met". A supplied tier makes the requirement exact, but `satisfied` still needs the count to
 *     hold WITHOUT the director credit.
 *   - Branch protection that cannot be read is `unknown`, never `enforced`. A status or review that cannot be read is
 *     reported as unreadable, never as "nothing missing" and never as "no status" (which would start a second gate).
 *   - The gate runs the HEAD's own code (its dependency install scripts, then its tests) on this machine, so it is
 *     started only for a head on THIS repository. A head on a fork, or one whose repository GitHub did not state, gets
 *     a named refusal (`cross-repository-head`, `head-repository-unknown`): nothing is fetched, cloned or marked for it.
 *   - Nothing here is a lock: `claimGateStart` is only an atomic create-once marker; queueing belongs to `gatelock`. The same
 *     goes for the comment: two runs at the same instant can both find none and both post. Later runs update the oldest marker
 *     comment and never add another; the surplus one is left as it was (delete it by hand).
 *
 * deps (every one returns a Promise or a value; a read answers `{ok:true, ...}` or `{ok:false, error}`):
 *   readPr()                        -> {ok, headSha, baseRefName, state, body, author, isCrossRepository}
 *   readReviews()                   -> {ok, reviews[{login, state, commitSha, authorType?, submittedAt?}]}
 *   readHeadTree(headSha)           -> {ok, treeSha}
 *   readProtection(baseRefName)     -> {ok, notProtected?, protection?}          (GET branches/<base>/protection)
 *   readStatuses(headSha)           -> {ok, statuses[{context, state, sha?, description?}]}
 *   readGateConfig(baseRefName)     -> {ok, statusContext} | {ok:false, error}   (base-ref `.ensemble/local-ci.yaml`)
 *   readPolicy(baseRefName)         -> {ok, policy}                              (base-ref REVIEW.md; optional)
 *   prepareGate({headSha, baseRefName, dryRun}) -> {ok} | {ok:false, error}      (every network step: fetch the base and the head)
 *   claimGateStart({headSha, dryRun}) -> {claimed:true}
 *                                      | {claimed:false, existing:{pid?, startedAt?, alive, orphaned?, claimer?, marker?}}  (already started)
 *                                      | {claimed:false, blocked:{kind, reason}}   (another gate holds this head's one clone)
 *                                      | {claimed:false, error}
 *                                        (`alive:null` = a young claim whose run is still going; `orphaned` = its run died first)
 *   startGate({headSha, baseRefName, dryRun}) -> {ok:true, pid, logPath, startedAt}
 *                                              | {ok:false, error}                           (no gate process exists)
 *                                              | {ok:false, error, mayBeRunning:true, pid}   (one may: keep the claim)
 *   releaseGateStart({headSha, dryRun})       -> void   (only when no gate process can exist, so a retry can start one)
 *   findComment()                   -> {ok, comment: null | {id, body}}          (our one comment on this PR)
 *   postComment(body)               -> {ok, id?, url?, error?}
 *   updateComment(id, body)         -> {ok, id?, url?, error?}
 */

const { evaluateApprovals } = require('./pr-review-approvals');
const { checkDescription, SECTION_LABELS } = require('./pr-review-description');
const { BLOCKER_CODES } = require('./pr-review-gate');

/** First line of our one comment per PR: how a re-run finds it again. */
const COMMENT_MARKER = '<!-- ensemble:pr-review-precheck -->';

const SHA_RE = /^[0-9a-f]{40}$/;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const errorText = (r) => (isObject(r) && isText(r.error) ? r.error : 'no answer');

/** The humans a PR needs at the tier floor, per tier. */
const HUMANS_BY_TIER = Object.freeze({ low: 0, medium: 1, high: 2 });

/**
 * The approvals requirement known WITHOUT the tier.
 *
 * A Low assignment is effectively Medium (one human) unless the repository's policy enables the Low waiver, so with a
 * policy that is readable and does not enable it, no PR can need fewer than one human. A policy that enables the
 * waiver, or one that could not be read, leaves 0 as the only floor that is certainly true.
 */
function approvalsFloor(policyResult) {
  if (isObject(policyResult) && policyResult.ok === true && isObject(policyResult.policy) && policyResult.policy.lowWaiverEnabled === false) {
    return { humans: 1, basis: 'the Low waiver is not enabled in this repository, so every PR needs at least one human approval' };
  }
  return { humans: 0, basis: 'the repository policy could not be read as having the Low waiver disabled, so no minimum can be assumed' };
}

/**
 * Approvals: the requirement (a lower bound until `tier` is known), what is counted for THIS head, and the shortfall.
 *
 * Whether an agent wrote the PR -- which is what earns the `Directed by` person a slot -- is not known at minute 1 (the
 * review cycle passes it as `agentAuthored`). So the count is worked out both ways: `generous` credits the named
 * director, `strict` does not. A shortfall that exists even in the generous count is certain ("short"). Anything else
 * is only `satisfied` when the tier is known AND the strict count meets it; otherwise it is `not-established`: the
 * floor was reached by a lower bound or by a credit that may not apply, which says nothing about the real requirement.
 */
function assessApprovals({ reviewsResult, pr, headSha, headTreeSha, tier, policyResult, directedBy }) {
  if (!isObject(reviewsResult) || reviewsResult.ok !== true || !Array.isArray(reviewsResult.reviews)) {
    return { state: 'unknown', reason: `reviews could not be read: ${errorText(reviewsResult)}` };
  }
  const tierKnown = isObject(tier) && tier.ok !== false && typeof tier.effectiveTier === 'string' && tier.effectiveTier in HUMANS_BY_TIER;
  const floor = approvalsFloor(policyResult);
  const effective = tierKnown ? tier : { ok: true, effectiveTier: floor.humans >= 1 ? 'medium' : 'low', humansRequired: floor.humans };
  const evaluate = (credited) => evaluateApprovals({
    reviews: reviewsResult.reviews,
    headSha,
    headTreeSha,
    tier: effective,
    policy: isObject(policyResult) && policyResult.ok === true ? policyResult.policy : undefined,
    author: pr.author,
    // evaluateApprovals reads `directedBy` only when `agentAuthored` is true.
    directedBy: credited ? directedBy || undefined : undefined,
    agentAuthored: credited && directedBy ? true : undefined,
  });
  const generous = evaluate(true);
  const strict = directedBy ? evaluate(false) : generous;
  if (generous.ok !== true || strict.ok !== true) {
    return { state: 'unknown', reason: `approvals could not be evaluated: ${generous.ok !== true ? generous.reason : strict.reason}` };
  }
  const required = generous.humansRequired;
  const counted = generous.humansCounted;
  const credit = generous.directedBy
    ? ` (counting the \`Directed by: @${generous.directedBy}\` credit, which the gate gives when an agent wrote this PR; if a person wrote it, that credit does not apply)`
    : '';
  let state = 'satisfied';
  let reason;
  if (counted < required) {
    state = 'short';
  } else if (generous.satisfied !== true) {
    state = 'not-established';
    reason = `The tier record refused a relaxation (${generous.reason}), so the gate will not read these approvals as enough`;
  } else if (!tierKnown) {
    state = 'not-established';
    reason = `The review tier is not assigned yet, so how many human approvals this PR needs is not known: ${floor.humans} is only a lower bound (${floor.basis}) and a High PR needs ${HUMANS_BY_TIER.high}. ${counted} counted on this head${credit}`;
  } else if (strict.satisfied !== true) {
    state = 'not-established';
    reason = `${required} needed at the ${tier.effectiveTier} tier and ${counted} counted on this head${credit}; without that credit the count is ${strict.humansCounted}`;
  }
  return {
    state,
    ...(reason === undefined ? {} : { reason }),
    lowerBound: !tierKnown,
    tierKnown,
    tier: tierKnown ? tier.effectiveTier : null,
    required,
    counted,
    approvedBy: generous.approvedBy,
    shortfall: Math.max(0, required - counted),
    ignored: generous.ignored,
    basis: tierKnown ? `the tier is ${tier.effectiveTier}` : floor.basis,
    headTreeKnown: headTreeSha !== undefined,
    directedBy: generous.directedBy,
  };
}

/** Description sections: which of Testing / Risk / How-to-revert the PR body lacks (and the director line). */
function assessDescription(prResult) {
  if (!isObject(prResult) || prResult.ok !== true || typeof prResult.body !== 'string') {
    return { state: 'unknown', reason: `the PR body could not be read: ${errorText(prResult)}` };
  }
  const d = checkDescription({ body: prResult.body });
  if (d.ok !== true) return { state: 'unknown', reason: `the PR body could not be graded: ${d.reason}` };
  const sections = d.missing.filter((id) => id in SECTION_LABELS);
  return {
    state: sections.length === 0 ? 'complete' : 'missing',
    missing: sections,
    // `directed-by` is only required when an agent wrote the PR, which is not known at minute 1.
    directedByMissing: d.missing.includes('directed-by'),
    directedBy: d.directedBy,
  };
}

/**
 * Branch protection. `enforced` ONLY when a successful read shows the base requires at least `needed` approving
 * reviews. A read that shows no or too few required reviews is `absent` (the notice merge-gate.md prints); anything
 * that could not be read is `unknown`, never `enforced`.
 */
function assessProtection(protectionResult, baseRefName, approvals) {
  if (!isObject(protectionResult) || protectionResult.ok !== true) {
    return { state: 'unknown', reason: `branch protection could not be read: ${errorText(protectionResult)}`, baseRefName };
  }
  const needed = Math.max(1, approvals && Number.isInteger(approvals.required) ? approvals.required : 1);
  if (protectionResult.notProtected === true) return { state: 'absent', baseRefName, needed, requiredReviews: 0 };
  const rule = isObject(protectionResult.protection) ? protectionResult.protection : null;
  if (rule === null) return { state: 'unknown', reason: 'branch protection answered with something that is not a rule', baseRefName };
  const rpr = rule.required_pull_request_reviews;
  const count = isObject(rpr) && Number.isInteger(rpr.required_approving_review_count) ? rpr.required_approving_review_count : 0;
  return count >= needed
    ? { state: 'enforced', baseRefName, needed, requiredReviews: count }
    : { state: 'absent', baseRefName, needed, requiredReviews: count };
}

/**
 * Should the gate start for this head? Reads the statuses, never a brief's claim that one was posted.
 *
 * - a status in the configured context bound to THIS head (any state) -> `status-present`, do not start;
 * - a status only on an OLD head                                       -> `start`;
 * - nothing                                                            -> `start`;
 * - statuses or config unreadable -> `unknown`, do not start (a duplicate gate costs minutes of CPU; the report says so).
 */
function decideGate({ statusesResult, statusContext, headSha, configResult }) {
  if (!isText(statusContext)) {
    // Carry the real cause (kata zy6j): a missing file, an unreadable one, a parse error and a missing runner dependency are
    // four different problems with four different fixes. Only a reader that gave no error at all gets the generic words.
    const cause = isObject(configResult) && isText(configResult.cause) ? `${configResult.cause}: ` : '';
    const why = isObject(configResult) && configResult.ok === false && isText(configResult.error)
      ? `${cause}${configResult.error}`
      : 'no answer from the local-CI config reader';
    return { action: 'unknown', reason: `the local-CI status context is not known (${why})` };
  }
  if (!isObject(statusesResult) || statusesResult.ok !== true || !Array.isArray(statusesResult.statuses)) {
    return { action: 'unknown', reason: `commit statuses could not be read: ${errorText(statusesResult)}` };
  }
  const want = statusContext.toLowerCase(); // GitHub status contexts are case-insensitive.
  const ours = statusesResult.statuses.filter((s) => isObject(s) && typeof s.context === 'string' && s.context.toLowerCase() === want);
  const forHead = ours.filter((s) => typeof s.sha === 'string' && s.sha.toLowerCase() === headSha);
  if (forHead.length > 0) return { action: 'status-present', state: forHead[0].state, statusContext };
  const old = ours.find((s) => typeof s.sha === 'string' && SHA_RE.test(s.sha.toLowerCase()));
  return { action: 'start', statusContext, ...(old ? { oldHeadStatus: { sha: old.sha, state: old.state } } : {}) };
}

/** Everything the comment says, as data. Pure. */
function buildReport(facts) {
  const { headSha, baseRefName, pr, reviewsResult, headTreeSha, protectionResult, policyResult, tier } = facts;
  const description = assessDescription(pr);
  const approvals = assessApprovals({ reviewsResult, pr, headSha, headTreeSha, tier, policyResult, directedBy: description.directedBy });
  const protection = assessProtection(protectionResult, baseRefName, approvals);

  const blockers = [];
  const notEstablished = [];
  if (approvals.state === 'unknown') {
    blockers.push({ code: BLOCKER_CODES.REVIEW_DATA_UNAVAILABLE, subject: 'approvals', message: `Approvals: unknown. ${approvals.reason}.` });
  } else if (approvals.state === 'not-established') {
    notEstablished.push({ subject: 'approvals', message: `Approvals: not established. ${approvals.reason}.` });
  } else if (approvals.state === 'short') {
    const qualifier = approvals.lowerBound ? 'at least ' : '';
    blockers.push({
      code: BLOCKER_CODES.APPROVALS_UNSATISFIED,
      subject: 'approvals',
      lowerBound: approvals.lowerBound,
      message: `Approvals: ${qualifier}${approvals.shortfall} more human approval${approvals.shortfall === 1 ? '' : 's'} needed on this head (${approvals.counted} of ${qualifier}${approvals.required} counted)${approvals.lowerBound ? '; this is a lower bound, the tier is not assigned yet' : ''}.`,
    });
  }
  if (description.state === 'unknown') {
    blockers.push({ code: BLOCKER_CODES.REVIEW_DATA_UNAVAILABLE, subject: 'description', message: `PR description: unknown. ${description.reason}.` });
  } else if (description.state === 'missing') {
    blockers.push({
      code: BLOCKER_CODES.DESCRIPTION_SECTION_MISSING,
      subject: 'description',
      sections: description.missing,
      message: `PR description is missing: ${description.missing.join(', ')}.`,
    });
  }
  return { headSha, baseRefName, approvals, description, protection, blockers, notEstablished };
}

const short = (sha) => (typeof sha === 'string' ? sha.slice(0, 8) : 'unknown');

function protectionLines(p, approvals) {
  if (p.state === 'enforced') {
    const more = approvals.lowerBound ? ' (the tier is not assigned yet, so the final requirement may be higher)' : '';
    return [`Branch protection on \`${p.baseRefName}\`: enforced, requires ${p.requiredReviews} approving review${p.requiredReviews === 1 ? '' : 's'}${more}.`];
  }
  if (p.state === 'absent') {
    return [
      `SERVER-SIDE ENFORCEMENT ABSENT: ${p.baseRefName} does not require the approvals this tier needs, so nothing outside this run prevents a merge without them.\n  Recommended: require ${p.needed} approving review(s) on ${p.baseRefName} in branch protection.`,
    ];
  }
  return [`Branch protection on \`${p.baseRefName}\`: unknown. ${p.reason}. It is not assumed to be in place.`];
}

function gateLine(gate) {
  switch (gate.action) {
    case 'started':
      return `Local CI gate: started in the background at ${gate.startedAt || 'this run'}${gate.dryRun ? ' (dry run: it will not post a status)' : ''}${gate.logPath ? `, log \`${gate.logPath}\`` : ''}.${gate.dryRun ? '' : ` It posts \`${gate.statusContext}\` on this head when it finishes.`}`;
    case 'already-started': {
      const e = isObject(gate.existing) ? gate.existing : {};
      if (e.orphaned === true) {
        return `Local CI gate: an earlier start was interrupted${e.marker ? ` (marker \`${e.marker}\`)` : ''}: the run that began it${Number.isInteger(e.claimer) ? ` (pid ${e.claimer})` : ''} is gone and never recorded a gate process, so a gate may or may not have been launched, and no status has been posted. Not started again, so as not to start a second one. Look for a running \`local-ci-cli.js gate\`; if there is none, delete the marker and run the precheck again.`;
      }
      if (e.alive === null && e.pid === undefined) return 'Local CI gate: another precheck run is starting it right now; not started again.';
      return `Local CI gate: already started${e.startedAt ? ` at ${e.startedAt}` : ''}; not started again.${e.alive === false ? ' That process is no longer running and has posted no status: read its log before relying on it.' : ''}`;
    }
    case 'status-present':
      return `Local CI gate: \`${gate.statusContext}\` is already posted on this head (${gate.state}); not started.`;
    case 'start-failed':
      return `Local CI gate: could NOT be started (${gate.reason}).${gate.mayBeRunning ? ' A gate process may still be running, so the start stays recorded and no second one is started.' : ''}`;
    default:
      return `Local CI gate: not started. ${gate.reason}.`;
  }
}

/**
 * The comment body. The marker is the first line; nothing after it depends on anything a PR author can write
 * (only fixed section ids, validated logins, SHAs and fixed text are interpolated).
 */
function formatComment(report, gate) {
  const lines = [COMMENT_MARKER, `### PR review precheck, head \`${short(report.headSha)}\``, ''];
  if (report.blockers.length > 0) {
    lines.push('Things a person can act on now, while the review runs:', '');
    for (const b of report.blockers) lines.push(`- [ ] ${b.message}`);
  } else if (report.notEstablished.length === 0) {
    lines.push('No human-actionable blockers found at this point.');
  } else {
    lines.push('No blocker a person can act on is established yet.');
  }
  if (report.notEstablished.length > 0) {
    lines.push('', 'Not established yet:', '');
    for (const n of report.notEstablished) lines.push(`- ${n.message}`);
  }
  lines.push('', ...protectionLines(report.protection, report.approvals).map((l) => `- ${l}`));
  if (report.description.state === 'complete' || report.description.state === 'missing') {
    if (report.description.directedByMissing) lines.push('- If an agent wrote this PR, the description also needs a `Directed by: @login` line.');
  }
  if (report.approvals.state === 'short' && report.approvals.lowerBound) {
    lines.push(`- The approvals figure is a lower bound: the review tier is assigned later and may require more (${report.approvals.basis}).`);
  }
  if (report.approvals.state === 'short' && report.approvals.directedBy) {
    lines.push(`- \`Directed by: @${report.approvals.directedBy}\` is counted as one approval, as the gate counts it when an agent wrote this PR; if a person wrote it, that credit does not apply and the shortfall is larger.`);
  }
  if (report.approvals.state !== 'unknown' && report.approvals.headTreeKnown === false) {
    lines.push('- The head tree could not be read, so approvals given on earlier commits of identical content are not counted.');
  }
  lines.push('', `- ${gateLine(gate)}`, '', '_This is a precheck. REVIEW_COMPLETE and the merge decision come only from the review gate._');
  return `${lines.join('\n')}\n`;
}

/**
 * The gate runs the head's own code on this machine. A head on another repository is code from outside this one, and
 * so is a head whose repository GitHub did not state (not knowing is not "same repository"): refuse both, by name.
 */
function refuseHead(isCrossRepository, statusContext) {
  const why = isCrossRepository === true
    ? { code: 'cross-repository-head', reason: 'the head of this pull request is on a fork, and the gate runs the head\'s own code (its dependency install scripts and its tests) on this machine, so it is not started for a head from outside this repository; read the diff, and run the gate by hand if you trust it' }
    : { code: 'head-repository-unknown', reason: 'GitHub did not say whether the head of this pull request is on this repository, and the gate runs the head\'s own code on this machine, so it is not started' };
  return { action: 'not-started', ...why, statusContext };
}

const settle = (fn) => Promise.resolve().then(fn).catch((e) => ({ ok: false, error: e && e.message ? e.message : String(e) }));

/**
 * Start the gate for this head at most once, in an order that leaves no claim behind that never started a gate:
 *   1. `prepareGate` does every network step (fetch the base and the head) BEFORE anything is marked, so a run that
 *      dies while fetching leaves nothing behind;
 *   2. `claimGateStart` is the atomic create-once marker;
 *   3. `startGate` spawns the gate and records its process. From the spawn on a gate may exist, so the claim is released
 *      only when `startGate` says nothing is running (it failed before the spawn, or it stopped the gate it could not
 *      record). Releasing a claim whose gate may still run would let the next run start a second gate for the head.
 */
async function startOnce({ deps, headSha, baseRefName, dryRun, statusContext, oldHeadStatus }) {
  const prepared = await settle(() => deps.prepareGate({ headSha, baseRefName, dryRun }));
  if (!isObject(prepared) || prepared.ok !== true) return { action: 'start-failed', reason: `could not prepare the start: ${errorText(prepared)}`, statusContext };
  const claim = await settle(() => deps.claimGateStart({ headSha, dryRun }));
  if (isObject(claim) && claim.claimed !== true && isObject(claim.blocked)) {
    return { action: 'not-started', code: String(claim.blocked.kind), reason: String(claim.blocked.reason), statusContext };
  }
  if (!isObject(claim) || (claim.claimed !== true && !isObject(claim.existing))) {
    return { action: 'start-failed', reason: `could not record the start: ${errorText(claim)}`, statusContext };
  }
  if (claim.claimed !== true) return { action: 'already-started', statusContext, existing: claim.existing };
  const started = await settle(() => deps.startGate({ headSha, baseRefName, dryRun }));
  if (isObject(started) && started.ok === true) {
    return { action: 'started', statusContext, dryRun, pid: started.pid, logPath: started.logPath, startedAt: started.startedAt, ...(oldHeadStatus ? { oldHeadStatus } : {}) };
  }
  const mayBeRunning = isObject(started) && started.mayBeRunning === true;
  if (!mayBeRunning) await settle(() => deps.releaseGateStart({ headSha, dryRun }));
  return { action: 'start-failed', reason: errorText(started), statusContext, ...(mayBeRunning ? { mayBeRunning: true, pid: started.pid } : {}) };
}

/**
 * Run the precheck for one PR. Never throws on a failed read: the failure is in the result and in the comment.
 *
 * @param {{dryRun?:boolean, tier?:Object}} input `tier` is an optional `pr-review-cli tier` record; absent at minute 1.
 * @param {Object} deps see the header.
 */
async function runPrecheck(input, deps) {
  const dryRun = isObject(input) && input.dryRun === true;
  const tier = isObject(input) ? input.tier : undefined;

  const pr = await deps.readPr();
  if (!isObject(pr) || pr.ok !== true) return { ok: false, stage: 'pr', error: `cannot read the pull request: ${errorText(pr)}` };
  const headSha = typeof pr.headSha === 'string' ? pr.headSha.toLowerCase() : '';
  if (!SHA_RE.test(headSha)) return { ok: false, stage: 'pr', error: 'the pull request reports no usable head commit' };
  if (pr.state !== 'OPEN') return { ok: false, stage: 'pr', headSha, error: `the pull request is ${JSON.stringify(pr.state)}, not OPEN` };
  const baseRefName = pr.baseRefName;

  const [reviewsResult, treeResult, protectionResult, statusesResult, configResult, policyResult] = await Promise.all([
    settle(() => deps.readReviews()),
    settle(() => deps.readHeadTree(headSha)),
    settle(() => deps.readProtection(baseRefName)),
    settle(() => deps.readStatuses(headSha)),
    settle(() => deps.readGateConfig(baseRefName)),
    settle(() => deps.readPolicy(baseRefName)),
  ]);
  const headTreeSha = isObject(treeResult) && treeResult.ok === true && SHA_RE.test(String(treeResult.treeSha).toLowerCase()) ? String(treeResult.treeSha).toLowerCase() : undefined;

  const report = buildReport({ headSha, baseRefName, pr, reviewsResult, headTreeSha, protectionResult, policyResult, tier });

  // The gate: decided from what GitHub says now (see `startOnce` for the order of the start).
  const statusContext = isObject(configResult) && configResult.ok === true ? configResult.statusContext : undefined;
  const decision = decideGate({ statusesResult, statusContext, headSha, configResult });
  let gate;
  if (decision.action === 'status-present') gate = { ...decision };
  else if (decision.action === 'unknown') gate = { action: 'not-started', reason: decision.reason };
  else if (pr.isCrossRepository !== false) gate = refuseHead(pr.isCrossRepository, statusContext);
  else gate = await startOnce({ deps, headSha, baseRefName, dryRun, statusContext, oldHeadStatus: decision.oldHeadStatus });

  const body = formatComment(report, gate);
  const comment = { dryRun, body };
  if (dryRun) {
    comment.action = 'dry-run';
  } else {
    const found = await settle(() => deps.findComment());
    if (!isObject(found) || found.ok !== true) {
      Object.assign(comment, { action: 'failed', error: `could not look for the existing comment: ${errorText(found)}` });
    } else {
      const wrote = found.comment
        ? await settle(() => deps.updateComment(found.comment.id, body))
        : await settle(() => deps.postComment(body));
      Object.assign(comment, wrote && wrote.ok === true
        ? { action: found.comment ? 'updated' : 'created', id: wrote.id, url: wrote.url }
        : { action: 'failed', error: errorText(wrote) });
    }
  }

  return { ok: comment.action !== 'failed', headSha, baseRefName, dryRun, blockers: report.blockers, notEstablished: report.notEstablished, approvals: report.approvals, description: report.description, protection: report.protection, gate, comment };
}

module.exports = { runPrecheck, buildReport, formatComment, decideGate, assessProtection, approvalsFloor, COMMENT_MARKER };
