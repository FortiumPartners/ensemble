#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `architecture-overview-report` skill eval. The working directory is the agent's workspace (the fixture
 * is a five-repo portfolio of per-repo architecture files under docs/assessment/). Nothing here renders Mermaid (the skill's own
 * validation step needs `npx @mermaid-js/mermaid-cli`, which needs network): `mermaid-wellformed` is a structural lint (header, balanced
 * brackets and subgraph/end, edges present), which catches broken diagrams but is NOT a proof that Mermaid would render them.
 *
 * Flaky or judgement-adjacent checks are marked FLAKY below; they rely on how the model names nodes, and a real trial may show they
 * are too strict. All regular expressions are linear (bounded, anchored per line); input is hostile.
 */

const { fail, readText, listFiles, walk, need, list, clean, section, run } = require('./lib');

const DIR = 'docs/assessment';
const OVERVIEW_RE = /^architecture-overview-(\d{4}-\d{2}-\d{2})\.md$/;
const SRC_RE = /-architecture\.md$/;
const DIAGRAM_HEADER = /^(?:graph|flowchart)\s+(TB|TD|BT|LR|RL)\b/;
// An edge operator: `-->`, `---`, `-.->`, `-.-`, `==>` (labels in `|..|` follow it). Anchored alternatives, no nesting.
const ARROW = /\s*(?:<?-{2,}>?|<?={2,}>?|-\.+-?>?)\s*(?:\|[^|\n]{0,200}\|)?\s*/;
const DOTTED = /-\.+-?>?/;

const overviewFile = () => {
  const names = listFiles(DIR, OVERVIEW_RE);
  if (names.length === 0) fail(`no ${DIR}/architecture-overview-<YYYY-MM-DD>.md was written`);
  if (names.length > 1) fail(`more than one overview file: ${clean(names.join(', '))}`);
  return `${DIR}/${names[0]}`;
};
const overviewText = () => { const f = overviewFile(); return { file: f, text: readText(f) || fail(`${clean(f)} is empty or unreadable`) }; };

/** Mermaid blocks of a document: [{ body, lines }]; an unterminated fence fails. */
function mermaidBlocks(text) {
  const lines = text.split('\n').map((l) => l.slice(0, 2000));
  const blocks = [];
  let cur = null;
  for (const line of lines) {
    const t = line.trim();
    if (cur === null) { if (/^```\s*mermaid\s*$/i.test(t)) cur = []; } else if (/^```\s*$/.test(t)) { blocks.push(cur); cur = null; } else cur.push(line);
  }
  if (cur !== null) fail('a ```mermaid block is never closed');
  return blocks.map((b) => ({ lines: b, body: b.join('\n') }));
}

/** Lines of a block that are statements (not blank, not `%%` comments). */
const stmts = (b) => b.lines.map((l) => l.trim()).filter((l) => l && !l.startsWith('%%'));

/** id -> label for every `id[label]`, `id(label)`, `id{label}`, `id([label])`, `id[(label)]` definition in a block. */
function labels(b) {
  const m = new Map();
  for (const line of stmts(b)) {
    const re = /([A-Za-z_][\w-]{0,60})\s*(?:\[\[|\[\(|\(\(|\(\[|\[|\(|\{)\s*"?([^\])}"\n]{0,100})/g;
    let x = re.exec(line);
    while (x) { m.set(x[1], x[2]); x = re.exec(line); }
  }
  return m;
}

/** Edges of a block as [{ line, pairs: [[idA, idB]], dotted }]; ids are the first identifier of each segment around an operator. */
function edges(b) {
  const out = [];
  for (const raw of stmts(b)) {
    if (/^(?:subgraph|end|direction|classDef|class|style|linkStyle|graph|flowchart)\b/.test(raw)) continue;
    const line = raw.replace(/--\s+[^->|\n]{1,80}?\s+(-->|---)/g, '$1'); // `A -- text --> B` -> `A --> B`
    if (!ARROW.test(line)) continue;
    const segs = line.split(ARROW).map((s) => /^\s*([A-Za-z_][\w-]{0,60})/.exec(s)).map((m) => (m ? m[1] : null));
    const pairs = [];
    for (let i = 0; i + 1 < segs.length; i += 1) if (segs[i] && segs[i + 1]) pairs.push([segs[i], segs[i + 1]]);
    if (pairs.length) out.push({ line: raw, pairs, dotted: DOTTED.test(raw) });
  }
  return out;
}

/** Whether node id `id` (id or its label) matches `re` in block `b`. */
const matches = (b, id, re) => re.test(id) || re.test(labels(b).get(id) || '');
const rx = (s) => { try { return new RegExp(s, 'i'); } catch { return fail(`bad pattern ${clean(s)}`); } };

const CHECKS = {
  // The skill's Procedure step 8: the file name and the **Date:** line agree.
  'overview-saved': () => {
    const { file, text } = overviewText();
    const date = OVERVIEW_RE.exec(file.split('/').pop())[1];
    if (!/^#\s+.{0,120}Architectural Overview\s*$/im.test(text)) fail('no "# <name> — Architectural Overview" title');
    const d = /^\*\*Date:\*\*\s*(\d{4}-\d{2}-\d{2})/m.exec(text);
    if (!d) fail('no "**Date:** YYYY-MM-DD" line');
    if (d[1] !== date) fail(`**Date:** ${d[1]} does not match the file name date ${date}`);
    if (!/^\*\*Sources:\*\*/m.test(text)) fail('no "**Sources:**" line');
    if (!section(text, /portfolio system context/i)) fail('no "Portfolio System Context" section');
    return `${file} dated ${date}`;
  },

  // Every per-repo architecture file in the workspace is named in the overview (Sources).
  'sources-listed': () => {
    const { text } = overviewText();
    const srcs = listFiles(DIR, SRC_RE);
    if (srcs.length < 2) fail('the workspace lost its per-repo architecture files');
    const missing = srcs.filter((s) => !text.includes(s));
    if (missing.length) fail(`Sources/body does not name ${clean(missing.join(', '))}`);
    return `names all ${srcs.length} source files`;
  },

  // Structural lint only. NOT a render: see the file header.
  'mermaid-wellformed': (o) => {
    const { text } = overviewText();
    const blocks = mermaidBlocks(text);
    const min = Number(o.min || 2);
    if (blocks.length < min) fail(`${blocks.length} mermaid block(s); need the portfolio diagram plus at least ${min - 1} per-platform diagram(s)`);
    blocks.forEach((b, i) => {
      const n = i + 1;
      const first = stmts(b)[0] || '';
      if (!DIAGRAM_HEADER.test(first)) fail(`diagram ${n} does not start with graph/flowchart <TB|TD|LR|...>`);
      if (i === 0 && !/^(?:graph|flowchart)\s+TB\b/.test(first)) fail('the portfolio system-context diagram is not "graph TB"');
      let depth = 0;
      for (const line of stmts(b)) {
        if (/^subgraph\b/.test(line)) depth += 1;
        else if (/^end\s*$/.test(line)) depth -= 1;
        if (depth < 0) fail(`diagram ${n} has an "end" without a subgraph`);
        for (const [open, close] of [['[', ']'], ['(', ')'], ['{', '}']]) {
          if (line.split(open).length !== line.split(close).length) fail(`diagram ${n} has unbalanced ${open}${close}: ${clean(line)}`);
        }
        if ((line.match(/"/g) || []).length % 2) fail(`diagram ${n} has an unclosed quote: ${clean(line)}`);
      }
      if (depth !== 0) fail(`diagram ${n} has a subgraph without "end"`);
      if (edges(b).length < 2) fail(`diagram ${n} has fewer than 2 edges (empty or near-empty)`);
      if (labels(b).size < 3) fail(`diagram ${n} has fewer than 3 labelled nodes`);
    });
    return `${blocks.length} diagrams, structurally well-formed (not rendered)`;
  },

  // Edges that the sources document must appear (undirected) in the portfolio diagram. `--edges console~bff,bff~keycloak` (regexes).
  // FLAKY: depends on node ids/labels containing the repo or product name.
  'context-edges': (o) => {
    const { text } = overviewText();
    const [b] = mermaidBlocks(text);
    if (!b) fail('no mermaid block');
    const es = edges(b);
    const missing = [];
    for (const spec of list(need(o, 'edges'))) {
      const [a, z] = spec.split('~').map(rx);
      const hit = es.some((e) => e.pairs.some(([p, q]) => (matches(b, p, a) && matches(b, q, z)) || (matches(b, p, z) && matches(b, q, a))));
      if (!hit) missing.push(spec);
    }
    if (missing.length) fail(`portfolio diagram lacks the documented edge(s): ${clean(missing.join(', '))}`);
    return 'all documented integration edges are in the portfolio diagram';
  },

  // The isolated product has no edge to the other platforms and is said to be isolated. `--isolated billing --others console|bff|...`
  'isolated-not-merged': (o) => {
    const { text } = overviewText();
    const iso = rx(need(o, 'isolated'));
    const others = rx(need(o, 'others'));
    for (const b of mermaidBlocks(text)) {
      for (const e of edges(b)) {
        for (const [p, q] of e.pairs) {
          const bad = (matches(b, p, iso) && matches(b, q, others)) || (matches(b, q, iso) && matches(b, p, others));
          if (bad) fail(`an edge links the isolated product to another platform: ${clean(e.line)}`);
        }
      }
    }
    const noted = text.split('\n').some((l) => iso.test(l) && /isolated|standalone|stand-alone|no cross-repo|no integration|no shared|separate|independent/i.test(l));
    if (!noted) fail('the isolated product is never described as isolated/standalone');
    return 'isolated product is not wired to the others and is noted as isolated';
  },

  // The structural-only repo is flagged lower-confidence in prose and gets no solid, unmarked edge. `--weak inventory`
  'lower-confidence-marked': (o) => {
    const { text } = overviewText();
    const weak = rx(need(o, 'weak'));
    const said = text.split('\n').some((l) => weak.test(l) && /inferred|lower[- ]confidence|low[- ]confidence|unconfirmed|not confirmed|structural|tentative|speculative/i.test(l));
    if (!said) fail('the structural-only repo is never labelled inferred/lower-confidence/structural');
    for (const b of mermaidBlocks(text)) {
      for (const e of edges(b)) {
        const touches = e.pairs.some(([p, q]) => matches(b, p, weak) || matches(b, q, weak));
        if (touches && !e.dotted && !/inferred|unconfirmed|lower|low[- ]confidence|\?/i.test(e.line)) fail(`a solid, unmarked edge is drawn for the structural-only repo: ${clean(e.line)}`);
      }
    }
    return 'structural-only repo is marked lower-confidence';
  },

  // No port number in a diagram that the sources do not contain. `--min-ports` not needed: a diagram with no port passes.
  'diagram-grounded': () => {
    const { text } = overviewText();
    const src = listFiles(DIR, SRC_RE).map((f) => readText(`${DIR}/${f}`) || '').join('\n');
    if (!src) fail('no source architecture files');
    for (const b of mermaidBlocks(text)) {
      const seen = new Set();
      for (const line of stmts(b)) {
        const re = /(?:^|[^\w.])(\d{4,5})(?![\w.])/g;
        let m = re.exec(line);
        while (m) { seen.add(m[1]); m = re.exec(line); }
      }
      for (const n of seen) if (!new RegExp(`(?:^|[^\\d])${n}(?:[^\\d]|$)`).test(src)) fail(`a diagram shows ${n}, which no source architecture file mentions`);
    }
    return 'every port in the diagrams appears in the sources';
  },

  // A per-platform diagram built from the Layering Assessment: `--layers controller,service,repository` all in one non-portfolio block.
  // FLAKY: model may label layers differently.
  'platform-diagram': (o) => {
    const { text } = overviewText();
    const terms = list(need(o, 'layers')).map(rx);
    const rest = mermaidBlocks(text).slice(1);
    const ok = rest.some((b) => { const body = b.body; return terms.every((t) => t.test(body)) && edges(b).length >= terms.length - 1; });
    if (!ok) fail(`no per-platform diagram contains all of the documented layers (${clean(o.layers)}) with edges between them`);
    return 'a per-platform diagram shows the documented layers';
  },

  // Table with the four columns, one row per shared dependency, evidence cited as file:line. `--require keycloak,contracts`
  'integration-table': (o) => {
    const { text } = overviewText();
    const sec = section(text, /integration points/i);
    if (!sec) fail('no "Integration Points" section');
    const rows = sec.body.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
    const header = rows[0] || '';
    if (!/integration/i.test(header) || !/consumers/i.test(header) || !/evidence/i.test(header) || !/risk/i.test(header)) fail('table header lacks Integration point | Consumers | Evidence | Risk');
    const data = rows.slice(1).filter((r) => !/^\|[\s:|-]*\|?$/.test(r)).map((r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
    if (data.length < 3) fail(`${data.length} data row(s); need one per shared dependency (at least 3)`);
    const cols = header.replace(/^\||\|$/g, '').split('|').length;
    for (const r of data) if (r.length !== cols || r.some((c) => !c)) fail(`a row has an empty or missing cell: ${clean(r.join(' | '))}`);
    const cite = /[\w./-]{1,80}\.[A-Za-z]{1,6}:\d{1,5}/;
    for (const want of list(need(o, 'require'))) {
      const re = rx(want);
      const row = data.find((r) => re.test(r[0]));
      if (!row) fail(`no row for the shared dependency "${clean(want)}"`);
      if (!/console/i.test(row[1]) || !/bff/i.test(row[1])) fail(`the "${clean(want)}" row does not name both consumers (console and bff)`);
      if (!cite.test(row[2])) fail(`the "${clean(want)}" row cites no file:line evidence`);
    }
    return `${data.length} rows, required dependencies present with consumers and file:line evidence`;
  },

  // 5-8 ranked risks, the many-consumer contract risk above the single-host billing risk. FLAKY (ordering by model wording).
  'risks-ranked': (o) => {
    const { text } = overviewText();
    const sec = section(text, /(?:summary.*risks?|significant risks|highest[- ]leverage|top risks)/i, { toEnd: true });
    if (!sec) fail('no "Summary of ... Risks" section');
    const items = [];
    for (const line of sec.body.split('\n')) {
      if (/^(?:\d+[.)]|[-*])\s+\S/.test(line)) items.push(line);
      else if (items.length && /^\s+\S/.test(line)) items[items.length - 1] += ` ${line.trim()}`;
    }
    if (items.length < 5 || items.length > 8) fail(`${items.length} risk items; the skill asks for 5-8`);
    const terms = list(need(o, 'terms')).map(rx);
    const untraced = items.find((i) => !terms.some((t) => t.test(i)));
    if (untraced) fail(`a risk names no repo, component or finding of the sources: ${clean(untraced)}`);
    const wide = rx(need(o, 'wide'));
    const narrow = rx(need(o, 'narrow'));
    const w = items.findIndex((i) => wide.test(i));
    const n = items.findIndex((i) => narrow.test(i));
    if (w < 0) fail('the widest-blast-radius risk is not in the list');
    if (n >= 0 && n < w) fail('an isolated single-component risk is ranked above the shared-contract risk');
    return `${items.length} risks, widest first`;
  },

  // Sources are read-only inputs and nothing but assessment documents (and diagram temp files) is written.
  'only-assessment-docs': () => {
    const bad = [];
    for (const f of walk('.')) {
      if (f.startsWith(`${DIR}/`)) {
        const name = f.slice(DIR.length + 1);
        if (!/\//.test(name) && (SRC_RE.test(name) || OVERVIEW_RE.test(name) || /^assessment-manifest\.json$|^normalized-findings\.json$/.test(name) || /\.(?:mmd|svg|png)$/.test(name))) continue;
      } else if (/\.(?:mmd|svg|png)$/.test(f) || f === 'README.md') continue;
      bad.push(f);
    }
    if (bad.length) fail(`unexpected file(s): ${clean(bad.slice(0, 5).join(', '))}`);
    for (const f of listFiles(DIR, SRC_RE)) {
      const t = readText(`${DIR}/${f}`) || '';
      if (!/\*\*Evidence tier:\*\*/.test(t)) fail(`${f} was altered (its evidence tier line is gone)`);
    }
    return 'only the overview was added; sources intact';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS };
