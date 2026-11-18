'use strict';

/**
 * TRD-026-TEST (br-l55y9, PRD REQ-015 / AC-015-1): the generated coverage docs name every shipped
 * backend with native/fallback status per capability, the docs check fails when a manifest changes
 * without regeneration, and graph-health asked of the builtin analyzer answers with findings.
 *
 * Mutation happens only on copies under ~/.omp/trd-026-test/ (never the repo, never os.tmpdir()).
 * No test here drives the kata binary, so no guard is needed and the no-kata leg passes.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const { main, findCoverageDrift } = require('../../../scripts/generate-contract-docs');

const { runWorkGraphCapability, ADAPTER_ID } = require('../lib/toolchain/builtin/work-graph-links-fallback');

const SCRATCH_BASE = path.join(os.homedir(), '.omp', 'trd-026-test', 'copies');
const created = [];
afterAll(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});
function mkScratch(prefix) {
  fs.mkdirSync(SCRATCH_BASE, { recursive: true });
  const dir = fs.mkdtempSync(path.join(SCRATCH_BASE, prefix));
  created.push(dir);
  return dir;
}

const readDoc = (category) =>
  fs.readFileSync(path.join(REPO_ROOT, 'docs', 'toolchain', 'contracts', `${category}.md`), 'utf8');

function coverageSection(doc) {
  return doc.split('## Shipped backends and coverage')[1].split('\n## ')[0];
}
function cells(line) {
  return line.split('|').slice(1, -1).map((c) => c.trim());
}
function matrix(doc) {
  const lines = coverageSection(doc).split('\n').filter((l) => l.startsWith('|'));
  const header = cells(lines[0]);
  const rows = {};
  for (const line of lines.slice(2)) {
    const row = cells(line);
    rows[row[0].replace(/`/g, '')] = Object.fromEntries(header.slice(1).map((b, i) => [b, row[i + 1]]));
  }
  return { header, rows };
}

describe('Happy: regenerated docs list kata and the links analyzer with status per capability', () => {
  test('work-graph.md names kata and work-graph-links-fallback, every capability native or fallback', () => {
    const { header, rows } = matrix(readDoc('work-graph'));
    expect(header).toContain('kata');
    expect(header).toContain('work-graph-links-fallback');
    const ids = ['work-graph.ready', 'work-graph.plan', 'work-graph.graph-health'];
    expect(Object.keys(rows).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      for (const backend of ['kata', 'work-graph-links-fallback']) {
        expect(['native', 'fallback']).toContain(rows[id][backend]);
      }
    }
    // Expected native values follow the shipped manifests (kata adapter.yaml and the builtin's
    // builtin/*.yaml); if a manifest legitimately changes, update these along with the regenerated docs.
    // The links analyzer answers all three itself; kata serves plan and graph-health natively too.
    for (const id of ids) expect(rows[id]['work-graph-links-fallback']).toBe('native');
    for (const id of ids) expect(rows[id].kata).toBe('native');
  });

  test('tracker.md names kata with a status for every tracker capability', () => {
    const { header, rows } = matrix(readDoc('tracker'));
    expect(header).toContain('kata');
    const contract = yaml.load(
      fs.readFileSync(path.join(REPO_ROOT, 'packages/development/toolchain/categories/tracker.yaml'), 'utf8')
    );
    expect(Object.keys(rows).sort()).toEqual(Object.keys(contract.capabilities).sort());
    for (const id of Object.keys(rows)) {
      expect(['native', 'fallback', 'unavailable']).toContain(rows[id].kata);
    }
  });

  test('the committed docs are current (check passes on the real repository)', () => {
    expect(findCoverageDrift(REPO_ROOT)).toEqual([]);
  });
});

describe('Edge: a native-to-fallback manifest change without regeneration fails the docs check', () => {
  function copyInputs() {
    const root = mkScratch('drift-');
    const copy = (rel) => fs.cpSync(path.join(REPO_ROOT, rel), path.join(root, rel), { recursive: true });
    copy('docs/toolchain/contracts');
    copy('packages/development/toolchain/categories');
    copy('packages/development/toolchain/builtin');
    for (const pkg of fs.readdirSync(path.join(REPO_ROOT, 'packages'))) {
      if (['pi', 'codex', 'opencode', 'full'].includes(pkg)) continue;
      const skills = path.join(REPO_ROOT, 'packages', pkg, 'skills');
      if (!fs.existsSync(skills)) continue;
      for (const skill of fs.readdirSync(skills)) {
        const src = path.join(skills, skill, 'adapter.yaml');
        if (!fs.existsSync(src)) continue;
        const dest = path.join(root, 'packages', pkg, 'skills', skill, 'adapter.yaml');
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
      }
    }
    return root;
  }
  function run(argv, root) {
    const errs = [];
    const e = jest.spyOn(console, 'error').mockImplementation((m) => errs.push(String(m)));
    const l = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      return { code: main(argv, root), errs: errs.join('\n') };
    } finally {
      e.mockRestore();
      l.mockRestore();
    }
  }

  test('unmutated copy passes the check', () => {
    expect(run(['--check'], copyInputs()).code).toBe(0);
  });

  test('dropping the kata plan declaration (native -> fallback) fails --check until regenerated', () => {
    const root = copyInputs();
    const file = path.join(root, 'packages/development/skills/adapter-tracker-kata/adapter.yaml');
    const manifest = yaml.load(fs.readFileSync(file, 'utf8'));
    expect(manifest.capabilities['work-graph.plan']).toBeDefined();
    delete manifest.capabilities['work-graph.plan'];
    fs.writeFileSync(file, yaml.dump(manifest));

    const failed = run(['--check'], root);
    expect(failed.code).toBe(1);
    expect(failed.errs).toContain('work-graph: kata work-graph.plan: recorded native, now fallback');

    // Regenerating records the change and the check goes green again.
    expect(run([], root).code).toBe(0);
    const { rows } = matrix(fs.readFileSync(path.join(root, 'docs/toolchain/contracts/work-graph.md'), 'utf8'));
    expect(rows['work-graph.plan'].kata).toBe('fallback');
    expect(run(['--check'], root).code).toBe(0);
  });
});

describe('Edge: graph-health asked of the builtin returns findings, not a refusal', () => {
  const realPath = process.env.PATH;
  let stubDir;
  let jiraManifest;

  beforeAll(() => {
    stubDir = mkScratch('stub-');
    fs.writeFileSync(
      path.join(stubDir, 'jira'),
      [
        '#!/bin/sh',
        'if [ "$2" = "list" ]; then',
        '  echo \'[{"key":"J-1","summary":"first","status":"To Do"},{"key":"J-2","summary":"second","status":"To Do"}]\'',
        'elif [ "$2" = "read" ]; then',
        '  echo "{\\"key\\":\\"$3\\",\\"summary\\":\\"item $3\\",\\"description\\":\\"d\\",\\"issueType\\":\\"Task\\",\\"status\\":\\"To Do\\",\\"priority\\":\\"Medium\\",\\"labels\\":[]}"',
        'else exit 3; fi',
        ''
      ].join('\n'),
      { mode: 0o755 }
    );
    process.env.PATH = `${stubDir}${path.delimiter}${realPath}`;
    jiraManifest = yaml.load(
      fs.readFileSync(path.join(REPO_ROOT, 'packages/infrastructure/skills/adapter-tracker-jira/adapter.yaml'), 'utf8')
    );
  });
  afterAll(() => {
    process.env.PATH = realPath;
  });

  test('ok result with a findings array, naming the builtin, never NOT_ALLOWED', async () => {
    const result = await runWorkGraphCapability('work-graph.graph-health', jiraManifest, {}, {
      source: 'default',
      execOpts: { execFileOptions: { cwd: stubDir } }
    });
    expect(result.error && result.error.code).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.adapter).toBe(ADAPTER_ID);
    expect(Array.isArray(result.data.findings)).toBe(true);
    expect(typeof result.data.status).toBe('string');
    // No dependency data from this tracker: the answer says nothing was checked, truthfully.
    expect(result.data.dependencyAware).toBe(false);
  });

  test('a dependency-bearing tracker yields dependencyAware, unhealthy, and real cycle and dangling findings', async () => {
    // Same tracker, but tracker.show now maps and emits `dependencies`: J-1 <-> J-2 form a cycle,
    // J-3 depends on an id the scope never returns.
    const depDir = mkScratch('stub-deps-');
    const body = (id, deps) =>
      JSON.stringify({ key: id, summary: `item ${id}`, description: 'd', issueType: 'Task', status: 'To Do', priority: 'Medium', labels: [], dependencies: deps });
    fs.writeFileSync(
      path.join(depDir, 'jira'),
      [
        '#!/bin/sh',
        'if [ "$2" = "list" ]; then',
        `  echo '[{"key":"J-1","summary":"a","status":"To Do"},{"key":"J-2","summary":"b","status":"To Do"},{"key":"J-3","summary":"c","status":"To Do"}]'`,
        'elif [ "$2" = "read" ]; then',
        '  case "$3" in',
        `    J-1) echo '${body('J-1', [{ id: 'J-2' }])}' ;;`,
        `    J-2) echo '${body('J-2', [{ id: 'J-1' }])}' ;;`,
        `    J-3) echo '${body('J-3', [{ id: 'ghost' }])}' ;;`,
        '    *) exit 3 ;;',
        '  esac',
        'else exit 3; fi',
        ''
      ].join('\n'),
      { mode: 0o755 }
    );
    const manifest = JSON.parse(JSON.stringify(jiraManifest));
    manifest.capabilities['tracker.show'].parse.map.dependencies = '$.dependencies';
    process.env.PATH = `${depDir}${path.delimiter}${realPath}`;
    let result;
    try {
      result = await runWorkGraphCapability('work-graph.graph-health', manifest, {}, {
        source: 'default',
        execOpts: { execFileOptions: { cwd: depDir } }
      });
    } finally {
      process.env.PATH = `${stubDir}${path.delimiter}${realPath}`;
    }
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.adapter).toBe(ADAPTER_ID);
    expect(result.data.dependencyAware).toBe(true);
    expect(result.data.status).toBe('unhealthy');
    expect(result.data.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'cycle', items: ['J-1', 'J-2'] }),
        expect.objectContaining({ type: 'dangling-edge', items: ['J-3'], dependency: 'ghost' })
      ])
    );
  });
});
