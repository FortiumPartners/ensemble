'use strict';

/**
 * Shared pure dependency-edge scan (TRD-2026-6995dc96 TRD-018; PRD REQ-007 AC-007-2,
 * AC-007-3, AC-007-5).
 *
 * Two functions, no I/O: `scanWorkGraph(items)` returns a dependency-first ordering of the
 * items it was handed plus any structural findings, and `isGraphHealthy(scanResult)` projects
 * that result onto the `work-graph` category contract's
 * `work-graph.graph-health` outputs (`packages/development/toolchain/categories/
 * work-graph.yaml`: `outputs: [status, findings]`). Nothing here reads the filesystem, spawns
 * a process, touches `process.env`, or consults any global: callers (TRD-017's kata edge
 * export, TRD-019's `work-graph.plan`/`work-graph.graph-health` kata module, TRD-026's
 * truthful builtin graph-health fallback, TRD-018-TEST's fixed graphs) fetch items through
 * `tracker.list`/`tracker.show` via `./runner.js#runCapability` and pass the results in. That
 * is why this is a separate module rather than more code inside
 * `./builtin/work-graph-links-fallback.js`: the same scan has to serve a kata-native adapter,
 * the builtin fallback, and tests, none of which should have to route through the other's
 * execution path.
 *
 * ## Input contract
 *
 * An **item** is any object carrying a non-empty string `id`. Ids are opaque strings; nothing
 * here parses, normalizes case, or trims them -- an id is exactly what the backing tracker
 * returned. An item with no usable `id` (missing, non-string, or empty) is not a graph vertex
 * at all and is reported as a `missing-id` finding rather than dropped silently.
 *
 * A **dependency link** is one entry of an item's `dependencies` array, in either shape the
 * repo's normalized work-item schema and the links-only fallback already accept (see
 * `packages/development/toolchain/schemas/normalized/work-item.json` and
 * `./builtin/work-graph-links-fallback.js#dependencyIds`):
 * - canonical: `{ id: '<dep id>', type?: '<link type>' }`
 * - tolerated: a bare id string `'<dep id>'`
 *
 * Semantics are "this item is blocked by that id": an edge points from the depended-on id to
 * the item that needs it, so dependency-first ordering places the depended-on id earlier.
 * A non-array `dependencies` (including absent) means "this tracker never told us" and
 * contributes no edges; an empty array means "present, nothing blocked on". A `dependencies`
 * entry that is neither of the two shapes above contributes no edge and is reported as a
 * `malformed-dependency` finding. `type` is carried through into findings for triage but
 * never affects ordering -- the scan is link-type-agnostic, matching the fallback.
 *
 * **Scanned scope** is exactly the array passed to `scanWorkGraph` -- the ids present in that
 * array, no more. This module never queries a tracker, so "in scope" and "named by an edge"
 * are the only two states: an edge naming an id absent from the array is a `dangling-edge`
 * finding (AC-007-5), not an implied node, not a silent skip. Callers that fetch detail per
 * item (TRD-017/TRD-019 do) decide what constitutes the scope by what they pass in; a
 * closed-and-therefore-filtered-out dependency still counts as out of scope, so callers
 * wanting "closed blocker is fine" semantics must keep closed items in the array (the fallback
 * does exactly that today).
 *
 * Duplicate ids in the input are one vertex, and the FIRST occurrence is the one carried into
 * `ordered`; self-dependency (`X` depends on `X`) is a cycle of length one, reported as a
 * `cycle` finding -- not ignored, not "already satisfied".
 *
 * ## Result shape (stable; downstream consumers depend on it)
 *
 * ```
 * scanWorkGraph(items) -> {
 *   ordered: object[],   // dependency-first, see ORDERING below; EMPTY on any cycle finding
 *   findings: Finding[], // see FINDINGS below; [] when the graph is clean
 *   clean: boolean,      // findings.length === 0
 *   ids: string[],       // in-scope ids, SORTED ascending, duplicates removed (see DETERMINISM)
 * }
 *
 * Finding = {
 *   type: 'cycle' | 'dangling-edge' | 'malformed-dependency' | 'missing-id',
 *   items: string[],     // in-scope item ids this finding is about, sorted ascending
 *   dependency?: string, // edge target: the id named by the link (dangling/malformed only)
 *   detail?: string,     // human-readable sentence, exact text below
 * }
 *
 * isGraphHealthy(result) -> { status: 'healthy'|'unhealthy', findings: Finding[] }
 * ```
 *
 * ## ORDERING -- cycle-only suppression
 *
 * A scan with NO findings returns a stable topological order of every in-scope item: Kahn's
 * algorithm with a FIFO frontier seeded in **input order** and each item's edges considered in
 * input order, so every item appears after every item it depends on (AC-007-2) and the same
 * input always produces the byte-identical same array (AC-007-1's "two consecutive listings
 * ... identical sequence" requirement applies to the plan path too).
 *
 * A scan with AT LEAST ONE `cycle` finding returns `ordered: []`. AC-007-3 is explicit that a
 * cycle must be reported "rather than a plan silently ordering the cycle anyway", and a partial
 * order that happens to place some cycle members early is precisely that silent ordering -- it
 * looks plausible and hides the cycle. TRD-019's Test AC for `work-graph.plan` matches: on a
 * cycle, "the cycle is a finding and the plan output lists the cycle members as unordered".
 *
 * Every OTHER finding type (`dangling-edge`, `malformed-dependency`, `missing-id`) still gets an
 * order alongside its findings. AC-007-5 asks only that a dangling edge "is reported as a
 * finding", and the contract's `work-graph.plan` outputs `[items, orderingSource,
 * dependencyAware]` with NO findings field -- findings reach a caller only through
 * `work-graph.graph-health`. Emptying `ordered` for a dangling edge would therefore make
 * `plan` silently return zero items while surfacing the reason nowhere, which is a worse
 * failure than the one AC-007-3 guards against. TRD-019's dangling-edge Test AC asks only that
 * "it is listed as a finding" and says nothing about the order, so it is compatible either way;
 * the cycle rule is scoped to cycles because that is the only suppression any AC asks for.
 *
 * Which items are then EXCLUDED from `ordered` (the AC-007-2 guarantee must not be broken by
 * the items that survive): an item is ordered only when its position is determinable, i.e. it
 * is a well-formed vertex and every dependency link it declares resolves, directly or
 * transitively, to other well-formed in-scope vertices. Concretely, the scan seeds an exclusion
 * set with the items named by `dangling-edge` and `malformed-dependency` findings (plus every
 * item with no usable `id`, which is not a vertex at all), then cascades: any item still
 * declaring a link to an excluded item becomes excluded too, repeatedly, until the remaining
 * subgraph is closed under "depends on". Only that subgraph is topologically ordered, so no
 * item is ever placed as though an unsatisfiable or malformed blocker were already satisfied --
 * that would claim readiness the graph does not support. Excluded items are not lost: each is
 * named in `findings` and present in `ids`.
 *
 * ## DETERMINISM -- what is and is not input-order independent
 *
 * Two guarantees hold, and fixtures should rely on these, not on a stronger one:
 *
 * 1. SAME INPUT, SAME OUTPUT. Every field is a pure function of the input array: no clock, no
 *    randomness, no iteration-order-dependent-in-practice behaviour. Two scans of an unchanged
 *    item set produce byte-identical results (AC-007-1's "two consecutive listings ... return
 *    an identical sequence", applied to the plan path).
 * 2. `findings` AND `ids` ARE PERMUTATION-INVARIANT. `findings` are grouped by `type` in the
 *    fixed order `cycle`, `dangling-edge`, `malformed-dependency`, `missing-id`, then sorted by
 *    `dependency` (when present) then `items.join(',')`, with every `items` array sorted
 *    ascending; `ids` is sorted ascending. So neither depends on which item the scanner reached
 *    first.
 *
 * `ordered` is NOT permutation-invariant, and deliberately so: it is seeded in input order, so
 * items that are genuinely unordered relative to each other (no path between them) keep the
 * caller's listing order -- which is what AC-007-1 asks a tracker's ready-listing to preserve.
 * Concretely, for `A`, `B` independent and `C` depending on both, input `[A,B,C]` yields
 * `A,B,C` while input `[B,A,C]` yields `B,A,C`; `C` is last in both, because that is the part
 * AC-007-2 actually constrains. A golden fixture that must be permutation-invariant should
 * compare `findings` and `ids` directly, or feed a graph with no unrelated ties (a single chain,
 * as TRD-018-TEST's fixed graphs are), rather than stringifying the whole result of an arbitrary
 * item set. Do not "fix" this by sorting `ordered`: dependency-first order and id order are
 * different orders, and sorting would break AC-007-2's intent of honouring the tracker's order
 * among unblocked peers.
 *
 * ## FINDINGS -- vocabulary
 *
 * Finding `type` values are a closed set, named after what was found:
 * - `'cycle'` -- a strongly-connected component of size > 1, or a self-edge. `items` are the
 *   ids in that component (sorted); a component spanning several mutually-reachable groups is
 *   one finding per component, so triage sees each cycle separately.
 * - `'dangling-edge'` -- an edge naming an id not in the scanned scope. `items` names the
 *   in-scope item(s) that declared that link (sorted), `dependency` names the absent id.
 *   One finding per distinct absent id, aggregating every in-scope item that points at it.
 * - `'malformed-dependency'` -- a `dependencies` entry that is neither `{id}` nor a bare
 *   string. `items` names the declaring item(s), `dependency` is `undefined`.
 * - `'missing-id'` -- an array element with no usable `id`. `items` is empty (there is no id to
 *   name), one finding per such element, and `detail` gives its zero-based index in the input
 *   array. Such an element is excluded from `ordered` -- there is no item object to place.
 *
 * `detail` is a fixed, generated sentence per type, not free-form:
 * - cycle: `` `dependency cycle among: ${items.join(', ')}` ``
 * - dangling-edge: `` `dependency '${dependency}' is not present in the scanned scope` ``
 * - malformed-dependency: `` `unrecognized dependency link shape on ${items.join(', ')}` ``
 * - missing-id: `` `item at index ${index} has no usable string id` ``
 *
 * `isGraphHealthy` is the thin projection for the contract's `work-graph.graph-health`:
 * `status` is `'healthy'` only when `findings` is empty, else `'unhealthy'`, and `findings` is
 * the same array (same order, same objects) `scanWorkGraph` returned. It never re-derives
 * anything, so plan and graph-health can never disagree about what is wrong.
 */

const FINDING_TYPE_ORDER = Object.freeze([
  'cycle',
  'dangling-edge',
  'malformed-dependency',
  'missing-id',
]);

/**
 * One in-scope item id, or `null` when the value has no usable one.
 *
 * @param {unknown} item
 * @returns {string | null}
 */
function itemIdOf(item) {
  if (!item || typeof item !== 'object') return null;
  const id = item.id ?? item.Id ?? item.ID;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * One `dependencies[]` entry's target id, or `null` when the entry has no usable one.
 *
 * @param {unknown} dep
 * @returns {string | null}
 */
function dependencyIdOf(dep) {
  if (typeof dep === 'string') return dep.length > 0 ? dep : null;
  if (!dep || typeof dep !== 'object') return null;
  const id = dep.id ?? dep.Id ?? dep.ID;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** @param {string[]} ids @returns {string} */
function sortIds(ids) {
  return [...new Set(ids)].sort();
}

/** @param {Finding-ish} a @param {Finding-ish} b @returns {number} */
function compareFindings(a, b) {
  const byType =
    FINDING_TYPE_ORDER.indexOf(a.type) - FINDING_TYPE_ORDER.indexOf(b.type);
  if (byType !== 0) return byType;
  const aDep = a.dependency ?? '';
  const bDep = b.dependency ?? '';
  if (aDep !== bDep) return aDep < bDep ? -1 : 1;
  const aKey = a.items.join(',');
  const bKey = b.items.join(',');
  if (aKey !== bKey) return aKey < bKey ? -1 : 1;
  return 0;
}

/**
 * Tarjan's strongly-connected components, iterative (no recursion depth limit on wide real
 * backlogs), in a deterministic traversal: vertices visited in `ids` order, successors visited
 * in the order their edges were recorded. Components of size > 1 are cycles; a size-1 component
 * is a cycle only when it holds a self-edge.
 *
 * @param {string[]} ids in-scope ids, input order
 * @param {Map<string, string[]>} edges adjacency from depended-on id to items needing it
 * @param {Set<string>} selfDependent ids that depend on themselves
 * @returns {{items: string[], detail: string}[]} cycle findings, unsorted
 */
function cycleFindings(ids, edges, selfDependent) {
  const indexById = new Map();
  const lowLink = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];
  let nextIndex = 0;

  for (const root of ids) {
    if (indexById.has(root)) continue;

    // Explicit DFS frame: [id, successor cursor].
    const frames = [[root, 0]];
    indexById.set(root, nextIndex);
    lowLink.set(root, nextIndex);
    nextIndex += 1;
    stack.push(root);
    onStack.add(root);

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const [node, cursor] = frame;
      const successors = edges.get(node) ?? [];

      if (cursor < successors.length) {
        frame[1] += 1;
        const successor = successors[cursor];
        if (!indexById.has(successor)) {
          indexById.set(successor, nextIndex);
          lowLink.set(successor, nextIndex);
          nextIndex += 1;
          stack.push(successor);
          onStack.add(successor);
          frames.push([successor, 0]);
        } else if (onStack.has(successor)) {
          lowLink.set(node, Math.min(lowLink.get(node), indexById.get(successor)));
        }
        continue;
      }

      frames.pop();
      if (frames.length > 0) {
        const parent = frames[frames.length - 1][0];
        lowLink.set(parent, Math.min(lowLink.get(parent), lowLink.get(node)));
      }
      if (lowLink.get(node) === indexById.get(node)) {
        const component = [];
        let popped = stack.pop();
        onStack.delete(popped);
        component.push(popped);
        while (popped !== node) popped = stack.pop(), onStack.delete(popped), component.push(popped);
        components.push(component);
      }
    }
  }

  const findings = [];
  for (const component of components) {
    const members =
      component.length > 1 ? component : selfDependent.has(component[0]) ? component : null;
    if (!members) continue;
    // A multi-member component is only a real cycle if its members really do block one
    // another; edges here are exactly the blocking links, so membership already implies it.
    const items = sortIds(members);
    findings.push({
      type: 'cycle',
      items,
      detail: `dependency cycle among: ${items.join(', ')}`,
    });
  }
  return findings;
}

/**
 * Dependency-first ordering of a scanned item set, plus structural findings.
 *
 * Pure: same input always yields the same output, and the input array and its items are never
 * mutated. See the module header for the input contract, the result shape, the cycle-only
 * suppression rule (ORDERING) and which items are excluded when a non-cycle finding is present.
 *
 * @param {unknown[]} items scanned scope: work items with a string `id` and optional
 *   `dependencies` of `{id}` objects or bare id strings
 * @returns {{ordered: object[], findings: object[], clean: boolean, ids: string[]}} `ordered`
 *   is emptied ONLY by a `cycle` finding; `ids` is sorted ascending; `clean` is exactly
 *   `findings.length === 0`.
 */
function scanWorkGraph(items) {
  const list = Array.isArray(items) ? items : [];

  const byId = new Map();
  const ids = [];
  const findings = [];
  const missingIdIndexes = [];

  list.forEach((item, index) => {
    const id = itemIdOf(item);
    if (id === null) {
      missingIdIndexes.push(index);
      return;
    }
    if (!byId.has(id)) {
      byId.set(id, item);
      ids.push(id);
    }
  });

  /** item id -> ids it depends on (in scope or not), input order */
  const blocking = new Map();
  /** depended-on id -> ids needing it, input order */
  const edges = new Map();
  const selfDependent = new Set();
  /** absent dependency id -> in-scope items declaring it */
  const dangling = new Map();
  /** malformed dependency -> in-scope items declaring it */
  const malformed = new Map();
  /** In-scope dependency ids of `id`, deduplicated: one link can decrement once only. */
  const inScopeDeps = (id) => [...new Set(blocking.get(id).filter((depId) => byId.has(depId)))];

  for (const id of ids) {
    const deps = byId.get(id).dependencies;
    const own = [];
    blocking.set(id, own);
    if (deps === undefined || deps === null) continue;
    if (!Array.isArray(deps)) {
      const key = `${id}\u0000non-array`;
      if (!malformed.has(key)) malformed.set(key, [id]);
      continue;
    }
    for (const dep of deps) {
      const depId = dependencyIdOf(dep);
      if (depId === null) {
        const key = `${id}\u0000malformed`;
        if (!malformed.has(key)) malformed.set(key, [id]);
        continue;
      }
      own.push(depId);
      if (depId === id) selfDependent.add(id);
      if (!byId.has(depId)) {
        if (!dangling.has(depId)) dangling.set(depId, []);
        dangling.get(depId).push(id);
        continue;
      }
      // One link per (depender, dependent) pair: a repeated `{id: 'A'}` entry must not make
      // A's successor decrement twice and go negative.
      const adjacency = edges.get(depId) ?? [];
      if (!adjacency.includes(id)) adjacency.push(id);
      edges.set(depId, adjacency);
    }
  }

  for (const index of missingIdIndexes) {
    findings.push({
      type: 'missing-id',
      items: [],
      detail: `item at index ${index} has no usable string id`,
    });
  }

  for (const [dependency, declaredBy] of dangling) {
    findings.push({
      type: 'dangling-edge',
      items: sortIds(declaredBy),
      dependency,
      detail: `dependency '${dependency}' is not present in the scanned scope`,
    });
  }

  for (const declaredBy of malformed.values()) {
    findings.push({
      type: 'malformed-dependency',
      items: sortIds(declaredBy),
      detail: `unrecognized dependency link shape on ${sortIds(declaredBy).join(', ')}`,
    });
  }

  findings.push(...cycleFindings(ids, edges, selfDependent));

  findings.sort(compareFindings);
  const idsSorted = sortIds(ids);

  // Cycle suppression (AC-007-3): one cycle finding empties `ordered`. A clean graph falls
  // through to the ordering below with an empty exclusion set, so there is one ordering path.
  if (findings.some((finding) => finding.type === 'cycle')) {
    return { ordered: [], findings, clean: false, ids: idsSorted };
  }

  // AC-007-5: a dangling edge is REPORTED, not honored -- its blocking link is dropped, and
  // so is every link reachable from it, because an item gated on an unsatisfiable blocker
  // has no determinable position relative to that absent id. Dropping only the one link
  // would order that item as if its blocker were already satisfied, which is a false claim
  // that the item is ready. So: seed the prune with the in-scope declarants of dangling ids
  // (read back from the findings, the single source of truth) and cascade -- any item still
  // depending on an excluded item becomes excluded too, transitively. `missing-id` and
  // `malformed-dependency` items are excluded the same way: they are named in `findings` but
  // are not well-formed vertices, so they never reach `ordered`.
  const excluded = new Set(
    findings.flatMap((finding) =>
      finding.type === 'dangling-edge' || finding.type === 'malformed-dependency'
        ? finding.items
        : []
    )
  );

  // Transitive closure: an item that declares a link to an excluded item has its own position
  // made indeterminate by the same unsatisfiable blocker, so it is excluded too. Repeat until
  // the surviving subgraph is closed under "depends on"; each pass can only move items into
  // `excluded`, so this terminates in at most |ids| passes.
  let grew = true;
  while (grew) {
    grew = false;
    for (const id of ids) {
      if (excluded.has(id)) continue;
      if (inScopeDeps(id).some((depId) => excluded.has(depId))) {
        excluded.add(id);
        grew = true;
      }
    }
  }

  // Kahn's algorithm over the surviving subgraph, whose every edge is now inside it: FIFO
  // frontier seeded in input order, successors visited in input order, so the same item set
  // always yields the byte-identical same array.
  const survivors = ids.filter((id) => !excluded.has(id));
  const remaining = new Map(survivors.map((id) => [id, inScopeDeps(id).length]));
  const orderedIds = survivors.filter((id) => remaining.get(id) === 0);
  for (let i = 0; i < orderedIds.length; i += 1) {
    for (const dependent of edges.get(orderedIds[i]) ?? []) {
      if (excluded.has(dependent)) continue;
      const left = remaining.get(dependent) - 1;
      remaining.set(dependent, left);
      if (left === 0) orderedIds.push(dependent);
    }
  }

  return {
    ordered: orderedIds.map((id) => byId.get(id)),
    findings,
    clean: findings.length === 0,
    ids: idsSorted,
  };
}

/**
 * Project a `scanWorkGraph` result onto the `work-graph` category contract's
 * `work-graph.graph-health` outputs (`status`, `findings`). No re-derivation: an empty
 * `findings` is `'healthy'`, anything else is `'unhealthy'`.
 *
 * @param {{findings: object[]}} scanResult a `scanWorkGraph` return value
 * @returns {{status: 'healthy' | 'unhealthy', findings: object[]}}
 */
function isGraphHealthy(scanResult) {
  const findings = Array.isArray(scanResult?.findings) ? scanResult.findings : [];
  return {
    status: findings.length === 0 ? 'healthy' : 'unhealthy',
    findings,
  };
}

module.exports = { scanWorkGraph, isGraphHealthy };
