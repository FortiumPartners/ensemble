const { readDevelopmentSkill, parseWorkflow } = require('./helpers/skill-workflow');

// beads-build and implement-trd-beads are skill-backed commands: the prompt is the skill
// (SKILL.md + references/), and the workflow is parsed back out of its phase references.
const buildSkill = readDevelopmentSkill('ensemble-beads-build');
const callerText = readDevelopmentSkill('ensemble-implement-trd-beads').prompt;

function stepActions(phases, phaseName, title) {
  const phase = phases.find((p) => p.name === phaseName);
  return phase.steps.find((s) => s.title === title).actions.join('\n');
}

function parsingActions(phases) {
  return stepActions(phases, 'Preflight', 'Argument Parsing');
}

describe('beads-build argument grammar matches its callers', () => {
  const build = parseWorkflow(buildSkill);
  const parsing = parsingActions(build);

  test('accepts the flag form callers pass, plus the free-text form, defaulting to 3', () => {
    expect(parsing).toContain('--max-parallel');
    expect(parsing).toContain('max parallel N');
    expect(parsing).toContain('default MAX_PARALLEL=3');
    expect(parsing).not.toContain('default MAX_PARALLEL=1');
  });

  test('accepts --epic as the epic id source', () => {
    expect(parsing).toMatch(/--epic <value>.*RAW_INPUT=<value>/);
  });

  test('every flag implement-trd-beads passes to beads-build is parsed by beads-build', () => {
    const calls = callerText.match(/\/ensemble:beads-build <ROOT_EPIC_ID>([^`]*--defer-completion)`/);
    expect(calls).not.toBeNull();
    const passed = (calls[1].match(/--[a-z-]+/g) || []);
    expect(passed).toEqual(expect.arrayContaining(['--trd', '--max-parallel', '--team-roles', '--label']));
    for (const flag of new Set(passed)) {
      expect(parsing).toContain(flag);
    }
  });

  test('delegation passes --defer-completion and beads-build skips epic closure and checkbox sync on it', () => {
    expect(parsing).toContain('--defer-completion');
    expect(callerText).toContain('--label <TRD_LABEL> --defer-completion');
    expect(stepActions(build, 'Completion', 'Epic Closure')).toContain('If DEFER_COMPLETION=true');
    expect(stepActions(build, 'Completion', 'TRD Checkbox Sync')).toContain('If DEFER_COMPLETION=true');
    // The deferral guard must precede the closing command in each step.
    const closure = stepActions(build, 'Completion', 'Epic Closure');
    expect(closure.indexOf('If DEFER_COMPLETION=true')).toBeLessThan(closure.indexOf('tracker.close'));
    const sync = stepActions(build, 'Completion', 'TRD Checkbox Sync');
    expect(sync.indexOf('If DEFER_COMPLETION=true')).toBeLessThan(sync.indexOf('replace "- [ ]'));
  });
});
