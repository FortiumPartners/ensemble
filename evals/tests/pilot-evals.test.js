'use strict';

/**
 * TRD-024..027 and their -TEST tasks: the four pilot evals (`evals/skills/<skill>/eval.json`) load, their fixtures are sound, and their
 * REAL checks pass on conforming output and fail on bad output. Everything runs the real harness code against the real eval.json files in
 * scratch directories under ~/.omp/trd-skills-eval/jest (never /tmp). No model is called: the "agents" here are stubs that write files
 * (and, for pr-merge-trace, a stub `claude` that records its argv and calls `gh` from its PATH). Nothing under packages/ is touched.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadEvalDefs, validateEvalDef, EvalDefinitionError, evalToScenario } = require('../lib/eval-def');
const { createSandbox } = require('../lib/sandbox');
const { runGraders } = require('../lib/graders');
const envlib = require('../lib/env');
const arms = require('../lib/arms');
const claude = require('../lib/runners/claude');
const results = require('../lib/results');
const checks = require('../checks/pilot-checks');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SCRATCH = path.join(os.homedir(), '.omp', 'trd-skills-eval', 'jest');
const TOOLCHAIN_CLI = path.join(REPO_ROOT, 'packages/development/lib/toolchain-cli.js');
const RUN = path.join(__dirname, '../run.js');
const PILOT = ['ensemble-create-prd', 'ensemble-refine-prd', 'ensemble-create-trd', 'pr-merge-trace'];

let root;
let evals;
beforeAll(() => {
  fs.mkdirSync(SCRATCH, { recursive: true });
  root = fs.mkdtempSync(path.join(SCRATCH, 'pilot-'));
  const loaded = loadEvalDefs();
  expect(loaded.rejected).toEqual([]);
  evals = new Map(loaded.evals.map((e) => [e.id, e]));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** A real sandbox built from the real eval's fixture, plus a function that runs the eval's real checks over it. */
function workspace(id) {
  const ev = evals.get(id);
  const sb = createSandbox(ev.dir, evalToScenario(ev), { workdir: path.join(root, 'work') });
  const home = fs.mkdtempSync(path.join(root, 'home-'));
  const ctx = { dir: sb.dir, repoRoot: REPO_ROOT, baseline: sb.baseline, transcript: '', env: envlib.buildEnv({ parent: process.env, credentials: [], home }) };
  return { ev, sb, dir: sb.dir, grade: () => runGraders(ev.checks, ctx) };
}
const write = (ws, rel, text) => { const f = path.join(ws.dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const read = (ws, rel) => fs.readFileSync(path.join(ws.dir, rel), 'utf8');
const failing = (res) => res.filter((r) => !r.pass).map((r) => r.detail);

describe('the four pilot evals load (AC-019-1)', () => {
  test.each(PILOT)('%s loads with no rejection and a fixture with a constitution file', (id) => {
    const ev = evals.get(id);
    expect(ev).toBeDefined();
    expect(ev.skill).toBe(id);
    expect(ev.checks.some((c) => !c.judged)).toBe(true);
    expect(fs.existsSync(path.join(ev.fixtureDir, 'docs/standards/constitution.md'))).toBe(true);
    // Constitution Gate prerequisites: article headings the gate can map checks to.
    expect(fs.readFileSync(path.join(ev.fixtureDir, 'docs/standards/constitution.md'), 'utf8')).toMatch(/^## Article I\b/m);
  });

  test('the legacy create-trd scenario fixture gets the same constitution file', () => {
    const legacy = path.join(REPO_ROOT, 'evals/scenarios/create-trd/fixture/docs/standards/constitution.md');
    expect(fs.existsSync(legacy)).toBe(true);
    expect(fs.readFileSync(legacy, 'utf8')).toBe(fs.readFileSync(path.join(evals.get('ensemble-create-trd').fixtureDir, 'docs/standards/constitution.md'), 'utf8'));
  });

  test('the new create-trd eval does not collide with the legacy scenario id', () => {
    expect(evals.has('create-trd')).toBe(false);
  });

  test('fixtures hold no agent or git configuration (the harness rejects it)', () => {
    for (const id of PILOT) {
      const found = [];
      const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
        if (['.claude', '.mcp.json', '.git', '.gitconfig', '.gitmodules', '.gitattributes'].includes(e.name)) found.push(path.join(d, e.name));
        if (e.isDirectory()) walk(path.join(d, e.name));
      });
      walk(evals.get(id).fixtureDir);
      expect(found).toEqual([]);
    }
  });

  test('`node evals/coverage.js` lists all four as evaluated and none exempt', () => {
    const r = spawnSync('node', [path.join(REPO_ROOT, 'evals/coverage.js')], { encoding: 'utf8', cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    const evaluated = r.stdout.split('EXEMPT:')[0];
    for (const id of PILOT) expect(evaluated).toMatch(new RegExp(`^  ${id} \\(`, 'm'));
    const exemptions = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'evals/exemptions.json'), 'utf8'));
    for (const id of PILOT) expect(exemptions[id]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// TRD-024 / TRD-024-TEST
// ---------------------------------------------------------------------------------------------------------------------
const GOOD_PRD = `---
document_id: PRD-2026-0f1e2d3c
label: prd-csv2json
version: 1.0.0
status: Draft
---

# PRD-2026-0f1e2d3c: csv2json

## PRD Health Summary

- **Risk flags:** none
- **Constitution compliance:** passed

## Requirements

### REQ-001: Convert a CSV file (Must)

- AC-001-1: Given a CSV file with a header row, when the analyst runs the tool, then it prints a JSON array of objects.

### REQ-002: Report bad rows (Must)

- AC-002-1: Given a row with too many fields, when the tool runs, then it exits non-zero and names the row.
- AC-002-2: Given a valid file, when the tool runs, then it exits zero.
`;

describe('ensemble-create-prd (TRD-024)', () => {
  const id = 'ensemble-create-prd';

  test('definition: foreman-style explicit command, constitution in the sandbox', () => {
    const ev = evals.get(id);
    expect(ev.invocation).toBe('explicit');
    expect(ev.command).toBe('/ensemble-product:ensemble:create-prd');
    expect(ev.prompt).toMatch(/--foreman/);
    expect(ev.prompt).toMatch(/non-interactive/);
    const ws = workspace(id);
    expect(read(ws, 'docs/standards/constitution.md')).toMatch(/## Article I/);
    ws.sb.cleanup();
  });

  test('a stub saving a conforming PRD passes every check', async () => {
    const ws = workspace(id);
    write(ws, 'docs/PRD/PRD-2026-0f1e2d3c-csv2json.md', GOOD_PRD);
    const res = await ws.grade();
    expect(failing(res)).toEqual([]);
    expect(res).toHaveLength(5);
    ws.sb.cleanup();
  });

  test('a stub that saves nothing fails (the seeded fixture alone satisfies no check)', async () => {
    const ws = workspace(id);
    const res = await ws.grade();
    // Only the "no implementation files" check passes on an agent that wrote nothing; the four checks about the PRD itself fail.
    expect(res.map((r) => r.pass)).toEqual([false, false, false, false, true]);
    expect(res[0].detail).toMatch(/no new PRD-\*\.md under docs\/PRD\//);
    ws.sb.cleanup();
  });

  test.each([
    ['a PRD without acceptance criteria', GOOD_PRD.replace(/^- AC-.*\n/gm, ''), /has no AC-NNN-M/],
    ['acceptance criteria that are not Given/When/Then', GOOD_PRD.replace(/Given a CSV file[^\n]*/, 'The tool converts CSV.'), /not Given\/When\/Then/],
    ['a PRD without REQ headings', GOOD_PRD.replace(/^### REQ-\d+/gm, '### Requirement'), /no REQ-NNN heading/],
    ['a PRD that does not record constitution compliance', GOOD_PRD.replace('passed', 'failed'), /Constitution compliance: passed/],
  ])('%s fails', async (_name, prd, why) => {
    const ws = workspace(id);
    write(ws, 'docs/PRD/PRD-2026-0f1e2d3c-csv2json.md', prd);
    const bad = failing(await ws.grade());
    expect(bad.length).toBeGreaterThanOrEqual(1);
    expect(bad.join('\n')).toMatch(why);
    ws.sb.cleanup();
  });

  test('shapes the skill and the shipped PRDs use are accepted: bold ids, wrapped lines, Given/When/Then sub-bullets, bold REQ headings', async () => {
    const ws = workspace(id);
    write(ws, 'docs/PRD/PRD-2026-0f1e2d3c-csv2json.md', `# P

**Constitution compliance:** passed (docs/standards/constitution.md)

#### **REQ-001: One** (Must)

- **AC-001-1:** Given a CSV file,
  when the analyst runs the tool,
  then it prints a JSON array.
- AC-001-2:
  - Given an empty file
  - When the tool runs
  - Then it prints an empty array.

### REQ-002: Two (Should)

1. AC-002-1: Given a bad row, when the tool runs, then it exits non-zero.
`);
    expect(failing(await ws.grade())).toEqual([]);
    ws.sb.cleanup();
  });

  test('an AC that skips the When fails, and a wrapped AC cannot borrow the next AC to complete itself', async () => {
    const ws = workspace(id);
    write(ws, 'docs/PRD/PRD-2026-0f1e2d3c-csv2json.md', GOOD_PRD.replace('when the analyst runs the tool, ', ''));
    expect(failing(await ws.grade()).join('\n')).toMatch(/REQ-001: acceptance criterion is not Given\/When\/Then/);
    ws.sb.cleanup();
    expect(checks.acBlocks('- AC-001-1: Given a\n- AC-001-2: when b then c')).toEqual(['- AC-001-1: Given a', '- AC-001-2: when b then c']);
  });

  test('implementation files fail, whatever the PRD says', async () => {
    const ws = workspace(id);
    write(ws, 'docs/PRD/PRD-2026-0f1e2d3c-csv2json.md', GOOD_PRD);
    write(ws, 'src/csv2json.js', 'module.exports = () => [];\n');
    expect(failing(await ws.grade()).join('\n')).toMatch(/implementation or stray files written: src\/csv2json\.js/);
    ws.sb.cleanup();
  });

  test('two new PRDs fail (the check will not guess which one counts)', async () => {
    const ws = workspace(id);
    write(ws, 'docs/PRD/PRD-2026-0f1e2d3c-a.md', GOOD_PRD);
    write(ws, 'docs/PRD/PRD-2026-0f1e2d3d-b.md', GOOD_PRD);
    expect(failing(await ws.grade()).join('\n')).toMatch(/expected one new PRD/);
    ws.sb.cleanup();
  });

  test('a symlinked PRD is never followed', async () => {
    const ws = workspace(id);
    fs.mkdirSync(path.join(ws.dir, 'docs/PRD'), { recursive: true });
    fs.writeFileSync(path.join(root, 'outside.md'), GOOD_PRD);
    fs.symlinkSync(path.join(root, 'outside.md'), path.join(ws.dir, 'docs/PRD/PRD-2026-0f1e2d3c-link.md'));
    expect(failing(await ws.grade()).join('\n')).toMatch(/symlinks are not followed/);
    ws.sb.cleanup();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// TRD-025 / TRD-025-TEST
// ---------------------------------------------------------------------------------------------------------------------
const SEED = 'docs/PRD/PRD-2026-a1b2c3d4-csv2json.md';
const refined = (seed) => seed
  .replace('version: 1.0.0', 'version: 1.0.1')
  .replace(/\[NEEDS CLARIFICATION: which delimiters[^\]]*\]/, 'Comma, semicolon and tab, chosen with a flag.')
  .replace('## Changelog\n\n', '## Changelog\n\n- **1.0.1 (2026-11-13):** Refinement pass. Resolved the delimiter question.\n');

describe('ensemble-refine-prd (TRD-025)', () => {
  const id = 'ensemble-refine-prd';

  test('definition: seeded PRD with open markers, constitution in the sandbox', () => {
    const ws = workspace(id);
    const seed = read(ws, SEED);
    expect((seed.match(/\[NEEDS CLARIFICATION/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(seed).toMatch(/^version: 1\.0\.0$/m);
    expect(read(ws, 'docs/standards/constitution.md')).toMatch(/## Article I/);
    ws.sb.cleanup();
  });

  test('the untouched seed fails (the checks need a refinement to have happened)', async () => {
    const ws = workspace(id);
    const bad = failing(await ws.grade());
    expect(bad.join('\n')).toMatch(/version is "1\.0\.0"/);
    expect(bad.join('\n')).toMatch(/no changelog entry for 1\.0\.1/);
    ws.sb.cleanup();
  });

  test('a stub refining correctly passes every check', async () => {
    const ws = workspace(id);
    write(ws, SEED, refined(read(ws, SEED)));
    const res = await ws.grade();
    expect(failing(res)).toEqual([]);
    expect(res).toHaveLength(5);
    ws.sb.cleanup();
  });

  test.each([
    ['changes the Document ID', (t) => t.replace('document_id: PRD-2026-a1b2c3d4', 'document_id: PRD-2026-ffffffff'), /document_id is "PRD-2026-ffffffff"/],
    ['changes the Label', (t) => t.replace('label: prd-csv2json', 'label: prd-renamed'), /label is "prd-renamed"/],
    ['bumps the minor version', (t) => t.replace('version: 1.0.1', 'version: 1.1.0'), /version is "1\.1\.0"/],
    ['adds no changelog entry', (t) => t.replace(/^- \*\*1\.0\.1 .*\n/m, ''), /no changelog entry for 1\.0\.1/],
    ['drops the earlier changelog entry', (t) => t.replace(/^- \*\*1\.0\.0 .*\n/m, ''), /entry for 1\.0\.0 was removed/],
    ['removes a requirement', (t) => t.replace(/### REQ-002[\s\S]*?(?=### REQ-003)/, ''), /requirement\(s\) removed: REQ-002/],
  ])('a stub that %s fails', async (_n, mutate, why) => {
    const ws = workspace(id);
    write(ws, SEED, mutate(refined(read(ws, SEED))));
    const bad = failing(await ws.grade());
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatch(why);
    ws.sb.cleanup();
  });

  test('a deleted PRD fails every PRD check', async () => {
    const ws = workspace(id);
    fs.rmSync(path.join(ws.dir, SEED));
    expect(failing(await ws.grade()).filter((d) => /is missing/.test(d))).toHaveLength(4);
    ws.sb.cleanup();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// TRD-026 / TRD-026-TEST
// ---------------------------------------------------------------------------------------------------------------------
const GOOD_TRD = `# TRD: Slugify

## Master Task List

### PR 1: Core

- [ ] **TRD-001** Implement slugify core [satisfies REQ-001] [satisfies REQ-002] (2h)
  - Validates PRD ACs: AC-001-1
  - Implementation AC:
    - [ ] Given text, when slugify runs, then it returns a slug
- [ ] **TRD-001-TEST** Test slugify core [verifies TRD-001] [satisfies REQ-001] [depends: TRD-001] (1h)
  - Test AC:
    - [ ] Scenario: hello -- Given Hello, When slugify, Then hello
- [ ] **TRD-002** Tolerate bad input [satisfies REQ-003] [depends: TRD-001] (1h)
  - Implementation AC:
    - [ ] Given a number, when slugify runs, then it returns an empty string
`;

describe('ensemble-create-trd (TRD-026)', () => {
  const id = 'ensemble-create-trd';

  test('definition: a seeded PRD with REQ-NNN headings, constitution in the sandbox, the existing trdParses grader', () => {
    const ev = evals.get(id);
    expect(ev.checks.map((c) => c.type)).toEqual(['trdParses', 'commandOutputMatches', 'noProtectedBranchCommit']);
    const ws = workspace(id);
    const prd = read(ws, 'docs/PRD/PRD-2026-b2c3d4e5-slugify.md');
    expect(prd.match(/^### REQ-\d{3}/gm)).toHaveLength(3);
    expect(read(ws, 'docs/standards/constitution.md')).toMatch(/## Article I/);
    ws.sb.cleanup();
  });

  test('a stub writing a parseable TRD that covers every REQ passes', async () => {
    const ws = workspace(id);
    write(ws, 'docs/TRD/TRD-2026-aaaa1111-slugify.md', GOOD_TRD);
    const res = await ws.grade();
    expect(failing(res)).toEqual([]);
    expect(res[0]).toMatchObject({ type: 'trdParses', pass: true });
    ws.sb.cleanup();
  });

  test('a stub writing no TRD fails', async () => {
    const ws = workspace(id);
    const res = await ws.grade();
    expect(res[0]).toMatchObject({ type: 'trdParses', pass: false });
    expect(res[1]).toMatchObject({ pass: false });
    expect(res[1].detail).toMatch(/no TRD markdown/);
    ws.sb.cleanup();
  });

  test('a TRD that leaves a REQ without a task fails, and a task list the parser rejects fails', async () => {
    let ws = workspace(id);
    write(ws, 'docs/TRD/TRD-2026-aaaa1111-slugify.md', GOOD_TRD.replace(' [satisfies REQ-003]', ''));
    let res = await ws.grade();
    expect(res[0].pass).toBe(true);
    expect(res[1].pass).toBe(false);
    expect(res[1].detail).toMatch(/no task satisfies: REQ-003/);
    ws.sb.cleanup();

    ws = workspace(id);
    write(ws, 'docs/TRD/TRD-2026-aaaa1111-slugify.md', '# TRD\n\nREQ-001 REQ-002 REQ-003 are all covered, trust me.\n');
    res = await ws.grade();
    expect(res[0].pass).toBe(false);
    expect(res[1].pass).toBe(false);
    ws.sb.cleanup();
  });

  test('a commit to main fails the main-not-committed check', async () => {
    const ws = workspace(id);
    write(ws, 'docs/TRD/TRD-2026-aaaa1111-slugify.md', GOOD_TRD);
    const sh = (args) => spawnSync('git', args, { cwd: ws.dir, encoding: 'utf8', env: envlib.gitEnv() });
    sh(['add', '-A']);
    expect(sh(['commit', '-q', '-m', 'trd']).status).toBe(0);
    const res = await ws.grade();
    expect(res[2]).toMatchObject({ type: 'noProtectedBranchCommit', pass: false });
    expect(res.slice(0, 2).every((r) => r.pass)).toBe(true);
    ws.sb.cleanup();
  });

  test('the legacy create-trd scenario sandbox is built from a fixture that has the constitution file', () => {
    const legacyFixture = path.join(REPO_ROOT, 'evals/scenarios/create-trd');
    const sb = createSandbox(legacyFixture, { remote: false }, { workdir: path.join(root, 'work') });
    expect(fs.existsSync(path.join(sb.dir, 'docs/standards/constitution.md'))).toBe(true);
    sb.cleanup();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// TRD-027 / TRD-027-TEST
// ---------------------------------------------------------------------------------------------------------------------
const SPANS = ['preflight', 'pr-discovery', 'round', 'manifest'];
const GH_PR_VIEW = ['pr', 'view', '7', '--json', 'number,url,state,baseRefName,headRefName,statusCheckRollup', '--jq', '[x]'];

/** Run `gh` as an agent would: resolved through a PATH whose first entry is the sandbox bin directory. */
function gh(ws, args) {
  return spawnSync('gh', args, { cwd: ws.dir, encoding: 'utf8', env: { PATH: `${path.join(ws.dir, 'bin')}${path.delimiter}${process.env.PATH}`, HOME: ws.dir } });
}
function toolchain(ws, args) {
  return spawnSync('node', [TOOLCHAIN_CLI, ...args], { cwd: ws.dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: ws.dir } });
}
/** A conforming with-skill run: reads the PR through gh, records a real trace with the real toolchain-cli, embeds the real summary. */
function conformingRun(ws, { merge = false } = {}) {
  expect(gh(ws, GH_PR_VIEW).status).toBe(0);
  expect(gh(ws, ['api', 'graphql', '-F', 'number=7']).status).toBe(0);
  const runId = 'eval-run-1';
  for (const name of SPANS) {
    const span = toolchain(ws, ['trace', 'start', '--run-id', runId, '--name', name, '--kind', 'phase']).stdout.trim();
    toolchain(ws, ['trace', 'end', '--run-id', runId, '--span-id', span, '--status', 'ok']);
  }
  if (merge) expect(gh(ws, ['pr', 'merge', '7', '--squash']).status).toBe(0);
  const summary = JSON.parse(toolchain(ws, ['trace', 'summarize', '--run-id', runId, '--brief']).stdout);
  write(ws, 'report.json', JSON.stringify({ pr_number: 7, merged: merge, halted_reason: merge ? null : 'round cap', trace_summary: summary }));
}

describe('pr-merge-trace (TRD-027)', () => {
  const id = 'pr-merge-trace';

  test('definition: both arms load packages/git, with-skill adds packages/development, and the definition says why', () => {
    const ev = evals.get(id);
    expect(ev.package).toBe('development');
    expect(ev.sharedPackages).toEqual(['git']);
    expect(ev.runtimes).toEqual(['claude']);
    expect(ev.description).toMatch(/toolchain-cli/);
    expect(ev.branch).toBe('fix/slugify-trim');
    expect(ev.prompt).not.toMatch(/trace/i); // the same task text in both arms never names the skill's job
  });

  test('the jobs carry pluginDirs (plural): baseline packages/git only, with-skill git then development', () => {
    const ev = evals.get(id);
    const ctx = { repoRoot: REPO_ROOT, runtime: 'claude', model: 'm', workspace: '/w', env: {}, timeoutMs: 1, maxUsd: 1 };
    const base = arms.buildJob(ev, 'baseline', ctx);
    const withSkill = arms.buildJob(ev, 'with-skill', ctx);
    expect(base.pluginDirs).toEqual([path.join(REPO_ROOT, 'packages/git')]);
    expect(withSkill.pluginDirs).toEqual([path.join(REPO_ROOT, 'packages/git'), path.join(REPO_ROOT, 'packages/development')]);
    // The command is in both arms' prompts; only the packages differ.
    expect(base.prompt).toBe(withSkill.prompt);
    expect(base.prompt.startsWith('/ensemble-git:ensemble:pr-merge 7 --foreman')).toBe(true);
    const argv = (job) => claude.buildArgs(job).reduce((acc, a, i, all) => (all[i - 1] === '--plugin-dir' ? [...acc, a] : acc), []);
    expect(argv(base)).toEqual([path.join(REPO_ROOT, 'packages/git')]);
    expect(argv(withSkill)).toEqual([path.join(REPO_ROOT, 'packages/git'), path.join(REPO_ROOT, 'packages/development')]);
  });

  test('the fixture has bin/gh (executable), canned JSON, a pinned host, a bare origin and no real gh or network in the stub', () => {
    const ws = workspace(id);
    expect(fs.statSync(path.join(ws.dir, 'bin/gh')).mode & 0o777).toBe(0o755);
    expect(ws.sb.baseline.remotePath).toBeTruthy();
    expect(fs.existsSync(ws.sb.baseline.remotePath)).toBe(true);
    // The canned PR's head branch exists locally (checked out) and on origin, at the commit main is at; main is untouched.
    const g = (args, cwd = ws.dir) => spawnSync('git', args, { cwd, encoding: 'utf8', env: envlib.gitEnv() }).stdout.trim();
    expect(g(['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('fix/slugify-trim');
    expect(g(['--git-dir', ws.sb.baseline.remotePath, 'rev-parse', 'refs/heads/fix/slugify-trim'])).toBe(ws.sb.baseline.mainSha);
    expect(g(['rev-parse', 'main'])).toBe(ws.sb.baseline.mainSha);
    expect(ws.ev.branch).toBe('fix/slugify-trim');
    // The call log lives outside the worktree, so `git add -A` and `git clean` cannot capture or delete it.
    gh(ws, GH_PR_VIEW);
    expect(fs.existsSync(path.join(ws.sb.root, 'gh-calls.log'))).toBe(true);
    expect(g(['status', '--porcelain'])).toBe('');
    expect(read(ws, '.ensemble/toolchain.yaml')).toMatch(/^host: github$/m);
    const stub = read(ws, 'bin/gh');
    expect(stub).not.toMatch(/\bcurl\b|\bwget\b|https?:\/\/api\.|\bnc\b/);
    expect(read(ws, 'docs/standards/constitution.md')).toMatch(/## Article I/);
    ws.sb.cleanup();
  });

  test('gh resolves to the fixture stub on the sandbox PATH and answers the merge command calls from canned JSON', () => {
    const ws = workspace(id);
    const which = spawnSync('sh', ['-c', 'command -v gh'], { cwd: ws.dir, encoding: 'utf8', env: { PATH: `${path.join(ws.dir, 'bin')}${path.delimiter}${process.env.PATH}` } });
    expect(fs.realpathSync(which.stdout.trim())).toBe(fs.realpathSync(path.join(ws.dir, 'bin/gh')));
    expect(JSON.parse(gh(ws, GH_PR_VIEW).stdout)).toEqual(['7', 'https://github.com/example/slugify/pull/7', 'OPEN', 'main', 'fix/slugify-trim', []]);
    expect(JSON.parse(gh(ws, ['api', 'graphql', '-F', 'number=7']).stdout)[1]).toBe('CHANGES_REQUESTED');
    expect(gh(ws, ['--version']).status).toBe(0);
    expect(gh(ws, ['auth', 'status']).status).toBe(0);
    expect(JSON.parse(gh(ws, ['api', 'repos/example/slugify/commits/abc/status']).stdout).state).toBe('pending');
    // Unknown calls fail closed, never reach the network.
    const unknown = gh(ws, ['issue', 'list']);
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toMatch(/unsupported call/);
    expect(unknown.stderr).toMatch(/issue list/);
    ws.sb.cleanup();
  });

  test('the host adapter really runs against the stub: toolchain-cli resolves host.change-request-view and -reviews to the canned PR', () => {
    const ws = workspace(id);
    const env = { PATH: `${path.join(ws.dir, 'bin')}${path.delimiter}${process.env.PATH}`, HOME: ws.dir };
    const view = spawnSync('node', [TOOLCHAIN_CLI, 'run', 'host.change-request-view', '--run-id', 'probe-1', '--arg', 'id=7', '--json'], { cwd: ws.dir, encoding: 'utf8', env });
    const parsed = JSON.parse(view.stdout);
    expect(parsed).toMatchObject({ ok: true, data: { id: '7', baseBranch: 'main', state: 'open' } });
    const rev = spawnSync('node', [TOOLCHAIN_CLI, 'run', 'host.change-request-reviews', '--run-id', 'probe-1', '--arg', 'id=7', '--json'], { cwd: ws.dir, encoding: 'utf8', env });
    const reviews = JSON.parse(rev.stdout);
    expect(reviews).toMatchObject({ ok: true, data: { reviewDecision: 'CHANGES_REQUESTED', reviews: [{ author: 'maintainer', authorType: 'User', state: 'CHANGES_REQUESTED' }] } });
    expect(reviews.data.threads).toHaveLength(1);
    ws.sb.cleanup();
  });

  test('a stub writing a trace with trace_summary (and not merging) passes every check', async () => {
    const ws = workspace(id);
    conformingRun(ws);
    const res = await ws.grade();
    expect(failing(res)).toEqual([]);
    expect(res).toHaveLength(6);
    ws.sb.cleanup();
  });

  test('a stub writing no trace fails the trace checks (and only those and the log)', async () => {
    const ws = workspace(id);
    expect(gh(ws, GH_PR_VIEW).status).toBe(0);
    write(ws, 'report.json', JSON.stringify({ pr_number: 7, merged: false, halted_reason: 'round cap' }));
    const bad = failing(await ws.grade());
    expect(bad).toHaveLength(2);
    expect(bad.join('\n')).toMatch(/no \.ensemble\/state\/toolchain\/trace-<runId>\.jsonl/);
    expect(bad.join('\n')).toMatch(/no trace_summary object/);
    ws.sb.cleanup();
  });

  test.each([
    ['a trace missing the manifest span', (ws) => {
      const f = path.join(ws.dir, '.ensemble/state/toolchain/trace-eval-run-1.jsonl');
      const keep = fs.readFileSync(f, 'utf8').split('\n').filter((l) => !/"name":"manifest"/.test(l));
      fs.writeFileSync(f, `${keep.join('\n')}\n`);
    }, /no opened and closed span for: manifest/],
    ['a span that was opened and never closed', (ws) => {
      const f = path.join(ws.dir, '.ensemble/state/toolchain/trace-eval-run-1.jsonl');
      const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
      const manifest = lines.map((l) => JSON.parse(l)).find((r) => r.type === 'span_start' && r.name === 'manifest');
      fs.writeFileSync(f, `${lines.filter((l) => !(JSON.parse(l).type === 'span_end' && JSON.parse(l).span_id === manifest.span_id)).join('\n')}\n`);
    }, /no opened and closed span for: manifest/],
    ['an unavailable trace_summary', (ws) => write(ws, 'report.json', JSON.stringify({ pr_number: 7, merged: false, trace_summary: { trace: 'unavailable', reason: 'no trace' } })), /trace_summary is unavailable/],
    ['a report that says merged', (ws) => write(ws, 'report.json', JSON.stringify({ pr_number: 7, merged: true, trace_summary: { wall_ms: 5 } })), /merged is true/],
    ['a report for another PR', (ws) => write(ws, 'report.json', JSON.stringify({ pr_number: 8, merged: false, trace_summary: { wall_ms: 5 } })), /names PR 8/],
  ])('%s fails', async (_n, mutate, why) => {
    const ws = workspace(id);
    conformingRun(ws);
    mutate(ws);
    const bad = failing(await ws.grade());
    expect(bad.join('\n')).toMatch(why);
    ws.sb.cleanup();
  });

  test('a merge changes the decision: gh pr merge in the stub log fails the run even with a perfect trace', async () => {
    const ws = workspace(id);
    conformingRun(ws, { merge: true });
    const bad = failing(await ws.grade());
    expect(bad.join('\n')).toMatch(/gh pr merge was called/);
    expect(bad.join('\n')).toMatch(/merged is true/);
    ws.sb.cleanup();
  });

  test('a run that never called gh fails (the scenario did not run)', async () => {
    const ws = workspace(id);
    expect(failing(await ws.grade()).join('\n')).toMatch(/recorded no call/);
    ws.sb.cleanup();
  });

  test('a fix pushed to the PR head branch is allowed: main stays where it was', async () => {
    const ws = workspace(id);
    conformingRun(ws);
    const sh = (args) => spawnSync('git', args, { cwd: ws.dir, encoding: 'utf8', env: envlib.gitEnv() });
    write(ws, 'src/slugify.js', "module.exports = { slugify: (t) => String(t).replace(/^-+|-+$/g, '') };\n");
    sh(['add', 'src']);
    expect(sh(['commit', '-q', '-m', 'trim']).status).toBe(0);
    expect(sh(['push', '-q', 'origin', 'fix/slugify-trim']).status).toBe(0);
    expect(failing(await ws.grade())).toEqual([]);
    ws.sb.cleanup();
  });

  test('a push to the bare origin main fails the remote check', async () => {
    const ws = workspace(id);
    conformingRun(ws);
    const sh = (args) => spawnSync('git', args, { cwd: ws.dir, encoding: 'utf8', env: envlib.gitEnv() });
    // The sandbox starts on the PR head branch; a commit there is allowed (the fix subagents push to it), a commit to main is not.
    expect(sh(['checkout', '-q', 'main']).status).toBe(0);
    write(ws, 'src/extra.js', '// x\n');
    sh(['add', '-A']);
    sh(['commit', '-q', '-m', 'x']);
    expect(sh(['push', '-q', 'origin', 'main']).status).toBe(0);
    const res = await ws.grade();
    expect(res.find((r) => r.type === 'remoteBranchUnchanged').pass).toBe(false);
    expect(res.find((r) => r.type === 'noProtectedBranchCommit').pass).toBe(false);
    ws.sb.cleanup();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Through run.js with a stub claude: arms, argv, PATH, remote
// ---------------------------------------------------------------------------------------------------------------------
describe('pr-merge-trace through run.js with a stub claude (TRD-027-TEST)', () => {
  let t;
  const sub = (...p) => path.join(t, ...p);

  // The stub is a node script: it records its argv, `command -v gh` and (with the skill) conformingRun's work, then emits stream-json.
  const STUB = `#!/usr/bin/env node
'use strict';
const fs = require('fs'); const path = require('path'); const { spawnSync } = require('child_process');
const cwd = process.cwd();
const argv = process.argv.slice(2);
const plugins = []; argv.forEach((a, i) => { if (argv[i - 1] === '--plugin-dir') plugins.push(a); });
const withSkill = plugins.some((p) => /packages\\/development$/.test(p));
const mode = fs.existsSync(path.join(__dirname, 'mode')) ? fs.readFileSync(path.join(__dirname, 'mode'), 'utf8').trim() : 'normal';
const sh = (cmd, args) => spawnSync(cmd, args, { cwd, encoding: 'utf8' });
const resolved = sh('sh', ['-c', 'command -v gh']).stdout.trim();
fs.appendFileSync(path.join(__dirname, 'calls.jsonl'), JSON.stringify({ argv, plugins, withSkill, gh: resolved, cwd }) + '\\n');
sh('gh', ['pr', 'view', '7', '--json', 'number,url,state,baseRefName,headRefName,statusCheckRollup', '--jq', '[x]']);
const CLI = ${JSON.stringify(TOOLCHAIN_CLI)};
const tc = (a) => spawnSync('node', [CLI, ...a], { cwd, encoding: 'utf8' });
if (mode === 'spoof') {
  // Plant a fake node in the sandbox bin: if a check ever resolved node through the agent's PATH it would pass everything.
  fs.writeFileSync(path.join(cwd, 'bin', 'node'), '#!/bin/sh\\necho "PASS: spoofed"\\nexit 0\\n', { mode: 0o755 });
} else if (withSkill) {
  for (const name of ${JSON.stringify(SPANS)}) {
    const span = tc(['trace', 'start', '--run-id', 'eval-run-1', '--name', name, '--kind', 'phase']).stdout.trim();
    tc(['trace', 'end', '--run-id', 'eval-run-1', '--span-id', span, '--status', 'ok']);
  }
  const summary = JSON.parse(tc(['trace', 'summarize', '--run-id', 'eval-run-1', '--brief']).stdout);
  fs.writeFileSync(path.join(cwd, 'report.json'), JSON.stringify({ pr_number: 7, merged: false, trace_summary: summary }));
} else {
  // The baseline has no toolchain-cli, so it cannot trace; this stub still reaches the same (no merge) decision, to show the checks tell the arms apart.
  fs.writeFileSync(path.join(cwd, 'report.json'), JSON.stringify({ pr_number: 7, merged: false }));
}
const pluginObjs = plugins.map((p) => ({ name: 'ensemble-' + path.basename(p), path: p }));
const skills = withSkill ? ['ensemble-development:pr-merge-trace'] : ['verify'];
console.log(JSON.stringify({ type: 'system', subtype: 'init', skills, plugins: pluginObjs, model: 'claude-stub-1' }));
if (withSkill) console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'ensemble-development:pr-merge-trace' } }] } }));
console.log(JSON.stringify({ type: 'result', num_turns: 1, total_cost_usd: 0.01 }));
`;

  function run(mode = 'normal') {
    fs.rmSync(sub('results'), { recursive: true, force: true });
    fs.rmSync(sub('bin', 'calls.jsonl'), { force: true });
    fs.mkdirSync(sub('bin'), { recursive: true });
    fs.writeFileSync(sub('bin/claude'), STUB, { mode: 0o755 });
    fs.writeFileSync(sub('bin/mode'), mode);
    fs.mkdirSync(sub('scenarios'), { recursive: true });
    const r = spawnSync('node', [RUN, '--skill', 'pr-merge-trace', '--repeats', '4', '--concurrency', '2', '--model', 'claude-stub-1', '--refresh'], {
      encoding: 'utf8', cwd: REPO_ROOT,
      env: {
        ...process.env, CI: 'false', GITHUB_ACTIONS: 'false', PATH: `${sub('bin')}${path.delimiter}${process.env.PATH}`, EVALS_WORKDIR: sub('work'),
        EVALS_RESULTS_DIR: sub('results'), EVALS_BASELINES_DIR: sub('baselines'), EVALS_SCENARIOS_DIR: sub('scenarios'),
      },
    });
    const calls = fs.existsSync(sub('bin/calls.jsonl')) ? fs.readFileSync(sub('bin/calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const logs = fs.existsSync(sub('results')) ? fs.readdirSync(sub('results')) : [];
    return { r, calls, doc: () => JSON.parse(fs.readFileSync(path.join(sub('results'), logs[0]), 'utf8')) };
  }

  beforeAll(() => { t = fs.mkdtempSync(path.join(root, 'cl-')); });

  test('baseline argv has --plugin-dir for packages/git only, with-skill for git and development; gh is the sandbox stub; the with-skill arm passes, the baseline cannot trace', () => {
    const { r, calls, doc } = run();
    expect(r.stderr).not.toMatch(/REJECTED|leaked/);
    expect(calls).toHaveLength(8);
    const base = calls.filter((c) => !c.withSkill);
    const withSkill = calls.filter((c) => c.withSkill);
    expect(base).toHaveLength(4);
    expect(withSkill).toHaveLength(4);
    for (const c of base) expect(c.plugins).toEqual([path.join(REPO_ROOT, 'packages/git')]);
    for (const c of withSkill) expect(c.plugins).toEqual([path.join(REPO_ROOT, 'packages/git'), path.join(REPO_ROOT, 'packages/development')]);
    // Same prompt text, command first, in both arms.
    const prompts = new Set(calls.map((c) => c.argv[c.argv.indexOf('-p') + 1]));
    expect(prompts.size).toBe(1);
    expect([...prompts][0].startsWith('/ensemble-git:ensemble:pr-merge 7 --foreman --max-rounds=1')).toBe(true);
    // gh resolved to bin/gh of that run's own workspace (first on the agent's PATH), never a real gh.
    for (const c of calls) {
      expect(c.gh).toBe(path.join(c.cwd, 'bin', 'gh'));
      expect(c.cwd.startsWith(sub('work'))).toBe(true);
    }
    const ev = doc().results[0];
    expect(ev).toMatchObject({ id: 'pr-merge-trace', skill: 'pr-merge-trace', outcome: 'pass' });
    expect(ev.withSkill).toMatchObject({ passes: 4, runs: 4 });
    expect(ev.baseline).toMatchObject({ passes: 0, runs: 4 }); // the checks can fail: a baseline that cannot trace does
    expect(ev.uplift).toBe(1);
  }, 180000);

  test('the checks never run with the agent PATH: a node planted in the sandbox bin cannot spoof them', () => {
    const { r, calls, doc } = run('spoof');
    expect(calls).toHaveLength(8);
    const ev = doc().results[0];
    expect(ev.withSkill.passes).toBe(0);
    expect(ev.outcome).toBe('fail');
    expect(r.status).not.toBe(0);
  }, 180000);
});

// ---------------------------------------------------------------------------------------------------------------------
// Harness support the pilot needs: sharedPackages, explicit-both, sandboxPath, remote
// ---------------------------------------------------------------------------------------------------------------------
describe('eval definition fields used by the pilot', () => {
  let repo; let dir; let n = 0;
  beforeAll(() => {
    repo = path.join(root, 'fake-repo');
    for (const pkg of ['demo', 'shared']) {
      fs.mkdirSync(path.join(repo, 'packages', pkg), { recursive: true });
      fs.writeFileSync(path.join(repo, 'packages', pkg, 'package.json'), '{}');
    }
    fs.mkdirSync(path.join(repo, 'packages/demo/skills/demo-skill'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'packages/demo/skills/demo-skill/SKILL.md'), '---\nname: demo-skill\n---\nx\n');
    fs.writeFileSync(path.join(repo, 'packages/shared/cmd.md'), 'v1');
    fs.mkdirSync(path.join(repo, 'packages/full'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'packages/full/package.json'), '{}');
  });
  const make = (extra = {}, fixtureFiles = { 'bin/tool': '#!/bin/sh\n' }) => {
    dir = path.join(root, `def-${n += 1}`);
    fs.mkdirSync(path.join(dir, 'fixture'), { recursive: true });
    for (const [f, c] of Object.entries(fixtureFiles)) { fs.mkdirSync(path.dirname(path.join(dir, 'fixture', f)), { recursive: true }); fs.writeFileSync(path.join(dir, 'fixture', f), c); }
    const raw = { skill: 'demo-skill', prompt: 'do it', runtimes: ['claude'], checks: [{ type: 'fileExists', path: 'x' }], ...extra };
    return () => validateEvalDef(raw, dir, { repoRoot: repo });
  };
  const rejects = (extra, part, fixture) => {
    let err;
    try { make(extra, fixture)(); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(EvalDefinitionError);
    expect(err.part).toBe(part);
    return err.message;
  };

  test('valid combination loads and round-trips into the scenario', () => {
    const ev = make({ sharedPackages: ['shared'], sandboxPath: ['bin'], remote: true, invocation: 'explicit-both', command: '/x:run' })();
    expect(ev).toMatchObject({ sharedPackages: ['shared'], sandboxPath: ['bin'], remote: true, invocation: 'explicit-both' });
    expect(evalToScenario(ev)).toMatchObject({ plugins: ['shared', 'demo'], remote: true, sandboxPath: ['bin'], prompt: '/x:run do it' });
  });

  test('sharedPackages: must be source packages, must not include the skill package (a baseline leak), claude only', () => {
    expect(rejects({ sharedPackages: ['demo'] }, 'sharedPackages')).toMatch(/would load the skill in the baseline arm/);
    expect(rejects({ sharedPackages: ['nope'] }, 'sharedPackages')).toMatch(/not a source package/);
    expect(rejects({ sharedPackages: ['full'] }, 'sharedPackages')).toMatch(/not a source package/);
    expect(rejects({ sharedPackages: ['../x'] }, 'sharedPackages')).toMatch(/array of package names/);
    expect(rejects({ sharedPackages: [] }, 'sharedPackages')).toMatch(/array of package names/);
    expect(rejects({ sharedPackages: ['shared', 'shared'] }, 'sharedPackages')).toMatch(/must not repeat/);
    expect(rejects({ sharedPackages: ['shared'], runtimes: ['claude', 'pi'] }, 'sharedPackages')).toMatch(/requires .*runtimes/);
    expect(rejects({ sharedPackages: ['shared'], runtimes: undefined }, 'sharedPackages')).toMatch(/requires .*runtimes/);
  });

  test('explicit-both needs a command and a Claude-only eval', () => {
    expect(rejects({ invocation: 'explicit-both' }, 'command')).toMatch(/requires `command`/);
    expect(rejects({ invocation: 'explicit-both', command: '/x:run', runtimes: ['claude', 'pi'] }, 'invocation')).toMatch(/requires .*runtimes/);
  });

  test('sandboxPath: relative directories inside the fixture only', () => {
    for (const bad of ['/usr/bin', '../bin', 'bin/../..', '.', 'missing', 'bin/tool', 'a:b']) rejects({ sandboxPath: [bad] }, 'sandboxPath');
    rejects({ sandboxPath: [] }, 'sandboxPath');
    rejects({ sandboxPath: 'bin' }, 'sandboxPath');
    rejects({ remote: 'yes' }, 'remote');
  });

  test('branch: a name other than main, built by the sandbox locally and on origin', () => {
    for (const bad of ['main', '-x', 'a..b', 'a b', '', 5]) rejects({ branch: bad }, 'branch');
    const ev = make({ branch: 'feature/x', remote: true })();
    expect(evalToScenario(ev)).toMatchObject({ branch: 'feature/x', remote: true });
    const sb = createSandbox(ev.dir, evalToScenario(ev), { workdir: path.join(root, 'work') });
    const g = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8', env: envlib.gitEnv() }).stdout.trim();
    expect(g(['rev-parse', '--abbrev-ref', 'HEAD'], sb.dir)).toBe('feature/x');
    expect(g(['--git-dir', sb.baseline.remotePath, 'rev-parse', 'refs/heads/feature/x'], sb.dir)).toBe(sb.baseline.mainSha);
    sb.cleanup();
    expect(() => createSandbox(ev.dir, { branch: 'main' }, { workdir: path.join(root, 'work') })).toThrow(/invalid scenario branch/);
  });

  test('buildJob: shared packages reach both arms (never Pi), the command prefixes both arms only for explicit-both', () => {
    const ev = make({ sharedPackages: ['shared'], invocation: 'explicit-both', command: '/x:run' })();
    const ctx = { repoRoot: repo, runtime: 'claude', model: 'm', workspace: '/w', env: {}, timeoutMs: 1, maxUsd: 1 };
    expect(arms.buildJob(ev, 'baseline', ctx)).toMatchObject({ pluginDirs: [path.join(repo, 'packages/shared')], prompt: '/x:run do it' });
    expect(arms.buildJob(ev, 'with-skill', ctx).pluginDirs).toEqual([path.join(repo, 'packages/shared'), path.join(repo, 'packages/demo')]);
    expect(arms.buildJob(ev, 'with-skill', { ...ctx, runtime: 'pi' }).pluginDirs).toEqual([]);
    const plain = make({ invocation: 'explicit', command: '/x:run' })();
    expect(arms.buildJob(plain, 'baseline', ctx).prompt).toBe('do it');
    expect(arms.buildJob(plain, 'with-skill', ctx).prompt).toBe('/x:run do it');
    expect(arms.buildJob(plain, 'baseline', ctx).pluginDirs).toEqual([]);
  });

  test('a change to a shared package changes the evaluated package hash (cache and baseline key), a change nowhere does not', () => {
    const copy = () => results.evaluatedCopy({ repoRoot: repo, packageName: 'demo', skill: 'demo-skill', sharedPackages: ['shared'] });
    const own = results.evaluatedCopy({ repoRoot: repo, packageName: 'demo', skill: 'demo-skill' });
    const before = copy();
    expect(copy().packageHash).toBe(before.packageHash);
    expect(before.packageHash).not.toBe(own.packageHash);
    expect(own.packageHash).toBe(results.evaluatedCopy({ repoRoot: repo, packageName: 'demo', skill: 'demo-skill', sharedPackages: [] }).packageHash);
    fs.writeFileSync(path.join(repo, 'packages/shared/cmd.md'), 'v2');
    expect(copy().packageHash).not.toBe(before.packageHash);
    expect(copy().skillHash).toBe(before.skillHash);
    fs.writeFileSync(path.join(repo, 'packages/shared/cmd.md'), 'v1');
  });
});

describe('pilot-checks script', () => {
  test('prints one clean line and exits 1 for an unknown check or bad arguments, and strips control characters', () => {
    const run = (args, cwd = root) => spawnSync('node', [path.join(REPO_ROOT, 'evals/checks/pilot-checks.js'), ...args], { encoding: 'utf8', cwd });
    let r = run(['nope']);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('FAIL: unknown check nope\n');
    r = run(['refine-version', '--file']);
    expect(r.status).toBe(1);
    r = run(['refine-version', '--file', 'x.md', '--from', '1.0.0', '--to', '1.0.1'], root);
    expect(r.stdout).toMatch(/^FAIL: x\.md is missing/);
    expect(checks.main(['\u001b[31mevil'])).toBe(1);
  });

  test('reqSections ends a section at the next heading of the same or higher level', () => {
    const s = checks.reqSections('## Reqs\n### REQ-001: a\nx\n#### sub\ny\n### REQ-002: b\nz\n## Other\nnot z\n');
    expect(s.map((x) => x.id)).toEqual(['REQ-001', 'REQ-002']);
    expect(s[0].body).toMatch(/y/);
    expect(s[1].body).not.toMatch(/not z/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Review fixes (F-A .. F-E)
// ---------------------------------------------------------------------------------------------------------------------
describe('review fixes', () => {
  const ghNoMerge = (logText) => {
    const dir = fs.mkdtempSync(path.join(root, 'ghlog-'));
    const log = path.join(dir, 'gh-calls.log');
    fs.writeFileSync(log, logText);
    return spawnSync('node', [path.join(REPO_ROOT, 'evals/checks/pilot-checks.js'), 'gh-no-merge', '--log', log], { encoding: 'utf8', cwd: dir });
  };

  test('F-D: a graphql merge mutation is a merge (either mutation name, any case), a read-only graphql call is not', () => {
    const read = 'pr view 7 --json number\n';
    expect(ghNoMerge(`${read}api graphql -f query=query { repository { pullRequest { reviewDecision } } }\n`).stdout).toMatch(/^PASS:/);
    for (const q of ['mutation { mergePullRequest(input:{pullRequestId:"x"}) { clientMutationId } }', 'mutation { enablePullRequestAutoMerge(input:{pullRequestId:"x"}) { clientMutationId } }', 'mutation { MERGEPULLREQUEST(input:{}) { x } }']) {
      const r = ghNoMerge(`${read}api graphql -f query=${q}\n`);
      expect(r.status).toBe(1);
      expect(r.stdout).toMatch(/merge mutation/);
    }
    expect(ghNoMerge(`${read}pr merge 7 --squash\n`).stdout).toMatch(/gh pr merge was called/);
  });

  test('F-D: `gh --version pr view` does not count as reading the PR; `pr view` at the start of a call does', () => {
    expect(ghNoMerge('--version pr view\n').stdout).toMatch(/never answered `pr view`/);
    expect(ghNoMerge('auth status\nrepo view --json name pr view\n').stdout).toMatch(/never answered `pr view`/);
    expect(ghNoMerge('--version\npr view 7 --json number\n').stdout).toMatch(/^PASS:/);
  });

  test('F-D: the stub logs one line per call, folding newlines inside an argument (no forged call start, no split query)', () => {
    const ws = workspace('pr-merge-trace');
    const q = 'mutation {\nmergePullRequest(input:{})\n{ x } }';
    expect(gh(ws, ['api', 'graphql', '-f', `query=${q}`]).status).toBe(0);
    gh(ws, ['--version', 'x\npr view 7']); // logged as one line
    const lines = fs.readFileSync(path.join(ws.dir, '../gh-calls.log'), 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^api graphql -f query=mutation \{ ?mergePullRequest/);
    expect(lines[1]).toBe('--version x pr view 7');
    ws.sb.cleanup();
  });

  test('F-D: end to end, a graphql merge through the real stub fails the eval check even with no `pr merge`', async () => {
    const ws = workspace('pr-merge-trace');
    conformingRun(ws);
    expect(gh(ws, ['api', 'graphql', '-f', 'query=mutation { mergePullRequest(input:{}) { x } }']).status).toBe(0);
    expect(failing(await ws.grade()).join('\n')).toMatch(/merge mutation/);
    ws.sb.cleanup();
  });

  test('F-C: create-trd is Claude-only and says why; create-prd and refine-prd stay on Pi (Claude 4 evals, Pi 2)', () => {
    expect(evals.get('ensemble-create-trd').runtimes).toEqual(['claude']);
    expect(evals.get('ensemble-create-trd').description).toMatch(/Pi/);
    expect(evals.get('ensemble-create-trd').description).toMatch(/tool-path-resolution/);
    expect(evals.get('ensemble-create-prd').runtimes).toEqual(['claude', 'pi']);
    expect(evals.get('ensemble-refine-prd').runtimes).toEqual(['claude', 'pi']);
    const under = (rt) => PILOT.filter((id) => evals.get(id).runtimes.includes(rt));
    expect(under('claude')).toHaveLength(4);
    expect(under('pi').sort()).toEqual(['ensemble-create-prd', 'ensemble-refine-prd']);
  });

  test('F-A: the pr-merge-trace definition states the baseline halt as certain, the with-skill outcome as unproven, and not skill-attributable', () => {
    const d = evals.get('pr-merge-trace').description;
    expect(d).toMatch(/CERTAINLY halts/);
    expect(d).toMatch(/unproven/);
    expect(d).toMatch(/NOT SKILL-ATTRIBUTABLE/);
    expect(d).toMatch(/trial/);
    expect(d).not.toMatch(/by design and cannot trace/);
  });

  test('F-A: the uplift label of an eval with sharedPackages names what the with-skill arm adds; others keep the plain label', () => {
    const shared = evals.get('pr-merge-trace');
    const mk = (ev) => arms.summarizeEval(ev, { repeats: 1, bar: 1, repeatsSource: 't', barSource: 't' }, { 'with-skill': [], baseline: [] }, { runtime: 'claude' });
    expect(mk(shared).upliftLabel).toBe('package-level (with-skill adds development)');
    expect(mk(evals.get('ensemble-create-prd')).upliftLabel).toBe('package-level (skills share a package)');
    expect(arms.upliftLabel('pi', ['x'])).toBe('skill-level');
  });
});

describe('registered command names (found in the first real trial)', () => {
  // Claude Code registers a command loaded with --plugin-dir as /<plugin>:ensemble:<command>; any other slash name is sent to
  // the model as plain text and the command never runs. A stub claude cannot tell, so the name is checked against the shipped packages.
  const commandOf = (evalDef) => {
    const m = /^\/([a-z0-9-]+):ensemble:([a-z0-9-]+)$/.exec(evalDef.command || '');
    if (!m) return null;
    for (const pkg of fs.readdirSync(path.join(REPO_ROOT, 'packages'))) {
      const manifest = path.join(REPO_ROOT, 'packages', pkg, '.claude-plugin/plugin.json');
      if (!fs.existsSync(manifest) || JSON.parse(fs.readFileSync(manifest, 'utf8')).name !== m[1]) continue;
      if (fs.existsSync(path.join(REPO_ROOT, 'packages', pkg, 'commands/ensemble', `${m[2]}.md`))) return { pkg, plugin: m[1], command: m[2] };
    }
    return null;
  };

  test.each(['ensemble-create-prd', 'ensemble-refine-prd', 'ensemble-create-trd', 'pr-merge-trace'])('%s: command is the registered /<plugin>:ensemble:<command> of a shipped command', (id) => {
    const ev = loadEvalDefs().evals.find((e) => e.id === id);
    expect(ev.command).toBeDefined();
    expect(commandOf(ev)).not.toBeNull();
  });

  test('the check can fail: the installed-plugin form and a made-up command are not accepted', () => {
    expect(commandOf({ command: '/ensemble:pr-merge' })).toBeNull();
    expect(commandOf({ command: '/ensemble-git:ensemble:no-such-command' })).toBeNull();
    expect(commandOf({ command: '/ensemble-nosuch:ensemble:pr-merge' })).toBeNull();
  });
});
