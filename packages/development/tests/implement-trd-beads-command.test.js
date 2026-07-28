const fs = require('fs');
const path = require('path');

describe('implement-trd-beads command progress behavior', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd-beads.yaml');

  test('does not pause for routine progress or context checkpoints', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('Non-Interactive Progress Policy');
    expect(text).toContain('Do NOT stop, pause, ask for acknowledgement');
    expect(text).toContain('real user decision');
    expect(text).not.toContain('Context checkpoint: <N> tasks completed this session');
    expect(text).not.toContain('/compact to compress conversation context');
  });

  test('resolves shorthand agents to runtime namespaced plugin agents before delegation', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('AGENT_ALIAS_MAP');
    expect(text).toContain('ensemble-full:backend-developer');
    expect(text).toContain('Task(agent_type=<resolved_specialist>');
    expect(text).toContain('resolved @code-reviewer');
    expect(text).toContain('resolved @deep-debugger');
  });

  test('does not call trd_progress after every task', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('Do NOT call trd_progress() here');
    expect(text).not.toContain('After each task (or parallel group): br sync --flush-only, then call trd_progress()');
  });
});


describe('implement-trd-beads RCA quality gates', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd-beads.yaml');

  test('supports AC/XC synthetic task ids and Definition of Done closure gates', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('AC-NNN-M');
    expect(text).toContain('XC-NNN synthetic validation tasks');
    expect(text).toContain('Definition of Done gate');
    expect(text).toContain('no new src/**/*.FIXME');
    expect(text).toContain('Only close when verdict:proven');
  });
});


describe('implement-trd-beads direct multi-TRD deprecation', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd-beads.yaml');
  test('errors on direct multiple TRDs and points to create-workstream-trd', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('Multiple TRDs passed directly');
    expect(text).toContain('/ensemble:create-workstream-trd');
    expect(text).toContain('--legacy-multi');
    expect(text).toContain('DEPRECATED: direct multi-TRD mode');
  });
});


describe('implement-trd-beads execution blocked-check logic', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd-beads.yaml');

  test('blocked-check uses live bead graph, not parsed depends-on', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    // Must use live bead graph via br dep list
    expect(text).toContain('br dep list');
    expect(text).toContain('br show');
    // Step a must NOT consult TASK_TRACEABILITY depends-on for blocker ids
    // (phaseN lookup is fine; blocker ids must come from br dep list)
    expect(text).not.toMatch(/look up.*depends-on.*in TASK_TRACEABILITY/);
  });

  test('blocked-check computes current_phase from PHASE_TASK_IDS and CLOSED_TRD_IDS', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('PHASE_TASK_IDS');
    expect(text).toContain('CLOSED_TRD_IDS');
    // next-task algorithm: lowest phase with unclosed tasks
    expect(text).toMatch(/lowest phaseN in PHASE_TASK_IDS that has any task id NOT in CLOSED_TRD_IDS/);
  });

  test('blocked-check distinguishes current-phase blockers from later-phase tasks', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    // Later-phase state is irrelevant; current_phase is decisive
    expect(text).toMatch(/Tasks in later phases are irrelevant/);
    // HALT only when current_phase is blocked
    expect(text).toMatch(/EXECUTION BLOCKED.*current-phase.*open blockers/);
    // Retry/inconsistency only when current_phase unblocked
    expect(text).toMatch(/genuine inconsistency.*current-phase.*all blockers closed/);
  });

  test('old stale blocked-check text is gone', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    // No more "SOME remaining open tasks have ALL blockers closed" phrasing
    expect(text).not.toMatch(/SOME remaining open tasks have ALL blockers closed/);
    // No more generic "EXECUTION BLOCKED" without current_phase context
    expect(text).not.toMatch(/EXECUTION BLOCKED.*all.*remaining open tasks are waiting/);
  });
});
