'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const sourcePath = path.join(__dirname, '../commands/create-trd.yaml');
const generatedPath = path.join(__dirname, '../commands/ensemble/create-trd.md');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

describe('create-trd command document ids', () => {
  test('reuses source PRD micro UUID instead of allocating a new sequence', () => {
    const text = read(sourcePath);
    expect(text).toContain('PRD-YYYY-<micro_uuid>');
    expect(text).toContain('TRD_MICRO_UUID');
    expect(text).toContain('docs/TRD/TRD-YYYY-<TRD_MICRO_UUID>-<slug>.md');
    expect(text).not.toContain('TRD-YYYY-NNN-<slug>.md');
  });

  test.each([
    ['Master Task List Generation', 'Test Task Generation', 'Every task line MUST begin with a GitHub checkbox'],
    ['Test Task Generation', 'Dependency Mapping and PR Boundary Design', 'Every TRD-NNN-TEST line MUST begin with the same checkbox-prefix requirement as implementation tasks'],
  ])('%s requires the checkbox prefix that TASK_LINE_RE parses', (title, nextTitle, phrase) => {
    const text = read(sourcePath);
    const start = text.indexOf(`title: ${title}`);
    const next = text.indexOf(`title: ${nextTitle}`);
    expect(start).toBeGreaterThan(-1);
    expect(next).toBeGreaterThan(start);
    expect(text.slice(start, next)).toContain(phrase);
  });

  test('Task Coverage Analysis self-checks the draft Master Task List via trd-cli.js parse', () => {
    const text = read(sourcePath);
    const start = text.indexOf('title: Task Coverage Analysis');
    const next = text.indexOf('title: Dependency and Estimate Review');
    expect(start).toBeGreaterThan(-1);
    expect(next).toBeGreaterThan(start);
    const scoped = text.slice(start, next);
    expect(scoped).toContain('Resolve TRD_CLI per the tool-path-resolution skill (packages/development/skills/tool-path-resolution/SKILL.md) for packages/development/lib/trd-cli.js');
    expect(scoped).toContain('node \\"$TRD_CLI\\" parse');
  });

  test('keeps the companion artifact output contract', () => {
    const text = read(sourcePath);
    expect(text).toContain('COMPANION_DOMAINS');
    expect(text).toContain('`<trd-stem>-data-model.md`');
    expect(text).toContain('`<trd-stem>-research.md`');
    expect(text).toContain('## Companion Artifacts');
    expect(text).toContain('Companion artifacts generated:');
    expect(text).toContain('No companion artifacts generated.');
  });

  test('has no phantom MCP phase or mcp_integration block', () => {
    const text = read(sourcePath);
    expect(text).not.toContain('mcp_integration');
    expect(text).not.toContain('inject_checkpoints');
  });

  test('records the Constitution Gate result in frontmatter and blocks save on violation', () => {
    const text = read(sourcePath);
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
    ['source YAML', sourcePath],
    ['generated command markdown', generatedPath],
  ])('%s suggests refine-trd as the next step', (_label, filePath) => {
    expect(read(filePath)).toContain("Suggest: '/ensemble:refine-trd");
  });

  test.each([
    ['source YAML', sourcePath],
    ['generated command markdown', generatedPath],
  ])('%s never suggests an implement or configure-team next step', (_label, filePath) => {
    const text = read(filePath);
    expect(text).not.toContain("Suggest: '/ensemble:implement-trd-beads");
    expect(text).not.toContain("Suggest: '/ensemble:implement-trd ");
    expect(text).not.toContain("Suggest: '/ensemble:configure-team");
    // The prohibition is stated, not merely absent, so a later edit that
    // re-adds the suggestion has to delete this line to do it.
    expect(text).toContain('Do NOT print /ensemble:implement-trd-beads');
  });

  test.each([
    ['source YAML', sourcePath],
    ['generated command markdown', generatedPath],
  ])('%s warns when the source PRD was never refined', (_label, filePath) => {
    const text = read(filePath);
    expect(text).toContain('REFINE CHECK');
    // refine-prd is the only writer of a PRD changelog, which is what makes
    // its absence a usable signal that the PRD was never reviewed.
    expect(text).toContain('## Changelog');
    expect(text).toContain('has no refine-prd changelog entry');
  });

  test.each([
    ['source YAML', sourcePath],
    ['generated command markdown', generatedPath],
  ])('%s re-creates rather than refines when the PRD moved', (_label, filePath) => {
    const text = read(filePath);
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
    ['source YAML', sourcePath],
    ['generated command markdown', generatedPath],
  ])('%s names the exact frontmatter key', (_label, filePath) => {
    expect(read(filePath)).toContain('`prd_reference`');
  });

  test.each([
    ['source YAML', sourcePath],
    ['generated command markdown', generatedPath],
  ])('%s requires a path value, not a document id', (_label, filePath) => {
    const text = read(filePath);
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
  const doc = yaml.load(read(sourcePath));
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
    ['Task Breakdown and Planning', 'Test Task Generation (BDD)'],
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

  test.each([
    ['source YAML', sourcePath],
    ['generated command markdown', generatedPath],
  ])('%s keeps the constitution gate non-bypassable in table mode and withholds the foreman sling prd step on violation', (_label, filePath) => {
    const text = read(filePath);
    const start = text.indexOf('there is no Design Readiness Gate in this mode');
    expect(start).toBeGreaterThan(-1);
    const contract = text.slice(start, start + 700);
    expect(contract).toContain('Foreman compatibility checks exist in memory');
    expect(contract).toContain('printing the foreman sling prd next step');
    expect(contract).toContain('non-bypassable unconditionally');
    expect(contract).toContain('do not offer any proceed anyway, override, skip, soft-confirmation or default-proceed path');
    expect(contract).toContain('do not print the foreman sling prd next-step output');
  });

  test('generated command markdown renders the flag, the mode steps and the foreman sling prd next step', () => {
    const md = read(generatedPath);
    expect(md).toContain('argument-hint: "[prd-path] [--team] [--foundational] [--list] [--foreman] [--parser-tables]"');
    expect(md).toContain('- **`parser-tables`** (boolean, optional, default: `false`)');
    for (const [, title] of MODE_STEPS) {
      expect(md).toContain(title);
    }
    expect(md).toContain('explicit next step `foreman sling prd <original-prd-path>` only after constitution compliance passes');
  });
});
