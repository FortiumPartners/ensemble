'use strict';

/**
 * TRD-2026-6995dc96 TRD-016 (br-phjpc; PRD REQ-007, AC-006-2): in-process work-graph capability
 * dispatch through one resolver-owned function, confined to the adapter's own directory.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const resolver = require('../lib/toolchain/work-graph-resolve');
const { runCapability } = require('../lib/toolchain/runner');
const schema = require('../toolchain/schemas/adapter-manifest-schema.json');

const LIB = path.join(__dirname, '..', 'lib');

function makeAdapterDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-module-dispatch-'));
  const dir = path.join(root, 'adapter');
  fs.mkdirSync(dir);
  return { root, dir };
}

function resolvedFor(dir, capabilities) {
  return {
    value: 'fixture',
    source: 'project',
    autoVia: 'tracker-capabilities',
    origin: 'installed',
    dir,
    manifest: { adapter: 'fixture', capabilities }
  };
}

describe('TRD-016: module confinement', () => {
  test('exports a single resolver-owned dispatch function', () => {
    expect(typeof resolver.dispatchWorkGraphCapability).toBe('function');
  });

  test('AC-1: a module inside the adapter directory is loaded and answers', async () => {
    const { dir } = makeAdapterDir();
    fs.writeFileSync(
      path.join(dir, 'wg.js'),
      "module.exports = { run: async (capability, args, ctx) => ({ ok: true, capability, data: { args, source: ctx.source } }) };\n"
    );
    const resolved = resolvedFor(dir, { 'work-graph.plan': { module: 'wg.js' } });

    const result = await resolver.dispatchWorkGraphCapability(resolved, 'work-graph.plan', { scope: 'x' }, { source: 'project' });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ args: { scope: 'x' }, source: 'project' });
  });

  test('AC-1: a named export is honoured', async () => {
    const { dir } = makeAdapterDir();
    fs.writeFileSync(path.join(dir, 'wg.js'), "exports.plan = async () => ({ ok: true, data: 'named' });\n");
    const resolved = resolvedFor(dir, { 'work-graph.plan': { module: 'wg.js', export: 'plan' } });
    const result = await resolver.dispatchWorkGraphCapability(resolved, 'work-graph.plan', {}, {});
    expect(result.data).toBe('named');
  });

  test('AC-1: a path escaping the adapter directory is refused before any code loads', async () => {
    const { root, dir } = makeAdapterDir();
    const marker = path.join(root, 'loaded.marker');
    fs.writeFileSync(
      path.join(root, 'evil.js'),
      `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'); module.exports = { run: async () => ({ ok: true }) };\n`
    );
    const resolved = resolvedFor(dir, { 'work-graph.plan': { module: '../evil.js' } });

    const result = await resolver.dispatchWorkGraphCapability(resolved, 'work-graph.plan', {}, {});

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('MODULE_PATH_REFUSED');
    expect(fs.existsSync(marker)).toBe(false);
  });

  test('AC-1: an absolute module path is refused before any code loads', async () => {
    const { root, dir } = makeAdapterDir();
    const marker = path.join(root, 'loaded.marker');
    const evil = path.join(root, 'evil.js');
    fs.writeFileSync(evil, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x');\n`);
    const resolved = resolvedFor(dir, { 'work-graph.plan': { module: evil } });

    const result = await resolver.dispatchWorkGraphCapability(resolved, 'work-graph.plan', {}, {});

    expect(result.error.code).toBe('MODULE_PATH_REFUSED');
    expect(fs.existsSync(marker)).toBe(false);
  });

  test('AC-1: a symlink that points outside the adapter directory is refused before load', async () => {
    const { root, dir } = makeAdapterDir();
    const marker = path.join(root, 'loaded.marker');
    fs.writeFileSync(path.join(root, 'outside.js'), `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x');\n`);
    fs.symlinkSync(path.join(root, 'outside.js'), path.join(dir, 'link.js'));
    const resolved = resolvedFor(dir, { 'work-graph.plan': { module: 'link.js' } });

    const result = await resolver.dispatchWorkGraphCapability(resolved, 'work-graph.plan', {}, {});

    expect(result.error.code).toBe('MODULE_PATH_REFUSED');
    expect(fs.existsSync(marker)).toBe(false);
  });

  test('a missing module or export is a coded envelope, not a throw', async () => {
    const { dir } = makeAdapterDir();
    fs.writeFileSync(path.join(dir, 'wg.js'), 'module.exports = {};\n');
    const missingFile = resolvedFor(dir, { 'work-graph.plan': { module: 'nope.js' } });
    const missingExport = resolvedFor(dir, { 'work-graph.plan': { module: 'wg.js' } });
    expect((await resolver.dispatchWorkGraphCapability(missingFile, 'work-graph.plan', {}, {})).error.code).toBe('MODULE_PATH_REFUSED');
    expect((await resolver.dispatchWorkGraphCapability(missingExport, 'work-graph.plan', {}, {})).error.code).toBe('MODULE_FAILED');
  });

  test('a throwing module is reported as MODULE_FAILED', async () => {
    const { dir } = makeAdapterDir();
    fs.writeFileSync(path.join(dir, 'wg.js'), "exports.run = async () => { throw new Error('boom'); };\n");
    const result = await resolver.dispatchWorkGraphCapability(
      resolvedFor(dir, { 'work-graph.plan': { module: 'wg.js' } }), 'work-graph.plan', {}, {});
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('MODULE_FAILED');
    expect(result.error.message).toMatch(/boom/);
  });
});

describe('TRD-016: unchanged declarative and builtin paths', () => {
  test('AC-3: a declarative capability goes through runCapability with the manifest and source', async () => {
    const { dir } = makeAdapterDir();
    const manifest = { adapter: 'fixture', capabilities: { 'work-graph.ready': { run: ['tool', 'ready'] } } };
    const calls = [];
    const result = await resolver.dispatchWorkGraphCapability(
      { ...resolvedFor(dir, {}), manifest },
      'work-graph.ready',
      { a: 1 },
      { source: 'project', cwd: '/proj', runCapabilityImpl: async (...a) => { calls.push(a); return { ok: true, via: 'runner' }; } }
    );
    expect(result.via).toBe('runner');
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(manifest);
    expect(calls[0][1]).toBe('work-graph.ready');
    expect(calls[0][2]).toEqual({ a: 1 });
    // `projectRoot` rides along with the capability call so the runner can resolve the
    // repo's `.ensemble/toolchain.yaml` adapter status overrides (tracker statusMap /
    // statusNames). The assertion stays exact: every key the runner receives is named.
    expect(calls[0][3]).toEqual({
      source: 'project',
      projectRoot: '/proj',
      execFileOptions: { cwd: '/proj' }
    });
  });

  test('AC-2: the builtin links path receives the tracker manifest exactly as before', async () => {
    const { dir } = makeAdapterDir();
    const trackerManifest = { adapter: 'jira', capabilities: {} };
    const calls = [];
    const result = await resolver.dispatchWorkGraphCapability(
      { ...resolvedFor(dir, {}), autoVia: 'builtin-fallback', trackerManifest },
      'work-graph.ready',
      {},
      { source: 'default', cwd: '/proj', runBuiltinImpl: async (...a) => { calls.push(a); return { ok: true, via: 'builtin' }; } }
    );
    expect(result.via).toBe('builtin');
    expect(calls[0][0]).toBe('work-graph.ready');
    expect(calls[0][1]).toBe(trackerManifest);
    // `projectRoot` rides along inside `execOpts` so the runner can resolve the
    // repo's `.ensemble/toolchain.yaml` adapter status overrides on this path too
    // (the Jira adapter declares no `work-graph` category, so its work-graph
    // capabilities resolve through this built-in fallback). The assertion stays
    // exact: every key the built-in receives is named.
    expect(calls[0][3]).toEqual({
      source: 'default',
      execOpts: { projectRoot: '/proj', execFileOptions: { cwd: '/proj' } }
    });
  });

  test('the argv runner refuses an in-process capability instead of mis-building argv', async () => {
    const result = await runCapability({ adapter: 'fixture', capabilities: { 'work-graph.plan': { module: 'wg.js' } } }, 'work-graph.plan', {});
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('NOT_ALLOWED');
    expect(result.error.message).toMatch(/in-process/);
  });
});

describe('TRD-016: one resolver-owned call path', () => {
  test('toolchain-cli dispatches work-graph capabilities only through the resolver function', () => {
    const cli = fs.readFileSync(path.join(LIB, 'toolchain-cli.js'), 'utf8');
    expect(cli).toMatch(/dispatchWorkGraphCapability/);
    expect(cli).not.toMatch(/runWorkGraphCapability/);
  });

  test('every work-graph call site resolves through resolveWorkGraphAdapter', () => {
    const cli = fs.readFileSync(path.join(LIB, 'toolchain-cli.js'), 'utf8');
    const pre = fs.readFileSync(path.join(LIB, 'toolchain', 'preflight.js'), 'utf8');
    expect((cli.match(/resolveWorkGraphAdapter\(/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(pre).toMatch(/resolveWorkGraphAdapter\(/);
  });
});

describe('TRD-016: manifest schema', () => {
  const cap = schema.properties.capabilities.additionalProperties;

  test('a capability may declare module (with optional export) in place of run', () => {
    expect(cap.properties.module).toEqual(expect.objectContaining({ type: 'string' }));
    expect(cap.properties.export).toEqual(expect.objectContaining({ type: 'string' }));
    expect(cap.required || []).not.toContain('run');
  });

  test('a capability must declare exactly one of run or module', () => {
    expect(cap.oneOf).toEqual(expect.arrayContaining([{ required: ['run'] }, { required: ['module'] }]));
  });
});
