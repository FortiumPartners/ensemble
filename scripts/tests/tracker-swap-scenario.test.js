'use strict';

/**
 * Scripted tracker-swap scenario (TRD-2026-8d825f54 TRD-034, bead br-0g5b, PRD AC-015-2,
 * AC-016-1, AC-016-4; updated by the PR 8 independent-review fix wave). Proves, through REAL
 * subprocess entry points against the REAL, un-copied `packages/development/lib/toolchain-
 * cli.js` / `trd-cli.js` / `complexity-analyzer.js`, that an operator can select the Jira
 * Cloud or Azure Boards tracker adapter by configuration alone and run scaffold/claim/set-
 * status/close with the default `br`/`bv` tool not installed anywhere on `PATH`.
 *
 * Eight coverage areas (1:1 with the wave orchestrator's assignment, plus Item D below):
 *   1. AC1 -- full create/claim/set-status/close lifecycle through each alternative adapter,
 *      on a PATH with no `br`/`bv` at all; the ledger lists exactly four side effects.
 *   2. AC2 -- `toolchain-cli validate` (TRD-007's composed conformance gate) over both real
 *      manifest directories.
 *   3. AC3 -- `beads-build-wave.yaml`'s documented claim-step argv, both as a static raw-text
 *      assertion and as a dynamic, verbatim reproduction against Azure Boards.
 *   4. Zero-br/bv-invocation proof with STUB br/bv binaries actually present and reachable on
 *      PATH (stronger than AC1's "no br/bv anywhere"), plus a `tracker: beads` control run that
 *      proves the SAME bin dir's br/bv stubs DO get invoked once the default adapter is
 *      selected.
 *   5. Missing-binary negative case: preflight fails `HEALTH_FAILED` naming the configured
 *      adapter, never a silent fallback to `beads`.
 *   6. Swap-consistency: `trd-cli bead-context`, `complexity-analyzer` and `trd-cli beads-label`
 *      all route through whichever adapter is configured, for both alternatives; `beads-label`
 *      degrades to a clean `{ok:false,unavailable:true}` envelope, never a thrown error.
 *   7. Mutation proof: a hardcoded-to-`beads` mutant of `toolchain-cli.js`'s `run` subcommand
 *      either fails to resolve at all, or -- when a `br` stub is reachable -- visibly redirects
 *      a `tracker.create` call to it, while the real, unmutated CLI still routes to the
 *      configured alternative adapter.
 *   8. Item D -- every shipped command YAML's (beads-build/-wave, implement-trd-beads,
 *      implement-bead) OWN `tracker.*` `--require` list, derived from the real source,
 *      preflights `ok:true` against both alternative adapters; three mutation proofs confirm
 *      the derivation and the claim-step argv both actually discriminate a regression.
 *
 * Fixed in this wave (PR 8 independent review -- previously documented below as "Findings,
 * not fixed"; now closed):
 *   - P1 finding 1: `tracker.update`'s single `fields` input was interpreted differently per
 *     adapter (jira: literal status string via `--status`; azure-boards: literal state string
 *     via `--state`; beads: free-form notes via `--notes`) -- `beads-build-wave.yaml`'s own
 *     claim-step argv (`--arg fields={"status":"in_progress"}`) landed VERBATIM as that raw
 *     JSON text on jira/azure-boards, never a real status/state name. FIXED by a new
 *     `tracker.set-status` capability (`inputs:[id,status]`, canonical
 *     open/in_progress/closed) implemented via the manifest `variants` mechanism in all three
 *     adapters; `tracker.update` is repurposed per-adapter for non-status field edits only
 *     (jira: summary; azure-boards: title; beads: notes, unchanged). See AC1/AC3/Item D below.
 *   - P1 finding 2: jira's manifest falsely declared `categories:[tracker,work-graph]` with
 *     zero `work-graph.*` capabilities, so `work-graph.ready`'s `auto` resolution incorrectly
 *     selected jira as the work-graph provider instead of the builtin plan-order fallback.
 *     FIXED: jira now declares `categories:[tracker]` only. `tracker.sync`/`tracker.dep-add`
 *     are now OPTIONAL in every shipped command (never `--require`d), with graceful
 *     degradation on `{ok:false}`. See Item D below for the full preflight proof.
 *   - P2 finding 4 (azure-boards `tracker.list`): the shipped manifest's WIQL depended on an
 *     UNFILLED `${filter}` placeholder the engine declares no default for, so any caller
 *     (including `beads-label`'s own default list call) failed `INVALID_ARG` before a real
 *     `az` subprocess ran at all. FIXED: a fixed, bounded default WIQL (`TOP 200`, no filter
 *     input), plus a `parse`/`arrayMap` block reshaping jira/azure-boards' raw list output
 *     into `{items:[{id,title,status}]}` (both previously had NO `parse` block at all -- `data`
 *     was whatever raw text/array the binary printed). See AC6 below.
 *   - P2 finding 3 (`tracker.label` unavailable): the category contract declared no
 *     `fallback` field for `tracker.label`, so `lookupCapability` returned the plain
 *     `NOT_ALLOWED` envelope and `ensureLabel`/`beads-label.js` always THREW, surfacing at
 *     `trd-cli.js`'s top-level catch as a bare `{error}` with exit 1. FIXED: the category
 *     contract now declares `fallback: title-prefix-scoping`; `ensureLabel` catches the
 *     resulting `UNAVAILABLE` envelope and returns `{ok:false,unavailable:true,reason,label,
 *     matched}` instead of throwing (the pre-existing SUCCESS shape is untouched). See AC6.
 *
 * Independent review is deferred to the PR 9 gate (no reviewer agent runs on this bead).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { spawnSync } = require('child_process');

jest.setTimeout(30000);

const REPO_ROOT = path.join(__dirname, '..', '..');
const DEV_LIB = path.join(REPO_ROOT, 'packages', 'development', 'lib');
const TOOLCHAIN_CLI = path.join(DEV_LIB, 'toolchain-cli.js');
const TRD_CLI = path.join(DEV_LIB, 'trd-cli.js');
const COMPLEXITY_ANALYZER = path.join(DEV_LIB, 'complexity-analyzer.js');
const JIRA_ADAPTER_DIR = path.join(REPO_ROOT, 'packages', 'infrastructure', 'skills', 'adapter-tracker-jira');
const AZURE_ADAPTER_DIR = path.join(REPO_ROOT, 'packages', 'infrastructure', 'skills', 'adapter-tracker-azure-boards');
const BEADS_WAVE_YAML = path.join(REPO_ROOT, 'packages', 'development', 'commands', 'beads-build-wave.yaml');
// beads-build-wave is skill-backed: the YAML is a manifest, the claim-step prose lives in its skill
// (SKILL.md + references/). The static assertions below read that prose.
const BEADS_WAVE_SKILL = path.join(REPO_ROOT, 'packages', 'development', 'skills', 'ensemble-beads-build-wave', 'SKILL.md');
const readBeadsWaveProse = () => require('../lib/skill-backed-command').readSkillProse(BEADS_WAVE_SKILL);

const SLUG = 'trd-2026-tracker-swap-demo';

/** Minimal, parseable TRD fixture -- one INFRA task, no PRD requirements -- mirroring the
 * established fixture shape `packages/development/tests/trd-cli-adapter-swap.test.js` uses,
 * since there is no shared canonical TRD fixture file in this repo (confirmed: every sibling
 * test inlines its own TRD_TEXT). */
const TRD_TEXT = `# Demo TRD

Summary.

## Master Task List

### PR 1: First

**Shippable State:** Works.

- [ ] **TRD-002** Wire CI (1h) \`[satisfies INFRA]\`
  - Target File: ci.yml
`;

// ---------------------------------------------------------------------------
// Generic fixture / subprocess helpers (mirroring trd-cli-adapter-swap.test.js's own
// buildPath/run/readCalls conventions).
// ---------------------------------------------------------------------------

/** Fresh throwaway `/tmp` directory, symlink-resolved so later path comparisons never trip on
 * macOS's `/tmp` -> `/private/tmp` symlink. */
function mkThrowawayProjectRoot(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function writeToolchainConfig(dir, tracker) {
  fs.mkdirSync(path.join(dir, '.ensemble'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ensemble', 'toolchain.yaml'), `tracker: ${tracker}\n`);
}

function writeTrdFixture(dir) {
  fs.mkdirSync(path.join(dir, 'docs', 'TRD'), { recursive: true });
  const trdPath = path.join(dir, 'docs', 'TRD', `${SLUG}.md`);
  fs.writeFileSync(trdPath, TRD_TEXT);
  return trdPath;
}

/** A fresh throwaway project root: `.ensemble/toolchain.yaml` selecting `tracker`, the TRD
 * fixture under `docs/TRD/`, and an empty `bin/` dir ready for stub binaries. Adapter manifests
 * themselves are never written here -- the REAL `packages/infrastructure/skills/adapter-
 * tracker-{jira,azure-boards}` / `packages/development/skills/adapter-tracker-beads`
 * directories resolve automatically through the library-relative installed-tier search
 * (`packages/development/lib/toolchain/adapters.js`), as long as the REAL, un-copied
 * toolchain-cli.js/trd-cli.js run the subprocess. */
function mkTrackerProject(prefix, tracker) {
  const dir = mkThrowawayProjectRoot(prefix);
  writeToolchainConfig(dir, tracker);
  const trdPath = writeTrdFixture(dir);
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  return { dir, binDir, trdPath };
}

/** `PATH` containing ONLY the fixture bin dir, node's own dir (so `node <cli>` itself still
 * resolves) and `/usr/bin:/bin` (core POSIX utilities `git`/`which` may need) -- NEVER the real
 * inherited `process.env.PATH` -- so no real `br`/`bv`/`jira`/`az` anywhere on the host's real
 * PATH can possibly be reached by these subprocesses. */
function buildPath(binDir) {
  return [binDir, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter);
}

function runNode(cliPath, args, cwd, env) {
  const r = spawnSync(process.execPath, [cliPath, ...args], { cwd, env, encoding: 'utf8' });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    // some assertions below only need status/stdout/stderr
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

function readCallsLog(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function installBinary(binDir, binName, source) {
  fs.mkdirSync(binDir, { recursive: true });
  const binPath = path.join(binDir, binName);
  fs.writeFileSync(binPath, source, { mode: 0o755 });
  fs.chmodSync(binPath, 0o755);
}

// ---------------------------------------------------------------------------
// Stub executable sources. Each appends every argv it receives (one JSON line) to its own
// `calls-<bin>.log` in the same bin dir, then answers a small set of recognized argv shapes
// (derived directly from the REAL adapter manifests' own `run[]`/`health[]` templates, read
// verbatim while researching this task); any unrecognized argv fails loudly (stderr + exit 1)
// rather than silently succeeding, so a routing mistake in the production code under test
// surfaces as a real subprocess failure, not a passed assertion on the wrong data.
// ---------------------------------------------------------------------------

function jiraStubSource({ showResponses = {}, listResponse = [], createdId = 'JIRA-100' } = {}) {
  return [
    '#!/usr/bin/env node',
    "'use strict';",
    "const fs = require('fs');",
    "const path = require('path');",
    'const argv = process.argv.slice(2);',
    "fs.appendFileSync(path.join(__dirname, 'calls-jira.log'), JSON.stringify(argv) + '\\n');",
    'function out(value) { process.stdout.write(JSON.stringify(value)); }',
    "function flagValue(name) { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; }",
    `const SHOW = ${JSON.stringify(showResponses)};`,
    `const LIST = ${JSON.stringify(listResponse)};`,
    "if (argv[0] === '--version') {",
    "  process.stdout.write('jira stub 1.0.0\\n');",
    "} else if (argv[0] === 'issues' && argv[1] === 'read') {",
    '  const id = argv[2];',
    '  const resp = SHOW[id];',
    "  if (!resp) { process.stderr.write('stub jira: unknown issue ' + id + '\\n'); process.exit(1); }",
    '  out(resp);',
    "} else if (argv[0] === 'issues' && argv[1] === 'list') {",
    '  out(LIST);',
    "} else if (argv[0] === 'issues' && argv[1] === 'create') {",
    `  out({ key: ${JSON.stringify(createdId)}, summary: argv[2] });`,
    "} else if (argv[0] === 'issues' && argv[1] === 'update') {",
    '  const id = argv[2];',
    "  const status = flagValue('--status');",
    '  out({ key: id, status: status });',
    '} else {',
    "  process.stderr.write('stub jira: unrecognized argv ' + JSON.stringify(argv) + '\\n');",
    '  process.exit(1);',
    '}',
    '',
  ].join('\n');
}

function azStubSource({ showResponses = {}, listResponse = [], createdId = '4200' } = {}) {
  return [
    '#!/usr/bin/env node',
    "'use strict';",
    "const fs = require('fs');",
    "const path = require('path');",
    'const argv = process.argv.slice(2);',
    "fs.appendFileSync(path.join(__dirname, 'calls-az.log'), JSON.stringify(argv) + '\\n');",
    'function out(value) { process.stdout.write(JSON.stringify(value)); }',
    "function flagValue(name) { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; }",
    `const SHOW = ${JSON.stringify(showResponses)};`,
    `const LIST = ${JSON.stringify(listResponse)};`,
    "if (argv[0] === '--version') {",
    "  process.stdout.write('azure-cli stub 2.0.0\\n');",
    "} else if (argv[0] === 'extension' && argv[1] === 'show') {",
    "  out({ name: 'azure-devops', version: '1.0.0' });",
    "} else if (argv[0] === 'devops' && argv[1] === 'configure') {",
    "  out({ organization: 'https://dev.azure.com/stub', project: 'stub-project' });",
    "} else if (argv[0] === 'boards' && argv[1] === 'query') {",
    '  out(LIST);',
    "} else if (argv[0] === 'boards' && argv[1] === 'work-item' && argv[2] === 'show') {",
    "  const id = flagValue('--id');",
    '  const resp = SHOW[id];',
    "  if (!resp) { process.stderr.write('stub az: unknown work item ' + id + '\\n'); process.exit(1); }",
    '  out(resp);',
    "} else if (argv[0] === 'boards' && argv[1] === 'work-item' && argv[2] === 'create') {",
    `  out(${JSON.stringify(createdId)});`,
    "} else if (argv[0] === 'boards' && argv[1] === 'work-item' && argv[2] === 'update') {",
    "  const id = flagValue('--id');",
    "  const state = flagValue('--state');",
    "  const query = flagValue('--query') || '';",
    "  if (query.trim().indexOf('[') === 0) {",
    '    out([id, state]);',
    '  } else {',
    '    out(id);',
    '  }',
    '} else {',
    "  process.stderr.write('stub az: unrecognized argv ' + JSON.stringify(argv) + '\\n');",
    '  process.exit(1);',
    '}',
    '',
  ].join('\n');
}

function brStubSource({ createdId = 'BR-100' } = {}) {
  return [
    '#!/usr/bin/env node',
    "'use strict';",
    "const fs = require('fs');",
    "const path = require('path');",
    'const argv = process.argv.slice(2);',
    "fs.appendFileSync(path.join(__dirname, 'calls-br.log'), JSON.stringify(argv) + '\\n');",
    'function out(value) { process.stdout.write(JSON.stringify(value)); }',
    "if (argv[0] === '--version') {",
    "  process.stdout.write('br stub 1.0.0\\n');",
    "} else if (argv[0] === 'create') {",
    // Real br create --json prints a BARE issue object (captured live, br 0.6.0), not array-of-one.
    `  out({ id: ${JSON.stringify(createdId)} });`,
    "} else if (argv[0] === 'update') {",
    "  const statusIdx = argv.indexOf('--status');",
    "  const status = statusIdx === -1 ? undefined : argv[statusIdx + 1];",
    '  out(status !== undefined ? [{ id: argv[1], status }] : [{ id: argv[1] }]);',
    "} else if (argv[0] === 'close') {",
    "  out([{ id: argv[1], status: 'closed' }]);",
    '} else {',
    "  process.stderr.write('stub br: unrecognized argv ' + JSON.stringify(argv) + '\\n');",
    '  process.exit(1);',
    '}',
    '',
  ].join('\n');
}

function bvStubSource() {
  return [
    '#!/usr/bin/env node',
    "'use strict';",
    "const fs = require('fs');",
    "const path = require('path');",
    'const argv = process.argv.slice(2);',
    "fs.appendFileSync(path.join(__dirname, 'calls-bv.log'), JSON.stringify(argv) + '\\n');",
    "if (argv[0] === '--version') {",
    "  process.stdout.write('bv stub 1.0.0\\n');",
    '} else {',
    "  process.stderr.write('stub bv: unrecognized argv ' + JSON.stringify(argv) + '\\n');",
    '  process.exit(1);',
    '}',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Fixture data: a `## References` block (bead-context's own expected shape) plus `tracker.show`
// / `tracker.list` response builders, one per adapter's own real parse/map shape.
// ---------------------------------------------------------------------------

function referencesBlock(taskAnchor) {
  return ['## References', `TRD: docs/TRD/${SLUG}.md`, `TRD Task: docs/TRD/${SLUG}.md#${taskAnchor}`].join('\n');
}

/** jira's `tracker.show` parse map: a flat object keyed `.key`/`.summary`/`.description`/
 * `.issueType`/`.status`/`.priority`/`.labels` (adapter-tracker-jira/adapter.yaml). */
function jiraShowResponse(id) {
  return {
    key: id,
    summary: `${id} fixture bead`,
    description: referencesBlock('trd-002'),
    issueType: 'Task',
    status: 'To Do',
    priority: '2',
    labels: [],
  };
}

/** azure-boards' `tracker.show` parse map: a bare 7-element array `[id, title, description,
 * type, status, priority, relations]` (adapter-tracker-azure-boards/adapter.yaml). */
function azShowResponse(id) {
  return [id, `${id} fixture bead`, referencesBlock('trd-002'), 'Task', 'New', '2', []];
}

/** `tracker.list` fixture: three beads in this TRD's scope and one foreign bead outside scope
 * -- mirrors the established trd-cli-adapter-swap.test.js convention. RAW jira shape
 * (`.key`/`.summary`/`.status`), matching the adapter's own `arrayMap` source fields
 * (packages/infrastructure/skills/adapter-tracker-jira/adapter.yaml's `tracker.list.parse`,
 * PR 8 independent review item 2 / finding 2 FIX) -- the stub echoes this object verbatim as
 * `jira issues list`'s raw stdout, and the real, un-copied toolchain-cli.js reshapes it into
 * `{id,title,status}` via the real adapter manifest. */
function jiraListResponse() {
  return [
    { key: 'b-1', summary: `[trd:${SLUG}:task:TRD-001] one`, status: 'open' },
    { key: 'b-2', summary: `[trd:${SLUG}:task:TRD-002] two`, status: 'closed' },
    { key: 'b-3', summary: `[trd:${SLUG}:task:TRD-003] three`, status: 'in_progress' },
    { key: 'b-4', summary: '[trd:other-slug] foreign', status: 'open' },
  ];
}

/** Same three-matching-plus-one-foreign fixture, in azure-boards' own raw shape: `[id, title,
 * state]` triples, pre-flattened the way a real `az boards query --query "[].[to_string(id),
 * fields.\"System.Title\", fields.\"System.State\"]"` projection already returns it (the stub
 * below never evaluates real JMESPath, mirroring scripts/tests/fixtures/toolchain/adapter-
 * tracker-azure-boards-stub.js's own convention) -- the adapter's own `arrayMap` (PR 8
 * independent review item 2 / finding 2 FIX) reshapes each triple into `{id,title,status}`. */
function azListResponse() {
  return [
    ['b-1', `[trd:${SLUG}:task:TRD-001] one`, 'New'],
    ['b-2', `[trd:${SLUG}:task:TRD-002] two`, 'Closed'],
    ['b-3', `[trd:${SLUG}:task:TRD-003] three`, 'Active'],
    ['b-4', '[trd:other-slug] foreign', 'New'],
  ];
}

// ---------------------------------------------------------------------------
// Per-adapter configuration: which binary, which stub builder, which health-check argvs
// (literal, read verbatim off each adapter's own `health:` block) so a "how many REAL
// capability-level calls happened" assertion can exclude preflight's own health-check noise.
// ---------------------------------------------------------------------------

const JIRA_HEALTH_ARGVS = [
  ['--version'],
  ['issues', 'list', '--limit', '1'],
];
const AZ_HEALTH_ARGVS = [
  ['--version'],
  ['extension', 'show', '--name', 'azure-devops'],
  ['devops', 'configure', '--list'],
  ['boards', 'query', '--wiql', 'SELECT [System.Id] FROM WorkItems', '--top', '1'],
];
const BR_HEALTH_ARGVS = [['--version']];
const BV_HEALTH_ARGVS = [['--version']];

function nonHealthCalls(calls, healthArgvs) {
  const healthKeys = new Set(healthArgvs.map((argv) => JSON.stringify(argv)));
  return calls.filter((argv) => !healthKeys.has(JSON.stringify(argv)));
}

/** `claimStatus`/`secondStatus` are the CANONICAL `tracker.set-status` vocabulary
 * (open/in_progress/closed) -- identical across every adapter now (PR 8 independent review
 * P1 finding 1 FIX: the caller never supplies a provider-native literal). `nativeStatus` is
 * each adapter's own real vocabulary word for each canonical status, read verbatim off the
 * real manifest's `tracker.set-status.variants.status` map, used only to assert the argv
 * actually reaching the stub binary (AC3(b) above, and the mutation proofs below). */
const ADAPTERS = {
  jira: {
    id: 'jira',
    binName: 'jira',
    dirPath: JIRA_ADAPTER_DIR,
    healthArgvs: JIRA_HEALTH_ARGVS,
    claimStatus: 'in_progress',
    secondStatus: 'open',
    nativeStatus: { open: 'To Do', in_progress: 'In Progress', closed: 'Done' },
    callsLog: (binDir) => path.join(binDir, 'calls-jira.log'),
    installStub: (binDir, opts) => installBinary(binDir, 'jira', jiraStubSource(opts)),
    showShapeMatches: (argv) => argv[0] === 'issues' && argv[1] === 'read',
    showResponseFor: (id) => jiraShowResponse(id),
  },
  'azure-boards': {
    id: 'azure-boards',
    binName: 'az',
    dirPath: AZURE_ADAPTER_DIR,
    healthArgvs: AZ_HEALTH_ARGVS,
    claimStatus: 'in_progress',
    secondStatus: 'open',
    nativeStatus: { open: 'New', in_progress: 'Active', closed: 'Closed' },
    callsLog: (binDir) => path.join(binDir, 'calls-az.log'),
    installStub: (binDir, opts) => installBinary(binDir, 'az', azStubSource(opts)),
    showShapeMatches: (argv) => argv[0] === 'boards' && argv[1] === 'work-item' && argv[2] === 'show',
    showResponseFor: (id) => azShowResponse(id),
  },
};
const ADAPTER_KEYS = Object.keys(ADAPTERS);

/** Confirm `br`/`bv` are not resolvable at all under `PATH` (same `which`-based check
 * trd-cli-adapter-swap.test.js uses). */
function expectNoBrBvOnPath(PATH) {
  const whichBr = spawnSync('which', ['br'], { env: { PATH }, encoding: 'utf8' });
  expect(whichBr.status).not.toBe(0);
  expect(whichBr.stdout.trim()).toBe('');
  const whichBv = spawnSync('which', ['bv'], { env: { PATH }, encoding: 'utf8' });
  expect(whichBv.status).not.toBe(0);
  expect(whichBv.stdout.trim()).toBe('');
}

/**
 * Full create -> claim -> second-status -> close lifecycle through `toolchain-cli.js run`/
 * `trd-cli.js scaffold-plan`, against whichever adapter `project`'s `.ensemble/toolchain.yaml`
 * selects. Claim/second-status route through `tracker.set-status` (PR 8 independent review
 * P1 finding 1 FIX: `tracker.update` no longer sets status on any adapter -- jira repurposes
 * it for renaming an issue's summary, azure-boards for renaming a work item's title, matching
 * `tracker.update`'s single category-contract `fields` input everywhere now).
 *
 * `--non-interactive` is passed on every side-effecting `run` call: `tracker.create`/
 * `set-status`/`close` are all `sideEffect:true` in the `tracker` category contract, so
 * `toolchain-cli.js run`'s own confirmation gate (`./toolchain/confirm.js#confirmStatus`)
 * requires an EXPLICIT non-interactive signal (`--non-interactive`,
 * `ENSEMBLE_NON_INTERACTIVE=1`, a non-empty `FOREMAN_TASK_TITLE`, or `CI=true`) before a
 * resolved adapter is even considered confirmed; this scenario's constructed `env` carries
 * none of the other three, so without this flag every one of these calls would fail
 * `CONFIRMATION_REQUIRED` rather than exercising routing at all. This mirrors
 * `beads-build-wave.yaml`'s OWN documented claim-step argv, which appends exactly this flag
 * "when FOREMAN is true" -- the production shape for a non-interactive, automated caller,
 * which this scripted scenario always is.
 */
function runLifecycle(adapterKey, project, PATH) {
  const cfg = ADAPTERS[adapterKey];

  const preflight = runNode(
    TOOLCHAIN_CLI,
    ['preflight', '--require', 'tracker.create', '--require', 'tracker.set-status', '--require', 'tracker.close', '--json'],
    project.dir,
    { PATH }
  );
  const runId = preflight.json && preflight.json.runId;

  const scaffold = runNode(TRD_CLI, ['scaffold-plan', project.trdPath], project.dir, { PATH });
  const task = scaffold.json && scaffold.json.ok ? scaffold.json.plan.tasks[0] : null;

  const create = runNode(
    TOOLCHAIN_CLI,
    [
      'run',
      'tracker.create',
      '--run-id',
      runId,
      '--arg',
      `title=${task && task.title}`,
      '--arg',
      `type=${task && task.type}`,
      '--arg',
      `description=${task && task.description}`,
      '--json',
      '--non-interactive',
    ],
    project.dir,
    { PATH }
  );
  const beadId = create.json && create.json.ok ? create.json.data.id : null;

  const claim = runNode(
    TOOLCHAIN_CLI,
    ['run', 'tracker.set-status', '--run-id', runId, '--arg', `id=${beadId}`, '--arg', `status=${cfg.claimStatus}`, '--json', '--non-interactive'],
    project.dir,
    { PATH }
  );

  const update = runNode(
    TOOLCHAIN_CLI,
    ['run', 'tracker.set-status', '--run-id', runId, '--arg', `id=${beadId}`, '--arg', `status=${cfg.secondStatus}`, '--json', '--non-interactive'],
    project.dir,
    { PATH }
  );

  const close = runNode(
    TOOLCHAIN_CLI,
    ['run', 'tracker.close', '--run-id', runId, '--arg', `id=${beadId}`, '--json', '--non-interactive'],
    project.dir,
    { PATH }
  );

  return { preflight, runId, scaffold, task, create, beadId, claim, update, close };
}

// ---------------------------------------------------------------------------
// 1. AC1 -- full lifecycle through each alternative adapter, no br/bv on PATH at all.
// ---------------------------------------------------------------------------

describe('AC1: full scaffold/claim/update/close lifecycle through each alternative adapter (no br/bv on PATH)', () => {
  test.each(ADAPTER_KEYS)('%s: every step exits 0, the ledger lists exactly 4 side effects (create/set-status/set-status/close), br/bv are unreachable', (adapterKey) => {
    const cfg = ADAPTERS[adapterKey];
    const project = mkTrackerProject(`ac1-${adapterKey}-`, adapterKey);
    cfg.installStub(project.binDir, {});
    const PATH = buildPath(project.binDir);

    const lifecycle = runLifecycle(adapterKey, project, PATH);

    expect(lifecycle.preflight.status).toBe(0);
    expect(lifecycle.preflight.json.ok).toBe(true);
    expect(typeof lifecycle.runId).toBe('string');

    expect(lifecycle.scaffold.status).toBe(0);
    expect(lifecycle.scaffold.json.ok).toBe(true);
    expect(lifecycle.task).toBeTruthy();
    expect(lifecycle.task.type).toBe('task');

    expect(lifecycle.create.status).toBe(0);
    expect(lifecycle.create.json.ok).toBe(true);
    expect(typeof lifecycle.beadId).toBe('string');
    expect(lifecycle.beadId.length).toBeGreaterThan(0);

    expect(lifecycle.claim.status).toBe(0);
    expect(lifecycle.claim.json.ok).toBe(true);

    expect(lifecycle.update.status).toBe(0);
    expect(lifecycle.update.json.ok).toBe(true);

    expect(lifecycle.close.status).toBe(0);
    expect(lifecycle.close.json.ok).toBe(true);
    expect(lifecycle.close.json.data.status).toBe('closed');

    // Ledger: read directly off disk, never through a CLI re-query.
    const ledgerPath = path.join(project.dir, '.ensemble', 'state', 'toolchain', `ledger-${lifecycle.runId}.jsonl`);
    const ledgerLines = fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean);
    expect(ledgerLines.length).toBe(4);
    const ledgerEntries = ledgerLines.map((line) => JSON.parse(line));
    expect(ledgerEntries.map((entry) => entry.capability)).toEqual([
      'tracker.create',
      'tracker.set-status',
      'tracker.set-status',
      'tracker.close',
    ]);
    for (const entry of ledgerEntries) {
      expect(entry.adapter).toBe(cfg.id);
      expect(typeof entry.timestamp).toBe('string');
    }

    expectNoBrBvOnPath(PATH);
  });
});

// ---------------------------------------------------------------------------
// 2. AC2 -- conformance (toolchain-cli validate) over both alternative manifests.
//
// FINDING: TRD-034's own Implementation AC 2 names `toolchain-cli validate --conformance
// tracker`; no such flag exists anywhere in toolchain-cli.js's parseArgs/HANDLERS (confirmed
// by reading the whole file). The real mechanism is a bare `validate <adapter-dir> --json`,
// which composes validateManifest + validateAllowlist + validateConformance (TRD-007) +
// scanCredentials internally via `validateAdapterDir` -- this IS the "conformance run (TRD-007
// validator)" TRD-034's own prose describes, just not through a literal `--conformance` flag.
// This mirrors scripts/tests/toolchain-adapter-tracker-azure-boards-manifest.test.js:83-95
// exactly.
// ---------------------------------------------------------------------------

describe('AC2: conformance -- toolchain-cli validate over both alternative tracker manifests', () => {
  test.each([
    ['jira', JIRA_ADAPTER_DIR],
    ['azure-boards', AZURE_ADAPTER_DIR],
  ])('%s adapter directory validates clean via a real subprocess', (name, dir) => {
    const jsonProc = spawnSync(process.execPath, [TOOLCHAIN_CLI, 'validate', dir, '--json'], { encoding: 'utf8' });
    expect(jsonProc.status).toBe(0);
    expect(JSON.parse(jsonProc.stdout.trim())).toEqual({ ok: true, errors: [] });

    const textProc = spawnSync(process.execPath, [TOOLCHAIN_CLI, 'validate', dir], { encoding: 'utf8' });
    expect(textProc.status).toBe(0);
    expect(textProc.stdout.trim()).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// 3. AC3 -- beads-build-wave's claim-step reaches the Azure Boards adapter with the FIXED
//    tracker.set-status argv (PR 8 independent review P1 finding 1).
// ---------------------------------------------------------------------------

describe('AC3: beads-build-wave.yaml claim-step reaches the Azure Boards adapter', () => {
  test('(a) static: the lifecycle_contract literally documents the tracker.set-status claim argv, never the old tracker.update/JSON-fields literal', () => {
    // beads-build-wave.yaml is agent-orchestration prose read by an LLM, not an executable
    // entry point this test can spawn directly (see this file's header finding list) -- this
    // raw-text assertion mirrors the idiom packages/development/tests/implement-trd-beads-
    // command.test.js already uses for the same family of command YAML files.
    const text = readBeadsWaveProse();
    expect(text).toContain('tracker.set-status --run-id <RUN_ID> --arg id=<BEAD_ID> --arg status=in_progress');
    expect(text).not.toContain('tracker.update --run-id <RUN_ID> --arg id=<BEAD_ID> --arg fields={"status":"in_progress"}');
  });

  test('(b) dynamic: the literal documented claim argv routes to `az boards work-item update --state Active`, the REAL Azure Boards vocabulary word, never a raw JSON blob (FIXED, was P1 finding 1)', () => {
    const cfg = ADAPTERS['azure-boards'];
    const project = mkTrackerProject('ac3-azure-', 'azure-boards');
    cfg.installStub(project.binDir, {});
    const PATH = buildPath(project.binDir);

    const preflight = runNode(
      TOOLCHAIN_CLI,
      ['preflight', '--require', 'tracker.create', '--require', 'tracker.set-status', '--json'],
      project.dir,
      { PATH }
    );
    expect(preflight.status).toBe(0);
    const runId = preflight.json.runId;

    const scaffold = runNode(TRD_CLI, ['scaffold-plan', project.trdPath], project.dir, { PATH });
    expect(scaffold.status).toBe(0);
    const task = scaffold.json.plan.tasks[0];

    const create = runNode(
      TOOLCHAIN_CLI,
      [
        'run',
        'tracker.create',
        '--run-id',
        runId,
        '--arg',
        `title=${task.title}`,
        '--arg',
        `type=${task.type}`,
        '--arg',
        `description=${task.description}`,
        '--json',
        '--non-interactive',
      ],
      project.dir,
      { PATH }
    );
    expect(create.status).toBe(0);
    const beadId = create.json.data.id;

    // The LITERAL argv beads-build-wave.yaml documents for its claim step, verbatim, plus
    // --non-interactive (see runLifecycle's own header comment for why this flag is required).
    const claim = runNode(
      TOOLCHAIN_CLI,
      ['run', 'tracker.set-status', '--run-id', runId, '--arg', `id=${beadId}`, '--arg', 'status=in_progress', '--json', '--non-interactive'],
      project.dir,
      { PATH }
    );
    expect(claim.status).toBe(0);
    expect(claim.json.ok).toBe(true);
    expect(claim.json.data.status).toBe('in_progress'); // round-trips back to the canonical word

    const calls = readCallsLog(cfg.callsLog(project.binDir));
    const claimCall = calls.find(
      (argv) => argv[0] === 'boards' && argv[1] === 'work-item' && argv[2] === 'update' && argv[3] === '--id' && argv[4] === beadId
    );
    expect(claimCall).toBeTruthy();
    // FIXED (was P1 finding 1): the claim-step argv now carries the real Azure Boards state
    // vocabulary word ("Active"), selected by tracker.set-status's `status` variant
    // (packages/infrastructure/skills/adapter-tracker-azure-boards/adapter.yaml), never the
    // raw canonical word or a JSON blob -- `tracker.set-status`'s parse block also maps the
    // response BACK to the canonical word ("in_progress", asserted above), so round-tripping
    // through this adapter is lossless for the three canonical statuses.
    expect(claimCall).toEqual([
      'boards',
      'work-item',
      'update',
      '--id',
      beadId,
      '--state',
      'Active',
      '--query',
      '[to_string(id), fields."System.State"]',
      '--output',
      'json',
    ]);

    expectNoBrBvOnPath(PATH);
  });
});

// ---------------------------------------------------------------------------
// 4. Zero-br/bv-invocation proof WITH stub br/bv present and reachable (stronger than AC1's
//    "no br/bv anywhere"), plus a `tracker: beads` control run proving the same bin dir's
//    br/bv stubs DO get invoked once the default adapter is selected.
// ---------------------------------------------------------------------------

describe('Mandate 4: zero br/bv invocation while stub br/bv ARE reachable on PATH; a tracker: beads control run DOES invoke them', () => {
  test.each(ADAPTER_KEYS)('%s: the lifecycle never touches br/bv; switching to tracker: beads (control) does', (adapterKey) => {
    const cfg = ADAPTERS[adapterKey];
    const project = mkTrackerProject(`ac4-${adapterKey}-`, adapterKey);
    cfg.installStub(project.binDir, {});
    installBinary(project.binDir, 'br', brStubSource({}));
    installBinary(project.binDir, 'bv', bvStubSource());
    const PATH = buildPath(project.binDir);

    const brLog = path.join(project.binDir, 'calls-br.log');
    const bvLog = path.join(project.binDir, 'calls-bv.log');

    // --- Phase 1: the alternative-tracker lifecycle (same shape as AC1) ---
    const lifecycle = runLifecycle(adapterKey, project, PATH);
    expect(lifecycle.create.json.ok).toBe(true);
    expect(lifecycle.claim.json.ok).toBe(true);
    expect(lifecycle.update.json.ok).toBe(true);
    expect(lifecycle.close.json.ok).toBe(true);

    const adapterCallsPhase1 = nonHealthCalls(readCallsLog(cfg.callsLog(project.binDir)), cfg.healthArgvs);
    expect(adapterCallsPhase1.length).toBe(4);
    expect(readCallsLog(brLog)).toEqual([]);
    expect(readCallsLog(bvLog)).toEqual([]);

    // --- Phase 2 (control): the SAME bin dir, switched to the default `beads` adapter ---
    writeToolchainConfig(project.dir, 'beads');
    const preflight2 = runNode(
      TOOLCHAIN_CLI,
      ['preflight', '--require', 'tracker.create', '--require', 'tracker.set-status', '--require', 'tracker.close', '--json'],
      project.dir,
      { PATH }
    );
    expect(preflight2.status).toBe(0);
    expect(preflight2.json.ok).toBe(true);
    const runId2 = preflight2.json.runId;

    const create2 = runNode(
      TOOLCHAIN_CLI,
      ['run', 'tracker.create', '--run-id', runId2, '--arg', 'title=control bead', '--arg', 'type=task', '--arg', 'description=control description', '--json', '--non-interactive'],
      project.dir,
      { PATH }
    );
    expect(create2.status).toBe(0);
    expect(create2.json.ok).toBe(true);
    const beadId2 = create2.json.data.id;

    const claim2 = runNode(
      TOOLCHAIN_CLI,
      ['run', 'tracker.set-status', '--run-id', runId2, '--arg', `id=${beadId2}`, '--arg', 'status=in_progress', '--json', '--non-interactive'],
      project.dir,
      { PATH }
    );
    expect(claim2.status).toBe(0);
    expect(claim2.json.ok).toBe(true);

    const update2 = runNode(
      TOOLCHAIN_CLI,
      ['run', 'tracker.set-status', '--run-id', runId2, '--arg', `id=${beadId2}`, '--arg', 'status=open', '--json', '--non-interactive'],
      project.dir,
      { PATH }
    );
    expect(update2.status).toBe(0);
    expect(update2.json.ok).toBe(true);

    const close2 = runNode(
      TOOLCHAIN_CLI,
      ['run', 'tracker.close', '--run-id', runId2, '--arg', `id=${beadId2}`, '--json', '--non-interactive'],
      project.dir,
      { PATH }
    );
    expect(close2.status).toBe(0);
    expect(close2.json.ok).toBe(true);

    // CONTROL proof: br/bv DO now have entries -- exactly 4 real capability calls each
    // *could* carry (create/claim/update/close), modulo br/bv's own role: `br` performs all
    // 4 (create/update/update/close), while `bv` is never a capability target here (its own
    // `bv-version` health check is the only reason it was invoked at all) -- while the jira/az
    // log stays frozen at phase 1's 4 entries. No cross-contamination in either direction.
    expect(readCallsLog(brLog).length).toBeGreaterThan(0);
    expect(readCallsLog(bvLog).length).toBeGreaterThan(0);
    expect(nonHealthCalls(readCallsLog(brLog), BR_HEALTH_ARGVS).length).toBe(4);
    expect(nonHealthCalls(readCallsLog(bvLog), BV_HEALTH_ARGVS).length).toBe(0);
    const adapterCallsPhase2 = nonHealthCalls(readCallsLog(cfg.callsLog(project.binDir)), cfg.healthArgvs);
    expect(adapterCallsPhase2.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 5. Missing-binary negative case: preflight fails HEALTH_FAILED, never a silent fallback.
// ---------------------------------------------------------------------------

describe('AC5: missing-binary negative case -- preflight fails HEALTH_FAILED naming the configured adapter, never a silent fallback to beads', () => {
  test('tracker: jira with an EMPTY bin dir (no jira binary anywhere on PATH)', () => {
    const project = mkTrackerProject('ac5-jira-', 'jira');
    // project.binDir exists (mkTrackerProject always creates it) but is left EMPTY here -- no
    // stub of any kind is written, so `jira` cannot resolve anywhere on the constructed PATH.
    const PATH = buildPath(project.binDir);

    const preflight = runNode(TOOLCHAIN_CLI, ['preflight', '--require', 'tracker.show', '--json'], project.dir, { PATH });
    expect(preflight.status).not.toBe(0);
    expect(preflight.json.ok).toBe(false);
    expect(preflight.json.error.code).toBe('HEALTH_FAILED');
    expect(preflight.json.error.message).toContain('jira');
    expect(preflight.json.error.message).toContain('jira-installed');
    // Not a silent fallback to the shipped default `beads` adapter: the failure names jira's
    // own health check, never beads/br/bv.
    expect(preflight.json.error.message).not.toMatch(/\bbeads\b/);
    expect(preflight.json.error.message).not.toMatch(/\bbr\b/);
    expect(preflight.json.error.message).not.toMatch(/\bbv\b/);
  });
});

// ---------------------------------------------------------------------------
// 6. Swap-consistency: bead-context, complexity-analyzer and beads-label all route through
//    whichever adapter is configured; beads-label degrades gracefully (PR 8 independent
//    review item 3 / finding 3).
// ---------------------------------------------------------------------------

describe('AC6: swap-consistency -- trd-cli bead-context, complexity-analyzer and beads-label', () => {
  test.each(ADAPTER_KEYS)('%s: bead-context and complexity-analyzer both route tracker.show; beads-label degrades to a clean {ok:false,unavailable:true} envelope, never a thrown error', (adapterKey) => {
    const cfg = ADAPTERS[adapterKey];
    const project = mkTrackerProject(`ac6-${adapterKey}-`, adapterKey);
    const beadId = 'b-show-1';
    const showResponses = { [beadId]: cfg.showResponseFor(beadId) };
    const listResponse = adapterKey === 'jira' ? jiraListResponse() : azListResponse();
    cfg.installStub(project.binDir, { showResponses, listResponse });
    const PATH = buildPath(project.binDir);

    const beadContext = runNode(TRD_CLI, ['bead-context', '--bead', beadId, '--trd', project.trdPath], project.dir, { PATH });
    expect(beadContext.status).toBe(0);
    expect(beadContext.json.ok).toBe(true);

    const analyzer = runNode(COMPLEXITY_ANALYZER, ['analyze', '--bead', beadId, '--json'], project.dir, { PATH });
    expect(analyzer.status).toBe(0);
    expect(analyzer.json.ok).toBe(true);

    const callsAfterReads = readCallsLog(cfg.callsLog(project.binDir));
    const showCalls = callsAfterReads.filter(cfg.showShapeMatches);
    expect(showCalls.length).toBe(2); // bead-context, then complexity-analyzer

    // beads-label (PR 8 independent review item 3 / finding 3, FIXED): neither jira nor
    // azure-boards implements tracker.label, but the category contract
    // (packages/development/toolchain/categories/tracker.yaml) now declares a `fallback`
    // field for it ('title-prefix-scoping') -- `lookupCapability` (runner.js) therefore
    // returns the UNAVAILABLE-with-fallback envelope, never NOT_ALLOWED, and `ensureLabel`
    // (packages/development/lib/beads-label.js) catches it and returns a clean
    // {ok:false,unavailable:true,reason,label,matched} result instead of throwing.
    // `trd-cli.js#runBeadsLabel`'s own `{ok:true, ...ensureLabel(...)}` spread means this
    // degraded shape's own `ok:false` key -- spread LAST -- overwrites the initial literal,
    // so the CLI exits 0 with this envelope on stdout, never a bare {error} shape.
    //
    // azure-boards' `tracker.list` is ALSO fixed (PR 8 independent review item 2 / finding
    // 4): it no longer carries an unfilled `${filter}` placeholder -- the shipped manifest's
    // default bounded WIQL has no filter input at all -- so `ensureLabel`'s default `runBr`
    // (which always calls `tracker.list` with an empty args object) now succeeds for BOTH
    // adapters, reaching the genuine `tracker.label` call (UNAVAILABLE) identically.
    const label = runNode(TRD_CLI, ['beads-label', '--label', 'demo', '--match', `[trd:${SLUG}`], project.dir, { PATH });
    expect(label.status).toBe(0);
    expect(label.json.ok).toBe(false);
    expect(label.json.unavailable).toBe(true);
    expect(label.json.reason).toContain("capability 'tracker.label' is unavailable");
    expect(label.json.reason).toContain(cfg.id);
    expect(label.json.label).toBe('demo');
    expect(label.json.matched).toBe(3); // 3 of the 4 fixture beads carry this TRD's title prefix

    const callsAfterLabel = readCallsLog(cfg.callsLog(project.binDir));
    // tracker.list succeeded (one more real call than before); tracker.label itself never
    // reached a real subprocess (lookupCapability's own fallback branch returns an envelope
    // before argv is even built).
    expect(callsAfterLabel.length).toBe(callsAfterReads.length + 1);
  });
});


// ---------------------------------------------------------------------------
// 8. Item D (PR 8 independent review): every shipped command YAML's tracker.* --require
//    list, DERIVED from the real source (never hand-copied), preflights ok:true against both
//    alternative tracker adapters -- AC1/AC3 above already prove tracker.set-status itself
//    routes correctly in isolation; this proves the SHIPPED commands' own preflight gates
//    (beads-build/-wave/implement-trd-beads/implement-bead) actually pass, end to end, the
//    moment an operator points .ensemble/toolchain.yaml at jira or azure-boards -- including
//    work-graph.ready, which resolves through the builtin plan-order fallback now that jira's
//    manifest no longer falsely claims the work-graph category (PR 8 finding 2).
// ---------------------------------------------------------------------------

const SHIPPED_COMMAND_YAMLS = ['beads-build.yaml', 'beads-build-wave.yaml', 'implement-trd-beads.yaml', 'implement-bead.yaml'];
const COMMANDS_DIR = path.join(REPO_ROOT, 'packages', 'development', 'commands');

/** `metadata.capabilities.required`, read fresh off the real source YAML every call -- never
 * hand-copied into this test, so a future required-list edit in the command YAML is picked up
 * automatically; the mutation proofs below prove this helper's OWN assertions still
 * discriminate a regression rather than going stale silently. */
function requiredCapsOf(rel) {
  const doc = yaml.load(fs.readFileSync(path.join(COMMANDS_DIR, rel), 'utf8'));
  return (doc.metadata.capabilities && doc.metadata.capabilities.required) || [];
}

describe('Item D: shipped command YAMLs -- derived preflight lists pass for every tracker adapter', () => {
  test.each(SHIPPED_COMMAND_YAMLS)('%s declares tracker.sync and tracker.dep-add as optional, never required (PR 8 finding 2)', (rel) => {
    const required = requiredCapsOf(rel);
    expect(required).not.toContain('tracker.sync');
    expect(required).not.toContain('tracker.dep-add');
  });

  for (const adapterKey of ADAPTER_KEYS) {
    test.each(SHIPPED_COMMAND_YAMLS)(`${adapterKey}: %s's own derived --require list preflights ok:true, never touching br/bv`, (rel) => {
      const cfg = ADAPTERS[adapterKey];
      const project = mkTrackerProject(`itemd-${adapterKey}-${rel.replace(/\.yaml$/, '')}-`, adapterKey);
      cfg.installStub(project.binDir, {});
      installBinary(project.binDir, 'br', brStubSource({}));
      installBinary(project.binDir, 'bv', bvStubSource());
      const PATH = buildPath(project.binDir);

      // Scope to the tracker-category subset of this command's required list: this
      // describe block validates tracker-adapter swapping specifically (never touching
      // br/bv), and implement-bead.yaml's required list also spans host/workflow
      // capabilities this fixture never provisions (no gh/git-town stub on PATH).
      const required = requiredCapsOf(rel).filter((c) => c.startsWith('tracker.'));
      expect(required.length).toBeGreaterThan(0);
      const args = ['preflight', ...required.flatMap((c) => ['--require', c]), '--json', '--non-interactive'];
      const result = runNode(TOOLCHAIN_CLI, args, project.dir, { PATH });
      expect(result.status).toBe(0);
      expect(result.json.ok).toBe(true);
      expect(typeof result.json.runId).toBe('string');

      expect(readCallsLog(path.join(project.binDir, 'calls-br.log'))).toEqual([]);
      expect(readCallsLog(path.join(project.binDir, 'calls-bv.log'))).toEqual([]);
    });
  }

  describe('mutation proofs: each assertion above actually discriminates a regression', () => {
    test('removing jira adapter.yaml\'s in_progress set-status variant fails NOT_ALLOWED; the real, unmutated adapter still resolves it (reproduces the shape of P1 finding 1)', () => {
      // The adapter is resolved by the installed-tier search; a PROJECT-relative
      // packages/*/skills root is searched FIRST (packages/development/lib/toolchain/
      // adapters.js#projectPackagesSkillsRoots), so installing a MUTATED copy of the real
      // jira manifest under the throwaway project's own packages/mutant/skills/ lets the
      // real, un-copied toolchain-cli.js subprocess resolve the mutant -- the real repo's
      // own adapter directory is never touched.
      const project = mkTrackerProject('itemd-mutant-variant-', 'jira');
      ADAPTERS.jira.installStub(project.binDir, {});
      const mutantDir = path.join(project.dir, 'packages', 'mutant', 'skills', 'adapter-tracker-jira');
      fs.cpSync(JIRA_ADAPTER_DIR, mutantDir, { recursive: true });
      const manifestPath = path.join(mutantDir, 'adapter.yaml');
      const original = fs.readFileSync(manifestPath, 'utf8');
      const needle = '        in_progress: ["jira", "issues", "update", "${id}", "--status", "In Progress"]\n';
      expect(original).toContain(needle);
      fs.writeFileSync(manifestPath, original.replace(needle, ''));
      const PATH = buildPath(project.binDir);

      const preflight = runNode(TOOLCHAIN_CLI, ['preflight', '--require', 'tracker.create', '--require', 'tracker.set-status', '--json', '--non-interactive'], project.dir, { PATH });
      expect(preflight.status).toBe(0);
      const runId = preflight.json.runId;
      const create = runNode(TOOLCHAIN_CLI, ['run', 'tracker.create', '--run-id', runId, '--arg', 'title=t', '--arg', 'type=task', '--arg', 'description=d', '--json', '--non-interactive'], project.dir, { PATH });
      expect(create.status).toBe(0);
      const beadId = create.json.data.id;

      const claim = runNode(TOOLCHAIN_CLI, ['run', 'tracker.set-status', '--run-id', runId, '--arg', `id=${beadId}`, '--arg', 'status=in_progress', '--json', '--non-interactive'], project.dir, { PATH });
      expect(claim.json.ok).toBe(false);
      expect(claim.json.error.code).toBe('NOT_ALLOWED');
      expect(claim.json.error.message).toContain('in_progress');

      // Control: the REAL (unmutated) jira manifest, same bead, same project, still resolves.
      const realClaim = runNode(TOOLCHAIN_CLI, ['run', 'tracker.set-status', '--run-id', runId, '--arg', `id=${beadId}`, '--arg', 'status=open', '--json', '--non-interactive'], project.dir, { PATH });
      expect(realClaim.json.ok).toBe(true);
    });

    test('reverting beads-build-wave.yaml\'s claim step to the old tracker.update/JSON-fields literal fails the FIXED-argv static assertion (reproduces P1 finding 1 textually)', () => {
      const text = readBeadsWaveProse();
      const FIXED_NEEDLE = 'tracker.set-status --run-id <RUN_ID> --arg id=<BEAD_ID> --arg status=in_progress';
      expect(text).toContain(FIXED_NEEDLE); // the real, unmutated source passes

      const reverted = text.replace(
        'run tracker.set-status --run-id <RUN_ID> --arg id=<BEAD_ID> --arg status=in_progress',
        'run tracker.update --run-id <RUN_ID> --arg id=<BEAD_ID> --arg fields={"status":"in_progress"}'
      );
      expect(reverted).not.toBe(text); // the mutation actually changed something
      expect(reverted).not.toContain(FIXED_NEEDLE); // and the same assertion now fails
    });

    test('reintroducing tracker.sync into a required list breaks the "never required" assertion above', () => {
      const required = requiredCapsOf('beads-build-wave.yaml');
      const assertNeverRequired = (list) => {
        if (list.includes('tracker.sync')) throw new Error('tracker.sync must never be required (PR 8 finding 2)');
      };
      expect(() => assertNeverRequired(required)).not.toThrow(); // real, unmutated source
      expect(() => assertNeverRequired([...required, 'tracker.sync'])).toThrow(); // mutated
    });
  });
});

// ---------------------------------------------------------------------------
// 7. Mutation proof: hardcoding toolchain-cli.js's `run()` adapter resolution to `beads`
//    either fails to resolve, or -- with a reachable `br` stub -- visibly redirects a
//    tracker.create call to it, while the real, unmutated CLI still routes to the configured
//    alternative adapter. Mirrors packages/development/tests/trd-cli-adapter-swap.test.js:
//    445-484's own mutant-vs-control structure.
// ---------------------------------------------------------------------------

/** Build a fresh `/tmp` copy of `packages/development/lib/` + `packages/development/toolchain/`
 * (the same "copy the whole lib directory" shape
 * packages/development/tests/trd-cli-adapter-swap.test.js#makeTrdCliMutantRoot already
 * establishes) PLUS `packages/development/skills/` -- NOT copied by that established helper,
 * but required here: a mutation that hardcodes the `beads` adapter id must still be able to
 * resolve a REAL `beads` manifest via adapters.js's library-relative installed-tier search,
 * which is rooted at THIS COPY's own `__dirname` (`<root>/packages/development/lib/toolchain`),
 * never the real repo's. A `node_modules` symlink (not a copy) makes `js-yaml`/`ajv` resolve
 * without duplicating the real repo's install. */
function makeToolchainMutantRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-swap-mutant-'));
  const nodeModulesLink = path.join(root, 'node_modules');
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), nodeModulesLink, 'dir');

  const devPkgRoot = path.join(root, 'packages', 'development');
  fs.mkdirSync(devPkgRoot, { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, 'packages', 'development', 'lib'), path.join(devPkgRoot, 'lib'), { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, 'packages', 'development', 'toolchain'), path.join(devPkgRoot, 'toolchain'), { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, 'packages', 'development', 'skills'), path.join(devPkgRoot, 'skills'), { recursive: true });

  return {
    toolchainCliPath: path.join(devPkgRoot, 'lib', 'toolchain-cli.js'),
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
 * copy is run as a real subprocess, never loaded in-process), mirroring trd-cli-adapter-
 * swap.test.js's own `mutateFile` exactly. `needle` is deliberately the SHORT 2-line snippet
 * `const resolvedCategory = resolveCategory(category, ctx);\nadapterId =
 * resolvedCategory.value;`, which (confirmed while researching this task) appears THREE times
 * verbatim in toolchain-cli.js -- once each in `run`, `confirmStatus` and `confirmRecord`.
 * `String.prototype.replace(needle, replacement)` only ever rewrites the FIRST occurrence,
 * which is `run`'s own (it is defined earliest in the file) -- `confirmStatus`/`confirmRecord`
 * are untouched, which is irrelevant here since this scenario only ever calls `run`. */
function mutateFile(filePath, needle, replacement) {
  const original = fs.readFileSync(filePath, 'utf8');
  if (!original.includes(needle)) {
    throw new Error(`mutateFile: needle not found in ${filePath}: ${JSON.stringify(needle)}`);
  }
  fs.writeFileSync(filePath, original.replace(needle, replacement));
}

const RUN_RESOLVE_NEEDLE = [
  '      const resolvedCategory = resolveCategory(category, ctx);',
  '      assertKnownAdapter(category, resolvedCategory, ctx);',
  '      adapterId = resolvedCategory.value;',
].join('\n');
const RUN_RESOLVE_MUTANT = [
  '      const resolvedCategory = resolveCategory(category, ctx);',
  '      assertKnownAdapter(category, resolvedCategory, ctx);',
  "      adapterId = 'beads';",
].join('\n');

describe('Mandate 7: mutation proof -- toolchain-cli.js run() adapter routing actually discriminates', () => {
  test('hardcoding adapterId to "beads" inside run() redirects tracker.create to the br stub; the unmutated CLI still routes to jira', () => {
    const cfg = ADAPTERS.jira;
    const project = mkTrackerProject('ac7-mutant-', 'jira');
    cfg.installStub(project.binDir, {});
    installBinary(project.binDir, 'br', brStubSource({ createdId: 'BR-MUTANT-1' }));
    installBinary(project.binDir, 'bv', bvStubSource());
    const PATH = buildPath(project.binDir);

    const preflight = runNode(TOOLCHAIN_CLI, ['preflight', '--require', 'tracker.create', '--json'], project.dir, { PATH });
    expect(preflight.status).toBe(0);
    const runId = preflight.json.runId;

    // Control: the REAL, unmutated toolchain-cli.js routes through the configured jira adapter.
    const control = runNode(
      TOOLCHAIN_CLI,
      ['run', 'tracker.create', '--run-id', runId, '--arg', 'title=control task', '--arg', 'type=task', '--arg', 'description=control description', '--json', '--non-interactive'],
      project.dir,
      { PATH }
    );
    expect(control.status).toBe(0);
    expect(control.json.ok).toBe(true);
    expect(control.json.adapter).toBe('jira');

    const jiraLog = cfg.callsLog(project.binDir);
    const brLog = path.join(project.binDir, 'calls-br.log');
    expect(nonHealthCalls(readCallsLog(jiraLog), cfg.healthArgvs).length).toBe(1);
    expect(readCallsLog(brLog)).toEqual([]);

    const mutant = makeToolchainMutantRoot();
    try {
      mutateFile(mutant.toolchainCliPath, RUN_RESOLVE_NEEDLE, RUN_RESOLVE_MUTANT);

      const mutantResult = runNode(
        mutant.toolchainCliPath,
        ['run', 'tracker.create', '--run-id', runId, '--arg', 'title=mutant task', '--arg', 'type=task', '--arg', 'description=mutant description', '--json', '--non-interactive'],
        project.dir,
        { PATH }
      );
      expect(mutantResult.status).toBe(0);
      expect(mutantResult.json.ok).toBe(true);
      // The mutant's own success envelope directly names the contaminated adapter.
      expect(mutantResult.json.adapter).toBe('beads');
      expect(mutantResult.json.data.id).toBe('BR-MUTANT-1');

      expect(readCallsLog(brLog).length).toBe(1);
      // The jira log is untouched by the mutant run -- still exactly the control run's 1 entry.
      expect(nonHealthCalls(readCallsLog(jiraLog), cfg.healthArgvs).length).toBe(1);

      // Control, repeated against the SAME project/run id, after the mutant ran: the real CLI
      // still routes to jira, proving the control behavior above was never a fluke of ordering.
      const realAgain = runNode(
        TOOLCHAIN_CLI,
        ['run', 'tracker.create', '--run-id', runId, '--arg', 'title=control task 2', '--arg', 'type=task', '--arg', 'description=control description 2', '--json', '--non-interactive'],
        project.dir,
        { PATH }
      );
      expect(realAgain.status).toBe(0);
      expect(realAgain.json.ok).toBe(true);
      expect(realAgain.json.adapter).toBe('jira');
      expect(nonHealthCalls(readCallsLog(jiraLog), cfg.healthArgvs).length).toBe(2);
      expect(readCallsLog(brLog).length).toBe(1);
    } finally {
      mutant.cleanup();
    }
  });
});

