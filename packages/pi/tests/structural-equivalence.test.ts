/**
 * TRD-025-TEST: Automated Structural Equivalence Check
 *
 * Verifies that Pi-generated prompt templates contain all required structural
 * sections needed to produce output equivalent to Claude Code's native commands.
 *
 * PRD pass criteria:
 *   - Document frontmatter instructions (date, version, status, readiness score)
 *   - Health summary / readiness scorecard
 *   - REQ-NNN requirement ID format
 *   - AC-NNN-M acceptance criteria format
 *   - Dependency map (REQ-NNN depends on REQ-NNN)
 *
 * TRD pass criteria:
 *   - Architecture decision section
 *   - Master task list with TRD-NNN IDs
 *   - Sprint planning
 *   - Traceability matrix
 *   - Design readiness scorecard
 */

import * as fs from 'fs';
import * as path from 'path';

const PROMPTS_DIR = path.resolve(__dirname, '..', 'prompts');

function readPrompt(name: string): string {
  return fs.readFileSync(path.join(PROMPTS_DIR, name), 'utf8');
}

// ---------------------------------------------------------------------------
// PRD template structural checks
// ---------------------------------------------------------------------------

describe('PRD template structural equivalence', () => {
  let createPrd: string;

  beforeAll(() => {
    createPrd = readPrompt('ensemble-create-prd.md');
  });

  it('has document frontmatter instructions', () => {
    // Must instruct Pi to produce frontmatter (document ID, version, status, date)
    expect(createPrd).toMatch(/frontmatter/i);
    expect(createPrd).toMatch(/PRD-YYYY-NNN|Document ID/i);
  });

  it('has readiness scorecard / health summary section', () => {
    expect(createPrd).toMatch(/Readiness Score|readiness scorecard|health summary/i);
  });

  it('has REQ-NNN requirement ID format instructions', () => {
    expect(createPrd).toMatch(/REQ-NNN|REQ-\d{3}/);
  });

  it('has AC-NNN-M acceptance criteria format instructions', () => {
    expect(createPrd).toMatch(/AC-NNN-M|AC-\d{3}-\d/);
  });

  it('has dependency map instructions', () => {
    // Must instruct generating dependency relationships between requirements
    expect(createPrd).toMatch(/depends on|dependency|prerequisite/i);
  });

  it('has all 5 expected phases', () => {
    // create-prd has: Elicitation, Research, Requirements, Review, Output
    const phaseCount = (createPrd.match(/^## Phase \d+/gm) || []).length;
    expect(phaseCount).toBeGreaterThanOrEqual(4);
  });

  it('has ask_user tool reference for interview steps', () => {
    expect(createPrd).toMatch(/ask_user|INTERVIEW PROTOCOL/);
  });

  it('has no AskUserQuestion references', () => {
    expect(createPrd).not.toContain('AskUserQuestion');
  });
});

// ---------------------------------------------------------------------------
// TRD template structural checks
// ---------------------------------------------------------------------------

describe('TRD template structural equivalence', () => {
  let createTrd: string;

  beforeAll(() => {
    createTrd = readPrompt('ensemble-create-trd.md');
  });

  it('has architecture decision section', () => {
    // Must instruct generating architecture options / decision
    expect(createTrd).toMatch(/architecture|Architecture/);
  });

  it('has master task list with TRD-NNN IDs', () => {
    expect(createTrd).toMatch(/Master Task List|TRD-NNN|TRD-\d{3}/i);
  });

  it('has sprint planning section', () => {
    expect(createTrd).toMatch(/sprint|Sprint/);
  });

  it('has traceability matrix instructions', () => {
    expect(createTrd).toMatch(/traceability|Traceability/i);
  });

  it('has design readiness scorecard', () => {
    expect(createTrd).toMatch(/Design Readiness|readiness score/i);
  });

  it('has all expected phases', () => {
    const phaseCount = (createTrd.match(/^## Phase \d+/gm) || []).length;
    expect(phaseCount).toBeGreaterThanOrEqual(4);
  });

  it('has no AskUserQuestion references', () => {
    expect(createTrd).not.toContain('AskUserQuestion');
  });
});

// ---------------------------------------------------------------------------
// Refine-PRD structural checks
// ---------------------------------------------------------------------------

describe('Refine-PRD template structural equivalence', () => {
  let refinePrd: string;

  beforeAll(() => {
    refinePrd = readPrompt('ensemble-refine-prd.md');
  });

  it('has interview protocol for gathering feedback', () => {
    expect(refinePrd).toMatch(/ask_user|INTERVIEW PROTOCOL/);
  });

  it('has file update instructions', () => {
    expect(refinePrd).toMatch(/write|update|save|Write/i);
  });

  it('has no AskUserQuestion references', () => {
    expect(refinePrd).not.toContain('AskUserQuestion');
  });
});

// ---------------------------------------------------------------------------
// All prompts — baseline structural integrity
// ---------------------------------------------------------------------------

describe('All Pi prompt templates — baseline integrity', () => {
  let promptFiles: string[];

  beforeAll(() => {
    promptFiles = fs
      .readdirSync(PROMPTS_DIR)
      .filter((f) => f.endsWith('.md'))
      .map((f) => path.join(PROMPTS_DIR, f));
  });

  it('at least 20 prompt files exist', () => {
    expect(promptFiles.length).toBeGreaterThanOrEqual(20);
  });

  it('every prompt has an HTML generator comment header', () => {
    const missing = promptFiles.filter(
      (f) => !fs.readFileSync(f, 'utf8').includes('<!-- Generated by ensemble-pi generator'),
    );
    expect(missing.map((f) => path.basename(f))).toEqual([]);
  });

  it('every prompt has an H1 title', () => {
    const missing = promptFiles.filter((f) => !fs.readFileSync(f, 'utf8').match(/^# /m));
    expect(missing.map((f) => path.basename(f))).toEqual([]);
  });

  it('no prompt contains AskUserQuestion', () => {
    const offenders = promptFiles.filter((f) =>
      fs.readFileSync(f, 'utf8').includes('AskUserQuestion'),
    );
    expect(offenders.map((f) => path.basename(f))).toEqual([]);
  });
});
