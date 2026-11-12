'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { transformCommandToMarkdown } = require('../../../scripts/lib/command-transformer');
const { readCommandProse } = require('../../../scripts/lib/skill-backed-command');
const { readDevelopmentSkill, parseWorkflow, parseParameters } = require('./helpers/skill-workflow');

const manifestPath = path.join(__dirname, '../commands/create-trd.yaml');
const manifest = yaml.load(fs.readFileSync(manifestPath, 'utf8'));

// create-trd is a skill-backed command: its YAML is a manifest (metadata + skill) and the
// prompt is its skill -- the SKILL.md and the phase files under references/ -- the single
// source of truth. The contract below is pinned against the whole prompt (skill.prompt: the
// SKILL.md body, then every reference); the Claude Code command is only a stub that points
// at it.
const skill = readDevelopmentSkill(manifest.skill);
const skillText = skill.prompt;

// Index of the `#### Step N.M: <title>` heading whose title starts with `title`.
function stepStart(text, title) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^#### Step [\\d.]+: ${escaped}`, 'm').exec(text);
  return match ? match.index : -1;
}

describe('create-trd command document ids', () => {
  test('reuses source PRD micro UUID instead of allocating a new sequence', () => {
    const text = skillText;
    expect(text).toContain('PRD-YYYY-<micro_uuid>');
    expect(text).toContain('TRD_MICRO_UUID');
    expect(text).toContain('docs/TRD/TRD-YYYY-<TRD_MICRO_UUID>-<slug>.md');
    expect(text).not.toContain('TRD-YYYY-NNN-<slug>.md');
  });

  test.each([
    ['Master Task List Generation', 'Test Task Generation', 'Every task line MUST begin with a GitHub checkbox'],
    ['Test Task Generation', 'Dependency Mapping and PR Boundary Design', 'Every TRD-NNN-TEST line MUST begin with the same checkbox-prefix requirement as implementation tasks'],
  ])('%s requires the checkbox prefix that TASK_LINE_RE parses', (title, nextTitle, phrase) => {
    const text = skillText;
    const start = stepStart(text, title);
    const next = stepStart(text, nextTitle);
    expect(start).toBeGreaterThan(-1);
    expect(next).toBeGreaterThan(start);
    expect(text.slice(start, next)).toContain(phrase);
  });

  test('TRD_CLI is resolved once, early, and Task Coverage Analysis self-checks the draft Master Task List via trd-cli.js parse', () => {
    const text = skillText;
    const resolve = text.indexOf('Resolve TRD_CLI per the tool-path-resolution skill (packages/development/skills/tool-path-resolution/SKILL.md) for packages/development/lib/trd-cli.js');
    const start = stepStart(text, 'Task Coverage Analysis');
    const next = stepStart(text, 'Dependency and Estimate Review');
    expect(resolve).toBeGreaterThan(-1);
    expect(text.indexOf('Resolve TRD_CLI per the tool-path-resolution skill', resolve + 1)).toBe(-1);
    expect(start).toBeGreaterThan(resolve);
    expect(next).toBeGreaterThan(start);
    expect(text.slice(start, next)).toContain('node "$TRD_CLI" parse');
  });

  test('keeps the companion artifact output contract', () => {
    const text = skillText;
    expect(text).toContain('COMPANION_DOMAINS');
    expect(text).toContain('`<trd-stem>-data-model.md`');
    expect(text).toContain('`<trd-stem>-research.md`');
    expect(text).toContain('## Companion Artifacts');
    expect(text).toContain('Companion artifacts generated:');
    expect(text).toContain('No companion artifacts generated.');
  });

  test('has no phantom MCP phase or mcp_integration block', () => {
    const text = skillText;
    expect(text).not.toContain('mcp_integration');
    expect(text).not.toContain('inject_checkpoints');
  });

  test('records the Constitution Gate result in frontmatter and blocks save on violation', () => {
    const text = skillText;
    expect(text).toContain('docs/standards/constitution.md');
    expect(text).toContain('Constitution compliance: passed');
  });
});

// ---------------------------------------------------------------------------
// PRD -> refine -> TRD -> refine -> implement routing.
//
// create-trd used to print implement-trd-beads and configure-team as its next
// steps, which walked a session straight past its own review. The next step is
// now refine-trd and nothing else; implementation is offered by refine-trd's
// closing go/no-go once the TRD has actually been refined.
// ---------------------------------------------------------------------------
describe('create-trd hands off to refine-trd, not to implementation', () => {
  test.each([
    ['skill prompt', skillText],
  ])('%s suggests refine-trd as the next step', (_label, text) => {
    expect(text).toContain("Suggest: '/ensemble:refine-trd");
  });

  test.each([
    ['skill prompt', skillText],
  ])('%s never suggests an implement or configure-team next step', (_label, text) => {
    expect(text).not.toContain("Suggest: '/ensemble:implement-trd-beads");
    expect(text).not.toContain("Suggest: '/ensemble:implement-trd ");
    expect(text).not.toContain("Suggest: '/ensemble:configure-team");
    // The prohibition is stated, not merely absent, so a later edit that
    // re-adds the suggestion has to delete this line to do it.
    expect(text).toContain('Do NOT print /ensemble:implement-trd-beads');
  });

  test.each([
    ['skill prompt', skillText],
  ])('%s warns when the source PRD was never refined', (_label, text) => {
    expect(text).toContain('REFINE CHECK');
    // refine-prd is the only writer of a PRD changelog, which is what makes
    // its absence a usable signal that the PRD was never reviewed.
    expect(text).toContain('## Changelog');
    expect(text).toContain('has no refine-prd changelog entry');
  });

  test.each([
    ['skill prompt', skillText],
  ])('%s re-creates rather than refines when the PRD moved', (_label, text) => {
    expect(text).toContain('PRD-CHANGED CHECK');
    expect(text).toContain('NOT to run /ensemble:refine-trd on the existing one');
  });
});

// ---------------------------------------------------------------------------
// The TRD's PRD link.
//
// trd-parser.js resolves frontmatter `prd_reference` through looksLikePath(),
// which accepts a value only when it contains "/" or ends in ".md". A
// document-id value is silently discarded and the TRD then reads as unlinked
// with no error printed. The command has to specify the value's SHAPE, not
// just the key's name.
// ---------------------------------------------------------------------------
describe('create-trd pins the PRD reference key and its value shape', () => {
  test.each([
    ['skill prompt', skillText],
  ])('%s names the exact frontmatter key', (_label, text) => {
    expect(text).toContain('`prd_reference`');
  });

  test.each([
    ['skill prompt', skillText],
  ])('%s requires a path value, not a document id', (_label, text) => {
    expect(text).toContain("VALUE IS THE PRD'S FILE PATH");
    expect(text).toContain('prd_reference: docs/PRD/PRD-YYYY-<micro_uuid>-<slug>.md');
    expect(text).toContain('It is not the PRD');
    expect(text).toContain('looksLikePath');
  });
});

// ---------------------------------------------------------------------------
// --parser-tables: Foreman table mode.
//
// This is the former standalone create-trd-foreman command, folded into
// create-trd as a flag-gated mode (the variant YAML is deleted). It cannot be
// `--foreman`: create-trd --foreman already means "standard TRD, no prompts"
// and Foreman's own prd workflow runs `create-trd --foreman` and then
// refine-trd / implement-trd on that standard format, so the table format
// needs its own flag. Every assertion below is something the variant did that
// must still be true of `create-trd <prd> --parser-tables`.
// ---------------------------------------------------------------------------
describe('create-trd --parser-tables mode (folded in from create-trd-foreman)', () => {
  const doc = {
    metadata: manifest.metadata,
    parameters: parseParameters(skill.body),
    workflow: { phases: parseWorkflow(skill) },
  };
  const MODE_FLAG = "$ARGUMENTS contains '--parser-tables'";
  const phase = (name) => doc.workflow.phases.find((p) => p.name === name);
  const step = (phaseName, title) => phase(phaseName).steps.find((s) => s.title === title);
  const actionsOf = (phaseName, title) => step(phaseName, title).actions.map(String).join('\n');

  // [phase, title] of every step that only runs in table mode.
  const MODE_STEPS = [
    ['Task Breakdown and Planning', 'Foreman Master Task List Generation (--parser-tables)'],
    ['Task Breakdown and Planning', 'Foreman Test Task Generation (--parser-tables)'],
    ['Task Breakdown and Planning', 'Foreman Dependency Mapping (--parser-tables)'],
    ['Output Management', 'Foreman TRD Document Generation (--parser-tables)'],
    ['Output Management', 'Foreman Traceability Validation (--parser-tables)'],
    ['Output Management', 'Foreman File Save and Next Steps (--parser-tables)'],
  ];
  // [phase, title] of every standard step that table mode replaces or omits.
  const REPLACED_STEPS = [
    ['Task Breakdown and Planning', 'Master Task List Generation'],
    ['Task Breakdown and Planning', 'Test Task Generation'],
    ['Task Breakdown and Planning', 'Dependency Mapping and PR Boundary Design'],
    ['Adversarial Review and Design Gate', 'Architecture Self-Critique'],
    ['Adversarial Review and Design Gate', 'Task Coverage Analysis'],
    ['Adversarial Review and Design Gate', 'Dependency and Estimate Review'],
    ['Adversarial Review and Design Gate', 'Testability Review'],
    ['Adversarial Review and Design Gate', 'Design Readiness Gate'],
    ['Output Management', 'TRD Document Generation'],
    ['Output Management', 'Acceptance Criteria Traceability'],
    ['Output Management', 'File Save and Next Steps'],
  ];

  test('is advertised on the command and documented as distinct from --foreman', () => {
    expect(doc.metadata.argument_hint).toContain('--parser-tables');
    const param = doc.parameters.find((p) => p.name === 'parser-tables');
    expect(param).toBeDefined();
    expect(param.default).toBe(false);
    expect(param.description).toContain('former standalone /ensemble:create-trd-foreman command');
    expect(param.description).toContain("Foreman's parseTrd()");
    expect(param.description).toContain('adversarial review phase is OMITTED');
    expect(param.description).toContain('Not the same as --foreman');
  });

  test('--foreman keeps its standard-TRD meaning and was not repurposed for the table format', () => {
    const foreman = doc.parameters.find((p) => p.name === 'foreman');
    expect(foreman.description).toContain('Design Readiness Gate FAIL');
    expect(foreman.description).not.toContain('parser-compatible');
    // The flag name must not contain '--foreman': the standard path tests
    // "contains '--foreman'" and would otherwise match it by substring.
    expect('--parser-tables'.includes('--foreman')).toBe(false);
  });

  test('each table-mode step runs only under the flag, and each step it replaces is skipped under it', () => {
    for (const [phaseName, title] of MODE_STEPS) {
      expect(step(phaseName, title)).toBeDefined();
      const first = String(step(phaseName, title).actions[0]);
      expect(first).toContain(`Runs only when ${MODE_FLAG}`);
      expect(first).toContain('If it is absent, skip this step');
    }
    for (const [phaseName, title] of REPLACED_STEPS) {
      const first = String(step(phaseName, title).actions[0]);
      expect(first).toContain(`If ${MODE_FLAG}: skip this step`);
    }
  });

  test('the adversarial review phase is omitted in table mode: no Phase 5 step survives, and the mode says so', () => {
    const phaseName = 'Adversarial Review and Design Gate';
    for (const s of phase(phaseName).steps) {
      expect(String(s.actions[0])).toContain(`If ${MODE_FLAG}: skip this step`);
    }
    const first = String(phase(phaseName).steps[0].actions[0]);
    expect(first).toContain('skip this step and every other step of this phase');
    expect(first).toContain('Design Readiness Gate');
    expect(first).toContain('continues with the Constitution Gate phase');
  });

  test('Foreman Master Task List Generation keeps the parser-compatible table rules', () => {
    const text = actionsOf('Task Breakdown and Planning', 'Foreman Master Task List Generation (--parser-tables)');
    expect(text).toContain('Task IDs follow `[A-Z]+-T\\d+`');
    expect(text).toContain('`### N.M Sprint N` headers and `#### Story N.M` headers only');
    expect(text).toContain('write a **Shippable State:** line');
    expect(text).toContain('exact headers `id | task | estimate | dependencies | files | status`');
    expect(text).toContain('the first header must be exactly `id` (lowercase)');
    expect(text).toContain('the second must be `task`, `description`, or `title`');
    expect(text).toContain('Set every Status cell to `[ ]` so Foreman creates dispatchable native tasks');
    expect(text).toContain('Dependencies reference other task IDs exactly as strings');
    // Not the PR-section checkbox format of the standard path.
    expect(text).not.toContain('GitHub checkbox');
  });

  test('Foreman test and dependency steps stay in table form', () => {
    const tests = actionsOf('Task Breakdown and Planning', 'Foreman Test Task Generation (--parser-tables)');
    expect(tests).toContain('using the same table format');
    expect(tests).toContain('never narrative bullet lists');
    expect(tests).toContain('All test/validation Status cells must also be `[ ]`');
    const deps = actionsOf('Task Breakdown and Planning', 'Foreman Dependency Mapping (--parser-tables)');
    expect(deps).toContain('Build a dependency graph from the Dependencies column values');
    expect(deps).toContain('no dependency points to a task ID absent from the final TRD tables');
    expect(deps).toContain('if Task A depends on Task B, B appears before A');
  });

  test('Foreman document generation writes exactly one parser-compatible file', () => {
    const text = actionsOf('Output Management', 'Foreman TRD Document Generation (--parser-tables)');
    expect(text).toContain('Preserve the sprint/story/table structure exactly; never prose checklists');
    expect(text).toContain('NO `-foreman` suffix');
    expect(text).toContain('Write exactly one primary parser-compatible TRD file');
    // No companion artifact writing instructions beyond the prohibition.
    expect(text).not.toContain('Companion artifacts generated');
  });

  test('Foreman validation and save end with the foreman sling prd next step, never a beads command', () => {
    const validation = actionsOf('Output Management', 'Foreman Traceability Validation (--parser-tables)');
    expect(validation).toContain('every task ID in Dependencies exists in the generated tables');
    expect(validation).toContain('columns `id`, `task`, `status` exist for every story table');
    expect(validation).toContain('fail the phase on any `[x]`, `done` or other marker');
    expect(validation).toContain('Foreman compatibility check: parser-safe=<yes/no>, dependency-orphans=N, uncovered-reqs=M');
    const save = actionsOf('Output Management', 'Foreman File Save and Next Steps (--parser-tables)');
    expect(save).toContain('explicit next step `foreman sling prd <original-prd-path>` only after constitution compliance passes');
    expect(save).toContain('suggest no beads-specific implementation commands');
    expect(save).toContain('--team does not apply in this mode');
    expect(save).not.toContain("Suggest: '/ensemble:refine-trd");
  });

  test('shared steps never ask in table mode, as the variant never asked', () => {
    const readiness = actionsOf('PRD Ingestion and Validation', 'Implementation Readiness Gate Check');
    expect(readiness).toContain('--foreman or --parser-tables: skip the ask -- log the warning and proceed automatically');
    expect(readiness).toContain('If --foreman or --parser-tables is set, skip the ask, log the warning, and proceed.');
    const alternatives = actionsOf('Architecture Design', 'Architecture Alternatives');
    expect(alternatives).toContain("'--parser-tables' and does NOT contain '--foreman': skip the ask");
    expect(alternatives).toContain('unless the caller explicitly requested an interactive architecture review');
    expect(actionsOf('Architecture Design', 'Capability Reuse Check')).toContain(
      'keep the Dependencies column local-only'
    );
    expect(actionsOf('Architecture Design', 'Domain Analysis')).toContain(
      'record COMPANION_DOMAINS as empty -- Foreman table mode writes exactly one parser-compatible TRD file'
    );
  });

  test('keeps the constitution gate non-bypassable in table mode and withholds the foreman sling prd step on violation', () => {
    const text = skillText;
    const start = text.indexOf('there is no Design Readiness Gate in this mode');
    expect(start).toBeGreaterThan(-1);
    const contract = text.slice(start, start + 700);
    expect(contract).toContain('Foreman compatibility checks exist in memory');
    expect(contract).toContain('printing the foreman sling prd next step');
    expect(contract).toContain('non-bypassable unconditionally');
    expect(contract).toContain('do not offer any proceed anyway, override, skip, soft-confirmation or default-proceed path');
    expect(contract).toContain('do not print the foreman sling prd next-step output');
  });

  test('the manifest advertises the flag, and the skill carries the flag, the mode steps and the foreman sling prd next step', () => {
    expect(manifest.metadata.argument_hint).toBe('[prd-path] [--team] [--foundational] [--list] [--foreman] [--parser-tables] [--bdd | --no-bdd]');
    expect(skill.body).toContain('- **`parser-tables`** (boolean, optional, default: `false`)');
    for (const [, title] of MODE_STEPS) {
      expect(skillText).toContain(title);
    }
    expect(skillText).toContain('explicit next step `foreman sling prd <original-prd-path>` only after constitution compliance passes');
  });
});

describe('create-trd is a skill-backed command', () => {
  const referenceNamed = (name) => skill.references.find((reference) => path.basename(reference.file) === name);

  test('its YAML is a manifest -- metadata and a skill, no prompt of its own', () => {
    expect(Object.keys(manifest).sort()).toEqual(['metadata', 'skill']);
    expect(manifest.skill).toBe('ensemble-create-trd');
    expect(path.basename(path.dirname(skill.file))).toBe(manifest.skill);
    expect(skill.frontmatter.name).toBe(manifest.skill);
  });

  test('SKILL.md indexes every phase file by its relative path, and every indexed file exists', () => {
    const indexed = [...skill.body.matchAll(/`(references\/[^`]+\.md)`/g)].map((match) => match[1]).sort();
    const present = skill.references.map((reference) => `references/${path.basename(reference.file)}`);
    expect(present).toHaveLength(6);
    expect(indexed).toEqual(present);
  });

  // One phrase per phase that is in that phase's file and nowhere else, so a phase body
  // deleted from references/ -- or pasted back into SKILL.md -- fails here.
  test.each([
    ['phase-1-prd-ingestion-and-validation.md', 'REFINE CHECK'],
    ['phase-2-architecture-design.md', 'keep the Dependencies column local-only'],
    ['phase-3-task-breakdown-and-planning.md', 'Every task line MUST begin with a GitHub checkbox'],
    ['phase-4-adversarial-review-and-design-gate.md', 'node "$TRD_CLI" parse'],
    ['phase-5-constitution-gate.md', 'Constitution compliance: passed'],
    ['phase-6-output-management.md', 'Do NOT print /ensemble:implement-trd-beads'],
  ])('%s holds its phase, which SKILL.md does not repeat: %s', (name, phrase) => {
    const reference = referenceNamed(name);
    expect(reference).toBeDefined();
    expect(reference.text).toContain(phrase);
    expect(skill.body).not.toContain(phrase);
    expect(skillText).toContain(phrase);
  });

  test('the prose the gates scan for this command is its SKILL.md and every phase file', () => {
    const prose = readCommandProse(manifestPath, manifest, fs.readFileSync(manifestPath, 'utf8'));
    expect(prose).toContain(skill.body);
    for (const reference of skill.references) {
      expect(prose).toContain(reference.text);
    }
  });

  test('the Expected Input section carries the PRD sections the command reads', () => {
    expect(skill.body).toContain('## Expected Input');
    expect(skill.body).toContain('format: Product Requirements Document (PRD)');
    expect(skill.body).toContain('Given/When/Then AC-NNN-M sub-items');
  });
});

describe('create-trd Claude Code stub', () => {
  const stubBody = transformCommandToMarkdown(manifest, manifestPath).replace(/^---\n[\s\S]*?\n---\n/, '');

  test('tells Claude to read the skill, resolve its relative paths and passes $ARGUMENTS through; it carries no prompt text', () => {
    expect(stubBody).toBe(
      '<!-- DO NOT EDIT - Generated from create-trd.yaml -->\n' +
      '<!-- To modify this file, edit the YAML source and run: npm run generate -->\n' +
      '\n' +
      'Read the file ${CLAUDE_PLUGIN_ROOT}/skills/ensemble-create-trd/SKILL.md and follow its instructions exactly; ' +
      'resolve any relative paths in it against ${CLAUDE_PLUGIN_ROOT}/skills/ensemble-create-trd/. ' +
      'Wherever that file refers to its ARGUMENTS, use this value: $ARGUMENTS\n'
    );
  });
});
