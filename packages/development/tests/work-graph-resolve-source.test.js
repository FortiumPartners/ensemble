'use strict';

/**
 * TRD-031 (br-hv6o5; PRD REQ-001/AC-001-1): `resolveWorkGraphAdapter` reports where a
 * tracker-supplied work-graph came from instead of the literal `default`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveWorkGraphAdapter } = require('../lib/toolchain/work-graph-resolve');

function contextFor(projectConfig) {
  return {
    projectConfig,
    env: { XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'wg-resolve-source-')) },
    detect: () => null
  };
}

describe('TRD-031: work-graph source on a tracker-supplied path', () => {
  test('AC-1: tracker: kata with no work-graph reports the project-config source', () => {
    const resolved = resolveWorkGraphAdapter(contextFor({ tracker: 'kata' }));

    expect(resolved.value).toBe('kata');
    expect(resolved.autoVia).toBe('tracker-capabilities');
    expect(resolved.source).toBe('project');
    expect(resolved.source).not.toBe('default');
  });

  test('AC-2: an explicit work-graph value wins and reports the project-config source', () => {
    const resolved = resolveWorkGraphAdapter(
      contextFor({ tracker: 'beads', 'work-graph': 'kata' })
    );

    expect(resolved.value).toBe('kata');
    expect(resolved.autoVia).toBeNull();
    expect(resolved.source).toBe('project');
  });

  test('AC-3: neither a tracker selection nor an explicit work-graph keeps the default source', () => {
    const resolved = resolveWorkGraphAdapter(contextFor({}));

    expect(resolved.value).toBe('beads');
    expect(resolved.autoVia).toBe('tracker-capabilities');
    expect(resolved.source).toBe('default');
  });
});
