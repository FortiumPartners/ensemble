'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { transformCommandToMarkdown } = require('../../../scripts/lib/command-transformer');
const { extractFrontmatter } = require('../../../scripts/lib/frontmatter-check');
const { readCommandProse } = require('../../../scripts/lib/skill-backed-command');
const { readSkill, section, bullets } = require('./helpers/skill-prompt');

const PRODUCT_DIR = path.join(__dirname, '..');
const FULL_DIR = path.join(PRODUCT_DIR, '..', 'full');
const manifestPath = path.join(PRODUCT_DIR, 'commands', 'create-prd.yaml');
const manifest = yaml.load(fs.readFileSync(manifestPath, 'utf8'));

// create-prd is a skill-backed command: its YAML is a manifest (metadata + skill) and the
// prompt is its skill -- the SKILL.md and the phase files under references/ -- the single
// source of truth. The contract below is pinned against the whole prompt (skill.prompt: the
// SKILL.md body, then every reference); the Claude Code command is only a stub that points
// at it.
const skill = readSkill(manifest.skill);
const skillText = skill.prompt;

// The Constitution Gate Contract is Phase 6, up to the Output Management hand-off it ends
// with. The SKILL.md's phase index names both as well, so the search starts at the heading
// of the Phase 6 file.
function contractSection(text) {
  const phase = text.indexOf('# Phase 6: Constitution Gate');
  expect(phase).toBeGreaterThan(-1);
  const outputStart = text.indexOf('Output Management', phase);
  expect(outputStart).toBeGreaterThan(-1);
  const start = text.lastIndexOf('Constitution Gate Contract', outputStart);
  expect(start).toBeGreaterThan(phase);
  return text.slice(start, outputStart);
}

function unguardedConstitutionBypassLines(contract) {
  const bypassWords = /(proceed anyway|override|skip|auto-proceed|default-proceed)/i;
  const constitutionScope = /(constitution|article)/i;
  const explicitDeny = /(Do not offer|excluded|cannot bypass|non-bypassable|only for non-constitution|preserved only)/i;
  return contract
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => constitutionScope.test(line) && bypassWords.test(line) && !explicitDeny.test(line));
}

describe('create-prd is a skill-backed command', () => {
  test('its YAML is a manifest -- metadata and a skill, no prompt of its own', () => {
    expect(Object.keys(manifest).sort()).toEqual(['metadata', 'skill']);
    expect(manifest.skill).toBe('ensemble-create-prd');
  });

  test('the skill is in this package and named for its directory', () => {
    expect(path.basename(path.dirname(skill.file))).toBe(manifest.skill);
    expect(skill.frontmatter.name).toBe(manifest.skill);
  });
});

describe('create-prd skill: the phases live in references/', () => {
  const referenceNamed = (name) => skill.references.find((reference) => path.basename(reference.file) === name);

  test('SKILL.md indexes every phase file by its relative path, and every indexed file exists', () => {
    const indexed = [...skill.body.matchAll(/`(references\/[^`]+\.md)`/g)].map((match) => match[1]).sort();
    const present = skill.references.map((reference) => `references/${path.basename(reference.file)}`);
    expect(present).toHaveLength(7);
    expect(indexed).toEqual(present);
  });

  // One phrase per phase that is in that phase's file and nowhere else, so a phase body
  // deleted from references/ -- or pasted back into SKILL.md -- fails here.
  test.each([
    ['phase-1-structured-elicitation.md', 'HALT CHECK (run first, before anything else in this command)'],
    ['phase-2-meeting-summary-intake.md', 'Expect a normalized shape with some subset of: meeting title/date/attendees'],
    ['phase-3-research-and-context.md', 'record it as research *context* only; the stack is never a requirement'],
    ['phase-4-requirements-definition.md', 'Ambiguity scan complete: N items marked for clarification'],
    ['phase-5-adversarial-review-and-readiness-gate.md', 'FAIL (<3.0): do not save'],
    ['phase-6-constitution-gate.md', 'Constitution Gate: running'],
    ['phase-7-output-management.md', 'The next step is ALWAYS refine-prd, never create-trd'],
  ])('%s holds its phase, which SKILL.md does not repeat: %s', (name, phrase) => {
    const reference = referenceNamed(name);
    expect(reference).toBeDefined();
    expect(reference.text).toContain(phrase);
    expect(skill.body).not.toContain(phrase);
    expect(skillText).toContain(phrase);
  });

  // The capability-drift gate and the preflight lint scan this command through the same
  // reader; it must hand them the phase files too, or they stop checking most of the command.
  test('the prose the gates scan for this command is its SKILL.md and every phase file', () => {
    const prose = readCommandProse(manifestPath, manifest, fs.readFileSync(manifestPath, 'utf8'));
    expect(prose).toContain(skill.body);
    for (const reference of skill.references) {
      expect(prose).toContain(reference.text);
    }
  });
});

describe('create-prd Claude Code stub', () => {
  const rendered = transformCommandToMarkdown(manifest, manifestPath);
  const frontmatter = yaml.load(extractFrontmatter(rendered));
  const stubBody = rendered.replace(/^---\n[\s\S]*?\n---\n/, '');

  test('keeps the slash name, description, argument hint and model alias of the command', () => {
    expect(frontmatter.name).toBe('ensemble:create-prd');
    expect(frontmatter.description).toBe(manifest.metadata.description);
    expect(frontmatter['argument-hint']).toBe(manifest.metadata.argument_hint);
    expect(frontmatter.version).toBe(manifest.metadata.version);
    expect(manifest.metadata.model).toBe('high');
    expect(frontmatter.model).toBe('opus');
  });

  test('grants Read, the one tool it needs to open the skill', () => {
    expect(frontmatter['allowed-tools']).toBe('Read');
  });

  test('tells Claude to read the skill, resolve its relative paths and passes $ARGUMENTS through; it carries no prompt text', () => {
    expect(stubBody).toBe(
      '<!-- DO NOT EDIT - Generated from create-prd.yaml -->\n' +
      '<!-- To modify this file, edit the YAML source and run: npm run generate -->\n' +
      '\n' +
      'Read the file ${CLAUDE_PLUGIN_ROOT}/skills/ensemble-create-prd/SKILL.md and follow its instructions exactly; ' +
      'resolve any relative paths in it against ${CLAUDE_PLUGIN_ROOT}/skills/ensemble-create-prd/. ' +
      'Wherever that file refers to its ARGUMENTS, use this value: $ARGUMENTS\n'
    );
  });

  test.each([
    ['the product plugin', PRODUCT_DIR],
    ['the full bundle', FULL_DIR],
  ])('what it names exists under the plugin root of %s: the skill file, its directory and every reference', (_label, pluginRoot) => {
    const named = [...stubBody.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/(\S+)/g)].map((match) => match[1]);
    expect(named.length).toBeGreaterThan(0);
    for (const relative of named) {
      expect(fs.existsSync(path.join(pluginRoot, relative))).toBe(true);
    }
    for (const reference of skill.references) {
      expect(fs.existsSync(path.join(pluginRoot, 'skills', manifest.skill, 'references', path.basename(reference.file)))).toBe(true);
    }
  });
});

describe('create-prd command document ids', () => {
  test('uses micro UUID artifact IDs instead of sequence numbers', () => {
    expect(skillText).toContain('PRD-{current_year}-{micro_uuid}');
    expect(skillText).toContain('8 lowercase hex');
    expect(skillText).toContain('Do NOT scan for highest sequence numbers');
    expect(skillText).toContain('docs/PRD/PRD-YYYY-<micro_uuid>-<slug>.md');
    expect(skillText).not.toContain('find highest PRD-YYYY-NNN and increment');
  });
});

describe('create-prd constraints', () => {
  // Constraints are part of the prompt: the Claude renderer used to drop them, Pi and
  // OpenCode rendered them, and the skill carries them for every runtime.
  const constraints = bullets(section(skillText, 'Constraints'));

  test.each([
    // PRD only, never the work the PRD describes
    'DO NOT implement, build, or execute any work described in the product description',
    'This command creates ONLY a PRD document',
    'The arguments describe what should be documented, not what should be built',
    'After creating the PRD, stop and wait for user approval before any implementation',
    // the gates the save waits on
    'DO NOT save the PRD until it passes the Implementation Readiness Gate',
    'DO NOT save the PRD until the Constitution Gate Contract passes',
    // --foreman and --from-meeting
    'constitution violations are excluded from CONCERNS auto-proceed and always HALT',
    '--from-meeting: DO NOT invent requirements, decisions, or constraints that are not actually present in the provided meeting summary',
    '--from-meeting cannot be combined with --foreman (the subject comes from the meeting summary, not from FOREMAN_TASK_TITLE) -- HALT if both are passed',
  ])('keeps the constraint: %s', (phrase) => {
    expect(constraints.some((constraint) => constraint.includes(phrase))).toBe(true);
  });
});

describe('create-prd constitution gate contract', () => {
  test('pins source precedence, config errors, and non-bypassable semantics', () => {
    const contract = contractSection(skillText);

    expect(contract).toContain('docs/standards/constitution.md');
    expect(contract).toContain('.specify/memory/constitution.md');
    expect(contract).toContain('strict precedence');
    expect(contract).toContain('normalized contents differ');
    expect(contract).toContain('CONSTITUTION_CONFIG_ERROR');
    expect(contract).toContain('Every enforceable constitution check MUST map to at least one source article id');
    expect(contract).toContain('unmapped article check is a gate configuration failure');
    expect(contract).toContain('Constitution violations are non-bypassable in every mode, including --foreman');
    expect(contract).toContain('Do not offer any proceed anyway, override, skip, soft-confirmation, default-proceed, or Foreman auto-proceed path');
    expect(unguardedConstitutionBypassLines(contract)).toEqual([]);
  });

  test('requires article-specific violation formatting', () => {
    const contract = contractSection(skillText);

    expect(contract).toContain('article id');
    expect(contract).toContain('article title when available');
    expect(contract).toContain('failing draft section');
    expect(contract).toContain('specific finding');
    expect(contract).toContain('remediation hint');
    expect(contract).toContain('list every failing article id');
    expect(contract).toContain('never collapse them to a generic constitution failure');
  });

  // The gate blocks whatever next step this command prints. That step used to be
  // create-trd and is now refine-prd -- a created PRD has not been reviewed, and
  // refine-prd is the review. The contract is unchanged: on a violation, nothing
  // downstream gets printed. Only the command named in it moved.
  test('hard-blocks PRD save and the next step on violation', () => {
    const contract = contractSection(skillText);

    expect(contract).toContain('before creating docs/PRD/');
    expect(contract).toContain('writing any repo-local PRD artifact');
    expect(contract).toContain('printing the /ensemble:refine-prd next step');
    expect(contract).toContain('do not write docs/PRD/PRD-YYYY-<micro_uuid>-<slug>.md');
    expect(contract).toContain('do not print /ensemble:refine-prd next-step output');
  });

  test('records Foreman failure reports separately from successful artifacts', () => {
    const contract = contractSection(skillText);

    expect(contract).toContain('FOREMAN_ARTIFACT_PATH');
    expect(contract).toContain('write a failure phase report to that exact path');
    expect(contract).toContain('creating parent directories as needed');
    expect(contract).toContain('must not claim a saved repo-local PRD artifact');
  });

  test('preserves non-constitution CONCERNS auto-proceed only after constitution pass', () => {
    const contract = contractSection(skillText);

    expect(skillText).toContain('CONCERNS');
    expect(skillText).toContain('Implementation Readiness Gate');
    expect(contract).toContain('preserved only');
    expect(contract).toContain('non-constitution concerns');
    expect(contract).toContain('constitution violations');
    expect(contract).toContain('CONCERNS auto-proceed');
  });

  test('adds the saved-document success audit status', () => {
    expect(skillText).toContain('Constitution compliance: passed');
    expect(skillText).toContain('only after constitution compliance passes');
  });

  test('makes the gate observable on every invocation, independent of pass/fail (br-0eg)', () => {
    const contract = contractSection(skillText);

    // Printed unconditionally before source resolution -- makes "gate ran"
    // detectable even when a session is serving a stale, pre-gate cached
    // copy of everything downstream of this line.
    expect(contract).toContain('Constitution Gate: running');
    expect(contract).toContain('MUST print on every single invocation, unconditionally, before any pass/fail/HALT determination');
    // A distinct terminal-status line per outcome, so silence is never
    // possible and "ran and passed" can't be confused with "never ran".
    expect(contract).toContain('Constitution Gate: HALT (CONSTITUTION_CONFIG_ERROR)');
    expect(contract).toContain('Constitution Gate: HALT (article violation:');
    expect(contract).toContain('Constitution Gate: PASSED');
    // The known session-caching staleness risk is documented in the gate
    // itself, not just left to bite silently.
    expect(contract).toContain('Known limitation');
    expect(contract).toContain('keeps serving its first-loaded copy');
    expect(contract).toContain('Restart the session');
  });
});
