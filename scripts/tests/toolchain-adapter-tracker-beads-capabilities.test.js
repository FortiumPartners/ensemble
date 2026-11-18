'use strict';
/**
 * Capability-by-capability tests for `packages/development/skills/adapter-tracker-beads`
 * (TRD-2026-8d825f54 TRD-024), against the small, deterministic stub `br`/`bv` scripts in
 * `scripts/tests/fixtures/toolchain/adapter-tracker-beads-stub.js`. Manifest-level static
 * checks (schema/allowlist/conformance, resolver loadability, mutation-proof guard tests) live
 * in `scripts/tests/toolchain-adapter-tracker-beads-manifest.test.js`; this file exercises
 * every capability's actual `run[]`+`parse` behavior.
 *
 * `tracker.show`/`tracker.list`/`tracker.comments`/`work-graph.*` run through the REAL CLI
 * entry point (`toolchain-cli.js#main`, in-process, never a subprocess) against the real,
 * shipped `packages/development/skills/adapter-tracker-beads` manifest resolved from this
 * repo's own `tracker: beads`/`work-graph: beads` config (TRD-024 Implementation AC 3). The
 * side-effecting tracker capabilities (`create`/`update`/`close`/`comment`/`dep-add`/
 * `dep-remove`/`label`/`sync`) call `runCapability()` directly instead (same production
 * runner, skipping only the CLI's own preflight/confirmation gates, which are a different
 * sibling task's concern, not this adapter's).
 *
 * No test here spawns a real `br`/`bv`: every capability resolves `br`/`bv` through `PATH`,
 * and every test that reaches a real process prepends a per-test tmpdir containing ONLY the
 * stub scripts to `process.env.PATH` (saved and restored in `afterEach`), never the real
 * installed `br`/`bv` on this machine's `PATH`.
 */

const fs = require('fs');
const { execFileSync } = require('child_process');
const os = require('os');
const path = require('path');

const Ajv = require('ajv');

const { main } = require('../../packages/development/lib/toolchain-cli');
const { loadAdapter } = require('../../packages/development/lib/toolchain/adapters');
const { runCapability } = require('../../packages/development/lib/toolchain/runner');
const { mapOutput } = require('../../packages/development/lib/toolchain/mapping');
const { writeBeadsStubs, writeStubControl } = require('./fixtures/toolchain/adapter-tracker-beads-stub');

const REPO_ROOT = path.join(__dirname, '..', '..');
const WORK_ITEM_SCHEMA_PATH = path.join(
  REPO_ROOT,
  'packages',
  'development',
  'toolchain',
  'schemas',
  'normalized',
  'work-item.json'
);

const ajv = new Ajv({ allErrors: true });
const validateWorkItem = ajv.compile(JSON.parse(fs.readFileSync(WORK_ITEM_SCHEMA_PATH, 'utf8')));

const { manifest: REAL_MANIFEST } = loadAdapter('beads', { projectRoot: REPO_ROOT });

const tempDirs = [];
let savedPath;

beforeEach(() => {
  savedPath = process.env.PATH;
});

afterEach(() => {
  process.env.PATH = savedPath;
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function mkStubBinDir() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-tracker-beads-bin-')));
  tempDirs.push(dir);
  writeBeadsStubs(dir);
  process.env.PATH = `${dir}:${process.env.PATH}`;
  return dir;
}

async function captureStdout(fn) {
  let stdout = '';
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    stdout += chunk;
    return true;
  };
  try {
    const returned = await fn();
    return { returned, stdout };
  } finally {
    process.stdout.write = original;
  }
}

const CLI_CTX = { projectRoot: REPO_ROOT, env: process.env };

describe('TRD-024-TEST: non-side-effecting tracker capabilities, real CLI entry point', () => {
  test('tracker.show: real `run` through main() normalizes and validates against work-item.json', async () => {
    const binDir = mkStubBinDir();
    writeStubControl(binDir, { brShowStatus: 'in_progress' });

    const { returned: code, stdout } = await captureStdout(() =>
      main(['run', 'tracker.show', '--arg', 'id=br-x', '--json'], CLI_CTX)
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.adapter).toBe('beads');
    expect(parsed.data).toEqual({
      id: 'br-x',
      title: 'Stub title',
      description: 'Stub description',
      type: 'task',
      status: 'in_progress',
      labels: ['a', 'b']
    });
    expect(validateWorkItem(parsed.data)).toBe(true);
  });

  test('tracker.show: every statusMap entry normalizes (deferred -> open, in_review -> in_progress)', async () => {
    const binDir = mkStubBinDir();
    for (const [raw, normalized] of [
      ['open', 'open'],
      ['in_progress', 'in_progress'],
      ['closed', 'closed'],
      ['deferred', 'open'],
      ['in_review', 'in_progress']
    ]) {
      writeStubControl(binDir, { brShowStatus: raw });
      const { returned: code, stdout } = await captureStdout(() =>
        main(['run', 'tracker.show', '--arg', 'id=br-x', '--json'], CLI_CTX)
      );
      expect(code).toBe(0);
      expect(JSON.parse(stdout.trim()).data.status).toBe(normalized);
    }
  });

  test('tracker.show: a bead br prints without labels or description still maps (br omits empty fields)', () => {
    const parse = REAL_MANIFEST.capabilities['tracker.show'].parse;
    const bare = mapOutput(
      JSON.stringify([{ id: 'br-x', title: 'Bare', issue_type: 'epic', status: 'open' }]),
      parse
    );
    expect(bare).toEqual({ id: 'br-x', title: 'Bare', type: 'epic', status: 'open', labels: [] });
    expect(validateWorkItem(bare)).toBe(true);
    // The id and title stay required: a document with no title is still BAD_OUTPUT.
    expect(() => mapOutput(JSON.stringify([{ id: 'br-x', status: 'open' }]), parse)).toThrow(/title/);
  });

  test('tracker.list: declares no parse block, so `data` is the raw stdout text for either br shape', async () => {
    const binDir = mkStubBinDir();
    writeStubControl(binDir, { brListShape: 'wrapped' });
    const wrapped = await captureStdout(() => main(['run', 'tracker.list', '--json'], CLI_CTX));
    expect(wrapped.returned).toBe(0);
    const wrappedData = JSON.parse(wrapped.stdout.trim()).data;
    expect(typeof wrappedData).toBe('string');
    expect(JSON.parse(wrappedData)).toEqual({
      issues: [{ id: 'b-1', title: 'Stub issue', status: 'open', issue_type: 'task', labels: [] }],
      total: 1,
      limit: 0,
      offset: 0,
      has_more: false
    });

    writeStubControl(binDir, { brListShape: 'bare' });
    const bare = await captureStdout(() => main(['run', 'tracker.list', '--json'], CLI_CTX));
    expect(bare.returned).toBe(0);
    const bareData = JSON.parse(bare.stdout.trim()).data;
    expect(JSON.parse(bareData)).toEqual([
      { id: 'b-1', title: 'Stub issue', status: 'open', issue_type: 'task', labels: [] }
    ]);
  });

  test('tracker.list: a ~3.6 MB synthetic payload (sized past this repo\'s own live ~3.4 MB `br list`) succeeds instead of TOOL_FAILED maxBuffer (reviewer round 2, P2)', async () => {
    const binDir = mkStubBinDir();
    // 450 issues * ~8KB filler description each; comfortably exceeds Node's execFile 1 MiB
    // default (the bug) and this repo's own live ~3.4 MB `br list --all --json` measurement,
    // while staying under runner.js's DEFAULT_MAX_BUFFER_BYTES (64 MiB, the fix).
    writeStubControl(binDir, { brListLargeIssueCount: 450 });
    const { returned: code, stdout } = await captureStdout(() => main(['run', 'tracker.list', '--json'], CLI_CTX));
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(true);
    const data = JSON.parse(parsed.data);
    expect(data.issues).toHaveLength(450);
    expect(JSON.stringify(data).length).toBeGreaterThan(3 * 1024 * 1024);
  });

  test('tracker.list: an error envelope on stdout despite a zero exit fails closed (ok:false, TOOL_FAILED, reviewer round 2, P1)', async () => {
    const binDir = mkStubBinDir();
    writeStubControl(binDir, { brErrorEnvelope: true });
    const { returned: code, stdout } = await captureStdout(() => main(['run', 'tracker.list', '--json'], CLI_CTX));
    expect(code).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('TOOL_FAILED');
  });

  test('tracker.comments: declares no parse block, so `data` is the raw stdout array text', async () => {
    const binDir = mkStubBinDir();
    const { returned: code, stdout } = await captureStdout(() =>
      main(['run', 'tracker.comments', '--arg', 'id=br-x', '--json'], CLI_CTX)
    );
    expect(code).toBe(0);
    const data = JSON.parse(stdout.trim()).data;
    expect(JSON.parse(data)).toEqual([{ author: 'stub', text: 'a stub comment' }]);
  });

  test('tracker.comments: an error envelope on stdout despite a zero exit fails closed (ok:false, TOOL_FAILED, reviewer round 2, P1)', async () => {
    const binDir = mkStubBinDir();
    writeStubControl(binDir, { brErrorEnvelope: true });
    const { returned: code, stdout } = await captureStdout(() =>
      main(['run', 'tracker.comments', '--arg', 'id=br-x', '--json'], CLI_CTX)
    );
    expect(code).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('TOOL_FAILED');
  });
});

describe('TRD-024-TEST: tracker.list "bare array vs {issues:[...]}" normalization (Implementation AC 2)', () => {
  // tracker.list itself declares no `parse` block (see adapter.yaml's own comment and
  // SKILL.md "Known limits": runner.js's CATEGORY_NORMALIZED_SCHEMA Ajv-validates ANY
  // tracker.* capability's mapped output against work-item.json, which requires "id" --
  // proven empirically to always fail for a list-shaped result). This describe block proves,
  // at the mapping-engine level, exactly what IS and is NOT achievable for the "bare array vs
  // {issues:[...]}" variance the TRD's own Implementation AC describes, using the identical
  // root/map this adapter's own comments document as the would-be design.
  const LIST_PARSE = { format: 'json', root: '$.issues|issue', map: { items: '$' } };

  test('{issues:[...]} and {issue:[...]} (the TRD-documented key-name alternation) normalize identically', () => {
    const wrapped = mapOutput(JSON.stringify({ issues: [{ id: 'b-1', status: 'open' }] }), LIST_PARSE);
    const singular = mapOutput(JSON.stringify({ issue: [{ id: 'b-1', status: 'open' }] }), LIST_PARSE);
    expect(wrapped).toEqual({ items: [{ id: 'b-1', status: 'open' }] });
    expect(singular).toEqual(wrapped);
  });

  test('a bare top-level array deterministically fails closed (BAD_OUTPUT), not a crash or silent wrong data', () => {
    expect(() => mapOutput(JSON.stringify([{ id: 'b-1', status: 'open' }]), LIST_PARSE)).toThrow(
      expect.objectContaining({ code: 'BAD_OUTPUT' })
    );
  });
});

describe('TRD-024-TEST: work-graph capabilities, real runCapability() (the "work-graph: auto" default-selection indirection is a different, out-of-scope bead -- TRD-027 -- so these call runCapability() directly against the real beads manifest, same as the side-effecting tracker capabilities below, rather than through main()\'s category resolution)', () => {
  test('work-graph.ready: normalized item order matches the stub bv sample\'s own order exactly (no re-sorting)', async () => {
    const binDir = mkStubBinDir();
    writeStubControl(binDir, { bvItemIds: ['br-zz-last', 'br-aa-first', 'br-mm-mid'] });

    const result = await runCapability(REAL_MANIFEST, 'work-graph.ready', {}, {
      parentEnv: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
      timeoutMs: 10000
    });
    expect(result.ok).toBe(true);
    expect(result.data.items.map((item) => item.id)).toEqual(['br-zz-last', 'br-aa-first', 'br-mm-mid']);
  });

  test('work-graph.plan: same command, same track-0 items, in order', async () => {
    const binDir = mkStubBinDir();
    writeStubControl(binDir, { bvItemIds: ['br-3', 'br-1', 'br-2'] });

    const result = await runCapability(REAL_MANIFEST, 'work-graph.plan', {}, {
      parentEnv: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
      timeoutMs: 10000
    });
    expect(result.ok).toBe(true);
    expect(result.data.items.map((item) => item.id)).toEqual(['br-3', 'br-1', 'br-2']);
  });

  // Real bv v0.26.0 (`bv --robot-plan --format json`, scratch .beads fixture) emits
  // `"plan":{"tracks":[],"total_actionable":0,"total_blocked":N,...}` for an epic with nothing
  // actionable (everything closed, or only blocked work). That is a valid EMPTY plan, which
  // beads-build-wave Step 7 reports as complete/blocked; it must not be BAD_OUTPUT.
  describe.each(['work-graph.ready', 'work-graph.plan'])('%s: a plan with nothing actionable', (capability) => {
    const run = (bvPlan) => {
      const binDir = mkStubBinDir();
      writeStubControl(binDir, { bvPlan });
      return runCapability(REAL_MANIFEST, capability, {}, {
        parentEnv: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
        timeoutMs: 10000
      });
    };
    const summary = { highest_impact: '', impact_reason: '', unblocks_count: 0 };

    test('"tracks": [] (real bv output) is ok with no items', async () => {
      const result = await run({ tracks: [], total_actionable: 0, total_blocked: 2, summary });
      expect(result.ok).toBe(true);
      expect(result.data.items).toEqual([]);
    });

    test('an absent or null "tracks" is also an empty plan', async () => {
      for (const plan of [{ total_actionable: 0, summary }, { tracks: null, total_actionable: 0, summary }]) {
        const result = await run(plan);
        expect(result.ok).toBe(true);
        expect(result.data.items).toEqual([]);
      }
    });

    test('genuinely malformed plans are still BAD_OUTPUT', async () => {
      const malformed = [
        { tracks: 'nope' },
        { tracks: {} },
        { tracks: [{ track_id: 'track-A' }] }
      ];
      for (const plan of malformed) {
        const result = await run(plan);
        expect(result.ok).toBe(false);
        expect(result.error).toEqual(expect.objectContaining({ code: 'BAD_OUTPUT' }));
      }
      const noPlan = await run('not-an-object');
      expect(noPlan.ok).toBe(false);
      expect(noPlan.error).toEqual(expect.objectContaining({ code: 'BAD_OUTPUT' }));
    });
  });

  test('work-graph.graph-health: status and findings map from bv --robot-insights', async () => {
    const binDir = mkStubBinDir();
    const result = await runCapability(REAL_MANIFEST, 'work-graph.graph-health', {}, {
      parentEnv: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
      timeoutMs: 10000
    });
    expect(result.ok).toBe(true);
    expect(result.data.findings).toEqual([]);
    expect(result.data.status.Cycles).toEqual({ state: 'computed' });
  });
});

describe('TRD-024-TEST: side-effecting tracker capabilities, real runCapability()', () => {
  const cases = [
    { capability: 'tracker.create', args: { title: 't', description: 'd', type: 'task' } },
    { capability: 'tracker.update', args: { id: 'br-x', fields: 'new notes' } },
    { capability: 'tracker.close', args: { id: 'br-x' } },
    { capability: 'tracker.dep-add', args: { id: 'br-x', dependsOnId: 'br-y', type: 'blocks' } },
    { capability: 'tracker.dep-remove', args: { id: 'br-x', dependsOnId: 'br-y' } }
  ];

  test.each(cases)('$capability: normalizes and validates against work-item.json', async ({ capability, args }) => {
    const binDir = mkStubBinDir();
    const result = await runCapability(REAL_MANIFEST, capability, args, {
      parentEnv: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
      timeoutMs: 10000
    });
    expect(result.ok).toBe(true);
    expect(typeof result.data.id).toBe('string');
    expect(validateWorkItem(result.data)).toBe(true);
  });

  test('tracker.close: status is mapped and normalized to "closed"', async () => {
    const binDir = mkStubBinDir();
    const result = await runCapability(REAL_MANIFEST, 'tracker.close', { id: 'br-x' }, {
      parentEnv: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
      timeoutMs: 10000
    });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ id: 'br-x', status: 'closed' });
  });

  test('tracker.comment: declares no parse block (real `br comments add` returns a bare, numeric-id comment object -- not an array-wrapped, string-id work item), data is raw stdout (TRD-2026-8d825f54 PR 9 review)', async () => {
    const binDir = mkStubBinDir();
    const result = await runCapability(REAL_MANIFEST, 'tracker.comment', { id: 'br-x', text: 'a comment' }, {
      parentEnv: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
      timeoutMs: 10000
    });
    expect(result.ok).toBe(true);
    expect(typeof result.data).toBe('string');
    expect(JSON.parse(result.data)).toEqual({
      id: 1,
      issue_id: 'br-x',
      author: 'stub',
      text: 'a comment',
      created_at: '2024-01-01T00:00:00Z'
    });
  });

  test('tracker.label: declares no parse block (ids/labels output has no "id"), data is raw stdout', async () => {
    const binDir = mkStubBinDir();
    const result = await runCapability(REAL_MANIFEST, 'tracker.label', { ids: 'br-x', labels: 'stub-label' }, {
      parentEnv: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
      timeoutMs: 10000
    });
    expect(result.ok).toBe(true);
    expect(typeof result.data).toBe('string');
    expect(JSON.parse(result.data)).toEqual({ ids: ['br-x'], labels: ['stub-label'] });
  });

  test('tracker.sync: declares no parse block (status output has no "id"), data is raw stdout', async () => {
    const binDir = mkStubBinDir();
    const result = await runCapability(REAL_MANIFEST, 'tracker.sync', {}, {
      parentEnv: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
      timeoutMs: 10000
    });
    expect(result.ok).toBe(true);
    expect(typeof result.data).toBe('string');
    expect(JSON.parse(result.data)).toEqual({ status: 'flushed' });
  });

  test.each(['tracker.label', 'tracker.sync'])(
    '%s: an error envelope on stdout despite a zero exit fails closed (ok:false, TOOL_FAILED, reviewer round 2, P1)',
    async (capability) => {
      const binDir = mkStubBinDir();
      writeStubControl(binDir, { brErrorEnvelope: true });
      const args = capability === 'tracker.label' ? { ids: 'br-x', labels: 'stub-label' } : {};
      const result = await runCapability(REAL_MANIFEST, capability, args, {
        parentEnv: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
        timeoutMs: 10000
      });
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('TOOL_FAILED');
    }
  );
});

describe('TRD-024-TEST: health checks run the real (stubbed) br/bv --version', () => {
  test('both health checks succeed against the stub binaries', async () => {
    const binDir = mkStubBinDir();
    for (const check of REAL_MANIFEST.health) {
      const stdout = execFileSync(check.run[0], check.run.slice(1), {
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
        encoding: 'utf8'
      });
      expect(stdout).toMatch(/stub/);
    }
  });
});
