'use strict';

/**
 * TRD-2026-6995dc96 TRD-016-TEST (br-lto19; PRD REQ-006/AC-006-2, REQ-007): work-graph routing and
 * module-dispatch confinement, end to end through the real resolver.
 *
 *  - Happy: `work-graph: auto` + a kata tracker resolves to the kata adapter, not the built-in
 *    links analyzer.
 *  - Edge: a module path escaping the adapter directory is refused before any code loads (a
 *    sentinel module that would record its own load proves it).
 *  - Edge: a project on the shipped jira tracker still resolves `work-graph` to the built-in links
 *    analyzer, which answers exactly as the analyzer alone does.
 *
 * Complements work-graph-module-dispatch.test.js (unit-level dispatch) and
 * work-graph-resolve-source.test.js (source field) without repeating their assertions.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  resolveWorkGraphAdapter,
  dispatchWorkGraphCapability
} = require('../lib/toolchain/work-graph-resolve');
const { runWorkGraphCapability, ADAPTER_ID: BUILTIN_ID } = require('../lib/toolchain/builtin/work-graph-links-fallback');

const DEV_ROOT = path.join(__dirname, '..');
const KATA_DIR = path.join(DEV_ROOT, 'skills', 'adapter-tracker-kata');

const scratch = [];
function mkScratch(prefix) {
  const parent = path.join(os.homedir(), '.omp', 'br-lto19', 'jest');
  fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, prefix));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

function contextFor(projectConfig) {
  return {
    projectConfig,
    env: { XDG_CONFIG_HOME: mkScratch('wg-dispatch-xdg-') },
    detect: () => null
  };
}

describe('TRD-016-TEST Happy: work-graph auto with a kata tracker', () => {
  const resolved = resolveWorkGraphAdapter(contextFor({ tracker: 'kata', 'work-graph': 'auto' }));

  test('names kata, via the tracker capability, not the built-in links analyzer', () => {
    expect(resolved.value).toBe('kata');
    expect(resolved.value).not.toBe(BUILTIN_ID);
    expect(resolved.autoVia).toBe('tracker-capabilities');
    expect(resolved.autoVia).not.toBe('builtin-fallback');
    expect(resolved.manifest.adapter).toBe('kata');
    expect(resolved.trackerManifest).toBeUndefined();
    expect(resolved.trackerAdapterId).toBeUndefined();
  });

  test('is the shipped kata adapter directory and declares all three work-graph capabilities', () => {
    expect(fs.realpathSync(resolved.dir)).toBe(fs.realpathSync(KATA_DIR));
    expect(resolved.manifest.categories).toContain('work-graph');
    for (const cap of ['work-graph.ready', 'work-graph.plan', 'work-graph.graph-health']) {
      expect(resolved.manifest.capabilities[cap]).toBeDefined();
    }
  });

  test('dispatch hands the work-graph call to the kata manifest, never to the builtin analyzer', async () => {
    const runnerCalls = [];
    const builtinCalls = [];
    const result = await dispatchWorkGraphCapability(resolved, 'work-graph.ready', {}, {
      source: resolved.source,
      cwd: '/proj',
      runCapabilityImpl: async (...a) => { runnerCalls.push(a); return { ok: true }; },
      runBuiltinImpl: async (...a) => { builtinCalls.push(a); return { ok: true }; }
    });
    expect(result.ok).toBe(true);
    expect(builtinCalls).toHaveLength(0);
    expect(runnerCalls).toHaveLength(1);
    expect(runnerCalls[0][0].adapter).toBe('kata');
  });
});

describe('TRD-016-TEST Edge: module path escaping the adapter directory', () => {
  function fixture() {
    const root = mkScratch('wg-dispatch-escape-');
    const dir = path.join(root, 'adapter');
    fs.mkdirSync(dir);
    const marker = path.join(root, 'loaded.marker');
    // The sentinel records any load, whether via require() at module top level or otherwise.
    const sentinel = `require('fs').writeFileSync(${JSON.stringify(marker)}, 'loaded');\n` +
      "module.exports = { run: async () => ({ ok: true, data: 'escaped' }) };\n";
    return { root, dir, marker, sentinel };
  }

  function resolvedFor(dir, mod) {
    return {
      value: 'fixture',
      source: 'project',
      autoVia: 'tracker-capabilities',
      dir,
      manifest: { adapter: 'fixture', capabilities: { 'work-graph.plan': { module: mod } } }
    };
  }

  test.each([
    ['parent traversal', () => '../evil.js'],
    ['nested traversal that re-enters then leaves', () => 'sub/../../evil.js'],
    ['absolute path to a sibling file', (f) => path.join(f.root, 'evil.js')]
  ])('%s is refused with MODULE_PATH_REFUSED and the sentinel never records a load', async (_name, pick) => {
    const f = fixture();
    fs.mkdirSync(path.join(f.dir, 'sub'));
    fs.writeFileSync(path.join(f.root, 'evil.js'), f.sentinel);

    const result = await dispatchWorkGraphCapability(resolvedFor(f.dir, pick(f)), 'work-graph.plan', {}, {});

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('MODULE_PATH_REFUSED');
    expect(fs.existsSync(f.marker)).toBe(false);
    expect(Object.keys(require.cache).some((k) => k.endsWith(path.join(path.basename(f.root), 'evil.js')))).toBe(false);
  });

  test('control: the same sentinel placed INSIDE the adapter directory does load (the sentinel works)', async () => {
    const f = fixture();
    fs.writeFileSync(path.join(f.dir, 'ok.js'), f.sentinel);

    const result = await dispatchWorkGraphCapability(resolvedFor(f.dir, 'ok.js'), 'work-graph.plan', {}, {});

    expect(result.ok).toBe(true);
    expect(fs.existsSync(f.marker)).toBe(true);
  });
});

describe('TRD-016-TEST Edge: shipped jira tracker keeps the builtin links analyzer', () => {
  const realPath = process.env.PATH;
  let stubDir;
  let resolved;

  beforeAll(() => {
    // A stub `jira` CLI on PATH so the real runner and real analyzer run end to end, no network.
    stubDir = mkScratch('wg-dispatch-jira-stub-');
    const stub = path.join(stubDir, 'jira');
    fs.writeFileSync(stub, [
      '#!/bin/sh',
      'if [ "$2" = "list" ]; then',
      '  echo \'[{"key":"J-1","summary":"first","status":"To Do"},{"key":"J-2","summary":"second","status":"To Do"}]\'',
      'elif [ "$2" = "read" ]; then',
      '  echo "{\\"key\\":\\"$3\\",\\"summary\\":\\"item $3\\",\\"description\\":\\"d\\",\\"issueType\\":\\"Task\\",\\"status\\":\\"To Do\\",\\"priority\\":\\"Medium\\",\\"labels\\":[]}"',
      'else exit 3; fi',
      ''
    ].join('\n'), { mode: 0o755 });
    process.env.PATH = `${stubDir}${path.delimiter}${realPath}`;
    resolved = resolveWorkGraphAdapter(contextFor({ tracker: 'jira' }));
  });
  afterAll(() => { process.env.PATH = realPath; });

  test('work-graph resolves to the builtin analyzer over the jira tracker manifest', () => {
    expect(resolved.value).toBe(BUILTIN_ID);
    expect(resolved.autoVia).toBe('builtin-fallback');
    expect(resolved.trackerAdapterId).toBe('jira');
    expect(resolved.trackerManifest.adapter).toBe('jira');
    expect(resolved.manifest.categories).not.toContain('kata');
  });

  test.each(['work-graph.ready', 'work-graph.plan', 'work-graph.graph-health'])(
    '%s through the resolver dispatch answers identically to the analyzer called directly',
    async (capability) => {
      const viaDispatch = await dispatchWorkGraphCapability(resolved, capability, {}, { source: 'default', cwd: stubDir });
      const direct = await runWorkGraphCapability(capability, resolved.trackerManifest, {}, {
        source: 'default',
        execOpts: { execFileOptions: { cwd: stubDir } }
      });

      expect(viaDispatch.error && viaDispatch.error.message).toBeUndefined();
      expect(viaDispatch.ok).toBe(true);
      expect(viaDispatch).toEqual(direct);
      expect(viaDispatch.adapter).toBe(BUILTIN_ID);
      expect(viaDispatch.data.dependencyAware).toBe(false);
      expect(viaDispatch.data.orderingSource).toBe('plan-order');
    }
  );

  test('ready lists the tracker items in list order, as the analyzer did before', async () => {
    const result = await dispatchWorkGraphCapability(resolved, 'work-graph.ready', {}, { source: 'default', cwd: stubDir });
    expect(result.data.items.map((i) => i.id)).toEqual(['J-1', 'J-2']);
  });
});
