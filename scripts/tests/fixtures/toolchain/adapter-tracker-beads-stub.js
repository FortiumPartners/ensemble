'use strict';

/**
 * Shared test helper (NOT a test file itself) for `adapter-tracker-beads`'s own test suite
 * (TRD-2026-8d825f54 TRD-024). Writes small, executable, node-shebang stub `br`/`bv` scripts
 * into a caller-supplied directory under `os.tmpdir()`; a caller prepends that directory to
 * `PATH` so the adapter's real, unmodified `adapter.yaml` `run[]` templates (which invoke the
 * bare binary names `br`/`bv`, resolved via `PATH`) hit these stubs instead of a real
 * `br`/`bv` install. NEVER writes inside the real repository tree and NEVER shells out to a
 * real `br`/`bv` binary itself.
 *
 * Both stubs branch on `process.argv.slice(2)` (the argv the adapter's `run[]` template
 * produced, minus the interpreter and script path) to decide which canned JSON to print,
 * mirroring real `br`/`bv` output shapes captured live and saved under
 * `scripts/tests/fixtures/toolchain/adapter-tracker-beads-samples/` (see that directory's
 * `README.md` for provenance).
 *
 * A per-test CONTROL FILE, not an env var, drives the handful of response variations the
 * suite needs (which `status` `br show` reports, whether `br list` wraps its output, which ids
 * `bv --robot-plan` lists, whether a command should report an error envelope, how large a
 * synthetic `br list` payload to emit): `packages/development/lib/toolchain/runner.js
 * #buildChildEnv` deliberately strips every env var the resolved adapter's own `env: []` does
 * not declare (plus a small fixed allowlist) before spawning ANY adapter child process -- a
 * custom `STUB_*` env var set on the TEST process would never reach the stub child at all
 * (proven empirically: an earlier version of this helper tried exactly that and every
 * "variant" test silently saw only the stub's hard-coded default).
 *
 * The control file lives INSIDE the caller-supplied `binDir` (`<binDir>/control.json`), never
 * at one fixed `os.tmpdir()` path. `binDir` is already unique per test (created via
 * `mkTempDir('adapter-tracker-beads-bin-')`/`mkStubBinDir()`), so colocating the control file
 * there gives every test its own private channel with no shared state across jest worker
 * processes -- a single fixed `os.tmpdir()` path was last-writer-wins across the two test
 * suites' separate workers, silently corrupting whichever test lost the race (reviewer round
 * 2, P2: reproduced as 2 failures running both suites together, one of them a mutation-proof
 * guard test passing vacuously). Both stub sources resolve the identical path via their own
 * `path.dirname(process.argv[1])` (the directory the stub binary itself was spawned from, which
 * is always `binDir`) -- no env var, no shared `require`, and no fixed-name collision risk is
 * possible even under full jest parallelism.
 */

const fs = require('fs');
const path = require('path');

const CONTROL_FILE_NAME = 'control.json';

/**
 * Resolve one test's control-file path, colocated with its stub binaries inside `binDir`.
 * @param {string} binDir absolute path to the per-test stub bin directory
 * @returns {string}
 */
function controlFilePath(binDir) {
  return path.join(binDir, CONTROL_FILE_NAME);
}

/**
 * Write this test's stub response overrides. Call once per test (after `writeBeadsStubs(binDir)`,
 * before invoking the adapter), passing the same `binDir`. No cleanup call is needed: the
 * control file lives inside `binDir`, which every caller already removes in its own `afterEach`
 * (`fs.rmSync(dir, {recursive: true, force: true})`).
 * @param {string} binDir the same directory passed to `writeBeadsStubs`
 * @param {{brShowStatus?: string, brListShape?: 'wrapped'|'bare', brListLargeIssueCount?: number,
 *   brErrorEnvelope?: boolean, bvItemIds?: string[]}} [overrides]
 */
function writeStubControl(binDir, overrides = {}) {
  fs.writeFileSync(controlFilePath(binDir), JSON.stringify(overrides));
}

const BR_STUB_SOURCE = `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);

function readControl() {
  try {
    return JSON.parse(fs.readFileSync(path.join(path.dirname(process.argv[1]), 'control.json'), 'utf8'));
  } catch {
    return {};
  }
}
const control = readControl();
const status = control.brShowStatus || 'open';
const listShape = control.brListShape || 'wrapped';
const listLargeIssueCount = control.brListLargeIssueCount || 0;
const errorEnvelope = Boolean(control.brErrorEnvelope);

function out(value) {
  process.stdout.write(JSON.stringify(value));
}

// Matches the real \`br\` shape this adapter's own comments/SKILL.md document for a tool
// failure reported on a ZERO exit (never a non-zero exit the stub would need argv[0] !==
// handled branches for): \`comments list\`/\`sync\`/\`label add\`/\`list\` all print
// \`{"error":{...}}\` to stdout instead of their normal payload (TRD-024 reviewer round 2, P1).
const ERROR_ENVELOPE = { error: { code: 'CONFLICT', message: 'stale DB guard' } };

if (argv[0] === '--version') {
  process.stdout.write('br 0.6.0-stub\\n');
} else if (argv[0] === 'show') {
  out([
    { id: argv[1], title: 'Stub title', description: 'Stub description', issue_type: 'task', status, labels: ['a', 'b'] }
  ]);
} else if (argv[0] === 'list') {
  if (errorEnvelope) {
    out(ERROR_ENVELOPE);
  } else {
    let issues = [{ id: 'b-1', title: 'Stub issue', status: 'open', issue_type: 'task', labels: [] }];
    if (listLargeIssueCount > 0) {
      // A ~8KB filler description per issue approximates this repo's own live \`br list
      // --all --json\` size (~3.4 MB at ~740 real issues, TRD-024 reviewer round 2, P2) without
      // needing a real tracker: synthetic size is deterministic and caller-controlled via the
      // issue count.
      const filler = 'x'.repeat(8000);
      issues = Array.from({ length: listLargeIssueCount }, (_, i) => ({
        id: 'b-' + i,
        title: 'Stub issue ' + i,
        status: 'open',
        issue_type: 'task',
        labels: [],
        description: filler
      }));
    }
    out(listShape === 'bare' ? issues : { issues, total: issues.length, limit: 0, offset: 0, has_more: false });
  }
} else if (argv[0] === 'create') {
  // Matches the REAL br create --json shape (captured live, br 0.6.0): a BARE issue object,
  // never array-wrapped like show/update/close (the earlier array-wrapped stub here was an
  // inference that hid a real $[0]-root BAD_OUTPUT bug in the adapter's tracker.create).
  out({ id: 'br-created-1', title: 'Stub created', status: 'open' });
} else if (argv[0] === 'update') {
  out([{ id: argv[1], status: 'open' }]);
} else if (argv[0] === 'close') {
  out([{ id: argv[1], status: 'closed' }]);
} else if (argv[0] === 'comments' && argv[1] === 'add') {
  // Matches the REAL \`br comments add <id> <text> --json\` shape (confirmed live, \`br\`
  // 0.6.0): a BARE object (never array-wrapped like \`show\`/\`update\`/\`close\`) whose \`id\` is
  // the new comment's own numeric id, not the issue id (TRD-2026-8d825f54 PR 9 review: the
  // prior stub's \`[{id: argv[2]}]\` fabricated an array-wrapped, issue-id-keyed shape that
  // never matched the real tool and let \`adapter-tracker-beads/adapter.yaml\`'s
  // \`tracker.comment\` parse block ship with two real bugs undetected).
  out({ id: 1, issue_id: argv[2], author: 'stub', text: argv[3], created_at: '2024-01-01T00:00:00Z' });
} else if (argv[0] === 'comments' && argv[1] === 'list') {
  out(errorEnvelope ? ERROR_ENVELOPE : [{ author: 'stub', text: 'a stub comment' }]);
} else if (argv[0] === 'dep' && argv[1] === 'add') {
  // Real shape captured live (br 0.6.0, br-dep-add/-remove samples): a bare object keyed by
  // issue_id, no id field, no array wrapper.
  out({ status: 'ok', issue_id: argv[2], depends_on_id: argv[3], type: 'blocks', action: 'added' });
} else if (argv[0] === 'dep' && argv[1] === 'remove') {
  out({ status: 'ok', issue_id: argv[2], depends_on_id: argv[3], type: 'blocks', action: 'removed' });
} else if (argv[0] === 'label' && argv[1] === 'add') {
  out(errorEnvelope ? ERROR_ENVELOPE : { ids: [argv[2]], labels: ['stub-label'] });
} else if (argv[0] === 'sync') {
  out(errorEnvelope ? ERROR_ENVELOPE : { status: 'flushed' });
} else {
  process.stderr.write('stub br: unrecognized argv ' + JSON.stringify(argv) + '\\n');
  process.exit(1);
}
`;

const BV_STUB_SOURCE = `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);

function readControl() {
  try {
    return JSON.parse(fs.readFileSync(path.join(path.dirname(process.argv[1]), 'control.json'), 'utf8'));
  } catch {
    return {};
  }
}
const control = readControl();
const ids = control.bvItemIds || ['br-zz-last', 'br-aa-first', 'br-mm-mid'];

function out(value) {
  process.stdout.write(JSON.stringify(value));
}

if (argv.includes('--version')) {
  process.stdout.write('bv v0.25.2-stub\\n');
} else if (argv.includes('--robot-plan')) {
  const items = ids.map((id, i) => ({ id, title: 'Stub ' + id, priority: i, status: 'open', unblocks: [] }));
  out({
    plan: {
      tracks: [
        { track_id: 'track-A', items, reason: 'Independent work stream' },
        { track_id: 'track-B', items: [{ id: 'br-other-track', title: 'x', priority: 0, status: 'open', unblocks: [] }], reason: 'Independent work stream' }
      ],
      total_actionable: items.length + 1,
      total_blocked: 0,
      summary: { highest_impact: items[0] ? items[0].id : null, impact_reason: 'stub', unblocks_count: 0 }
    }
  });
} else if (argv.includes('--robot-insights')) {
  out({
    status: { Cycles: { state: 'computed' }, PageRank: { state: 'computed' } },
    Cycles: []
  });
} else {
  process.stderr.write('stub bv: unrecognized argv ' + JSON.stringify(argv) + '\\n');
  process.exit(1);
}
`;

/**
 * Write executable `br`/`bv` stub scripts into `binDir` (created if missing). Returns `binDir`
 * for convenient chaining.
 * @param {string} binDir absolute path, expected to live under `os.tmpdir()`
 * @returns {string} `binDir`
 */
function writeBeadsStubs(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  const brPath = path.join(binDir, 'br');
  const bvPath = path.join(binDir, 'bv');
  fs.writeFileSync(brPath, BR_STUB_SOURCE, { mode: 0o755 });
  fs.writeFileSync(bvPath, BV_STUB_SOURCE, { mode: 0o755 });
  fs.chmodSync(brPath, 0o755);
  fs.chmodSync(bvPath, 0o755);
  return binDir;
}

module.exports = { writeBeadsStubs, writeStubControl };
