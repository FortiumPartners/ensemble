'use strict';

/**
 * Reads a skill-backed command of the development package back into the shapes its YAML
 * used to hold, so tests can keep asserting on phases, steps, actions and parameters.
 *
 * The skill's `references/phase-N-*.md` files hold the workflow verbatim: a
 * `### Phase N: <name>` heading, then `#### Step N.M: <title>` headings, each followed by a
 * one-line description and `- <action>` bullets. The `## Arguments` section of SKILL.md holds
 * one `- **`name`** (type, optional, default: `value`): description` bullet per parameter.
 */

const path = require('path');

const { readSkill } = require('../../../product/tests/helpers/skill-prompt');

const PACKAGE_DIR = path.join(__dirname, '..', '..');
const PHASE_HEADING = /^### Phase (\d+): (.+)$/;
const STEP_HEADING = /^#### Step [\d.]+: (.+)$/;
const PARAMETER = /^- \*\*`([^`]+)`\*\* \(([^,)]+)(?:, (optional|required))?(?:, default: (.+?))?\): (.*)$/;

/** The skill of a development-package command: SKILL.md, references and the whole prompt. */
function readDevelopmentSkill(skill) {
  return readSkill(skill, PACKAGE_DIR);
}

/** The phases of the skill's reference files: `[{order, name, steps: [{title, description, actions}]}]`. */
function parseWorkflow(skill) {
  const phases = [];
  let phase = null;
  let step = null;
  let inActions = false;
  for (const reference of skill.references) {
    for (const line of reference.text.split('\n')) {
      let match = PHASE_HEADING.exec(line);
      if (match) {
        phase = { order: Number(match[1]), name: match[2], steps: [] };
        phases.push(phase);
        step = null;
        continue;
      }
      match = STEP_HEADING.exec(line);
      if (match && phase) {
        step = { title: match[1], description: '', actions: [] };
        phase.steps.push(step);
        inActions = false;
        continue;
      }
      if (!step || line.trim() === '') continue;
      if (line.startsWith('- ')) {
        step.actions.push(line.slice(2));
        inActions = true;
      } else if (inActions) {
        step.actions[step.actions.length - 1] += `\n${line}`;
      } else {
        step.description += (step.description ? '\n' : '') + line;
      }
    }
  }
  return phases;
}

/** The `## Arguments` bullets as `[{name, type, required, default, description}]`. */
function parseParameters(body) {
  const marker = '\n## Arguments\n';
  const start = body.indexOf(marker);
  if (start === -1) throw new Error('skill has no "## Arguments" section');
  const from = start + marker.length;
  const next = body.indexOf('\n## ', from);
  return body
    .slice(from, next === -1 ? body.length : next)
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => {
      const match = PARAMETER.exec(line);
      if (!match) throw new Error(`unparsable argument line: ${line.slice(0, 80)}`);
      const [, name, type, requirement, rawDefault, description] = match;
      return {
        name,
        type,
        required: requirement === 'required',
        default: rawDefault === undefined ? undefined : JSON.parse(rawDefault.replace(/^`|`$/g, '')),
        description,
      };
    });
}

module.exports = { readDevelopmentSkill, parseWorkflow, parseParameters };
