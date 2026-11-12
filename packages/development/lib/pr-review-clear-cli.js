#!/usr/bin/env node
'use strict';

/**
 * pr-review-clear-cli.js -- derive `cleared` marks for a PR-review ledger from real git
 * (kata n350, AC-008-3).
 *
 * JSON in on stdin, one JSON object out on stdout. This is NOT a subcommand of
 * pr-review-cli.js: that CLI is pure (no shell, no file reads); this one reads git.
 * It only DERIVES marks. It never decides, resolves or closes anything, never writes a
 * file, ref or index, and never touches the tracker: the caller hands the returned ledger
 * on, and the bead recorder closes a bead only for an entry that carries a mark.
 *
 * Usage: node pr-review-clear-cli.js < payload.json
 *
 * payload { repoRoot, baseSha, headSha, lastReviewedSha?, ledger[], incoming[] }
 *   repoRoot  REQUIRED git repository (or linked-worktree) root; no default to the cwd
 *   baseSha, headSha  REQUIRED full object ids; the head must descend from the base
 *   lastReviewedSha  the head the PRIOR round reviewed (the `reviewedHeadSha` its state report
 *             recorded: the value `review-range` is given). Every entry carried from that report
 *             was alive then, so what changed since is all that can have fixed it. It has to be ON THE
 *             PR: one a force-push replaced keeps every entry (`recorded-head-not-on-pr`), stamped or
 *             not. Without it an entry's own `headSha` (when it has one) is the baseline: when the finding
 *             was first raised, a longer span that also counts an edit the finding survived. An entry this
 *             verb already moved (`locationAsOf`) is compared from that head instead, unless
 *             `lastReviewedSha` is a LATER head (the verb skipped a round): then that is the baseline
 *   ledger    REQUIRED entries recorded in earlier rounds, as the previous run of this verb returned them
 *   incoming  REQUIRED, EVERY finding the review of `headSha` presented, whatever its verdict (the `votes` result's
 *             `findings`: present, disputed, unverified and filtered alike), `[]` when it presented none. It is never
 *             defaulted: without it a re-raised finding could not be told from a fixed one, and every finding whose
 *             line was touched would be cleared; a finding left out of it reads the same way
 * result
 *   DERIVED (exit 0)  { ok, status, headSha, ledger[], cleared[{ id, clearedBy, recordedAt }],
 *                       kept[{ id, reason }] }
 *   FAILED  (exit 1)  { ok:false, status, reason }: bad input, head or base not commits of
 *                     this repository, head not descending from base. Nothing partial.
 *
 * The rule (what `clearFixedFindings` implements, with its facts read from git). For each
 * entry, in input order, the first match wins:
 *   1. `cleared === true` already            -> already-cleared (as given)
 *   2. the entry was raised at this very head (own `headSha`), or its baseline is this head (the same
 *      head reviewed again, nothing changed since)  -> recorded-at-this-head (as given)
 *   3. its line is already in this head's numbering (`locationAsOf` is this head) -> location-current
 *      (as given: this is what makes a second run over the verb's own output change nothing)
 *   4. no baseline: no `locationAsOf`, no `lastReviewedSha` and no own `headSha` that is a commit
 *      -> no-recorded-head (as given)
 *   5. `lastReviewedSha`, when given, not ON THE PR, or the baseline (`lastReviewedSha` when it is later than the
 *      `locationAsOf` stamp, else the stamp, else `lastReviewedSha`, else the own head) not ON THE PR
 *      -> recorded-head-not-on-pr (as given; an ancestor of head, not of base: a force-pushed old
 *      head is no longer an ancestor, and neither is a head the repository no longer holds, a `locationAsOf`
 *      included: the numbering it vouched for is gone. A `lastReviewedSha` off the PR keeps EVERY entry
 *      that needs a comparison, whatever stamp it carries: a stamp says where the line is, not that the
 *      finding was alive at the head the prior round reviewed)
 *   6. re-reported at this head              -> re-reported: `incoming` holds the same
 *      `fingerprintFinding` identity (the LINE is not part of it, so a defect re-reported
 *      lower after the file shifted still counts), or, when either side has no fingerprint,
 *      the same exact `locationOrLink` + `failureMode`. The entry takes the location the new
 *      review gave it
 *   7. cites no file                         -> no-location (as given)
 *   8. `git diff` of the cited file from the baseline to this head cannot be read
 *      -> diff-failed (as given); the cited line (or, for a file-only citation, any line) is
 *      untouched -> location-unchanged: the line is moved to this head's numbering.
 *      TOUCHED means a cited line was modified or removed, or new lines were put BETWEEN two cited lines (kata bh8w): a
 *      pure-insertion hunk (`git diff -U0`: `@@ -587,0 +588,5 @@` is five lines after old line 587) is inside the range
 *      583-601, and a fix that only adds an assertion, a guard or a fixture there changes no old line but does change what
 *      the entry cites. The rule: with `a` the old line the insertion follows, it is inside `s-e` when `s <= a < e`, with at
 *      least one cited line on each side. New lines before the first cited line (`a = s - 1`) or after the last (`a = e`)
 *      are outside it, and a one-line citation has no inside: they only move the line, because the verb cannot tell a fix
 *      from unrelated code next to the finding and clearing on adjacency would hide findings (the re-review raising the
 *      finding again is the safety net). A file-only citation has no range to be inside of: as before, only a modified or
 *      removed line of that file (or a replaced file) touches it, so a fix that only adds lines to a file cited without a
 *      line is not seen (a stated limit).
 *   9. touched, but git's rename detection (`-M`, 50% similarity) says the cited FILE was renamed
 *      -> location-unanchored (as given): the defect went with the file to a path this entry does not
 *      name, and the verb does not guess it. A review that raises it under the new path adds an entry
 *      of its own (the ledger's identity includes the path), so a person decides the old one
 *  10. otherwise CLEARED: the original entry plus `cleared`, `clearedBy` (the full head id)
 *      and `clearedReason` as `clearFixedFindings` produced them (`not-cleared` if it
 *      declines).
 *
 * Carrying the line forward. An entry cites the line it had when it was first recorded, and a delta
 * review only re-raises what it sees, so a finding that sat below an edit would be looked up at a
 * stale line the next time and a fix made there missed. Every entry this verb keeps in rules 6 and 8
 * therefore comes back with its `file:line` (or `file:a-b`) in THIS head's numbering (the `git diff`
 * hunks from its baseline to this head move it; a re-raised one takes the new review's location) and
 * `locationAsOf: <this head>`. The next run compares from that stamp. Run the verb at every head, in
 * order. An entry's line number belongs to the head the verb last moved it to (its stamp) or, if it never
 * moved it, to the head it was raised at (its own `headSha`); that head has to LEAD to the baseline, and the
 * line is first moved from it to the baseline (those edits only move it: the finding was alive at the
 * baseline, so they cannot have fixed it). That is what happens when the verb arrives mid-review and when a
 * round is skipped (the stamp is then older than `lastReviewedSha`, the head the skipped round reviewed).
 * When that diff touched the line or replaced the file, or the number's head does not lead to the baseline
 * (a force-push replaced it, or the repository no longer holds it), its place is unknown ->
 * location-unanchored (as given, not stamped, never cleared; a review that raises it again re-anchors it).
 * A mode-only change (chmod) touches no line; deleting, creating or replacing a file with binary content does,
 * and so does a rename (rule 9 then keeps the entry). A file deleted outright, or replaced by one too
 * dissimilar for git to pair, is a deletion, not a rename. In that earlier span (the line is moved to the baseline) lines
 * inserted between two cited lines grow the range, as before: the finding was alive after them.
 * The output ledger has the input's length and order; a second run over its own output changes
 * nothing; the input is never mutated.
 *
 * Honest limits: a changed location is the AC-008-3 heuristic, not proof the defect is
 * gone; the re-review not raising it again is the other half. An insertion between two cited lines counts like a modified
 * one (kata bh8w), so it clears the entry although the added lines need not be the fix: a cleared entry was never verified
 * as fixed, only seen to change, and a finding in code the push merely grew stays cleared until a review raises it again.
 * This verb is the only writer of `cleared` in the procedure (`carry reconcile` writes none), so a force-push that rewrites the
 * recorded head, or a `lastReviewedSha` that is not on the PR, clears nothing: such a bead stays
 * open and a person closes it. A mark written by hand is outside this verb.
 */

const fs = require('fs');
const { isObjectId } = require('./pr-review-scope');
const { redact } = require('./pr-review-state');
const { clearFixedFindings, fingerprintFinding, fingerprintPath } = require('./pr-review-ledger');
const repo = require('./pr-review-repo');
const runtime = require('./review-record-runtime');

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';

function failed(reason) {
  return { ok: false, status: 'FAILED', reason };
}

const SINGLE_LINE = /^(.+?):(\d+)(?::(\d+))?$/;
const LINE_RANGE = /^(.+?):(\d+)\s*[-\u2013]\s*(\d+)$/;

/** `file:12`, `file:12:5` or `file:12-20` as `{ file, start, end, column }` (`end`/`column` null when absent), else `null`. */
function citation(entry) {
  const text = typeof entry.locationOrLink === 'string' ? entry.locationOrLink.trim() : '';
  const single = SINGLE_LINE.exec(text);
  if (single !== null) return { file: single[1], start: Number(single[2]), end: null, column: single[3] === undefined ? null : single[3] };
  const range = LINE_RANGE.exec(text);
  if (range !== null && Number(range[3]) >= Number(range[2])) {
    return { file: range[1], start: Number(range[2]), end: Number(range[3]), column: null };
  }
  return null;
}

/** The cited file and lines of an entry: `{ file, line, endLine }`, `{ file, line: null }` (a file with no line) or `null`. */
function citedFile(entry) {
  const parsed = citation(entry);
  if (parsed !== null) return { file: parsed.file, line: parsed.start, endLine: parsed.end === null ? parsed.start : parsed.end };
  const file = fingerprintPath(entry);
  return file === null ? null : { file, line: null, endLine: null };
}

/** The finding of `incoming` that is the same defect as `entry`, or `null`. */
function reRaisedBy(entry, incoming) {
  const own = fingerprintFinding(entry);
  const match = incoming.find((other) => {
    const theirs = fingerprintFinding(other);
    if (own !== null && theirs !== null) return own === theirs;
    return other.locationOrLink === entry.locationOrLink && other.failureMode === entry.failureMode;
  });
  return match === undefined ? null : match;
}

/** The entry's citation with its line (or `a-b` range) moved through `hunks`, or `null` when it names no line to move. */
function movedLocation(entry, hunks) {
  const parsed = citation(entry);
  if (parsed === null) return null;
  const first = repo.advanceLine(hunks, parsed.start);
  if (first.touched) return null;
  if (parsed.end === null) return `${parsed.file}:${first.line}${parsed.column === null ? '' : `:${parsed.column}`}`;
  const last = repo.advanceLine(hunks, parsed.end);
  return `${parsed.file}:${first.line}-${last.touched ? first.line + (parsed.end - parsed.start) : last.line}`;
}

const INCOMING_REQUIRED =
  "'incoming' is required: every finding the review of this head presented, whatever its verdict, an array of objects ([] when it presented none). It is never defaulted: without it a re-raised finding cannot be told from a fixed one and every finding whose line was touched would be cleared";

/**
 * @param {{git?:Function, cwd:string, baseSha:string, headSha:string, lastReviewedSha?:string, ledger:Object[], incoming:Object[], now?:Function}} input
 * @returns {Object} the DERIVED or FAILED result
 */
function deriveCleared(input) {
  const { cwd, baseSha, headSha, ledger } = input;
  const git = input.git || runtime.defaultGit();
  const now = input.now || Date.now;
  if (!Array.isArray(input.incoming) || !input.incoming.every(isObject)) return failed(INCOMING_REQUIRED);
  const incoming = input.incoming;

  const head = repo.resolveCommit(git, cwd, headSha);
  if (head === null || head !== headSha.toLowerCase()) return failed('headSha is not a commit of this repository');
  const base = repo.resolveCommit(git, cwd, baseSha);
  if (base === null || base !== baseSha.toLowerCase()) return failed('baseSha is not a commit of this repository');
  const descends = repo.isAncestor(git, cwd, base, head);
  if (descends === null) return failed('could not tell whether headSha descends from baseSha');
  if (descends === false) return failed('headSha does not descend from baseSha');

  // The prior round's reviewed head, when the caller has it: the baseline entries without a stamp share. It has to be ON THE
  // PR (an ancestor of head, not of base). One a force-push replaced, or this repository no longer holds (that resolves to
  // null), can no longer say what changed since, and no stamp brings that back: a stamp says where the LINE is, not that the
  // finding was alive at the head the prior round reviewed. Every entry that needs a comparison is kept (below).
  const shared = input.lastReviewedSha === undefined ? undefined : repo.resolveCommit(git, cwd, input.lastReviewedSha);
  const sharedOffPr = shared !== undefined && (shared === null || !repo.commitOnPr(git, cwd, { commit: shared, headSha: head, baseSha: base }).ok);

  const recordedAt = new Date(now()).toISOString();
  const cleared = [];
  const kept = [];
  const keep = (entry, reason) => {
    kept.push({ id: entry.id, reason });
    return entry;
  };
  /** Kept, with its location in this head's numbering and the stamp that says so. */
  const keepMoved = (entry, reason, locationOrLink) => {
    kept.push({ id: entry.id, reason });
    return { ...entry, locationOrLink, locationAsOf: head };
  };

  // Git's rename pairs from a baseline to this head, asked once per baseline: the whole-tree diff is the same for every entry.
  const renameCache = new Map();
  const renamesSince = (from) => {
    if (!renameCache.has(from)) renameCache.set(from, repo.renamedPaths(git, cwd, { from, to: head }));
    return renameCache.get(from);
  };

  const out = ledger.map((entry) => {
    if (entry.cleared === true) return keep(entry, 'already-cleared');
    const own = typeof entry.headSha === 'string' ? repo.resolveCommit(git, cwd, entry.headSha) : null;
    if (own === head) return keep(entry, 'recorded-at-this-head');
    const stamped = typeof entry.locationAsOf === 'string' ? repo.resolveCommit(git, cwd, entry.locationAsOf) : null;
    if (stamped === head) return keep(entry, 'location-current');
    // A stamp this repository no longer holds (a force-push replaced that head): the numbering it vouched for is gone.
    if (typeof entry.locationAsOf === 'string' && stamped === null) return keep(entry, 'recorded-head-not-on-pr');
    if (sharedOffPr) return keep(entry, 'recorded-head-not-on-pr');
    // A stamp older than lastReviewedSha means the verb did not run at the prior round's head (a skipped round). The
    // finding was alive at that head, so THAT is the baseline, and the line is first moved from the stamp to it (below).
    const lagging = stamped !== null && shared !== undefined && shared !== stamped && repo.isAncestor(git, cwd, stamped, shared) === true;
    const recorded = lagging ? shared : stamped !== null ? stamped : shared === undefined ? own : shared;
    if (recorded === null) return keep(entry, 'no-recorded-head');
    if (recorded === head) return keep(entry, 'recorded-at-this-head');
    if (!repo.commitOnPr(git, cwd, { commit: recorded, headSha: head, baseSha: base }).ok) {
      return keep(entry, 'recorded-head-not-on-pr');
    }
    const raised = reRaisedBy(entry, incoming);
    if (raised !== null) {
      const hasLocation = typeof raised.locationOrLink === 'string' && raised.locationOrLink.trim() !== '';
      return keepMoved(entry, 're-reported', hasLocation ? raised.locationOrLink : entry.locationOrLink);
    }
    // The head this entry's line number belongs to: the stamp when the verb moved it, else the head it was raised at
    // (its own `headSha`). An entry that names neither is taken to be numbered at the baseline. When the number's head is
    // not the baseline -- the verb arrived mid-review, or skipped a round -- that head has to lead to the baseline and
    // the line is first brought to it: the edits in between only MOVE it (the finding was alive at the baseline, so
    // they cannot have fixed it). A head that does not lead there -- a force-push replaced it, or the repository no
    // longer holds it -- makes the number meaningless in this diff, and an edit that touched the line leaves its place
    // unknown: kept, never cleared on a guess.
    let numbered = entry;
    const raisedAtAHead = entry.headSha !== undefined && entry.headSha !== null && String(entry.headSha).trim() !== '';
    const numberedAt = typeof entry.locationAsOf === 'string' ? stamped : raisedAtAHead ? own : undefined;
    if (numberedAt !== undefined && numberedAt !== recorded) {
      // (`isAncestor` answers null for a head the repository does not hold: that does not lead there either.)
      if (repo.isAncestor(git, cwd, numberedAt, recorded) !== true) return keep(entry, 'location-unanchored');
      const early = citation(entry);
      if (early !== null) {
        const before = repo.changedOldLines(git, cwd, { from: numberedAt, to: recorded, file: early.file });
        if (!before.ok) return keep(entry, 'diff-failed');
        const where = before.hunks === null ? null : movedLocation(entry, before.hunks);
        if (where === null) return keep(entry, 'location-unanchored');
        numbered = { ...entry, locationOrLink: where };
      }
    }

    const cited = citedFile(numbered);
    if (cited === null) return keep(entry, 'no-location');

    const changed = repo.changedOldLines(git, cwd, { from: recorded, to: head, file: cited.file });
    if (!changed.ok) return keep(entry, 'diff-failed');
    const { lines, hunks } = changed;
    // Touched: a cited line was modified or removed, or new lines were put BETWEEN two cited lines. A fix that only ADDS lines (a
    // missing assertion, a guard, a second fixture inside the cited block) changes no old line, so it never touched the range by
    // the old lines alone (kata bh8w: a fixed Important stayed open). New lines before the first cited line, after the last one or
    // beside a one-line citation do not touch it (they only move it): `insertsWithin` states the boundary. A citation with no line
    // has no range to be inside of: as before, only a modified or removed line of the file (or a replaced file) touches it.
    const touched =
      cited.line === null
        ? lines === null || lines.length > 0
        : lines === null || lines.some((n) => n >= cited.line && n <= cited.endLine) || repo.insertsWithin(hunks, cited.line, cited.endLine);
    if (!touched) {
      // No line was touched, but a path the head does not hold (renamed or deleted before the baseline, so the diff since is empty) has no
      // line that stayed put: the finding cannot be placed in this head. Kept as recorded, never located (kata p5dt).
      const atHead = repo.readBlobAt(git, cwd, head, cited.file);
      if (!atHead.ok) return keep(entry, 'diff-failed');
      if (atHead.text === null) return keep(entry, 'location-unanchored');
      const moved = cited.line === null ? null : movedLocation(numbered, changed.hunks);
      return moved === null ? keep(entry, 'location-unchanged') : keepMoved(entry, 'location-unchanged', moved);
    }

    // The path is gone, but `--no-renames` reads a RENAME as a deletion. When git pairs the path with a created file
    // the defect went along with it, to a path this entry does not name; the verb does not guess where, so the entry
    // is kept, never cleared. (A review that raises it under the new path adds an entry of its own.)
    const renames = renamesSince(recorded);
    if (!renames.ok) return keep(entry, 'diff-failed');
    if (renames.moves.has(cited.file)) return keep(entry, 'location-unanchored');

    const decision = clearFixedFindings({
      ledger: [numbered],
      changedLocations: [{ path: cited.file, lines }],
      headSha: head,
      reReported: []
    });
    const mark = decision.ok === true ? decision.findings[0] : null;
    if (mark === null || mark.cleared !== true) return keep(entry, 'not-cleared');
    cleared.push({ id: entry.id, clearedBy: mark.clearedBy, recordedAt });
    return { ...entry, cleared: mark.cleared, clearedBy: mark.clearedBy, clearedReason: mark.clearedReason };
  });

  return { ok: true, status: 'DERIVED', headSha: head, ledger: out, cleared, kept };
}

/**
 * @param {Object} [io]  `{ readJson, emit, now, git }`, replaced by tests.
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

  const { repoRoot, baseSha, headSha, lastReviewedSha, ledger, incoming } = payload;
  if (!isText(repoRoot)) return finish(failed("'repoRoot' must be a non-empty path"));
  if (!isObjectId(baseSha)) return finish(failed("'baseSha' must be a full object id"));
  if (!isObjectId(headSha)) return finish(failed("'headSha' must be a full object id"));
  if (lastReviewedSha !== undefined && !isObjectId(lastReviewedSha)) {
    return finish(failed("'lastReviewedSha' must be a full object id when given"));
  }
  if (!Array.isArray(ledger) || !ledger.every(isObject)) return finish(failed("'ledger' must be an array of objects"));
  if (!Array.isArray(incoming) || !incoming.every(isObject)) return finish(failed(INCOMING_REQUIRED));

  const { resolveProjectRootFlag } = require('./toolchain-cli');
  const resolved = resolveProjectRootFlag(repoRoot);
  if (resolved.error) return finish(failed(resolved.error.message));

  return finish(
    deriveCleared({
      git: io.git || runtime.defaultGit(),
      cwd: resolved.projectRoot,
      baseSha,
      headSha,
      lastReviewedSha,
      ledger,
      incoming,
      now
    })
  );
}

module.exports = { main, deriveCleared };

if (require.main === module) process.exit(main());
