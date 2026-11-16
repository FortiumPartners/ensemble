#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `ensemble-trd-dependency-graph` eval. The agent graphs the four seeded TRDs in docs/TRD and saves its
 * report to docs/trd-graph-report.md (the skill itself only prints; the prompt asks for the file so a script can read it).
 * Expected facts, derived from the fixture and confirmed against packages/development/lib/trd-graph-cli.js:
 *   edges (dependent --> dependency): checkout --> inventory, promotions --> inventory   (the only valid cross-TRD refs)
 *   overlap: checkout <-> promotions share src/Pricing.js
 *   warning: reports#TRD-002 depends on checkout#TRD-009, which does not exist (unresolved; never an edge)
 *   no cycle; the TRDs are read-only.
 * A TRD is recognised by its short name (inventory, checkout, promotions, reports), which is in the slug and the label.
 * Reads go through lib.js (no symlinks, bounded); nothing is executed.
 */

const { fail, readText, listFiles, clean, run } = require('./lib');

const REPORT = 'docs/trd-graph-report.md';
const KEYS = ['inventory', 'checkout', 'promotions', 'reports'];
const WANTED_EDGES = ['checkout>inventory', 'promotions>inventory'];
const MAX_LINES = 5000;
const MAX_LINE = 2000;

/** The report text, or a failure naming the file. */
function report() {
  const t = readText(REPORT);
  return t === null ? fail(`${REPORT} was not written`) : t;
}
const lines = (t) => t.split('\n', MAX_LINES).map((l) => l.slice(0, MAX_LINE));
/** Blank-line separated blocks (paragraph, table, fenced diagram), lower-cased. */
const blocks = (t) => t.toLowerCase().split(/\n[ \t]*\n/, MAX_LINES).map((b) => b.slice(0, 20000));
/** First TRD short name in `s` by position, or null. */
function firstKey(s) {
  let best = null;
  let at = Infinity;
  for (const k of KEYS) { const i = s.indexOf(k); if (i >= 0 && i < at) { at = i; best = k; } }
  return best;
}

/**
 * Edges drawn in the report as `from --> to` lines (Mermaid `-->`, DOT `->`), as 'from>to' keys. A side is a TRD when its text names one;
 * otherwise its leading identifier is looked up in the node definitions (`A["trd-checkout"]`, `A(["..."])`) found anywhere in the text.
 */
function drawnEdges(text) {
  const all = lines(text).map((l) => l.toLowerCase());
  const alias = new Map();
  const def = /(^|[\s;])([a-z_][a-z0-9_]{0,60})\s*(?:\(\[|\[\[|\(\(|\[|\(|\{)\s*"?([^"\])}\n]{1,80})/g;
  for (const l of all) {
    for (const m of l.matchAll(def)) { const k = firstKey(m[3]); if (k) alias.set(m[2], k); }
  }
  const side = (s) => {
    const t = s.replace(/^\s*\|[^|]{0,80}\|/, '');
    const direct = firstKey(t);
    if (direct) return direct;
    const id = /^\s*"?([a-z_][a-z0-9_]{0,60})/.exec(t);
    return id ? alias.get(id[1]) || null : null;
  };
  const out = new Set();
  for (const l of all) {
    const arrow = /-+>/.exec(l);
    if (!arrow) continue;
    const left = l.slice(0, arrow.index);
    const rest = l.slice(arrow.index + arrow[0].length);
    const nextArrow = /-+>/.exec(rest);
    const from = side(left.replace(/[^a-z0-9_"[\](){}.\- ]/g, ' ').split(/\s{2,}/).pop());
    const to = side(nextArrow ? rest.slice(0, nextArrow.index) : rest);
    if (from && to && from !== to) out.add(`${from}>${to}`);
  }
  return out;
}

const CHECKS = {
  // The report file exists, has substance and names all four TRDs.
  'report-saved': () => {
    const t = report();
    if (t.trim().length < 200) fail(`${REPORT} is nearly empty (${t.trim().length} characters)`);
    const low = t.toLowerCase();
    const missing = KEYS.filter((k) => !low.includes(k));
    if (missing.length) fail(`${REPORT} never mentions the TRD(s): ${missing.join(', ')}`);
    return `${REPORT} saved, names all ${KEYS.length} TRDs`;
  },

  // Both real cross-TRD dependencies are drawn, dependent --> dependency. A reversed arrow or a missing edge fails.
  // Mild flake risk: a baseline that draws the opposite direction by convention fails here; that measures the plugin's convention.
  'graph-edges': () => {
    const edges = drawnEdges(report());
    const missing = WANTED_EDGES.filter((e) => !edges.has(e));
    if (missing.length) fail(`edge(s) not drawn as dependent --> dependency: ${missing.join(', ')} (drawn: ${[...edges].join(', ') || 'none'})`);
    return `drew ${WANTED_EDGES.join(' and ')}`;
  },

  // No edge beyond the two real ones: the unresolved reports -> checkout#TRD-009 ref is no edge, overlap is no dependency, bare TRD-001 is intra-TRD.
  'graph-edges-only': () => {
    const edges = drawnEdges(report());
    if (edges.size === 0) fail('no edge could be read from the report, so there is nothing to judge');
    const extra = [...edges].filter((e) => !WANTED_EDGES.includes(e));
    if (extra.length) fail(`edge(s) that are not valid cross-TRD dependencies: ${extra.join(', ')}`);
    return `only the ${WANTED_EDGES.length} valid edges are drawn`;
  },

  // The likely-duplicate pair (checkout, promotions) is reported together with the file they share.
  'overlap-reported': () => {
    const hit = blocks(report()).some((b) => b.includes('checkout') && b.includes('promotions') && b.includes('pricing.js')
      && /overlap|shared?\b|both|duplicat|same|common|collid|conflict/.test(b));
    if (!hit) fail('no passage names checkout and promotions together with src/Pricing.js as an overlap');
    return 'checkout and promotions reported as overlapping on src/Pricing.js';
  },

  // The shared file is attributed to the two TRDs that touch it, not also to inventory or reports (which share nothing). Per line.
  'overlap-only-pair': () => {
    const on = lines(report()).map((l) => l.toLowerCase()).filter((l) => l.includes('pricing.js'));
    if (on.length === 0) fail('no line names src/Pricing.js');
    const wrong = on.find((l) => l.includes('inventory') || l.includes('reports'));
    if (wrong) fail(`src/Pricing.js is attributed to a TRD that does not touch it: ${clean(wrong.trim())}`);
    return 'src/Pricing.js is attributed to checkout and promotions only';
  },

  // The skill's advice: extract the shared work into one foundational/shared TRD that both reference with [depends: ...].
  // Phrasing varies; the check accepts several wordings and is the most phrasing-sensitive one (flaky if the vocabulary drifts).
  'extract-suggested': () => {
    const hit = blocks(report()).some((b) => (b.includes('pricing') || (b.includes('checkout') && b.includes('promotions')))
      && /extract|foundational|consolidat|factor|single (?:trd|source|shared)|one (?:shared|common|foundational)|shared trd|move .{0,40}(?:into|to) a/.test(b)
      && /depend|referenc/.test(b));
    if (!hit) fail('no suggestion to extract the shared Pricing work into one foundational TRD that both reference');
    return 'suggests extracting the shared work into a foundational TRD referenced by both';
  },

  // The dangling reference reports -> checkout#TRD-009 is surfaced as a warning (not silently dropped).
  'warning-surfaced': () => {
    const hit = blocks(report()).some((b) => b.includes('trd-009')
      && /unresolved|unknown|missing|not found|does not exist|doesn't exist|dangling|broken|invalid|no such|nonexistent|not exist/.test(b));
    if (!hit) fail('the unresolved reference to checkout#TRD-009 is not reported as a warning');
    return 'unresolved checkout#TRD-009 reference reported';
  },

  // The skill is read-only: the four TRDs are unchanged (sentinel lines intact, no file added or removed under docs/TRD).
  'trds-untouched': () => {
    const SENTINELS = {
      'TRD-2026-aaaa1111-inventory.md': ['document_id: TRD-2026-aaaa1111', 'Target Files: src/Inventory.js'],
      'TRD-2026-bbbb2222-checkout.md': ['document_id: TRD-2026-bbbb2222', '[depends: trd-2026-aaaa1111-inventory#TRD-001]', 'Target Files: src/Cart.js, src/Pricing.js'],
      'TRD-2026-cccc3333-promotions.md': ['document_id: TRD-2026-cccc3333', '[depends: trd-2026-aaaa1111-inventory#TRD-001]', 'Target Files: src/Pricing.js, src/Promo.js'],
      'TRD-2026-dddd4444-reports.md': ['document_id: TRD-2026-dddd4444', '[depends: trd-2026-bbbb2222-checkout#TRD-009]', 'Target Files: src/Report.js', 'Target Files: src/ReportView.js'],
    };
    const present = listFiles('docs/TRD', /./);
    const want = Object.keys(SENTINELS).sort();
    if (present.join('|') !== want.join('|')) fail(`docs/TRD changed: has ${clean(present.join(', ')) || 'nothing'}, expected ${want.join(', ')}`);
    for (const [file, needles] of Object.entries(SENTINELS)) {
      const t = readText(`docs/TRD/${file}`);
      const gone = needles.find((n) => t === null || !t.includes(n));
      if (gone) fail(`${file} was modified (lost: ${gone})`);
    }
    return 'the four TRDs are unchanged';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS };
