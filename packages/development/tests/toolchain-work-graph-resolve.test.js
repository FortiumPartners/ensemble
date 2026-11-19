'use strict';

/**
 * TRD-031-TEST (br-bdz4q; PRD REQ-001/AC-001-1): source/autoVia reporting of
 * `resolveWorkGraphAdapter` against the real implementation.
 *
 * TRD wording deviation: the TRD says the no-tracker-no-explicit case reports `source:
 * builtin-fallback`. In the implementation `builtin-fallback` is the `autoVia` value; `source`
 * stays the work-graph category's own resolved source ('default'). The builtin path occurs
 * only when the resolved tracker manifest does not declare `work-graph` (jira, azure-boards).
 * With nothing configured the default tracker is beads, which does declare it, so the result
 * is autoVia 'tracker-capabilities', source 'default'.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const FAKE_ID = 'fake-tracker';
const ALL_WG = ['work-graph.ready', 'work-graph.plan', 'work-graph.graph-health'];

jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  return {
    ...actual,
    spawn: jest.fn(actual.spawn),
    spawnSync: jest.fn(actual.spawnSync),
    execFile: jest.fn(actual.execFile),
    execFileSync: jest.fn(actual.execFileSync),
    exec: jest.fn(actual.exec),
    execSync: jest.fn(actual.execSync)
  };
});

jest.mock('../lib/toolchain/adapters', () => {
  const actual = jest.requireActual('../lib/toolchain/adapters');
  return {
    ...actual,
    loadAdapter: (id, ctx) => {
      if (id === 'fake-tracker') {
        const capabilities = {};
        for (const c of global.__fakeWgCaps) capabilities[c] = { run: [] };
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

const childProcess = require('child_process');
const { resolveWorkGraphAdapter } = require('../lib/toolchain/work-graph-resolve');

const SCRATCH = path.join(os.homedir(), '.omp', 'trd-032-test');

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
  global.__fakeWgCaps = ALL_WG;
  jest.clearAllMocks();
});

describe('TRD-031-TEST: work-graph source reporting', () => {
  test('Happy: tracker kata, no explicit work-graph -> tracker-supplied origin, not default', () => {
    const r = resolveWorkGraphAdapter(contextFor({ tracker: 'kata' }));
    expect(r.value).toBe('kata');
    expect(r.autoVia).toBe('tracker-capabilities');
    expect(r.source).toBe('project');
    expect(r.source).not.toBe('default');
  });

  test('Edge: explicit work-graph in project config -> project source, no autoVia', () => {
    const r = resolveWorkGraphAdapter(contextFor({ tracker: 'kata', 'work-graph': 'kata' }));
    expect(r.value).toBe('kata');
    expect(r.autoVia).toBeNull();
    expect(r.source).toBe('project');
  });

  test('Edge: tracker jira (no work-graph category), nothing explicit -> builtin-fallback', () => {
    const r = resolveWorkGraphAdapter(contextFor({ tracker: 'jira' }));
    expect(r.autoVia).toBe('builtin-fallback');
    expect(r.value).toBe('work-graph-links-fallback');
    expect(r.source).toBe('default');
    expect(r.trackerAdapterId).toBe('jira');
    expect(r.trackerManifest).toBeDefined();
    expect(r.trackerManifest.categories).not.toContain('work-graph');
  });

  test('Edge: tracker jira with explicit project work-graph -> project source, no fallback', () => {
    const r = resolveWorkGraphAdapter(contextFor({ tracker: 'jira', 'work-graph': 'kata' }));
    expect(r.autoVia).toBeNull();
    expect(r.source).toBe('project');
    expect(r.value).toBe('kata');
    expect(r.trackerAdapterId).toBeUndefined();
    expect(r.trackerManifest).toBeUndefined();
  });

  test('Edge: neither tracker nor work-graph configured -> beads default via tracker-capabilities', () => {
    const r = resolveWorkGraphAdapter(contextFor({}));
    expect(r.value).toBe('beads');
    expect(r.autoVia).toBe('tracker-capabilities');
    expect(r.source).toBe('default');
  });
});

describe('TRD-032-TEST: capability gate and explicit-mismatch diagnostic', () => {
  test('Happy: a manifest declaring all three work-graph capabilities claims the category', () => {
    const r = resolveWorkGraphAdapter(contextFor({ tracker: FAKE_ID }));
    expect(r.autoVia).toBe('tracker-capabilities');
    expect(r.value).toBe(FAKE_ID);
    expect(r.source).toBe('project');
  });

  test('Edge: declaring the category but omitting work-graph.graph-health does not claim it', () => {
    global.__fakeWgCaps = ['work-graph.ready', 'work-graph.plan'];
    const r = resolveWorkGraphAdapter(contextFor({ tracker: FAKE_ID }));
    expect(r.autoVia).toBe('builtin-fallback');
    expect(r.value).toBe('work-graph-links-fallback');
    expect(r.trackerAdapterId).toBe(FAKE_ID);
  });

  test('Edge: tracker kata with work-graph beads emits a named mismatch and invokes no beads binary', () => {
    const diagnostics = [];
    const r = resolveWorkGraphAdapter(
      contextFor({ tracker: 'kata', 'work-graph': 'beads' }, { diagnostics })
    );
    const d = diagnostics.find((x) => x.code === 'WORK_GRAPH_BACKEND_MISMATCH');
    expect(d).toMatchObject({ tracker: 'kata', workGraph: 'beads' });
    expect(r.diagnostics).toEqual([d]);
    for (const fn of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync']) {
      expect(childProcess[fn]).not.toHaveBeenCalled();
    }
  });
});
