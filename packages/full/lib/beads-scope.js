'use strict';

/** Helpers for /ensemble:refine-beads scope and graph normalization. */

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.issues)) return value.issues;
  if (value && Array.isArray(value.items)) return value.items;
  return [];
}

function slugify(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function titlePrefix(title) {
  const match = String(title || '').match(/^\[[^\]]+\]/);
  return match ? match[0] : '';
}

function extractMetadata(text) {
  const input = String(text || '');
  const reqs = Array.from(new Set((input.match(/REQ-\d{3}/g) || [])));
  const acs = Array.from(new Set((input.match(/AC-\d{3}-\d+/g) || [])));
  const trdTasks = Array.from(new Set((input.match(/TRD-\d{3}(?:-TEST)?/g) || [])));
  const prMatch = input.match(/(?:\[trd:[^\]]+:(?:pr|phase):(\d+)\]|\bPR\s+(\d+)\b)/i);
  const trdPrefix = input.match(/\[trd:([^:\]]+)/i);
  return {
    sourceReqs: reqs,
    sourceAcs: acs,
    sourceTasks: trdTasks,
    sourcePr: prMatch ? Number(prMatch[1] || prMatch[2]) : null,
    trdSlug: trdPrefix ? trdPrefix[1] : null,
  };
}

function depId(dep) {
  if (!dep) return null;
  if (typeof dep === 'string') return dep;
  return dep.id || dep.issue_id || dep.issueId || dep.depends_on || dep.dependsOn || dep.target || null;
}

function normalizeIssue(issue) {
  const comments = asArray(issue.comments).map((c) => (typeof c === 'string' ? c : (c.text || c.body || c.message || '')));
  const description = issue.description || issue.body || '';
  const combinedText = [issue.title, description].concat(comments).join('\n');
  const deps = asArray(issue.dependencies).map(depId).filter(Boolean);
  const dependents = asArray(issue.dependents).map(depId).filter(Boolean);
  return {
    id: issue.id,
    title: issue.title || '',
    titlePrefix: titlePrefix(issue.title),
    description,
    type: issue.issue_type || issue.type || '',
    status: issue.status || '',
    priority: issue.priority,
    dependencies: deps,
    dependents,
    comments,
    externalRef: issue.external_ref || issue.externalRef || '',
    metadata: extractMetadata(combinedText),
    raw: issue,
  };
}

function normalizeGraph(input) {
  const beads = asArray(input).map(normalizeIssue).filter((b) => b.id);
  const byId = new Map(beads.map((b) => [b.id, b]));
  const childrenByParent = new Map();
  const parentsByChild = new Map();

  for (const bead of beads) {
    for (const dep of asArray(bead.raw.dependencies)) {
      const id = depId(dep);
      if (!id) continue;
      const depType = String(dep.dependency_type || dep.type || '').toLowerCase();
      // br show represents blockers in `dependencies`; implement-trd-beads uses
      // story/task blocks parent, so parent-child style edges are inferred from
      // hierarchy title prefixes and explicit dependency type when available.
      if (depType === 'parent-child') {
        if (!childrenByParent.has(id)) childrenByParent.set(id, new Set());
        childrenByParent.get(id).add(bead.id);
        if (!parentsByChild.has(bead.id)) parentsByChild.set(bead.id, new Set());
        parentsByChild.get(bead.id).add(id);
      }
    }
  }

  // Title-prefix fallback for TRD scaffolds: [trd:slug:pr:n] and
  // [trd:slug:task:id] imply hierarchy even when br exposes edges as blocks.
  for (const parent of beads) {
    const parentPrefix = parent.titlePrefix;
    if (!parentPrefix || !/^\[trd:[^:\]]+\]$/.test(parentPrefix)) continue;
    const slug = parentPrefix.slice(5, -1);
    for (const child of beads) {
      if (child.id === parent.id) continue;
      if (child.titlePrefix.startsWith(`[trd:${slug}:pr:`) || child.titlePrefix.startsWith(`[trd:${slug}:phase:`)) {
        if (!childrenByParent.has(parent.id)) childrenByParent.set(parent.id, new Set());
        childrenByParent.get(parent.id).add(child.id);
        if (!parentsByChild.has(child.id)) parentsByChild.set(child.id, new Set());
        parentsByChild.get(child.id).add(parent.id);
      }
    }
  }

  for (const story of beads) {
    const m = story.titlePrefix.match(/^\[trd:([^:\]]+):(?:pr|phase):(\d+)\]$/);
    if (!m) continue;
    const prefix = `[trd:${m[1]}:task:`;
    for (const child of beads) {
      if (child.titlePrefix.startsWith(prefix) && child.metadata.sourcePr === Number(m[2])) {
        if (!childrenByParent.has(story.id)) childrenByParent.set(story.id, new Set());
        childrenByParent.get(story.id).add(child.id);
        if (!parentsByChild.has(child.id)) parentsByChild.set(child.id, new Set());
        parentsByChild.get(child.id).add(story.id);
      }
    }
  }

  return { beads, byId, childrenByParent, parentsByChild };
}

function resolveScope(input, query, opts = {}) {
  const graph = normalizeGraph(input);
  const project = opts.scope === 'project' || query === '--scope project';
  if (project) {
    return { ok: true, mode: 'project', warning: 'Project scope may affect unrelated epics.', graph, root: null, candidates: [] };
  }
  const q = String(query || '').trim();
  const roots = graph.beads.filter((b) => {
    const type = String(b.type || '').toLowerCase();
    const prefix = String(b.titlePrefix || '').toLowerCase();
    const status = String(b.status || '').toLowerCase();
    return status !== 'closed' && (type === 'epic' || prefix.includes('release-train'));
  });
  if (!q) return { ok: false, error: 'No scope supplied', candidates: roots };
  const matches = roots.filter((b) => b.id === q || slugify(b.title).includes(slugify(q)) || b.title.toLowerCase().includes(q.toLowerCase()));
  if (matches.length !== 1) return { ok: false, error: matches.length ? 'Ambiguous scope' : 'No matching scope', candidates: matches };
  return { ok: true, mode: 'subtree', graph, root: matches[0], candidates: matches };
}

function subtreeIds(graph, rootId) {
  const seen = new Set();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    for (const child of (graph.childrenByParent.get(id) || [])) stack.push(child);
  }
  return seen;
}

module.exports = { asArray, slugify, titlePrefix, extractMetadata, normalizeIssue, normalizeGraph, resolveScope, subtreeIds };
