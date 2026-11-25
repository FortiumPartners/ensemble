'use strict';

/**
 * The documented five-step flow (create-prd -> refine-prd -> create-trd -> refine-trd ->
 * implement-trd-tasks), plus `fix-issue` and `implement-bead`, is driven BY A SESSION. A session
 * runs each step by invoking the command as a skill; the user's part is answering the
 * AskUserQuestion gates, not typing the next command.
 *
 * Claude Code's Skill tool refuses a skill that sets `disable-model-invocation: true` ("cannot be
 * used with Skill tool ... reserved for explicit user invocation"). That flag is stamped on every
 * skill `scripts/migrate-command-to-skill.js` generates from a command (see its `buildSkillMd`),
 * and it was coherent while a bundle shipped `commands/ensemble/*.md` stubs for the model to READ
 * instead (the rationale is written out in `scripts/lib/command-transformer.js`). The
 * `ensemble-full` bundle has shipped no command stubs since v9.0.0, so there is nothing left to
 * read and the flag just makes the step unreachable.
 *
 * `beads-build-wave` hit this first and was fixed one instance at a time
 * (`beads-build-wave-skill-invocable.test.js`). This pins the CLASS: every skill the documented
 * flow has a session invoke must be model-invocable, so an eighth one added with the flag fails
 * here rather than in a blocked run.
 *
 * These stay user-invocable too -- the user types them as often as a session invokes them -- so
 * the fix is removing the flag, NOT `user-invocable: false` (which is right only for a skill like
 * the wave runner, an internal subroutine no user calls).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

/** Skill directory per package, as the documented flow invokes them. */
const SESSION_DRIVEN_SKILLS = [
  ['product', 'ensemble-create-prd'],
  ['product', 'ensemble-refine-prd'],
  ['development', 'ensemble-create-trd'],
  ['development', 'ensemble-refine-trd'],
  ['development', 'ensemble-implement-trd-tasks'],
  ['development', 'ensemble-fix-issue'],
  ['development', 'ensemble-implement-bead'],
];

function skillPath(pkg, name) {
  return path.join(ROOT, 'packages', pkg, 'skills', name, 'SKILL.md');
}

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

describe('skills the documented flow has a session invoke are model-invocable', () => {
  test('the skill list is not empty, so a passing run measured something', () => {
    expect(SESSION_DRIVEN_SKILLS.length).toBeGreaterThan(0);
  });

  test.each(SESSION_DRIVEN_SKILLS)('%s/%s is model-invocable', (pkg, name) => {
    const file = skillPath(pkg, name);
    // A renamed or moved skill must fail loudly here rather than silently pass on a missing file.
    expect(fs.existsSync(file)).toBe(true);

    const skill = fs.readFileSync(file, 'utf8');
    expect(frontmatter(skill)).toMatch(new RegExp(`^name: ${name}$`, 'm'));
    expect(modelBlockers(skill)).toEqual([]);
  });

  test.each(SESSION_DRIVEN_SKILLS)('%s/%s stays user-invocable', (pkg, name) => {
    const skill = fs.readFileSync(skillPath(pkg, name), 'utf8');
    // These are typed by the user as well as invoked by a session, so the wave runner's
    // `user-invocable: false` remedy would be wrong here.
    expect(frontmatter(skill)).not.toMatch(/^user-invocable:\s*false\s*$/m);
  });

  test('mutation proof: the blocker check catches a flagged skill', () => {
    const file = skillPath(...SESSION_DRIVEN_SKILLS[0]);
    const skill = fs.readFileSync(file, 'utf8');
    const flagged = skill.replace(/^(name: .*)$/m, '$1\ndisable-model-invocation: true');

    expect(flagged).not.toBe(skill);
    expect(modelBlockers(flagged)).toEqual(['disable-model-invocation: true']);
    expect(modelBlockers(skill)).toEqual([]);
  });
});
