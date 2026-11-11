'use strict';

/**
 * Reads the prompt behind a skill-backed command out of its skill: the SKILL.md and the
 * `references/*.md` files beside it.
 *
 * A skill-backed command's YAML is a manifest with no prompt, so the tests that pin what a
 * command does read its skill instead. The prompt is the SKILL.md body followed by each
 * reference file in name order -- the order scripts/lib/skill-backed-command.js gives every
 * other consumer of a skill -- so an assertion about a phrase of the command runs against
 * the whole prompt, in whichever file the phrase lives. The SKILL.md holds the old command as
 * scripts/lib/command-transformer.js rendered it, minus its workflow: a `## Constraints`
 * list, `## Arguments`, a `## Workflow` index of the phases, `## Expected Output` and
 * `## Usage`. Each phase is a reference file: a `# Phase N: <name>` heading, then
 * `**N. <title>**` step headings with an indented description and `- <action>` bullets.
 * parseWorkflow reads those files back into the phases/steps/actions the YAML used to hold,
 * which keeps the behavioral assertions written against the YAML unchanged.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { listSkillReferences } = require('../../../../scripts/lib/skill-backed-command');

const PACKAGE_DIR = path.join(__dirname, '..', '..');
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;
const PHASE_HEADING = /^# Phase (\d+): (.+)$/;
const STEP_HEADING = /^\*\*(\d+)\. (.+)\*\*$/;

/**
 * A skill of a package: its SKILL.md path, parsed frontmatter and body text, its reference
 * files, and the whole prompt (the body, then each reference, a line break between files).
 * @param {string} skill - Skill directory name
 * @param {string} [packageDir] - Package holding the skill (default: packages/product)
 * @returns {{file: string, frontmatter: object, body: string,
 *   references: Array<{file: string, text: string}>, prompt: string}}
 */
function readSkill(skill, packageDir = PACKAGE_DIR) {
  const file = path.join(packageDir, 'skills', skill, 'SKILL.md');
  const text = fs.readFileSync(file, 'utf8');
  const match = FRONTMATTER.exec(text);
  if (!match) {
    throw new Error(`${file} has no frontmatter`);
  }
  const body = text.slice(match[0].length);
  const references = listSkillReferences(file).map((referenceFile) => ({
    file: referenceFile,
    text: fs.readFileSync(referenceFile, 'utf8')
  }));
  return {
    file,
    frontmatter: yaml.load(match[1]),
    body,
    references,
    prompt: [body, ...references.map((reference) => reference.text)].join('\n')
  };
}

/**
 * Text of the `## <heading>` section: everything after the heading line up to the next
 * `## ` heading.
 * @param {string} body - Skill body
 * @param {string} heading - Heading text, without the `## `
 * @returns {string}
 */
function section(body, heading) {
  const marker = `\n## ${heading}\n`;
  const start = body.indexOf(marker);
  if (start === -1) {
    throw new Error(`skill has no "## ${heading}" section`);
  }
  const from = start + marker.length;
  const next = body.indexOf('\n## ', from);
  return body.slice(from, next === -1 ? body.length : next);
}

/** The `- ` bullets of a section, each without its marker. */
function bullets(sectionText) {
  return sectionText
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2));
}

/**
 * The phases of one reference file's text as `[{order, name, steps: [{order, title,
 * description, actions}]}]`: the heading and step shapes the module doc describes. A file
 * with no phase heading holds none.
 * @param {string} text - Text of one reference file
 * @returns {Array<object>}
 */
function parsePhases(text) {
  const phases = [];
  let phase = null;
  let step = null;
  let descriptionLines = [];
  let inActions = false;

  const closeStep = () => {
    if (step) step.description = descriptionLines.join('\n').trim();
    descriptionLines = [];
  };

  for (const line of text.split('\n')) {
    let match = PHASE_HEADING.exec(line);
    if (match) {
      closeStep();
      phase = { order: Number(match[1]), name: match[2], steps: [] };
      phases.push(phase);
      step = null;
      continue;
    }
    if (!phase) continue;

    match = STEP_HEADING.exec(line);
    if (match) {
      closeStep();
      step = { order: Number(match[1]), title: match[2], description: '', actions: [] };
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
      descriptionLines.push(line);
    }
  }
  closeStep();
  return phases;
}

/**
 * The workflow of a skill as `[{order, name, steps: [{order, title, description,
 * actions}]}]` -- the shape of the YAML's `workflow.phases` -- read from its reference files
 * in name order.
 * @param {{references: Array<{text: string}>}} skill - A skill read by readSkill
 * @returns {Array<object>}
 */
function parseWorkflow(skill) {
  return skill.references.flatMap((reference) => parsePhases(reference.text));
}

module.exports = { readSkill, section, bullets, parseWorkflow };
