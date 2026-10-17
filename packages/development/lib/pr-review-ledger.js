'use strict';

/**
 * Finding ledger validation, actionability classification, deduplication,
 * head-scoped merge and scope-violation detection for the PR-review cycle.
 *
 * NO side effects, NO shell, NO network calls. Pure functions over plain
 * finding objects shaped as:
 *   { id, source, locationOrLink, severity, failureMode, disposition,
 *     evidence, originalTextOrLink, unresolvedThread?, uncertain?, reason?,
 *     headSha?, file? }
 *
 * FAIL CLOSED. A missing, non-array or ill-typed input is never read as "an
 * empty ledger" or "nothing to see": validateLedger answers
 * `{ ok: false, reason, offendingIds: [] }`, dedupeFindings, mergeFindings and
 * scopeViolations answer `{ ok: false, reason }` in place of their array (so a
 * caller can tell the two apart with Array.isArray), and a finding that cannot
 * be read is treated as actionable by isActionable -- it can never be waved
 * through.
 */

const REQUIRED_FIELDS = [
  'id',
  'source',
  'locationOrLink',
  'severity',
  'failureMode',
  'disposition',
  'evidence',
  'originalTextOrLink',
];

/** Optional flags that, when present, must be real booleans. */
const FLAGS = ['unresolvedThread', 'uncertain'];

const VALID_DISPOSITIONS = new Set(['fix', 'duplicate', 'not-applicable', 'deferred', 'adjudicate']);
const ACTIONABLE_SEVERITIES = new Set(['critical', 'major']);
const DEFERRABLE_SEVERITIES = new Set(['minor', 'nitpick']);

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Text with something in it: a string that is not blank. Numbers, booleans and containers are not text. */
function isText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/** `Array.from` first, so a hole in a sparse array is an undefined entry rather than a skipped one. */
function everyEntry(list, predicate) {
  return Array.from(list).every(predicate);
}

function rejection(reason) {
  return { ok: false, reason };
}

/**
 * A finding is usable only when it is an object whose required fields are all
 * text (the id may also be a finite number), whose disposition is drawn from
 * the allowed set, and whose optional flags, when present, are booleans.
 */
function isUsableFinding(finding) {
  if (!isObject(finding)) return false;
  for (const field of REQUIRED_FIELDS) {
    const value = finding[field];
    const usable = field === 'id' ? isText(value) || Number.isFinite(value) : isText(value);
    if (!usable) return false;
  }
  if (!VALID_DISPOSITIONS.has(finding.disposition)) return false;
  return FLAGS.every((flag) => finding[flag] === undefined || typeof finding[flag] === 'boolean');
}

/**
 * Every finding must carry id, source, location-or-link, severity, failure
 * mode, a disposition drawn from the allowed set, evidence, and original
 * text or link -- else it is rejected with the offending ids. Anything but an
 * array of findings is rejected outright.
 */
function validateLedger(findings) {
  if (!Array.isArray(findings)) return { ok: false, reason: 'findings must be an array', offendingIds: [] };
  const offendingIds = [];
  for (const finding of Array.from(findings)) {
    if (!isUsableFinding(finding)) offendingIds.push(isObject(finding) ? finding.id : null);
  }
  return { ok: offendingIds.length === 0, offendingIds };
}

/** A flag that is neither absent nor exactly false: true, but also "true", 1, null, {} -- none can be read as "no". */
function isUnsettled(flag) {
  return flag !== undefined && flag !== false;
}

/**
 * Any unresolved thread or Critical/Major finding is actionable. A
 * Minor/nitpick finding may be `deferred` only with a recorded disposition
 * and a reason (text, not blank). An uncertain finding is marked `adjudicate`
 * and is never dropped: it is never `deferred`, so it stays actionable.
 *
 * Fail closed: only one shape of finding is not actionable -- a recognised
 * Minor/nitpick severity, deferred with a text reason, with no open thread and
 * no uncertainty. Everything else, a finding that is not an object, an
 * unrecognised severity, a flag that is not exactly false or absent included,
 * is actionable.
 */
function isActionable(finding) {
  if (!isObject(finding)) return true;
  if (isUnsettled(finding.unresolvedThread) || isUnsettled(finding.uncertain)) return true;

  const severity = typeof finding.severity === 'string' ? finding.severity.toLowerCase() : '';
  if (ACTIONABLE_SEVERITIES.has(severity)) return true;
  if (DEFERRABLE_SEVERITIES.has(severity)) {
    const deferredWithReason = finding.disposition === 'deferred' && isText(finding.reason);
    return !deferredWithReason;
  }
  return true;
}

function dedupeKey(finding) {
  return `${finding.locationOrLink || ''}::${finding.failureMode || ''}`;
}

const SEVERITY_RANK = { critical: 3, major: 2, minor: 1, nitpick: 0 };
// isActionable treats a missing or unrecognised severity as actionable, so it ranks with Major, not below Minor.
const UNRECOGNISED_SEVERITY_RANK = SEVERITY_RANK.major;

function severityRank(finding) {
  const severity = String((finding && finding.severity) || '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(SEVERITY_RANK, severity)
    ? SEVERITY_RANK[severity]
    : UNRECOGNISED_SEVERITY_RANK;
}

/** The head a finding was recorded on, or undefined when it carries none (absent, null or blank). */
function headOf(finding) {
  return hasValue(finding && finding.headSha) ? finding.headSha : undefined;
}

/**
 * The member a duplicate group collapses onto: an actionable member beats a
 * non-actionable one, then the more severe wins, then the first seen. The
 * collapsed entry is therefore actionable whenever any member is -- a
 * deferred Minor can never hide a Critical, whichever of them comes first.
 */
function collapseBase(group) {
  let base = group[0];
  let baseActionable = isActionable(base);
  for (let index = 1; index < group.length; index += 1) {
    const candidate = group[index];
    const candidateActionable = isActionable(candidate);
    const outranks =
      candidateActionable !== baseActionable ? candidateActionable : severityRank(candidate) > severityRank(base);
    if (outranks) {
      base = candidate;
      baseActionable = candidateActionable;
    }
  }
  return base;
}

/**
 * Duplicate findings (same location + failure mode) share one fix id and
 * keep every original link. The group collapses onto its most severe
 * actionable member (see collapseBase), and an actionable entry never keeps a
 * `deferred` disposition.
 *
 * @returns {Object[]|{ok:false, reason:string}}  The findings, or a rejection when `findings` is not an array of objects.
 */
function dedupeFindings(findings) {
  if (!Array.isArray(findings)) return rejection('findings must be an array');
  if (!everyEntry(findings, isObject)) return rejection('findings must contain only objects');

  const groups = new Map();
  for (const finding of findings) {
    const key = dedupeKey(finding);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(finding);
  }

  const result = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }
    const fixId = group.find((f) => f.fixId)?.fixId || group[0].id;
    const originalLinks = group
      .map((f) => f.originalTextOrLink)
      .filter((link) => hasValue(link));
    const collapsed = { ...collapseBase(group), fixId, originalLinks };
    if (collapsed.disposition === 'deferred' && isActionable(collapsed)) {
      collapsed.disposition = collapsed.uncertain === true ? 'adjudicate' : 'fix';
    }
    result.push(collapsed);
  }
  return result;
}

/**
 * Whether an incoming finding replaces the existing entry for the same key.
 *   - The existing entry was recorded on a different head: its disposition
 *     says nothing about the current head, so the finding is re-opened.
 *   - The incoming finding is more severe, or is actionable where the
 *     existing entry is not (e.g. a deferred Minor now raised as an open
 *     thread): the more cautious record wins.
 * An unchanged re-observation for the same head keeps its disposition.
 */
function supersedes(existing, incoming, headSha) {
  const currentHead = hasValue(headSha) ? headSha : headOf(incoming);
  const existingHead = headOf(existing);
  if (existingHead !== undefined && currentHead !== undefined && existingHead !== currentHead) return true;
  return severityRank(incoming) > severityRank(existing) || (isActionable(incoming) && !isActionable(existing));
}

/** A recorded head that is present but is not text: neither a head nor "no head". Null and blank mean no head. */
function hasForeignHead(finding) {
  return finding.headSha !== undefined && finding.headSha !== null && typeof finding.headSha !== 'string';
}

/**
 * Merge newly observed findings into an existing, already-dispositioned
 * ledger for a given head. An already-dispositioned finding for the same
 * head is not re-opened unless the new observation escalates it (more
 * severe, or actionable where the entry was not); an entry recorded on a
 * different head is re-opened. Genuinely new findings are added.
 *
 * Both lists must be arrays of objects -- an absent ledger is `[]`, said so --
 * and `headSha`, when given, must be text. A rejection is returned instead of
 * a merge, so findings are never silently dropped by a misspelt argument.
 *
 * @returns {Object[]|{ok:false, reason:string}}
 */
function mergeFindings(existingLedger, incomingFindings, headSha) {
  if (!Array.isArray(existingLedger)) return rejection('existingLedger must be an array');
  if (!Array.isArray(incomingFindings)) return rejection('incomingFindings must be an array');
  if (headSha !== undefined && !isText(headSha)) return rejection('headSha must be a non-empty string when given');
  if (!everyEntry(existingLedger, isObject) || !everyEntry(incomingFindings, isObject)) {
    return rejection('ledger entries must be objects');
  }
  if (existingLedger.some(hasForeignHead) || incomingFindings.some(hasForeignHead)) {
    return rejection('a finding headSha must be a string');
  }

  const merged = existingLedger.slice();
  const indexByKey = new Map();
  merged.forEach((finding, index) => indexByKey.set(dedupeKey(finding), index));

  for (const finding of incomingFindings) {
    const incomingHead = headOf(finding);
    if (incomingHead !== undefined && hasValue(headSha) && incomingHead !== headSha) continue;
    const key = dedupeKey(finding);
    if (!indexByKey.has(key)) {
      indexByKey.set(key, merged.length);
      merged.push(finding);
    } else if (supersedes(merged[indexByKey.get(key)], finding, headSha)) {
      merged[indexByKey.get(key)] = finding;
    }
  }
  return merged;
}

/** The file a ledger entry covers: its own `file`, else the file part of its location. Only text counts. */
function coveredFile(entry) {
  if (isText(entry.file)) return entry.file;
  return isText(entry.locationOrLink) ? entry.locationOrLink.split(':')[0] : undefined;
}

/**
 * Each changed file outside the declared scope without a corresponding
 * ledger entry is returned as a violation. All three arguments are required:
 * `changedFiles` and `scope` arrays of file names, `ledger` an array of
 * finding objects. Anything else is rejected rather than read as "nothing
 * changed" or "everything is in scope".
 *
 * @returns {string[]|{ok:false, reason:string}}
 */
function scopeViolations(changedFiles, scope, ledger) {
  if (!Array.isArray(changedFiles)) return rejection('changedFiles must be an array');
  if (!Array.isArray(scope)) return rejection('scope must be an array');
  if (!Array.isArray(ledger)) return rejection('ledger must be an array');
  if (!everyEntry(changedFiles, isText)) return rejection('changedFiles must contain only non-empty strings');
  if (!everyEntry(scope, isText)) return rejection('scope must contain only non-empty strings');
  if (!everyEntry(ledger, isObject)) return rejection('ledger must contain only objects');

  const allowed = new Set(scope);
  const covered = new Set();
  for (const entry of ledger) {
    const file = coveredFile(entry);
    if (file !== undefined && file.trim() !== '') covered.add(file);
  }

  return changedFiles.filter((file) => !allowed.has(file) && !covered.has(file));
}

module.exports = { validateLedger, isActionable, dedupeFindings, mergeFindings, scopeViolations };
