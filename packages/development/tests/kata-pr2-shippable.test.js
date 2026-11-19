'use strict';

/**
 * br-ngm8 -- PR 2 boundary ("Writes round-trip on kata"), TRD-2026-6995dc96 PR 2.
 *
 * One end-to-end check of the shippable state, through the REAL CLI entry point
 * (`node toolchain-cli.js run <capability> --arg k=v --json`) against a REAL kata 0.23.0 in a
 * scratch project whose `.ensemble/toolchain.yaml` says `tracker: kata`. Every write is read back
 * with `kata show --json` run DIRECTLY (not through the adapter):
 *
 *  - tracker.create-detailed  the item, its body, priority and external key (metadata) are in kata.
 *  - tracker.find-by-key      returns exactly that item, also once closed, and nothing for an unknown key.
 *  - tracker.label / label-one the labels appear on the issue.
 *  - tracker.set-status       in_progress claims the item (owner in kata); open unassigns it.
 *  - tracker.dep-add          a blocking edge appears in `show.links`; the dependent leaves `kata ready`.
 *  - tracker.close-with-reason closed, with the reason and the commit evidence recorded.
 *  - no fallback              every envelope names adapter `kata`, and no beads binary (br, bd, bv)
 *                             is ever invoked: stubs on PATH log every call and the log stays empty.
 *  - coverage                 the manifest passes the repo's own coverage and adapter validation.
 *
 * Skipped with reason "tool absent" without kata (guardKata); the coverage leg needs no kata and
 * always runs. The scratch project, its KATA_HOME and its daemon live under ~/.omp and are removed
 * (daemon stopped) afterwards, never os.tmpdir(). `KATA_PR2_ADAPTER_DIR` points at a mutated COPY of
 * the adapter directory for a RED demonstration; it is installed as a project-local package so it
 * is found ahead of the shipped adapter, and the coverage leg reads the same directory.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { spawnSync } = require('child_process');

const { loadContracts } = require('../lib/toolchain/contracts');
const { validateCoverage } = require('../lib/toolchain/validate');
const { guardKata, kataPath } = require('./helpers/kata-guard');
const { kataScratch, parseJson } = require('./helpers/kata-scratch');

const CLI = path.join(__dirname, '..', 'lib', 'toolchain-cli.js');
const SHIPPED_ADAPTER_DIR = path.join(__dirname, '..', 'skills', 'adapter-tracker-kata');
const MUTANT_ADAPTER_DIR = process.env.KATA_PR2_ADAPTER_DIR;
const ADAPTER_DIR = MUTANT_ADAPTER_DIR || SHIPPED_ADAPTER_DIR;
const SCRATCH = path.join(os.homedir(), '.omp', 'br-ngm8', `pr2-${process.pid}`);

const RUN_ID = 'pr2-shippable';
const BEADS_BINARIES = ['br', 'bd', 'bv'];
const WRITE_CAPABILITIES = [
  'tracker.create-detailed',
  'tracker.find-by-key',
  'tracker.label',
  'tracker.label-one',
  'tracker.set-status',
  'tracker.dep-add',
  'tracker.close-with-reason',
];
// kata's own floor for a `close --done` message is 40 characters.
const REASON = 'Verified the PR 2 write round trip against real kata and recorded the evidence';
const COMMIT = 'abc1234def5678';

describe('PR 2 boundary: kata manifest coverage check passes (br-ngm8)', () => {
  test('the adapter under test is fully covered against the real contracts and validates clean', () => {
    const manifest = yaml.load(fs.readFileSync(path.join(ADAPTER_DIR, 'adapter.yaml'), 'utf8'));
    expect(manifest.adapter).toBe('kata');
    const coverage = validateCoverage(manifest, loadContracts());
    expect(coverage.errors).toEqual([]);
    expect(coverage.ok).toBe(true);

    const res = spawnSync(process.execPath, [CLI, 'validate', ADAPTER_DIR, '--json'], { encoding: 'utf8' });
    expect(JSON.parse(res.stdout)).toEqual({ ok: true, errors: [] });
    expect(res.status).toBe(0);
  });

  test('every capability this boundary exercises is declared by the manifest', () => {
    const manifest = yaml.load(fs.readFileSync(path.join(ADAPTER_DIR, 'adapter.yaml'), 'utf8'));
    for (const capability of WRITE_CAPABILITIES) expect(manifest.capabilities).toHaveProperty([capability]);
  });
});

guardKata('PR 2 boundary: writes round-trip on a kata project (real kata, br-ngm8)', () => {
  let ws;
  let bin;
  let env;
  let beadsLog;
  const envelopes = [];

  /** `kata show <id> --json` read directly, outside the adapter. */
  const show = (id) => parseJson(ws.runInWorkspace(['show', id, '--json']).stdout);
  const readyIds = () => parseJson(ws.runInWorkspace(['ready', '--limit', '0', '--json']).stdout).issues.map((i) => i.short_id);

  /** One `toolchain-cli run` call through the real entry point; every envelope is kept for the no-fallback sweep. */
  function run(capability, args) {
    const argv = [CLI, 'run', capability, '--run-id', RUN_ID];
    for (const [k, v] of Object.entries(args)) argv.push('--arg', `${k}=${v}`);
    argv.push('--json');
    const res = spawnSync(process.execPath, argv, { cwd: ws.workspace, env, encoding: 'utf8', timeout: 90000 });
    let parsed;
    try { parsed = JSON.parse(res.stdout); } catch { parsed = { ok: false, unparsable: res.stdout, stderr: res.stderr }; }
    const envelope = { status: res.status, capability, ...parsed };
    envelopes.push(envelope);
    return envelope;
  }

  const createItem = (title, key) => {
    const r = run('tracker.create-detailed', { title, description: `body of ${title}`, priority: '2', externalKey: key });
    expect(r).toMatchObject({ ok: true, status: 0 });
    return r.data.id;
  };

  beforeAll(() => {
    fs.mkdirSync(SCRATCH, { recursive: true });
    ws = kataScratch({ root: SCRATCH });
    ws.init();
    expect(ws.errors).toEqual([]);

    // PATH is one directory holding the real kata (by symlink) and logging beads stubs, so a beads
    // call cannot be answered by a real binary and cannot go unnoticed.
    bin = path.join(ws.dir, 'bin');
    beadsLog = path.join(ws.dir, 'beads-calls.log');
    fs.mkdirSync(bin, { recursive: true });
    fs.symlinkSync(kataPath(), path.join(bin, 'kata'));
    for (const name of BEADS_BINARIES) {
      fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${beadsLog}"\nexit 9\n`, { mode: 0o755 });
    }
    env = {
      ...ws.env,
      PATH: bin,
      XDG_CONFIG_HOME: path.join(ws.dir, 'xdg'),
      ENSEMBLE_NON_INTERACTIVE: '1',
    };

    fs.mkdirSync(path.join(ws.workspace, '.ensemble'), { recursive: true });
    fs.writeFileSync(path.join(ws.workspace, '.ensemble', 'toolchain.yaml'), 'tracker: kata\n');
    if (MUTANT_ADAPTER_DIR) {
      // A package-shaped tree inside the project: `<pkg>/skills/adapter-tracker-kata` plus a
      // `<pkg>/lib` link to the real library (the adapter module finds its runner at ../../lib).
      const pkg = path.join(ws.workspace, 'packages', 'mutant');
      fs.mkdirSync(path.join(pkg, 'skills'), { recursive: true });
      fs.cpSync(MUTANT_ADAPTER_DIR, path.join(pkg, 'skills', 'adapter-tracker-kata'), { recursive: true });
      fs.symlinkSync(path.join(__dirname, '..', 'lib'), path.join(pkg, 'lib'));
    }

    // Side-effecting capabilities need a passing preflight naming them first.
    const argv = [CLI, 'preflight', '--run-id', RUN_ID, '--json'];
    for (const capability of WRITE_CAPABILITIES) argv.push('--require', capability);
    const pre = spawnSync(process.execPath, argv, { cwd: ws.workspace, env, encoding: 'utf8', timeout: 90000 });
    expect(pre.status).toBe(0);
  }, 180000);

  afterAll(() => {
    if (ws) ws.cleanup();
    fs.rmSync(SCRATCH, { recursive: true, force: true });
  });

  let itemId;
  let otherId;
  const KEY = 'PR2-KEY-0001';

  test('tracker.create-detailed: the item, body, priority and external key are in kata show', () => {
    itemId = createItem('PR2 primary item', KEY);
    otherId = createItem('PR2 other item', 'PR2-KEY-0002');
    expect(itemId).toBeTruthy();
    expect(otherId).not.toBe(itemId);

    const { issue } = show(itemId);
    expect(issue).toMatchObject({ short_id: itemId, title: 'PR2 primary item', body: 'body of PR2 primary item', priority: 2, status: 'open' });
    expect(JSON.stringify(issue.metadata)).toContain(KEY);
  }, 120000);

  test('tracker.find-by-key: exactly that item, nothing for an unknown key', () => {
    const hit = run('tracker.find-by-key', { key: KEY });
    expect(hit).toMatchObject({ ok: true, status: 0 });
    expect(hit.data.items.map((i) => i.id)).toEqual([itemId]);

    const miss = run('tracker.find-by-key', { key: 'PR2-NO-SUCH-KEY' });
    expect(miss).toMatchObject({ ok: true, status: 0 });
    expect(miss.data.items).toEqual([]);
  }, 60000);

  test('tracker.label and tracker.label-one: both labels are visible in kata show', () => {
    expect(run('tracker.label', { ids: itemId, labels: 'pr2-label' })).toMatchObject({ ok: true, status: 0 });
    expect(run('tracker.label-one', { id: itemId, label: 'pr2-label-one' })).toMatchObject({ ok: true, status: 0 });
    expect(show(itemId).issue.labels).toEqual(expect.arrayContaining(['pr2-label', 'pr2-label-one']));
  }, 60000);

  test('tracker.set-status: in_progress claims the item (owner in kata), open unassigns it', () => {
    expect(show(itemId).issue.owner || null).toBeNull();

    const claimed = run('tracker.set-status', { id: itemId, status: 'in_progress' });
    expect(claimed).toMatchObject({ ok: true, status: 0 });
    expect(claimed.data).toMatchObject({ id: itemId, status: 'in_progress' });
    const owned = show(itemId).issue;
    expect(owned.owner).toBeTruthy();
    expect(owned.status).toBe('open');
    expect(claimed.data.owner).toBe(owned.owner);

    const released = run('tracker.set-status', { id: itemId, status: 'open' });
    expect(released).toMatchObject({ ok: true, status: 0 });
    expect(released.data.status).toBe('open');
    expect(show(itemId).issue.owner || null).toBeNull();
  }, 60000);

  test('tracker.dep-add: a blocking edge is in kata show links and the dependent leaves kata ready', () => {
    expect(readyIds()).toEqual(expect.arrayContaining([itemId, otherId]));

    // `id` is blocked by `dependsOnId`.
    const r = run('tracker.dep-add', { id: itemId, dependsOnId: otherId });
    expect(r).toMatchObject({ ok: true, status: 0 });

    // Links name their endpoints as objects; "from blocks to", so the blocker is `from`.
    const edgeOf = (links) => links.find((l) => l.type === 'blocks' && l.from.short_id === otherId && l.to.short_id === itemId);
    expect(edgeOf(show(itemId).links)).toBeTruthy();
    expect(edgeOf(show(otherId).links)).toBeTruthy();
    expect(readyIds()).not.toContain(itemId);
    expect(readyIds()).toContain(otherId);
  }, 60000);

  test('tracker.close-with-reason: closed with the reason and the commit evidence in kata', () => {
    const r = run('tracker.close-with-reason', { id: otherId, reason: REASON, commit: COMMIT });
    expect(r).toMatchObject({ ok: true, status: 0 });

    const { issue } = show(otherId);
    expect(issue.status).toBe('closed');
    expect(issue.closed_reason).toBe('done');

    const events = parseJson(ws.runInWorkspace(['events', '--after', '0', '--json']).stdout).events;
    const closed = events.filter((e) => e.type === 'issue.closed' && e.issue_short_id === otherId).pop();
    const payload = typeof closed.payload === 'string' ? JSON.parse(closed.payload) : closed.payload;
    expect(payload.message).toBe(REASON);
    expect(JSON.stringify(payload.evidence)).toContain(COMMIT);

    // Closing the blocker releases the dependent back into `kata ready`.
    expect(readyIds()).toContain(itemId);
  }, 60000);

  test('tracker.find-by-key still finds a closed item', () => {
    const hit = run('tracker.find-by-key', { key: 'PR2-KEY-0002' });
    expect(hit).toMatchObject({ ok: true, status: 0 });
    expect(hit.data.items.map((i) => i.id)).toEqual([otherId]);
    expect(hit.data.items[0].status).toBe('closed');
  }, 60000);

  test('no fallback: every envelope names adapter kata and no beads binary was ever invoked', () => {
    expect(envelopes.length).toBeGreaterThan(WRITE_CAPABILITIES.length);
    for (const e of envelopes) {
      expect(e.ok).toBe(true);
      expect(e.adapter).toBe('kata');
      expect(JSON.stringify(e)).not.toMatch(/work-graph-links-fallback|adapter-tracker-beads/);
      expect(e.adapter).not.toBe('beads');
    }
    for (const capability of WRITE_CAPABILITIES) {
      expect(envelopes.some((e) => e.capability === capability)).toBe(true);
    }
    expect(fs.existsSync(beadsLog) ? fs.readFileSync(beadsLog, 'utf8') : '').toBe('');
  });
});
