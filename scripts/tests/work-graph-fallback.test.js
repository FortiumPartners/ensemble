'use strict';

/**
 * Unit tests for TRD-027 (br-jo8y): the built-in `work-graph-links-fallback` adapter
 * (`packages/development/lib/toolchain/builtin/work-graph-links-fallback`) and its `auto`
 * resolution (`packages/development/lib/toolchain/work-graph-resolve.js`), covering TRD-027's
 * three Implementation AC branches:
 *
 *  1. A tracker adapter whose manifest lacks `work-graph.ready` but whose `tracker.show`
 *     returns `dependencies[]`: `data.orderingSource` is `'tracker-links'` and only items with
 *     every dependency closed are returned by `work-graph.ready`.
 *  2. A tracker adapter with neither `work-graph.ready` nor dependency data: `work-graph.plan`
 *     returns items in the supplied plan order with `orderingSource: 'plan-order'` and
 *     `dependencyAware: false`.
 *  3. A command declares a capability as required (`work-graph.graph-health`) that the resolved
 *     tracker does not implement: the built-in fallback now answers it from the shared scan
 *     (TRD-026), so the preflight gate passes, resolves to the fallback and writes its record.
 *     (The old refusal branch is still reachable only through the mutation proof in
 *     `packages/development/tests/toolchain-cli.test.js`.)
 *
 * `runWorkGraphCapability` is exercised directly against a real, file-based stub tracker binary
 * (`./fixtures/toolchain/work-graph-fallback-tracker-stub.js` -- never an inline `-e` script
 * string, which this fixture's own header explains is unsafe for JS containing `{...}` object
 * literals, given how `packages/development/lib/toolchain/runner.js#buildArgv`'s placeholder
 * regex matches ANY curly-brace span in an argv element), so `tracker.list`/`tracker.show` are
 * real (fast, deterministic) child processes through the real, unmodified runner -- nothing
 * about the runner's own execution path is mocked.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const {
  runWorkGraphCapability
} = require('../../packages/development/lib/toolchain/builtin/work-graph-links-fallback');
const { runPreflight } = require('../../packages/development/lib/toolchain/preflight');
const {
  writeNoWorkGraphTrackerStub,
  writeStubControl
} = require('./fixtures/toolchain/work-graph-fallback-tracker-stub');

const tempDirs = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function mkTempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/**
 * Build a tracker adapter manifest (`categories: ['tracker']` only -- no `work-graph`, so this
 * repo's own `./work-graph-resolve.js#resolveWorkGraphAdapter` would fall back to the builtin
 * adapter for it) backed by the real stub binary in `binDir`.
 *
 * @param {string} binPath from `writeNoWorkGraphTrackerStub`
 * @param {boolean} declareDependencies whether `tracker.show`'s `parse.map` projects a
 *   `dependencies` field at all (TRD-027's distinction between "tracker provides dependency
 *   data" and "tracker has none")
 */
function buildTrackerManifest(binPath, declareDependencies) {
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

describe('AC 1: tracker.show returns dependencies[] -> work-graph.ready uses tracker-links ordering, only all-dependencies-closed items returned', () => {
  test('wg-2 (no deps) and wg-4 (dep on closed wg-3) are ready; wg-1 (dep on open wg-2) and closed wg-3 are not', async () => {
    const binDir = mkTempDir('wg-fallback-ac1-bin-');
    const binPath = writeNoWorkGraphTrackerStub(binDir);
    writeStubControl(binDir, [
      { id: 'wg-1', status: 'open', dependencies: [{ id: 'wg-2' }] },
      { id: 'wg-2', status: 'open', dependencies: [] },
      { id: 'wg-3', status: 'closed', dependencies: [] },
      { id: 'wg-4', status: 'open', dependencies: [{ id: 'wg-3' }] }
    ]);
    const trackerManifest = buildTrackerManifest(binPath, true);

    const result = await runWorkGraphCapability('work-graph.ready', trackerManifest, {}, {});

    expect(result.ok).toBe(true);
    expect(result.data.orderingSource).toBe('tracker-links');
    expect(result.data.dependencyAware).toBe(true);
    expect(result.data.items.map((item) => item.id)).toEqual(['wg-2', 'wg-4']);
  });

  test('work-graph.plan under tracker-links data topologically orders items, excluding already-closed ones', async () => {
    const binDir = mkTempDir('wg-fallback-ac1-plan-bin-');
    const binPath = writeNoWorkGraphTrackerStub(binDir);
    writeStubControl(binDir, [
      { id: 'wg-1', status: 'open', dependencies: [{ id: 'wg-2' }] },
      { id: 'wg-2', status: 'open', dependencies: [] },
      { id: 'wg-3', status: 'closed', dependencies: [] },
      { id: 'wg-4', status: 'open', dependencies: [{ id: 'wg-3' }] }
    ]);
    const trackerManifest = buildTrackerManifest(binPath, true);

    const result = await runWorkGraphCapability('work-graph.plan', trackerManifest, {}, {});

    expect(result.ok).toBe(true);
    expect(result.data.orderingSource).toBe('tracker-links');
    expect(result.data.dependencyAware).toBe(true);
    // wg-2 and wg-4 have every dependency already satisfied; wg-1 depends on wg-2, which must
    // be placed before it. wg-3 (closed) is excluded -- nothing left to plan for it.
    const ids = result.data.items.map((item) => item.id);
    expect(ids).toContain('wg-1');
    expect(ids).not.toContain('wg-3');
    expect(ids.indexOf('wg-2')).toBeLessThan(ids.indexOf('wg-1'));
  });
});

describe('AC 2: neither work-graph.ready on the tracker nor dependency data -> work-graph.plan returns plan order, dependencyAware:false', () => {
  test('three items with no dependencies field at all come back unchanged, in supplied order', async () => {
    const binDir = mkTempDir('wg-fallback-ac2-bin-');
    const binPath = writeNoWorkGraphTrackerStub(binDir);
    writeStubControl(binDir, [
      { id: 'wg-a', status: 'open' },
      { id: 'wg-b', status: 'in_progress' },
      { id: 'wg-c', status: 'closed' }
    ]);
    // declareDependencies:false -- tracker.show's own parse.map never projects a
    // 'dependencies' field, matching a real tracker (e.g. the shipped `beads` adapter's own
    // tracker.show) that simply does not expose dependency links.
    const trackerManifest = buildTrackerManifest(binPath, false);

    const result = await runWorkGraphCapability('work-graph.plan', trackerManifest, {}, {});

    expect(result.ok).toBe(true);
    expect(result.data.orderingSource).toBe('plan-order');
    expect(result.data.dependencyAware).toBe(false);
    expect(result.data.items.map((item) => item.id)).toEqual(['wg-a', 'wg-b', 'wg-c']);
  });
});

describe('AC 3: a required work-graph.graph-health the tracker lacks is answered by the built-in fallback (TRD-026)', () => {
  function mkProjectConfig(projectRoot, categoryToAdapter) {
    const ensembleDir = path.join(projectRoot, '.ensemble');
    fs.mkdirSync(ensembleDir, { recursive: true });
    const lines =
      Object.entries(categoryToAdapter)
        .map(([category, adapterId]) => `${category}: ${adapterId}`)
        .join('\n') + '\n';
    fs.writeFileSync(path.join(ensembleDir, 'toolchain.yaml'), lines);
  }

  function mkInstalledTracker(projectRoot, adapterId, binPath) {
    const skillDir = path.join(projectRoot, 'packages', 'fixture-pkg', 'skills', adapterId);
    fs.mkdirSync(skillDir, { recursive: true });
    const manifest = buildTrackerManifest(binPath, false);
    manifest.adapter = adapterId;
    fs.writeFileSync(path.join(skillDir, 'adapter.yaml'), yaml.dump(manifest));
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `# ${adapterId}\n## Vocabulary\nstub\n`);
  }

  test('preflight --require work-graph.graph-health: tracker lacks work-graph, built-in fallback answers it -> ok:true and a preflight record IS written', async () => {
    const projectRoot = mkTempDir('wg-fallback-ac3-project-');
    const binDir = mkTempDir('wg-fallback-ac3-bin-');
    const binPath = writeNoWorkGraphTrackerStub(binDir);
    writeStubControl(binDir, [{ id: 'wg-x', status: 'open' }]);

    mkProjectConfig(projectRoot, { tracker: 'fixture-ac3-tracker' });
    mkInstalledTracker(projectRoot, 'fixture-ac3-tracker', binPath);
    // 'work-graph' is deliberately left unset -> shipped default 'auto'.

    const runId = 'wg-fallback-ac3-run';
    const result = await runPreflight(
      { categories: ['work-graph'], runId, requires: ['work-graph.graph-health'] },
      { projectRoot, env: { PATH: process.env.PATH } }
    );

    expect(result.ok).toBe(true);
    expect(result.runId).toBe(runId);

    const recordPath = path.join(projectRoot, '.ensemble', 'state', 'toolchain', `preflight-${runId}.json`);
    expect(fs.existsSync(recordPath)).toBe(true);
  });

  test('work-graph.ready itself stays available on the built-in fallback (sanity: ready/plan are unaffected by graph-health)', async () => {
    const projectRoot = mkTempDir('wg-fallback-ac3-sanity-project-');
    const binDir = mkTempDir('wg-fallback-ac3-sanity-bin-');
    const binPath = writeNoWorkGraphTrackerStub(binDir);
    writeStubControl(binDir, [{ id: 'wg-y', status: 'open' }]);

    mkProjectConfig(projectRoot, { tracker: 'fixture-ac3-sanity-tracker' });
    mkInstalledTracker(projectRoot, 'fixture-ac3-sanity-tracker', binPath);

    const runId = 'wg-fallback-ac3-sanity-run';
    const result = await runPreflight(
      { categories: ['work-graph'], runId, requires: ['work-graph.ready'] },
      { projectRoot, env: { PATH: process.env.PATH } }
    );

    expect(result.ok).toBe(true);
    expect(result.runId).toBe(runId);
  });
});
