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

const { redact } = require('./pr-review-state');

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
const FLAGS = ['unresolvedThread', 'uncertain', 'cleared', 'preExisting'];

const VALID_DISPOSITIONS = new Set(['fix', 'duplicate', 'not-applicable', 'deferred', 'adjudicate', 'resolved']);

/**
 * The closed set the library enforces (AC-007-2). What each word MEANS -- what
 * counts as Important rather than Nit -- stays editable prose in the skill and
 * REVIEW.md (AC-007-3); only these three words are graded here.
 */
const SEVERITIES = Object.freeze(['important', 'nit', 'pre-existing']);

/**
 * The prior vocabulary, read without loss (AC-007-4): Critical and Major are
 * Important, Minor and Nitpick are Nit. The canonical words map to themselves,
 * so normalizing twice is the same as normalizing once.
 */
const LEGACY_SEVERITY_MAP = Object.freeze({
  critical: 'important',
  major: 'important',
  minor: 'nit',
  nitpick: 'nit',
  important: 'important',
  nit: 'nit',
  'pre-existing': 'pre-existing',
  preexisting: 'pre-existing',
  'pre existing': 'pre-existing',
});

/**
 * The canonical severity of a finding's word, or `null` when the word is not
 * one this library knows. Null is the fail-closed answer: every caller treats
 * an unrecognised severity as actionable rather than guessing a rank for it.
 *
 * Letter case is ignored, nothing else is: a padded or decorated word (`"
 * minor"`, `"minor!"`) is NOT recognised, the same rule the rest of this file
 * has always applied to severities.
 */
function normalizeSeverity(value) {
  if (typeof value !== 'string') return null;
  const key = value.toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEGACY_SEVERITY_MAP, key) ? LEGACY_SEVERITY_MAP[key] : null;
}

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

/**
 * The taxonomy audit of a ledger, kept separate from validateLedger so the
 * shape of that long-standing result is unchanged: which findings carry a
 * severity outside the closed set (AC-007-2) and which are not anchored to a
 * file and line. Neither is fatal -- an unrecognised severity stays actionable
 * and no finding is dropped -- but both are named so a report can show them.
 *
 * @returns {{ok:boolean, unrecognisedSeverityIds:Array, unanchoredIds:Array}|{ok:false, reason:string, ...}}
 */
function auditTaxonomy(findings) {
  const empty = { unrecognisedSeverityIds: [], unanchoredIds: [] };
  if (!Array.isArray(findings)) return { ok: false, reason: 'findings must be an array', ...empty };
  if (!everyEntry(findings, isObject)) return { ok: false, reason: 'findings must contain only objects', ...empty };

  const unrecognisedSeverityIds = [];
  const unanchoredIds = [];
  for (const finding of Array.from(findings)) {
    if (normalizeSeverity(finding.severity) === null) unrecognisedSeverityIds.push(finding.id);
    if (anchorOf(finding) === null) unanchoredIds.push(finding.id);
  }
  return { ok: unrecognisedSeverityIds.length === 0 && unanchoredIds.length === 0, unrecognisedSeverityIds, unanchoredIds };
}

/** A flag that is neither absent nor exactly false: true, but also "true", 1, null, {} -- none can be read as "no". */
function isUnsettled(flag) {
  return flag !== undefined && flag !== false;
}

/** Whether a written severity is the word Critical: text, any letter case, surrounding space ignored. */
function isCriticalWord(word) {
  return isText(word) && word.trim().toLowerCase() === 'critical';
}

/**
 * Whether a finding is a Critical, the top legacy severity: written as one, or read into the current taxonomy from one.
 *
 * `normalizeFinding` turns Critical into `important` and keeps the written word as `originalSeverity`, so `severity` alone
 * cannot tell a Critical from an Important finding once a ledger has been read. Every rule the word carries asks THIS and
 * nothing else compares a severity with it: the stopping rule never defers a Critical (`isActionable`), a verifier vote never
 * closes one (`pr-review-votes.js`), the operator's list decides one as it decides a security finding
 * (`pr-review-disposition.js`), it outranks a Major (`severityRank`) and the merge gate's blocker names it.
 *
 * The reading: `severity` is the word Critical (letter case and surrounding space ignored), or `originalSeverity` is and the
 * finding itself still reads Important or cannot be read at all (it blocks as Important then). That is a Critical the ledger has
 * read, and a Critical claimed beside a lesser Important word, such as `{severity: 'major', originalSeverity: 'critical'}`. It is
 * NOT a Nit or Pre-existing finding that carries the claim: `isActionable` and the merge gate read such a finding as that
 * whatever else it holds, so its Critical is stale, and the vote tally, the rank and the operator's list read it as a Nit
 * too, agreeing with them. The stale word is not erased from the record, and counts again if
 * a report raises the finding to Important. A word that is not text is not Critical. `pr-review-votes.js` imports nothing and
 * mirrors this reading; a test pins that the two agree.
 *
 * @param {*} finding
 * @returns {boolean}
 */
function isCritical(finding) {
  if (!isObject(finding)) return false;
  if (isCriticalWord(finding.severity)) return true;
  const own = normalizeSeverity(finding.severity);
  return isCriticalWord(finding.originalSeverity) && (own === 'important' || own === null);
}

/**
 * The stopping rule's deferral as a triager writes it: `blocking: false` (exactly), disposition `deferred`, a text reason.
 * This is the CLAIM. Whether it counts is another question, and never yes for a Critical (`isActionable`) or at the merge
 * gate (`applyProvenance`).
 *
 * @param {*} finding
 * @returns {boolean}
 */
function claimsStoppingRuleDeferral(finding) {
  return isObject(finding) && finding.blocking === false && finding.disposition === 'deferred' && isText(finding.reason);
}

/**
 * Whether a finding still blocks.
 *
 * Pre-existing never blocks (AC-007-1): it names a problem the PR did not
 * introduce, is reported in its own bucket and is not the author's to answer.
 * Everything else blocks until it is answered: an Important finding always, a
 * Nit unless it is deferred with a recorded reason, any finding with an open
 * thread or an uncertain flag, and any finding whose severity cannot be read.
 * A finding answered with a recorded resolution reason (AC-008-2) or cleared
 * by a later head that changed the cited location (AC-008-3) stops blocking,
 * but an open thread outranks both: a disputed finding is still answered.
 *
 * Fail closed: a finding that is not an object, an unrecognised severity, a
 * flag that is not exactly false or absent, a `cleared` that is not exactly
 * `true`, or a resolution with no text reason, all stay actionable.
 *
 * Stopping rule: an Important finding (the canonical word, or the legacy
 * `major`) with `blocking: false` (exactly), deferred with a text reason, does
 * not block. The legacy `critical` is never deferrable this way, whether it is
 * written as `critical` or was read into the taxonomy since (`isCritical`):
 * reading a ledger never changes whether a finding blocks.
 */
function isActionable(finding) {
  if (!isObject(finding)) return true;

  const severity = normalizeSeverity(finding.severity);
  if (severity === 'pre-existing') return false;
  if (isUnsettled(finding.unresolvedThread) || isUnsettled(finding.uncertain)) return true;
  if (finding.cleared === true) return false;
  if (isObject(finding.resolution) && isText(finding.resolution.reason)) return false;
  if (severity === 'important') {
    // Stopping rule: only an Important/Major the triager marked `blocking: false` may be deferred, with a text reason. Critical never.
    return isCritical(finding) || !claimsStoppingRuleDeferral(finding);
  }
  if (severity === 'nit') {
    const deferredWithReason = finding.disposition === 'deferred' && isText(finding.reason);
    return !deferredWithReason;
  }
  return true;
}

function dedupeKey(finding) {
  return `${finding.locationOrLink || ''}::${finding.failureMode || ''}`;
}

/**
 * The order duplicates collapse in. The canonical words rank Important above
 * Nit above Pre-existing; the legacy words keep the finer order they were
 * written with (critical above major, minor above nitpick), so a ledger
 * recorded before the taxonomy change collapses exactly as it did before. A
 * Critical keeps its place when the ledger has been read into the taxonomy
 * (`isCritical`); Minor and Nitpick, both Nit once read, do not need to.
 */
const SEVERITY_RANK = { critical: 4, important: 3, major: 3, minor: 2, nit: 1, nitpick: 1, 'pre-existing': 0 };
// isActionable treats a missing or unrecognised severity as actionable, so it ranks with Important, not below Nit.
const UNRECOGNISED_SEVERITY_RANK = SEVERITY_RANK.important;

function severityRank(finding) {
  const severity = String((finding && finding.severity) || '').toLowerCase();
  const rank = Object.prototype.hasOwnProperty.call(SEVERITY_RANK, severity) ? SEVERITY_RANK[severity] : UNRECOGNISED_SEVERITY_RANK;
  return isCritical(finding) ? Math.max(rank, SEVERITY_RANK.critical) : rank;
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
 * Probable duplicates: one defect written up twice by independent reviewers.
 *
 * Reviewers who find the same defect rarely agree on the line range
 * (`a.js:293-302`, `a.js:294-302`) or on the words, so two findings with
 * different text never shared an entry. Merging by location alone would be
 * wrong -- two defects can sit on one line -- and a wrong merge drops a
 * finding, while a missed one only costs a repeated verification, so every
 * condition below must hold and a doubt keeps the findings apart:
 *
 *   1. Different sources. One reviewer's two findings are two findings by its
 *      own account, and an entry never holds two findings of one source (so a
 *      reviewer's neighbouring findings cannot collapse through a single
 *      match from another).
 *   2. The same file, with line ranges that overlap or lie within
 *      ADJACENT_LINES of each other (`path:12`, `path:12-20`, `path:12,40`;
 *      trailing prose and several anchors are read).
 *   3. Descriptions (failure mode and evidence) that agree. Each distinct
 *      word weighs ln(N / df), N the distinct findings in the call and df how
 *      many use the word, so vocabulary the whole round shares -- the PR's own
 *      topic -- counts for little, and a round too small to tell topic from
 *      defect (two findings) merges nothing. The weight of the words two
 *      findings share, over the smaller description's total weight, must
 *      reach SAME_DEFECT_MIN_SIMILARITY. On 54 reviewer findings from two
 *      real PRs the distinct defects that sat on the same lines scored 0.21
 *      or less (0.23 with another security relevance or Pre-existing status,
 *      which condition 4 keeps apart anyway) and the pairs merged scored 0.29
 *      to 0.56; a few weaker same-defect pairs (0.21 to 0.24) stay separate.
 *      The shorter description must also weigh at least
 *      SAME_DEFECT_MIN_SIZE_RATIO of the longer one, so a short finding is
 *      not absorbed by a long one that merely mentions its words (every pair
 *      merged on those findings weighed 0.53 or more).
 *   4. Nothing that needs a person: no open thread and no uncertain flag, and
 *      the same class, security relevance and Pre-existing status.
 */
const SAME_DEFECT_MIN_SIMILARITY = 0.26;
/** The shorter of two descriptions must weigh at least this share of the longer one. */
const SAME_DEFECT_MIN_SIZE_RATIO = 0.33;
/** Fewer distinct words than this is too little text to call two findings one defect. */
const SAME_DEFECT_MIN_WORDS = 8;
const ADJACENT_LINES = 2;

/** Words that say nothing about WHICH defect a finding describes (three letters or more; shorter words are dropped anyway). */
const STOP_WORDS = new Set(
  (
    'about after all also and any are because been before being between both but can could did does each either ' +
    'even every for from had has have here how however into its just may might more most must nor not only other ' +
    'our out over per same shall should since some such than that the their them then there these they this those ' +
    'through too under until upon was were what when where whether which while who whom whose why will with within ' +
    'without would you your'
  ).split(' ')
);

/** `path:12`, `path:12-20`, `path:12:5` and `path:12,40-44`, possibly several in one string, possibly followed by prose. */
const ANCHOR_PATTERN = /([^\s:,;()[\]'"`<>]{1,255}):(\d+(?:\s*[-–]\s*\d+)?)(?::\d+)?((?:\s*,\s*\d+(?:\s*[-–]\s*\d+)?)*)/g;
const LOCATION_TEXT_LIMIT = 2000;

/**
 * Every `{ file, start, end }` a finding's location cites. A link (anything with a URL scheme), a bare path
 * and text that cites no line give none: such a finding is never merged by similarity.
 */
function locationRanges(finding) {
  const text = isText(finding.locationOrLink) ? finding.locationOrLink.trim().slice(0, LOCATION_TEXT_LIMIT) : '';
  if (text === '' || /^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return [];

  const ranges = [];
  for (const match of text.matchAll(ANCHOR_PATTERN)) {
    if (!/[./]/.test(match[1])) continue;
    const file = match[1].replace(/\\/g, '/').replace(/^(\.\/)+/, '');
    for (const part of `${match[2]}${match[3]}`.split(',')) {
      const [first, last = first] = part.split(':')[0].split(/[-–]/).map((line) => Number(line.trim()));
      if (first >= 1 && last >= 1) ranges.push({ file, start: Math.min(first, last), end: Math.max(first, last) });
    }
  }
  return ranges;
}

/** The distinct words of a finding's failure mode and evidence, lower case, plural `s` folded. */
function descriptionWords(finding) {
  const words = new Set();
  const text = [finding.failureMode, finding.evidence].filter(isText).join(' ');
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (word.length < 3 || STOP_WORDS.has(word)) continue;
    words.add(word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);
  }
  return words;
}

/** What two findings must agree on besides their text: class, security relevance and Pre-existing status. */
function kindOf(finding) {
  const className = classOf(finding);
  const security = finding.security === true || finding.securityRelevant === true;
  const preExisting = normalizeSeverity(finding.severity) === 'pre-existing' || finding.preExisting === true;
  return `${className === null ? '' : className.toLowerCase()}|${security}|${preExisting}`;
}

function rangesAreNear(rangesA, rangesB) {
  return rangesA.some((a) =>
    rangesB.some((b) => a.file === b.file && a.start <= b.end + ADJACENT_LINES && b.start <= a.end + ADJACENT_LINES)
  );
}

/**
 * Joins the exact-duplicate clusters (arrays of indexes into `findings`) whose findings are probably one defect
 * (see SAME_DEFECT_MIN_SIMILARITY). The strongest matches join first, so a finding meets its best partner
 * before a weaker one, and a join that would put two findings of one source in one entry is refused.
 *
 * @returns {Array<{indexes:number[], byResemblance:boolean}>}  Ordered by each group's first finding.
 */
function joinProbableDuplicates(findings, clusters) {
  const wordSets = findings.map(descriptionWords);
  const documentFrequency = new Map();
  for (const members of clusters) {
    const clusterWords = new Set(members.flatMap((index) => [...wordSets[index]]));
    for (const word of clusterWords) documentFrequency.set(word, (documentFrequency.get(word) || 0) + 1);
  }
  const weightOf = (word) => Math.log(clusters.length / documentFrequency.get(word));

  const facts = findings.map((finding, index) => {
    const source = isText(finding.source) ? finding.source.trim().toLowerCase() : null;
    const ranges = locationRanges(finding);
    const settled = !isUnsettled(finding.unresolvedThread) && !isUnsettled(finding.uncertain);
    const comparable = source !== null && ranges.length > 0 && settled && wordSets[index].size >= SAME_DEFECT_MIN_WORDS;
    return { source, ranges, comparable, kind: kindOf(finding) };
  });

  const clusterOf = [];
  clusters.forEach((members, number) => members.forEach((index) => (clusterOf[index] = number)));
  const sources = clusters.map((members) => new Set(members.map((index) => facts[index].source)));
  const kinds = clusters.map((members) => (new Set(members.map((index) => facts[index].kind)).size === 1 ? facts[members[0]].kind : null));
  const eligible = clusters.map((members, number) => kinds[number] !== null && members.every((index) => facts[index].comparable));

  const indexesByFile = new Map();
  findings.forEach((_, index) => {
    if (!eligible[clusterOf[index]]) return;
    for (const file of new Set(facts[index].ranges.map((range) => range.file))) {
      if (!indexesByFile.has(file)) indexesByFile.set(file, []);
      indexesByFile.get(file).push(index);
    }
  });

  const edges = [];
  const compared = new Set();
  for (const indexes of indexesByFile.values()) {
    for (let a = 0; a < indexes.length; a += 1) {
      for (let b = a + 1; b < indexes.length; b += 1) {
        const [i, j] = [indexes[a], indexes[b]];
        if (compared.has(i * findings.length + j)) continue;
        compared.add(i * findings.length + j);
        if (clusterOf[i] === clusterOf[j]) continue;
        if (kinds[clusterOf[i]] !== kinds[clusterOf[j]] || !rangesAreNear(facts[i].ranges, facts[j].ranges)) continue;

        let shared = 0;
        let totalI = 0;
        let totalJ = 0;
        for (const word of wordSets[i]) {
          totalI += weightOf(word);
          if (wordSets[j].has(word)) shared += weightOf(word);
        }
        for (const word of wordSets[j]) totalJ += weightOf(word);
        const smaller = Math.min(totalI, totalJ);
        const larger = Math.max(totalI, totalJ);
        if (smaller <= 0 || smaller / larger < SAME_DEFECT_MIN_SIZE_RATIO) continue;
        if (shared / smaller >= SAME_DEFECT_MIN_SIMILARITY) edges.push({ i, j, score: shared / smaller });
      }
    }
  }

  const parent = clusters.map((_, number) => number);
  const find = (number) => (parent[number] === number ? number : (parent[number] = find(parent[number])));
  const byResemblance = new Set();
  edges.sort((x, y) => y.score - x.score || x.i - y.i || x.j - y.j);
  for (const { i, j } of edges) {
    const [keep, drop] = [find(clusterOf[i]), find(clusterOf[j])];
    if (keep === drop || [...sources[drop]].some((source) => sources[keep].has(source))) continue;
    parent[drop] = keep;
    sources[drop].forEach((source) => sources[keep].add(source));
    byResemblance.add(keep);
  }

  const joined = new Map();
  clusters.forEach((members, number) => {
    const root = find(number);
    if (!joined.has(root)) joined.set(root, []);
    joined.get(root).push(...members);
  });
  return [...joined.entries()]
    .map(([root, indexes]) => ({ indexes: indexes.sort((a, b) => a - b), byResemblance: byResemblance.has(root) }))
    .sort((a, b) => a.indexes[0] - b.indexes[0]);
}

/**
 * Duplicate findings share one fix id and keep every original link: those with the same location and failure
 * mode, and those that are very probably one defect found by different reviewers (see
 * SAME_DEFECT_MIN_SIMILARITY -- nothing that is not clearly the same defect is merged). The group collapses onto its
 * most severe actionable member (see collapseBase), and an actionable entry never keeps a `deferred` disposition.
 * An entry joined by resemblance lists its members in `mergedFrom` (`id`, `source`, `locationOrLink`), so the merge
 * can be named in the report and checked.
 *
 * @returns {Object[]|{ok:false, reason:string}}  The findings, or a rejection when `findings` is not an array of objects.
 */
function dedupeFindings(findings) {
  if (!Array.isArray(findings)) return rejection('findings must be an array');
  if (!everyEntry(findings, isObject)) return rejection('findings must contain only objects');

  const exact = new Map();
  findings.forEach((finding, index) => {
    const key = dedupeKey(finding);
    if (!exact.has(key)) exact.set(key, []);
    exact.get(key).push(index);
  });

  const result = [];
  for (const { indexes, byResemblance } of joinProbableDuplicates(findings, [...exact.values()])) {
    const group = indexes.map((index) => findings[index]);
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }
    const fixId = group.find((f) => f.fixId)?.fixId || group[0].id;
    const originalLinks = group
      .map((f) => f.originalTextOrLink)
      .filter((link) => hasValue(link));
    const collapsed = { ...collapseBase(group), fixId, originalLinks };
    if (byResemblance) collapsed.mergedFrom = group.map(({ id, source, locationOrLink }) => ({ id, source, locationOrLink }));
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

/**
 * The file and line a finding is anchored to, or `null` when it carries no
 * `file:line` anchor (a bare link, a file with no line, a malformed line).
 * Presented findings must be anchored (AC-007-2); an unanchored one is named
 * by validateLedger rather than quietly presented without a location.
 */
function anchorOf(finding) {
  if (!isObject(finding) || !isText(finding.locationOrLink)) return null;
  const match = /^(.+?):(\d+)(?::\d+)?$/.exec(finding.locationOrLink.trim());
  if (match === null) return null;
  const line = Number(match[2]);
  if (!Number.isInteger(line) || line < 1) return null;
  return { file: match[1], line };
}

/**
 * One finding, read into the current taxonomy and redacted.
 *
 * The canonical severity replaces the written word and the written word is
 * kept as `originalSeverity`, so a Critical/Major/Minor/Nitpick ledger reads
 * as Important/Nit with nothing lost and nothing rewritten in silence
 * (AC-007-4). `isCritical` reads the kept word: a Critical stays Critical.
 * A Critical a caller claimed beside a lesser Important word
 * (`{severity: 'major', originalSeverity: 'critical'}`) is kept where it is
 * and not traded for that word, or the finding would read Critical as written
 * and Important once read.
 * An unrecognised word is KEPT as written and flagged
 * `severityRecognised: false`: it must stay visible and it stays actionable.
 * Credential-shaped text is redacted with the review-state redaction before
 * the finding is recorded anywhere (AC-024-2).
 */
function normalizeFinding(finding) {
  if (!isObject(finding)) return finding;
  const canonical = normalizeSeverity(finding.severity);
  const normalized = { ...redact(finding) };
  normalized.severityRecognised = canonical !== null;
  normalized.preExisting = canonical === 'pre-existing';
  if (canonical !== null) {
    const keepsCriticalClaim = isCritical(finding) && !isCriticalWord(finding.severity);
    if (finding.severity !== canonical && !keepsCriticalClaim) normalized.originalSeverity = finding.severity;
    normalized.severity = canonical;
  }
  return normalized;
}

/**
 * A whole ledger read into the current taxonomy, in the order given and with
 * every entry kept.
 *
 * @returns {Object[]|{ok:false, reason:string}}  Rejects anything that is not
 *   an array of finding objects, so a misread ledger is never an empty one.
 */
function normalizeLedger(findings) {
  if (!Array.isArray(findings)) return rejection('findings must be an array');
  if (!everyEntry(findings, isObject)) return rejection('findings must contain only objects');
  return Array.from(findings).map(normalizeFinding);
}

/** Presentation order: Important (and anything unreadable) first, then Nit, then Pre-existing. */
const PRESENTATION_ORDER = { important: 0, nit: 1, 'pre-existing': 2 };
const UNRECOGNISED_PRESENTATION_ORDER = PRESENTATION_ORDER.important;

function presentationRank(finding) {
  const severity = normalizeSeverity(finding && finding.severity);
  return severity === null ? UNRECOGNISED_PRESENTATION_ORDER : PRESENTATION_ORDER[severity];
}

/**
 * The findings sorted for presentation: Important first (AC-007-2), then Nit,
 * then Pre-existing. The sort is stable, so findings of one severity keep the
 * order the reviewers reported them in. A severity that cannot be read sorts
 * with Important -- it is never buried at the bottom of the list.
 *
 * @returns {Object[]|{ok:false, reason:string}}
 */
function sortFindings(findings) {
  const normalized = normalizeLedger(findings);
  if (!Array.isArray(normalized)) return normalized;
  return normalized
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => presentationRank(a.finding) - presentationRank(b.finding) || a.index - b.index)
    .map((entry) => entry.finding);
}

/**
 * The findings split into the buckets a report presents: Important, Nit and
 * Pre-existing (reported separately and never blocking, AC-007-1), plus
 * `unrecognised` for severities this library does not know and `blocking` for
 * everything still to be answered. Each bucket is in presentation order.
 *
 * @returns {{ok:true, findings:Object[], important:Object[], nits:Object[],
 *   preExisting:Object[], unrecognised:Object[], blocking:Object[]}|{ok:false, reason:string}}
 */
function partitionFindings(findings) {
  const sorted = sortFindings(findings);
  if (!Array.isArray(sorted)) return { ok: false, reason: sorted.reason };

  const bucket = (name) => sorted.filter((finding) => normalizeSeverity(finding.severity) === name);
  return {
    ok: true,
    findings: sorted,
    important: bucket('important'),
    nits: bucket('nit'),
    preExisting: bucket('pre-existing'),
    unrecognised: sorted.filter((finding) => normalizeSeverity(finding.severity) === null),
    blocking: sorted.filter((finding) => isActionable(finding)),
  };
}

/**
 * Records the author's answer to a finding (AC-008-2): the reason is stored on
 * the finding, the disposition becomes `resolved` and the finding stops
 * blocking -- unless its thread is still open, which isActionable keeps
 * actionable until the thread is closed.
 *
 * Fail closed: a resolution with no text reason is REFUSED and the finding is
 * returned unchanged, still blocking. "Closed with no reason" is not a thing
 * this library can record.
 *
 * The REFUSED finding is echoed back REDACTED (AC-024-2). A refusal is still
 * an output a skill may put in a report or a comment, so a credential inside
 * a malformed request must not ride out on the error path -- the one route
 * that would otherwise bypass every redaction on the success path.
 *
 * @param {Object} finding
 * @param {{reason:string, by?:string, at?:string}} resolution
 * @returns {{ok:true, finding:Object}|{ok:false, reason:string, finding:Object}}
 */
function recordResolution(finding, resolution) {
  if (!isObject(finding)) return { ok: false, reason: 'a resolution needs a finding object', finding: redact(finding) };
  if (!isObject(resolution) || !isText(resolution.reason)) {
    return { ok: false, reason: 'a resolution needs a text reason', finding: redact(finding) };
  }

  const record = { reason: redact(resolution.reason.trim()) };
  if (isText(resolution.by)) record.by = redact(resolution.by.trim());
  if (isText(resolution.at)) record.at = resolution.at.trim();
  if (isText(resolution.headSha)) record.headSha = resolution.headSha.trim();

  return { ok: true, finding: { ...normalizeFinding(finding), disposition: 'resolved', resolution: record } };
}

/**
 * A GitHub-style login: no spaces, no prose. A SHAPE check only. It keeps a
 * sentence out of `by`; it cannot tell a person from a bot or a stranger (that
 * is `decidingLoginProblem`, and only when it is handed the repository's
 * policy) and it cannot tell who typed it.
 */
const LOGIN_PATTERN = /^@?[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/**
 * A decision time: an ISO-8601 date and time WITH a zone. `Date.parse` alone
 * also takes `1`, `Jan 1 2020`, a bare date and a time with no zone.
 */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

const isTimestamp = (value) => ISO_TIMESTAMP.test(value.trim()) && Number.isFinite(Date.parse(value.trim()));

/** A login the way a platform compares one: no leading `@`, any letter case. */
const loginKey = (login) => login.trim().replace(/^@/, '').toLowerCase();

/** The logins a policy list names, or `null` when it is there but is not a list of text: unreadable, never "empty". */
function readLoginList(list) {
  if (list === undefined || list === null) return new Set();
  if (!Array.isArray(list) || !everyEntry(list, isText)) return null;
  return new Set(list.map(loginKey));
}

/**
 * Whether the repository's policy lets `by` record a decision: a sentence
 * naming why not, or `null`.
 *
 *   - a login in `botLogins` never can: a bot's word is not the operator's;
 *   - when `maintainerLogins` names anyone, only they can; naming no one sets
 *     no allow-list (the strict default names no one);
 *   - no `policy` at all leaves nothing to check against, so the login is
 *     judged by its shape alone: the caller hands over the base-branch policy
 *     block, the same one `approvals` takes;
 *   - a policy that is there but cannot be read refuses. It is never read as
 *     "no check".
 *
 * @param {string} by A login (already shaped like one).
 * @param {Object} [policy] The policy block: `botLogins` and `maintainerLogins` are read from it.
 * @returns {string|null}
 */
function decidingLoginProblem(by, policy) {
  if (policy === undefined || policy === null) return null;
  const unreadable = 'the policy handed over cannot be read, so who may decide cannot be checked';
  if (!isObject(policy)) return unreadable;
  const bots = readLoginList(policy.botLogins);
  const maintainers = readLoginList(policy.maintainerLogins);
  if (bots === null || maintainers === null) return unreadable;
  const login = loginKey(by);
  if (bots.has(login)) return `${by.trim()} is a bot login the repository's policy lists (botLogins), and a bot is not the operator`;
  if (maintainers.size > 0 && !maintainers.has(login)) return `${by.trim()} is not one of the repository's maintainerLogins`;
  return null;
}

/**
 * Whether a finding's recorded resolution carries the provenance the merge
 * gate requires of an Important or security closure: a stated reason, the
 * login of whoever decided (`by`), an ISO-8601 timestamp (`at`) and the head
 * commit the decision was made against (`headSha`, equal to `headSha`, the
 * commit the gate is being asked about). Given the repository's `policy`, `by`
 * must also be a login the policy lets decide (`decidingLoginProblem`).
 *
 * HONEST LIMIT: this proves a reason is present, a login of the right shape
 * is attached (a bot or a stranger is refused only when a policy says so) and
 * the decision is bound to THIS head. It cannot prove a human typed it: an
 * agent that writes a permitted login into `by` passes this check. The binding
 * to the head and the named login make a claim attributable and stale on the
 * next push; they do not authenticate it.
 *
 * Fail closed: anything unreadable is `false`.
 *
 * @param {Object} finding
 * @param {string} headSha The commit the gate is evaluating.
 * @param {Object} [policy] The policy block, to check who may decide.
 * @returns {boolean}
 */
function hasResolutionProvenance(finding, headSha, policy) {
  return resolutionProvenanceProblem(finding, headSha, policy) === null;
}

/**
 * Why a finding's resolution fails `hasResolutionProvenance`, as a sentence a
 * blocker can carry, or `null` when it carries full provenance.
 *
 * @param {Object} finding
 * @param {string} headSha
 * @param {Object} [policy]
 * @returns {string|null}
 */
function resolutionProvenanceProblem(finding, headSha, policy) {
  if (!isObject(finding) || !isObject(finding.resolution)) return 'it has no recorded resolution';
  if (!isText(headSha)) return 'the gate was given no head commit to bind it to';
  const { reason, by, at, headSha: decidedAt } = finding.resolution;
  if (!isText(reason)) return 'the resolution states no reason';
  if (!isText(by) || !LOGIN_PATTERN.test(by.trim())) return 'the resolution names no deciding login (by)';
  const notAllowed = decidingLoginProblem(by, policy);
  if (notAllowed !== null) return notAllowed;
  if (!isText(at) || !isTimestamp(at)) return 'the resolution has no ISO-8601 timestamp with a zone (at)';
  if (!isText(decidedAt)) return 'the resolution is not bound to a head commit (headSha)';
  if (decidedAt.trim().toLowerCase() !== headSha.trim().toLowerCase()) {
    return `the resolution was recorded against ${decidedAt.trim()}, not the current head ${headSha.trim()}`;
  }
  return null;
}

/**
 * Records a decision on a finding with the provenance the merge gate demands
 * of one: `recordResolution` plus `by` (a login), `headSha` (the head the
 * decision was made against) and `at` (an ISO-8601 timestamp with a zone), all
 * REQUIRED. A decision missing any of them, or one the gate would ignore (a
 * login the policy refuses, a policy that cannot be read), is refused and the
 * finding comes back unchanged and still blocking: this applies the gate's own
 * check, `resolutionProvenanceProblem`, bound to the head the decision names.
 * Nothing is defaulted: this library never reads a clock, so a caller that did
 * not state when and about which head has not recorded a decision.
 *
 * It does not know who is typing. Whether `by` is the operator, and not a
 * session that wrote a login there, is the skill's rule; see
 * `hasResolutionProvenance` for what is and is not proven.
 *
 * @param {Object} finding
 * @param {{reason:string, by:string, headSha:string, at:string}} decision
 * @param {Object} [policy] The policy block, to check who may decide.
 * @returns {{ok:true, finding:Object}|{ok:false, reason:string, finding:Object}}
 */
function recordOperatorResolution(finding, decision, policy) {
  if (!isObject(finding)) return { ok: false, reason: 'a resolution needs a finding object', finding: redact(finding) };
  if (!isObject(decision)) return { ok: false, reason: 'a resolution needs a decision object', finding: redact(finding) };
  for (const key of ['reason', 'by', 'headSha', 'at']) {
    if (!isText(decision[key])) {
      return { ok: false, reason: `an operator resolution needs '${key}' as non-empty text`, finding: redact(finding) };
    }
  }
  const problem = resolutionProvenanceProblem({ resolution: decision }, decision.headSha, policy);
  if (problem !== null) {
    return { ok: false, reason: `the gate would not honour this decision: ${problem}`, finding: redact(finding) };
  }
  return recordResolution(finding, decision);
}

/** One changed location: `'path'`, `'path:line'`, or `{ path, lines?: number[] }`. `lines: null` means the whole file. */
function readChangedLocation(entry) {
  if (isText(entry)) {
    const anchored = /^(.+?):(\d+)$/.exec(entry.trim());
    return anchored === null ? { path: entry.trim(), lines: null } : { path: anchored[1], lines: [Number(anchored[2])] };
  }
  if (!isObject(entry) || !isText(entry.path)) return null;
  if (entry.lines === undefined || entry.lines === null) return { path: entry.path.trim(), lines: null };
  if (!Array.isArray(entry.lines) || !everyEntry(entry.lines, (line) => Number.isInteger(line) && line >= 1)) return null;
  return { path: entry.path.trim(), lines: Array.from(entry.lines) };
}

/**
 * Clears findings a later head fixed (AC-008-3).
 *
 * A finding recorded on an earlier head clears when the new head changed the
 * location it cited AND no reviewer reported it again at that head: the code
 * it described is gone, so it is marked `cleared` and stops blocking. A
 * finding already recorded on `headSha` is not cleared by its own head, and a
 * re-reported finding is never cleared.
 *
 * Fail closed: any request shape it cannot read is REFUSED. "Clear everything"
 * is never the answer to a malformed call.
 *
 * @param {{ledger:Object[], changedLocations:Array, headSha:string, reReported?:Object[]}} input
 * @returns {{ok:true, findings:Object[], cleared:Array}|{ok:false, reason:string}}
 */
function clearFixedFindings(input) {
  if (!isObject(input)) return rejection('invalid-input');
  const { ledger, changedLocations, headSha } = input;
  const reReported = input.reReported === undefined ? [] : input.reReported;

  if (!Array.isArray(ledger)) return rejection('ledger must be an array');
  if (!everyEntry(ledger, isObject)) return rejection('ledger must contain only objects');
  if (!Array.isArray(changedLocations)) return rejection('changedLocations must be an array');
  if (!Array.isArray(reReported)) return rejection('reReported must be an array');
  if (!everyEntry(reReported, isObject)) return rejection('reReported must contain only objects');
  if (!isText(headSha)) return rejection('headSha must be a non-empty string');

  const locations = Array.from(changedLocations).map(readChangedLocation);
  if (locations.some((location) => location === null)) {
    return rejection('a changed location must be a path, a path:line, or { path, lines[] }');
  }

  const reReportedKeys = new Set(reReported.map(dedupeKey));
  const cleared = [];

  const findings = ledger.map((entry) => {
    const normalized = normalizeFinding(entry);
    if (headOf(entry) === headSha) return normalized;
    if (reReportedKeys.has(dedupeKey(entry))) return normalized;

    const anchor = anchorOf(entry);
    const file = anchor === null ? coveredFile(entry) : anchor.file;
    if (file === undefined) return normalized;

    const touched = locations.some(
      (location) => location.path === file && (location.lines === null || anchor === null || location.lines.includes(anchor.line))
    );
    if (!touched) return normalized;

    cleared.push(entry.id);
    return { ...normalized, cleared: true, clearedBy: headSha, clearedReason: 'location-changed' };
  });

  return { ok: true, findings, cleared };
}

/**
 * The path a finding is about: the file part of its `file:line` anchor, else
 * its `file` field or the bare path it cites. `null` when it cites no path at
 * all, which makes the finding unfingerprintable and therefore never
 * suppressible.
 *
 * A bare LINK is not a path. `coveredFile` splits a location on `:` and would
 * read `https://host/pr/1` as the file `https`, which would make two findings
 * on unrelated links look like the same defect; a location carrying a URL
 * scheme is refused here instead.
 */
function fingerprintPath(finding) {
  const anchor = anchorOf(finding);
  if (anchor !== null) return anchor.file;
  if (isText(finding.file)) return finding.file.trim();
  if (!isText(finding.locationOrLink)) return null;
  const location = finding.locationOrLink.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(location)) return null;
  const file = location.split(':')[0].trim();
  return file === '' ? null : file;
}

/**
 * A failure mode reduced to what it SAYS: lower case, punctuation and runs of
 * whitespace flattened to single spaces. "Unchecked array index" and
 * "  unchecked   ARRAY index.  " are the same defect written twice, and the
 * second must not be posted again (AC-010-2).
 */
function normalizeFailureMode(value) {
  if (!isText(value)) return null;
  const flattened = value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return flattened === '' ? null : flattened;
}

/** The class a finding belongs to, as written, or `null` when it names none. */
function classOf(finding) {
  return isObject(finding) && isText(finding.class) ? finding.class.trim() : null;
}

/** The stable id of a class finding: one per class, so later rounds find the same record. */
function classFindingId(className) {
  return `class:${String(className).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

/**
 * The identity a repeat is recognised by: path, normalized failure mode and
 * class (AC-010-2). The LINE is deliberately not part of it -- the same defect
 * reported two rounds later, after the file shifted, is the same defect.
 *
 * @returns {string|null}  `null` when the finding cites no path or no failure
 *   mode. An unfingerprintable finding is never treated as a repeat: dropping
 *   it would be the one unsafe answer.
 */
function fingerprintFinding(finding) {
  if (!isObject(finding)) return null;
  const path = fingerprintPath(finding);
  const mode = normalizeFailureMode(finding.failureMode);
  if (path === null || mode === null) return null;
  const className = classOf(finding);
  return `${path}::${mode}::${className === null ? '' : className.toLowerCase()}`;
}

/** One instance line inside a class finding: who found it, where, and whether it is still open. */
function instanceOf(entry) {
  const anchor = anchorOf(entry);
  return {
    id: entry.id,
    locationOrLink: entry.locationOrLink,
    file: anchor === null ? fingerprintPath(entry) : anchor.file,
    line: anchor === null ? null : anchor.line,
    source: entry.source,
    open: isActionable(entry),
  };
}

/** The class finding for one class: it NAMES the class and LISTS every instance (AC-011-1). */
function buildClassFinding(className, entries) {
  const instances = entries.map(instanceOf);
  const open = instances.filter((instance) => instance.open);
  const worst = entries.reduce(
    (rank, entry) => Math.max(rank, severityRank(entry)),
    SEVERITY_RANK['pre-existing']
  );
  const severity = worst >= SEVERITY_RANK.important ? 'important' : worst >= SEVERITY_RANK.nit ? 'nit' : 'pre-existing';
  const sources = [];
  entries.forEach((entry) => {
    if (isText(entry.source) && !sources.includes(entry.source)) sources.push(entry.source);
  });

  return {
    id: classFindingId(className),
    kind: 'class',
    class: className,
    source: sources.length === 0 ? 'ledger' : sources.join(', '),
    locationOrLink: instances[0].locationOrLink,
    severity,
    failureMode: `${className} (class of bug, ${instances.length} instance${instances.length === 1 ? '' : 's'})`,
    disposition: open.length === 0 ? 'resolved' : 'fix',
    evidence: `instances: ${instances.map((instance) => instance.locationOrLink).join(', ')}`,
    originalTextOrLink: isText(entries[0].originalTextOrLink) ? entries[0].originalTextOrLink : instances[0].locationOrLink,
    instances,
    instanceCount: instances.length,
    openInstanceCount: open.length,
  };
}

/**
 * The class findings a ledger carries: one record per named class, in the
 * order the classes were first recorded, each listing every instance location
 * (AC-011-1). Findings that name no class produce no record.
 *
 * @returns {Object[]|{ok:false, reason:string}}  Rejects anything that is not
 *   an array of finding objects, so a misread ledger is never "no classes".
 */
function classFindings(ledger) {
  if (!Array.isArray(ledger)) return rejection('ledger must be an array');
  if (!everyEntry(ledger, isObject)) return rejection('ledger must contain only objects');

  const groups = new Map();
  Array.from(ledger).forEach((entry) => {
    const className = classOf(entry);
    if (className === null) return;
    const key = className.toLowerCase();
    if (!groups.has(key)) groups.set(key, { className, entries: [] });
    groups.get(key).entries.push(entry);
  });

  return Array.from(groups.values()).map((group) => buildClassFinding(group.className, group.entries));
}

/**
 * Takes the decision off a finding that a later report made worse (a severity escalation in `recordRound`), and keeps it.
 *
 * A decision is about a finding AS IT WAS GRADED: an operator who accepted a Major was not asked about the Critical it became,
 * and a reason written for a Nit does not answer an Important finding. Left on the record it would close the escalated finding
 * (`isActionable`; the merge gate asks for a reason, a login, a time and this head, and nothing about what the decision was
 * about) and the escalation would change a word and nothing else.
 * So the escalation CLEARS it: the finding is open again and the operator decides it anew, with a reason of their own and on
 * the current head. The decision is not lost: `supersededResolutions` keeps each one with the severity it was taken for and the
 * round that superseded it. A `resolved` disposition goes back to the one an open finding has (`fix`, or `adjudicate` when it
 * is uncertain, as `dedupeFindings` does for a deferral that no longer holds).
 *
 * @param {Object} entry The recorded finding, escalated; changed in place.
 * @param {string} severity The severity the cleared decision was taken for: the one before the escalation.
 * @param {number} round
 * @returns {boolean} Whether a decision was cleared.
 */
function supersedeResolution(entry, severity, round) {
  if (!isObject(entry.resolution)) return false;
  const history = Array.isArray(entry.supersededResolutions) ? entry.supersededResolutions : [];
  entry.supersededResolutions = [...history, { severity, supersededInRound: round, resolution: entry.resolution }];
  delete entry.resolution;
  if (entry.disposition === 'resolved') entry.disposition = entry.uncertain === true ? 'adjudicate' : 'fix';
  return true;
}

/**
 * Records one review round against the ledger built over the earlier rounds
 * (AC-010-2, AC-011-1, AC-011-2).
 *
 * Three outcomes for each incoming finding, in this order:
 *
 *   1. its fingerprint is already recorded for this PR -- it is a REPEAT. It
 *      is not added to the ledger and not presented; the FIRST record stands,
 *      unedited, and only gains the rounds in which the defect was seen
 *      again, so the history is kept without the author being told twice.
 *      A repeat that is WORSE than the first record is not noise: it ESCALATES
 *      the record (its severity; `escalatedInRound`, `escalatedFrom`), which is
 *      presented again, and it CLEARS a decision recorded on it
 *      (`resolution`, see `supersedeResolution`): nobody was asked about the
 *      worse finding. `repeats` says so (`resolutionCleared`);
 *   2. it names a class that was already flagged -- it is ATTACHED to that
 *      existing class finding rather than opened as a new finding
 *      (AC-011-2); the class finding is presented again with the new instance
 *      in its list;
 *   3. otherwise it is NEW: it joins the ledger and is presented, as its own
 *      finding or, when it names a class, inside that class's one finding.
 *
 * Fail closed: a request this function cannot read is REFUSED -- it is never
 * read as "nothing new this round" -- and a finding that cannot be
 * fingerprinted is presented rather than suppressed.
 *
 * @param {{ledger?:Object[], incoming:Object[], round:number}} input
 * @returns {{ok:true, findings:Object[], presented:Object[], newFindings:Object[],
 *   repeats:Array<{id:*, repeatOf:*, fingerprint:string, reason:string, resolutionCleared?:true}>,
 *   attached:Array<{id:*, class:string, classFindingId:string}>,
 *   classes:Object[]}|{ok:false, reason:string}}
 */
function recordRound(input) {
  if (!isObject(input)) return rejection('invalid-input');
  const ledger = input.ledger === undefined ? [] : input.ledger;
  const { incoming, round } = input;

  if (!Array.isArray(ledger)) return rejection('ledger must be an array');
  if (!everyEntry(ledger, isObject)) return rejection('ledger must contain only objects');
  if (!Array.isArray(incoming)) return rejection('incoming must be an array');
  if (!everyEntry(incoming, isObject)) return rejection('incoming must contain only objects');
  if (!Number.isInteger(round) || round < 1) return rejection('round must be an integer >= 1');

  const findings = Array.from(ledger).map(normalizeFinding);
  const firstByFingerprint = new Map();
  findings.forEach((entry) => {
    const fingerprint = fingerprintFinding(entry);
    if (fingerprint === null) return;
    const known = firstByFingerprint.get(fingerprint);
    // A live record outranks a cleared one: the cleared one is history, the live one is what a repeat meets.
    if (known === undefined || (known.cleared === true && entry.cleared !== true)) firstByFingerprint.set(fingerprint, entry);
  });
  const knownClasses = new Set();
  findings.forEach((entry) => {
    const className = classOf(entry);
    if (className !== null) knownClasses.add(className.toLowerCase());
  });

  const repeats = [];
  const attached = [];
  const newFindings = [];
  const escalated = [];
  const touchedClasses = [];

  Array.from(incoming).forEach((candidate) => {
    const normalized = normalizeFinding(candidate);
    const fingerprint = fingerprintFinding(normalized);

    if (fingerprint !== null && firstByFingerprint.has(fingerprint) && firstByFingerprint.get(fingerprint).cleared !== true) {
      const first = firstByFingerprint.get(fingerprint);
      const seenIn = Array.isArray(first.repeatedInRounds) ? Array.from(first.repeatedInRounds) : [];
      if (!seenIn.includes(round)) seenIn.push(round);
      first.repeatedInRounds = seenIn;
      if (severityRank(normalized) > severityRank(first)) {
        // Escalation: a repeat that is worse than the first record is news, not noise.
        if (first.originalSeverity === undefined) first.originalSeverity = first.severity;
        const from = first.severity;
        first.severity = normalized.severity;
        first.severityRecognised = normalized.severityRecognised;
        first.preExisting = normalized.preExisting;
        // A Critical report reads as Important, the word the record already has: keep the word it was written with, or the
        // record would stay deferrable (`isActionable`) and the Critical would be lost with the report.
        if (isCritical(normalized) && !isCritical(first)) first.originalSeverity = normalized.originalSeverity;
        // A decision taken on the finding as it was graded is not one on the worse finding: clear it, and keep it.
        const resolutionCleared = supersedeResolution(first, from, round);
        first.escalatedInRound = round;
        first.escalatedFrom = from;
        if (!escalated.includes(first)) escalated.push(first);
        const firstClass = classOf(first);
        if (firstClass !== null && !touchedClasses.includes(firstClass.toLowerCase())) touchedClasses.push(firstClass.toLowerCase());
        repeats.push({ id: normalized.id, repeatOf: first.id, fingerprint, reason: 'severity-escalated', ...(resolutionCleared ? { resolutionCleared: true } : {}) });
        return;
      }
      repeats.push({ id: normalized.id, repeatOf: first.id, fingerprint, reason: 'already-recorded' });
      return;
    }

    // A fingerprint whose earlier record was cleared as fixed is a REGRESSION: new, with a note.
    const regressionOf = fingerprint !== null && firstByFingerprint.has(fingerprint) ? firstByFingerprint.get(fingerprint) : null;

    const className = classOf(normalized);
    const entry = { ...normalized, firstSeenRound: round };
    if (regressionOf !== null) {
      entry.regressionOf = regressionOf.id;
      entry.regression = true;
      entry.note = 'regression: an earlier finding with this fingerprint was cleared as fixed and the defect is back';
    }
    if (className !== null) {
      entry.classFindingId = classFindingId(className);
      const key = className.toLowerCase();
      if (!touchedClasses.includes(key)) touchedClasses.push(key);
      if (knownClasses.has(key)) {
        entry.attachedToExistingClass = true;
        attached.push({ id: entry.id, class: className, classFindingId: entry.classFindingId });
      } else {
        knownClasses.add(key);
        newFindings.push(entry);
      }
    } else {
      newFindings.push(entry);
    }

    findings.push(entry);
    if (fingerprint !== null) firstByFingerprint.set(fingerprint, entry);
  });

  const classes = classFindings(findings);
  const presentedClasses = Array.isArray(classes)
    ? classes.filter((record) => touchedClasses.includes(record.class.toLowerCase()))
    : [];
  const presentedPlain = [...newFindings, ...escalated].filter((entry) => classOf(entry) === null);
  const presented = sortFindings([...presentedPlain, ...presentedClasses]);

  return {
    ok: true,
    findings,
    presented: Array.isArray(presented) ? presented : [],
    newFindings,
    escalated,
    repeats,
    attached,
    classes: Array.isArray(classes) ? classes : [],
  };
}

module.exports = {
  validateLedger,
  auditTaxonomy,
  isActionable,
  isCritical,
  claimsStoppingRuleDeferral,
  dedupeFindings,
  mergeFindings,
  scopeViolations,
  normalizeSeverity,
  normalizeFinding,
  normalizeLedger,
  anchorOf,
  sortFindings,
  partitionFindings,
  recordResolution,
  recordOperatorResolution,
  hasResolutionProvenance,
  resolutionProvenanceProblem,
  clearFixedFindings,
  fingerprintFinding,
  fingerprintPath,
  normalizeFailureMode,
  classFindings,
  recordRound,
  SEVERITIES,
  LEGACY_SEVERITY_MAP,
};
