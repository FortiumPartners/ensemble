'use strict';
/**
 * Tests for scripts/lint-provider-refs.js (TRD-2026-8d825f54 TRD-047).
 *
 * All scenarios operate on fresh os.tmpdir() fixture roots (never scanning the live repo
 * tree as a pass/fail assertion -- the repo's own command/agent/skill sources are still
 * being refactored by sibling TRD-045 work at the time this lint ships, so asserting
 * "the live repo is clean" here would be a false, racy test). The one exception is the
 * committed deliberate-violation fixture under `scripts/tests/fixtures/provider-refs/
 * violation`, which is this test's own fixture, not shared repo content.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  findSourceFiles,
  findViolations,
  lintRoot,
  checkCommandStructure
} = require('../lint-provider-refs');

const SCRIPT_PATH = path.resolve(__dirname, '..', 'lint-provider-refs.js');
const VIOLATION_FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'provider-refs', 'violation');

function mkRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(root, relPath, content) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

/** Writes a minimal, complete (all-empty) seed tool-inventory.yaml, optionally overriding
 * one or more category lists. */
function seedInventory(root, extra = {}) {
  const base = {
    host: [], workflow: [], worktree: [], tracker: [], 'work-graph': [],
    'ci-local': [], review: [], lint: [], 'test-runner': [], 'e2e-quality': [],
    'container-deploy': [], iac: [], 'platform-cloud': [], 'package-runner': []
  };
  Object.assign(base, extra);
  const body = Object.entries(base)
    .map(([k, v]) => `${k}:${v.length ? '\n' + v.map(x => `  - ${x}`).join('\n') : ' []'}`)
    .join('\n');
  writeFile(root, 'packages/development/toolchain/tool-inventory.yaml', body + '\n');
}

let tmpRoots = [];
afterEach(() => {
  for (const root of tmpRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  tmpRoots = [];
});

function trackedRoot(prefix) {
  const root = mkRoot(prefix);
  tmpRoots.push(root);
  return root;
}

describe('lintRoot: BINARY_IN_* detection', () => {
  test('a hardcoded binary inside a fenced shell block is a BINARY_IN_COMMAND violation naming the file and line', () => {
    const root = trackedRoot('lint-binary-');
    seedInventory(root, { host: ['gh'] });
    const file = writeFile(root, 'packages/x/commands/y.yaml', [
      'metadata:',
      '  name: y',
      '',
      'mission:',
      '  summary: |',
      '    before',
      '',
      '    ```bash',
      '    gh pr create',
      '    ```',
    ].join('\n') + '\n');

    const violations = lintRoot(root).filter(v => v.class === 'BINARY_IN_COMMAND');
    expect(violations).toEqual([{ file, line: 9, binary: 'gh', class: 'BINARY_IN_COMMAND' }]);
  });

  test('an adapter-* skill directory naming its own binary produces zero violations', () => {
    const root = trackedRoot('lint-adapter-exempt-');
    seedInventory(root, { host: ['gh'] });
    writeFile(root, 'packages/x/skills/adapter-host-gh/SKILL.md', [
      '# adapter-host-gh',
      '```bash',
      'gh pr create',
      '```',
    ].join('\n') + '\n');

    expect(lintRoot(root)).toEqual([]);
  });

  test('a hardcoded binary inside a skill\'s references/ file is a BINARY_IN_SKILL violation naming that file and line', () => {
    const root = trackedRoot('lint-skill-reference-');
    seedInventory(root, { host: ['gh'] });
    writeFile(root, 'packages/x/skills/ensemble-s/SKILL.md', '# S\n\nFollow references/phase-1.md.\n');
    const file = writeFile(root, 'packages/x/skills/ensemble-s/references/phase-1.md', [
      '# Phase 1',
      '',
      '```bash',
      'gh pr create',
      '```',
    ].join('\n') + '\n');

    expect(lintRoot(root)).toEqual([{ file, line: 4, binary: 'gh', class: 'BINARY_IN_SKILL' }]);
  });

  test('a binary mentioned only as bare prose (no fence, no inline code span) is not flagged', () => {
    const binaries = new Set(['gh']);
    const violations = findViolations('gh is the GitHub CLI; it is not invoked here.', binaries);
    expect(violations).toEqual([]);
  });

  test('the same binary inside a fenced block IS flagged (positive control for the prose test above)', () => {
    const binaries = new Set(['gh']);
    const violations = findViolations('```bash\ngh pr list\n```', binaries);
    expect(violations).toEqual([{ line: 2, binary: 'gh', class: 'BINARY' }]);
  });

  test('a binary immediately after a shell separator (&&) is flagged in its own segment', () => {
    const binaries = new Set(['gh', 'npm']);
    const violations = findViolations('```bash\nnpm install && gh pr create\n```', binaries);
    expect(violations.map(v => v.binary).sort()).toEqual(['gh', 'npm']);
  });

  test('a binary prefixed by env/VAR= assignments is still recognized as the command token', () => {
    const binaries = new Set(['gh']);
    const violations = findViolations('```bash\nGH_TOKEN=x env gh pr create\n```', binaries);
    expect(violations).toEqual([{ line: 2, binary: 'gh', class: 'BINARY' }]);
  });

  test('findSourceFiles excludes generated/vendor package trees and adapter-* directories', () => {
    const root = trackedRoot('lint-exclude-');
    writeFile(root, 'packages/pi/commands/should-not-be-found.yaml', 'metadata:\n  name: x\n');
    writeFile(root, 'packages/full/commands/should-not-be-found.yaml', 'metadata:\n  name: x\n');
    writeFile(root, 'packages/codex/commands/should-not-be-found.yaml', 'metadata:\n  name: x\n');
    writeFile(root, 'packages/opencode/commands/should-not-be-found.yaml', 'metadata:\n  name: x\n');
    writeFile(root, 'packages/real/skills/adapter-host-x/SKILL.md', 'gh pr create\n');
    const found = writeFile(root, 'packages/real/commands/found.yaml', 'metadata:\n  name: x\n');

    const files = findSourceFiles(root);
    expect(files).toContain(found);
    expect(files.some(f => f.split(path.sep).includes('pi'))).toBe(false);
    expect(files.some(f => f.split(path.sep).includes('full'))).toBe(false);
    expect(files.some(f => f.split(path.sep).includes('codex'))).toBe(false);
    expect(files.some(f => f.split(path.sep).includes('opencode'))).toBe(false);
    expect(files.some(f => f.includes('adapter-host-x'))).toBe(false);
  });
});

describe('checkCommandStructure: MISSING_PREFLIGHT / MISSING_BASH_GRANT', () => {
  test('a required capability with no preflight line and Bash granted -> MISSING_PREFLIGHT only', () => {
    const content = [
      'metadata:',
      '  name: cmd-a',
      '  capabilities:',
      '    required:',
      '      - tracker.show',
      '  allowed_tools:',
      '    - Read',
      '    - Bash',
      '',
    ].join('\n') + '\n';
    expect(checkCommandStructure(content).map(v => v.class)).toEqual(['MISSING_PREFLIGHT']);
  });

  test('a required capability with no preflight line and allowed_tools: [Read] (no Bash) -> both classes', () => {
    const content = [
      'metadata:',
      '  name: cmd-b',
      '  capabilities:',
      '    required:',
      '      - tracker.show',
      '  allowed_tools:',
      '    - Read',
      '',
    ].join('\n') + '\n';
    const classes = new Set(checkCommandStructure(content).map(v => v.class));
    expect(classes).toEqual(new Set(['MISSING_PREFLIGHT', 'MISSING_BASH_GRANT']));
  });

  test('a correct preflight line listing the required id, with Bash granted -> neither class fires', () => {
    const content = [
      'metadata:',
      '  name: cmd-c',
      '  capabilities:',
      '    required:',
      '      - tracker.show',
      '  allowed_tools:',
      '    - Read',
      '    - Bash',
      '',
      'mission:',
      '  summary: |',
      '    ```bash',
      '    toolchain-cli preflight --require tracker.show --json',
      '    ```',
    ].join('\n') + '\n';
    expect(checkCommandStructure(content)).toEqual([]);
  });

  test('multiple required ids all listed via repeated --require flags on one line -> neither class fires', () => {
    const content = [
      'metadata:',
      '  name: cmd-d',
      '  capabilities:',
      '    required:',
      '      - tracker.show',
      '      - tracker.create',
      '  allowed_tools:',
      '    - Bash',
      '',
      'mission:',
      '  summary: |',
      '    ```bash',
      '    toolchain-cli preflight --require tracker.show --require tracker.create --json',
      '    ```',
    ].join('\n') + '\n';
    expect(checkCommandStructure(content)).toEqual([]);
  });

  test('multiple required ids with only one listed -> still MISSING_PREFLIGHT', () => {
    const content = [
      'metadata:',
      '  name: cmd-e',
      '  capabilities:',
      '    required:',
      '      - tracker.show',
      '      - tracker.create',
      '  allowed_tools:',
      '    - Bash',
      '',
      'mission:',
      '  summary: |',
      '    ```bash',
      '    toolchain-cli preflight --require tracker.show --json',
      '    ```',
    ].join('\n') + '\n';
    expect(checkCommandStructure(content).map(v => v.class)).toEqual(['MISSING_PREFLIGHT']);
  });

  test('a command with no capabilities.required at all is not this check\'s concern', () => {
    const content = 'metadata:\n  name: cmd-f\n  allowed_tools:\n    - Read\n';
    expect(checkCommandStructure(content)).toEqual([]);
  });
});

describe('checkCommandStructure: skill-backed manifests', () => {
  // A manifest keeps metadata (capabilities, allowed_tools) but holds no prose: the preflight
  // line, like the rest of the prompt, lives in the skill it points at.
  const manifest = (allowedTools = ['Read', 'Bash']) => [
    'metadata:',
    '  name: cmd-s',
    '  capabilities:',
    '    required:',
    '      - tracker.show',
    '  allowed_tools:',
    ...allowedTools.map(tool => `    - ${tool}`),
    'skill: ensemble-s',
    ''
  ].join('\n');
  const skillWithPreflight = '# S\n\n```bash\ntoolchain-cli preflight --require tracker.show --json\n```\n';
  const skillWithoutPreflight = '# S\n\nNothing is preflighted here.\n';

  test('finds the preflight line in the skill, not in the manifest', () => {
    expect(checkCommandStructure(manifest(), () => skillWithPreflight)).toEqual([]);
  });

  test('a skill without the preflight line -> MISSING_PREFLIGHT', () => {
    expect(checkCommandStructure(manifest(), () => skillWithoutPreflight).map(v => v.class)).toEqual(['MISSING_PREFLIGHT']);
  });

  test('a skill that cannot be read counts as having no preflight line (the check fails closed)', () => {
    expect(checkCommandStructure(manifest(), () => null).map(v => v.class)).toEqual(['MISSING_PREFLIGHT']);
    expect(checkCommandStructure(manifest()).map(v => v.class)).toEqual(['MISSING_PREFLIGHT']);
  });

  test('MISSING_BASH_GRANT is still judged from the manifest metadata', () => {
    expect(checkCommandStructure(manifest(['Read']), () => skillWithPreflight).map(v => v.class)).toEqual(['MISSING_BASH_GRANT']);
  });

  test('lintRoot reads the skill from the skills/ directory of the manifest\'s own package', () => {
    const root = trackedRoot('lint-skill-backed-');
    seedInventory(root);
    writeFile(root, 'packages/x/commands/y.yaml', manifest());
    writeFile(root, 'packages/x/skills/ensemble-s/SKILL.md', skillWithPreflight);
    expect(lintRoot(root)).toEqual([]);

    writeFile(root, 'packages/x/skills/ensemble-s/SKILL.md', skillWithoutPreflight);
    expect(lintRoot(root).map(v => v.class)).toEqual(['MISSING_PREFLIGHT']);
  });

  test('lintRoot reads the skill\'s references too: a preflight line that lives only in a reference satisfies the check', () => {
    const root = trackedRoot('lint-skill-references-');
    seedInventory(root);
    writeFile(root, 'packages/x/commands/y.yaml', manifest());
    writeFile(root, 'packages/x/skills/ensemble-s/SKILL.md', skillWithoutPreflight);
    expect(lintRoot(root).map(v => v.class)).toEqual(['MISSING_PREFLIGHT']);

    writeFile(root, 'packages/x/skills/ensemble-s/references/phase-1.md', skillWithPreflight);
    expect(lintRoot(root)).toEqual([]);
  });
});

describe('require.main guard', () => {
  test('require()-ing the module runs no scan and calls no process.exit', () => {
    const out = execFileSync(process.execPath, ['-e', `
      require(${JSON.stringify(SCRIPT_PATH)});
      console.log('REQUIRE_COMPLETED_NO_EXIT');
    `], { encoding: 'utf8' });
    expect(out.trim()).toBe('REQUIRE_COMPLETED_NO_EXIT');
  });
});

describe('committed deliberate-violation fixture', () => {
  test('lintRoot(violation fixture) reports one BINARY_IN_COMMAND violation naming bad.yaml', () => {
    const violations = lintRoot(VIOLATION_FIXTURE_ROOT);
    expect(violations).toHaveLength(1);
    expect(violations[0].class).toBe('BINARY_IN_COMMAND');
    expect(violations[0].binary).toBe('gh');
    expect(path.basename(violations[0].file)).toBe('bad.yaml');
  });

  test('running the script with the fixture as cwd exits 1 and names bad.yaml', () => {
    expect(() => {
      execFileSync(process.execPath, [SCRIPT_PATH], { cwd: VIOLATION_FIXTURE_ROOT, encoding: 'utf8' });
    }).toThrow();

    let output = '';
    try {
      execFileSync(process.execPath, [SCRIPT_PATH], { cwd: VIOLATION_FIXTURE_ROOT, encoding: 'utf8' });
    } catch (err) {
      output = (err.stdout || '') + (err.stderr || '');
      expect(err.status).toBe(1);
    }
    expect(output).toContain('bad.yaml');
  });
});

const BASELINE_REL = 'scripts/lint-provider-refs.baseline.json';
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const {
  isNamedSource,
  scanRoot,
  applyBaseline,
  buildBaseline,
  readBaseline
} = require('../lint-provider-refs');

function writeBaseline(root, entries) {
  writeFile(root, BASELINE_REL, JSON.stringify({ version: 1, entries }));
}

function runCli(root, args = []) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT_PATH, ...args], { cwd: root, encoding: 'utf8' });
    return { status: 0, stdout };
  } catch (err) {
    return { status: err.status, stdout: (err.stdout || '') + (err.stderr || '') };
  }
}

describe('TRD-047-TEST scenarios', () => {
  test('heaviest-coupled named sources report no violation in the real repo', () => {
    const failing = lintRoot(REPO_ROOT).filter(v => isNamedSource(path.relative(REPO_ROOT, v.file).split(path.sep).join('/')));
    expect(failing.map(v => `${path.relative(REPO_ROOT, v.file)}:${v.line} ${v.class} ${v.binary}`)).toEqual([]);
  });

  test('added `br list` on line 12 fails the CLI, naming file and :12', () => {
    const root = trackedRoot('lint-line12-');
    seedInventory(root, { tracker: ['br'] });
    const lines = Array(11).fill('# filler'); // fence opens on line 1, br list lands on line 12
    writeFile(root, 'packages/x/commands/y.yaml', ['```bash', ...lines.slice(1), 'br list', '```', ''].join('\n'));
    const res = runCli(root);
    expect(res.status).toBe(1);
    expect(res.stdout).toContain('packages/x/commands/y.yaml:12');
  });

  test('gh pr create on line 7 yields exactly one BINARY_IN_COMMAND violation', () => {
    const root = trackedRoot('lint-line7-');
    seedInventory(root, { host: ['gh'] });
    writeFile(root, 'packages/x/commands/y.yaml', ['a', 'b', 'c', 'd', '```bash', 'e', 'gh pr create', '```', ''].join('\n'));
    const v = lintRoot(root);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ line: 7, binary: 'gh', class: 'BINARY_IN_COMMAND' });
    expect(v[0].file.endsWith('y.yaml')).toBe(true);
  });

  test('adapter-* skill naming its own binary exits 0 and prints the scanned count', () => {
    const root = trackedRoot('lint-adapter-cli-');
    seedInventory(root, { host: ['gh'] });
    writeFile(root, 'packages/x/skills/adapter-host-gh/SKILL.md', '```bash\ngh pr create\n```\n');
    writeFile(root, 'packages/x/commands/ok.yaml', 'name: ok\n');
    const res = runCli(root);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/1 file\(s\) scanned/);
  });

  test('the committed deliberate-violation fixture fails the CLI, naming bad.yaml', () => {
    const res = runCli(VIOLATION_FIXTURE_ROOT);
    expect(res.status).toBe(1);
    expect(res.stdout).toContain('bad.yaml');
  });
});

describe('internal CLI and ignoredCommands exemptions', () => {
  const binaries = new Set(['node', 'git', 'cat']);

  test.each([
    'node "$TRD_CLI" parse x',
    'node $TOOLCHAIN_CLI run tracker.show',
    'node "${TRD_CLI}" parse x'
  ])('`%s` is not a violation', line => {
    expect(findViolations(`\`\`\`bash\n${line}\n\`\`\`\n`, binaries)).toEqual([]);
  });

  test('node with a plain script path is still a violation', () => {
    expect(findViolations('```bash\nnode scripts/x.js\n```\n', binaries)).toHaveLength(1);
    expect(findViolations('```bash\nnode "$TRD_TOOL" x\n```\n', binaries)).toHaveLength(1);
  });

  test('tokens in ignoredCommands are never violations even if an adapter declares them', () => {
    const root = trackedRoot('lint-ignored-');
    writeFile(root, 'packages/x/skills/adapter-tracker-t/adapter.yaml',
      'adapter: t\ncategories: [tracker]\nbinaries: [cat, br]\n');
    writeFile(root, 'packages/development/toolchain/tool-inventory.yaml',
      'tracker:\n  - br\nignoredCommands:\n  - cat\n');
    writeFile(root, 'packages/x/commands/y.yaml', 'x: |\n  ```bash\n  cat file\n  br list\n  ```\n');
    const v = lintRoot(root);
    expect(v.map(x => x.binary)).toEqual(['br']);
  });

  test('plain git is a violation but `node "$TOOLCHAIN_CLI" run workflow.x` is not', () => {
    const root = trackedRoot('lint-git-');
    seedInventory(root, { workflow: ['git'], 'package-runner': ['node'] });
    writeFile(root, 'packages/x/commands/y.yaml',
      'x: |\n  ```bash\n  git status\n  node "$TOOLCHAIN_CLI" run workflow.commit --run-id "$RUN_ID"\n  ```\n');
    const v = lintRoot(root);
    expect(v.map(x => x.binary)).toEqual(['git']);
  });
});

describe('ratchet baseline', () => {
  function rootWithTwoGh(extraEntries) {
    const root = trackedRoot('lint-ratchet-');
    seedInventory(root, { host: ['gh'] });
    writeFile(root, 'packages/x/skills/s/SKILL.md', '```bash\ngh pr list\ngh pr view\n```\n');
    writeBaseline(root, extraEntries);
    return root;
  }
  const entry = count => ({ file: 'packages/x/skills/s/SKILL.md', class: 'BINARY_IN_SKILL', binary: 'gh', count });

  test('count equal to baseline passes', () => {
    expect(lintRoot(rootWithTwoGh([entry(2)]))).toEqual([]);
  });

  test('count over baseline fails', () => {
    expect(lintRoot(rootWithTwoGh([entry(1)]))).toHaveLength(2);
  });

  test('key absent from baseline fails', () => {
    expect(lintRoot(rootWithTwoGh([]))).toHaveLength(2);
  });

  test('count under baseline passes and prints a `baseline can shrink` hint', () => {
    const root = rootWithTwoGh([entry(5)]);
    expect(lintRoot(root)).toEqual([]);
    const res = runCli(root);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('baseline can shrink');
  });

  test('a named source fails even when the baseline lists it', () => {
    const root = trackedRoot('lint-named-');
    seedInventory(root, { host: ['gh'] });
    writeFile(root, 'packages/development/commands/beads-build.yaml', 'x: |\n  ```bash\n  gh pr list\n  ```\n');
    writeBaseline(root, [{ file: 'packages/development/commands/beads-build.yaml', class: 'BINARY_IN_COMMAND', binary: 'gh', count: 1 }]);
    expect(lintRoot(root)).toHaveLength(1);
  });

  test('isNamedSource covers the nine named sources and their generated md', () => {
    for (const rel of [
      'packages/development/commands/implement-trd-beads.yaml',
      'packages/development/commands/ensemble/beads-build-wave.md',
      'packages/development/commands/implement-bead.yaml',
      'packages/development/commands/ensemble/refine-beads.md',
      'packages/development/commands/fix-issue.yaml',
      'packages/git/commands/pr-merge.yaml',
      'packages/git/commands/ensemble/pr-merge.md',
      'packages/git/skills/git-town/SKILL.md',
      'packages/development/skills/pr-review-cycle/SKILL.md'
    ]) expect(isNamedSource(rel)).toBe(true);
    expect(isNamedSource('packages/development/commands/ensemble/retro.md')).toBe(false);
  });

  test('isNamedSource keeps the zero tolerance after a named command becomes skill-backed: its skill and references are named', () => {
    for (const cmd of ['implement-trd-beads', 'beads-build', 'implement-bead', 'refine-beads', 'fix-issue']) {
      expect(isNamedSource(`packages/development/skills/ensemble-${cmd}/SKILL.md`)).toBe(true);
      expect(isNamedSource(`packages/development/skills/ensemble-${cmd}/references/phase-1-x.md`)).toBe(true);
    }
    expect(isNamedSource('packages/development/skills/ensemble-retro/SKILL.md')).toBe(false);
  });

  test('--update-baseline writes the baseline from the tree', () => {
    const root = rootWithTwoGh([]);
    const res = runCli(root, ['--update-baseline']);
    expect(res.status).toBe(0);
    const counts = [...readBaseline(root).values()];
    expect(counts).toEqual([2]);
    expect(runCli(root).status).toBe(0);
  });

  test('--update-baseline refuses while a named source has a violation and writes nothing', () => {
    const root = trackedRoot('lint-refuse-');
    seedInventory(root, { host: ['gh'] });
    writeFile(root, 'packages/git/commands/pr-merge.yaml', 'x: |\n  ```bash\n  gh pr merge\n  ```\n');
    const res = runCli(root, ['--update-baseline']);
    expect(res.status).toBe(1);
    expect(fs.existsSync(path.join(root, BASELINE_REL))).toBe(false);
  });

  test('buildBaseline never records named violations; applyBaseline keys ignore line numbers', () => {
    const doc = buildBaseline([
      { rel: 'a.md', class: 'BINARY_IN_SKILL', binary: 'gh', named: false, line: 3 },
      { rel: 'a.md', class: 'BINARY_IN_SKILL', binary: 'gh', named: false, line: 90 },
      { rel: 'n.md', class: 'BINARY_IN_SKILL', binary: 'gh', named: true, line: 1 }
    ]);
    expect(doc.entries).toEqual([{ file: 'a.md', class: 'BINARY_IN_SKILL', binary: 'gh', count: 2 }]);
    const moved = [{ rel: 'a.md', class: 'BINARY_IN_SKILL', binary: 'gh', named: false, line: 40 },
      { rel: 'a.md', class: 'BINARY_IN_SKILL', binary: 'gh', named: false, line: 41 }];
    expect(applyBaseline(moved, new Map([[JSON.stringify(['a.md', 'BINARY_IN_SKILL', 'gh']), 2]])).failures).toEqual([]);
  });

  test('the real repo has no named-source entry in the committed baseline', () => {
    const doc = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, BASELINE_REL), 'utf8'));
    expect(doc.entries.filter(e => isNamedSource(e.file))).toEqual([]);
  });

  test('a $TOOLCHAIN_CLI preflight line satisfies MISSING_PREFLIGHT', () => {
    const content = [
      'metadata:', '  allowed_tools: [Bash]', '  capabilities:', '    required: [tracker.show]',
      'mission: |', '  node "$TOOLCHAIN_CLI" preflight --require tracker.show', ''
    ].join('\n');
    expect(checkCommandStructure(content)).toEqual([]);
  });
});
