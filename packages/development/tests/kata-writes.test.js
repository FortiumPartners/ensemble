'use strict';

/**
 * TRD-011-TEST -- verify reason and evidence on close, and refusal without them
 * (TRD-2026-6995dc96 TRD-011-TEST; PRD REQ-003 AC-003-1, AC-003-2, AC-003-3).
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
