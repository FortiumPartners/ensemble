'use strict';

/**
 * Deterministic TRD parser.
 *
 * Extracts the "Scaffold Pass 1-7 + 4b/4c" parsing logic from
 * packages/development/commands/implement-trd-beads.yaml into a pure,
 * tested function. NO side effects, NO shell, NO br/git calls.
 *
 * The only external dependency is js-yaml, used solely to parse the
 * optional frontmatter block.
 *
 * @typedef {Object} ParsedTRD
 * @property {string} title
 * @property {string} summary
 * @property {string|null} prdReference
 * @property {number|null} designReadinessScore
 * @property {string|null} status
 * @property {boolean} prFormat
 * @property {Phase[]} phases
 * @property {Object.<string,Task>} tasksById
 * @property {string[]} warnings
 *
 * @typedef {Object} Phase
 * @property {number} n
 * @property {string} title
 * @property {string|null} shippableState
 * @property {string[]} taskIds
 *
 * @typedef {Object} Task
 * @property {string} id
 * @property {number} phaseN
 * @property {string} description
 * @property {boolean} isTest
 * @property {number|null} hourEstimate
 * @property {string[]} satisfies
 * @property {string|null} verifies
 * @property {string[]} validatesAcs
 * @property {string[]} dependsOn
 * @property {string[]} targetFiles
 * @property {string[]} actions
 * @property {string[]} implementationAc
 * @property {string[]} testAc
 * @property {string[]} nestedSubitems
 * @property {string[]} testSubitems
 * @property {string|null} proofOfRequirement
 */

let yaml = null;
try {
  // eslint-disable-next-line global-require
  yaml = require('js-yaml');
} catch {
  yaml = null; // frontmatter score will be unavailable but parser still runs
}

// ---------------------------------------------------------------------------
// Regular expressions (shared)
// ---------------------------------------------------------------------------

// Top-level task line: "- [ ] **TRD-001**: Description" / "- [x] **TRD-001-TEST**: ..."
// The bold id may carry a "-TEST" or "-TEST-S<k>" suffix.
const TASK_LINE_RE = /^(\s*)- \[[ xX]\]\s+\*\*(TRD-[A-Za-z0-9-]+)\*\*\s*:?\s*(.*)$/;

// Any checklist line (used to detect nested sub-items).
const CHECKLIST_LINE_RE = /^\s*- \[[ xX]\]\s+(.*)$/;

// Boundary headings within the Master Task List scope.
const PR_HEADING_RE = /^###\s+PR\s+(\d+)\s*:?\s*(.*)$/i;
const PHASE_HEADING_RE = /^###\s+Phase\s+(\d+)\s*:?\s*(.*)$/i;
const SPRINT_HEADING_RE = /^###\s+Sprint\s+(\d+)\s*:?\s*(.*)$/i;

// Test keyword detection for sub-items. Intentionally BROAD: recall over
// precision. A false-positive synthesized test bead is cheaper to close than
// a missed test. (See Pass 4c prose in implement-trd-beads.yaml.)
const TEST_KEYWORDS = [
  'integration test',
  'unit test',
  'test',
  'spec',
  'e2e',
  'coverage',
  'jest',
  'pytest',
  'rspec',
  'exunit',
  'xunit',
  'playwright',
];

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

/**
 * Split off a leading YAML frontmatter block.
 * @returns {{frontmatter: Object|null, body: string}}
 */
function parseSimpleFrontmatter(raw) {
  const out = {};
  for (const line of String(raw || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    let value = m[2].trim();
    const commentIndex = value.search(/\s+#/);
    if (commentIndex !== -1) value = value.slice(0, commentIndex).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else if (/^-?\d+(?:\.\d+)?$/.test(value)) {
      value = Number(value);
    } else if (/^(true|false)$/i.test(value)) {
      value = /^true$/i.test(value);
    }
    out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

function splitFrontmatter(md) {
  if (!md.startsWith('---')) {
    return { frontmatter: null, body: md };
  }
  // Find the closing --- on its own line.
  const lines = md.split('\n');
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return { frontmatter: null, body: md };
  }
  const raw = lines.slice(1, end).join('\n');
  let frontmatter = null;
  if (yaml) {
    try {
      const loaded = yaml.load(raw);
      if (loaded && typeof loaded === 'object') frontmatter = loaded;
    } catch {
      frontmatter = null;
    }
  }
  if (!frontmatter) frontmatter = parseSimpleFrontmatter(raw);
  const body = lines.slice(end + 1).join('\n');
  return { frontmatter, body };
}

/**
 * Extract the design readiness score from frontmatter, accepting both
 * `design_readiness_score` and `Design Readiness Score` keys.
 * @returns {number|null}
 */
function extractDesignReadinessScore(frontmatter) {
  if (!frontmatter) return null;
  const candidates = [
    'design_readiness_score',
    'Design Readiness Score',
    'design readiness score',
  ];
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(frontmatter, key)) {
      const v = frontmatter[key];
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      if (!Number.isNaN(n)) return n;
    }
  }
  // Case-insensitive fallback over all keys.
  for (const key of Object.keys(frontmatter)) {
    if (key.toLowerCase().replace(/[\s_]+/g, ' ') === 'design readiness score') {
      const v = frontmatter[key];
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pass 1 / Pass 2: title + summary
// ---------------------------------------------------------------------------

function extractTitle(lines) {
  for (const line of lines) {
    const m = line.match(/^#\s+(.*)$/);
    if (m) return m[1].trim();
  }
  return '';
}

/**
 * First non-empty prose paragraph after the H1. Skips "Based on PRD:",
 * blockquotes, and horizontal rules. Truncates to 500 chars.
 */
function extractSummary(lines) {
  let h1Index = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^#\s+/.test(lines[i])) {
      h1Index = i;
      break;
    }
  }
  if (h1Index === -1) return '';

  for (let i = h1Index + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (/^based on prd:/i.test(trimmed)) continue;
    if (/^prd:/i.test(trimmed)) continue;
    if (trimmed.startsWith('>')) continue; // blockquote
    if (/^-{3,}$/.test(trimmed)) continue; // horizontal rule
    if (/^#{1,6}\s/.test(trimmed)) break; // hit another heading before prose
    return trimmed.slice(0, 500);
  }
  return '';
}

// ---------------------------------------------------------------------------
// Pass 3: PRD reference
// ---------------------------------------------------------------------------

function looksLikePath(s) {
  if (!s) return false;
  return s.includes('/') || /\.md$/i.test(s);
}

/**
 * PRD reference, priority:
 *   (1) docs/PRD/*.md markdown link or bare path anywhere
 *   (2) "Based on PRD: <path>"
 *   (3) "PRD: <path>"
 */
function extractPrdReference(body, frontmatter) {
  // Priority 1: docs/PRD/*.md path (markdown link target or bare).
  const docsPrd = body.match(/docs\/PRD\/[^\s)>'"]+\.md/i);
  if (docsPrd && looksLikePath(docsPrd[0])) {
    return docsPrd[0];
  }

  // Priority 2: "Based on PRD: <path>"
  const basedOn = body.match(/Based on PRD:\s*\[?([^\]\s)>'"]+)/i);
  if (basedOn && looksLikePath(basedOn[1])) {
    return basedOn[1];
  }

  // Priority 3: "PRD: <path>"
  const prdLine = body.match(/(?:^|\n)\s*PRD:\s*\[?([^\]\s)>'"]+)/i);
  if (prdLine && looksLikePath(prdLine[1])) {
    return prdLine[1];
  }

  // Frontmatter fallback (prd_reference).
  if (frontmatter && frontmatter.prd_reference && looksLikePath(String(frontmatter.prd_reference))) {
    return String(frontmatter.prd_reference);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Master Task List scoping (Pass 3 scope)
// ---------------------------------------------------------------------------

/**
 * Returns { startLine, endLine, found } describing the slice of `lines`
 * that belongs to the Master Task List section. endLine is exclusive.
 */
function findMasterTaskListScope(lines) {
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Master Task List\s*$/i.test(lines[i].trim())) {
      start = i;
      break;
    }
  }
  if (start === -1) {
    return { startLine: 0, endLine: lines.length, found: false };
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]) && !/^###/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { startLine: start + 1, endLine: end, found: true };
}

// ---------------------------------------------------------------------------
// Annotation extraction helpers (Pass 6 / 7)
// ---------------------------------------------------------------------------

function extractSatisfies(text) {
  const out = [];
  const re = /\[satisfies\s+([^\]]+)\]/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    // A single [satisfies ...] may contain a REQ id or INFRA/ARCH token.
    const token = m[1].trim();
    const reqMatch = token.match(/REQ-\d+/i);
    if (reqMatch) {
      out.push(reqMatch[0].toUpperCase());
    } else if (/^(INFRA|ARCH)$/i.test(token)) {
      out.push(token.toUpperCase());
    } else {
      out.push(token);
    }
  }
  return out;
}

function extractVerifies(text) {
  const m = text.match(/\[verifies\s+(TRD-[A-Za-z0-9-]+)\]/i);
  return m ? m[1] : null;
}

function extractValidatesAcs(text) {
  // "Validates PRD ACs: AC-001-1, AC-002-2, ..."
  const m = text.match(/Validates PRD ACs?:\s*([^\n]+)/i);
  if (!m) return [];
  const acs = m[1].match(/AC-\d+-\d+/gi);
  return acs ? acs.map((a) => a.toUpperCase()) : [];
}

function extractInlineDepends(text) {
  const out = [];
  const re = /\[depends:\s*([^\]]+)\]/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const ids = m[1].match(/[a-z0-9][a-z0-9-]*#(?:TRD-[A-Za-z0-9-]+|PR-\d+)|TRD-[A-Za-z0-9-]+/gi);
    if (ids) ids.forEach((id) => out.push(id));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pass 4b: body field extraction
// ---------------------------------------------------------------------------

/**
 * Strip a markdown link wrapper / backticks / surrounding punctuation from a
 * captured file path.
 */
function cleanFilePath(raw) {
  return raw
    .trim()
    .replace(/^[`'"]+|[`'"]+$/g, '')
    .replace(/[.,;]+$/, '')
    .trim();
}

/**
 * Extract Target File(s) from body lines. Handles:
 *   "Target File: `path`"  /  "Target Files: a, b"  /  "File: path"
 */
function extractTargetFiles(bodyLines) {
  const files = [];
  for (const line of bodyLines) {
    const m = line.match(/^\s*-?\s*(?:Target Files?|File)\s*:\s*(.+)$/i);
    if (m) {
      // Multiple files may be comma-separated (and individually backticked).
      const parts = m[1].split(',');
      for (const p of parts) {
        const cleaned = cleanFilePath(p);
        if (cleaned) files.push(cleaned);
      }
    }
  }
  return files;
}

/**
 * Extract a numbered list that appears under an "Actions:" label.
 * Returns the raw text of each numbered item (number stripped).
 */
function extractLabeledNumberedList(bodyLines, label) {
  const out = [];
  let inSection = false;
  let sectionIndent = -1;
  const labelRe = new RegExp(`^\\s*-?\\s*${label}\\s*:?\\s*$`, 'i');
  for (const line of bodyLines) {
    if (labelRe.test(line)) {
      inSection = true;
      sectionIndent = line.search(/\S/);
      continue;
    }
    if (!inSection) continue;
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const numbered = line.match(/^(\s*)\d+\.\s+(.*)$/);
    if (numbered) {
      out.push(numbered[2].trim());
      continue;
    }
    // A new label-ish line at the same indent ends the section.
    const indent = line.search(/\S/);
    if (indent <= sectionIndent && /^\s*-?\s*[A-Z][A-Za-z ]+:\s*$/.test(line)) {
      inSection = false;
    } else if (indent <= sectionIndent && !numbered) {
      // dedented non-numbered content ends the numbered run
      inSection = false;
    }
  }
  return out;
}

/**
 * Extract checklist items ("- [ ]" / "- [x]") that appear under a labeled
 * block such as "Implementation AC:" / "Test AC:". Stops at the next labeled
 * block at the same or lesser indent.
 */
function extractLabeledChecklist(bodyLines, label) {
  const out = [];
  let inSection = false;
  let labelIndent = -1;
  const labelRe = new RegExp(`^(\\s*)-?\\s*${label}\\s*:?\\s*$`, 'i');
  for (const line of bodyLines) {
    const labelMatch = line.match(labelRe);
    if (labelMatch) {
      inSection = true;
      labelIndent = line.search(/\S/);
      continue;
    }
    if (!inSection) continue;
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const indent = line.search(/\S/);
    // AC items must be nested DEEPER than the label. A checklist or bullet at
    // the same-or-lesser indent is a sibling of the label (e.g. a loose nested
    // sub-item, or the next labeled block) and terminates the section — it is
    // NOT an AC entry.
    if (indent <= labelIndent) {
      inSection = false;
      continue;
    }
    const checklist = line.match(CHECKLIST_LINE_RE);
    if (checklist) {
      out.push(checklist[1].trim());
      continue;
    }
    // Plain bullet items also count as AC entries under the label.
    const bullet = line.match(/^\s*-\s+(.*)$/);
    if (bullet) {
      out.push(bullet[1].trim());
      continue;
    }
  }
  return out;
}

function extractProofOfRequirement(bodyLines) {
  for (const line of bodyLines) {
    const m = line.match(/^\s*-?\s*Proof of requirement\s*:\s*(.+)$/i);
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * Extract dependsOn from a body: from "Dependencies:" lines and inline
 * [depends: TRD-NNN] annotations. Also accepts source-qualified cross-TRD
 * references: <trd-slug>#TRD-NNN and <trd-slug>#PR-N. De-duplicates,
 * preserves document order.
 */
function extractDependsOn(bodyText, bodyLines) {
  const out = [];
  const seen = new Set();
  const push = (id) => {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  };

  // Inline [depends: TRD-NNN] (anywhere in body, incl. task line).
  for (const id of extractInlineDepends(bodyText)) push(id);

  // "Dependencies: TRD-001, TRD-002" lines.
  for (const line of bodyLines) {
    const m = line.match(/^\s*-?\s*Dependencies?\s*:\s*(.+)$/i);
    if (m) {
      const ids = m[1].match(/[a-z0-9][a-z0-9-]*#(?:TRD-[A-Za-z0-9-]+|PR-\d+)|TRD-[A-Za-z0-9-]+/gi);
      if (ids) ids.forEach((id) => push(id));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pass 4c: nested sub-item classification
// ---------------------------------------------------------------------------

function isTestSubitem(text) {
  const lower = text.toLowerCase();
  return TEST_KEYWORDS.some((kw) => lower.includes(kw));
}

// ---------------------------------------------------------------------------
// Core task body parsing (Pass 4 / 4b / 4c / 6 / 7)
// ---------------------------------------------------------------------------

/**
 * Build a Task object from its line index range within `scopeLines`.
 */
function buildTask(id, taskLineText, bodyLines, phaseN) {
  const bodyText = [taskLineText, ...bodyLines].join('\n');
  const fullText = bodyText;

  // Description = the task-line remainder, but stripped of trailing
  // annotations so it stays readable (we keep the human prose).
  let description = taskLineText
    .replace(/\[satisfies\s+[^\]]+\]/gi, '')
    .replace(/\[verifies\s+[^\]]+\]/gi, '')
    .replace(/\[depends:\s*[^\]]+\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Drop a trailing "(Nh)" estimate from the readable description? Keep it —
  // it is part of the human-readable task text. Just normalize whitespace.

  const isTest = /-TEST(-S\d+)?$/i.test(id);

  // hourEstimate from "(Nh)" (decimal allowed).
  let hourEstimate = null;
  const hourMatch = taskLineText.match(/\((\d+(?:\.\d+)?)h\)/i);
  if (hourMatch) hourEstimate = parseFloat(hourMatch[1]);

  // Annotations (task line + body).
  const satisfies = extractSatisfies(fullText);
  const verifies = extractVerifies(fullText);
  const validatesAcs = extractValidatesAcs(fullText);
  const dependsOn = extractDependsOn(fullText, bodyLines);

  // Body fields.
  const targetFiles = extractTargetFiles(bodyLines);
  const actions = extractLabeledNumberedList(bodyLines, 'Actions');
  const implementationAc = extractLabeledChecklist(bodyLines, 'Implementation AC');
  const testAc = extractLabeledChecklist(bodyLines, 'Test AC');
  const proofOfRequirement = extractProofOfRequirement(bodyLines);

  // nestedSubitems: LOOSE nested checklist work-items that have no structured
  // home — i.e. "- [ ]"/"- [x]" lines in the body that are NOT themselves a
  // top-level **TRD-** task AND were NOT already captured in actions /
  // implementationAc / testAc. AC-block items already live in
  // implementationAc/testAc; including them here would (a) double-count and
  // (b) leak AC lines mentioning a test keyword into testSubitems, producing
  // spurious synthesized test beads downstream.
  const claimed = new Set([...actions, ...implementationAc, ...testAc]);
  const nestedSubitems = [];
  for (const line of bodyLines) {
    if (TASK_LINE_RE.test(line)) continue; // another top-level task — excluded
    const cl = line.match(CHECKLIST_LINE_RE);
    if (cl) {
      const text = cl[1].trim();
      if (claimed.has(text)) continue; // already captured in an AC/Actions block
      nestedSubitems.push(text);
    }
  }
  const testSubitems = nestedSubitems.filter(isTestSubitem);

  return {
    id,
    phaseN,
    description,
    isTest,
    hourEstimate,
    satisfies,
    verifies,
    validatesAcs,
    dependsOn,
    targetFiles,
    actions,
    implementationAc,
    testAc,
    nestedSubitems,
    testSubitems,
    proofOfRequirement,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Parse a TRD markdown string into a structured ParsedTRD object.
 * Never throws on malformed input — problems are collected into `warnings`.
 *
 * @param {string} markdownString
 * @returns {ParsedTRD}
 */
function parseTRD(markdownString) {
  const warnings = [];
  const md = typeof markdownString === 'string' ? markdownString : '';

  const { frontmatter, body } = splitFrontmatter(md);
  const designReadinessScore = extractDesignReadinessScore(frontmatter);
  const status = frontmatter && frontmatter.status != null ? String(frontmatter.status) : null;

  const allLines = body.split('\n');

  // Pass 1 / 2.
  const title = extractTitle(allLines);
  const summary = extractSummary(allLines);

  // Pass 3 PRD reference (whole body).
  const prdReference = extractPrdReference(body, frontmatter);

  // Pass 3 scope: the Master Task List section.
  const scope = findMasterTaskListScope(allLines);
  if (!scope.found) {
    warnings.push('No "## Master Task List" heading found — parsing entire document as task scope');
  }
  const scopeLines = allLines.slice(scope.startLine, scope.endLine);

  // Pass 3 boundary detection within scope.
  // Identify all boundary headings and their kinds.
  const boundaries = [];
  let prFormat = false;
  let sawPR = false;
  let sawPhase = false;
  let sawSprint = false;

  for (let i = 0; i < scopeLines.length; i++) {
    const line = scopeLines[i];
    let m;
    if ((m = line.match(PR_HEADING_RE))) {
      boundaries.push({ lineIndex: i, n: parseInt(m[1], 10), title: m[2].trim(), kind: 'PR' });
      sawPR = true;
    } else if ((m = line.match(PHASE_HEADING_RE))) {
      boundaries.push({ lineIndex: i, n: parseInt(m[1], 10), title: m[2].trim(), kind: 'Phase' });
      sawPhase = true;
    } else if ((m = line.match(SPRINT_HEADING_RE))) {
      boundaries.push({ lineIndex: i, n: parseInt(m[1], 10), title: m[2].trim(), kind: 'Sprint' });
      sawSprint = true;
    }
  }

  // Detection priority: PR > Phase > Sprint > synthesize.
  let activeBoundaries;
  if (sawPR) {
    prFormat = true;
    activeBoundaries = boundaries.filter((b) => b.kind === 'PR');
  } else if (sawPhase) {
    prFormat = false;
    activeBoundaries = boundaries.filter((b) => b.kind === 'Phase');
  } else if (sawSprint) {
    prFormat = false;
    activeBoundaries = boundaries.filter((b) => b.kind === 'Sprint');
  } else {
    prFormat = false;
    activeBoundaries = []; // synthesized below
  }

  // Build phases.
  const phases = [];
  if (activeBoundaries.length === 0) {
    phases.push({ n: 1, title: 'Implementation', shippableState: null, taskIds: [], _startLine: 0 });
  } else {
    for (const b of activeBoundaries) {
      // Shippable State: next non-empty line after the heading.
      let shippableState = null;
      for (let j = b.lineIndex + 1; j < scopeLines.length; j++) {
        const t = scopeLines[j].trim();
        if (t === '') continue;
        const sm = t.match(/^\*\*Shippable State:\*\*\s*(.*)$/i);
        if (sm) shippableState = sm[1].trim();
        break; // only inspect the first non-empty line
      }
      if (prFormat && shippableState === null) {
        warnings.push(`PR ${b.n} (${b.title}) is missing a Shippable State line`);
      }
      phases.push({
        n: b.n,
        title: b.title,
        shippableState,
        taskIds: [],
        _startLine: b.lineIndex,
      });
    }
  }

  // Helper: find the phase a given scope-line index belongs to (most recent
  // preceding boundary heading).
  function phaseForLine(lineIndex) {
    if (activeBoundaries.length === 0) return phases[0];
    let chosen = phases[0];
    for (const p of phases) {
      if (p._startLine <= lineIndex) chosen = p;
      else break;
    }
    return chosen;
  }

  // Pass 4 / 4b / 4c / 6 / 7: walk scope lines, collect task line ranges.
  const tasksById = {};
  const taskOrder = [];

  // First, find all top-level task line indices within scope.
  const taskLineIndices = [];
  for (let i = 0; i < scopeLines.length; i++) {
    if (TASK_LINE_RE.test(scopeLines[i])) {
      taskLineIndices.push(i);
    }
  }

  for (let t = 0; t < taskLineIndices.length; t++) {
    const startIdx = taskLineIndices[t];
    const taskLine = scopeLines[startIdx];
    const m = taskLine.match(TASK_LINE_RE);
    const id = m[2];
    const descRemainder = taskLine; // pass whole line; buildTask strips annotations

    // Body = lines from after the task line up to (excluding):
    //   - next top-level task line, OR
    //   - next "### " heading, OR
    //   - next "## " heading, OR
    //   - EOF of scope.
    let bodyEnd = scopeLines.length;
    for (let j = startIdx + 1; j < scopeLines.length; j++) {
      const line = scopeLines[j];
      if (TASK_LINE_RE.test(line)) {
        bodyEnd = j;
        break;
      }
      if (/^###\s/.test(line) || /^##\s/.test(line)) {
        bodyEnd = j;
        break;
      }
    }
    const bodyLines = scopeLines.slice(startIdx + 1, bodyEnd);

    const phase = phaseForLine(startIdx);
    const task = buildTask(id, descRemainder, bodyLines, phase.n);

    if (Object.prototype.hasOwnProperty.call(tasksById, id)) {
      warnings.push(`Duplicate task id: ${id}`);
      // Keep the first occurrence; do not overwrite.
    } else {
      tasksById[id] = task;
      taskOrder.push(id);
      phase.taskIds.push(id);
    }
  }

  if (taskOrder.length === 0) {
    warnings.push('No tasks found in the TRD');
  }

  // Strip the internal _startLine helper before returning.
  const cleanPhases = phases.map((p) => ({
    n: p.n,
    title: p.title,
    shippableState: p.shippableState,
    taskIds: p.taskIds,
  }));

  return {
    title,
    summary,
    prdReference,
    designReadinessScore,
    status,
    prFormat,
    phases: cleanPhases,
    tasksById,
    warnings,
  };
}

module.exports = { parseTRD };
