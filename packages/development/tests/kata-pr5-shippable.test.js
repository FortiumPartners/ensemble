'use strict';

/**
 * br-h7nii -- PR 5 boundary ("Neutral prose, documented prerequisites, disclosed coverage"),
 * TRD-2026-6995dc96 PR 5, PRD REQ-011 / REQ-014 / REQ-015.
 *
 * Shippable State, checked end to end against REAL repo files and the REAL CLI:
 *
 *  1. Prose neutrality: the shared TRD-flow prose (implement-trd-tasks command plus the
 *     implement-trd-tasks, reference, beads-build, beads-build-wave, implement-bead and fix-issue
 *     skills) names no tracker binary (br, bv, bd) and no storage path (.beads, beads.jsonl,
 *     issues.jsonl) outside beads-scoped text. A positive control proves the scanner flags an
 *     injected unscoped `br create` line and a storage path.
 *  2. Kata prerequisites: the kata starting-point reference and the implement-trd-tasks skill and
 *     command state kata 0.23.0, `kata init --project <name>`, `.kata.toml`, `tracker: kata` in
 *     .ensemble/toolchain.yaml and the adapter's unbound failMessage verbatim.
 *  3. Coverage disclosure: `generate-contract-docs --check` is drift-free; work-graph.md and
 *     tracker.md carry a native/fallback/unavailable matrix (beads and kata columns, plus the
 *     work-graph-links-fallback column) equal to coverage computed from the adapter manifests;
 *     `toolchain-cli explain --json` shows the resolved work-graph split (kata for a kata project,
 *     the built-in fallback for a tracker-only one); `resolve --json` has no capabilities map.
 *
 * `kata` is a stub on PATH (explain never needs a real kata, so no guard or skip). XDG_CONFIG_HOME
 * is isolated per project. Scratch lives under ~/.omp, never os.tmpdir().
 *
 * RED hooks (mutate COPIES, never shared files):
 *   KATA_PR5_ROOT         a directory laid out like the repo root (docs/toolchain/contracts,
 *                         packages/development/{commands,skills,toolchain}, packages/*\/skills/
 *                         adapter-*) read for prose, docs and `generate-contract-docs --check`.
 *                         Default: the real repo root. Build one with
 *                         `cp -R <repo>/docs <repo>/packages ~/.omp/<dir>/` (then mutate it).
 *   KATA_PR5_ADAPTER_DIR  a mutated COPY of the kata adapter directory, installed as a
 *                         project-local package for the explain leg (as in kata-pr3).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

const { findViolations } = require('../../../scripts/lint-provider-refs');
const { main: docsMain } = require('../../../scripts/generate-contract-docs');
const { classifyCapabilities } = require('../lib/toolchain/coverage');
const {
  writeNoWorkGraphTrackerStub,
  writeStubControl,
} = require('../../../scripts/tests/fixtures/toolchain/work-graph-fallback-tracker-stub');

const CLI = path.join(__dirname, '..', 'lib', 'toolchain-cli.js');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const ROOT = process.env.KATA_PR5_ROOT || REPO_ROOT;
const DEV = path.join(ROOT, 'packages', 'development');
const DOCS = path.join(ROOT, 'docs', 'toolchain', 'contracts');
const SCRATCH = path.join(os.homedir(), '.omp', 'br-h7nii', `pr5-${process.pid}`);
const MUTANT_ADAPTER_DIR = process.env.KATA_PR5_ADAPTER_DIR;

const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const loadYaml = (...p) => yaml.load(read(...p));

// ---- 1. prose neutrality -------------------------------------------------------------------

const PROSE_SKILLS = [
  'ensemble-implement-trd-tasks',
  'implement-trd-tasks-reference',
  'ensemble-beads-build',
  'ensemble-beads-build-wave',
  'ensemble-implement-bead',
  'ensemble-fix-issue',
];
const BEADS_MANIFEST = loadYaml(REPO_ROOT, 'packages', 'development', 'skills', 'adapter-tracker-beads', 'adapter.yaml');
const BINARIES = new Set(['br', 'bv', 'bd']);
const BINARY_SUBS = new Map();
for (const e of BEADS_MANIFEST.allowlist || []) if (BINARIES.has(e.bin)) BINARY_SUBS.set(e.bin, new Set(e.sub || []));
const STORAGE_RES = [/\.beads\b/, /\bbeads\.jsonl\b/, /\bissues\.jsonl\b/];
// Beads-scoped: under a heading containing "beads" (until the next heading of same/higher level),
// or on a line with an explicit marker. Mentioning a beads doc or skill directory does not scope.
const MARKER_RE = /\bbeads backend\b|\bbeads-only\b|\bbeads-scoped\b/i;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.(md|yaml)$/.test(e.name) ? [p] : [];
  });
}

function scan(content) {
  const hits = [];
  const unscoped = [];
  let scopeLevel = null;
  let inFence = false;
  content.split('\n').forEach((line, i) => {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const h = !inFence && /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      if (scopeLevel !== null && h[1].length <= scopeLevel) scopeLevel = null;
      if (scopeLevel === null && /\bbeads\b/i.test(h[2])) scopeLevel = h[1].length;
    }
    if (scopeLevel !== null || MARKER_RE.test(line)) return unscoped.push('');
    unscoped.push(line);
    if (STORAGE_RES.some((re) => re.test(line))) hits.push(`${i + 1} storage-path`);
    for (const [bin, subs] of BINARY_SUBS) {
      const m = new RegExp(`(?:^|[\\s\`;&|(])${bin}\\s+([a-z-]+)`).exec(line);
      if (m && subs.has(m[1])) hits.push(`${i + 1} ${bin} ${m[1]}`);
    }
  });
  for (const v of findViolations(unscoped.join('\n'), BINARIES)) hits.push(`${v.line} ${v.binary}`);
  return [...new Set(hits)];
}

describe('PR 5 boundary: shared prose names no tracker binary or storage path outside beads scope (REQ-011)', () => {
  const files = [path.join(DEV, 'commands', 'implement-trd-tasks.yaml')];
  for (const d of PROSE_SKILLS) files.push(...walk(path.join(DEV, 'skills', d)));

  test('the sweep is non-vacuous: the command and every skill directory contribute files', () => {
    expect(fs.existsSync(files[0])).toBe(true);
    expect(files.length).toBeGreaterThanOrEqual(25);
    for (const d of PROSE_SKILLS) expect(files.some((f) => f.includes(`${path.sep}${d}${path.sep}`))).toBe(true);
  });

  test('positive control: the scanner flags unscoped leaks and spares beads-scoped text', () => {
    expect(scan('Then:\n```bash\nbr create --title x\n```')).not.toEqual([]);
    expect(scan('Read .beads/issues.jsonl to schedule.')).not.toEqual([]);
    expect(scan('- Then br dep add A B to wire it.')).not.toEqual([]);
    expect(scan('## Beads backend\n\nRun `br create --title x`; see .beads/issues.jsonl.\n')).toEqual([]);
    expect(scan('Beads backend only: `br close abc` writes .beads/issues.jsonl.')).toEqual([]);
    expect(scan('Run node "$TOOLCHAIN_CLI" run tracker.create --arg title="x" --json')).toEqual([]);
  });

  test('no file in the prose set leaks a tracker binary or storage path', () => {
    const leaks = {};
    for (const f of files) {
      const hits = scan(fs.readFileSync(f, 'utf8'));
      if (hits.length) leaks[path.relative(ROOT, f)] = hits;
    }
    expect(leaks).toEqual({});
  });
});

// ---- 2. kata prerequisites in the command docs ---------------------------------------------

describe('PR 5 boundary: command docs state the kata prerequisites (REQ-014)', () => {
  const adapter = loadYaml(DEV, 'skills', 'adapter-tracker-kata', 'adapter.yaml');
  const failMessage = adapter.health.find((h) => h.jsonAssert).jsonAssert.failMessage;
  const ref = read(DEV, 'skills', 'implement-trd-tasks-reference', 'reference', 'kata-starting-point.md');
  const skill = read(DEV, 'skills', 'ensemble-implement-trd-tasks', 'SKILL.md');
  const command = read(DEV, 'commands', 'implement-trd-tasks.yaml');

  test('the kata starting-point reference carries every prerequisite and the verbatim failMessage', () => {
    expect(typeof failMessage).toBe('string');
    for (const s of ['0.23.0', 'kata init --project <name>', '.kata.toml', 'tracker: kata', '.ensemble/toolchain.yaml', failMessage]) {
      expect(ref).toContain(s);
    }
    expect(ref).toMatch(/HALT/);
  });

  test('the implement-trd-tasks skill and command point at the prerequisites', () => {
    for (const s of ['0.23.0', '.kata.toml', 'reference/kata-starting-point.md']) expect(skill).toContain(s);
    // The command is skill-backed (its prompt is the skill), so the skill text above is the command doc.
    expect(command).toContain('skill: ensemble-implement-trd-tasks');
  });
});

// ---- 3. coverage disclosure ----------------------------------------------------------------

function parseMatrix(file) {
  const text = fs.readFileSync(file, 'utf8');
  const section = text.slice(text.indexOf('## Shipped backends and coverage'));
  const rows = section
    .split('\n')
    .filter((l) => l.startsWith('|'))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
  const header = rows[0].slice(1);
  const matrix = {};
  header.forEach((b) => (matrix[b] = {}));
  for (const r of rows.slice(2)) header.forEach((b, i) => (matrix[b][r[0].replace(/`/g, '')] = r[i + 1]));
  return matrix;
}

const manifestOf = (id) => {
  const dirs = [path.join(DEV, 'skills'), path.join(ROOT, 'packages', 'infrastructure', 'skills')];
  for (const d of dirs) {
    const p = path.join(d, `adapter-tracker-${id}`, 'adapter.yaml');
    if (fs.existsSync(p)) return loadYaml(p);
  }
  throw new Error(`no manifest for ${id}`);
};

describe('PR 5 boundary: contract docs disclose each backend\'s native and fallback capabilities (REQ-015)', () => {
  test('generate-contract-docs --check is drift-free on the repo', () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    const out = jest.spyOn(console, 'log').mockImplementation(() => {});
    let code;
    try {
      code = docsMain(['--check'], ROOT);
      expect(err.mock.calls.map((c) => c.join(' '))).toEqual([]);
    } finally {
      err.mockRestore();
      out.mockRestore();
    }
    expect(code).toBe(0);
  });

  test('tracker.md and work-graph.md matrices equal coverage computed from the manifests', () => {
    const builtin = loadYaml(DEV, 'toolchain', 'builtin', 'work-graph-links-fallback', 'adapter.yaml');
    const cases = [
      ['tracker', { beads: manifestOf('beads'), kata: manifestOf('kata') }],
      ['work-graph', { beads: manifestOf('beads'), kata: manifestOf('kata'), 'work-graph-links-fallback': builtin }],
    ];
    for (const [category, manifests] of cases) {
      const contract = loadYaml(DEV, 'toolchain', 'categories', `${category}.yaml`);
      const matrix = parseMatrix(path.join(DOCS, `${category}.md`));
      for (const [backend, manifest] of Object.entries(manifests)) {
        expect(matrix[backend]).toBeDefined();
        expect(matrix[backend]).toEqual(classifyCapabilities(contract, manifest));
        // Every capability a manifest declares is disclosed as served (native or fallback), never unavailable.
        for (const id of Object.keys(manifest.capabilities || {}).filter((c) => c in contract.capabilities)) {
          expect(['native', 'fallback']).toContain(matrix[backend][id]);
        }
      }
    }
  });

  test('specific cells: kata is the only backend with tracker.label-one; kata serves all three graph capabilities', () => {
    const tracker = parseMatrix(path.join(DOCS, 'tracker.md'));
    expect(tracker.kata['tracker.label-one']).toBe('native');
    expect(tracker.beads['tracker.label-one']).toBe('unavailable');
    expect(Object.keys(tracker)).toEqual(expect.arrayContaining(['beads', 'kata', 'jira', 'azure-boards']));
    const wg = parseMatrix(path.join(DOCS, 'work-graph.md'));
    for (const c of ['work-graph.ready', 'work-graph.plan', 'work-graph.graph-health']) {
      expect(wg.kata[c]).toBe('native');
      expect(wg['work-graph-links-fallback'][c]).toBe('native');
    }
  });
});

// ---- 3b/3c. explain / resolve through the real CLI -----------------------------------------

function mkProject(label, tracker) {
  const root = path.join(SCRATCH, label);
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(root, '.ensemble'), { recursive: true });
  fs.writeFileSync(path.join(root, '.ensemble', 'toolchain.yaml'), `tracker: ${tracker}\n`);
  fs.writeFileSync(path.join(root, 'bin', 'kata'), "#!/bin/sh\necho 'kata v0.23.0'\n", { mode: 0o755 });
  const xdg = path.join(root, 'xdg');
  fs.mkdirSync(xdg, { recursive: true });
  if (MUTANT_ADAPTER_DIR) {
    const pkg = path.join(root, 'packages', 'mutant');
    fs.mkdirSync(path.join(pkg, 'skills'), { recursive: true });
    fs.cpSync(MUTANT_ADAPTER_DIR, path.join(pkg, 'skills', 'adapter-tracker-kata'), { recursive: true });
    fs.symlinkSync(path.join(__dirname, '..', 'lib'), path.join(pkg, 'lib'));
  }
  return { root, env: { PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`, XDG_CONFIG_HOME: xdg } };
}

function cli(project, sub) {
  const res = spawnSync(process.execPath, [CLI, sub, '--json'], { cwd: project.root, env: project.env, encoding: 'utf8' });
  let parsed;
  try { parsed = JSON.parse(res.stdout); } catch { parsed = { ok: false, unparsable: res.stdout, stderr: res.stderr }; }
  return parsed;
}

function mkJiraLike() {
  const root = path.join(SCRATCH, 'jira-like');
  const binPath = writeNoWorkGraphTrackerStub(path.join(root, 'bin'));
  writeStubControl(path.join(root, 'bin'), [{ id: 'j-1', status: 'open', dependencies: [] }]);
  fs.mkdirSync(path.join(root, '.ensemble'), { recursive: true });
  fs.writeFileSync(path.join(root, '.ensemble', 'toolchain.yaml'), 'tracker: fixture-jira-like\n');
  const skillDir = path.join(root, 'packages', 'fixture-pkg', 'skills', 'fixture-jira-like');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'adapter.yaml'),
    JSON.stringify({
      adapter: 'fixture-jira-like',
      version: '1.0.0',
      categories: ['tracker'],
      contract: { tracker: '1.0' },
      binaries: [binPath],
      allowlist: [{ bin: binPath, sub: ['list', 'show'] }],
      env: [],
      health: [],
      detect: [],
      capabilities: { 'tracker.list': { run: [binPath, 'list'] } },
    })
  );
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# fixture-jira-like\n## Vocabulary\nstub\n');
  return { root, env: { PATH: process.env.PATH } };
}

describe('PR 5 boundary: explain shows the resolved work-graph split; resolve is unchanged (AC-015-1)', () => {
  const GRAPH_CAPS = ['work-graph.ready', 'work-graph.plan', 'work-graph.graph-health'];
  const VALUES = ['native', 'fallback', 'unavailable'];
  let kata;
  let jira;

  beforeAll(() => {
    fs.mkdirSync(SCRATCH, { recursive: true });
    kata = mkProject('kata', 'kata');
    jira = mkJiraLike();
  });
  afterAll(() => fs.rmSync(SCRATCH, { recursive: true, force: true }));

  test('a kata project: explain names kata and maps every work-graph capability', () => {
    const r = cli(kata, 'explain');
    expect(r.ok).toBe(true);
    const row = r.data['work-graph'];
    expect(row.adapter).toBe('kata');
    expect(Object.keys(row.capabilities).sort()).toEqual([...GRAPH_CAPS].sort());
    for (const c of GRAPH_CAPS) expect(VALUES).toContain(row.capabilities[c]);
    const expected = classifyCapabilities(loadYaml(DEV, 'toolchain', 'categories', 'work-graph.yaml'), manifestOf('kata'));
    expect(row.capabilities).toEqual(expected);
  });

  test('a tracker-only project: explain shows the built-in fallback adapter with a map', () => {
    const r = cli(jira, 'explain');
    expect(r.ok).toBe(true);
    const row = r.data['work-graph'];
    expect(row.adapter).toBe('work-graph-links-fallback');
    expect(Object.keys(row.capabilities).sort()).toEqual([...GRAPH_CAPS].sort());
    for (const c of GRAPH_CAPS) expect(VALUES).toContain(row.capabilities[c]);
  });

  test('resolve --json carries no capabilities map on any row', () => {
    for (const project of [kata, jira]) {
      const r = cli(project, 'resolve');
      expect(r.ok).toBe(true);
      expect(r.data['work-graph']).toBeDefined();
      for (const row of Object.values(r.data)) expect(row).not.toHaveProperty('capabilities');
    }
    expect(cli(kata, 'resolve').data['work-graph'].adapter).toBe('kata');
  });
});
