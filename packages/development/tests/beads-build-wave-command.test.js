const fs = require('fs');
const path = require('path');

const { readDevelopmentSkill } = require('./helpers/skill-workflow');

describe('beads-build-wave command contract (v1.2.0 wave-runner primitive)', () => {
  const yamlPath = path.join(__dirname, '../commands/beads-build-wave.yaml');

  test('metadata declares the single-wave primitive contract', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toMatch(/name: ensemble:beads-build-wave/);
    expect(text).toMatch(/Single-wave primitive/);
    expect(text).toMatch(/non-recursive/);
  });

  test('required --epic argument and HALT on absence', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const block = text.slice(
      text.indexOf('title: Argument Parsing'),
      text.indexOf('title: Tool Availability Check')
    );
    expect(block).toMatch(/--epic <id> sets ROOT_EPIC_ID/);
    expect(block).toMatch(/ERROR: --epic <id> is required/);
  });

  test('bv is optional: falls back to work-graph.ready, one bead per track', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).not.toMatch(/bv \(beads_viewer\) is required/);
    expect(text).toMatch(/work-graph\.ready/);
    expect(text).toMatch(/single-bead track/);
  });

  test('stages explicit paths, never a blanket stage or .beads', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toMatch(/stage exactly the files the wave modified/);
    expect(text).toMatch(/NEVER a blanket or whole-directory stage, an auto-staging commit, or anything under \.beads\//);
    expect(text).toMatch(/run workflow\.commit/);
  });

  test('workflow is exactly two phases: Preflight + Execute (no Quality Gate, no Completion)', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toMatch(/- name: Preflight/);
    expect(text).toMatch(/- name: Execute/);
    expect(text).not.toMatch(/- name: Quality Gate/);
    expect(text).not.toMatch(/- name: Completion/);
  });

  test('Execute phase has exactly one step: Single-Wave Dispatch', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const execBlock = text.slice(
      text.indexOf('- name: Execute'),
      text.indexOf('expectedInput:')
    );
    expect(execBlock).toMatch(/title: Single-Wave Dispatch/);
    expect(execBlock).toMatch(/Step 1 \(sync\): before this command''s first tracker write/);
    expect(execBlock).toMatch(/Step 5 \(concurrent dispatch\)/);
    expect(execBlock).toMatch(/Step 6 \(barrier\)/);
    expect(execBlock).toMatch(/Step 8 \(build summary\)/);
  });

  test('no-recursion contract: command must NOT call itself or sibling wave-runners', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const execBlock = text.slice(
      text.indexOf('- name: Execute'),
      text.indexOf('expectedInput:')
    );
    expect(execBlock).toMatch(/Does NOT loop/);
    expect(execBlock).toMatch(/Does NOT call itself recursively/);
    expect(execBlock).toMatch(/Does NOT invoke any sibling wave-runner subagent/);
  });

  test('JSON summary schema is documented and is the only output', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const execBlock = text.slice(
      text.indexOf('- name: Execute'),
      text.indexOf('expectedInput:')
    );
    expect(execBlock).toMatch(/remaining_scoped_count/);
    expect(execBlock).toMatch(/terminal_state/);
    expect(execBlock).toMatch(/next_action_hint/);
    expect(execBlock).toMatch(/LAST line of stdout/);
    expect(execBlock).toMatch(/the summary is the contract/);
  });

  test('payload per track includes goal, scope, team_roles, track_beads, lifecycle_contract', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toMatch(/track_beads/);
    expect(text).toMatch(/lifecycle_contract/);
    expect(text).toMatch(/context_contract/);
    expect(text).toMatch(/quality_loop/);
    expect(text).toMatch(/pm_clarification_guard/);
  });

  test('Preflight refuses to dispatch on the repository default branch (hard precondition, no self-serve branch creation)', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toMatch(/title: Working Directory and Branch Verification/);
    expect(text).toMatch(/CURRENT_BRANCH/);
    expect(text).toMatch(/DEFAULT_BRANCH/);
    expect(text).toMatch(/HARD PRECONDITION/);
    expect(text).toMatch(/refuses to dispatch on the repository default branch/);
    expect(text).toMatch(/detached HEAD/);
    expect(text).toMatch(/does NOT create or switch branches itself/);
  });

  test('lifecycle_contract has a Commit Gate that blocks br close until workflow.status is clean (self-reported success is not sufficient evidence)', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toMatch(/COMMIT GATE/);
    expect(text).toMatch(/NEVER call tracker\.close while workflow\.status lists non-\.beads\/ paths/);
    expect(text).toMatch(/self-reported success is NOT evidence of a commit/);
  });

  test('cross-platform: works with Task() on claude/pi/codex/opencode (mentioned in mission)', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toMatch(/claude\/pi\/codex\/opencode/);
    expect(text).toMatch(/universal Task\(\) primitive/);
  });
});

describe('beads-build v1.2.0 wave-loop contract', () => {
  // beads-build is skill-backed: the prompt is its skill (SKILL.md + references/), the YAML a manifest.
  const skillText = readDevelopmentSkill('ensemble-beads-build').prompt;
  const executeBlock = () => {
    const execStart = skillText.indexOf('### Phase 2: Execute');
    const execEnd = skillText.indexOf('#### Step 2.2: Debug Loop');
    expect(execStart).toBeGreaterThan(-1);
    expect(execEnd).toBeGreaterThan(execStart);
    return skillText.slice(execStart, execEnd);
  };

  test('Execute phase step 1 is now the two-tier Wave Loop (was inline Track Orchestrator)', () => {
    const execBlock = executeBlock();
    expect(execBlock).toMatch(/Step 2.1: Wave Loop \(single-wave subagent dispatch\)/);
    expect(execBlock).not.toMatch(/Step 2.1: Track Orchestrator \(bv --robot-plan scheduler \+ track dispatch\)/);
  });

  test('Wave Loop body dispatches Task() to a wave-runner (not bv --robot-plan inline)', () => {
    const execBlock = executeBlock();
    expect(execBlock).toMatch(/Task\(subagent_type=<resolved-from-AGENT_ALIAS_MAP-beads-build-wave>/);
    expect(execBlock).toMatch(/does NOT call work-graph\.ready\/work-graph\.plan for scheduling/);
    expect(execBlock).toMatch(/Two-tier non-recursive dispatch loop/);
  });

  test('Wave Loop reads JSON summary line and decides based on terminal_state', () => {
    const execBlock = executeBlock();
    expect(execBlock).toMatch(/terminal_state == "complete"/);
    expect(execBlock).toMatch(/terminal_state == "blocked"/);
    expect(execBlock).toMatch(/terminal_state == "in_progress"/);
    expect(execBlock).toMatch(/next_action_hint == "dispatch_another_wave"/);
  });

  test('Cross-platform constraint acknowledged (Codex max_depth=1)', () => {
    const execBlock = executeBlock();
    expect(execBlock).toMatch(/Codex's max_depth=1 constraint/);
  });

  test('mission summary states the parent-loop / one-wave-per-runner contract', () => {
    const missionBlock = skillText.slice(0, skillText.indexOf('## Workflow'));
    expect(missionBlock).toMatch(/remaining_scoped_count/);
    expect(missionBlock).toMatch(/No recursion/);
    expect(missionBlock).toMatch(/beads-build-wave/);
    expect(missionBlock).toMatch(/max_depth=1/);
  });
});
