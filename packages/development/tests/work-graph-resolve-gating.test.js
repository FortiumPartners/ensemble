'use strict';

/**
 * TRD-032 (br-x55hq; PRD REQ-001/AC-001-1, REQ-012): the resolver gates the work-graph claim on
 * declared capabilities and diagnoses a cross-backend work-graph mismatch.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const FAKE_ID = 'fake-tracker';
const ALL = ['work-graph.ready', 'work-graph.plan', 'work-graph.graph-health'];

jest.mock('../lib/toolchain/adapters', () => {
  const actual = jest.requireActual('../lib/toolchain/adapters');
  return {
    ...actual,
    loadAdapter: (id, ctx) => {
      if (id === 'fake-tracker') {
        const capabilities = {};
        for (const c of global.__fakeCaps) capabilities[c] = { run: [] };
        return {
          origin: 'installed',
          dir: '/nonexistent',
          manifest: { id, categories: ['tracker', 'work-graph'], capabilities }
        };
      }
      return actual.loadAdapter(id, ctx);
    }
  };
});

const { resolveWorkGraphAdapter } = require('../lib/toolchain/work-graph-resolve');

const SCRATCH = path.join(os.homedir(), '.omp', 'trd-032');

function contextFor(projectConfig, extra = {}) {
  fs.mkdirSync(SCRATCH, { recursive: true });
  return {
    projectConfig,
    env: { XDG_CONFIG_HOME: fs.mkdtempSync(path.join(SCRATCH, 'xdg-')) },
    detect: () => null,
    ...extra
  };
}

beforeEach(() => {
  global.__fakeCaps = ALL;
});

describe('TRD-032: capability gating', () => {
  test.each(ALL)('a tracker omitting %s does not claim work-graph (builtin fallback)', (missing) => {
    global.__fakeCaps = ALL.filter((c) => c !== missing);
    const resolved = resolveWorkGraphAdapter(contextFor({ tracker: FAKE_ID }));
    expect(resolved.autoVia).toBe('builtin-fallback');
    expect(resolved.trackerAdapterId).toBe(FAKE_ID);
  });

  test('a tracker declaring all three claims the category with no diagnostic', () => {
    const diagnostics = [];
    const resolved = resolveWorkGraphAdapter(contextFor({ tracker: FAKE_ID }, { diagnostics }));
    expect(resolved.autoVia).toBe('tracker-capabilities');
    expect(resolved.value).toBe(FAKE_ID);
    expect(diagnostics).toEqual([]);
    expect(resolved.diagnostics || []).toEqual([]);
  });

  test('shipped beads and kata declare all three and are claimed', () => {
    for (const id of ['beads', 'kata']) {
      const resolved = resolveWorkGraphAdapter(contextFor({ tracker: id }));
      expect(resolved.autoVia).toBe('tracker-capabilities');
      expect(resolved.value).toBe(id);
      expect(resolved.source).not.toBe('default');
    }
  });
});

describe('TRD-032: cross-backend mismatch diagnostic', () => {
  test('tracker: kata with work-graph: beads emits WORK_GRAPH_BACKEND_MISMATCH and still resolves', () => {
    const diagnostics = [];
    const resolved = resolveWorkGraphAdapter(
      contextFor({ tracker: 'kata', 'work-graph': 'beads' }, { diagnostics })
    );
    expect(resolved.value).toBe('beads');
    expect(resolved.autoVia).toBeNull();
    const d = diagnostics.find((x) => x.code === 'WORK_GRAPH_BACKEND_MISMATCH');
    expect(d).toMatchObject({ tracker: 'kata', workGraph: 'beads' });
    expect(typeof d.message).toBe('string');
    expect(d.message).toContain('kata');
    expect(d.message).toContain('beads');
    expect(resolved.diagnostics).toEqual([d]);
  });

  test('the diagnostic is exposed on the result when ctx.diagnostics is not an array', () => {
    const resolved = resolveWorkGraphAdapter(contextFor({ tracker: 'kata', 'work-graph': 'beads' }));
    expect(resolved.diagnostics).toHaveLength(1);
    expect(resolved.diagnostics[0].code).toBe('WORK_GRAPH_BACKEND_MISMATCH');
  });

  test('matching ids emit no diagnostic', () => {
    const diagnostics = [];
    const resolved = resolveWorkGraphAdapter(
      contextFor({ tracker: 'beads', 'work-graph': 'beads' }, { diagnostics })
    );
    expect(resolved.value).toBe('beads');
    expect(diagnostics).toEqual([]);
    expect(resolved.diagnostics || []).toEqual([]);
  });

  test('an unresolvable-by-id tracker still differs by id and is diagnosed without throwing', () => {
    const diagnostics = [];
    const resolved = resolveWorkGraphAdapter(
      contextFor({ tracker: 'no-such-tracker-xyz', 'work-graph': 'beads' }, { diagnostics })
    );
    expect(resolved.value).toBe('beads');
    expect(diagnostics.map((d) => d.code)).toEqual(['WORK_GRAPH_BACKEND_MISMATCH']);
  });

  test('a throwing tracker lookup yields no diagnostic and no throw', () => {
    const diagnostics = [];
    const ctx = contextFor({ 'work-graph': 'beads' }, { diagnostics });
    ctx.detect = () => {
      throw new Error('detect boom');
    };
    // work-graph is explicit via config; only the tracker lookup (detection) throws.
    let resolved;
    expect(() => {
      resolved = resolveWorkGraphAdapter(ctx);
    }).not.toThrow();
    expect(resolved.value).toBe('beads');
    expect(diagnostics).toEqual([]);
  });
});
