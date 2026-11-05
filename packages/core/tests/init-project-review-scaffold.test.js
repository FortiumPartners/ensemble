'use strict';

/**
 * TRD-007: init-project scaffolds the review files an adopting repository needs.
 *
 * Validates PRD ACs: AC-002-4 (PR template, review rules file and ownership
 * declaration are scaffolded by the project init flow), AC-003-1 (the
 * scaffolded rules file is where an owner declares sensitive paths) and
 * AC-001-3 (the scaffolded rules file is editable prose/data: changing it
 * changes the next review with no code change, rebuild or release).
 *
 * These assertions read the SHIPPED command text, not a copy: the templates a
 * team receives are the ones written in
 * `packages/core/commands/ensemble/init-project.md`.
 *
 * The last test is the guardrail named in the TRD implementation AC: the new
 * templates must sit OUTSIDE the constitution fence, so the extraction that
 * init-project-constitution.test.js performs still sees the constitution
 * template and nothing else.
 */

const fs = require('fs');
const path = require('path');

const { loadPolicy } = require('../../development/lib/pr-review-policy');
const { checkDescription } = require('../../development/lib/pr-review-description');

const SOURCE_PATH = path.join(__dirname, '../commands/ensemble/init-project.md');
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf8');

/** A full object id the policy loader accepts as a base commit. */
const BASE_SHA = 'a'.repeat(40);

const SCAFFOLD_HEADING = '### Step 6: Scaffold Review Files';

/**
 * Returns the first fenced block that follows `fromIndex`, honouring fences of
 * three OR MORE backticks so a template may itself contain a fenced block.
 */
function fencedBlockAfter(fromIndex, language) {
  const lines = SOURCE.slice(fromIndex).split('\n');
  const open = new RegExp(`^(\`{3,})${language}\\s*$`);
  let fence = null;
  const body = [];

  for (const line of lines) {
    if (fence === null) {
      const match = open.exec(line);
      if (match) fence = match[1];
      continue;
    }
    if (line.trim() === fence) return body.join('\n');
    body.push(line);
  }
  return null;
}

/** The section text from one heading up to the next `### ` heading. */
function section(heading) {
  const start = SOURCE.indexOf(heading);
  if (start === -1) return null;
  const next = SOURCE.indexOf('\n### ', start + heading.length);
  return SOURCE.slice(start, next === -1 ? SOURCE.length : next);
}

/** The template that follows a `**path**`-style file label inside the scaffold step. */
function templateFor(filePath, language) {
  const start = SOURCE.indexOf(SCAFFOLD_HEADING);
  expect(start).toBeGreaterThan(-1);
  const labelIndex = SOURCE.indexOf(filePath, start);
  expect(labelIndex).toBeGreaterThan(-1);
  return fencedBlockAfter(labelIndex, language);
}

describe('init-project scaffolds the review files (AC-002-4)', () => {
  test('the command has a review-file scaffolding step', () => {
    const step = section(SCAFFOLD_HEADING);
    expect(step).not.toBeNull();
    expect(step).toContain('.github/pull_request_template.md');
    expect(step).toContain('REVIEW.md');
    expect(step).toContain('.github/CODEOWNERS');
  });

  test('the PR template carries Testing, Risk and How to revert', () => {
    const template = templateFor('.github/pull_request_template.md', 'markdown');
    expect(template).not.toBeNull();
    expect(template).toContain('## Testing');
    expect(template).toContain('## Risk');
    expect(template).toContain('## How to revert');
  });

  test('the real description checker reads the scaffolded PR template', () => {
    const template = templateFor('.github/pull_request_template.md', 'markdown');

    // Unfilled, it is not a description: a heading is not content.
    const empty = checkDescription({ body: template, agentAuthored: false });
    expect(empty.ready).toBe(false);
    expect(empty.missing).toEqual(['testing', 'risk', 'how-to-revert']);

    // Filled in, the same headings satisfy the checker -- so a team that
    // uses the scaffolded template can actually pass the description gate.
    const answered = checkDescription({
      body: template.replace(/^(## .*)$/gm, '$1\n\nfilled by the author.'),
      agentAuthored: false,
    });
    expect(answered.ready).toBe(true);
    expect(answered.missing).toEqual([]);
  });

  test('the scaffolded REVIEW.md carries a policy block the loader accepts', () => {
    const template = templateFor('REVIEW.md', 'markdown');
    expect(template).not.toBeNull();

    // The block is written in the template as its own fenced
    // `ensemble-review-policy` block; read it straight out of the template.
    const block = /```ensemble-review-policy\n([\s\S]*?)\n```/.exec(template);
    expect(block).not.toBeNull();
    const json = JSON.parse(block[1]);
    // A commit cannot name itself: a scaffolded `sourceSha` could never match
    // the base, and the block would be rejected on every review.
    expect(Object.prototype.hasOwnProperty.call(json, 'sourceSha')).toBe(false);

    const loaded = loadPolicy({ text: template, baseSha: BASE_SHA, sourceSha: BASE_SHA });
    expect(loaded.ok).toBe(true);
    expect(loaded.source).toBe('policy');
    expect(loaded.rejected).toEqual([]);
  });

  test('the scaffolded REVIEW.md shows an example area rule (AC-001-3)', () => {
    const template = templateFor('REVIEW.md', 'markdown');
    expect(template.toLowerCase()).toContain('area');
    // An example of a per-area rules file a maintainer copies into a directory.
    expect(/`[^`]*\/REVIEW\.md`/.test(template)).toBe(true);
  });

  test('the scaffolded REVIEW.md names where sensitive paths are declared (AC-003-1)', () => {
    const template = templateFor('REVIEW.md', 'markdown');
    expect(template).toContain('sensitivePaths');
  });

  test('the ownership declaration template is a CODEOWNERS file with owners', () => {
    const template = templateFor('.github/CODEOWNERS', 'text');
    expect(template).not.toBeNull();
    const entries = template
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.trim().split(/\s+/).length).toBeGreaterThan(1);
      expect(entry).toMatch(/@[A-Za-z0-9][A-Za-z0-9-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)?/);
    }
  });
});

describe('init-project never overwrites an existing review file', () => {
  test('the scaffolding step states the non-force behaviour', () => {
    const step = section(SCAFFOLD_HEADING).toLowerCase();
    expect(step).toContain('force');
    expect(step).toContain('never overwrite');
    expect(step).toMatch(/difference|diff/);
    expect(step).toMatch(/merge|skip/);
  });
});

describe('the templates sit outside the constitution fence', () => {
  // Mirrors the extraction in init-project-constitution.test.js exactly.
  function constitutionTemplate() {
    const stepStart = SOURCE.indexOf('### Step 3: Generate Constitution');
    const fenceStart = SOURCE.indexOf('```markdown', stepStart);
    const fenceEnd = SOURCE.indexOf('```', fenceStart + 1);
    return SOURCE.slice(fenceStart, fenceEnd);
  }

  test('the constitution template is unchanged by the new templates', () => {
    const template = constitutionTemplate();
    expect(template).toContain('## Article I: Core Principles');
    expect(template).toContain('## Article V: Agent Delegation Standards');
    expect(template).not.toContain('ensemble-review-policy');
    expect(template).not.toContain('pull_request_template');
    expect(template).not.toContain('CODEOWNERS');

    const headings = template
      .split('\n')
      .filter((line) => line.startsWith('## ') && line !== '## Changelog');
    for (const heading of headings) {
      expect(heading).toMatch(/^## Article [IVXLCDM]+: /);
    }
  });

  test('the review templates are written after the constitution step', () => {
    expect(SOURCE.indexOf(SCAFFOLD_HEADING)).toBeGreaterThan(
      SOURCE.indexOf('### Step 3: Generate Constitution'),
    );
  });
});
