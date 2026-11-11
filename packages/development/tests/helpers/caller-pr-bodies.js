'use strict';

/**
 * The PR bodies the guidance callers build, extracted from the command source.
 *
 * `fix-issue.yaml` and `implement-trd-beads.yaml` are the two callers TRD-006
 * wired to the `pr-review-cycle` skill. Neither renders its body with code: the
 * body is a template inside the command document that an executor writes out.
 * Both the TRD-006 integration test and the TRD-006-TEST PRD scenarios grade
 * those bodies with the REAL description checker, so the extraction lives here
 * once instead of drifting between the two files.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { readCommandProse } = require('../../../../scripts/lib/skill-backed-command');

const DEV_ROOT = path.join(__dirname, '..', '..');

/**
 * Where a caller's PR body templates live when the command defers them: the
 * thin `implement-trd-beads.yaml` orchestrator points at "reference section 3"
 * of the `implement-trd-beads-reference` skill (SKILL.md plus its
 * `reference/pr-bodies.md`), which owns the phase and completion body templates;
 * `fix-issue.yaml` points at the pr-review-cycle skill's
 * `reference/fix-issue-pr-body.md`.
 */
const BODY_COMPANIONS = Object.freeze({
  'implement-trd-beads.yaml': [
    path.join(DEV_ROOT, 'skills', 'implement-trd-beads-reference', 'SKILL.md'),
    path.join(DEV_ROOT, 'skills', 'implement-trd-beads-reference', 'reference', 'pr-bodies.md'),
  ],
  'fix-issue.yaml': [
    path.join(DEV_ROOT, 'skills', 'pr-review-cycle', 'reference', 'fix-issue-pr-body.md'),
  ],
});

/** The command documents that publish a PR body (TRD-006). */
const CALLER_PATHS = Object.freeze({
  'fix-issue.yaml': path.join(DEV_ROOT, 'commands', 'fix-issue.yaml'),
  'implement-trd-beads.yaml': path.join(DEV_ROOT, 'commands', 'implement-trd-beads.yaml'),
});

/**
 * How many bodies each caller can publish: fix-issue has one template,
 * implement-trd-beads builds a phase body and a completion body. An extraction
 * that found fewer would grade less than it claims, so callers assert this.
 */
const EXPECTED_BODY_COUNT = Object.freeze({
  'fix-issue.yaml': 1,
  'implement-trd-beads.yaml': 2,
});

/** A YAML block scalar indents its content; a body an executor writes out does not. */
const dedent = (block) => {
  const lines = block.split('\n');
  const indents = lines
    .filter((line) => line.trim() !== '')
    .map((line) => line.match(/^ */)[0].length);
  const common = indents.length === 0 ? 0 : Math.min(...indents);
  return lines.map((line) => line.slice(common)).join('\n');
};

/** Every string the command document carries, with YAML escapes already resolved. */
const prose = (raw) => {
  const texts = [];
  const walk = (node) => {
    if (typeof node === 'string') texts.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') Object.values(node).forEach(walk);
  };
  walk(yaml.load(raw));
  return texts.join('\n');
};

/**
 * The PR body a caller builds, as the command source carries it, normalised to real
 * markdown. A body ends at the `Directed by:` line it must carry: that is the last thing
 * in it, so anchoring there extracts the body and nothing of the prose around it.
 */
const bodiesIn = (raw) => bodiesInText(prose(raw));

const bodiesInText = (text) => {
  const bodies = [];
  // fix-issue: a fenced ```markdown template inside the instructions.
  for (const [, fenced] of text.matchAll(/```markdown\n([\s\S]*?)\n *```/g)) {
    if (/directed[\s-]*by/i.test(fenced)) bodies.push(dedent(fenced));
  }
  // implement-trd-beads: PR_BODY / COMPLETION_BODY = '...' with \n escapes.
  for (const [, assigned] of text.matchAll(
    /(?:PR_BODY|COMPLETION_BODY) = '([\s\S]*?Directed by: @<[^<>]*>)>?'/g
  )) {
    // The command wraps the whole body in <...>; the closing bracket is outside the capture.
    bodies.push(assigned.replace(/^</, '').replace(/\\n/g, '\n'));
  }
  return bodies;
};

/** Every string a caller's command document and its body-template companions carry. */
const callerText = (name) => {
  const file = CALLER_PATHS[name];
  if (file === undefined) throw new Error(`unknown caller: ${name}`);
  const companions = (BODY_COMPANIONS[name] || []).map((f) => fs.readFileSync(f, 'utf8'));
  // fix-issue and implement-trd-beads are skill-backed: the manifest holds no prose, so the command's
  // text is its manifest plus its skill (SKILL.md + references/*.md), then the body companions.
  const manifest = fs.readFileSync(file, 'utf8');
  const commandProse = readCommandProse(file, yaml.load(manifest), manifest);
  return [prose(manifest), commandProse, ...companions].join('\n');
};

/**
 * Placeholders (`{thing}` / `<thing>`) stand in for runtime values; a real body has text
 * there. Nested ones (`<... <merge-commit-sha> ...>`) resolve inside-out, so a few passes
 * are made until none is left.
 */
const filled = (body, value = 'ldangelo') => {
  let text = body.trim().replace(/\{[^{}]*\}/g, value);
  for (let pass = 0; pass < 5 && /<[^<>]*>/.test(text); pass += 1) {
    text = text.replace(/<[^<>]*>/g, value);
  }
  return text;
};

/** Every PR body one caller publishes, with its placeholders filled in. */
const callerBodies = (name, value) => {
  const file = CALLER_PATHS[name];
  if (file === undefined) throw new Error(`unknown caller: ${name}`);
  return bodiesInText(callerText(name)).map((body) => filled(body, value));
};

module.exports = {
  CALLER_PATHS,
  EXPECTED_BODY_COUNT,
  bodiesIn,
  bodiesInText,
  callerBodies,
  callerText,
  filled,
};
