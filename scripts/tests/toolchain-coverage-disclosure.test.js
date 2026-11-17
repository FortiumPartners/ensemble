'use strict';

/**
 * TRD-026 (br-199gw, PRD REQ-015 / AC-015-1): coverage disclosure. The generated tracker and
 * work-graph contract docs name every shipped backend and state, per capability, whether the
 * backend answers it natively or it is reached by fallback; the docs check fails when an
 * adapter's native-versus-fallback status changed without regeneration.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'generate-contract-docs.js');
const {
  classifyCapabilities,
  builtinFallbackIds
} = require('../../packages/development/lib/toolchain/coverage');
const {
  renderContract,
  findCoverageDrift,
  main,
  loadCategoryContracts
} = require('../generate-contract-docs');

const SCRATCH_BASE = path.join(os.homedir(), '.omp', 'br-199gw', 'scratch');
const tempDirs = [];
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function readYaml(rel) {
  return yaml.load(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
}
const contractFor = (category) => readYaml(`packages/development/toolchain/categories/${category}.yaml`);
const manifestFor = (rel) => readYaml(rel);

describe('classifyCapabilities (pure rule)', () => {
  const contract = {
    category: 'x',
    capabilities: {
      'x.a': { fallback: 'builtin-one' },
      'x.b': { fallback: 'not-a-builtin' },
      'x.c': {},
      'x.d': { fallback: 'builtin-one' }
    }
  };
  const builtins = ['builtin-one'];

  test('declared with parse is native; declared without parse and a builtin fallback is fallback', () => {
    const manifest = {
      adapter: 'tool',
      capabilities: { 'x.a': { run: ['t'] }, 'x.b': { run: ['t'] }, 'x.d': { run: ['t'], parse: {} } }
    };
    expect(classifyCapabilities(contract, manifest, builtins)).toEqual({
      'x.a': 'fallback',
      'x.b': 'native',
      'x.c': 'unavailable',
      'x.d': 'native'
    });
  });

  test('undeclared: named fallback => fallback, none => unavailable', () => {
    const result = classifyCapabilities(contract, { adapter: 'tool', capabilities: {} }, builtins);
    expect(result).toEqual({
      'x.a': 'fallback',
      'x.b': 'fallback',
      'x.c': 'unavailable',
      'x.d': 'fallback'
    });
  });

  test('the builtin itself is native for what it declares', () => {
    const manifest = { adapter: 'builtin-one', capabilities: { 'x.a': {} } };
    expect(classifyCapabilities(contract, manifest, builtins)['x.a']).toBe('native');
  });
});

describe('real shipped manifests', () => {
  const wg = contractFor('work-graph');
  const tracker = contractFor('tracker');

  test('builtinFallbackIds lists work-graph-links-fallback', () => {
    expect(builtinFallbackIds()).toContain('work-graph-links-fallback');
  });

  test('kata work-graph: ready native, plan fallback, graph-health fallback', () => {
    const kata = manifestFor('packages/development/skills/adapter-tracker-kata/adapter.yaml');
    expect(classifyCapabilities(wg, kata)).toEqual({
      'work-graph.ready': 'native',
      'work-graph.plan': 'fallback',
      'work-graph.graph-health': 'fallback'
    });
  });

  test('beads: every work-graph capability and every declared tracker capability is native', () => {
    const beads = manifestFor('packages/development/skills/adapter-tracker-beads/adapter.yaml');
    const wgResult = classifyCapabilities(wg, beads);
    for (const value of Object.values(wgResult)) expect(value).toBe('native');
    const trackerResult = classifyCapabilities(tracker, beads);
    for (const [id, value] of Object.entries(trackerResult)) {
      // tracker.label-one is not declared by beads (it takes many labels in one call): honest 'unavailable'.
      expect([id, value]).toEqual([id, id === 'tracker.label-one' ? 'unavailable' : 'native']);
    }
  });

  test('jira declares no work-graph category and the contract versions are unchanged', () => {
    const jira = manifestFor('packages/infrastructure/skills/adapter-tracker-jira/adapter.yaml');
    expect(jira.categories).not.toContain('work-graph');
    expect(Object.keys(jira.capabilities).some((id) => id.startsWith('work-graph.'))).toBe(false);
    expect(wg.version).toBe('2.0');
    expect(tracker.version).toBe('1.1');
  });
});

describe('generated docs', () => {
  const read = (category) =>
    fs.readFileSync(path.join(REPO_ROOT, 'docs', 'toolchain', 'contracts', `${category}.md`), 'utf8');

  function matrixRow(doc, capability) {
    const section = doc.split('## Shipped backends and coverage')[1].split('\n## ')[0];
    const line = section.split('\n').find((l) => l.startsWith(`| \`${capability}\` |`));
    return line.split('|').slice(1, -1).map((c) => c.trim());
  }
  function matrixHeader(doc) {
    const section = doc.split('## Shipped backends and coverage')[1].split('\n## ')[0];
    const line = section.split('\n').find((l) => l.startsWith('| Capability |'));
    return line.split('|').slice(1, -1).map((c) => c.trim());
  }

  test('tracker.md names beads, kata, jira and azure-boards with per-capability cells', () => {
    const doc = read('tracker');
    const header = matrixHeader(doc);
    expect(header).toEqual(['Capability', 'azure-boards', 'beads', 'jira', 'kata']);
    const row = matrixRow(doc, 'tracker.show');
    expect(row.slice(1).every((c) => ['native', 'fallback', 'unavailable'].includes(c))).toBe(true);
    // jira ships 8 tracker capabilities only: stage-export is unavailable or fallback, beads is native.
    const beadsIdx = header.indexOf('beads');
    expect(matrixRow(doc, 'tracker.stage-export')[beadsIdx]).toBe('native');
  });

  test('work-graph.md names beads, kata and work-graph-links-fallback; kata plan is fallback', () => {
    const doc = read('work-graph');
    const header = matrixHeader(doc);
    expect(header).toEqual(['Capability', 'beads', 'kata', 'work-graph-links-fallback']);
    expect(matrixRow(doc, 'work-graph.ready')).toEqual(['`work-graph.ready`', 'native', 'native', 'native']);
    expect(matrixRow(doc, 'work-graph.plan')).toEqual(['`work-graph.plan`', 'native', 'fallback', 'native']);
    expect(matrixRow(doc, 'work-graph.graph-health')).toEqual([
      '`work-graph.graph-health`',
      'native',
      'fallback',
      'native'
    ]);
    expect(doc).toContain('`fallback` = ');
  });

  test('renderContract without backends renders no coverage section (backward compatible)', () => {
    const out = renderContract(loadCategoryContracts(REPO_ROOT)[0]);
    expect(out).not.toContain('Shipped backends and coverage');
  });
});

describe('docs drift check', () => {
  function copyTree() {
    fs.mkdirSync(SCRATCH_BASE, { recursive: true });
    const root = fs.mkdtempSync(path.join(SCRATCH_BASE, 'drift-'));
    tempDirs.push(root);
    const copyDir = (rel) =>
      fs.cpSync(path.join(REPO_ROOT, rel), path.join(root, rel), { recursive: true });
    copyDir('docs/toolchain/contracts');
    copyDir('packages/development/toolchain/categories');
    copyDir('packages/development/toolchain/builtin');
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

  function captureMain(argv, root) {
    const errs = [];
    const logs = [];
    const e = jest.spyOn(console, 'error').mockImplementation((m) => errs.push(String(m)));
    const l = jest.spyOn(console, 'log').mockImplementation((m) => logs.push(String(m)));
    try {
      return { code: main(argv, root), errs, logs };
    } finally {
      e.mockRestore();
      l.mockRestore();
    }
  }

  test('clean tree: no drift, --check exits 0', () => {
    const root = copyTree();
    expect(findCoverageDrift(root)).toEqual([]);
    expect(captureMain(['--check'], root).code).toBe(0);
  });

  test('real repository docs are up to date (script exit 0)', () => {
    const res = spawnSync('node', [SCRIPT, '--check'], { encoding: 'utf8' });
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
  });

  test('flipping an adapter capability from native to fallback without regenerating names it', () => {
    const root = copyTree();
    const kataPath = path.join(root, 'packages/development/skills/adapter-tracker-kata/adapter.yaml');
    const manifest = yaml.load(fs.readFileSync(kataPath, 'utf8'));
    delete manifest.capabilities['work-graph.ready'];
    fs.writeFileSync(kataPath, yaml.dump(manifest));

    const drift = findCoverageDrift(root);
    expect(drift).toContain('work-graph: kata work-graph.ready: recorded native, now fallback');

    const { code, errs } = captureMain(['--check'], root);
    expect(code).toBe(1);
    expect(errs.join('\n')).toContain('work-graph: kata work-graph.ready: recorded native, now fallback');
  });

  test('a newly shipped adapter that is not recorded is named', () => {
    const root = copyTree();
    const dir = path.join(root, 'packages/development/skills/adapter-tracker-newtool');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'adapter.yaml'),
      yaml.dump({ adapter: 'newtool', categories: ['tracker'], capabilities: { 'tracker.show': { run: ['x'] } } })
    );
    expect(findCoverageDrift(root)).toContain(
      "adapter 'newtool' is shipped but not recorded in docs/toolchain/contracts/tracker.md"
    );
  });

  test('a recorded adapter that is no longer shipped is named', () => {
    const root = copyTree();
    fs.rmSync(path.join(root, 'packages/infrastructure/skills/adapter-tracker-jira'), {
      recursive: true,
      force: true
    });
    expect(findCoverageDrift(root)).toContain("recorded backend 'jira' is no longer shipped");
  });
});
