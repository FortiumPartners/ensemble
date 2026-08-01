'use strict';

/**
 * Deterministic PRD parser.
 *
 * Extracts requirements (REQ-NNN) and their acceptance criteria (AC-NNN-M) from
 * a PRD markdown document, splitting each AC into Given/When/Then clauses where
 * possible. Pure function: NO side effects, NO shell, NO disk writes.
 *
 * Mirrors the style of packages/development/lib/trd-parser.js (optional js-yaml
 * require for frontmatter; shared AC id shape). The key difference: PRD ACs live
 * as bullet sub-items under `### REQ-NNN` H3 headings, not in a dedicated
 * `## Acceptance Criteria` section, so we walk requirement headings instead.
 *
 * @typedef {Object} AcClause
 * @property {string} id            e.g. "AC-001-1"
 * @property {string} raw           cleaned AC text (marker stripped)
 * @property {string|null} given
 * @property {string|null} when
 * @property {string|null} then
 * @property {string[]} ands        extra "and ..." clauses (in order)
 * @property {boolean} needsClarification
 *
 * @typedef {Object} Requirement
 * @property {string} id            e.g. "REQ-001"
 * @property {string} title
 * @property {string|null} moscow   Must | Should | Could | Won't
 * @property {string|null} complexity Low | Medium | High
 * @property {AcClause[]} acs
 *
 * @typedef {Object} ParsedPRD
 * @property {string|null} documentId
 * @property {string|null} version
 * @property {string|null} status
 * @property {string|null} date
 * @property {string} title
 * @property {Requirement[]} reqs
 * @property {string[]} warnings
 */

let yaml = null;
try {
  // eslint-disable-next-line global-require
  yaml = require('js-yaml');
} catch {
  yaml = null; // frontmatter fields unavailable, but parser still runs
}

// ---------------------------------------------------------------------------
// Regular expressions
// ---------------------------------------------------------------------------

// Requirement heading. Both the create-prd spec form "### REQ-001: ..." and the
// real-world H4 form "#### REQ-001: ..." (nested under an "### Feature Area"
// heading) are supported.
const REQ_HEADING_RE = /^#{3,4}\s+(REQ-\d+)\s*:?\s*(.*)$/i;

// Any H1-H4 heading (requirement scope boundary).
const HEADING_RE = /^#{1,4}\s+/;

// Priority/complexity may appear inline as "[Must] [Medium]" in the heading, or
// on a dedicated line: "**Priority:** Must | **Complexity:** Low".
const PRIORITY_LINE_RE = /\*\*Priority:\*\*\s*(Must|Should|Could|Won'?t)/i;
const COMPLEXITY_LINE_RE = /\*\*Complexity:\*\*\s*(Low|Medium|High)/i;

// AC id shape — same shape used by trd-parser.js (AC_ID_RE).
const AC_ID_RE = /\bAC-\d+(?:-\d+|[a-z])?\b/i;

// AC bullet line, bold or plain marker. The colon may sit inside or outside the
// bold markers, so we strip any run of "*" and ":" between the id and the body:
//   "- **AC-001-1:** Given ..."   or   "- AC-001-1: Given ..."
const AC_LINE_RE = /^\s*-\s+\*{0,2}\s*(AC-\d+(?:-\d+|[a-z])?)\s*[:*]*\s*(.*)$/i;

const MOSCOW_RE = /\b(Must|Should|Could|Won't|Wont)\b/i;
const COMPLEXITY_RE = /\b(Low|Medium|High)\b/i;
const NEEDS_CLARIFICATION_RE = /\[NEEDS CLARIFICATION:[^\]]*\]/i;

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

function parseFrontmatter(text) {
  const m = String(text || '').match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const block = m[1];

  // Always read `date` as a raw string — js-yaml coerces unquoted ISO dates into
  // Date objects, losing the literal "YYYY-MM-DD" form we want to round-trip.
  let rawDate = null;
  const dm = block.match(/^date:\s*(.*)$/m);
  if (dm) rawDate = dm[1].replace(/^["']|["']$/g, '').trim();

  let out;
  if (yaml) {
    try {
      out = yaml.load(block) || {};
    } catch {
      out = null;
    }
  }
  if (!out) {
    // Minimal fallback: scalar `key: value` lines.
    out = {};
    for (const line of block.split('\n')) {
      const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
      if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
    }
  }
  if (rawDate !== null) out.date = rawDate;
  return out;
}

// ---------------------------------------------------------------------------
// AC text → Given/When/Then clauses
// ---------------------------------------------------------------------------

function splitClauses(raw) {
  const text = String(raw || '').trim();
  const result = { given: null, when: null, then: null, ands: [] };

  // Must start with "Given" to be treated as a structured AC.
  if (!/^given\b/i.test(text)) return result;

  // Split ONLY on the structural keywords "when"/"then" that follow a comma.
  // We deliberately do NOT split on "and": in these single-sentence ACs "and"
  // is almost always natural prose inside a clause (e.g. "...status, and resume
  // behavior remains unchanged"), and splitting on it truncates the Then.
  const parts = text.split(/,\s*(?=(?:when|then)\b)/i);
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i].trim().replace(/\.$/, '');
    const kw = seg.match(/^(given|when|then)\b\s*/i);
    if (!kw) continue;
    const body = seg.slice(kw[0].length).trim();
    const which = kw[1].toLowerCase();
    if (which === 'given' && result.given === null) result.given = body;
    else if (which === 'when' && result.when === null) result.when = body;
    else if (which === 'then' && result.then === null) result.then = body;
  }
  return result;
}

// ---------------------------------------------------------------------------
// AC line → AcClause
// ---------------------------------------------------------------------------

function parseAcLine(line) {
  const m = line.match(AC_LINE_RE);
  if (!m) return null;
  const id = m[1].toUpperCase();
  const hasMarker = NEEDS_CLARIFICATION_RE.test(m[2]);
  // Strip the clarification marker from the prose used for clause splitting.
  const raw = m[2].replace(NEEDS_CLARIFICATION_RE, '').trim();
  const clauses = splitClauses(raw);
  const structured = clauses.given !== null && clauses.then !== null;
  return {
    id,
    raw,
    given: clauses.given,
    when: clauses.when,
    then: clauses.then,
    ands: clauses.ands,
    needsClarification: hasMarker || !structured,
  };
}

// ---------------------------------------------------------------------------
// Main parse
// ---------------------------------------------------------------------------

/**
 * @param {string} markdown
 * @returns {ParsedPRD}
 */
function parsePRD(markdown) {
  const text = String(markdown || '');
  const fm = parseFrontmatter(text);
  const lines = text.split('\n');
  const warnings = [];

  let title = '';
  const titleLine = lines.find((l) => /^#\s+/.test(l));
  if (titleLine) title = titleLine.replace(/^#\s+/, '').trim();

  const reqs = [];
  let current = null;
  const seenAc = new Set();

  for (const line of lines) {
    const reqMatch = line.match(REQ_HEADING_RE);
    if (reqMatch) {
      const rawTitle = reqMatch[2].trim();
      // Tags like [Must] [Medium] are conventionally bracketed; read them, then
      // strip all bracketed segments from the displayed title.
      const moscowM = rawTitle.match(MOSCOW_RE);
      const complexityM = rawTitle.match(COMPLEXITY_RE);
      current = {
        id: reqMatch[1].toUpperCase(),
        title: rawTitle.replace(/\s*\[[^\]]*\]\s*/g, ' ').trim(),
        moscow: moscowM ? moscowM[1] : null,
        complexity: complexityM ? complexityM[1] : null,
        acs: [],
      };
      reqs.push(current);
      continue;
    }

    // Any other heading ends the current requirement's AC scope.
    if (HEADING_RE.test(line)) {
      current = null;
      continue;
    }

    if (!current) continue;

    // Pick up a dedicated "**Priority:** ... | **Complexity:** ..." line if the
    // heading itself did not carry inline [Must] [Medium] tags.
    if (!current.moscow) {
      const pm = line.match(PRIORITY_LINE_RE);
      if (pm) current.moscow = pm[1];
    }
    if (!current.complexity) {
      const cm = line.match(COMPLEXITY_LINE_RE);
      if (cm) current.complexity = cm[1];
    }

    if (!AC_ID_RE.test(line)) continue;

    const ac = parseAcLine(line);
    if (!ac) continue;
    if (seenAc.has(ac.id)) {
      warnings.push(`Duplicate acceptance criterion id ignored: ${ac.id}`);
      continue;
    }
    seenAc.add(ac.id);
    current.acs.push(ac);
  }

  for (const req of reqs) {
    if (req.acs.length === 0) {
      warnings.push(`${req.id} has no acceptance criteria`);
    }
  }

  return {
    documentId: fm.document_id || null,
    label: fm.label || null,
    version: fm.version != null ? String(fm.version) : null,
    status: fm.status || null,
    date: fm.date != null ? String(fm.date) : null,
    title,
    reqs,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Label derivation (display fallback)
// ---------------------------------------------------------------------------

/**
 * Derive a human-readable display label for a document that has no authored
 * `label` in its frontmatter (e.g. legacy docs). Shape: `<type>-<kebab-title>`,
 * where type comes from the document id prefix (PRD-/TRD-). This is DISPLAY ONLY
 * — the label is never a reference key; cross-document references always use the
 * immutable document_id.
 *
 * @param {string|null} documentId
 * @param {string} title
 * @returns {string}
 */
function deriveLabel(documentId, title) {
  const id = String(documentId || '');
  let type = 'doc';
  if (/^PRD-/i.test(id)) type = 'prd';
  else if (/^TRD-/i.test(id)) type = 'trd';
  const stem = String(title || '')
    // Legacy H1 titles embed the id, e.g. "PRD-2026-023: Real Title" — drop it so
    // the derived label doesn't double-prefix (prd-prd-2026-023-...).
    .replace(/^\s*(?:PRD|TRD|DOC)-\S+:\s*/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return stem ? `${type}-${stem}` : type;
}

module.exports = { parsePRD, splitClauses, parseAcLine, deriveLabel };
