'use strict';
/**
 * Tests for scripts/generate-codex/index.js's parseFrontmatter CRLF fix,
 * and for its dispatcher-command "## Subcommands" rendering (additive
 * dispatcher-command mechanism; see local://dispatcher-command-design.md).
 *
 * The delimiter regex requires a literal '\n' next to '---', so a
 * CRLF-sourced SKILL.md/agent .md (the norm on Windows checkouts with
 * core.autocrlf=true) silently discarded real frontmatter as if it were
 * part of the body.
 */

const fs = require('fs');
const path = require('path');
const {
  parseFrontmatter,
  buildCodexAgentsMd,
  detectAgentSkills,
  generateCodexSubcommandsSection,
  generateCommandSkills,
  normalizeSkillBody,
  sandboxModeFor,
  copyAdapterSkills,
  vendorCodexToolchain,
} = require('../generate-codex/index.js');
const { makeCodexTempRoot } = require('./fixtures/codex-generate/temp-codex-root');

// The control the temp-root runs below generate beside the fixture under test: an ordinary command, one
// that is neither skill-backed (no `skill:`) nor a dispatcher (no `dispatch:`), so the generator renders a
// wrapper for it. Every real command is now one or the other, so it is a synthetic fixture written into
// the temp root, not a copy of a real one.
const ORDINARY_NAME = 'ordinary-control';
const ORDINARY_SKILL = `ensemble-${ORDINARY_NAME}`;
function seedOrdinaryControl(tmp) {
  const commandsDir = path.join(tmp.packagesDir, 'git', 'commands');
  fs.mkdirSync(path.join(commandsDir, 'ensemble'), { recursive: true });
  fs.writeFileSync(
    path.join(commandsDir, `${ORDINARY_NAME}.yaml`),
    [
      'metadata:',
      `  name: ensemble:${ORDINARY_NAME}`,
      '  description: Fixture ordinary command (neither skill-backed nor a dispatcher)',
      '  version: 1.0.0',
      'workflow:',
      '  phases:',
      '    - order: 1',
      '      name: Only Phase',
      '      steps:',
      '        - order: 1',
      '          title: Only Step',
      '          actions:',
      '            - Do the one thing.',
      '',
    ].join('\n')
  );
  fs.writeFileSync(
    path.join(commandsDir, 'ensemble', `${ORDINARY_NAME}.md`),
    [
      '---',
      `name: "ensemble:${ORDINARY_NAME}"`,
      'description: "Fixture ordinary command (neither skill-backed nor a dispatcher)"',
      'version: "1.0.0"',
      '---',
      '',
      '# Only Phase',
      '',
      'Do the one thing.',
      '',
    ].join('\n')
  );
}

describe('parseFrontmatter — CRLF line endings', () => {
  const CRLF_CONTENT =
    '---\r\nname: my-agent\r\ndescription: A test agent\r\n---\r\n\r\n# Body\r\n';

  test('detects frontmatter despite \\r\\n around the delimiters', () => {
    const { data } = parseFrontmatter(CRLF_CONTENT);
    expect(data).toEqual({ name: 'my-agent', description: 'A test agent' });
  });

  test('extracts body content with the frontmatter block removed', () => {
    const { content } = parseFrontmatter(CRLF_CONTENT);
    expect(content.trim()).toBe('# Body');
  });

  test('LF content still parses the same as before (no regression)', () => {
    const lfContent = '---\nname: my-agent\ndescription: A test agent\n---\n\n# Body\n';
    expect(parseFrontmatter(lfContent).data).toEqual({ name: 'my-agent', description: 'A test agent' });
  });

  test('no-frontmatter CRLF content reports empty data, not a false match', () => {
    const { data, content } = parseFrontmatter('# Body only\r\n\r\nNo frontmatter here.\r\n');
    expect(data).toEqual({});
    expect(content).toContain('Body only');
  });
});

describe('generateCodexSubcommandsSection', () => {
  test('renders one bullet per subcommand, pointing at the sibling Codex SKILL.md', () => {
    const baseNameToYamlFile = new Map([
      ['fix-issue', '/repo/packages/development/commands/fix-issue.yaml'],
      ['list-issue', '/repo/packages/development/commands/list-issue.yaml'],
    ]);
    const section = generateCodexSubcommandsSection(
      [
        { keyword: 'fix', ref: 'fix-issue', description: 'Fix open bug-report lightweight fixes' },
        { keyword: 'list', ref: 'list-issue', description: '' },
      ],
      baseNameToYamlFile,
      '/repo/packages/development/commands/issue.yaml'
    );

    expect(section).toMatch(/^## Subcommands\n\n/);
    expect(section).toContain(
      '- **`fix`** - Fix open bug-report lightweight fixes. see the `ensemble-fix-issue` skill (`packages/codex/.codex/skills/commands/ensemble-fix-issue/SKILL.md`).'
    );
    expect(section).toContain(
      '- **`list`** - see the `ensemble-list-issue` skill (`packages/codex/.codex/skills/commands/ensemble-list-issue/SKILL.md`).'
    );
  });

  test('throws when a subcommand ref has no matching sibling YAML', () => {
    expect(() =>
      generateCodexSubcommandsSection(
        [{ keyword: 'fix', ref: 'does-not-exist', description: '' }],
        new Map(),
        '/repo/packages/development/commands/issue.yaml'
      )
    ).toThrow(/references unknown command 'does-not-exist'/);
  });

  test('collapses multi-line/whitespace-heavy descriptions to a single sentence prefix', () => {
    const section = generateCodexSubcommandsSection(
      [{ keyword: 'fix', ref: 'fix-issue', description: 'Line one\n  Line   two  ' }],
      new Map([['fix-issue', '/repo/packages/development/commands/fix-issue.yaml']]),
      '/repo/packages/development/commands/issue.yaml'
    );
    expect(section).toContain('- **`fix`** - Line one Line two. see the `ensemble-fix-issue` skill');
  });
});

describe('generateCommandSkills — dispatcher commands (temp-root smoke run, TRD-020 test-isolation fix)', () => {
  let baseRoot;
  let fixtureRoot;

  function writeFixtureCommands(packagesDir) {
    const fixtureCommandsDir = path.join(packagesDir, 'codex-dispatch-fixture', 'commands');
    fs.mkdirSync(fixtureCommandsDir, { recursive: true });
    fs.writeFileSync(
      path.join(fixtureCommandsDir, 'dispatcher-fixture.yaml'),
      [
        'metadata:',
        '  name: ensemble:dispatcher-fixture',
        '  description: Fixture dispatcher command for Codex subcommand rendering test',
        'dispatch:',
        '  subcommands:',
        '    - keyword: sub',
        '      ref: subcommand-fixture',
        '      description: Fixture leaf subcommand',
        '',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(fixtureCommandsDir, 'subcommand-fixture.yaml'),
      ['metadata:', '  name: ensemble:subcommand-fixture', '  description: Fixture leaf command', ''].join('\n')
    );
  }

  beforeAll(() => {
    // Two isolated temp roots, both seeded with the same synthetic dispatch-free
    // command (the ordinary control): baseRoot has nothing else, fixtureRoot additionally has the
    // throwaway dispatcher fixture. Comparing the control's generated output between the two is
    // an A/B idempotency proof that the fixture doesn't perturb unrelated output -- without
    // ever reading, writing, or deleting anything under the live repo's generated output.
    baseRoot = makeCodexTempRoot();
    seedOrdinaryControl(baseRoot);
    generateCommandSkills({
      dryRun: false,
      verbose: false,
      packagesDir: baseRoot.packagesDir,
      outputDir: baseRoot.outputDir,
      rootDir: baseRoot.rootDir,
    });

    fixtureRoot = makeCodexTempRoot();
    seedOrdinaryControl(fixtureRoot);
    writeFixtureCommands(fixtureRoot.packagesDir);
    generateCommandSkills({
      dryRun: false,
      verbose: false,
      packagesDir: fixtureRoot.packagesDir,
      outputDir: fixtureRoot.outputDir,
      rootDir: fixtureRoot.rootDir,
    });
  });

  afterAll(() => {
    baseRoot.cleanup();
    fixtureRoot.cleanup();
  });

  test('always reads the raw YAML .dispatch field (invisible in frontmatter-only .md) and appends a ## Subcommands section', () => {
    // Runs the real end-to-end generator (globs every <packagesDir>/*/commands/*.yaml,
    // including our throwaway fixture pair) so this proves the live wiring, not just the
    // pure-function unit tests above.
    const dispatcherSkillDir = path.join(fixtureRoot.outputDir, 'skills', 'commands', 'ensemble-dispatcher-fixture');
    const leafSkillDir = path.join(fixtureRoot.outputDir, 'skills', 'commands', 'ensemble-subcommand-fixture');

    const dispatcherSkill = fs.readFileSync(path.join(dispatcherSkillDir, 'SKILL.md'), 'utf-8');
    expect(dispatcherSkill).toContain('## Subcommands');
    expect(dispatcherSkill).toContain(
      '- **`sub`** - Fixture leaf subcommand. see the `ensemble-subcommand-fixture` skill (`packages/codex/.codex/skills/commands/ensemble-subcommand-fixture/SKILL.md`).'
    );
    // Subcommands section must land before the mirrored body, per Claude Code's
    // Title -> ... -> Subcommands -> Workflow section order.
    expect(dispatcherSkill.indexOf('## Subcommands')).toBeLessThan(
      dispatcherSkill.indexOf('Fixture dispatcher command for Codex subcommand rendering test')
    );

    const leafSkill = fs.readFileSync(path.join(leafSkillDir, 'SKILL.md'), 'utf-8');
    expect(leafSkill).not.toContain('## Subcommands');

    // Idempotency/no-regression proof: the ordinary, dispatch-free control command
    // generates byte-identical output whether or not the fixture dispatcher
    // package is also present in packagesDir.
    const baselineFixIssue = fs.readFileSync(
      path.join(baseRoot.outputDir, 'skills', 'commands', ORDINARY_SKILL, 'SKILL.md')
    );
    const afterFixIssue = fs.readFileSync(
      path.join(fixtureRoot.outputDir, 'skills', 'commands', ORDINARY_SKILL, 'SKILL.md')
    );
    expect(afterFixIssue.equals(baselineFixIssue)).toBe(true);
  });
});

describe('generateCommandSkills — metadata.visibility (temp-root smoke run, TRD-020 test-isolation fix)', () => {
  const yaml = require('js-yaml');
  let tmp;

  const skillDir = (n) => path.join(tmp.outputDir, 'skills', 'commands', `ensemble-${n}`);
  const readSkill = (n) => fs.readFileSync(path.join(skillDir(n), 'SKILL.md'), 'utf-8');
  const frontmatterOf = (n) => yaml.load(readSkill(n).split('---\n')[1]);

  beforeAll(() => {
    tmp = makeCodexTempRoot();
    const fixtureCommandsDir = path.join(tmp.packagesDir, 'codex-visibility-fixture', 'commands');
    fs.mkdirSync(fixtureCommandsDir, { recursive: true });
    const write = (n, body) =>
      fs.writeFileSync(path.join(fixtureCommandsDir, `${n}.yaml`), body.join('\n') + '\n');
    write('vis-hub-fixture', [
      'metadata:',
      '  name: ensemble:vis-hub-fixture',
      '  description: Fixture dispatcher',
      'dispatch:',
      '  subcommands:',
      '    - keyword: hidden',
      '      ref: vis-hidden-fixture',
      '      description: Hidden leaf',
      '    - keyword: shown',
      '      ref: vis-shown-fixture',
      '      description: Shown leaf',
    ]);
    write('vis-hidden-fixture', [
      'metadata:',
      '  name: ensemble:vis-hidden-fixture',
      '  description: Fixture hidden leaf',
      '  visibility: hidden',
    ]);
    write('vis-shown-fixture', [
      'metadata:',
      '  name: ensemble:vis-shown-fixture',
      '  description: Fixture visible leaf',
    ]);
    generateCommandSkills({
      dryRun: false,
      verbose: false,
      packagesDir: tmp.packagesDir,
      outputDir: tmp.outputDir,
      rootDir: tmp.rootDir,
    });
  });

  afterAll(() => {
    tmp.cleanup();
  });

  test('a hidden command still gets a wrapper skill, marked not user-invocable', () => {
    expect(fs.existsSync(path.join(skillDir('vis-hidden-fixture'), 'SKILL.md'))).toBe(true);
    expect(frontmatterOf('vis-hidden-fixture')['user-invocable']).toBe(false);
  });

  test('a visible command (control) stays user-invocable', () => {
    expect(frontmatterOf('vis-shown-fixture')['user-invocable']).toBe(true);
  });

  test('the dispatcher references the hidden command at its real skill path, and stays invocable', () => {
    expect(frontmatterOf('vis-hub-fixture')['user-invocable']).toBe(true);
    const hub = readSkill('vis-hub-fixture');
    expect(hub).toContain(
      '`packages/codex/.codex/skills/commands/ensemble-vis-hidden-fixture/SKILL.md`'
    );
    expect(hub).toContain(
      '`packages/codex/.codex/skills/commands/ensemble-vis-shown-fixture/SKILL.md`'
    );
  });
});

describe('generateCommandSkills — metadata.capabilities (temp-root smoke run, TRD-022)', () => {
  const yaml = require('js-yaml');
  let tmp;

  const skillDir = (n) => path.join(tmp.outputDir, 'skills', 'commands', `ensemble-${n}`);
  const readSkill = (n) => fs.readFileSync(path.join(skillDir(n), 'SKILL.md'), 'utf-8');
  const frontmatterOf = (n) => yaml.load(readSkill(n).split('---\n')[1]);

  beforeAll(() => {
    tmp = makeCodexTempRoot();
    const fixtureCommandsDir = path.join(tmp.packagesDir, 'codex-capabilities-fixture', 'commands');
    fs.mkdirSync(fixtureCommandsDir, { recursive: true });
    const write = (n, body) =>
      fs.writeFileSync(path.join(fixtureCommandsDir, `${n}.yaml`), body.join('\n') + '\n');
    write('cap-with-fixture', [
      'metadata:',
      '  name: ensemble:cap-with-fixture',
      '  description: Fixture command with capabilities',
      '  capabilities:',
      '    required: [tracker.show]',
      '    optional: [work-graph.ready]',
    ]);
    write('cap-without-fixture', [
      'metadata:',
      '  name: ensemble:cap-without-fixture',
      '  description: Fixture command with no capabilities',
    ]);
    write('cap-empty-fixture', [
      'metadata:',
      '  name: ensemble:cap-empty-fixture',
      '  description: Fixture command with an empty capabilities declaration',
      '  capabilities:',
      '    required: []',
      '    optional: []',
    ]);
    generateCommandSkills({
      dryRun: false,
      verbose: false,
      packagesDir: tmp.packagesDir,
      outputDir: tmp.outputDir,
      rootDir: tmp.rootDir,
    });
  });

  afterAll(() => {
    tmp.cleanup();
  });

  test('a command with capabilities emits a capabilities frontmatter block with both lists', () => {
    const fm = frontmatterOf('cap-with-fixture');
    expect(fm.capabilities).toEqual({ required: ['tracker.show'], optional: ['work-graph.ready'] });
  });

  test('a command without capabilities omits the key entirely (byte-identical passthrough)', () => {
    const fm = frontmatterOf('cap-without-fixture');
    expect(fm.capabilities).toBeUndefined();
    const frontmatterBlock = readSkill('cap-without-fixture').split('---\n')[1];
    expect(frontmatterBlock).not.toContain('capabilities');
  });

  // TRD-2026-8d825f54 PR 5 review P3: a present-but-empty `capabilities: {required: [],
  // optional: []}` declaration (the schema's own default shape) must render nothing, exactly
  // like the absent case above -- matching Claude (scripts/lib/command-transformer.js,
  // capabilities-required/capabilities-optional each individually length-gated), Pi
  // (packages/pi/src/transformers/command-transformer.ts#renderHeader, `required.length > 0 ||
  // optional.length > 0`), and OpenCode (scripts/generate-opencode/src/command-translator.js,
  // same length-gate). The pre-fix Codex generator emitted
  // `capabilities:\n  required: []\n  optional: []` here (a truthy-object check instead of a
  // length check), diverging from all three.
  test('a command with an empty capabilities declaration ({required: [], optional: []}) omits the key entirely, matching the absent case', () => {
    const fm = frontmatterOf('cap-empty-fixture');
    expect(fm.capabilities).toBeUndefined();
    const frontmatterBlock = readSkill('cap-empty-fixture').split('---\n')[1];
    expect(frontmatterBlock).not.toContain('capabilities');
  });
});

describe('generateCommandSkills — skill-backed commands (temp-root smoke run)', () => {
  // A source skill written to defeat any re-serialization: a comment in the frontmatter, a
  // double-quoted description with escaped quotes, nested metadata, a trailing blank line.
  const SKILL_SOURCE = [
    '---',
    '# kept verbatim, not re-dumped',
    'name: ensemble-skilled',
    'description: "Do the skilled thing, with \\"quoted\\" words. Use when asked."',
    'disable-model-invocation: true',
    'metadata:',
    '  version: "1.0.0"',
    '  category: planning',
    '---',
    '',
    'Do the skilled thing described by $ARGUMENTS.',
    '',
    'When done, suggest /ensemble:next-thing.',
    '',
    '',
  ].join('\n');

  // What Claude's generator writes for it: a stub that must never reach the Codex bundle.
  const CLAUDE_STUB = [
    '---',
    'name: ensemble:skilled',
    'description: Fixture skill-backed command',
    '---',
    'Read the file ${CLAUDE_PLUGIN_ROOT}/skills/ensemble-skilled/SKILL.md and follow its instructions exactly; resolve any relative paths in it against ${CLAUDE_PLUGIN_ROOT}/skills/ensemble-skilled/. Wherever that file refers to its ARGUMENTS, use this value: $ARGUMENTS',
    '',
  ].join('\n');

  const manifest = (name, skill) =>
    [
      'metadata:',
      `  name: ensemble:${name}`,
      `  description: Fixture command ${name}`,
      '  version: 1.0.0',
      '  argument_hint: "[thing]"',
      '  model: high',
      `skill: ${skill}`,
      '',
    ].join('\n');

  const roots = [];
  // A throwaway packages/ with the ordinary control command (see seedOrdinaryControl) plus `files`,
  // given relative to a fixture package
  function fixtureRoot(files) {
    const tmp = makeCodexTempRoot();
    roots.push(tmp);
    seedOrdinaryControl(tmp);
    for (const [relPath, content] of Object.entries(files)) {
      const target = path.join(tmp.packagesDir, 'codex-skillbacked-fixture', relPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    return tmp;
  }
  const generate = (tmp, overrides = {}) =>
    generateCommandSkills({
      dryRun: false,
      verbose: false,
      packagesDir: tmp.packagesDir,
      outputDir: tmp.outputDir,
      rootDir: tmp.rootDir,
      ...overrides,
    });
  const commandsDir = (tmp) => path.join(tmp.outputDir, 'skills', 'commands');
  const skillFile = (tmp, skill) => path.join(commandsDir(tmp), skill, 'SKILL.md');

  afterEach(() => {
    for (const tmp of roots.splice(0)) tmp.cleanup();
  });

  test('copies the skill verbatim to the command skill location: no wrapper, nothing injected, Claude\'s stub never read', () => {
    const tmp = fixtureRoot({
      'commands/skilled.yaml': manifest('skilled', 'ensemble-skilled'),
      'commands/ensemble/skilled.md': CLAUDE_STUB,
      'skills/ensemble-skilled/SKILL.md': SKILL_SOURCE,
    });
    const count = generate(tmp);

    const shipped = fs.readFileSync(skillFile(tmp, 'ensemble-skilled'), 'utf-8');
    expect(shipped).toBe(SKILL_SOURCE); // frontmatter and body, byte for byte
    expect(shipped).not.toContain('user-invocable');
    expect(shipped).not.toContain('Ensemble Command: /ensemble:skilled'); // the wrapper's title
    expect(shipped).not.toContain('CLAUDE_PLUGIN_ROOT');

    // One skill for the command: its SKILL.md and the Codex policy file its frontmatter key calls for
    expect(fs.readdirSync(path.join(commandsDir(tmp), 'ensemble-skilled')).sort()).toEqual(['SKILL.md', 'agents']);
    expect(fs.readdirSync(commandsDir(tmp)).sort()).toEqual([ORDINARY_SKILL, 'ensemble-skilled']);
    // The command count is the number of command skills, which is what AGENTS.md says it is
    expect(count).toBe(2);
    expect(buildCodexAgentsMd(count, 1, 1)).toContain('2 command skills');
  });

  test('leaves an ordinary command byte-identical whether or not a skill-backed one sits beside it', () => {
    const baseline = fixtureRoot({});
    generate(baseline);
    const withManifest = fixtureRoot({
      'commands/skilled.yaml': manifest('skilled', 'ensemble-skilled'),
      'skills/ensemble-skilled/SKILL.md': SKILL_SOURCE,
    });
    generate(withManifest);

    const before = fs.readFileSync(skillFile(baseline, ORDINARY_SKILL));
    const after = fs.readFileSync(skillFile(withManifest, ORDINARY_SKILL));
    expect(before.length).toBeGreaterThan(0);
    expect(after.equals(before)).toBe(true);
    // and it is still a rendered wrapper, not a copy of something
    expect(after.toString('utf-8')).toContain('user-invocable');
  });

  test('ships a skill that is not named after the command, and a dispatcher refers to it by that name', () => {
    const tmp = fixtureRoot({
      'commands/renamed.yaml': manifest('renamed', 'other-skill-name'),
      'skills/other-skill-name/SKILL.md': SKILL_SOURCE.replace('ensemble-skilled', 'other-skill-name'),
      'commands/hub.yaml': [
        'metadata:',
        '  name: ensemble:hub',
        '  description: Fixture dispatcher',
        'dispatch:',
        '  subcommands:',
        '    - keyword: go',
        '      ref: renamed',
        '      description: Skill-backed leaf',
        '',
      ].join('\n'),
    });
    generate(tmp);

    expect(fs.existsSync(skillFile(tmp, 'other-skill-name'))).toBe(true);
    expect(fs.existsSync(path.join(commandsDir(tmp), 'ensemble-renamed'))).toBe(false);
    const hub = fs.readFileSync(skillFile(tmp, 'ensemble-hub'), 'utf-8');
    expect(hub).toContain(
      '- **`go`** - Skill-backed leaf. see the `other-skill-name` skill (`packages/codex/.codex/skills/commands/other-skill-name/SKILL.md`).'
    );
    expect(hub).not.toContain('ensemble-renamed');
  });

  test('counts skills, not commands, when two commands name one skill', () => {
    const tmp = fixtureRoot({
      'commands/skilled.yaml': manifest('skilled', 'ensemble-skilled'),
      'commands/skilled-alias.yaml': manifest('skilled-alias', 'ensemble-skilled'),
      'skills/ensemble-skilled/SKILL.md': SKILL_SOURCE,
    });
    const count = generate(tmp);

    expect(fs.readdirSync(commandsDir(tmp)).sort()).toEqual([ORDINARY_SKILL, 'ensemble-skilled']);
    expect(count).toBe(2);
  });

  test('a dry run writes nothing and still reports the skills a real run writes', () => {
    const tmp = fixtureRoot({
      'commands/skilled.yaml': manifest('skilled', 'ensemble-skilled'),
      'skills/ensemble-skilled/SKILL.md': SKILL_SOURCE,
    });
    expect(generate(tmp, { dryRun: true })).toBe(2);
    expect(fs.existsSync(tmp.outputDir)).toBe(false);
  });

  describe('the references/ directory of a skill', () => {
    // The skill is named otherwise than its command (`ensemble-skilled`), so a destination worked out
    // from the command name lands in the wrong directory.
    const SKILL = 'renamed-skill';
    const SKILL_DIR = `skills/${SKILL}`;
    // Two documents a SKILL.md would name by relative path. The first has CRLF line ends, a non-ASCII
    // character and a command reference that the Pi generator rewrites, so any normalization or
    // re-serialization shows; the second sits one level deeper.
    const REF_A = '# Phase 1\r\nHand off to /ensemble:next-thing \u2014 caf\u00e9.\r\n';
    const REF_B = '# Nested\n\nDeeper still.\n';
    const WITH_REFERENCES = {
      'commands/skilled.yaml': manifest('skilled', SKILL),
      [`${SKILL_DIR}/SKILL.md`]: SKILL_SOURCE,
      [`${SKILL_DIR}/references/a.md`]: REF_A,
      [`${SKILL_DIR}/references/nested/b.md`]: REF_B,
    };
    const SHIPPED = ['SKILL.md', 'agents/openai.yaml', 'references/a.md', 'references/nested/b.md'];

    /** Every file below `dir`, relative to it, `/`-separated and sorted. */
    const walk = (dir, prefix = '') =>
      fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap((entry) =>
          entry.isDirectory() ? walk(path.join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]
        )
        .sort();
    const shippedTree = (tmp, skill) => walk(path.join(commandsDir(tmp), skill));
    const shippedFile = (tmp, rel) => fs.readFileSync(path.join(commandsDir(tmp), SKILL, rel));

    test('ships it beside the SKILL.md, each file at its own relative path and byte for byte, and no other file of the skill', () => {
      const tmp = fixtureRoot({
        ...WITH_REFERENCES,
        // Beside the SKILL.md rather than in references/: authoring material the bundle leaves out
        [`${SKILL_DIR}/notes.txt`]: 'scratch\n',
        [`${SKILL_DIR}/README.md`]: '# readme\n',
        [`${SKILL_DIR}/REFERENCE.md`]: '# a framework skill\'s reference, not a references/ file\n',
        [`${SKILL_DIR}/scripts/run.js`]: 'process.exit(0);\n',
      });
      generate(tmp);

      expect(shippedTree(tmp, SKILL)).toEqual(SHIPPED);
      expect(shippedFile(tmp, 'references/a.md').equals(Buffer.from(REF_A, 'utf-8'))).toBe(true);
      expect(shippedFile(tmp, 'references/nested/b.md').equals(Buffer.from(REF_B, 'utf-8'))).toBe(true);
      expect(shippedFile(tmp, 'SKILL.md').toString('utf-8')).toBe(SKILL_SOURCE);
      expect(fs.existsSync(path.join(commandsDir(tmp), 'ensemble-skilled'))).toBe(false);
    });

    test('leaves out a dotfile of references/: it is one machine\'s leftover, not part of the skill', () => {
      const tmp = fixtureRoot({
        ...WITH_REFERENCES,
        [`${SKILL_DIR}/references/.DS_Store`]: 'finder\n',
        [`${SKILL_DIR}/references/.hidden/c.md`]: '# in a hidden directory\n',
      });
      generate(tmp);

      expect(shippedTree(tmp, SKILL)).toEqual(SHIPPED);
    });

    test('adds no references/ to a skill that has none, nor to an ordinary command\'s wrapper', () => {
      const tmp = fixtureRoot({
        ...WITH_REFERENCES,
        'commands/bare.yaml': manifest('bare', 'bare-skill'),
        'skills/bare-skill/SKILL.md': SKILL_SOURCE.replace('ensemble-skilled', 'bare-skill'),
      });
      generate(tmp);

      expect(shippedTree(tmp, 'bare-skill')).toEqual(['SKILL.md', 'agents/openai.yaml']);
      expect(shippedTree(tmp, ORDINARY_SKILL)).toEqual(['SKILL.md']);
      expect(shippedTree(tmp, SKILL)).toEqual(SHIPPED); // the skill that has them still ships them
    });

    test('counts the skills, not the files of their references/: the number AGENTS.md states', () => {
      const tmp = fixtureRoot(WITH_REFERENCES);
      const count = generate(tmp);

      expect(shippedTree(tmp, SKILL)).toHaveLength(4);
      expect(fs.readdirSync(commandsDir(tmp)).sort()).toEqual([ORDINARY_SKILL, SKILL]);
      expect(count).toBe(2);
      expect(buildCodexAgentsMd(count, 1, 1)).toContain('2 command skills');
    });

    test('ships a skill that two commands name once, which is no collision of the skill with itself', () => {
      const tmp = fixtureRoot({
        ...WITH_REFERENCES,
        'commands/skilled-alias.yaml': manifest('skilled-alias', SKILL),
      });
      const count = generate(tmp);

      expect(shippedTree(tmp, SKILL)).toEqual(SHIPPED);
      expect(count).toBe(2);
    });

    test('a dry run writes none of it, and still counts the skills a real run writes', () => {
      const tmp = fixtureRoot(WITH_REFERENCES);
      expect(generate(tmp, { dryRun: true })).toBe(2);
      expect(fs.existsSync(tmp.outputDir)).toBe(false);
    });
  });

  describe('agents/openai.yaml (the Codex implicit-invocation policy)', () => {
    const POLICY = 'policy:\n  allow_implicit_invocation: false\n';
    const policyFile = (tmp, skill) => path.join(commandsDir(tmp), skill, 'agents', 'openai.yaml');
    const files = (source) => ({
      'commands/skilled.yaml': manifest('skilled', 'ensemble-skilled'),
      'skills/ensemble-skilled/SKILL.md': source,
    });

    test('is written, with exactly the policy, for a skill whose frontmatter has disable-model-invocation: true', () => {
      const tmp = fixtureRoot(files(SKILL_SOURCE));
      generate(tmp);

      expect(fs.readFileSync(policyFile(tmp, 'ensemble-skilled'), 'utf-8')).toBe(POLICY);
      // the wrapper of an ordinary command declares no such key and gets none
      expect(fs.existsSync(policyFile(tmp, ORDINARY_SKILL))).toBe(false);
    });

    test('is absent for a skill without the key, or with it set to false', () => {
      const without = SKILL_SOURCE.replace('disable-model-invocation: true\n', '');
      const tmp = fixtureRoot(files(without));
      generate(tmp);
      expect(fs.existsSync(path.join(commandsDir(tmp), 'ensemble-skilled', 'agents'))).toBe(false);

      const off = fixtureRoot(files(SKILL_SOURCE.replace('disable-model-invocation: true', 'disable-model-invocation: false')));
      generate(off);
      expect(fs.existsSync(policyFile(off, 'ensemble-skilled'))).toBe(false);
    });

    test('disappears on regeneration once the source drops the key', () => {
      const tmp = fixtureRoot(files(SKILL_SOURCE));
      generate(tmp);
      expect(fs.existsSync(policyFile(tmp, 'ensemble-skilled'))).toBe(true);

      fs.writeFileSync(
        path.join(tmp.packagesDir, 'codex-skillbacked-fixture', 'skills', 'ensemble-skilled', 'SKILL.md'),
        SKILL_SOURCE.replace('disable-model-invocation: true\n', '')
      );
      generate(tmp);

      expect(fs.existsSync(path.join(commandsDir(tmp), 'ensemble-skilled', 'agents'))).toBe(false);
      expect(fs.readdirSync(path.join(commandsDir(tmp), 'ensemble-skilled'))).toEqual(['SKILL.md']);
    });

    test('a dry run writes none of it', () => {
      const tmp = fixtureRoot(files(SKILL_SOURCE));
      generate(tmp, { dryRun: true });
      expect(fs.existsSync(tmp.outputDir)).toBe(false);
    });
  });

  test('fails, writing nothing, when the skill does not exist', () => {
    const tmp = fixtureRoot({ 'commands/skilled.yaml': manifest('skilled', 'ensemble-skilled') });
    expect(() => generate(tmp)).toThrow(/skilled\.yaml: skill-backed command points at skill 'ensemble-skilled', but .* does not exist/);
    expect(fs.existsSync(tmp.outputDir)).toBe(false);
  });

  test('fails when the skill is only in another package: it must be in the command\'s own', () => {
    const tmp = fixtureRoot({ 'commands/skilled.yaml': manifest('skilled', 'ensemble-skilled') });
    fs.mkdirSync(path.join(tmp.packagesDir, 'other', 'skills', 'ensemble-skilled'), { recursive: true });
    fs.writeFileSync(path.join(tmp.packagesDir, 'other', 'skills', 'ensemble-skilled', 'SKILL.md'), SKILL_SOURCE);
    expect(() => generate(tmp)).toThrow(/does not exist/);
  });

  test.each([['a path', '../elsewhere'], ['an upper-case name', 'Ensemble-Skilled'], ['an empty value', '""']])(
    'fails when skill is %s',
    (_label, value) => {
      const tmp = fixtureRoot({ 'commands/skilled.yaml': manifest('skilled', value) });
      expect(() => generate(tmp)).toThrow(/skilled\.yaml: skill .* is not a valid skill directory name/);
    }
  );

  test('fails, naming both sources, when the skill of a manifest is the wrapper another command would write', () => {
    const tmp = fixtureRoot({
      // the ordinary control's wrapper is skills/commands/ensemble-ordinary-control/SKILL.md, the skill this manifest ships
      'commands/other.yaml': manifest('other', ORDINARY_SKILL),
      'skills/ensemble-ordinary-control/SKILL.md': SKILL_SOURCE.replace('ensemble-skilled', ORDINARY_SKILL),
    });
    expect(() => generate(tmp)).toThrow(
      /Codex command skill collision: .*ensemble-ordinary-control.SKILL\.md would come from both .* and .*/
    );
  });
});

describe('detectAgentSkills — dotnet skill is separate from blazor', () => {
  test.each([
    ['an ASP.NET mention', 'Builds ASP.NET Core APIs'],
    ['a .NET mention', 'Targets .NET 8'],
    ['a dotnet mention', 'Runs the dotnet CLI'],
  ])('%s selects dotnet but not blazor', (_label, content) => {
    const skills = detectAgentSkills('api-helper', content);
    expect(skills).toContain('dotnet');
    expect(skills).not.toContain('blazor');
  });

  test('a Blazor mention selects blazor without implying dotnet', () => {
    const skills = detectAgentSkills('ui-helper', 'Builds Blazor components');
    expect(skills).toContain('blazor');
    expect(skills).not.toContain('dotnet');
  });

  test('backend-named agents get dotnet (not blazor) with the other backend framework skills', () => {
    expect(detectAgentSkills('backend-developer', 'generic agent text')).toEqual(['dotnet', 'nestjs', 'phoenix', 'rails']);
  });
});

describe('normalizeSkillBody / buildCodexAgentsMd — dotnet skill', () => {
  test('rewrites a bare skills/<name>/ path to the Codex skill directory', () => {
    expect(normalizeSkillBody('Load `skills/dotnet/SKILL.md`')).toBe('Load `.codex/skills/dotnet/SKILL.md`');
    expect(normalizeSkillBody('Load skills/nestjs/SKILL.md')).toBe('Load .codex/skills/nestjs/SKILL.md');
  });

  test('does not double-prefix an already Codex-relative path or rewrite a longer path', () => {
    expect(normalizeSkillBody('Load .codex/skills/react/SKILL.md')).toBe('Load .codex/skills/react/SKILL.md');
    expect(normalizeSkillBody('see packages/react/skills/react/SKILL.md')).toBe('see packages/react/skills/react/SKILL.md');
  });

  test('lists dotnet among the framework skills in the generated AGENTS.md', () => {
    expect(buildCodexAgentsMd(1, 1, 1)).toContain('`blazor`, `dotnet`');
  });
});

describe('agent sandbox mode (final-gate F15)', () => {
  test('the documented read-only code-reviewer gets the read-only sandbox; every other agent keeps workspace-write', () => {
    expect(sandboxModeFor('code-reviewer')).toBe('read-only');
    expect(sandboxModeFor('backend-developer')).toBe('workspace-write');
  });

  test('the generated Codex code-reviewer file declares what the generator says', () => {
    const toml = fs.readFileSync(
      path.join(__dirname, '..', '..', 'packages', 'codex', '.codex', 'agents', 'code-reviewer.toml'),
      'utf8'
    );
    expect(toml).toMatch(/^sandbox_mode = "read-only"$/m);
  });
});

describe('copyAdapterSkills — adapter directories (TRD-020, temp-root smoke run, throwaway fixture)', () => {
  const FIXTURE_SOURCE_DIR = path.join(__dirname, 'fixtures', 'toolchain', 'good-adapter');
  let tmp;

  beforeAll(() => {
    tmp = makeCodexTempRoot();
    // Two known pre-existing, adapter-free skills (copied from the already-generated,
    // committed output) to prove this run is a byte-identical no-op for both -- the same
    // regression guard as the live-tree version had, without reading or writing the live tree.
    tmp.seedFile(path.join('packages', 'codex', '.codex', 'skills', 'react', 'SKILL.md'));
    tmp.seedFile(path.join('packages', 'codex', '.codex', 'skills', 'nestjs', 'SKILL.md'));

    const fixtureAdapterDir = path.join(tmp.packagesDir, 'codex-adapter-fixture', 'skills', 'adapter-fixture-tracker');
    fs.mkdirSync(fixtureAdapterDir, { recursive: true });
    fs.copyFileSync(path.join(FIXTURE_SOURCE_DIR, 'SKILL.md'), path.join(fixtureAdapterDir, 'SKILL.md'));
    fs.copyFileSync(path.join(FIXTURE_SOURCE_DIR, 'adapter.yaml'), path.join(fixtureAdapterDir, 'adapter.yaml'));
  });

  afterAll(() => {
    tmp.cleanup();
  });

  test('copies SKILL.md (frontmatter-synthesized) and adapter.yaml (byte-identical) keyed by the adapter directory name, leaving unrelated skills untouched', () => {
    const KNOWN_SKILL_REACT = path.join(tmp.outputDir, 'skills', 'react', 'SKILL.md');
    const KNOWN_SKILL_NESTJS = path.join(tmp.outputDir, 'skills', 'nestjs', 'SKILL.md');
    const beforeReact = fs.readFileSync(KNOWN_SKILL_REACT);
    const beforeNestjs = fs.readFileSync(KNOWN_SKILL_NESTJS);

    // Runs the real end-to-end function (globs every <packagesDir>/*/skills/adapter-*/SKILL.md,
    // including our throwaway fixture) so this proves the live wiring, not just a pure-function
    // unit test.
    const count = copyAdapterSkills({ dryRun: false, verbose: false, packagesDir: tmp.packagesDir, outputDir: tmp.outputDir });
    expect(count).toBeGreaterThanOrEqual(1);

    const adapterOutputDir = path.join(tmp.outputDir, 'skills', 'adapter-fixture-tracker');
    const skillDest = path.join(adapterOutputDir, 'SKILL.md');
    const yamlDest = path.join(adapterOutputDir, 'adapter.yaml');
    expect(fs.existsSync(skillDest)).toBe(true);
    expect(fs.existsSync(yamlDest)).toBe(true);

    const skillContent = fs.readFileSync(skillDest, 'utf-8');
    expect(skillContent).toMatch(/^---\nname: adapter-fixture-tracker\n/);
    expect(skillContent).toContain('# Fixture Good Tracker Adapter');

    // adapter.yaml must be byte-identical to the source -- never rewritten, unlike SKILL.md's
    // frontmatter-synthesis path.
    const sourceYamlBytes = fs.readFileSync(path.join(FIXTURE_SOURCE_DIR, 'adapter.yaml'));
    const destYamlBytes = fs.readFileSync(yamlDest);
    expect(destYamlBytes.equals(sourceYamlBytes)).toBe(true);

    // Byte-identical-no-regression proof (actual comparison, not asserted in prose): a skill
    // with no adapter.yaml is unaffected by this run.
    expect(fs.readFileSync(KNOWN_SKILL_REACT).equals(beforeReact)).toBe(true);
    expect(fs.readFileSync(KNOWN_SKILL_NESTJS).equals(beforeNestjs)).toBe(true);
  });
});

describe('copyAdapterSkills — adapter directory name collision across packages (TRD-020 P2 fix, temp-root smoke run, throwaway fixtures)', () => {
  let tmp;
  let ADAPTER_DIR_A;
  let ADAPTER_DIR_B;
  let COLLIDING_OUTPUT_DIR;

  beforeEach(() => {
    tmp = makeCodexTempRoot();
    const FIXTURE_PACKAGE_A = path.join(tmp.packagesDir, 'codex-adapter-collision-fixture-a');
    const FIXTURE_PACKAGE_B = path.join(tmp.packagesDir, 'codex-adapter-collision-fixture-b');
    ADAPTER_DIR_A = path.join(FIXTURE_PACKAGE_A, 'skills', 'adapter-collision-regression');
    ADAPTER_DIR_B = path.join(FIXTURE_PACKAGE_B, 'skills', 'adapter-collision-regression');
    COLLIDING_OUTPUT_DIR = path.join(tmp.outputDir, 'skills', 'adapter-collision-regression');

    fs.mkdirSync(ADAPTER_DIR_A, { recursive: true });
    fs.mkdirSync(ADAPTER_DIR_B, { recursive: true });
    fs.writeFileSync(path.join(ADAPTER_DIR_A, 'SKILL.md'), '# Package A Collision Adapter\n');
    fs.writeFileSync(path.join(ADAPTER_DIR_A, 'adapter.yaml'), 'adapter: collision-a\n');
    fs.writeFileSync(path.join(ADAPTER_DIR_B, 'SKILL.md'), '# Package B Collision Adapter\n');
    fs.writeFileSync(path.join(ADAPTER_DIR_B, 'adapter.yaml'), 'adapter: collision-b\n');
  });

  afterEach(() => {
    tmp.cleanup();
  });

  test('two different packages shipping an adapter dir with the same basename is a hard generator failure, naming both colliding source paths, and writes nothing', () => {
    // Mutation-proof target: with the pre-fix behavior (no collision check), this call would
    // silently succeed and last-writer-wins one of the two adapter.yaml files into
    // COLLIDING_OUTPUT_DIR instead of throwing.
    let thrown = null;
    try {
      copyAdapterSkills({ dryRun: false, verbose: false, packagesDir: tmp.packagesDir, outputDir: tmp.outputDir });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).not.toBeNull();
    expect(thrown.message).toContain('adapter-collision-regression');
    expect(thrown.message).toContain(ADAPTER_DIR_A);
    expect(thrown.message).toContain(ADAPTER_DIR_B);

    // Fails before writing anything for the colliding name -- no last-writer-wins partial
    // output silently left behind.
    expect(fs.existsSync(COLLIDING_OUTPUT_DIR)).toBe(false);
  });
});

describe('vendorCodexToolchain — toolchain-cli.js runtime vendoring (TRD-020, temp-root smoke run)', () => {
  let tmp;
  let VENDOR_ROOT;

  beforeAll(() => {
    tmp = makeCodexTempRoot();
    VENDOR_ROOT = path.join(tmp.outputDir, 'skills', 'vendor');
  });

  afterAll(() => {
    tmp.cleanup();
  });

  test('vendors toolchain-cli.js, every toolchain/*.js submodule, the complexity-analyzer.js sibling dependency, the toolchain data dir, and a package.json declaring ajv/js-yaml', () => {
    // sourceRoot stays the real repo root (vendorCodexToolchain always vendors the real,
    // production toolchain library -- only outputDir, the write target, is overridden here);
    // nothing under the real repo tree is read-write except the normal require() reads of the
    // real lib source files this generator ships in production.
    const count = vendorCodexToolchain({ dryRun: false, verbose: false, outputDir: tmp.outputDir });
    // TRD-027 follow-up: `work-graph`'s shipped default `auto` now LOADS the resolved tracker
    // adapter to check its declared categories (`packages/development/lib/toolchain/
    // work-graph-resolve.js#resolveWorkGraphAdapter`), reachable from a plain `resolve --json`
    // with no config at all (shipped defaults: tracker 'beads', work-graph 'auto') -- so the
    // vendored `beads` skill must actually be present under this temp root's own
    // `skills-root`-shaped layout (`<outputDir>/skills/adapter-tracker-beads`, matching
    // `./toolchain/adapters.js#LIBRARY_LOCATION_TAILS`'s `skills/vendor/lib/toolchain` tail)
    // for the second test below to succeed, exactly as a real Codex install ships it
    // (`copyAdapterSkills` is this generator's own production step for that, not test-only
    // scaffolding).
    copyAdapterSkills({ dryRun: false, verbose: false, outputDir: tmp.outputDir });
    // 35 files as of this change (cli + complexity-analyzer + 13 toolchain/*.js + package.json
    // + the toolchain/ data tree); asserted loosely so an unrelated data-file addition upstream
    // doesn't make this brittle.
    expect(count).toBeGreaterThan(30);

    expect(fs.existsSync(path.join(VENDOR_ROOT, 'lib', 'toolchain-cli.js'))).toBe(true);
    // ledger.js and preflight.js require('../complexity-analyzer') -- a sibling of
    // toolchain-cli.js, NOT a toolchain/ submodule. Easy to drop when hand-listing files;
    // this assertion is the regression guard for that.
    expect(fs.existsSync(path.join(VENDOR_ROOT, 'lib', 'complexity-analyzer.js'))).toBe(true);

    const expectedSubmodules = [
      'adapters.js', 'confirm.js', 'config.js', 'config-path.js', 'contracts.js',
      'detect.js', 'ledger.js', 'mapping.js', 'preflight.js', 'resolve.js',
      'run-id.js', 'runner.js', 'validate.js',
    ];
    for (const name of expectedSubmodules) {
      expect(fs.existsSync(path.join(VENDOR_ROOT, 'lib', 'toolchain', name))).toBe(true);
    }

    expect(fs.existsSync(path.join(VENDOR_ROOT, 'toolchain', 'toolchain.default.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(VENDOR_ROOT, 'toolchain', 'categories', 'tracker.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(VENDOR_ROOT, 'toolchain', 'schemas', 'adapter-manifest-schema.json'))).toBe(true);
    expect(fs.existsSync(path.join(VENDOR_ROOT, 'toolchain', 'schemas', 'normalized'))).toBe(true);

    const pkg = JSON.parse(fs.readFileSync(path.join(VENDOR_ROOT, 'package.json'), 'utf-8'));
    expect(pkg.dependencies).toEqual({ ajv: '^8.12.0', 'js-yaml': '^4.1.0' });
    expect(pkg.name).toBe('@sunstone-partners/ensemble-codex-toolchain-vendor');
  });

  test('the vendored toolchain-cli.js resolves its sibling requires and __dirname-based data-dir lookups from inside the vendor tree alone', () => {
    // Runs the vendored COPY (not packages/development/lib/toolchain-cli.js) in a child
    // process with cwd set to the vendor root, so every relative require/__dirname lookup
    // resolves inside the copy. ajv/js-yaml resolve via makeCodexTempRoot()'s <root>/node_modules
    // symlink to this repo's real, hoisted node_modules (Node's normal upward resolution walk
    // from VENDOR_ROOT finds it there) -- the same pattern
    // scripts/tests/fixtures/toolchain/mutant-toolchain-copy.js uses. This does not by itself
    // prove the copy is installable outside the monorepo; that standalone proof was run
    // manually (real `npm install` against a copy placed under /tmp, outside the repo checkout)
    // and is not repeated here as an automated test per the "no reliance on real network"
    // determinism requirement -- see this track's report for the exact commands and output.
    const { execFileSync } = require('child_process');
    const out = execFileSync(
      process.execPath,
      [path.join(VENDOR_ROOT, 'lib', 'toolchain-cli.js'), 'resolve', '--json'],
      { encoding: 'utf-8', cwd: VENDOR_ROOT }
    );
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(Object.keys(parsed.data).length).toBeGreaterThan(0);
  });
});
