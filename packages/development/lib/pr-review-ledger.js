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

const VALID_DISPOSITIONS = new Set(['fix', 'duplicate', 'not-applicable', 'deferred', 'adjudicate']);
const ACTIONABLE_SEVERITIES = new Set(['critical', 'major']);
const DEFERRABLE_SEVERITIES = new Set(['minor', 'nitpick']);

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

/**
 * Every finding must carry id, source, location-or-link, severity, failure
 * mode, a disposition drawn from the allowed set, evidence, and original
 * text or link -- else it is rejected with the offending ids.
 */
function validateLedger(findings) {
  const list = Array.isArray(findings) ? findings : [];
  const offendingIds = [];
  for (const finding of list) {
    const missingRequired = REQUIRED_FIELDS.some((field) => !hasValue(finding && finding[field]));
    const badDisposition = finding && hasValue(finding.disposition) && !VALID_DISPOSITIONS.has(finding.disposition);
    if (missingRequired || badDisposition) {
      offendingIds.push(finding && finding.id);
    }
  }
  return { ok: offendingIds.length === 0, offendingIds };
}

/**
 * Any unresolved thread or Critical/Major finding is actionable. A
 * Minor/nitpick finding may be `deferred` only with a recorded disposition
 * and reason. An uncertain finding is marked `adjudicate` and is never
 * dropped (stays actionable).
 */
function isActionable(finding) {
  if (!finding) return false;
  if (finding.unresolvedThread === true) return true;
  if (finding.uncertain === true || finding.disposition === 'adjudicate') return true;

  const severity = String(finding.severity || '').toLowerCase();
  if (ACTIONABLE_SEVERITIES.has(severity)) return true;
  if (DEFERRABLE_SEVERITIES.has(severity)) {
    const deferredWithReason = finding.disposition === 'deferred' && hasValue(finding.reason);
    return !deferredWithReason;
  }
  return true;
}

function dedupeKey(finding) {
  return `${finding.locationOrLink || ''}::${finding.failureMode || ''}`;
}

/**
 * Duplicate findings (same location + failure mode) share one fix id and
 * keep every original link.
 */
function dedupeFindings(findings) {
  const list = Array.isArray(findings) ? findings : [];
  const groups = new Map();
  for (const finding of list) {
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
    result.push({ ...group[0], fixId, originalLinks });
  }
  return result;
}

/**
 * Merge newly observed findings into an existing, already-dispositioned
 * ledger for a given head. An already-dispositioned finding for the same
 * head is not re-opened; only genuinely new findings are added.
 */
function mergeFindings(existingLedger, incomingFindings, headSha) {
  const existing = Array.isArray(existingLedger) ? existingLedger : [];
  const incoming = Array.isArray(incomingFindings) ? incomingFindings : [];

  const byKey = new Map();
  for (const finding of existing) {
    byKey.set(dedupeKey(finding), finding);
  }

  const merged = existing.slice();
  for (const finding of incoming) {
    if (finding.headSha !== undefined && headSha !== undefined && finding.headSha !== headSha) continue;
    const key = dedupeKey(finding);
    if (byKey.has(key)) continue; // already dispositioned for this head -- not re-opened
    byKey.set(key, finding);
    merged.push(finding);
  }
  return merged;
}

/**
 * Each changed file outside the declared scope without a corresponding
 * ledger entry is returned as a violation.
 */
function scopeViolations(changedFiles, scope, ledger) {
  const files = Array.isArray(changedFiles) ? changedFiles : [];
  const allowed = Array.isArray(scope) ? scope : [];
  const entries = Array.isArray(ledger) ? ledger : [];

  const coveredFiles = new Set(
    entries
      .map((finding) => finding.file || (finding.locationOrLink || '').split(':')[0])
      .filter((file) => hasValue(file))
  );

  return files.filter((file) => !allowed.includes(file) && !coveredFiles.has(file));
}

module.exports = { validateLedger, isActionable, dedupeFindings, mergeFindings, scopeViolations };
