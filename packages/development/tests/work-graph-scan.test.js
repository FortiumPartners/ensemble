/**
 * TRD-018-TEST: shared dependency-edge scan on fixed graphs
 * (TRD-2026-6995dc96 TRD-018; PRD-2026-6995dc96 REQ-007 AC-007-2, AC-007-3, AC-007-5).
 *
 * `lib/toolchain/work-graph-scan.js` is the pure core behind `work-graph.plan`
 * (TRD-019), the ready-list edge export (TRD-017) and the truthful builtin graph-health
 * fallback (TRD-026). Nothing in the repo exercised it, so a regression in ordering,
 * cycle detection, or dangling-edge reporting would ship silently. These three fixed
 * graphs pin the three guarantees the callers depend on:
 *   AC-007-2 dependency-first ordering,
 *   AC-007-3 cycles are REPORTED (and never silently ordered),
 *   AC-007-5 dependencies outside the scanned scope are REPORTED.
 *
 * Fixed graphs only: no filesystem, no subprocess, no environment, no tracker.
 */

const { scanWorkGraph, isGraphHealthy } = require('../lib/toolchain/work-graph-scan');

describe('work-graph-scan (TRD-018-TEST)', () => {
  describe('AC-007-2 dependency-first ordering', () => {
    test('orders a chain so every item follows the items it depends on', () => {
      // Input deliberately worst-case: dependents before dependencies.
      const items = [
        { id: 'A', dependencies: ['B'] },
        { id: 'B', dependencies: [{ id: 'C' }] },
        { id: 'C', dependencies: [] },
      ];

      const result = scanWorkGraph(items);

      expect(result.ordered.map((item) => item.id)).toEqual(['C', 'B', 'A']);
      // AC-007-2 is a "every item appears after its dependencies" guarantee, so pin
      // the pairwise positions the bead names rather than only the whole sequence.
      const positionOf = (id) => result.ordered.map((item) => item.id).indexOf(id);
      expect(positionOf('C')).toBeLessThan(positionOf('B'));
      expect(positionOf('B')).toBeLessThan(positionOf('A'));
      expect(result.findings).toEqual([]);
      expect(result.clean).toBe(true);
      expect(result.ids).toEqual(['A', 'B', 'C']);
    });

    test('returns the same sequence for the same item set, and never mutates the input', () => {
      const build = () => [
        { id: 'A', dependencies: ['B'] },
        { id: 'B', dependencies: [{ id: 'C' }] },
        { id: 'C', dependencies: [] },
      ];
      const input = build();
      const before = JSON.stringify(input);

      const first = scanWorkGraph(build());
      const second = scanWorkGraph(input);

      // AC-007-1's determinism guarantee, applied to the plan path.
      expect(second.ordered.map((item) => item.id)).toEqual(
        first.ordered.map((item) => item.id)
      );
      expect(JSON.stringify(input)).toBe(before);
    });

    test('keeps the caller listing order among items nothing blocks', () => {
      // Ordering is dependency-first, NOT id-sorted: among items the graph leaves free,
      // the plan must keep the tracker's own listing order (AC-007-1), so a plan built
      // from a priority-ordered listing is not silently re-sorted by id.
      const result = scanWorkGraph([
        { id: 'Z-late', dependencies: [] },
        { id: 'A-early', dependencies: [] },
        { id: 'M-middle', dependencies: [] },
      ]);

      expect(result.ordered.map((item) => item.id)).toEqual([
        'Z-late',
        'A-early',
        'M-middle',
      ]);
      expect(result.findings).toEqual([]);
    });

    test('returns the caller item objects themselves, not id-only stand-ins', () => {
      const a = { id: 'A', dependencies: ['B'], title: 'Ship it' };
      const b = { id: 'B', dependencies: [], title: 'Dep' };

      const result = scanWorkGraph([a, b]);

      expect(result.ordered[0]).toBe(b);
      expect(result.ordered[1]).toBe(a);
    });
  });

  describe('AC-007-3 cycle reporting', () => {
    test('reports exactly one cycle finding naming both items of a two-item cycle', () => {
      const result = scanWorkGraph([
        { id: 'A', dependencies: ['B'] },
        { id: 'B', dependencies: ['A'] },
      ]);

      const cycles = result.findings.filter((finding) => finding.type === 'cycle');
      expect(cycles).toHaveLength(1);
      expect(cycles[0].items).toEqual(['A', 'B']);

      expect(result.clean).toBe(false);
      expect(isGraphHealthy(result).status).toBe('unhealthy');
    });

    test('suppresses ordering entirely rather than silently ordering the cycle', () => {
      // AC-007-3 forbids "plan silently ordering cycle anyway": a partial order that
      // happens to place cycle members early is exactly the plausible-but-wrong output
      // the contract suppresses, so `ordered` must be empty, not partial.
      const result = scanWorkGraph([
        { id: 'A', dependencies: ['B'] },
        { id: 'B', dependencies: ['A'] },
        { id: 'C', dependencies: [] },
      ]);

      expect(result.ordered).toEqual([]);
      expect(result.findings.filter((f) => f.type === 'cycle')).toHaveLength(1);
      // The cycle members stay triageable even though they are unordered.
      expect(result.ids).toEqual(['A', 'B', 'C']);
    });
  });

  describe('AC-007-5 dangling-edge reporting', () => {
    test('reports a dangling-edge finding naming the out-of-scope id', () => {
      const result = scanWorkGraph([
        { id: 'A', dependencies: ['GHOST-9'] },
        { id: 'B', dependencies: [] },
      ]);

      const dangling = result.findings.filter((f) => f.type === 'dangling-edge');
      expect(dangling).toHaveLength(1);
      expect(dangling[0].dependency).toBe('GHOST-9');
      expect(dangling[0].items).toEqual(['A']);

      expect(result.clean).toBe(false);
      expect(isGraphHealthy(result).status).toBe('unhealthy');
    });

    test('still orders items whose position is determinable when an edge dangles', () => {
      // A dangling edge must be reported but must NOT empty the plan: findings reach a
      // caller only through graph-health, so an emptied `ordered` here would make
      // work-graph.plan return zero items while surfacing the reason nowhere.
      const result = scanWorkGraph([
        { id: 'A', dependencies: ['GHOST-9'] },
        { id: 'B', dependencies: [] },
      ]);

      expect(result.ordered.map((item) => item.id)).toEqual(['B']);
      expect(result.ids).toEqual(['A', 'B']);
    });
  });
});
