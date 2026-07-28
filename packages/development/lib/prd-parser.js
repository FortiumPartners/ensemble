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

const REQ_RE = /^#{1,3}\s+(REQ-\d+)\s*[—–-]\s*(.+)/i;
const AC_RE = /^\s*\*\*(AC-\d+-\d+):?\*\*:?\s*(.+)/i;
const GIVEN_RE = /\bGiven\b([^,]*)/i;
const WHEN_RE = /\bWhen\b([^,]*)/i;
const THEN_RE = /\bThen\b([^.]*)/i;

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

module.exports = { extractPrdContext };
