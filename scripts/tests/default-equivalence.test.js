/**
 * Default-toolchain equivalence snapshot tests (TRD-2026-8d825f54 TRD-049 / TRD-049-TEST,
 * PRD REQ-024, AC-024-1, AC-024-2).
 *
 * With no `.ensemble/toolchain.yaml` present, every refactored command/skill must produce the
 * same instruction sequence (same binaries, subcommands and order) as the pre-refactor source at
 * the commit recorded in `fixtures/default-equivalence/BASE_REF`, except for the recorded and
 * justified deviations stored in each golden.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const {
  ROOT,
  FIXTURE_DIR,
  COVERED,
  readBaseRef,
  gitShow,
  preSequence,
  postSequence,
  readPostSource,
  accountDeviations,
  diffSequences,
  loadGolden
} = require('../lib/default-equivalence');
const { loadDefaultTemplates } = require('../lib/instruction-sequence');
const { resolveCategory } = require('../../packages/development/lib/toolchain/config');

const BASE_REF = readBaseRef();
const defaults = yaml.load(
  fs.readFileSync(path.join(ROOT, 'packages/development/toolchain/toolchain.default.yaml'), 'utf8')
);

const unit = (name) => COVERED.find((u) => u.name === name);
const key = (s) => `${s[0]} ${s[1]}`;

/** Problems (naming the command and step index) when `unitDef` deviates from its golden. */
function compareUnit(unitDef, templates) {
  const golden = loadGolden(unitDef.name);
  const expected = golden.expectedPost || golden.sequence;
  const source = readPostSource(unitDef.path);
  const post = postSequence(source.text, unitDef.path, templates, source.kind);
  const problems = post.unresolved.map((id) => `${unitDef.name}: unresolvable capability call ${id}`);
  const unresolvedPre = post.preflight.filter((s) => s[0] === '<unresolved>');
  for (const s of unresolvedPre) problems.push(`${unitDef.name}: unresolvable preflight capability ${s[1]}`);
  for (const d of diffSequences(expected, post.sequence)) problems.push(`${unitDef.name}: ${d}`);
  return problems;
}

function assertEquivalent(unitDef, templates) {
  const problems = compareUnit(unitDef, templates);
  if (problems.length > 0) throw new Error(problems.join('\n'));
}

/** Copy of one default adapter manifest with `from` replaced by `to`; returns its new path. */
function mutatedManifest(tmpDir, adapterDirName, manifestRelPath, from, to) {
  const original = fs.readFileSync(path.join(ROOT, manifestRelPath), 'utf8');
  const mutated = original.replace(from, to);
  expect(mutated).not.toBe(original);
  const dir = path.join(tmpDir, adapterDirName);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'adapter.yaml');
  fs.writeFileSync(file, mutated);
  return file;
}

describe('default-equivalence fixtures (TRD-049)', () => {
  it('BASE_REF holds a 40-character commit id', () => {
    expect(BASE_REF).toMatch(/^[0-9a-f]{40}$/);
  });

  it('commits one golden JSON per covered command', () => {
    const files = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'));
    for (const u of COVERED) expect(files).toContain(`${u.name}.json`);
    const covered = new Set(COVERED.map((u) => `${u.name}.json`));
    const extra = files.filter((f) => !covered.has(f) && f !== 'change-request-host.json');
    expect(extra).toEqual([]);
  });

  it('covers every command the TRD-049 task names', () => {
    const named = [
      'list-issue', 'requirement-status', 'analyze-complexity', 'onboard', 'retro', 'refine-beads',
      'implement-bead', 'beads-build-wave', 'beads-build', 'implement-trd-beads', 'pr-merge', 'fix-issue'
    ];
    const names = COVERED.map((u) => u.name);
    for (const n of named) expect(names).toContain(n);
  });

  describe.each(COVERED.map((u) => [u.name, u]))('golden %s', (name, u) => {
    const golden = loadGolden(name);

    it('records BASE_REF, source path and a non-empty sequence', () => {
      expect(golden.baseRef).toBe(BASE_REF);
      expect(golden.path).toBe(u.path);
      expect(golden.sequence.length).toBeGreaterThan(0);
    });

    it('matches the sequence extracted from git show <BASE_REF>:<path>', () => {
      const pre = gitShow(BASE_REF, u.path);
      if (pre === null) {
        // BASE_REF object unavailable (shallow clone): the committed golden is the only record.
        console.warn(`default-equivalence: ${BASE_REF} not present locally; skipping git show check for ${name}`);
        return;
      }
      expect(preSequence(pre, u.path)).toEqual(golden.sequence);
    });

    it('accounts for every pre/post difference with a justified deviation', () => {
      const expected = golden.expectedPost || golden.sequence;
      const deviations = golden.deviations || [];
      if (!golden.expectedPost) expect(deviations).toEqual([]);
      expect(accountDeviations(golden.sequence, expected, deviations)).toEqual([]);
    });
  });
});

describe('Scenario: Refactored commands match pre-refactor snapshots (TRD-049-TEST)', () => {
  let templates;
  let projectDir;

  beforeAll(() => {
    // Given an unconfigured project with no .ensemble/toolchain.yaml
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'default-equivalence-project-'));
    expect(fs.existsSync(path.join(projectDir, '.ensemble', 'toolchain.yaml'))).toBe(false);
    templates = loadDefaultTemplates(ROOT);
  });

  afterAll(() => fs.rmSync(projectDir, { recursive: true, force: true }));

  it('resolves every category to the shipped default in the unconfigured project', () => {
    const env = { HOME: projectDir, XDG_CONFIG_HOME: path.join(projectDir, 'xdg') };
    for (const [category, adapter] of Object.entries(defaults)) {
      expect(resolveCategory(category, { projectRoot: projectDir, env })).toEqual({
        value: adapter,
        source: 'default'
      });
    }
  });

  it('resolves capability templates from the default adapter of each category only', () => {
    expect(templates.get('tracker.show')).toEqual(['br', 'show', '${id}', '--json']);
    expect(templates.get('host.change-request-create')[0]).toBe('gh');
    expect(templates.get('workflow.branch-create')).toEqual(['git', 'switch', '-c', '${name}']);
    expect(templates.has('workflow.sync')).toBe(false); // git-town-only capability, not the default adapter
  });

  it.each(COVERED.map((u) => [u.name, u]))('%s: default sequence equals golden', (name, u) => {
    assertEquivalent(u, templates);
  });
});

describe('Scenario: Opening a change request yields the same default-host sequence (TRD-049-TEST)', () => {
  const templates = loadDefaultTemplates(ROOT);
  const hostGolden = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'change-request-host.json'), 'utf8'));
  const ghSteps = (seq) => seq.filter((s) => s[0] === 'gh').map(key);
  const postOf = (name) => {
    const u = unit(name);
    const source = readPostSource(u.path);
    return postSequence(source.text, u.path, templates, source.kind).sequence;
  };
  const preOf = (name) => loadGolden(name).sequence;

  it('golden default-host sequence is gh pr create, then gh pr view, then gh pr merge', () => {
    expect(hostGolden.baseRef).toBe(BASE_REF);
    expect(hostGolden.sequence.map(key)).toEqual(['gh pr create', 'gh pr view', 'gh pr merge']);
  });

  it('golden is the order the pre-refactor sources performed these steps in', () => {
    // implement-bead opened the change request; pr-merge viewed then merged it.
    expect(ghSteps(preOf('implement-bead'))).toContain('gh pr create');
    const prMerge = ghSteps(preOf('pr-merge'));
    expect(prMerge.indexOf('gh pr view')).toBeGreaterThanOrEqual(0);
    expect(prMerge.indexOf('gh pr view')).toBeLessThan(prMerge.indexOf('gh pr merge'));
  });

  it('pr-merge host steps keep the golden view-then-merge order', () => {
    const host = ghSteps(postOf('pr-merge'));
    expect(host.indexOf('gh pr view')).toBeGreaterThanOrEqual(0);
    expect(host.indexOf('gh pr view')).toBeLessThan(host.indexOf('gh pr merge'));
  });

  it('implement-bead opens the change request with the golden host step', () => {
    const host = ghSteps(postOf('implement-bead'));
    expect(host).toContain(key(hostGolden.sequence[0]));
    expect(host).toEqual(ghSteps(loadGolden('implement-bead').expectedPost || preOf('implement-bead')));
  });

  it('the opening step and the follow-up steps together equal the golden host sequence', () => {
    const lifecycle = [
      ...ghSteps(postOf('implement-bead')).filter((s) => s === 'gh pr create'),
      ...ghSteps(postOf('pr-merge')).filter((s) => s === 'gh pr view' || s === 'gh pr merge')
    ];
    expect(lifecycle).toEqual(hostGolden.sequence.map(key));
  });

  it('every command that opens a change request resolves it through the default host adapter', () => {
    for (const name of ['implement-bead', 'fix-issue', 'beads-build']) {
      const u = unit(name);
      const { text, kind } = readPostSource(u.path);
      const steps = postSequence(text, u.path, templates, kind).sequence;
      expect(ghSteps(steps)).toContain('gh pr create');
      expect(text).toMatch(/run\s+host\.change-request-create/);
    }
  });
});

describe('Scenario: a mutated default adapter template fails the comparison (TRD-049 Implementation AC 3)', () => {
  let tmpDir;
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'default-equivalence-mutant-'));
  });
  afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('passes against the unmutated default templates (control)', () => {
    expect(() => assertEquivalent(unit('implement-bead'), loadDefaultTemplates(ROOT))).not.toThrow();
  });

  it('fails naming the command and step index when host.change-request-create changes subcommand', () => {
    const manifest = mutatedManifest(
      tmpDir,
      'create',
      'packages/git/skills/adapter-host-github/adapter.yaml',
      /(host\.change-request-create:\s*\n\s*run:\s*\n\s*- gh\s*\n\s*- pr\s*\n\s*- )create/,
      '$1new'
    );
    const templates = loadDefaultTemplates(ROOT, { manifestOverrides: { 'adapter-host-github': manifest } });
    expect(templates.get('host.change-request-create').slice(0, 3)).toEqual(['gh', 'pr', 'new']);
    const u = unit('implement-bead');
    const expected = loadGolden('implement-bead').expectedPost;
    const index = expected.findIndex((s) => key(s) === 'gh pr create');
    expect(index).toBeGreaterThanOrEqual(0);
    expect(() => assertEquivalent(u, templates)).toThrow(
      new RegExp(`implement-bead: step ${index}: expected "gh pr create" but found "gh pr new"`)
    );
  });

  it('fails naming pr-merge and its step index when host.change-request-merge changes subcommand', () => {
    const manifest = mutatedManifest(
      tmpDir,
      'merge',
      'packages/git/skills/adapter-host-github/adapter.yaml',
      /(host\.change-request-merge:\s*\n\s*run:\s*\n\s*- gh\s*\n\s*- pr\s*\n\s*- )merge/,
      '$1land'
    );
    const templates = loadDefaultTemplates(ROOT, { manifestOverrides: { 'adapter-host-github': manifest } });
    const expected = loadGolden('pr-merge').expectedPost || loadGolden('pr-merge').sequence;
    const index = expected.findIndex((s) => key(s) === 'gh pr merge');
    expect(index).toBeGreaterThanOrEqual(0);
    expect(() => assertEquivalent(unit('pr-merge'), templates)).toThrow(
      new RegExp(`pr-merge: step ${index}: expected "gh pr merge" but found "gh pr land"`)
    );
  });

  it('fails for a mutated tracker template naming the command', () => {
    const manifest = mutatedManifest(
      tmpDir,
      'beads',
      'packages/development/skills/adapter-tracker-beads/adapter.yaml',
      'run: ["br", "close", "${id}", "--json"]',
      'run: ["br", "finish", "${id}", "--json"]'
    );
    const templates = loadDefaultTemplates(ROOT, { manifestOverrides: { 'adapter-tracker-beads': manifest } });
    expect(() => assertEquivalent(unit('implement-bead'), templates)).toThrow(/implement-bead: step \d+: expected "br close" but found "br finish"/);
  });
});
