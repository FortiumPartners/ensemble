'use strict';

/**
 * Pure PRD context extractor.
 *
 * Reads a PRD markdown string and extracts structured context for every
 * requirement and acceptance criterion referenced by TRD tasks.
 * This context is passed into buildScaffoldPlan so task bead descriptions
 * embed actual requirement/AC prose — not just IDs — eliminating the need
 * for agents to cross-reference the PRD.
 *
 * @param {string} prdMarkdown  raw PRD file content
 * @returns {PrdContext}
 */

/**
 * @typedef {Object} PrdContext
 * @property {Record<string, ReqEntry>} requirements  keyed by REQ-NNN
 * @property {Record<string, AcEntry>} acs            keyed by AC-NNN-M
 */

/**
 * @typedef {Object} ReqEntry
 * @property {string} id          e.g. "REQ-001"
 * @property {string} title       e.g. "HTTP command ingress"
 * @property {string} text        full requirement prose
 * @property {string[]} acIds     list of AC-NNN-M ids in document order
 */

/**
 * @typedef {Object} AcEntry
 * @property {string} id        e.g. "AC-001-1"
 * @property {string} reqId     e.g. "REQ-001"
 * @property {string} given
 * @property {string} when
 * @property {string} then
 * @property {string} text      full "Given...when...then..." prose
 */

const REQ_RE = /^#{1,4}\s+(REQ-\d+)\s*(?:[—–-]|:)\s*(.+)/i;
const AC_RE = /^\s*(?:[-*+]\s+)?(?:\*\*)?(AC-\d+-\d+):?(?:\*\*)?:?\s*(.+)/i;
const GIVEN_RE = /\bGiven\b([^,]*)/i;
const WHEN_RE = /\bWhen\b([^,]*)/i;
const THEN_RE = /\bThen\b([^.]*)/i;

// ---------------------------------------------------------------------------
// extractReqPriorities — minimal REQ-NNN + MoSCoW priority scan
// ---------------------------------------------------------------------------
//
// Deliberately separate from extractPrdContext()/REQ_RE above: real-world
// create-trd-authored PRDs use "### REQ-NNN: Title" / "#### REQ-NNN: Title"
// headings (colon separator, H3 or H4) with priority on a dedicated
// "**Priority:** Must | **Complexity:** Low" line — a different shape than
// REQ_RE's "# REQ-NNN — Title" (em/en-dash, H1-H3) which does not match those
// PRDs at all and never reads priority. This is used by the
// completion-verification skill (Requirement Coverage Cross-Check, Step 3) to
// gate Must/Should requirements against closed, satisfying TRD tasks. Kept
// intentionally minimal per that skill's design notes — not a full PRD
// parser; packages/product/lib/prd-parser.js#parsePRD is the full parser but
// lives in a different package and is not cross-required here.
//
// Priority comes from either shape in use in this repo's PRDs: a MoSCoW tag
// bracketed at the end of the heading ("### REQ-009: Title (Must)",
// "#### REQ-017: ... [Should]", optionally with a "[RISK: ...]" suffix) or a
// dedicated "**Priority:** Must" line (docs/PRD/PRD-2026-82b6a138-* is authored
// entirely in the former form). Without reading the tag, every REQ in such a
// PRD resolved to priority: null, which completion-verification Step 3 treats
// as informational-only, so the Must/Should coverage gate never fired and the
// skill reported a clean 0-gap pass on a PRD it had not checked.

const REQ_PRIORITY_HEADING_RE = /^#{3,4}\s+(REQ-\d+)\s*:?\s*(.*)$/i;
const REQ_PRIORITY_SCOPE_END_RE = /^#{1,4}\s+/;
const REQ_PRIORITY_LINE_RE = /\*\*Priority:\*\*\s*(Must|Should|Could|Won'?t)/i;
// A priority tag is bracketed AND at end of the heading (a "[RISK: ...]" or
// "[NEEDS CLARIFICATION: ...]" suffix may follow it), so ordinary title words
// ("... what the reviewer must say") and FR refs ("REQ-001 (FR1.1)") are
// never mistaken for a priority.
const REQ_PRIORITY_INLINE_RE = /[[\(]\s*(Must|Should|Could|Wont|Won'?t)\s*[\])]\s*(?:\[|$)/i;

/**
 * Normalize one captured MoSCoW tag to canonical spelling. The tag regexes are
 * case-insensitive, so captured casing is arbitrary ("(must)" is as valid as
 * "(Must)") and must not leak out: callers compare 'Must'|'Should'|'Could'|
 * "Won't" verbatim.
 *
 * @param {string} raw
 * @returns {'Must'|'Should'|'Could'|"Won't"}
 */
function normalizeMoscowTag(raw) {
  const tag = String(raw).toLowerCase();
  if (tag === "won't" || tag === "wont") return "Won't";
  if (tag === "must") return "Must";
  if (tag === "should") return "Should";
  return "Could";
}

/**
 * Scan a PRD's REQ-NNN headings and each requirement's MoSCoW priority, read
 * from an inline bracketed tag on the heading or, when it carries none, from
 * the requirement's "**Priority:**" line.
 *
 * @param {string} prdMarkdown
 * @returns {Array<{id: string, priority: 'Must'|'Should'|'Could'|"Won't"|null}>}
 */
function extractReqPriorities(prdMarkdown) {
  const text = String(prdMarkdown || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const reqs = [];
  let current = null;

  for (const line of text.split('\n')) {
    const headingMatch = line.match(REQ_PRIORITY_HEADING_RE);
    if (headingMatch) {
      current = { id: headingMatch[1].toUpperCase(), priority: null };
      const inlineMatch = (headingMatch[2] || '').match(REQ_PRIORITY_INLINE_RE);
      if (inlineMatch) {
        current.priority = normalizeMoscowTag(inlineMatch[1]);
      }
      reqs.push(current);
      continue;
    }

    // Any other heading ends the current requirement's scope.
    if (REQ_PRIORITY_SCOPE_END_RE.test(line)) {
      current = null;
      continue;
    }

    if (!current || current.priority) continue;

    const priorityMatch = line.match(REQ_PRIORITY_LINE_RE);
    if (priorityMatch) {
      current.priority = normalizeMoscowTag(priorityMatch[1]);
    }
  }

  return reqs;
}

/**
 * Parse a requirement section's raw lines to extract the full req text
 * and list of AC ids.
 */
function parseReqSection(reqId, title, lines) {
  const acIds = [];
  const textParts = [title];

  for (const line of lines) {
    const acMatch = line.match(AC_RE);
    if (acMatch) {
      acIds.push(acMatch[1].toUpperCase());
    } else {
      // Strip markdown heading markers, **bold**, and leading bullet/list markers
      const stripped = line
        .replace(/^#{1,3}\s+/, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/^[-*+]\s+/, '')
        .replace(/^\s+\|\s+/, '')
        .trim();
      if (stripped && stripped !== title && !REQ_RE.test(line)) {
        textParts.push(stripped);
      }
    }
  }

  return { text: textParts.join(' ').replace(/\s+/g, ' ').trim(), acIds };
}

/**
 * Parse a single AC line to extract Given/When/Then parts.
 */
function parseAcLine(acId, reqId, body) {
  const clean = body.replace(/\s+/g, ' ').replace(/\*\*([^*]+)\*\*/g, '$1').trim();

  const givenMatch = clean.match(GIVEN_RE);
  const whenMatch = clean.match(WHEN_RE);
  const thenMatch = clean.match(THEN_RE);

  const given = givenMatch ? givenMatch[1].replace(/^,\s*/, '').trim() : '';
  const when = whenMatch ? whenMatch[1].replace(/^,\s*/, '').trim() : '';
  const then = thenMatch ? thenMatch[1].replace(/^\s*/, '').trim() : '';

  return { id: acId, reqId, given, when, then, text: clean };
}

/**
 * Main entry point. Returns a flat map of all requirements and ACs.
 *
 * @param {string} prdMarkdown
 * @returns {PrdContext}
 */
function extractPrdContext(prdMarkdown) {
  if (!prdMarkdown || typeof prdMarkdown !== 'string') {
    return { requirements: {}, acs: {} };
  }

  const lines = prdMarkdown.split('\n');
  const requirements = {};
  const acs = {};

  let i = 0;
  while (i < lines.length) {
    const reqMatch = lines[i].match(REQ_RE);
    if (reqMatch) {
      const reqId = reqMatch[1].toUpperCase();
      const title = reqMatch[2].trim();
      const reqLines = [lines[i]];

      i++;
      while (i < lines.length && !REQ_RE.test(lines[i])) {
        reqLines.push(lines[i]);
        i++;
      }

      const { text, acIds } = parseReqSection(reqId, title, reqLines);
      requirements[reqId] = { id: reqId, title, text, acIds };

      for (const line of reqLines) {
        const acMatch = line.match(AC_RE);
        if (acMatch) {
          const acId = acMatch[1].toUpperCase();
          acs[acId] = parseAcLine(acId, reqId, acMatch[2]);
        }
      }
    } else {
      i++;
    }
  }

  return { requirements, acs };
}

module.exports = { extractPrdContext, extractReqPriorities };
