'use strict';

/**
 * Reads new-feature -- a skill-backed command -- back into the document shape the YAML had
 * before the prompt moved into its skill, so the behavioral assertions written against that
 * shape stay unchanged.
 *
 * The YAML is now a manifest (`metadata` + `skill`). The prompt is the SKILL.md (`##
 * Constraints`, `## Arguments`, a `## Workflow` index) plus one file per phase under
 * `references/`: a `### Phase N: <name>` heading and a summary line, then `#### Step N.M:
 * <title>` headings, each with a summary line and `- <action>` bullets.
 *
 * `readNewFeature()` returns `{ manifest, skill, body, references, prompt, parameters,
 * constraints, workflow: { phases: [{ order, name, description, steps: [{ order, title,
 * description, actions }] }] } }`.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { listSkillReferences } = require('../../../../scripts/lib/skill-backed-command');

const PACKAGE_DIR = path.join(__dirname, '..', '..');
const MANIFEST_PATH = path.join(PACKAGE_DIR, 'commands', 'new-feature.yaml');
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;
const PHASE_HEADING = /^### Phase (\d+): (.+)$/;
const STEP_HEADING = /^#### Step (\d+)\.(\d+): (.+)$/;
const PARAMETER = /^- \*\*`([^`]+)`\*\* \(([^)]*)\): ([\s\S]*)$/;

/** Text of the `## <heading>` section, up to the next `## ` heading. */
function section(body, heading) {
  const marker = `\n## ${heading}\n`;
  const start = body.indexOf(marker);
  if (start === -1) throw new Error(`skill has no "## ${heading}" section`);
  const from = start + marker.length;
  const next = body.indexOf('\n## ', from);
  return body.slice(from, next === -1 ? body.length : next);
}

const bullets = (text) =>
  text
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2));

function parseParameters(text) {
  return bullets(text).map((bullet) => {
    const match = PARAMETER.exec(`- ${bullet}`);
    if (!match) throw new Error(`unparseable parameter line: ${bullet}`);
    const [, name, spec, description] = match;
    const parts = spec.split(',').map((part) => part.trim());
    const param = { name, type: parts[0], required: !parts.includes('optional'), description };
    const dflt = parts.find((part) => part.startsWith('default:'));
    if (dflt) param.default = yaml.load(dflt.slice('default:'.length).trim().replace(/^`|`$/g, ''));
    return param;
  });
}

function parsePhases(text) {
  const phases = [];
  let phase = null;
  let step = null;
  let target = null; // the phase or step collecting summary lines
  let summary = [];

  const flush = () => {
    if (target) target.description = summary.join('\n').trim();
    summary = [];
  };

  for (const line of text.split('\n')) {
    let match = PHASE_HEADING.exec(line);
    if (match) {
      flush();
      phase = { order: Number(match[1]), name: match[2], description: '', steps: [] };
      phases.push(phase);
      step = null;
      target = phase;
      continue;
    }
    match = STEP_HEADING.exec(line);
    if (match && phase) {
      flush();
      step = { order: Number(match[2]), title: match[3], description: '', actions: [] };
      phase.steps.push(step);
      target = step;
      continue;
    }
    if (!target || line.trim() === '') continue;
    if (step && line.startsWith('- ')) step.actions.push(line.slice(2));
    else summary.push(line);
  }
  flush();
  return phases;
}

function readNewFeature() {
  const manifest = yaml.load(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const file = path.join(PACKAGE_DIR, 'skills', manifest.skill, 'SKILL.md');
  const text = fs.readFileSync(file, 'utf8');
  const match = FRONTMATTER.exec(text);
  if (!match) throw new Error(`${file} has no frontmatter`);
  const body = text.slice(match[0].length);
  const references = listSkillReferences(file).map((referenceFile) => ({
    file: referenceFile,
    text: fs.readFileSync(referenceFile, 'utf8')
  }));
  return {
    manifest,
    skill: { file, frontmatter: yaml.load(match[1]) },
    body,
    references,
    prompt: [body, ...references.map((reference) => reference.text)].join('\n'),
    parameters: parseParameters(section(body, 'Arguments')),
    constraints: bullets(section(body, 'Constraints')),
    workflow: { phases: references.flatMap((reference) => parsePhases(reference.text)) }
  };
}

module.exports = { readNewFeature };
