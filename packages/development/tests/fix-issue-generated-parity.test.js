/**
 * fix-issue generated parity.
 *
 * fix-issue is a skill-backed command: the prompt is skills/ensemble-fix-issue/ (SKILL.md plus
 * references/phase-N-*.md, a `### Phase N: <name>` heading then `#### Step N.M: <title>` headings
 * each followed by that step's description). The Pi and Codex generators ship a copy of that skill
 * directory verbatim (no per-runtime tool renaming), and every runtime's command entry point is a stub pointing at the skill. So the
 * parity this test pins is: every shipped copy of the skill must carry each source step's whole
 * description, under the right phase and in source order, and every stub must point at the skill.
 * Regenerate (npm run generate) after editing the skill; this test fails on stale output.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const yaml = require('js-yaml');

const { readSkillProse } = require('../../../scripts/lib/skill-backed-command');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SOURCE_PATH = path.join(__dirname, '../commands/fix-issue.yaml');
const SKILL_NAME = 'ensemble-fix-issue';
const SOURCE_SKILL = path.join(__dirname, '../skills', SKILL_NAME, 'SKILL.md');
const GENERATED_SKILLS = {
  'Pi skill': path.join(__dirname, '../../pi/skills', SKILL_NAME, 'SKILL.md'),
  'Codex skill': path.join(__dirname, '../../codex/.codex/skills/commands', SKILL_NAME, 'SKILL.md'),
};
const GENERATED_STUBS = {
  'Claude/OMP markdown': path.join(__dirname, '../commands/ensemble/fix-issue.md'),
  'Pi prompt': path.join(__dirname, '../../pi/prompts', `${SKILL_NAME}.md`),
};

const flat = (text) => text.replace(/\s+/g, ' ').trim();
const PHASE_HEADING = /^### Phase \d+: (.+)$/;
const STEP_HEADING = /^#### Step [\d.]+: (.+)$/;

/** Rendered steps of a skill's whole prose, in order: [{phase, title, text}]. */
function skillSteps(skillFile) {
  const steps = [];
  let phase = null;
  let current = null;
  for (const line of readSkillProse(skillFile).split('\n')) {
    const phaseHeading = line.match(PHASE_HEADING);
    const stepHeading = line.match(STEP_HEADING);
    if (phaseHeading) {
      phase = phaseHeading[1];
      current = null;
    } else if (stepHeading) {
      current = { phase, title: stepHeading[1], lines: [] };
      steps.push(current);
    } else if (/^#{1,3} /.test(line)) {
      current = null;
    } else if (current) {
      current.lines.push(line);
    }
  }
  return steps.map((s) => ({ phase: s.phase, title: s.title, text: flat(s.lines.join('\n')) }));
}

describe('fix-issue generated parity', () => {
  let sourceSteps;

  beforeAll(() => {
    const manifest = yaml.load(fs.readFileSync(SOURCE_PATH, 'utf-8'));
    expect(manifest.skill).toBe(SKILL_NAME);
    sourceSteps = skillSteps(SOURCE_SKILL);
  });

  test('the source skill has the four phases and 16 steps this parity is measured against', () => {
    expect(new Set(sourceSteps.map((s) => s.phase)).size).toBe(4);
    expect(sourceSteps).toHaveLength(16);
  });

  test.each(Object.entries(GENERATED_SKILLS))('%s: carries every source step, in order, with its whole description', (_label, file) => {
    const rendered = skillSteps(file);
    expect(rendered.map(({ phase, title }) => ({ phase, title }))).toEqual(
      sourceSteps.map(({ phase, title }) => ({ phase, title }))
    );
    // The Pi generator deliberately maps the Claude tool name AskUserQuestion to Pi's `ask`, in a
    // command's skill as in its prompt (packages/pi/src/transformers/skill-copier.ts).
    const forTarget = (text) => (_label.startsWith('Pi') ? text.replaceAll('AskUserQuestion', 'ask') : text);
    sourceSteps.forEach((step, i) => {
      expect({ title: step.title, complete: rendered[i].text.includes(forTarget(step.text)) }).toEqual({
        title: step.title,
        complete: true,
      });
    });
    if (_label.startsWith('Pi')) {
      expect(fs.readFileSync(file, 'utf-8')).not.toContain('AskUserQuestion');
    }
  });

  test.each(Object.entries(GENERATED_STUBS))('%s: is a stub that points at the skill and copies no step', (_label, file) => {
    const text = fs.readFileSync(file, 'utf-8');
    expect(text).toContain(SKILL_NAME);
    sourceSteps.forEach((step) => expect(text).not.toContain(step.title));
  });

  test(
    'generated artifacts validate (read-only; regeneration idempotency is enforced by the CI generate check, never by rewriting tracked output from a unit test)',
    () => {
      execSync('npm run generate:validate && npm run validate', { cwd: REPO_ROOT, stdio: 'pipe' });
    },
    120000
  );
});
