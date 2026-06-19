'use strict';

const { normalizeGraph, subtreeIds } = require('./beads-scope');

function makeFinding(type, severity, beadIds, message, recommendation, extra = {}) {
  return Object.assign({
    id: '',
    type,
    severity,
    beadIds: Array.from(new Set((beadIds || []).filter(Boolean))),
    message,
    recommendation,
    requiresUserResolution: false,
    source: 'derived',
  }, extra);
}

function parseBvFindings(bvData) {
  const findings = [];
  const data = bvData && typeof bvData === 'object' ? bvData : {};
  const cycles = data.Cycles || data.cycles || [];
  if (Array.isArray(cycles)) {
    for (const cycle of cycles) {
      const ids = Array.isArray(cycle) ? cycle : (cycle.nodes || cycle.ids || []);
      findings.push(makeFinding(
        'cycle',
        'critical',
        ids,
        'Dependency cycle detected by bv robot analysis.',
        'Choose one edge to remove or reverse before execution.',
        { requiresUserResolution: true, source: 'bv' }
      ));
    }
  }
  const alerts = data.Alerts || data.alerts || [];
  if (Array.isArray(alerts)) {
    for (const alert of alerts) {
      const text = typeof alert === 'string' ? alert : (alert.message || alert.title || JSON.stringify(alert));
      if (/contradict|cycle/i.test(text)) {
        findings.push(makeFinding('priority_order', 'high', alert.ids || alert.beadIds || [], text, 'Review order and choose the intended dependency direction.', { requiresUserResolution: true, source: 'bv' }));
      }
    }
  }
  return findings;
}

function taskScope(graph, rootId) {
  if (!rootId) return new Set(graph.beads.map((b) => b.id));
  return subtreeIds(graph, rootId);
}

function detectHierarchy(graph, scopeIds, rootId) {
  const findings = [];
  const scoped = graph.beads.filter((b) => scopeIds.has(b.id));
  const root = rootId ? graph.byId.get(rootId) : null;
  const rootSlug = root && root.titlePrefix.match(/^\[trd:([^:\]]+)\]$/)?.[1];

  for (const bead of graph.beads) {
    if (!/task/i.test(bead.type)) continue;
    if (rootSlug && bead.titlePrefix.startsWith(`[trd:${rootSlug}:task:`) && !scopeIds.has(bead.id)) {
      findings.push(makeFinding('orphan', 'high', [bead.id, rootId], 'Task matches selected TRD slug but is outside the selected hierarchy.', 'Attach the task to the expected PR/story or mark it out of scope.'));
    }
  }

  for (const bead of scoped) {
    if (/task/i.test(bead.type) && !(graph.parentsByChild.get(bead.id) || new Set()).size && bead.id !== rootId && !/^\[trd:[^\]]+:task:/.test(bead.titlePrefix)) {
      findings.push(makeFinding('orphan', 'medium', [bead.id], 'Task has no detected parent/story relationship.', 'Attach task to the correct PR/story bead.'));
    }
  }
  return findings;
}

function detectPrBoundary(graph, scopeIds) {
  const findings = [];
  const scoped = graph.beads.filter((b) => scopeIds.has(b.id));
  for (const bead of scoped) {
    const hasKnownParent = (graph.parentsByChild.get(bead.id) || new Set()).size > 0;
    if (/task/i.test(bead.type) && bead.metadata.sourcePr == null && /^\[trd:/.test(bead.titlePrefix) && hasKnownParent) {
      findings.push(makeFinding('pr_boundary', 'medium', [bead.id], 'Task is missing PR boundary metadata.', 'Add source PR metadata or relink task under the correct PR/story.'));
    }
    for (const dep of bead.dependencies || []) {
      const blocker = graph.byId.get(dep);
      if (!blocker || blocker.metadata.sourcePr == null || bead.metadata.sourcePr == null) continue;
      if (blocker.metadata.trdSlug === bead.metadata.trdSlug && blocker.metadata.sourcePr > bead.metadata.sourcePr) {
        findings.push(makeFinding('pr_boundary', 'high', [bead.id, blocker.id], 'Dependency edge contradicts PR boundary order.', 'Review edge direction or move task to a later PR boundary.', { requiresUserResolution: true }));
      }
    }
  }
  return findings;
}

function detectTraceability(graph, scopeIds) {
  const findings = [];
  for (const bead of graph.beads.filter((b) => scopeIds.has(b.id))) {
    if (!/task/i.test(bead.type)) continue;
    const sourceReqs = Array.isArray(bead.metadata.sourceReqs) ? bead.metadata.sourceReqs : [];
    const sourceAcs = Array.isArray(bead.metadata.sourceAcs) ? bead.metadata.sourceAcs : [];
    if (!sourceReqs.length && !/INFRA|ARCH/.test(bead.description)) {
      findings.push(makeFinding('traceability', 'medium', [bead.id], 'Task lacks requirement traceability metadata.', 'Add requirement/AC context as a bead comment or regenerate scaffold metadata.'));
    }
    if (!sourceAcs.length && !/INFRA|ARCH/.test(bead.description)) {
      findings.push(makeFinding('traceability', 'low', [bead.id], 'Task lacks acceptance criteria metadata.', 'Add AC references or proof-of-requirement context.'));
    }
  }
  return findings;
}

function detectDuplicates(graph, scopeIds) {
  const findings = [];
  const tasks = graph.beads.filter((b) => scopeIds.has(b.id) && /task/i.test(b.type));
  const buckets = new Map();
  for (const task of tasks) {
    const key = task.title
      .replace(/^\[[^\]]+\]\s*/, '')
      .replace(/TRD-\d+(?:-TEST)?/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .slice(0, 80);
    if (!key) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(task);
  }
  for (const items of buckets.values()) {
    if (items.length > 1) {
      findings.push(makeFinding('duplicate', 'low', items.map((i) => i.id), 'Possible duplicate tasks detected by similar titles.', 'Review and choose merge, close, relink, or leave unchanged.'));
    }
  }
  return findings;
}

function assignIds(findings) {
  return findings.map((f, i) => Object.assign({}, f, { id: f.id || `finding-${String(i + 1).padStart(3, '0')}` }));
}

function detectFindings(input, opts = {}) {
  const graph = input && input.beads ? input : normalizeGraph(input);
  const scopeIds = opts.scopeIds || taskScope(graph, opts.rootId || null);
  const findings = [];
  findings.push(...parseBvFindings(opts.bvData));
  findings.push(...detectHierarchy(graph, scopeIds, opts.rootId || null));
  findings.push(...detectPrBoundary(graph, scopeIds));
  findings.push(...detectTraceability(graph, scopeIds));
  findings.push(...detectDuplicates(graph, scopeIds));
  return assignIds(findings);
}

function summarizeFindings(findings) {
  const list = Array.isArray(findings) ? findings : [];
  const byType = {};
  const bySeverity = {};
  for (const f of list) {
    byType[f.type] = (byType[f.type] || 0) + 1;
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
  }
  return { count: list.length, byType, bySeverity, requiresUserResolution: list.filter((f) => f.requiresUserResolution).length };
}

module.exports = { makeFinding, parseBvFindings, detectFindings, summarizeFindings };
