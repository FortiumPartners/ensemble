'use strict';

/**
 * kata work-graph edge export and ready-work normalization (TRD-2026-6995dc96 TRD-017;
 * PRD REQ-007 AC-007-1), plus the in-process `work-graph.plan` / `work-graph.graph-health`
 * entry point `run` (TRD-019; AC-007-2..5).
 *
 * The normalizers are pure and I/O-free: no fs, no process spawn, no env. Only `run` does I/O,
 * and it requires the runner lazily inside itself. Callers (TRD-016's dispatch, TRD-019's
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

// ---- TRD-019: work-graph.plan and work-graph.graph-health -------------------------------------

const HANDLED = new Set(['work-graph.plan', 'work-graph.graph-health']);

function fail(code, message) {
  return { ok: false, error: { code, message } };
}

/** Refuse a partial listing: a plan or health verdict over a truncated list would be wrong. */
function completenessProblem(envelope) {
  if (!envelope || typeof envelope !== 'object' || !Array.isArray(envelope.issues)) {
    return 'kata list envelope has no `issues` array';
  }
  if (envelope.truncated === true) return 'kata list envelope is truncated';
  if (envelope.complete === false) return 'kata list envelope is not complete';
  if (typeof envelope.total === 'number' && envelope.issues.length !== envelope.total) {
    return `kata list returned ${envelope.issues.length} issues but total is ${envelope.total}`;
  }
  return null;
}

/**
 * A closed blocker is satisfied: drop it so it is neither an edge nor a dangling finding. Only an
 * explicit `status: 'closed'` drops; a missing or any other status is unknown and stays an edge.
 */
function dropClosedBlockers(envelope) {
  return {
    ...envelope,
    issues: envelope.issues.map((issue) =>
      Array.isArray(issue && issue.blocked_by)
        ? { ...issue, blocked_by: issue.blocked_by.filter((b) => !(b && b.status === 'closed')) }
        : issue
    ),
  };
}

/** Synthetic tracker.list argv: the full open listing with a total so completeness is checkable. */
const KATA_LIST_ARGV = Object.freeze(['kata', 'list', '--status', 'open', '--limit', '0', '--include-total', '--json']);

/**
 * Resolve a toolchain library by layout: monorepo (`packages/development`), Pi (`vendor/lib` beside
 * `skills/`), or Codex (`skills/vendor/lib`). Throws a coded LIB_NOT_FOUND error if none resolve.
 */
function requireToolchainLib(name) {
  const candidates = [
    `../../lib/toolchain/${name}`,
    `../../vendor/lib/toolchain/${name}`,
    `../vendor/lib/toolchain/${name}`,
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (e) {
      // Only skip "this candidate path is absent"; a real load error inside the lib must surface.
      const missing = e && e.code === 'MODULE_NOT_FOUND' && typeof e.message === 'string' && e.message.includes(candidate);
      if (!missing) throw e;
    }
  }
  const err = new Error(`toolchain library '${name}' not found (tried ${candidates.join(', ')})`);
  err.code = 'LIB_NOT_FOUND';
  throw err;
}

async function fetchListViaRunner(ctx) {
  // Lazy: keeps the pure helpers above free of fs/spawn at require time.
  const { runCapability } = requireToolchainLib('runner');
  const manifest = ctx.manifest || {};
  const synthetic = {
    ...manifest,
    capabilities: {
      ...(manifest.capabilities || {}),
      'tracker.list': {
        run: [...KATA_LIST_ARGV],
      },
    },
  };
  const result = await runCapability(synthetic, 'tracker.list', {}, {
    source: ctx.source,
    timeouts: ctx.timeouts,
    execFileOptions: ctx.cwd ? { cwd: ctx.cwd } : undefined,
  });
  if (!result || result.ok !== true) return { error: (result && result.error) || { code: 'TOOL_FAILED', message: 'kata list failed' } };
  try {
    return { envelope: typeof result.data === 'string' ? JSON.parse(result.data) : result.data };
  } catch (e) {
    return { error: { code: 'BAD_OUTPUT', message: `kata list output is not JSON: ${e.message}` } };
  }
}

async function run(capability, args, ctx = {}) {
  if (!HANDLED.has(capability)) {
    return fail('NOT_ALLOWED', `kata work-graph module does not handle '${capability}'`);
  }
  let envelope;
  try {
    if (typeof ctx.fetchList === 'function') {
      envelope = await ctx.fetchList(args || {});
    } else {
      const fetched = await fetchListViaRunner(ctx);
      if (fetched.error) return { ok: false, error: fetched.error };
      envelope = fetched.envelope;
    }
    const problem = completenessProblem(envelope);
    if (problem) return fail('BAD_OUTPUT', problem);

    const { scanWorkGraph, isGraphHealthy } = requireToolchainLib('work-graph-scan');
    const scan = scanWorkGraph(normalizeEdges(dropClosedBlockers(envelope)));
    const orderingSource = (ctx.manifest && ctx.manifest.adapter) || 'kata';
    if (capability === 'work-graph.plan') {
      return {
        ok: true,
        capability,
        data: { items: scan.ordered, orderingSource, dependencyAware: true, findings: scan.findings },
      };
    }
    const health = isGraphHealthy(scan);
    return {
      ok: true,
      capability,
      data: { status: health.status, findings: health.findings, orderingSource, dependencyAware: true },
    };
  } catch (error) {
    const code = error && error.code === 'BAD_ENVELOPE' ? 'BAD_OUTPUT' : error && error.code === 'LIB_NOT_FOUND' ? 'LIB_NOT_FOUND' : 'MODULE_FAILED';
    return fail(code, error && error.message ? error.message : String(error));
  }
}

module.exports = { normalizeReadyItems, normalizeEdges, KataEnvelopeError, run };
