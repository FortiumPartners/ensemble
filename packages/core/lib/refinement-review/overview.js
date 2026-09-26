'use strict';

/**
 * Derive a plain-language customer view from PRD/TRD markdown.
 *
 * The customer-facing Overview tab must be readable by a non-technical
 * stakeholder: no requirement tables, no REQ/AC ids, no Given/When/Then. When
 * the refinement command supplies an authored `document.customerSummary` the
 * server uses that verbatim; this module is the fallback that recovers a
 * presentable summary from the document body itself.
 *
 * Strategy is an allowlist of customer-oriented section headings, never a
 * blocklist of "detail" sections. A blocklist leaks requirement tables from any
 * heading it fails to recognise; an allowlist degrades to an empty summary,
 * which the server renders as an explicit empty state.
 */

const DEFAULT_TITLE = 'Product overview';

const FOOTER = '\n\n_This is a plain-language summary. Open the Refinement tab for the full document._';

/** Applied to the normalized (lowercased, decoration-stripped) heading text. */
const CUSTOMER_SECTION_PATTERNS = [
  /^executive summary/, /^summary/, /^overview/, /^problem/, /^background/,
  /^context/, /^goals?/, /^objectives?/, /^success (metrics|criteria)/,
  /^outcomes?/, /^target (users?|audience)/, /^users?\b/, /^personas?/,
  /^value/, /^scope/,
  // canonical customerSummary section headings (refine-prd step 2b)
  /^what (we'?re|are) building/, /^who it'?s for/, /^why it matters/,
  /^what changes for you/, /^what.?s not included/, /^what we need from you/,
];

/** Cap on customer-facing content lines, so a huge document cannot flood the tab. */
const MAX_LINES = 400;

const HEADING_RE = /^(#{1,6})\s+([^#].*?)\s*#*\s*$/;

/**
 * Normalize a heading line to comparable text: drop the hashes, then peel any
 * leading decoration ("## 🎯 Goals") or ordinal ("### 2.1) Background") in
 * whichever order they appear, then lowercase and trim.
 * @param {string} line
 * @returns {string}
 */
function normalizeHeading(line) {
  let t = String(line).replace(/^#{1,6}\s+/, '');
  for (;;) {
    const next = t
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .replace(/^\s*\d+(\.\d+)*[.)]?\s+/, '');
    if (next === t) break;
    t = next;
  }
  return t.trim().toLowerCase();
}

/**
 * True when normalized heading text names a section a customer should read.
 * @param {string} normalized
 * @returns {boolean}
 */
function isCustomerHeading(normalized) {
  return CUSTOMER_SECTION_PATTERNS.some((re) => re.test(normalized));
}

/**
 * True for lines carrying implementation detail a customer should not see.
 * @param {string} line
 * @returns {boolean}
 */
function isDetailLine(line) {
  if (/^\s*\|/.test(line)) return true; // table row
  if (/\[NEEDS CLARIFICATION/i.test(line)) return true;
  if (/\[RISK\b/i.test(line)) return true; // internal risk register
  if (/^\s*(?:[-*]\s*)?(?:\*\*)?(?:REQ|AC|NFR)-\d+/i.test(line)) return true; // requirement id
  if (/^\s*(?:[-*]\s*)?(?:\*\*)?(given|when|then)\b/i.test(line)) return true; // Given/When/Then
  return false;
}

/**
 * Derive the customer overview for a document.
 *
 * Never throws: absent or non-string input yields the empty shape, which the
 * server turns into a 200 with an empty-state payload rather than an error.
 *
 * @param {string} markdown - full source document text
 * @returns {{title: string, markdown: string, source: 'derived'|'empty'}}
 */
function deriveCustomerOverview(markdown) {
  if (typeof markdown !== 'string' || !markdown.trim()) {
    return { title: DEFAULT_TITLE, markdown: '', source: 'empty' };
  }

  const lines = markdown.split(/\r\n|\r|\n/);

  let title = DEFAULT_TITLE;
  for (const line of lines) {
    const m = HEADING_RE.exec(line);
    if (m && m[1].length === 1) {
      const text = m[2].trim();
      if (text) title = text;
      break;
    }
  }

  /** One entry per captured section: its heading, then what was kept under it. */
  const sections = [];
  let kept = 0;
  let inFence = false;
  let open = null; // { level, section } while capturing, else null

  for (const line of lines) {
    const m = HEADING_RE.exec(line);

    if (m && !inFence) {
      const level = m[1].length;
      // A heading at or above the open section's depth closes it; strictly
      // deeper headings are kept as structure inside it.
      if (open && level <= open.level) open = null;
      // While a section is open (i.e. `open` is truthy here), a further
      // customer-looking heading deliberately does NOT start a second section.
      if (!open && isCustomerHeading(normalizeHeading(line))) {
        const section = { heading: line, lines: [] };
        sections.push(section);
        open = { level, section };
        continue; // heading tracked separately; must not also land in `lines`
      }
      // A nested heading that is not a new section: keep it if inside a
      // section (unless it names a requirement, which is detail like any
      // other REQ/AC/NFR line), drop it if outside one.
      if (open && !isDetailLine(m[2])) open.section.lines.push(line);
      continue;
    }

    if (!open) continue;

    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue; // fence markers and their contents are dropped
    }
    if (inFence) continue;

    if (isDetailLine(line)) continue;

    // Blank lines are structural padding, not content, so they never consume
    // the cap; otherwise a well-spaced document truncates early.
    if (line.trim()) {
      if (kept >= MAX_LINES) continue;
      kept += 1;
    }
    open.section.lines.push(line);
  }

  // A section counts only if something survived under its heading; otherwise a
  // fully-stripped section would contribute a dangling title.
  const keptSections = sections.filter((s) => s.lines.some((l) => l.trim()));
  if (keptSections.length === 0) {
    return { title, markdown: '', source: 'empty' };
  }

  const body = keptSections
    .map((s) => [s.heading].concat(s.lines).join('\n').replace(/\n{3,}/g, '\n\n').trim())
    .join('\n\n');

  return { title, markdown: `# ${title}\n\n${body}${FOOTER}`, source: 'derived' };
}

module.exports = {
  deriveCustomerOverview,
  normalizeHeading,
  DEFAULT_TITLE,
  CUSTOMER_SECTION_PATTERNS,
};
