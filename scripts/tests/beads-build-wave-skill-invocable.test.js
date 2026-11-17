'use strict';

/**
 * The `beads-build-wave` agent runs a wave by invoking the `ensemble-beads-build-wave` command
 * AS A SKILL (its "Loading the procedure" step 1). Claude Code's Skill tool refuses a skill that
 * sets `disable-model-invocation: true` ("cannot be used with Skill tool ... reserved for
 * explicit user invocation"), and the `ensemble-full` bundle ships no `commands/ensemble/`
 * stubs for the agent's file-read fallback, so a hidden wave skill makes every wave end
 * `terminal_state: "blocked"`.
 *
 * The skill is hidden from the user's menu with `user-invocable: false` instead, which leaves the
 * model free to invoke it. This pins both halves: the agent still dispatches through the Skill
 * tool, and the skill it dispatches to is model-invocable.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const AGENT = path.join(ROOT, 'packages', 'development', 'agents', 'beads-build-wave.yaml');
const SKILL = path.join(ROOT, 'packages', 'development', 'skills', 'ensemble-beads-build-wave', 'SKILL.md');

function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  return m ? m[1] : '';
}

/** Names the frontmatter keys that stop the model invoking the skill through the Skill tool. */
function modelBlockers(text) {
  return frontmatter(text)
    .split('\n')
    .filter((line) => /^disable-model-invocation:\s*true\s*$/.test(line));
}

describe('beads-build-wave agent dispatches to a model-invocable skill', () => {
  const agent = fs.readFileSync(AGENT, 'utf8');
  const skill = fs.readFileSync(SKILL, 'utf8');

  test('the agent still loads the wave procedure through the Skill tool', () => {
    expect(agent).toMatch(/^\s+- Skill$/m);
    expect(agent).toMatch(/Invoke the wave-runner command as a skill/);
    expect(agent).toMatch(/ensemble:beads-build-wave/);
  });

  test('the wave skill does not set disable-model-invocation, which the Skill tool refuses', () => {
    expect(frontmatter(skill)).toMatch(/^name: ensemble-beads-build-wave$/m);
    expect(modelBlockers(skill)).toEqual([]);
  });

  test('the wave skill stays out of the user menu with user-invocable: false', () => {
    expect(frontmatter(skill)).toMatch(/^user-invocable:\s*false\s*$/m);
  });

  test('mutation proof: the blocker check does catch a hidden wave skill', () => {
    const hidden = skill.replace(/^user-invocable: false$/m, 'disable-model-invocation: true');
    expect(hidden).not.toBe(skill);
    expect(modelBlockers(hidden)).toEqual(['disable-model-invocation: true']);
  });
});
