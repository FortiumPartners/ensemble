'use strict';

/**
 * Deterministic TRD registry + dependency graph.
 *
 * Indexes a set of TRDs and builds the TRD-level dependency DAG from the
 * existing cross-TRD dependency annotations (`[depends: <trd-slug>#TRD-NNN]` /
 * `#PR-N`), reusing `parseTRD` (tasks/targetFiles/title) and `parseQualifiedRef`
 * (cross-trd-deps). Emits the graph as JSON / Mermaid / Graphviz DOT, detects
 * cycles, and reports likely-duplicate work (TRDs touching the same files).
 *
 * Identity rule: nodes key on the filename-derived `slug` — it is unique per
 * directory and is exactly what cross-TRD refs (`<trd-slug>#TRD-NNN`) and beads
 * already resolve against. The micro-uuid `document_id` is carried as a
 * correlation attribute (and duplicate document_ids — a legacy numbering
 * collision — are surfaced as warnings rather than silently merged). The human
 * `label` is display-only and never a key.
 *
 * Pure: no disk access (callers pass `{path, markdown}` entries).
 */

const { parseTRD } = require('./trd-parser');
const { parseQualifiedRef } = require('./cross-trd-deps');

// --- slug + label derivation (kept in lockstep with trd-cli.js:deriveSlug) ---

function slugify(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function deriveSlug(trdPath) {
  const base = String(trdPath || '').split('/').pop() || '';
  return slugify(base.replace(/\.[^.]+$/, ''));
}

/** Display-only label fallback: `<type>-<kebab-title>`, id prefix stripped. */
function deriveLabel(documentId, title) {
  const id = String(documentId || '');
  let type = 'doc';
  if (/^PRD-/i.test(id)) type = 'prd';
  else if (/^TRD-/i.test(id)) type = 'trd';
  const stem = String(title || '')
    .replace(/^\s*(?:PRD|TRD|DOC)-\S+:\s*/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return stem ? `${type}-${stem}` : type;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * @param {Array<{path:string, markdown:string}>} entries
 * @returns {{ nodes:Array, byId:Map, bySlug:Map, warnings:string[] }}
 */
function buildRegistry(entries) {
  const nodes = [];
  const bySlug = new Map();
  const warnings = [];
  const docIdToSlugs = new Map();

  for (const entry of entries || []) {
    const parsed = parseTRD(entry.markdown);
    const slug = deriveSlug(entry.path);
    const documentId = parsed.documentId || null;
    const tasks = Object.values(parsed.tasksById || {});
    const taskIds = new Set(Object.keys(parsed.tasksById || {}));
    const prNumbers = new Set((parsed.phases || []).map((p) => p.n).filter((n) => Number.isInteger(n)));

    if (bySlug.has(slug)) {
      warnings.push(`Duplicate TRD slug '${slug}' — later file overwrites earlier (${entry.path})`);
    }
    if (documentId) {
      if (!docIdToSlugs.has(documentId)) docIdToSlugs.set(documentId, []);
      docIdToSlugs.get(documentId).push(slug);
    }

    const deps = [];
    const targetFiles = new Set();
    for (const t of tasks) {
      for (const d of t.dependsOn || []) deps.push({ ref: d, taskId: t.id });
      for (const f of t.targetFiles || []) targetFiles.add(String(f).trim());
    }

    const node = {
      id: slug, // graph key: unique per directory, matches cross-TRD ref + beads
      slug,
      documentId,
      label: parsed.label || deriveLabel(documentId || slug, parsed.title),
      kind: parsed.kind || 'trd',
      capabilities: parsed.capabilities || [],
      title: parsed.title || '',
      prd: parsed.prdReference || null,
      path: entry.path,
      deps,
      taskIds,
      prNumbers,
      targetFiles: [...targetFiles].filter(Boolean),
    };
    nodes.push(node);
    bySlug.set(slug, node);
  }

  for (const [docId, slugs] of docIdToSlugs) {
    if (slugs.length > 1) {
      warnings.push(
        `Duplicate document_id '${docId}' shared by ${slugs.length} TRDs: ${slugs.join(', ')}`
      );
    }
  }

  // byId is an alias of bySlug (id === slug) for callers that think in ids.
  return { nodes, byId: bySlug, bySlug, warnings };
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

function targetHasRef(target, parsedRef) {
  if (parsedRef.kind === 'task') return target.taskIds.has(parsedRef.id);
  if (parsedRef.kind === 'pr') return target.prNumbers.has(parsedRef.n);
  return false;
}

function missingRefReason(parsedRef) {
  if (parsedRef.kind === 'task') return `unknown task '${parsedRef.id}' in ${parsedRef.trdSlug}`;
  if (parsedRef.kind === 'pr') return `unknown PR '${parsedRef.id}' in ${parsedRef.trdSlug}`;
  return parsedRef.reason || 'unknown reference';
}

/**
 * @param {{nodes,byId,bySlug}} registry
 * @returns {{ nodes, edges, cycles, warnings }}
 */
function buildGraph(registry) {
  const edges = [];
  const warnings = [...(registry.warnings || [])];
  const seen = new Set();

  for (const node of registry.nodes) {
    for (const { ref, taskId } of node.deps) {
      const parsed = parseQualifiedRef(ref);
      if (!parsed.ok) continue; // bare TRD-NNN => intra-TRD dependency, not a graph edge
      const target = registry.bySlug.get(parsed.trdSlug);
      if (!target) {
        warnings.push(`Unresolved cross-TRD dependency '${ref}' (from ${node.slug}#${taskId})`);
        continue;
      }
      if (!targetHasRef(target, parsed)) {
        warnings.push(
          `Unresolved cross-TRD dependency '${ref}' (from ${node.slug}#${taskId}): ${missingRefReason(parsed)}`
        );
        continue;
      }
      if (target.id === node.id) continue; // ignore validated self-reference
      const key = `${node.id}->${target.id}`;
      const existing = seen.has(key) ? edges.find((e) => `${e.from}->${e.to}` === key) : null;
      if (existing) {
        existing.via.push({ task: taskId, ref });
        continue;
      }
      seen.add(key);
      edges.push({ from: node.id, to: target.id, via: [{ task: taskId, ref }] });
    }
  }

  const nodes = registry.nodes.map((n) => ({
    id: n.id,
    documentId: n.documentId,
    label: n.label,
    slug: n.slug,
    kind: n.kind,
    title: n.title,
    prd: n.prd,
    path: n.path,
  }));

  return { nodes, edges, cycles: detectCycles(nodes, edges), warnings };
}

/**
 * Return every simple cycle in the directed graph as an array of node-id lists.
 */
function detectCycles(nodes, edges) {
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (adj.has(e.from)) adj.get(e.from).push(e.to);
  }
  const cycles = [];
  const seenCycle = new Set();
  const state = new Map(); // id -> 0 unvisited / 1 in-stack / 2 done
  const stack = [];

  function dfs(id) {
    state.set(id, 1);
    stack.push(id);
    for (const next of adj.get(id) || []) {
      const st = state.get(next) || 0;
      if (st === 1) {
        // back-edge: extract the cycle from the stack
        const idx = stack.indexOf(next);
        const cycle = stack.slice(idx);
        const norm = [...cycle].sort().join(',');
        if (!seenCycle.has(norm)) {
          seenCycle.add(norm);
          cycles.push(cycle);
        }
      } else if (st === 0) {
        dfs(next);
      }
    }
    stack.pop();
    state.set(id, 2);
  }

  for (const n of nodes) if ((state.get(n.id) || 0) === 0) dfs(n.id);
  return cycles;
}

// ---------------------------------------------------------------------------
// Overlap detection (likely-duplicate work)
// ---------------------------------------------------------------------------

/**
 * Pairs of TRDs that touch the same target files — a signal of duplicated work.
 * @returns {Array<{a,b,sharedFiles:string[],sharedCount:number}>}
 */
function findOverlaps(registry) {
  const nodes = registry.nodes;
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const bFiles = new Set(b.targetFiles);
      const shared = a.targetFiles.filter((f) => bFiles.has(f));
      if (shared.length) {
        out.push({
          a: { id: a.id, label: a.label },
          b: { id: b.id, label: b.label },
          sharedFiles: shared.sort(),
          sharedCount: shared.length,
        });
      }
    }
  }
  return out.sort((x, y) => y.sharedCount - x.sharedCount);
}

// ---------------------------------------------------------------------------
// Capability providers (dedup-by-reference input for create-trd)
// ---------------------------------------------------------------------------

/**
 * Index the capabilities declared across TRDs to their providing docs. This is
 * the deterministic input create-trd consults to reference existing work instead
 * of duplicating it. Providers are sorted foundational-first (the intended
 * reuse target), then by slug.
 *
 * @returns {Array<{capability:string, providers:Array<{slug,id,label,kind}>}>}
 */
function findCapabilityProviders(registry) {
  const byCapability = new Map();
  for (const node of registry.nodes) {
    for (const cap of node.capabilities || []) {
      if (!byCapability.has(cap)) byCapability.set(cap, []);
      byCapability.get(cap).push({
        slug: node.slug,
        id: node.documentId || node.slug,
        label: node.label,
        kind: node.kind,
      });
    }
  }
  const rank = (p) => (p.kind === 'foundational' ? 0 : 1);
  return [...byCapability.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([capability, providers]) => ({
      capability,
      providers: providers.sort((x, y) => rank(x) - rank(y) || x.slug.localeCompare(y.slug)),
    }));
}

// ---------------------------------------------------------------------------
// Emitters
// ---------------------------------------------------------------------------

function emitJson(graph) {
  return JSON.stringify(graph, null, 2) + '\n';
}

function mermaidId(id) {
  return 'n_' + String(id).replace(/[^A-Za-z0-9]/g, '_');
}

function emitMermaid(graph) {
  const lines = ['graph TD'];
  for (const n of graph.nodes) {
    const shape = n.kind === 'foundational' ? [`(["`, `"])`] : [`["`, `"]`];
    lines.push(`  ${mermaidId(n.id)}${shape[0]}${n.label}${shape[1]}`);
  }
  for (const e of graph.edges) {
    lines.push(`  ${mermaidId(e.from)} --> ${mermaidId(e.to)}`);
  }
  return lines.join('\n') + '\n';
}

function emitDot(graph) {
  const lines = ['digraph TRD {', '  rankdir=LR;', '  node [shape=box];'];
  for (const n of graph.nodes) {
    const shape = n.kind === 'foundational' ? ' shape=ellipse' : '';
    lines.push(`  "${n.id}" [label="${n.label}"${shape}];`);
  }
  for (const e of graph.edges) {
    lines.push(`  "${e.from}" -> "${e.to}";`);
  }
  lines.push('}');
  return lines.join('\n') + '\n';
}

module.exports = {
  slugify,
  deriveSlug,
  deriveLabel,
  buildRegistry,
  buildGraph,
  detectCycles,
  findOverlaps,
  findCapabilityProviders,
  emitJson,
  emitMermaid,
  emitDot,
};
