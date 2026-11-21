'use strict';

/**
 * TRD-002: lightweight PRD REQ/AC parser for /ensemble:author-playwright-tests.
 *
 * A slimmed-down sibling of packages/product/lib/prd-feature-parser.js, deliberately
 * scoped to e2e-testing's own lib/ rather than imported cross-package (see
 * TRD-2026-da72aa86 PR 1 design notes). Fixes the two gaps in that parser
 * that are exactly why this module exists:
 *
 *   1. CRLF safety: prd-feature-parser.js's frontmatter regex requires a literal
 *      `\n` delimiter around `---` (packages/product/lib/prd-feature-parser.js:83),
 *      so it silently fails to match frontmatter in a CRLF (`\r\n`) file.
 *      This parser normalizes line endings up front so REQ/AC extraction and
 *      frontmatter both work regardless of source line-ending style.
 *   2. Title-Case frontmatter keys: prd-feature-parser.js's fallback frontmatter
 *      parser only matches single-word snake_case-ish keys
 *      (`^([A-Za-z0-9_]+):\s*(.*)$`), so two-word Title-Case keys like
 *      `Document ID:` / `Label:` never resolve. This parser normalizes ANY
 *      `Key Name:` / `key_name:` line into a camelCase field name before
 *      assigning it, so both styles resolve to the same output field.
 *
 * Pure function: no shell-out, no disk I/O — accepts PRD text as a string.
 */

// REQ heading, matching prd-feature-parser.js's REQ_HEADING_RE shape: "### REQ-001: ..."
// or the nested-under-a-feature-area "#### REQ-001 ..." form.
const REQ_HEADING_RE = /^#{3,4}\s+(REQ-\d+)\s*:?\s*(.*)$/i;

// Any heading at all — ends the current REQ's AC scope.
const HEADING_RE = /^#{1,6}\s+/;

// AC bullet line, bold or plain marker, colon inside or outside the bold run:
//   "- **AC-001-1:** Given ..."   or   "- AC-001-1: Given ..."
const AC_LINE_RE = /^\s*-\s+\*{0,2}\s*(AC-\d+(?:-\d+|[a-z])?)\s*[:*]*\s*(.*)$/i;

// Frontmatter block delimiters — only CRLF-tolerant once the text has already
// been run through normalizeLineEndings().
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

// Scalar frontmatter line: "key: value", "Key Name: value", "key_name: value".
const FRONTMATTER_LINE_RE = /^([A-Za-z][A-Za-z0-9_ ]*):\s*(.*)$/;

/** Normalize CRLF/CR to LF so every downstream regex can assume '\n'. */
function normalizeLineEndings(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Normalize a frontmatter key to camelCase regardless of source style:
 *   "Document ID" -> "documentId", "document_id" -> "documentId", "Label" -> "label"
 */
function toCamelKey(rawKey) {
  const words = String(rawKey).trim().split(/[\s_]+/).filter(Boolean);
  if (words.length === 0) return '';
  return words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join('');
}

/** Parse the `---`-delimited frontmatter block into a flat {camelKey: value} map. */
function parseFrontmatter(text) {
  const m = text.match(FRONTMATTER_RE);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(FRONTMATTER_LINE_RE);
    if (!kv) continue;
    const key = toCamelKey(kv[1]);
    if (!key) continue;
    out[key] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

/**
 * Parse a PRD's REQ-NNN/AC-NNN-M structure plus its `documentId`/`label`
 * frontmatter fields.
 *
 * @param {string} prdText
 * @returns {{
 *   documentId: string|null,
 *   label: string|null,
 *   reqs: Array<{id: string, acs: Array<{id: string, text: string}>}>
 * }}
 */
function parsePrdAcs(prdText) {
  const text = normalizeLineEndings(prdText);
  const fm = parseFrontmatter(text);

  const reqs = [];
  let current = null;
  const seenAc = new Set();

  for (const line of text.split('\n')) {
    const reqMatch = line.match(REQ_HEADING_RE);
    if (reqMatch) {
      current = { id: reqMatch[1].toUpperCase(), acs: [] };
      reqs.push(current);
      continue;
    }

    // Any other heading ends the current requirement's AC scope.
    if (HEADING_RE.test(line)) {
      current = null;
      continue;
    }

    if (!current) continue;

    const acMatch = line.match(AC_LINE_RE);
    if (!acMatch) continue;

    const id = acMatch[1].toUpperCase();
    if (seenAc.has(id)) continue; // duplicate id — first occurrence wins
    seenAc.add(id);
    current.acs.push({ id, text: acMatch[2].trim() });
  }

  return {
    documentId: fm.documentId || null,
    label: fm.label || null,
    reqs,
  };
}

module.exports = { parsePrdAcs, normalizeLineEndings, parseFrontmatter, toCamelKey };
