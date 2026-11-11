'use strict';

/**
 * Reads a skill-backed dispatcher's routing table and dispatch step back out of its SKILL.md.
 *
 * A dispatcher's SKILL.md is the single source of truth for what the command routes. Its
 * `## Subcommands` section holds one bullet per keyword:
 *
 *   - **`<keyword>`** - <description>. Invoke `/ensemble:<ref>` directly, or read and follow
 *     `../ensemble-<ref>/SKILL.md` (relative to this skill's directory), passing the remaining
 *     arguments through as its $ARGUMENTS.
 *
 * and its `## Workflow` holds `### Phase 1: Dispatch` / `#### Step 1.1: ...` whose `- ` bullets
 * are the routing actions, in order.
 */

const { section, bullets } = require('./skill-prompt');

const SUBCOMMAND = /^\*\*`([^`]+)`\*\* - (.*)\. Invoke `\/ensemble:([^`]+)` directly, or read and follow `([^`]+)` \(relative to this skill's directory\), passing the remaining arguments through as its \$ARGUMENTS\.$/;

/**
 * The `## Subcommands` bullets as `[{keyword, description, ref, skillPath}]`, in document order.
 * A bullet that does not have the shape above throws, so a malformed row cannot be skipped.
 * @param {{body: string}} skill - A skill read by `readSkill`.
 */
function parseSubcommands(skill) {
  return bullets(section(skill.body, 'Subcommands')).map((line) => {
    const match = SUBCOMMAND.exec(line);
    if (!match) throw new Error(`unparsable Subcommands bullet: ${line.slice(0, 100)}`);
    const [, keyword, description, ref, skillPath] = match;
    return { keyword, description, ref, skillPath };
  });
}

/**
 * The bullets of the dispatcher's `#### Step 1.1` under `### Phase 1: Dispatch`, in order.
 * @param {{body: string}} skill - A skill read by `readSkill`.
 */
function dispatchActions(skill) {
  const workflow = section(skill.body, 'Workflow');
  const phaseHeading = '\n### Phase 1: Dispatch\n';
  const phaseStart = workflow.indexOf(phaseHeading);
  if (phaseStart === -1) throw new Error('skill has no "### Phase 1: Dispatch" heading');
  const stepHeading = /\n#### Step 1\.1: .*\n/.exec(workflow.slice(phaseStart));
  if (!stepHeading) throw new Error('Dispatch phase has no "#### Step 1.1" heading');
  const from = phaseStart + stepHeading.index + stepHeading[0].length;
  const next = workflow.indexOf('\n#', from);
  return bullets(workflow.slice(from, next === -1 ? workflow.length : next));
}

module.exports = { parseSubcommands, dispatchActions };
