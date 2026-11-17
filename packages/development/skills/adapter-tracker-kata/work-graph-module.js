'use strict';

/**
 * kata work-graph edge export and ready-work normalization (TRD-2026-6995dc96 TRD-017;
 * PRD REQ-007 AC-007-1).
 *
 * Pure and I/O-free: no fs, no process spawn, no env. Callers (TRD-016's dispatch, TRD-019's
 * plan/graph-health) run `kata ready --limit 0 --json` / `kata list --json` and pass the parsed
 * envelope in. The TRD-001 fixture decides the edge source: the list envelope carries
 * `blocked_by: [{short_id,...}]` and `blocks: [...]` per issue, so no per-item `kata show` is
 * needed. Item ids are `short_id`.
 *
 * Order: kata's own listing order is preserved and NEVER re-sorted (AC-007-1 stability is kata's).
 * Dependency semantics: `dependencies` means "blocked by", the shape `work-graph-scan.js` reads.
 * An issue X with `blocks: [Y]` makes Y depend on X, so `blocks` is inverted onto Y when Y is in
 * the envelope; an edge whose blocked side is outside the envelope is dropped (it is not X's
 * dependency list that is incomplete).
 */

class KataEnvelopeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'KataEnvelopeError';
    this.code = 'BAD_ENVELOPE';
  }
}

function issuesOf(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || !Array.isArray(envelope.issues)) {
    throw new KataEnvelopeError('kata envelope must be an object with an `issues` array');
  }
  envelope.issues.forEach((issue, i) => {
    if (!issue || typeof issue !== 'object' || typeof issue.short_id !== 'string' || issue.short_id === '') {
      throw new KataEnvelopeError(`kata envelope issues[${i}] has no usable short_id`);
    }
  });
  return envelope.issues;
}

function linkIds(list, field, owner) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new KataEnvelopeError(`issue ${owner} ${field} must be an array or null`);
  return list.map((l, i) => {
    if (!l || typeof l.short_id !== 'string' || l.short_id === '') {
      throw new KataEnvelopeError(`issue ${owner} ${field}[${i}] has no usable short_id`);
    }
    return l.short_id;
  });
}

function toItem(issue) {
  const item = {
    id: issue.short_id,
    title: issue.title,
    status: issue.status,
    dependencies: [],
  };
  if (issue.priority !== undefined && issue.priority !== null) item.priority = String(issue.priority);
  return item;
}

/**
 * Normalize a kata ready/list envelope to items, preserving kata's order. Dependencies are
 * populated from `blocked_by` only (a ready listing has none; use `normalizeEdges` for the graph).
 */
function normalizeReadyItems(envelope) {
  return issuesOf(envelope).map((issue) => {
    const item = toItem(issue);
    for (const id of new Set(linkIds(issue.blocked_by, 'blocked_by', issue.short_id))) {
      item.dependencies.push({ id, type: 'blocks' });
    }
    return item;
  });
}

/**
 * Normalize a kata list envelope to items whose `dependencies` hold every blocking edge: each
 * issue's `blocked_by`, plus the inversion of other issues' `blocks`. Deduplicated; dependency
 * order is `blocked_by` entries in kata order, then inverted `blocks` in envelope order.
 */
function normalizeEdges(listEnvelope) {
  const issues = issuesOf(listEnvelope);
  const items = issues.map((issue) => ({ issue, item: toItem(issue) }));
  const byId = new Map();
  for (const entry of items) if (!byId.has(entry.item.id)) byId.set(entry.item.id, entry);
  const seen = new Map(items.map((e) => [e, new Set()]));
  const add = (entry, depId) => {
    const s = seen.get(entry);
    if (s.has(depId)) return;
    s.add(depId);
    entry.item.dependencies.push({ id: depId, type: 'blocks' });
  };
  for (const entry of items) {
    for (const id of linkIds(entry.issue.blocked_by, 'blocked_by', entry.item.id)) add(entry, id);
  }
  for (const entry of items) {
    for (const blockedId of linkIds(entry.issue.blocks, 'blocks', entry.item.id)) {
      const target = byId.get(blockedId);
      if (target) add(target, entry.item.id);
    }
  }
  return items.map((e) => e.item);
}

module.exports = { normalizeReadyItems, normalizeEdges, KataEnvelopeError };
