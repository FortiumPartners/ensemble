const fs = require('fs');
const path = require('path');

describe('implement-trd-task command contract (v1.0.0 single-task primitive)', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd-task.yaml');

  test('required --task and --trd arguments and HALT on absence', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toMatch(/--task <id> sets TASK_ID/);
    expect(text).toMatch(/ERROR: --task <id> is required/);
    expect(text).toMatch(/--trd <path> is required/);
  });

  test('workflow is exactly two phases: Preflight + Execute (no Quality Gate, no Completion)', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toMatch(/- name: Preflight/);
    expect(text).toMatch(/- name: Execute/);
    expect(text).not.toMatch(/- name: Quality Gate/);
    expect(text).not.toMatch(/- name: Completion/);
  });

  test('Execute phase has exactly one step: Single-Task Dispatch', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const execStart = text.indexOf('- name: Execute');
    const execEnd = text.indexOf('expectedInput:');
    expect(execStart).toBeGreaterThan(-1);
    expect(execEnd).toBeGreaterThan(execStart);
    const execBlock = text.slice(execStart, execEnd);
    expect(execBlock).toMatch(/title: Single-Task Dispatch/);
  });

  test('Single-Task Dispatch never calls itself or any sibling task-runner (no recursion)', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const execStart = text.indexOf('- name: Execute');
    const dispatchSection = text.slice(execStart, text.indexOf('expectedInput:'));
    expect(dispatchSection).toMatch(/Does NOT loop/);
    expect(dispatchSection).toMatch(/Does NOT call itself recursively/);
    expect(dispatchSection).toMatch(/Does NOT invoke any sibling task-runner subagent/);
    expect(dispatchSection).toMatch(/Does NOT advance to the next task/);
  });

  test('specialist dispatch resolves from targetFiles (never bare name to Task())', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const dispatchStart = text.indexOf('Step 1d (generic specialist dispatch');
    const dispatchSection = text.slice(dispatchStart, text.indexOf('Step 2 (RED', dispatchStart));
    expect(dispatchSection).toMatch(/NEVER pass a bare specialist name to Task/);
    expect(dispatchSection).toMatch(/Task\(subagent_type=</);
  });

  test('review step enforces 2-round cap and skip conditions', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const reviewStep = text.slice(text.indexOf('Step 3 (review)'), text.indexOf('Step 4 (close)'));
    expect(reviewStep).toMatch(/max 2 review rounds total/);
    expect(reviewStep).toMatch(/characterization or flexible/);
    expect(reviewStep).toMatch(/docs\/documentation-only/);
  });

  test('close step updates checkbox and commits with task convention', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const closeStep = text.slice(text.indexOf('Step 4 (close)'), text.indexOf('Step 5 (automated'));
    expect(closeStep).toMatch(/- \[ \]" to "- \[x\]"/);
    expect(closeStep).toMatch(/feat\(<trd-slug>\): <TASK_ID>/);
  });

  test('automated remediation before halt: 2 review rounds + 1 debug attempt then halt', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const remStep = text.slice(text.indexOf('Step 5 (automated'), text.indexOf('PM clarification loop guard'));
    expect(remStep).toMatch(/delegate to deep-debugger/);
    expect(remStep).toMatch(/emit summary task_state="rejected_halt"/);
  });

  test('PM clarification loop guard: 3-round cap, halt on 4th', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const pmStep = text.slice(text.indexOf('PM clarification loop guard'), text.indexOf('Step 6 (build summary)'));
    expect(pmStep).toMatch(/Maximum 3 PM clarification rounds per task/);
    expect(pmStep).toMatch(/On the 4th request, emit summary task_state="pm_exhausted_halt"/);
  });

  test('JSON summary schema is the contract: canonical task_state names match parent', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const schemaBlock = text.slice(text.indexOf('Schema (one line'), text.indexOf('Print the JSON summary'));
    expect(schemaBlock).toMatch(/task_state \("approved_closed"\|"rejected_halt"\|"pm_exhausted_halt"\|"blocked"\|"already_closed"\)/);
    expect(schemaBlock).toMatch(/next_action_hint \("dispatch_next_task"\|"stop_sprint_complete"\|"stop_halt_user"\|"stop_blocked"\)/);
  });

  test('summary is the last line of stdout, no follow-up prose', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const lastLines = text.slice(text.indexOf('Print the JSON summary'));
    expect(lastLines).toMatch(/Print the JSON summary as the LAST line of stdout/);
    expect(lastLines).toMatch(/Do NOT print follow-up prose/);
  });

  test('already-closed resume path (idempotent re-invocation)', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const taskStep = text.slice(text.indexOf('Task Resolution'), text.indexOf('Strategy Detection'));
    expect(taskStep).toMatch(/already closed \(resume\)/);
    expect(taskStep).toMatch(/task_state="already_closed"/);
  });

  test('dependency-readiness check before dispatch (parent owns recovery, child emits blocked only)', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const taskStep = text.slice(text.indexOf('Task Resolution'), text.indexOf('Strategy Detection'));
    expect(taskStep).toMatch(/dependency-readiness/);
    expect(taskStep).toMatch(/every id in TASK_CONTEXT.dependsOn must already have a "- \[x\]"/);
    expect(taskStep).toMatch(/emit summary task_state="blocked"/);
  });

  test('cross-platform: works with Task() on claude/pi/codex/opencode (mentioned in mission)', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const missionBlock = text.slice(text.indexOf('mission:'), text.indexOf('workflow:'));
    expect(missionBlock).toMatch(/claude\/pi\/codex\/opencode/);
    expect(missionBlock).toMatch(/universal Task\(\) primitive/);
    expect(missionBlock).toMatch(/Codex max_depth=1/);
  });

  test('mission summary explains the two-tier loop architecture', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const missionBlock = text.slice(text.indexOf('mission:'), text.indexOf('workflow:'));
    expect(missionBlock).toMatch(/two-tier non-recursive dispatch\s+loop/i);
    expect(missionBlock).toMatch(/implement-trd-task/);
    expect(missionBlock).toMatch(/max_depth=1/);
  });

  test('enforces Code review (code-reviewer) and automated remediation (deep-debugger) subagents', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toMatch(/code-reviewer/);
    expect(text).toMatch(/deep-debugger/);
  });

  test('metadata and schema fields are valid', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toMatch(/version: \d+\.\d+\.\d+/);
    expect(text).toMatch(/lastUpdated: "\d{4}-\d{2}-\d{2}"/);
    expect(text).toMatch(/name: ensemble:implement-trd-task/);
    expect(text).toMatch(/output_path: ensemble\/implement-trd-task\.md/);
    expect(text).toMatch(/category: implementation/);
  });
});
