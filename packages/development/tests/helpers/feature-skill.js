'use strict';

/**
 * Reads the feature dispatcher -- a skill-backed command -- back into the document shape its
 * YAML had before the prompt moved into its skill, so the behavioral assertions written
 * against that shape stay unchanged.
 *
 * The YAML is now a manifest (`metadata` + `skill`). The prompt is the SKILL.md:
 *  - the text before the first `## ` heading is the mission summary;
 *  - `## Subcommands` holds one routing bullet per keyword:
 *    `- **`<keyword>`** - <description>. Invoke `/ensemble:<ref>` directly, or read and follow
 *    `../ensemble-<ref>/SKILL.md` (relative to this skill's directory), ...`;
 *  - `## Workflow` holds `### Phase N: <name>` / `#### Step N.M: <title>` headings, each step with
 *    a summary line and `- <action>` bullets, in order.
 *
 * `readFeature()` returns `{ manifest, skill, body, prompt, mission, subcommands: [{keyword, ref,
 * description, path}], workflow: { phases: [{ order, name, steps: [{ order, title, description,
 * actions }] }] } }`. The `workflow` shape is what foreman-invariants' `step()` and `actions()` read.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const PACKAGE_DIR = path.join(__dirname, '..', '..');
const MANIFEST_PATH = path.join(PACKAGE_DIR, 'commands', 'feature.yaml');
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;
const PHASE_HEADING = /^### Phase (\d+): (.+)$/;
const STEP_HEADING = /^#### Step (\d+)\.(\d+): (.+)$/;
const SUBCOMMAND =
  /^- \*\*`([^`]+)`\*\* - (.+?)\. Invoke `\/ensemble:([^`]+)` directly, or read and follow `([^`]+)` \(relative to this skill's directory\)/;

/** Text of the `## <heading>` section, up to the next `## ` heading. */
function section(body, heading) {
  const marker = `\n## ${heading}\n`;
  const start = body.indexOf(marker);
  if (start === -1) throw new Error(`skill has no "## ${heading}" section`);
  const from = start + marker.length;
  const next = body.indexOf('\n## ', from);
  return body.slice(from, next === -1 ? body.length : next);
}

function parseSubcommands(text) {
  return text
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => {
      const match = SUBCOMMAND.exec(line);
      if (!match) throw new Error(`unparseable subcommand line: ${line.slice(0, 80)}`);
      const [, keyword, description, ref, relativePath] = match;
      return { keyword, description, ref, path: relativePath };
    });
}

function parsePhases(text) {
  const phases = [];
  let phase = null;
  let step = null;
  for (const line of text.split('\n')) {
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
    if (!step || line.trim() === '') continue;
    if (line.startsWith('- ')) step.actions.push(line.slice(2));
    else step.description += (step.description ? '\n' : '') + line;
  }
  return phases;
}

function readFeature() {
  const manifest = yaml.load(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const file = path.join(PACKAGE_DIR, 'skills', manifest.skill, 'SKILL.md');
  const text = fs.readFileSync(file, 'utf8');
  const match = FRONTMATTER.exec(text);
  if (!match) throw new Error(`${file} has no frontmatter`);
  const body = text.slice(match[0].length);
  return {
    manifest,
    skill: { file, frontmatter: yaml.load(match[1]) },
    body,
    prompt: body,
    mission: body.slice(0, body.indexOf('\n## ')).trim(),
    subcommands: parseSubcommands(section(body, 'Subcommands')),
    workflow: { phases: parsePhases(section(body, 'Workflow')) }
  };
}

module.exports = { readFeature };
