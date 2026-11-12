'use strict';

/**
 * /ensemble:pr-merge is a skill-backed command: packages/git/commands/pr-merge.yaml is a
 * manifest (metadata + `skill:`) and the prompt is packages/git/skills/ensemble-pr-merge/SKILL.md.
 * This reads the pair back into the shape the YAML used to hold -- `metadata`, `constraints`,
 * `workflow.phases[].steps[].actions` -- so tests keep asserting on phases, steps and actions.
 *
 * The SKILL.md keeps the workflow inline (it is not split into references): `### Phase N: <name>`,
 * `#### Step N.M: <title>`, an optional description line, `- <action>` bullets and an optional
 * `**Delegation:** @agent` block.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const MANIFEST_REL = 'packages/git/commands/pr-merge.yaml';
const SKILL_REL = 'packages/git/skills/ensemble-pr-merge/SKILL.md';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/** The manifest as parsed YAML (metadata + skill). */
const MANIFEST = yaml.load(read(MANIFEST_REL));

/** The SKILL.md text: the prompt of the command. */
const SKILL_TEXT = read(SKILL_REL);

const PHASE_HEADING = /^### Phase (\d+): (.+)$/;
const STEP_HEADING = /^#### Step (\d+)\.(\d+): (.+)$/;

/** Text of the `## <heading>` section of the skill. */
function section(heading) {
  const marker = `\n## ${heading}\n`;
  const start = SKILL_TEXT.indexOf(marker);
  if (start === -1) throw new Error(`pr-merge skill has no "## ${heading}" section`);
  const from = start + marker.length;
  const next = SKILL_TEXT.indexOf('\n## ', from);
  return SKILL_TEXT.slice(from, next === -1 ? SKILL_TEXT.length : next);
}

const constraints = section('Constraints')
  .split('\n')
  .filter((line) => line.startsWith('- '))
  .map((line) => line.slice(2));

function parsePhases() {
  const phases = [];
  let phase = null;
  let step = null;
  for (const line of section('Workflow').split('\n')) {
    let match = PHASE_HEADING.exec(line);
    if (match) {
      phase = { order: Number(match[1]), name: match[2], steps: [] };
      phases.push(phase);
      step = null;
      continue;
    }
    match = STEP_HEADING.exec(line);
    if (match && phase) {
      step = { order: Number(match[2]), title: match[3], description: '', actions: [] };
      phase.steps.push(step);
      continue;
    }
    if (!step) continue;
    if (line.startsWith('**Delegation:**')) {
      step.delegation = { agent: line.slice('**Delegation:**'.length).trim().replace(/^@/, ''), context: '' };
      continue;
    }
    if (line.trim() === '') continue;
    if (step.delegation) step.delegation.context += (step.delegation.context ? '\n' : '') + line;
    else if (line.startsWith('- ')) step.actions.push(line.slice(2));
    else if (step.actions.length === 0) step.description += (step.description ? '\n' : '') + line;
  }
  return phases;
}

/** The yaml block of `## Expected Input`. */
function parseExpectedInput() {
  const match = /```yaml\n([\s\S]*?)\n```/.exec(section('Expected Input'));
  if (!match) throw new Error('pr-merge skill has no yaml block in "## Expected Input"');
  return yaml.load(match[1]);
}

/** The command as its YAML used to hold it. */
const COMMAND = {
  metadata: MANIFEST.metadata,
  constraints,
  workflow: { phases: parsePhases() },
  expectedInput: parseExpectedInput(),
};

module.exports = { COMMAND, MANIFEST, MANIFEST_REL, SKILL_REL, SKILL_TEXT, REPO_ROOT };
