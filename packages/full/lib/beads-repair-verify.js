'use strict';

const { normalizeGraph } = require('./beads-scope');

function verifyRepair(input, verify) {
  const v = verify || {};
  const graph = input && input.beads ? input : normalizeGraph(input || []);
  if (v.kind === 'dependency_exists') {
    const source = graph.byId.get(v.source);
    const ok = !!source && (source.dependencies || []).includes(v.target);
    return { ok, kind: v.kind, expected: `${v.source} depends on ${v.target}`, observed: source ? source.dependencies : null };
  }
  if (v.kind === 'comment_contains') {
    const bead = graph.byId.get(v.beadId);
    const comments = bead ? bead.comments || [] : [];
    const ok = comments.some((c) => String(c).includes(v.text));
    return { ok, kind: v.kind, expected: `comment containing ${v.text}`, observed: comments };
  }
  if (v.kind === 'status_is') {
    const bead = graph.byId.get(v.beadId);
    const ok = !!bead && bead.status === v.status;
    return { ok, kind: v.kind, expected: v.status, observed: bead && bead.status };
  }
  if (/manual_/.test(v.kind || '')) return { ok: false, kind: v.kind, expected: 'manual action', observed: 'not automated' };
  return { ok: false, kind: v.kind || 'unknown', expected: v, observed: null };
}

module.exports = { verifyRepair };
