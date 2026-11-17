'use strict';

/**
 * TRD-026 (br-199gw, Implementation AC 4): the built-in `work-graph-links-fallback` answers
 * `work-graph.graph-health` from the shared scan (`work-graph-scan.js`) instead of refusing, so
 * the category contract's fallback claim is true.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  runWorkGraphCapability
} = require('../../packages/development/lib/toolchain/builtin/work-graph-links-fallback');
const {
  writeNoWorkGraphTrackerStub,
  writeStubControl
} = require('./fixtures/toolchain/work-graph-fallback-tracker-stub');

const tempDirs = [];
afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function trackerManifest(binPath, declareDependencies) {
  const map = declareDependencies
    ? { id: '$.id', status: '$.status', dependencies: '$.dependencies' }
    : { id: '$.id', status: '$.status' };
  return {
    adapter: 'fixture-work-graph-tracker',
    version: '1.0.0',
    categories: ['tracker'],
    contract: { tracker: '1.0' },
    binaries: [binPath],
    allowlist: [{ bin: binPath, sub: ['list', 'show'] }],
    env: [],
    health: [],
    detect: [],
    capabilities: {
      'tracker.list': { run: [binPath, 'list'] },
      'tracker.show': {
        run: [binPath, 'show', '${id}'],
        parse: {
          format: 'json',
          root: '$',
          map,
          statusMap: { open: 'open', in_progress: 'in_progress', closed: 'closed' }
        }
      }
    }
  };
}

async function health(items, declareDependencies) {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-graph-health-'));
  tempDirs.push(binDir);
  const binPath = writeNoWorkGraphTrackerStub(binDir);
  writeStubControl(binDir, items);
  return runWorkGraphCapability(
    'work-graph.graph-health',
    trackerManifest(binPath, declareDependencies),
    {},
    {}
  );
}

describe('work-graph.graph-health on the built-in fallback', () => {
  test('a dependency cycle is unhealthy with a cycle finding', async () => {
    const result = await health(
      [
        { id: 'wg-1', status: 'open', dependencies: [{ id: 'wg-2' }] },
        { id: 'wg-2', status: 'open', dependencies: [{ id: 'wg-1' }] }
      ],
      true
    );
    expect(result.ok).toBe(true);
    expect(result.capability).toBe('work-graph.graph-health');
    expect(result.adapter).toBe('work-graph-links-fallback');
    expect(result.data.status).toBe('unhealthy');
    expect(result.data.findings.length).toBeGreaterThan(0);
    expect(JSON.stringify(result.data.findings)).toMatch(/cycle/i);
    expect(result.data.dependencyAware).toBe(true);
    expect(result.data.orderingSource).toBe('tracker-links');
  });

  test('an acyclic graph is healthy with no findings', async () => {
    const result = await health(
      [
        { id: 'wg-1', status: 'open', dependencies: [{ id: 'wg-2' }] },
        { id: 'wg-2', status: 'open', dependencies: [] }
      ],
      true
    );
    expect(result.ok).toBe(true);
    expect(result.data.status).toBe('healthy');
    expect(result.data.findings).toEqual([]);
    expect(result.data.dependencyAware).toBe(true);
  });

  test('a tracker with no dependency data reports dependencyAware:false, plan-order, no findings', async () => {
    const result = await health([{ id: 'wg-a', status: 'open' }, { id: 'wg-b', status: 'open' }], false);
    expect(result.ok).toBe(true);
    expect(result.data.findings).toEqual([]);
    expect(result.data.dependencyAware).toBe(false);
    expect(result.data.orderingSource).toBe('plan-order');
  });

  test('an unknown capability is still refused', async () => {
    const result = await runWorkGraphCapability('work-graph.bogus', {}, {}, {});
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('NOT_ALLOWED');
  });
});
