'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { readSkill } = require('../../product/tests/helpers/skill-prompt');
const { parseSubcommands } = require('../../product/tests/helpers/skill-subcommands');

// TRD-011 "Specialist command regression suite" / TRD-011-TEST "Specialist
// commands unchanged"
// (docs/TRD/TRD-2026-87e64cc6-command-surface-consolidation.md#trd-011,
// #trd-011-test). This file adds no new behavior and edits no specialist
// command; it only guards the existing, standalone PRD/TRD/beads commands
// (REQ-004, REQ-018) against silent redirection into either task-oriented
// lifecycle (ensemble:feature/new-feature, ensemble:issue/fix-issue) and
// confirms each remains reachable, generated, and documented.
//
// The list below was confirmed by listing packages/development/commands/*.yaml
// and packages/product/commands/*.yaml directly rather than assumed:
//  - trd itself, plus every ref in its own `## Subcommands` section (9: the Foreman
//    table-mode and workstream-generation variants are `create-trd --parser-tables` and
//    `implement-trd-beads --workstream --generate-only` flags, not separate commands)
//  - prd itself, plus every ref in its own `## Subcommands` section (2:
//    create-prd and refine-prd; the meeting-sourced variants are
//    `--from-meeting` flags on those two, not separate commands)
// trd and prd are skill-backed dispatchers: their routing table is the skill's
// `## Subcommands` section (packages/<pkg>/skills/ensemble-<name>/SKILL.md).
//  - the 3 standalone beads-* command YAMLs that actually exist as commands:
//    refine-beads, beads-build, beads-build-wave.
// beads-scaffold-specialist (an agent:
// packages/development/agents/beads-scaffold-specialist.yaml), complete-beads
// (a skill: packages/development/skills/complete-beads/SKILL.md), and
// beads-repair-plan / beads-repair-verify / beads-scope / beads-findings (lib
// CLI tools with their own dedicated tests but no command YAML or generated
// commands/ensemble/*.md) are not command-YAML specialist commands, so they
// are intentionally not enumerated here -- they stay covered by their own
// existing tests, run as part of this package's full suite.
// configure-team.yaml and implement-bead.yaml
// (development), and check-feature-drift.yaml,
// check-binding-drift.yaml, generate-feature-tests.yaml,
// generate-reqnroll-bindings.yaml, and reqnroll-tdd.yaml (product) are real
// command YAMLs but are not PRD/TRD/beads document specialists under
// REQ-004/REQ-018 -- none is mentioned anywhere in this TRD or its PRD, and
// none creates/refines/analyzes a PRD, TRD, or beads artifact.
// new-feature.yaml, packages/product/commands/feature.yaml, issue.yaml,
// fix-issue.yaml, and list-issue.yaml are the two task-oriented lifecycles and
// their own dispatchers -- excluded by definition.
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const DEV_COMMANDS_DIR = path.join(REPO_ROOT, 'packages', 'development', 'commands');
const PRODUCT_COMMANDS_DIR = path.join(REPO_ROOT, 'packages', 'product', 'commands');

const SPECIALIST_COMMANDS = [
  ['trd', DEV_COMMANDS_DIR],
  ['create-trd', DEV_COMMANDS_DIR],
  ['refine-trd', DEV_COMMANDS_DIR],
  ['implement-trd-beads', DEV_COMMANDS_DIR],
  ['analyze-requirements', DEV_COMMANDS_DIR],
  ['analyze-complexity', DEV_COMMANDS_DIR],
  ['validate-requirements', DEV_COMMANDS_DIR],
  ['verify-requirements', DEV_COMMANDS_DIR],
  ['requirement-status', DEV_COMMANDS_DIR],
  ['trd-dependency-graph', DEV_COMMANDS_DIR],
  ['beads-build', DEV_COMMANDS_DIR],
  ['beads-build-wave', DEV_COMMANDS_DIR],
  ['prd', PRODUCT_COMMANDS_DIR],
  ['create-prd', PRODUCT_COMMANDS_DIR],
  ['refine-prd', PRODUCT_COMMANDS_DIR],
];

// Subcommand refs that would silently route a specialist
// into one of the two task-oriented lifecycles instead of its own behavior.
const TASK_LIFECYCLE_REFS = new Set(['new-feature', 'feature', 'issue', 'fix-issue', 'list-issue']);

function readYaml(dir, slug) {
  return yaml.load(fs.readFileSync(path.join(dir, `${slug}.yaml`), 'utf8'));
}

function readGeneratedMarkdown(dir, slug) {
  return fs.readFileSync(path.join(dir, 'ensemble', `${slug}.md`), 'utf8');
}

function parseFrontmatter(mdText) {
  const match = mdText.match(/^---\n([\s\S]*?)\n---/);
  return match ? yaml.load(match[1]) : null;
}

/** The specialist's skill (a skill-backed command's source of truth), or null for a full YAML command. */
function readCommandSkill(dir, slug) {
  const command = readYaml(dir, slug);
  return command.skill ? readSkill(command.skill, path.dirname(dir)) : null;
}

/** The `{keyword, description, ref}` rows a dispatcher routes: its skill's Subcommands section, else its YAML dispatch table. */
function readSubcommands(dir, slug) {
  const skill = readCommandSkill(dir, slug);
  if (skill) {
    return skill.body.includes('\n## Subcommands\n') ? parseSubcommands(skill) : [];
  }
  const command = readYaml(dir, slug);
  return (command.dispatch && command.dispatch.subcommands) || [];
}

describe('Specialist command regression suite (TRD-011 / TRD-011-TEST)', () => {
  describe('direct specialist invocation unchanged', () => {
    test.each(SPECIALIST_COMMANDS)('%s source YAML still exists, parses, and outputs to its own slug', (slug, dir) => {
      const yamlPath = path.join(dir, `${slug}.yaml`);
      expect(fs.existsSync(yamlPath)).toBe(true);
      const command = readYaml(dir, slug);
      expect(command.metadata).toBeTruthy();
      expect(typeof command.metadata.name).toBe('string');
      expect(command.metadata.name.length).toBeGreaterThan(0);
      // Guards against a specialist's generated output being silently
      // repointed to overwrite a sibling command's file (including either
      // task-oriented lifecycle's own generated markdown).
      expect(command.metadata.output_path).toBe(`ensemble/${slug}.md`);
    });

    test.each(SPECIALIST_COMMANDS)('%s generated commands/ensemble/*.md still exists, is non-empty, and parses', (slug, dir) => {
      const mdPath = path.join(dir, 'ensemble', `${slug}.md`);
      expect(fs.existsSync(mdPath)).toBe(true);
      const mdText = readGeneratedMarkdown(dir, slug);
      expect(mdText.length).toBeGreaterThan(0);
      const frontmatter = parseFrontmatter(mdText);
      expect(frontmatter).toBeTruthy();
      expect(typeof frontmatter.description).toBe('string');
      expect(frontmatter.description.length).toBeGreaterThan(0);
      const command = readYaml(dir, slug);
      expect(frontmatter.name).toBe(command.metadata.name);
    });
  });

  describe('no silent redirection', () => {
    test.each(SPECIALIST_COMMANDS)('%s has no dispatch entry pointing at the feature or issue task-oriented lifecycles', (slug, dir) => {
      const redirecting = readSubcommands(dir, slug).filter((sub) => TASK_LIFECYCLE_REFS.has(sub.ref));
      expect(redirecting).toEqual([]);
    });
  });

  describe('specialist commands remain documented', () => {
    const EXPECTED_TRD_SUBCOMMAND_REFS = [
      'create-trd',
      'refine-trd',
      'implement-trd-beads',
      'analyze-requirements',
      'analyze-complexity',
      'validate-requirements',
      'verify-requirements',
      'requirement-status',
      'trd-dependency-graph',
    ];
    const EXPECTED_PRD_SUBCOMMAND_REFS = ['create-prd', 'refine-prd'];

    test('ensemble:trd dispatch table still routes every TRD specialist, documented as the direct way to use it', () => {
      const refs = readSubcommands(DEV_COMMANDS_DIR, 'trd').map((sub) => sub.ref);
      expect(refs.sort()).toEqual([...EXPECTED_TRD_SUBCOMMAND_REFS].sort());
      const skillText = readCommandSkill(DEV_COMMANDS_DIR, 'trd').body;
      for (const ref of EXPECTED_TRD_SUBCOMMAND_REFS) {
        expect(skillText).toContain(`/ensemble:${ref}\` directly`);
      }
    });

    test('ensemble:prd dispatch table still routes every PRD specialist, documented as the direct way to use it', () => {
      const refs = readSubcommands(PRODUCT_COMMANDS_DIR, 'prd').map((sub) => sub.ref);
      expect(refs.sort()).toEqual([...EXPECTED_PRD_SUBCOMMAND_REFS].sort());
      const skillText = readCommandSkill(PRODUCT_COMMANDS_DIR, 'prd').body;
      for (const ref of EXPECTED_PRD_SUBCOMMAND_REFS) {
        expect(skillText).toContain(`/ensemble:${ref}\` directly`);
      }
    });

    test('packages/development/README.md command index still lists the specialists it already documents', () => {
      const readme = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'development', 'README.md'), 'utf8');
      for (const name of [
        '/ensemble:implement-trd-beads',
        '/ensemble:create-trd',
        '/ensemble:refine-trd',
      ]) {
        expect(readme).toContain(name);
      }
    });

    test('create-trd-foreman and create-workstream-trd are removed as commands and live on as flags', () => {
      for (const slug of ['create-trd-foreman', 'create-workstream-trd']) {
        expect(fs.existsSync(path.join(DEV_COMMANDS_DIR, `${slug}.yaml`))).toBe(false);
      }
      const subcommands = readSubcommands(DEV_COMMANDS_DIR, 'trd');
      const keywords = subcommands.map((sub) => sub.keyword);
      expect(keywords).not.toContain('foreman');
      expect(keywords).not.toContain('workstream');
      const byKeyword = Object.fromEntries(subcommands.map((sub) => [sub.keyword, sub]));
      expect(byKeyword.create.description).toContain('--parser-tables');
      expect(byKeyword.implement.description).toContain('--workstream --generate-only');
      // The base commands carry the flags the variants became.
      expect(readYaml(DEV_COMMANDS_DIR, 'create-trd').metadata.argument_hint).toContain('--parser-tables');
      expect(readYaml(DEV_COMMANDS_DIR, 'implement-trd-beads').metadata.argument_hint).toContain('--generate-only');
    });

    test('packages/development/README.md documents the flags that replaced the removed variants', () => {
      const readme = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'development', 'README.md'), 'utf8');
      expect(readme).toContain('/ensemble:create-trd <prd-path> --parser-tables');
      expect(readme).toContain('--workstream --generate-only');
      expect(readme).not.toContain('| `/ensemble:create-trd-foreman` |');
      expect(readme).not.toContain('| `/ensemble:create-workstream-trd` |');
    });
  });
});
