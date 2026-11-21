'use strict';

/**
 * Real-subprocess, tracker-adapter-swap coverage for three `trd-cli.js` CLI surfaces
 * (TRD-2026-8d825f54 TRD-025-TEST, PRD AC-016-2): `bead-context` (no `--issue-json`, so it
 * actually hits `resolveTrackerAdapter -> runCapabilitySync('tracker.show', ...)`), `status`
 * (which calls `getBeadCounts -> runCapabilitySync('tracker.list', ...)`), and `beads-label`
 * (which calls `ensureLabel`'s default `runBr`, routed through `tracker.list`/`tracker.label`).
 *
 * `tests/bead-context.test.js` only ever drives `bead-context` via `--issue-json`, bypassing
 * the tracker adapter entirely. `tests/trd-cli.test.js`'s `status`/`list` coverage never swaps
 * the tracker adapter. `tests/beads-label-default-run.test.js` proves `ensureLabel`'s default
 * route in-process, through a stub still literally named `br`. None of those three prove, as a
 * REAL subprocess, that these CLI surfaces route through WHATEVER adapter `.ensemble/
 * toolchain.yaml` resolves -- not a same-named shadow of the real `br`/`bv` -- with no real
 * `br`/`bv` reachable on `PATH` at all. This file closes that gap: the fixture adapter's own
 * binary is named `fixture-tracker` (never `br`), and every subprocess here runs under a
 * `PATH` built from scratch (fixture bin dir + node's own dir + `/usr/bin:/bin`), never
 * inheriting the real `process.env.PATH`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

const CLI = path.join(__dirname, '..', 'lib', 'trd-cli.js');
const ADAPTER_ID = 'fixture-tracker-adapter';
const BIN_NAME = 'fixture-tracker';
const SLUG = 'trd-2026-fixture-demo';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REPO_DEV_PKG = path.join(REPO_ROOT, 'packages', 'development');

/** Minimal, parseable TRD fixture: one INFRA task (no PRD requirements), so `bead-context`
 * can reach `ok:true` without any PRD file at all. */
const TRD_TEXT = `# Demo TRD

Summary.

## Master Task List

### PR 1: First

**Shippable State:** Works.

- [ ] **TRD-002** Wire CI (1h) \`[satisfies INFRA]\`
  - Target File: ci.yml
`;

/** `## References` block the stub's `show` response embeds as the bead description --
 * exactly what `bead-refs.js#parseReferencesBlock` expects, pointing at the TRD fixture above. */
const REFERENCES_BLOCK = ['## References', `TRD: docs/TRD/${SLUG}.md`, `TRD Task: docs/TRD/${SLUG}.md#trd-002`].join(
  '\n'
);

/** `tracker.list` fixture data shared by the `status`/`beads-label` tests: three beads in this
 * TRD's scope (one of each status, one already labeled) and one foreign bead outside scope. */
const LIST_ISSUES = [
  { id: 'b-1', title: `[trd:${SLUG}:task:TRD-001] one`, status: 'open', labels: [] },
  { id: 'b-2', title: `[trd:${SLUG}:task:TRD-002] two`, status: 'closed', labels: ['demo-label'] },
  { id: 'b-3', title: `[trd:${SLUG}:task:TRD-003] three`, status: 'in_progress', labels: [] },
  { id: 'b-4', title: '[trd:other-slug] foreign', status: 'open', labels: [] },
];
const LIST_RESPONSE = { issues: LIST_ISSUES, total: LIST_ISSUES.length, limit: 0, offset: 0, has_more: false };

const SHOW_RESPONSE = [
  {
    id: 'b-show-1',
    title: 'TRD-002 fixture bead',
    description: REFERENCES_BLOCK,
    status: 'open',
    issue_type: 'task',
    labels: [],
  },
];

/**
 * Stand-in for `br`/`bv`, deliberately named `fixture-tracker` -- never `br` -- so a passing
 * assertion proves the CLI routed through WHATEVER binary the resolved adapter declares, not a
 * coincidentally-`br`-named shadow. Answers `show`, `list` and `label add` with the canned
 * fixtures above and appends every argv it receives (one JSON line each) to `calls.log`.
 */
const STUB_SOURCE = `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
fs.appendFileSync(path.join(__dirname, 'calls.log'), JSON.stringify(argv) + '\\n');
function out(value) {
  process.stdout.write(JSON.stringify(value));
}
if (argv[0] === 'show') {
  out(${JSON.stringify(SHOW_RESPONSE)});
} else if (argv[0] === 'list') {
  out(${JSON.stringify(LIST_RESPONSE)});
} else if (argv[0] === 'label' && argv[1] === 'add') {
  out({ ids: [argv[2]], labels: [argv[4]] });
} else {
  process.stderr.write('stub ${BIN_NAME}: unrecognized argv ' + JSON.stringify(argv) + '\\n');
  process.exit(1);
}
`;

function writeStub(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  const stubPath = path.join(binDir, BIN_NAME);
  fs.writeFileSync(stubPath, STUB_SOURCE, { mode: 0o755 });
  fs.chmodSync(stubPath, 0o755);
  return binDir;
}

/** Installed-origin adapter (bypasses the repo-local trust gate), `tracker.show`'s `parse`
 * block mirrors `skills/adapter-tracker-beads/adapter.yaml`'s real shape verbatim (array-of-
 * one root, id/title/description/type/status/labels map, statusMap) so `bead-context`'s own
 * JSON-shape assumptions are satisfied; `tracker.list`/`tracker.label` declare no `parse`
 * block, same as the real adapter, since neither output shape has a top-level `id`. */
function writeAdapter(projectRoot, adapterId) {
  const skillDir = path.join(projectRoot, 'packages', 'fixture-pkg', 'skills', adapterId);
  fs.mkdirSync(skillDir, { recursive: true });
  const manifest = {
    adapter: adapterId,
    version: '1.0.0',
    categories: ['tracker'],
    contract: { tracker: '1.0' },
    binaries: [BIN_NAME],
    allowlist: [{ bin: BIN_NAME, sub: ['show', 'list', 'label'] }],
    env: [],
    health: [],
    detect: [],
    capabilities: {
      'tracker.show': {
        run: [BIN_NAME, 'show', '${id}', '--json'],
        parse: {
          format: 'json',
          root: '$[0]',
          map: {
            id: '$.id',
            title: '$.title',
            description: '$.description',
            type: '$.issue_type',
            status: '$.status',
            labels: '$.labels',
          },
          statusMap: { open: 'open', in_progress: 'in_progress', closed: 'closed' },
        },
      },
      'tracker.list': { run: [BIN_NAME, 'list', '--all', '--limit', '0', '--json'] },
      'tracker.label': { run: [BIN_NAME, 'label', 'add', '${ids}', '-l', '${labels}', '--json'] },
    },
  };
  fs.writeFileSync(path.join(skillDir, 'adapter.yaml'), yaml.dump(manifest));
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `# ${adapterId}\n`);
}

/** Fresh throwaway project root: `.ensemble/toolchain.yaml` selecting the fixture adapter, the
 * adapter itself, a stub bin dir, and the TRD fixture under `docs/TRD/`. */
function mkProjectRoot() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trd-cli-adapter-swap-')));
  fs.mkdirSync(path.join(dir, '.ensemble'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ensemble', 'toolchain.yaml'), `tracker: ${ADAPTER_ID}\n`);
  writeAdapter(dir, ADAPTER_ID);
  const binDir = writeStub(path.join(dir, 'bin'));
  fs.mkdirSync(path.join(dir, 'docs', 'TRD'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'TRD', `${SLUG}.md`), TRD_TEXT);
  return { dir, binDir };
}

function readCalls(binDir) {
  const logPath = path.join(binDir, 'calls.log');
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/**
 * Build a `PATH` containing ONLY the fixture bin dir, node's own dir (so `node <CLI>` itself
 * still resolves) and `/usr/bin:/bin` (core POSIX utilities Node/git may need) -- NEVER the
 * real inherited `process.env.PATH` -- so no real `br`/`bv` anywhere on the host's real PATH
 * can possibly be reached by these subprocesses.
 */
function buildPath(binDir) {
  return [binDir, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter);
}

function run(args, cwd, env, cliPath = CLI) {
  const r = spawnSync('node', [cliPath, ...args], { cwd, env, encoding: 'utf8' });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    // some assertions below only need status/stdout/stderr
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

describe('no real br/bv reachable under the constructed PATH', () => {
  test('`which br` resolves to nothing under the fixture PATH', () => {
    const { binDir } = mkProjectRoot();
    const constructedPath = buildPath(binDir);
    const result = spawnSync('which', ['br'], { env: { PATH: constructedPath }, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stdout.trim()).toBe('');
    const resultBv = spawnSync('which', ['bv'], { env: { PATH: constructedPath }, encoding: 'utf8' });
    expect(resultBv.status).not.toBe(0);
    expect(resultBv.stdout.trim()).toBe('');
  });
});

describe('bead-context routes through the swapped, non-br-named tracker adapter (real subprocess)', () => {
  test('ok:true via tracker.show on fixture-tracker, not the real br', () => {
    const { dir, binDir } = mkProjectRoot();
    const constructedPath = buildPath(binDir);
    const { status, json } = run(['bead-context', '--bead', 'b-show-1'], dir, { PATH: constructedPath });

    expect(json.ok).toBe(true);
    expect(status).toBe(0);
    expect(json.references.trdTask).toBe(`docs/TRD/${SLUG}.md#trd-002`);
    expect(json.context.trdTask).toMatchObject({ id: 'TRD-002', targetFiles: ['ci.yml'] });

    const calls = readCalls(binDir);
    expect(calls).toContainEqual(['show', 'b-show-1', '--json']);
  });
});

describe('status (getBeadCounts) routes through the swapped, non-br-named tracker adapter (real subprocess)', () => {
  test('bead counts and completion_pct come from the fixture-tracker list response', () => {
    const { dir, binDir } = mkProjectRoot();
    const constructedPath = buildPath(binDir);
    const { status, json } = run(
      ['status', SLUG, '--dir', path.join(dir, 'docs', 'TRD')],
      dir,
      { PATH: constructedPath }
    );

    expect(status).toBe(0);
    expect(json.ok).toBe(true);
    expect(json.bead_counts).toEqual({ total: 3, open: 1, in_progress: 1, closed: 1 });
    expect(json.completion_pct).toBeCloseTo(33.3, 1);

    const calls = readCalls(binDir);
    expect(calls).toContainEqual(['list', '--all', '--limit', '0', '--json']);
  });
});

/**
 * `tracker.list` fixture data for the large-output test below (PR 6 review item 1): the SAME
 * 3 in-scope + 1 foreign issues as `LIST_ISSUES`, PLUS ~400 padding foreign issues carrying an
 * 8 KB filler description each (~3.2 MB total) -- comfortably over Node's own 1 MiB
 * `execFile`/`execFileSync` default `maxBuffer` and comfortably under this runner's 64 MiB
 * `DEFAULT_MAX_BUFFER_BYTES`, approximating this repo's own real `br list --all --json` size
 * (TRD-024 reviewer round 2, P2: ~3.4 MB at this repo's own live `.beads/` database).
 */
const LARGE_LIST_ISSUES = [
  ...LIST_ISSUES,
  ...Array.from({ length: 400 }, (_, i) => ({
    id: `pad-${i}`,
    title: '[trd:other-slug] padding',
    status: 'open',
    labels: [],
    description: 'x'.repeat(8000),
  })),
];
const LARGE_LIST_RESPONSE = {
  issues: LARGE_LIST_ISSUES,
  total: LARGE_LIST_ISSUES.length,
  limit: 0,
  offset: 0,
  has_more: false,
};

/** Same shape as `STUB_SOURCE` above, but `list` answers with `LARGE_LIST_RESPONSE` instead
 * of the small `LIST_RESPONSE` -- a dedicated stub rather than parameterizing the shared one,
 * since every other test in this file depends on the exact small fixture counts. */
const LARGE_STUB_SOURCE = `#!/usr/bin/env node
'use strict';
const argv = process.argv.slice(2);
function out(value) {
  process.stdout.write(JSON.stringify(value));
}
if (argv[0] === 'list') {
  out(${JSON.stringify(LARGE_LIST_RESPONSE)});
} else {
  process.stderr.write('stub ${BIN_NAME}: unrecognized argv ' + JSON.stringify(argv) + '\\n');
  process.exit(1);
}
`;

/** Fresh throwaway project root wired to `LARGE_STUB_SOURCE` instead of the shared small one. */
function mkLargeListProjectRoot() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trd-cli-adapter-swap-large-')));
  fs.mkdirSync(path.join(dir, '.ensemble'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ensemble', 'toolchain.yaml'), `tracker: ${ADAPTER_ID}\n`);
  writeAdapter(dir, ADAPTER_ID);
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const stubPath = path.join(binDir, BIN_NAME);
  fs.writeFileSync(stubPath, LARGE_STUB_SOURCE, { mode: 0o755 });
  fs.chmodSync(stubPath, 0o755);
  fs.mkdirSync(path.join(dir, 'docs', 'TRD'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'TRD', `${SLUG}.md`), TRD_TEXT);
  return { dir, binDir };
}

describe("status (getBeadCounts) with a ~3 MB tracker.list response (PR 6 review item 1: real, non-zero counts, not a maxBuffer-overflow-induced zero)", () => {
  test('bead counts come from the REAL ~3 MB fixture-tracker list response, not an all-zero fallback', () => {
    const { dir, binDir } = mkLargeListProjectRoot();
    const constructedPath = buildPath(binDir);
    const { status, json } = run(
      ['status', SLUG, '--dir', path.join(dir, 'docs', 'TRD')],
      dir,
      { PATH: constructedPath }
    );

    expect(status).toBe(0);
    expect(json.ok).toBe(true);
    // The exact same 3-in-scope-of-4 counts LIST_ISSUES always produces -- proving the 400
    // padding issues (and the ~3.2 MB they add) were actually read and parsed, not truncated,
    // silently dropped, or swallowed into the getBeadCounts `{total:0,...}` failure fallback.
    expect(json.bead_counts).toEqual({ total: 3, open: 1, in_progress: 1, closed: 1 });
    expect(json.bead_counts.total).not.toBe(0);
  });

  describe('mutation-proof: removing the runner default maxBuffer breaks this through the real trd-cli.js status command', () => {
    test('the real (unmutated) CLI still returns true counts (same as the test above)', () => {
      const { dir, binDir } = mkLargeListProjectRoot();
      const constructedPath = buildPath(binDir);
      const { status, json } = run(['status', SLUG, '--dir', path.join(dir, 'docs', 'TRD')], dir, {
        PATH: constructedPath,
      });
      expect(status).toBe(0);
      expect(json.bead_counts).toEqual({ total: 3, open: 1, in_progress: 1, closed: 1 });
    });

    test("reverting runner.js's own 'maxBuffer: DEFAULT_MAX_BUFFER_BYTES,' inside runCapabilitySync makes the SAME status command silently report all-zero counts again (TRD-024 reviewer round 2, P2's original defect)", () => {
      const { dir, binDir } = mkLargeListProjectRoot();
      const constructedPath = buildPath(binDir);
      const mutant = makeTrdCliMutantRoot();
      try {
        const runnerPath = path.join(path.dirname(mutant.trdCliPath), 'toolchain', 'runner.js');
        mutateFile(
          runnerPath,
          'stdout = execFileSync(argv[0], argv.slice(1), {\n' + '      maxBuffer: DEFAULT_MAX_BUFFER_BYTES,',
          'stdout = execFileSync(argv[0], argv.slice(1), {'
        );

        const mutantResult = run(
          ['status', SLUG, '--dir', path.join(dir, 'docs', 'TRD')],
          dir,
          { PATH: constructedPath },
          mutant.trdCliPath
        );
        // getBeadCounts' own try/catch swallows the runner's ENOBUFS-mapped TOOL_FAILED
        // envelope to the documented all-zero fallback (by contract, TRD-025 AC -- see that
        // function's own JSDoc) rather than propagating the error -- exactly the silent,
        // hard-to-notice symptom the original review finding described.
        expect(mutantResult.status).toBe(0);
        expect(mutantResult.json.ok).toBe(true);
        expect(mutantResult.json.bead_counts).toEqual({ total: 0, open: 0, in_progress: 0, closed: 0 });

        // Control: the SAME fixture, against the real (unmutated) CLI, still reports true
        // counts -- so the mutant's zeros above are attributable to the mutation.
        const realResult = run(['status', SLUG, '--dir', path.join(dir, 'docs', 'TRD')], dir, {
          PATH: constructedPath,
        });
        expect(realResult.json.bead_counts).toEqual({ total: 3, open: 1, in_progress: 1, closed: 1 });
      } finally {
        mutant.cleanup();
      }
    });
  });
});

describe('beads-label routes through the swapped, non-br-named tracker adapter (real subprocess)', () => {
  test('labels the matched beads via tracker.list + tracker.label on fixture-tracker', () => {
    const { dir, binDir } = mkProjectRoot();
    const constructedPath = buildPath(binDir);
    const { status, json } = run(
      ['beads-label', '--label', 'demo-label', '--match', `[trd:${SLUG}`],
      dir,
      { PATH: constructedPath }
    );

    expect(status).toBe(0);
    expect(json).toEqual({ ok: true, label: 'demo-label', matched: 3, labeled: 2, already: 1 });

    const calls = readCalls(binDir);
    expect(calls).toContainEqual(['list', '--all', '--limit', '0', '--json']);
    const labelCalls = calls.filter((c) => c[0] === 'label');
    expect(labelCalls.sort()).toEqual(
      [
        ['label', 'add', 'b-1', '-l', 'demo-label', '--json'],
        ['label', 'add', 'b-3', '-l', 'demo-label', '--json'],
      ].sort()
    );
  });
});

/**
 * Build a fresh `/tmp` copy of the WHOLE `packages/development/lib/` tree (including `lib/
 * toolchain/`) plus the `packages/development/toolchain/` data dir `toolchain/config.js`
 * reads at runtime, and a `node_modules` symlink -- the "copy the whole lib directory"
 * simplification this suite's own assignment calls out as acceptable given how many same-
 * directory siblings `trd-cli.js` itself `require()`s. A caller edits one `.js` file under
 * THIS copy on disk and then runs it as a REAL SUBPROCESS; the real repo tree is never
 * written to.
 */
function makeTrdCliMutantRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trd-cli-adapter-swap-mutant-'));
  const nodeModulesLink = path.join(root, 'node_modules');
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), nodeModulesLink, 'dir');

  const devPkgRoot = path.join(root, 'packages', 'development');
  fs.mkdirSync(devPkgRoot, { recursive: true });
  fs.cpSync(path.join(REPO_DEV_PKG, 'lib'), path.join(devPkgRoot, 'lib'), { recursive: true });
  fs.cpSync(path.join(REPO_DEV_PKG, 'toolchain'), path.join(devPkgRoot, 'toolchain'), { recursive: true });

  return {
    trdCliPath: path.join(devPkgRoot, 'lib', 'trd-cli.js'),
    cleanup: () => {
      try {
        fs.rmSync(nodeModulesLink, { force: true });
      } catch {
        // already gone
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Single-replacement, loud-on-miss mutation of an on-disk file (no `require` -- the mutated
 * copy is run as a real subprocess, never loaded in-process). */
function mutateFile(filePath, needle, replacement) {
  const original = fs.readFileSync(filePath, 'utf8');
  if (!original.includes(needle)) {
    throw new Error(`mutateFile: needle not found in ${filePath}: ${JSON.stringify(needle)}`);
  }
  fs.writeFileSync(filePath, original.replace(needle, replacement));
}

describe('mutation-restore proof: bead-context actually discriminates real adapter routing from a direct `br` call (real subprocess)', () => {
  test('a mutant that bypasses tracker.show and calls `br` directly fails (no real br on PATH); the unmutated CLI still succeeds', () => {
    const { dir, binDir } = mkProjectRoot();
    const constructedPath = buildPath(binDir);
    const mutant = makeTrdCliMutantRoot();
    try {
      // Revert `runBeadContext`'s adapter-routed `tracker.show` call to a direct, hardcoded
      // `execFileSync('br', ...)` -- the exact pre-TRD-025 shape this routing replaced.
      mutateFile(
        mutant.trdCliPath,
        `      const result = runCapabilitySync(manifest, 'tracker.show', { id: beadId }, {
        projectRoot: process.cwd(),
        execFileOptions: { cwd: process.cwd() },
      });`,
        `      const result = { ok: true, data: JSON.parse(execFileSync('br', ['show', beadId, '--json']))[0] };`
      );

      const mutantResult = run(
        ['bead-context', '--bead', 'b-show-1'],
        dir,
        { PATH: constructedPath },
        mutant.trdCliPath
      );
      // execFileSync('br', ...) throws ENOENT (no real `br` on the constructed PATH); that
      // throw is caught by runBeadContext's own try/catch and surfaces as ok:false, exit 1 --
      // proving this suite would catch a regression back to a hardcoded `br` call.
      expect(mutantResult.status).toBe(1);
      expect(mutantResult.json.ok).toBe(false);
      expect(mutantResult.json.missing.join(' | ')).toMatch(/bead b-show-1 could not be loaded/);

      // Control: the SAME fixture PATH/project, against the real (unmutated) CLI, still
      // succeeds through the adapter -- so the mutant failure above is attributable to the
      // mutation, not to the fixture itself.
      const realResult = run(['bead-context', '--bead', 'b-show-1'], dir, { PATH: constructedPath });
      expect(realResult.status).toBe(0);
      expect(realResult.json.ok).toBe(true);
    } finally {
      mutant.cleanup();
    }
  });
});
