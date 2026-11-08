'use strict';

/**
 * local-ci-sweep-record.js -- the merge sweep that RECORDS what it finds as beads (kata `mdfr`, epic
 * `ptqb`; docs/plans/pr-review-speedup-plan.md section 3H and section 7, correction 2).
 *
 * `local-ci-sweep.js` is the pure half: given already-fetched facts and the dedupe keys the tracker
 * already holds, it names the findings and CI failures that are NOT tracked yet. Until this module
 * nothing built those keys and nothing created a bead: `local-ci-cli.js sweep` passed a caller-supplied
 * `trackedKeys` straight through, and pr-merge told the model to "record each new finding ... through
 * br". Now the sweep does the work itself, in four steps:
 *
 *   1. findUntracked(facts, [])        the entries that carry a key (resolved findings, duplicates and
 *                                      unreadable entries are set aside)
 *   2. tracker.findByKeys              which of those keys the tracker already holds: ONE listing of the
 *                                      workspace, closed beads and any labels included
 *   3. findUntracked(facts, held)      the entries that are really new
 *   4. tracker.createFinding           one bead per new entry, stored under the sweep key
 *
 * so a SECOND sweep of the same facts finds every key held and writes nothing.
 *
 * THE RULES (the maintainer and the next sweep rely on every one of them):
 *
 *   - IDENTITY. The key is the sweep's own, built from identifiers only (`finding:pr<N>:comment<ID>`,
 *     `ci-failure:checkrun<ID>`; `local-ci-sweep.js`), never from text, and it is the bead's external
 *     reference: br refuses a second bead with it anywhere in the workspace. It is not the PR-review
 *     recorder's (repository, file, claim) key: these facts have no claim to normalize.
 *   - HELD MEANS TRACKED. A key the tracker holds is skipped whatever the bead's state or labels. A bead a
 *     person closed (fixed, or judged not worth fixing) is never recreated or reopened by a later sweep.
 *     Several beads sharing one key are reported as an error and nothing is created for that key.
 *     A bead that was DELETED is held too: br keeps its external reference (a tombstone that `list --all` does
 *     not show), so the lookup says "not found" and the create is refused with "External reference '<this
 *     entry's key>' already exists". That refusal is the tracker saying the key is taken: the entry is skipped
 *     (`held-not-listed`), the sweep stays RECORDED, and every later sweep gives the same answer instead of
 *     being PARTIAL for good. A dry run only looks up, so it cannot see this and plans the create.
 *   - NOTHING TO RECORD, NOTHING TOUCHED. With no key to look up, git, the host and the tracker are not
 *     asked at all.
 *   - THE REPOSITORY. The repository's PRIMARY checkout (the one that holds the tracker; `repoRoot` may be a
 *     linked worktree of it) must BE the pull request's repository: its `origin` remote, every fetch and push
 *     URL of it, names `repo` (`owner/name`, compared without regard to case; https, ssh and scp-like URLs).
 *     An `origin` that names another repository (a fork checkout, whatever other remote names `repo`) is REFUSED
 *     `repository-mismatch`; no `origin`, URLs that name no `owner/name`, or a git that cannot list them is REFUSED
 *     `repository-unknown`; all before the host or the tracker is asked: beads never land in another repository's
 *     tracker. The binding is `pr-review-repo.js` `bindRepository`, the first step of `checkTrust`, so the PR-review
 *     recorder makes the very same check.
 *   - WHERE THE BEADS GO. Into the tracker of the repository the pull request belongs to, resolved by
 *     `pr-review-beads-cli.js` `checkTrust`, the PR-review recorder's own trust checks, the very ones it makes: the
 *     host is asked about the pull request (a head on a fork, an unreadable pull request, a head that is
 *     not the pull request's head, a base that is not on the base branch are all REFUSED by name); the
 *     tracker runs in the repository's PRIMARY checkout, never in a linked worktree or clone of the head,
 *     and that checkout must not hold the head; and which tracker to use is read from
 *     `.ensemble/toolchain.yaml` AS COMMITTED AT `baseSha`, never from the tree. The tracker deps are
 *     built with `untrustedProjectRoot: true`: no adapter code is ever loaded from a tree. A caller cannot
 *     name another repository: `repoRoot` is required, never defaulted to the current directory, and the
 *     host's own answer about `repo`/`pr` has to fit it.
 *   - FAILURES ARE REPORTED, NEVER SWALLOWED. A tracker that cannot be read fails the run before any
 *     write (FAILED). One create that fails does not stop the others (PARTIAL, the failure named under
 *     its key), so the next sweep, which finds the rest held, retries only what failed. A repository with
 *     no usable tracker, or an adapter without the capability, is UNAVAILABLE with the `skip-finding-beads`
 *     fallback: nothing was recorded and the caller says so. An entry whose identity cannot be read is
 *     reported under `invalid` (its kind, position and reason, never its text) and counts as an error; it is never dropped silently.
 *   - ONLY CREATES. The sweep never updates, relabels, closes or reopens a bead.
 *   - TEXT IS UNTRUSTED. The facts come from the host (bot comment text, check names): every field that
 *     reaches a bead is cut to one line of bounded length, stripped of control characters and redacted,
 *     and each finished title and description is redacted once more as a whole, because the store is
 *     tracked by git. No text goes into the key, and a value never starts with `-` (the runner refuses it).
 *     The answer is redacted the same way: it is printed, and a tool's message can echo what the facts said.
 *
 * Everything with an effect (git, the host, the tracker) is INJECTED (`io`), so tests need no process.
 */

const trackerFindings = require('./tracker-findings');
const { findUntracked, isId, isCount } = require('./local-ci-sweep');
const { redact } = require('./pr-review-state');

/** The label every bead of a sweep carries; `br list --label merge-sweep` finds them for cleanup. */
const SWEEP_LABEL = 'merge-sweep';
/** What the sweep records, per kind: its label, bead type and priority (0 is the highest). */
const KINDS = Object.freeze({
  finding: Object.freeze({ label: 'bot-finding', type: 'task', priority: 2 }),
  failure: Object.freeze({ label: 'ci-failure', type: 'bug', priority: 1 }),
});

const SUMMARY_MAX = 80;
const BODY_MAX = 600;
const PATH_MAX = 200;
const NAME_MAX = 100;
const AUTHOR_MAX = 60;
const CONCLUSION_MAX = 40;
const URL_MAX = 300;
const SHORT_SHA = 7;
const COMMIT_RE = /^[0-9a-f]{7,40}$/i;
const LINK_RE = /^https?:\/\/[^\s\u0000-\u001f\u007f-\u009f]+$/;
const USERINFO_RE = /^https?:\/\/[^/?#]*@/;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** One line of at most `max` characters, redacted, with no control character (NUL would crash the spawn). Only text and numbers are text. */
function flat(value, max) {
  const text = redact(typeof value === 'string' || typeof value === 'number' ? String(value) : '')
    .replace(CONTROL_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}\u2026` : text;
}

/** A finished title or description, redacted once more as a whole: the last stop before the git-tracked store. */
const clean = (text) => redact(text);

/** A link the facts carry, or null: http(s) only, one token, bounded, with no credentials in it (`user:pass@`). A link is a convenience, never a reason to refuse. */
function linkOf(value) {
  return typeof value === 'string' && value.length <= URL_MAX && LINK_RE.test(value) && !USERINFO_RE.test(value) ? flat(value, URL_MAX) : null;
}

function shaOf(value) {
  return typeof value === 'string' && COMMIT_RE.test(value.trim()) ? value.trim().toLowerCase() : null;
}

function positiveInt(value) {
  return Number.isSafeInteger(value) && value >= 1 ? value : null;
}

function locationOf(entry) {
  const file = flat(entry.path, PATH_MAX);
  if (file === '') return null;
  const line = positiveInt(entry.line);
  return line === null ? file : `${file}:${line}`;
}

function footer(key, context) {
  return [
    `Found while merging ${context.repo} PR #${context.pr} at head ${context.headSha}.`,
    `Dedupe key: ${key} (the bead's external reference: the sweep looks it up and never records the same entry twice).`,
  ];
}

/** The bead of one unresolved bot finding. `entry` is a `findUntracked` result entry (it carries its `key`). */
function findingBead(entry, context) {
  const body = flat(entry.body, BODY_MAX);
  const summary = flat(entry.body, SUMMARY_MAX);
  const url = linkOf(entry.url);
  const location = locationOf(entry);
  const author = flat(entry.author, AUTHOR_MAX);
  const lines = [
    `Unresolved bot finding on pull request #${entry.prNumber}, recorded by the merge sweep (local-ci-cli sweep).`,
    '',
    `Repository: ${context.repo}`,
    `Pull request: #${entry.prNumber}`,
    `Comment: ${entry.commentId}${url === null ? '' : ` (${url})`}`,
    ...(location === null ? [] : [`Location: ${location}`]),
    ...(author === '' ? [] : [`Reported by: ${author}`]),
    ...(body === '' ? [] : [`Finding: ${body}`]),
    '',
    ...footer(entry.key, context),
  ];
  return {
    title: clean(`[bot-finding] PR #${entry.prNumber}: ${summary === '' ? `comment ${entry.commentId}` : summary}`),
    description: clean(lines.join('\n')),
  };
}

/** The bead of one failed hosted-CI run on a landed commit. */
function failureBead(entry, context) {
  const name = flat(entry.name, NAME_MAX);
  const sha = shaOf(entry.sha);
  const url = linkOf(entry.url);
  const pr = positiveInt(entry.prNumber);
  const conclusion = flat(entry.conclusion, CONCLUSION_MAX);
  const lines = [
    `Failed hosted-CI run on a landed commit, recorded by the merge sweep (local-ci-cli sweep).`,
    '',
    `Repository: ${context.repo}`,
    `Check run: ${entry.checkRunId}${url === null ? '' : ` (${url})`}`,
    ...(name === '' ? [] : [`Check: ${name}`]),
    ...(sha === null ? [] : [`Commit: ${sha}`]),
    ...(pr === null ? [] : [`Pull request: #${pr}`]),
    ...(conclusion === '' ? [] : [`Conclusion: ${conclusion}`]),
    '',
    ...footer(entry.key, context),
  ];
  return {
    title: clean(`[ci-failure] ${name === '' ? 'hosted CI' : name} failed${sha === null ? '' : ` on ${sha.slice(0, SHORT_SHA)}`} (check run ${entry.checkRunId})`),
    description: clean(lines.join('\n')),
  };
}

/** What `tracker.createFinding` is given for one entry. */
function beadFor(kind, entry, context) {
  const spec = KINDS[kind];
  const text = kind === 'finding' ? findingBead(entry, context) : failureBead(entry, context);
  return { ...text, type: spec.type, labels: [SWEEP_LABEL, spec.label], priority: spec.priority, key: entry.key };
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function failed(reason, extra) {
  return { ok: false, status: 'FAILED', recorded: false, reason, ...extra };
}

/** No usable tracker (or no such capability): the caller skips the beads and says so. Same answer as the PR-review recorder's. */
function unavailableResult(envelope, extra) {
  const message = envelope.error && envelope.error.message ? envelope.error.message : 'the tracker is unavailable';
  return {
    ok: true,
    status: 'UNAVAILABLE',
    recorded: false,
    fallback: trackerFindings.SKIP_FALLBACK,
    reason: message,
    actions: [],
    beads: {},
    ...extra,
  };
}

/**
 * What the answer says about an entry whose identity cannot be read: which one (kind and position) and why. Never its
 * text: it is host data, and an entry with no usable id can still quote a credential in its body.
 */
function invalidSummary({ kind, entry, index }) {
  const wanted = kind === 'finding' ? ['prNumber', 'commentId'] : ['checkRunId'];
  if (!isObject(entry)) return { kind, index, reason: 'the entry is not an object' };
  const bad = wanted.filter((field) => !(field === 'prNumber' ? isCount(entry[field]) : isId(entry[field])));
  return { kind, index, reason: `no readable ${bad.join(' and ')}: a pull request number is a number or its digits, a comment or check run id a number, its digits or a node id` };
}

/**
 * The answer, from what was decided. Counts cover every entry that was keyed (and the unreadable ones as errors):
 * `create` the beads created (or, in a dry run, planned), `skip` the keys the tracker already held (a deleted bead
 * still holds its key: see `heldWithoutListing`), `error` the ambiguous keys, failed creates and unreadable entries.
 * A sweep with an error is PARTIAL (exit 1), never silently fine; a dry run with one is PLANNED and exits 1 as well.
 */
function outcome({ dryRun, actions, invalid }) {
  const count = (name) => actions.filter((a) => a.action === name && a.ok !== false).length;
  const errors = actions.filter((a) => a.action === 'error' || a.ok === false).length + invalid.length;
  const beads = {};
  for (const a of actions) {
    beads[a.key] = {
      kind: a.kind,
      action: a.ok === false ? 'error' : a.action,
      ...(a.reason === undefined ? {} : { reason: a.reason }),
      ...(a.beadId === undefined ? {} : { beadId: a.beadId }),
      ...(a.status === undefined ? {} : { status: a.status }),
    };
  }
  return {
    ok: errors === 0,
    status: dryRun ? 'PLANNED' : errors === 0 ? 'RECORDED' : 'PARTIAL',
    recorded: !dryRun && errors === 0,
    counts: { create: count('create'), skip: count('skip'), error: errors },
    actions,
    beads,
    invalid: invalid.map(invalidSummary),
  };
}

/**
 * Whether a refused create says the key is ALREADY HELD although the lookup did not list it. br keeps the external
 * reference of a deleted bead (a tombstone `list --all` does not show), so the lookup says "not found" and the create
 * fails with `External reference '<key>' already exists on issue <id>` (exit 7, surfaced as TOOL_FAILED). Only that
 * refusal, naming exactly this entry's key (the quotes keep `...comment9` from matching `...comment99`), counts: any
 * other failure is a failure.
 */
function heldWithoutListing(result, key) {
  const error = isObject(result.error) ? result.error : {};
  return error.code === 'TOOL_FAILED' && typeof error.message === 'string' && error.message.includes(`External reference '${key}' already exists`);
}

// ---------------------------------------------------------------------------
// Look up, decide, create
// ---------------------------------------------------------------------------

/**
 * Record the entries of `facts` the tracker does not hold yet.
 *
 * @param {{findings: object[], failures: object[]}} facts  already-fetched facts (see `local-ci-sweep.js`)
 * @param {{run: Function}} tracker  tracker deps (`createToolchainDeps`, or a fake in tests)
 * @param {{dryRun?: boolean, repo: string, pr: number, headSha: string}} options  `dryRun` looks up and plans,
 *   changes nothing; `repo`, `pr` and `headSha` say what the sweep ran for (they go into each bead's footer)
 * @returns {object} see the file header; `ok:false` is PARTIAL or FAILED
 */
function recordSweep(facts, tracker, options) {
  const { dryRun = false } = options;
  const candidates = findUntracked(facts, []);
  const entries = [
    ...candidates.findings.map((entry) => ({ kind: 'finding', entry })),
    ...candidates.failures.map((entry) => ({ kind: 'failure', entry })),
  ];
  if (entries.length === 0) return outcome({ dryRun, actions: [], invalid: candidates.invalid });

  const listed = trackerFindings.findByKeys(tracker, { keys: entries.map(({ entry }) => entry.key) });
  if (!listed.ok) {
    if (listed.unavailable) return unavailableResult(listed);
    return failed(`tracker lookup failed: ${listed.error && listed.error.message}`, { error: listed.error });
  }

  // Which keys the tracker holds: the sweep's `trackedKeys`. A key held more than once is not tracked cleanly:
  // nothing is created for it, and it is an error to look at.
  const held = new Set();
  const actions = [];
  for (const { kind, entry } of entries) {
    const verdict = listed.byKey[entry.key];
    if (isObject(verdict) && verdict.ok === true && verdict.found === false) continue; // new: created below
    held.add(entry.key);
    if (isObject(verdict) && verdict.ok === true && verdict.found === true) {
      const { id, status } = verdict.item;
      actions.push({ action: 'skip', reason: 'tracked', kind, key: entry.key, ...(id === undefined ? {} : { beadId: id }), ...(status === undefined ? {} : { status }) });
    } else {
      const error = isObject(verdict) && verdict.error ? verdict.error : { code: 'BAD_OUTPUT', message: 'the tracker gave no verdict for this key' };
      actions.push({ action: 'error', reason: 'ambiguous-key', kind, key: entry.key, error });
    }
  }

  const fresh = findUntracked(facts, held);
  const context = { repo: options.repo, pr: options.pr, headSha: options.headSha };
  const planned = [
    ...fresh.findings.map((entry) => ({ kind: 'finding', entry })),
    ...fresh.failures.map((entry) => ({ kind: 'failure', entry })),
  ];

  let unavailable = null;
  let created = 0;
  for (const { kind, entry } of planned) {
    const action = { action: 'create', kind, key: entry.key };
    if (dryRun) {
      actions.push(action);
      continue;
    }
    const result = trackerFindings.createFinding(tracker, beadFor(kind, entry, context));
    if (!result.ok) {
      if (heldWithoutListing(result, entry.key)) {
        actions.push({ action: 'skip', reason: 'held-not-listed', kind, key: entry.key });
        continue;
      }
      if (result.unavailable && unavailable === null) unavailable = result;
      actions.push({ ...action, ok: false, reason: 'create-failed', error: result.error, ...(result.unavailable ? { unavailable: true } : {}) });
      continue;
    }
    created += 1;
    actions.push({ ...action, ok: true, beadId: result.data && result.data.id });
  }

  // Nothing could be written because the tracker lacks the capability: that is "skip the beads", the same
  // answer as a repository with no tracker, not a half-recorded run.
  if (unavailable !== null && created === 0) return unavailableResult(unavailable);
  return outcome({ dryRun, actions, invalid: fresh.invalid });
}

// ---------------------------------------------------------------------------
// The sweep of one pull request's merge
// ---------------------------------------------------------------------------

/**
 * Run the sweep for the pull request being merged: the trust checks, the tracker, `recordSweep`.
 *
 * @param {{facts: object, repoRoot: string, repo: string, pr: number, headSha: string, baseSha: string, dryRun?: boolean}} input
 *   already validated by the CLI (`local-ci-cli.js`): `repoRoot` the repository (a git root or a linked
 *   worktree of it), `repo` its `owner/name`, `pr` and `headSha` the pull request and its head, `baseSha` the
 *   full commit id of its base branch the tracker's configuration is read from
 * @param {{git: Function, readPr: Function, trackerFor: Function, env: object}} io  the effects:
 *   `git(args, {cwd})` (`pr-review-repo.js`'s injected git), `readPr({repo, prNumber})` (the host read),
 *   `trackerFor({projectRoot, env, untrustedProjectRoot, baseConfig})` the tracker deps, and the environment
 * @returns {object} the answer (see the file header); `ok:false` exits 1
 */
function sweep(input, io) {
  const { facts, repoRoot, repo, pr, headSha, baseSha, dryRun = false } = input;

  // With nothing to look up, nothing is asked of git, the host or the tracker.
  const candidates = findUntracked(facts, []);
  if (candidates.findings.length + candidates.failures.length === 0) return outcome({ dryRun, actions: [], invalid: candidates.invalid });

  const { resolveProjectRootFlag } = require('./toolchain-cli');
  const resolved = resolveProjectRootFlag(repoRoot);
  if (resolved.error) return failed(resolved.error.message);

  // The binding of the checkout to `repo` (its PRIMARY checkout's `origin`, every fetch and push URL) is `checkTrust`'s first
  // step, before the host or the tracker is asked: the same one the PR-review recorder makes, in `pr-review-repo.js`.

  const { checkTrust } = require('./pr-review-beads-cli');
  const trust = checkTrust({ input: { repo, prNumber: pr, headSha }, repoRoot: resolved.projectRoot, baseSha, git: io.git, readPr: io.readPr });
  if (!trust.ok) return trust.result;

  const tracker = io.trackerFor({
    projectRoot: trust.trackerRoot,
    env: io.env,
    // The tree under review is never a source of the adapter, of the tracker choice or of the tracker's state.
    untrustedProjectRoot: true,
    baseConfig: trust.baseConfig,
  });
  return recordSweep(facts, tracker, { dryRun, repo, pr, headSha });
}

/** The answer is printed, and it carries tool messages and reasons that can echo what the facts said: redact it like the beads. */
const answered = (fn) => (...args) => redact(fn(...args));

module.exports = { sweep: answered(sweep), recordSweep: answered(recordSweep), beadFor, SWEEP_LABEL, KINDS };
