/**
 * TRD-021-TEST (REQ-009, AC-009-3, AC-009-4): the TRD dispatcher routes the
 * `implement` keyword to the backend-neutral `implement-trd-tasks`, and the
 * retired name `implement-trd-beads` is rejected with a message naming the
 * replacement -- never an alias, never a fallthrough to another command.
 *
 * The dispatcher is a prompt (SKILL.md), so these are structural assertions on
 * its routing text. TRD_DISPATCHER_SKILL overrides the file under test so a
 * mutated copy can prove the assertions fail (RED).
 */

const fs = require('fs');
const path = require('path');

const SKILL = process.env.TRD_DISPATCHER_SKILL
  || path.join(__dirname, '..', 'skills', 'ensemble-trd', 'SKILL.md');
const text = fs.readFileSync(SKILL, 'utf8');
const RETIRED = 'implement-trd-beads';
const REPLACEMENT = 'implement-trd-tasks';

function subcommandLine(keyword) {
  return text.split('\n').find((l) => l.startsWith(`- **\`${keyword}\`**`));
}

function routingStepText() {
  const start = text.indexOf('#### Step 1.1');
  expect(start).toBeGreaterThan(-1);
  return text.slice(start);
}

describe('Happy: the implement keyword reaches implement-trd-tasks (AC-009-4)', () => {
  test('the implement entry routes to /ensemble:implement-trd-tasks and its sibling skill', () => {
    const line = subcommandLine('implement');
    expect(line).toBeDefined();
    expect(line).toContain(`/ensemble:${REPLACEMENT}`);
    expect(line).toContain(`../ensemble-${REPLACEMENT}/SKILL.md`);
  });

  test('the implement entry no longer routes to the retired name or states beads project management', () => {
    const line = subcommandLine('implement');
    expect(line).not.toContain(RETIRED);
    expect(line).not.toMatch(/beads/i);
    expect(text).not.toMatch(/beads project management/i);
  });

  test('exactly one keyword routes to the replacement', () => {
    const routed = text.split('\n').filter(
      (l) => l.startsWith('- **`') && l.includes(`/ensemble:${REPLACEMENT}`),
    );
    expect(routed).toHaveLength(1);
  });
});

describe('Edge: the retired name is rejected, naming the replacement (AC-009-3)', () => {
  test('no subcommand entry or route resolves the retired name', () => {
    const entries = text.split('\n').filter((l) => l.startsWith('- **`'));
    for (const l of entries) {
      expect(l).not.toContain(`/ensemble:${RETIRED}`);
      expect(l).not.toContain(`ensemble-${RETIRED}`);
    }
    expect(text).not.toMatch(new RegExp(`\\*\\*\`${RETIRED}\``));
  });

  test('the unmatched-token branch prints the retired notice naming the replacement and its keyword', () => {
    const step = routingStepText();
    expect(step).toMatch(new RegExp(`retired name \`${RETIRED}\``));
    expect(step).toContain(`replaced by \`/ensemble:${REPLACEMENT}\``);
    expect(step).toContain('keyword `implement`');
  });

  test('the notice halts without side effects and states it is not an alias', () => {
    const step = routingStepText();
    expect(step).toMatch(/HALT without side effects/);
    expect(step).toMatch(/not an alias/);
    expect(step).toMatch(/never resolves to a command and executes nothing/);
  });

  test('notice, replacement and halt live in the single unmatched-token bullet, not the matched-keyword bullet', () => {
    const bullets = routingStepText().split('\n').filter((l) => l.startsWith('- '));
    const unmatched = bullets.filter((l) => l.includes(RETIRED));
    expect(unmatched).toHaveLength(1);
    const b = unmatched[0];
    expect(b).toMatch(/matches no keyword/);
    expect(b).toMatch(/HALT without side effects/);
    expect(b).toContain(`/ensemble:${REPLACEMENT}`);
    const matched = bullets.find((l) => /^- If the first token matches a keyword/.test(l));
    expect(matched).toBeDefined();
    expect(matched).not.toContain(RETIRED);
  });

  test('the retired name is not a keyword in the table and no sibling skill path ends in it', () => {
    expect(text).not.toContain(`ensemble-${RETIRED}/`);
    expect(subcommandLine(RETIRED)).toBeUndefined();
  });

  test('the retired name appears only in the rejection notice', () => {
    const mentions = text.split('\n').filter((l) => l.includes(RETIRED));
    expect(mentions.length).toBeGreaterThan(0);
    for (const l of mentions) {
      expect(l).toMatch(/retired/);
    }
  });
});
