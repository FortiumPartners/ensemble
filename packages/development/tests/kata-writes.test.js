'use strict';

/**
 * TRD-011-TEST -- verify reason and evidence on close, and refusal without them
 * (TRD-2026-6995dc96 TRD-011-TEST; PRD REQ-003 AC-003-1, AC-003-2, AC-003-3).
 * The same file also carries TRD-010-TEST (dedupe lookup returns exactly the matching item,
 * PRD REQ-002 AC-002-1..3), TRD-009-TEST (create/update round-trip) and TRD-013-TEST (blocking
 * edges remove and restore readiness, PRD REQ-005 AC-005-1..3) and TRD-012-TEST (label sweeps and
 * the ownership-derived in-progress state, PRD REQ-004 AC-004-1..3) as separate real-kata describes.
 *
 * Unlike tests/kata-close-evidence.test.js (a recording stub that proves the adapter's argv),
 * this suite drives the shipped adapter manifest through the runner against a REAL kata, in an
 * isolated scratch workspace (own KATA_HOME and git state, see helpers/kata-scratch.js), and
 * reads the result back from kata:
 *
 *  - Happy:  close with a reason and a commit sha -> `kata show` reports closed/done, and the
 *            `issue.closed` event carries the recorded reason message and the commit evidence.
 *  - Edge:   no reason -> the call fails observably (INVALID_ARG) and the item stays open; a bare
 *            tracker.close is refused the same way.
 *  - Edge:   a test command as evidence -> the `issue.closed` event names that command.
 *
 * Read-back goes through `kata events` because `kata show` exposes status and closed_reason only
 * (see adapter.yaml, tracker.close-with-reason). Skipped with reason "tool absent" when kata is
 * not on PATH (guardKata). `KATA_WRITES_MANIFEST` lets a RED demonstration point at a mutated
 * copy of the manifest instead of the shipped one.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const { runCapability } = require('../lib/toolchain/runner');
const { guardKata } = require('./helpers/kata-guard');
const { kataScratch, parseJson } = require('./helpers/kata-scratch');

const ADAPTER_DIR = path.join(__dirname, '..', 'skills', 'adapter-tracker-kata');
const MANIFEST = yaml.load(
  fs.readFileSync(process.env.KATA_WRITES_MANIFEST || path.join(ADAPTER_DIR, 'adapter.yaml'), 'utf8')
);

const REASON = 'Verified the close path against real kata and recorded the evidence';
const COMMIT = 'abc1234def5678';
const TEST_COMMAND = 'npx jest packages/development/tests/kata-writes.test.js';
const SCRATCH_PARENT = path.join(os.homedir(), '.omp', 'br-har0c', 'jest');

guardKata('TRD-011-TEST close reason and evidence (real kata)', () => {
  let ws;
  let opts;

  beforeAll(() => {
    fs.mkdirSync(SCRATCH_PARENT, { recursive: true });
    ws = kataScratch({ root: SCRATCH_PARENT });
    ws.init();
    expect(ws.errors).toEqual([]);
    // KATA_HOME is a name the manifest's env allowlist forwards from parentEnv to the child.
    opts = {
      parentEnv: { ...ws.env },
      execFileOptions: { cwd: ws.workspace },
    };
  }, 60000);

  afterAll(() => {
    if (ws) ws.cleanup();
  });

  function createItem(title) {
    const res = ws.runInWorkspace(['create', title, '--json']);
    const id = parseJson(res.stdout)?.issue?.short_id;
    expect(id).toBeTruthy();
    return id;
  }

  const readIssue = (id) => parseJson(ws.runInWorkspace(['show', id, '--json']).stdout).issue;

  /** The payload of the item's `issue.closed` event, or null while it has none. */
  function closedPayload(id) {
    const events = parseJson(ws.runInWorkspace(['events', '--after', '0', '--json']).stdout).events;
    const closed = events.filter((e) => e.type === 'issue.closed' && e.issue_short_id === id);
    if (!closed.length) return null;
    const p = closed[closed.length - 1].payload;
    return typeof p === 'string' ? JSON.parse(p) : p;
  }

  test('AC-003-1: close with a reason and a commit -> closed, reason and commit read back', async () => {
    const id = createItem('close with reason');
    const res = await runCapability(MANIFEST, 'tracker.close-with-reason', { id, reason: REASON, commit: COMMIT }, opts);
    expect(res.ok).toBe(true);

    const issue = readIssue(id);
    expect(issue.status).toBe('closed');
    expect(issue.closed_reason).toBe('done');

    const payload = closedPayload(id);
    expect(payload.message).toBe(REASON);
    expect(payload.evidence).toEqual([expect.objectContaining({ type: 'commit' })]);
    expect(JSON.stringify(payload.evidence)).toContain(COMMIT);
  }, 60000);

  test('AC-003-2: close without a reason -> refused observably, the item stays open', async () => {
    const id = createItem('close without reason');
    const res = await runCapability(MANIFEST, 'tracker.close-with-reason', { id, commit: COMMIT }, opts);
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('INVALID_ARG');

    expect(readIssue(id).status).toBe('open');
    expect(closedPayload(id)).toBeNull();
  }, 60000);

  test('AC-003-2: a bare tracker.close is refused, the item stays open', async () => {
    const id = createItem('bare close');
    const res = await runCapability(MANIFEST, 'tracker.close', { id }, opts);
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('INVALID_ARG');
    expect(res.error.message).toContain('tracker.close-with-reason');

    expect(readIssue(id).status).toBe('open');
    expect(closedPayload(id)).toBeNull();
  }, 60000);

  test('AC-003-2: a reason kata itself rejects as too short fails observably, the item stays open', async () => {
    const id = createItem('short reason');
    const res = await runCapability(MANIFEST, 'tracker.close-with-reason', { id, reason: 'short', commit: COMMIT }, opts);
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('TOOL_FAILED');

    expect(readIssue(id).status).toBe('open');
  }, 60000);

  test('AC-003-3: a test command as evidence -> the recorded evidence names that command', async () => {
    const id = createItem('close with test evidence');
    const res = await runCapability(
      MANIFEST,
      'tracker.close-with-evidence',
      { id, reason: REASON, evidence: `test:${TEST_COMMAND}` },
      opts
    );
    expect(res.ok).toBe(true);

    expect(readIssue(id).status).toBe('closed');
    const payload = closedPayload(id);
    expect(payload.evidence).toEqual([{ type: 'test', command: TEST_COMMAND }]);
  }, 60000);
});

/**
 * TRD-009-TEST -- verify required create and update round-trip
 * (TRD-2026-6995dc96 TRD-009-TEST; PRD REQ-001 AC-001-4).
 *
 *  - Happy: tracker.create -> read back from real kata -> title and body match the create input.
 *  - Edge:  priority-only update-detailed is refused (INVALID_ARG, item unchanged); a priority change
 *           supplying current title/body leaves them unchanged; tracker.update changes body only.
 *
 * `KATA_WRITES_MANIFEST` may point at a mutated copy of the manifest for a RED demonstration.
 */
const CREATE_PARENT = path.join(os.homedir(), '.omp', 'br-mz17n', 'jest');

guardKata('TRD-009-TEST required create and update round-trip (real kata)', () => {
  let ws;
  let opts;

  beforeAll(() => {
    fs.mkdirSync(CREATE_PARENT, { recursive: true });
    ws = kataScratch({ root: CREATE_PARENT });
    ws.init();
    expect(ws.errors).toEqual([]);
    opts = { parentEnv: { ...ws.env }, execFileOptions: { cwd: ws.workspace } };
  }, 60000);

  afterAll(() => {
    if (ws) ws.cleanup();
  });

  const readIssue = (id) => parseJson(ws.runInWorkspace(['show', id, '--json']).stdout).issue;

  test('AC-001-4: a created item reads back with its title and description', async () => {
    const title = 'round trip title';
    const description = 'round trip body with detail';
    const res = await runCapability(MANIFEST, 'tracker.create', { title, description }, opts);
    expect(res.ok).toBe(true);
    const id = res.data.id;
    expect(id).toBeTruthy();

    const issue = readIssue(id);
    expect(issue.title).toBe(title);
    expect(issue.body).toBe(description);
  }, 60000);

  // The adapter cannot express a LITERAL priority-only update: runner.js#resolveArg throws
  // INVALID_ARG for any placeholder with no value, and tracker.update-detailed's argv carries
  // ${title}, ${description}, ${priority} and ${notes} together. tracker.update's only input is
  // `fields` -> --body, so it has no priority at all. That is a follow-up gap tracked as br-bq8v2.
  // The edge AC is therefore covered three honest ways below.
  async function createFor(title, description) {
    const created = await runCapability(MANIFEST, 'tracker.create', { title, description }, opts);
    expect(created.ok).toBe(true);
    return created.data.id;
  }

  test.todo('Edge AC (br-bq8v2): an update carrying only a priority field leaves title and body unchanged');

  test('documents current limitation (br-bq8v2): a priority-only update-detailed is refused and the item is unchanged', async () => {
    const title = 'priority only title';
    const description = 'priority only body';
    const id = await createFor(title, description);
    const before = readIssue(id);

    const res = await runCapability(MANIFEST, 'tracker.update-detailed', { id, priority: 2 }, opts);
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('INVALID_ARG');

    const issue = readIssue(id);
    expect(issue.title).toBe(title);
    expect(issue.body).toBe(description);
    expect(issue.priority).toBe(before.priority);
  }, 60000);

  test('AC-001-4: a priority change supplying the current title and body leaves them unchanged', async () => {
    const title = 'priority change title';
    const description = 'priority change body';
    const id = await createFor(title, description);
    const current = readIssue(id);

    const res = await runCapability(
      MANIFEST,
      'tracker.update-detailed',
      { id, title: current.title, description: current.body, priority: 2, notes: 'priority raised' },
      opts
    );
    expect(res.ok).toBe(true);
    expect(res.data.id).toBe(id);

    const issue = readIssue(id);
    expect(issue.priority).toBe(2);
    expect(issue.title).toBe(title);
    expect(issue.body).toBe(description);
  }, 60000);

  test('AC-001-4: tracker.update changes the body only, keeps the title, and returns the id', async () => {
    const title = 'body update title';
    const id = await createFor(title, 'original body');

    const res = await runCapability(MANIFEST, 'tracker.update', { id, fields: 'replaced body' }, opts);
    expect(res.ok).toBe(true);
    expect(res.data.id).toBe(id);

    const issue = readIssue(id);
    expect(issue.body).toBe('replaced body');
    expect(issue.title).toBe(title);
  }, 60000);
});

/**
 * TRD-013-TEST -- verify blocking edges remove and restore readiness
 * (TRD-2026-6995dc96 TRD-013-TEST; PRD REQ-005 AC-005-1, AC-005-2, AC-005-3).
 *
 *  - Happy: A made blocked by B -> A leaves the ready listing, B stays; cross-checked against
 *           `kata ready` read directly and the link on `kata show A`.
 *  - Happy: the link removed -> A reappears (a repeat remove is idempotent).
 *  - Edge:  a related/parent-kind dep-add is refused with a reason naming the kind and the ready
 *           listing is unchanged, with no blocking link created.
 *
 * `KATA_WRITES_MANIFEST` may point at a mutated copy of the manifest for a RED demonstration.
 */
const DEP_PARENT = path.join(os.homedir(), '.omp', 'br-az4gq', 'jest');

guardKata('TRD-013-TEST blocking edges remove and restore readiness (real kata)', () => {
  let ws;
  let opts;

  beforeAll(() => {
    fs.mkdirSync(DEP_PARENT, { recursive: true });
    ws = kataScratch({ root: DEP_PARENT });
    ws.init();
    expect(ws.errors).toEqual([]);
    opts = { parentEnv: { ...ws.env }, execFileOptions: { cwd: ws.workspace } };
  }, 60000);

  afterAll(() => {
    if (ws) ws.cleanup();
  });

  function createItem(title) {
    const res = ws.runInWorkspace(['create', title, '--json']);
    const id = parseJson(res.stdout)?.issue?.short_id;
    expect(id).toBeTruthy();
    return id;
  }

  /** Two fresh open items; returns { a, b }. */
  const pair = (label) => ({ a: createItem(`${label} A`), b: createItem(`${label} B`) });

  async function readyIds() {
    const res = await runCapability(MANIFEST, 'work-graph.ready', {}, opts);
    expect(res.ok).toBe(true);
    return res.data.items.map((i) => i.id);
  }

  const directReadyIds = () =>
    parseJson(ws.runInWorkspace(['ready', '--limit', '0', '--json']).stdout).issues.map((i) => i.short_id);

  const showLinks = (id) => parseJson(ws.runInWorkspace(['show', id, '--json']).stdout).links || [];

  test('AC-005-1: A blocked by B -> A leaves the ready listing, B stays', async () => {
    const { a, b } = pair('block');
    const before = await readyIds();
    expect(before).toEqual(expect.arrayContaining([a, b]));

    const res = await runCapability(MANIFEST, 'tracker.dep-add', { id: a, dependsOnId: b, type: 'blocks' }, opts);
    expect(res.ok).toBe(true);

    const after = await readyIds();
    expect(after).not.toContain(a);
    expect(after).toContain(b);

    const direct = directReadyIds();
    expect(direct).not.toContain(a);
    expect(direct).toContain(b);

    const links = showLinks(a);
    expect(links.length).toBeGreaterThan(0);
    expect(JSON.stringify(links)).toContain(b);
    expect(JSON.stringify(links)).toContain('blocks');
  }, 60000);

  test('AC-005-2: removing the link -> A reappears in the ready listing, repeat remove is safe', async () => {
    const { a, b } = pair('restore');
    const added = await runCapability(MANIFEST, 'tracker.dep-add', { id: a, dependsOnId: b, type: 'blocks' }, opts);
    expect(added.ok).toBe(true);
    expect(await readyIds()).not.toContain(a);

    const res = await runCapability(MANIFEST, 'tracker.dep-remove', { id: a, dependsOnId: b }, opts);
    expect(res.ok).toBe(true);

    const after = await readyIds();
    expect(after).toEqual(expect.arrayContaining([a, b]));
    expect(directReadyIds()).toContain(a);
    expect(JSON.stringify(showLinks(a))).not.toContain(b);

    const again = await runCapability(MANIFEST, 'tracker.dep-remove', { id: a, dependsOnId: b }, opts);
    expect(again.ok).toBe(true);
    expect(await readyIds()).toContain(a);
  }, 60000);

  test.each(['related', 'parent'])(
    'AC-005-3: a %s-kind dep-add is refused with a reason, ready listing unchanged',
    async (kind) => {
      const { a, b } = pair(`refuse ${kind}`);
      const before = await readyIds();
      expect(before).toEqual(expect.arrayContaining([a, b]));

      const res = await runCapability(MANIFEST, 'tracker.dep-add', { id: a, dependsOnId: b, type: kind }, opts);
      expect(res.ok).toBe(false);
      expect(res.error.code).toBe('NOT_ALLOWED');
      expect(res.error.message).toContain(kind);

      const after = await readyIds();
      expect([...after].sort()).toEqual([...before].sort());
      expect(after).toEqual(expect.arrayContaining([a, b]));
      expect(directReadyIds()).toContain(a);
      expect(JSON.stringify(showLinks(a))).not.toContain(b);
    },
    60000
  );
});

/**
 * TRD-010-TEST -- dedupe lookup returns exactly the matching item (PRD REQ-002 AC-002-1..3).
 * Drives tracker.create-detailed then tracker.find-by-key against a REAL kata and asserts the
 * lookup result only (`data.items`); list-schema validity is TRD-033-TEST's concern.
 * `KATA_WRITES_MANIFEST` may point at a mutated copy of the manifest for a RED demonstration.
 */
const DEDUPE_PARENT = path.join(os.homedir(), '.omp', 'br-hltiu', 'jest');

guardKata('TRD-010-TEST dedupe lookup returns exactly the matching item (real kata)', () => {
  let ws;
  let opts;
  const run = `${process.pid}-${Date.now()}`;
  let seq = 0;
  const uniqueKey = (label) => `TRD010-${label}-${run}-${seq++}`;

  beforeAll(() => {
    fs.mkdirSync(DEDUPE_PARENT, { recursive: true });
    ws = kataScratch({ root: DEDUPE_PARENT });
    ws.init();
    expect(ws.errors).toEqual([]);
    opts = { parentEnv: { ...ws.env }, execFileOptions: { cwd: ws.workspace } };
  }, 60000);

  afterAll(() => {
    if (ws) ws.cleanup();
  });

  async function createKeyed(title, key) {
    const res = await runCapability(
      MANIFEST,
      'tracker.create-detailed',
      { title, description: `body of ${title}`, priority: 2, externalKey: key },
      opts
    );
    expect(res.ok).toBe(true);
    expect(res.data.id).toBeTruthy();
    return res.data.id;
  }

  const find = (key) => runCapability(MANIFEST, 'tracker.find-by-key', { key }, opts);

  test('AC-002-1: lookup of key K returns the single item created with K and no other', async () => {
    const decoyId = await createKeyed('decoy item', uniqueKey('decoy'));
    const key = uniqueKey('happy');
    const id = await createKeyed('keyed item', key);
    const other = await createKeyed('later decoy', uniqueKey('decoy2'));

    const res = await find(key);
    expect(res.ok).toBe(true);
    expect(res.data.items).toHaveLength(1);
    expect(res.data.items[0].id).toBe(id);
    const ids = res.data.items.map((i) => i.id);
    expect(ids).not.toContain(decoyId);
    expect(ids).not.toContain(other);
  }, 60000);

  test('AC-002-2: a key matching nothing yields an empty list, not an error', async () => {
    await createKeyed('present item', uniqueKey('present'));
    const res = await find(uniqueKey('absent'));
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.data.items)).toBe(true);
    expect(res.data.items).toEqual([]);
  }, 60000);

  test('AC-002-3: with keys K1 and K2, each lookup returns only its own item', async () => {
    const k1 = uniqueKey('k1');
    const k2 = uniqueKey('k2');
    const id1 = await createKeyed('first keyed', k1);
    const id2 = await createKeyed('second keyed', k2);
    expect(id1).not.toBe(id2);

    const r1 = await find(k1);
    expect(r1.ok).toBe(true);
    expect(r1.data.items.map((i) => i.id)).toEqual([id1]);

    const r2 = await find(k2);
    expect(r2.ok).toBe(true);
    expect(r2.data.items.map((i) => i.id)).toEqual([id2]);
  }, 60000);
});

/**
 * TRD-012-TEST -- label sweeps and the ownership-derived in-progress state
 * (TRD-2026-6995dc96 TRD-012-TEST; PRD REQ-004 AC-004-1, AC-004-2, amended AC-004-3).
 *
 *  - Happy: tracker.label-one applied to each of three same-prefix ids -> each reads back labelled.
 *  - Edge:  set-status in_progress -> owned and open (owner reported); set-status open drops the claim.
 *  - Edge:  set-status closed with no reason/evidence -> refused (INVALID_ARG), item stays open.
 * The `owner` field's presence in the normalized shape is asserted by TRD-034-TEST; this reads it.
 * `KATA_WRITES_MANIFEST` may point at a mutated copy of the manifest for a RED demonstration.
 */
const LABEL_PARENT = path.join(os.homedir(), '.omp', 'br-mnhr2', 'jest');

guardKata('TRD-012-TEST label sweeps and ownership-derived in-progress (real kata)', () => {
  let ws;
  let opts;

  beforeAll(() => {
    fs.mkdirSync(LABEL_PARENT, { recursive: true });
    ws = kataScratch({ root: LABEL_PARENT });
    ws.init();
    expect(ws.errors).toEqual([]);
    opts = { parentEnv: { ...ws.env }, execFileOptions: { cwd: ws.workspace } };
  }, 60000);

  afterAll(() => {
    if (ws) ws.cleanup();
  });

  function createItem(title) {
    const res = ws.runInWorkspace(['create', title, '--json']);
    const id = parseJson(res.stdout)?.issue?.short_id;
    expect(id).toBeTruthy();
    return id;
  }

  const readIssue = (id) => parseJson(ws.runInWorkspace(['show', id, '--json']).stdout).issue;

  test('AC-004-1: a label applied to each of three same-prefix ids reads back on each, not on a decoy', async () => {
    const label = 'sweep-trd012';
    const ids = ['one', 'two', 'three'].map((n) => createItem(`sweep batch ${n}`));
    const decoy = createItem('unrelated decoy');

    for (const id of ids) {
      const res = await runCapability(MANIFEST, 'tracker.label-one', { id, label }, opts);
      expect(res.ok).toBe(true);
    }

    for (const id of ids) {
      expect(readIssue(id).labels).toContain(label);
      const shown = await runCapability(MANIFEST, 'tracker.show', { id }, opts);
      expect(shown.ok).toBe(true);
      expect(shown.data.labels).toContain(label);
    }
    expect(readIssue(decoy).labels || []).not.toContain(label);
    const decoyShown = await runCapability(MANIFEST, 'tracker.show', { id: decoy }, opts);
    expect(decoyShown.data.labels).not.toContain(label);
  }, 90000);

  test('AC-004-2: set-status in_progress on an open unowned item -> owned and open, owner reported', async () => {
    const id = createItem('claim me');
    expect(readIssue(id).owner || '').toBe('');

    const res = await runCapability(MANIFEST, 'tracker.set-status', { id, status: 'in_progress' }, opts);
    expect(res.ok).toBe(true);
    expect(typeof res.data.owner).toBe('string');
    expect(res.data.owner).not.toBe('');
    expect(res.data.status).toBe('in_progress');

    const issue = readIssue(id);
    expect(issue.status).toBe('open');
    expect(issue.owner).toBeTruthy();
    expect(issue.owner).toBe(res.data.owner);

    const shown = await runCapability(MANIFEST, 'tracker.show', { id }, opts);
    expect(shown.ok).toBe(true);
    expect(shown.data.owner).toBe(res.data.owner);
    expect(shown.data.status).toBe('in_progress');
  }, 60000);

  test('AC-004-2: set-status open drops the claim -> open and unowned', async () => {
    const id = createItem('claim then drop');
    const claimed = await runCapability(MANIFEST, 'tracker.set-status', { id, status: 'in_progress' }, opts);
    expect(claimed.ok).toBe(true);
    expect(readIssue(id).owner).toBeTruthy();

    const res = await runCapability(MANIFEST, 'tracker.set-status', { id, status: 'open' }, opts);
    expect(res.ok).toBe(true);

    const issue = readIssue(id);
    expect(issue.status).toBe('open');
    expect(issue.owner || '').toBe('');
    const shown = await runCapability(MANIFEST, 'tracker.show', { id }, opts);
    expect(shown.data.status).toBe('open');
  }, 60000);

  test('AC-004-3: set-status closed with no reason or evidence is refused, the item stays open', async () => {
    const id = createItem('close via status');
    const res = await runCapability(MANIFEST, 'tracker.set-status', { id, status: 'closed' }, opts);
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('INVALID_ARG');

    expect(readIssue(id).status).toBe('open');
  }, 60000);
});
