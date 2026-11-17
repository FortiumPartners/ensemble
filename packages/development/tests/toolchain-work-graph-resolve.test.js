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

const { resolveWorkGraphAdapter } = require('../lib/toolchain/work-graph-resolve');

function contextFor(projectConfig) {
  return {
    projectConfig,
    env: { XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'toolchain-wg-resolve-')) },
    detect: () => null
  };
}

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
