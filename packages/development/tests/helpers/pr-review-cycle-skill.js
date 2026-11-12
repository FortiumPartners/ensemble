'use strict';

const fs = require('fs');
const path = require('path');

const SKILL_DIR = path.join(__dirname, '..', '..', 'skills', 'pr-review-cycle');

/**
 * The pr-review-cycle skill is SKILL.md plus companion files under reference/.
 * Only a companion that SKILL.md names by relative path counts as part of the
 * skill (the Pi copier ships exactly those), so a rule that lives in a file the
 * SKILL.md never points at is not seen here and its tests still fail.
 */
function referencedFiles(skillText, skillDir = SKILL_DIR) {
  const refDir = path.join(skillDir, 'reference');
  if (!fs.existsSync(refDir)) return [];
  return fs
    .readdirSync(refDir)
    .filter((f) => f.endsWith('.md') && skillText.includes(`reference/${f}`))
    .sort()
    .map((f) => path.join(refDir, f));
}

/**
 * The agent briefs live in templates/<role>-brief.md, not in the reference prose; a reference
 * names each one in the paragraph that used to carry the prose. The shipped skill still SAYS
 * what the brief says (the Pi copier ships a template because a shipped file names it), so
 * the skill's text is the reference with each named template laid in, as a blockquote,
 * right after the paragraph that names it -- the shape the prose had before it moved.
 * A name that resolves to no file is left alone, so a dangling pointer supplies no text.
 */
function withTemplates(text, skillDir = SKILL_DIR) {
  const out = [];
  for (const paragraph of text.split(/\n{2,}/)) {
    out.push(paragraph);
    const seen = new Set();
    for (const match of paragraph.matchAll(/templates\/([a-z-]+-brief\.md)/g)) {
      const file = path.join(skillDir, 'templates', match[1]);
      if (seen.has(match[1]) || !fs.existsSync(file)) continue;
      seen.add(match[1]);
      out.push(
        fs
          .readFileSync(file, 'utf8')
          .trimEnd()
          .split('\n')
          .map((line) => (line === '' ? '>' : `> ${line}`))
          .join('\n')
      );
    }
  }
  return out.join('\n\n');
}

/** SKILL.md alone. */
function readSkillMain(skillDir = SKILL_DIR) {
  return fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
}

const ORDER = [
  'scope-guidance-depth.md',
  'ledger-and-verification.md',
  'triage-fix-reverify.md',
  'remote-phase.md',
  'status-and-state.md',
  'merge-gate.md',
];

const body = (text) => text.replace(/^# [^\n]*\n\nCompanion to `SKILL.md`[^\n]*\n\n/, '');

/**
 * The whole skill as one document in its original reading order: SKILL.md's
 * header, stopping rule, the full inputs table, CLI resolution, every step's full
 * text from the companions SKILL.md names, then the Safety rules. A companion
 * SKILL.md does not name is left out, so its rules count for nothing.
 */
function readSkillBundle(skillDir = SKILL_DIR) {
  const main = readSkillMain(skillDir);
  const named = new Set(referencedFiles(main, skillDir).map((f) => path.basename(f)));
  const refText = (name) => withTemplates(body(fs.readFileSync(path.join(skillDir, 'reference', name), 'utf8')), skillDir);
  const at = (label) => {
    const i = main.indexOf(label);
    if (i < 0) throw new Error(`SKILL.md lacks ${label}`);
    return i;
  };
  const parts = [main.slice(0, at('## Inputs'))];
  parts.push('## Inputs\n\n' + (named.has('inputs.md') ? refText('inputs.md').slice(refText('inputs.md').indexOf('| Variable')) : ''));
  parts.push(main.slice(at('## Resolve the CLI'), at('### Step 1 --')));
  for (const name of ORDER) if (named.has(name)) parts.push(refText(name));
  parts.push(main.slice(at('## Safety rules')));
  return parts.join('\n\n');
}

/** One named companion (must also be named by SKILL.md). */
function readSkillReference(name, skillDir = SKILL_DIR) {
  const main = readSkillMain(skillDir);
  if (!main.includes(`reference/${name}`)) throw new Error(`SKILL.md does not name reference/${name}`);
  return withTemplates(fs.readFileSync(path.join(skillDir, 'reference', name), 'utf8'), skillDir);
}

module.exports = { SKILL_DIR, readSkillMain, readSkillBundle, readSkillReference };
