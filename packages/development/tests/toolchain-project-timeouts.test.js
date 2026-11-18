'use strict';

/**
 * TRD-028 advisor fixes (br-rij36): project timeouts are validated by resolveProjectTimeouts and
 * reach the work-graph dispatch path (inner tracker.list/tracker.show calls honor the project bound).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveProjectTimeouts } = require('../lib/toolchain/config');
const { dispatchWorkGraphCapability } = require('../lib/toolchain/work-graph-resolve');

const scratch = [];
function mkScratch(prefix) {
  const parent = path.join(os.homedir(), '.omp', 'br-rij36', 'jest');
  fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, prefix));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
});

function projectWith(yamlText) {
  const root = mkScratch('proj-');
  if (yamlText !== null) {
    fs.mkdirSync(path.join(root, '.ensemble'));
    fs.writeFileSync(path.join(root, '.ensemble', 'toolchain.yaml'), yamlText);
  }
  return root;
}

describe('resolveProjectTimeouts', () => {
  test('returns the project .ensemble/toolchain.yaml timeouts', () => {
    const root = projectWith('timeouts:\n  short: 1500\n  long: 9000\n');
    expect(resolveProjectTimeouts({ projectRoot: root })).toEqual({ short: 1500, long: 9000 });
  });

  test('returns undefined when the project sets no timeouts key', () => {
    const root = projectWith('tracker: beads\n');
    expect(resolveProjectTimeouts({ projectRoot: root })).toBeUndefined();
  });

  test('returns undefined when there is no project config file', () => {
    expect(resolveProjectTimeouts({ projectRoot: projectWith(null) })).toBeUndefined();
  });

  test('throws on an invalid value in the project file', () => {
    const root = projectWith('timeouts:\n  short: -5\n');
    expect(() => resolveProjectTimeouts({ projectRoot: root })).toThrow(/invalid toolchain config|timeouts/);
  });

  test.each([
    ['zero', { short: 0 }],
    ['negative', { long: -1 }],
    ['non-integer', { short: 1.5 }],
    ['string', { short: '100' }],
    ['unknown key', { medium: 100 }]
  ])('throws on a hand-built ctx.projectConfig with %s', (_n, timeouts) => {
    expect(() => resolveProjectTimeouts({ projectConfig: { timeouts } })).toThrow(/timeouts/);
  });

  test('accepts a valid hand-built ctx.projectConfig', () => {
    expect(resolveProjectTimeouts({ projectConfig: { timeouts: { short: 7 } } })).toEqual({ short: 7 });
  });
});

describe('dispatchWorkGraphCapability threads project timeouts', () => {
  test('builtin-fallback path forwards timeouts into execOpts', async () => {
    const calls = [];
    await dispatchWorkGraphCapability(
      { autoVia: 'builtin-fallback', trackerManifest: { adapter: 't' }, manifest: {} },
      'work-graph.ready',
      {},
      {
        source: 's',
        cwd: '/p',
        timeouts: { short: 42 },
        runBuiltinImpl: async (...a) => { calls.push(a); return { ok: true }; }
      }
    );
    expect(calls[0][3].execOpts.timeouts).toEqual({ short: 42 });
    expect(calls[0][3].execOpts.execFileOptions.cwd).toBe('/p');
  });

  test('manifest path forwards timeouts to runCapability', async () => {
    const calls = [];
    await dispatchWorkGraphCapability(
      { manifest: { adapter: 'm', capabilities: {} } },
      'work-graph.ready',
      {},
      { source: 's', cwd: '/p', timeouts: { long: 9 }, runCapabilityImpl: async (...a) => { calls.push(a); return { ok: true }; } }
    );
    expect(calls[0][3].timeouts).toEqual({ long: 9 });
  });

  test('module path hands timeouts to the module context', async () => {
    const dir = mkScratch('mod-');
    fs.writeFileSync(path.join(dir, 'm.js'), 'module.exports = { run: async (c, a, ctx) => ({ ok: true, data: ctx.timeouts }) };\n');
    const result = await dispatchWorkGraphCapability(
      { dir, manifest: { adapter: 'm', capabilities: { 'work-graph.plan': { module: 'm.js' } } } },
      'work-graph.plan',
      {},
      { cwd: dir, timeouts: { long: 5 } }
    );
    expect(result.data).toEqual({ long: 5 });
  });

  test('a never-exiting inner tracker.list is cut by the project short bound, naming class and bound', async () => {
    const dir = mkScratch('hang-');
    const bin = path.join(dir, 'hangtool');
    fs.writeFileSync(bin, "#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n");
    fs.chmodSync(bin, 0o755);
    const trackerManifest = {
      adapter: 'hang-tracker',
      binaries: [bin],
      allowlist: [{ bin, sub: ['list'] }],
      env: [],
      timeouts: { short: 60000, long: 60000 },
      capabilities: { 'tracker.list': { run: [bin, 'list'], timeoutClass: 'short' } }
    };
    const started = Date.now();
    const result = await dispatchWorkGraphCapability(
      { autoVia: 'builtin-fallback', trackerManifest, manifest: {} },
      'work-graph.ready',
      {},
      { source: 's', cwd: dir, timeouts: { short: 200 } }
    );
    expect(Date.now() - started).toBeLessThan(10000);
    expect(JSON.stringify(result)).toMatch(/TIMEOUT/);
    expect(JSON.stringify(result)).toMatch(/short/);
    expect(JSON.stringify(result)).toMatch(/200/);
  });
});
