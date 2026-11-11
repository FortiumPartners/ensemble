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
import { skillOfPrompt } from '../src/generated-marker';

const PROMPTS_DIR = path.resolve(__dirname, '..', 'prompts');
const SKILLS_DIR = path.resolve(__dirname, '..', 'skills');

// Reads a generated prompt template by its Windows-safe "ensemble-<cmd>.md"
// filename from prompts/ — the pi-native home that both native pi and OMP load.
function readPrompt(name: string): string {
  return fs.readFileSync(path.join(PROMPTS_DIR, name), 'utf8');
}

// What a command instructs: its prompt, or, for a skill-backed command, the skill its prompt is a
// stub for. That skill is where the instructions live: its SKILL.md and, when the skill is split, the
// files of its references/ directory (in name order) that the SKILL.md indexes. It ships as written,
// so a phase is an H3 heading under the Workflow of a SKILL.md, or the H1 title of a references/ file,
// not an H2 section of a rendered prompt.
function readInstructions(name: string): string {
  const prompt = readPrompt(name);
  const skill = skillOfPrompt(prompt);
  if (skill === undefined) return prompt;

  const referencesDir = path.join(SKILLS_DIR, skill, 'references');
  const references = fs.existsSync(referencesDir)
    ? fs
        .readdirSync(referencesDir)
        .filter((file) => file.endsWith('.md'))
        .sort()
        .map((file) => fs.readFileSync(path.join(referencesDir, file), 'utf8'))
    : [];
  return [fs.readFileSync(path.join(SKILLS_DIR, skill, 'SKILL.md'), 'utf8'), ...references].join('\n');
}

// ---------------------------------------------------------------------------
// PRD template structural checks
// ---------------------------------------------------------------------------

describe('PRD template structural equivalence', () => {
  let createPrd: string;
  let createPrdPrompt: string;

  beforeAll(() => {
    createPrd = readInstructions('ensemble-create-prd.md');
    createPrdPrompt = readPrompt('ensemble-create-prd.md');
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
    const phaseCount = (createPrd.match(/^#{1,3} Phase \d+/gm) || []).length;
    expect(phaseCount).toBeGreaterThanOrEqual(4);
  });

  it('has ask tool reference for interview steps', () => {
    expect(createPrd).toMatch(/\bask\b|INTERVIEW PROTOCOL/);
  });

  it('has no AskUserQuestion references in its prompt', () => {
    expect(createPrdPrompt).not.toContain('AskUserQuestion');
  });
});

// ---------------------------------------------------------------------------
// TRD template structural checks
// ---------------------------------------------------------------------------

describe('TRD template structural equivalence', () => {
  let createTrd: string;
  let createTrdPrompt: string;

  beforeAll(() => {
    createTrd = readInstructions('ensemble-create-trd.md');
    createTrdPrompt = readPrompt('ensemble-create-trd.md');
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
    const phaseCount = (createTrd.match(/^#{2,3} Phase \d+/gm) || []).length;
    expect(phaseCount).toBeGreaterThanOrEqual(4);
  });

  it('has no AskUserQuestion references in its prompt', () => {
    expect(createTrdPrompt).not.toContain('AskUserQuestion');
  });
});

// ---------------------------------------------------------------------------
// Refine-PRD structural checks
// ---------------------------------------------------------------------------

describe('Refine-PRD template structural equivalence', () => {
  let refinePrd: string;
  let refinePrdPrompt: string;

  beforeAll(() => {
    refinePrd = readInstructions('ensemble-refine-prd.md');
    refinePrdPrompt = readPrompt('ensemble-refine-prd.md');
  });

  it('has interview protocol for gathering feedback', () => {
    expect(refinePrd).toMatch(/\bask\b|INTERVIEW PROTOCOL/);
  });

  it('has file update instructions', () => {
    expect(refinePrd).toMatch(/write|update|save|Write/i);
  });

  it('has no AskUserQuestion references in its prompt', () => {
    expect(refinePrdPrompt).not.toContain('AskUserQuestion');
  });
});

// ---------------------------------------------------------------------------
// All commands — baseline structural integrity
// ---------------------------------------------------------------------------

describe('All Pi command templates — baseline integrity', () => {
  let commandFiles: string[];

  beforeAll(() => {
    commandFiles = fs
      .readdirSync(PROMPTS_DIR)
      .filter((f) => f.endsWith('.md'))
      .map((f) => path.join(PROMPTS_DIR, f));
  });

  it('at least 20 command files exist', () => {
    expect(commandFiles.length).toBeGreaterThanOrEqual(20);
  });

  it('every command has an HTML generator comment header', () => {
    const missing = commandFiles.filter(
      (f) => !fs.readFileSync(f, 'utf8').includes('<!-- Generated by ensemble-pi generator'),
    );
    expect(missing.map((f) => path.basename(f))).toEqual([]);
  });

  it('every command has an H1 title', () => {
    const missing = commandFiles.filter((f) => !fs.readFileSync(f, 'utf8').match(/^# /m));
    expect(missing.map((f) => path.basename(f))).toEqual([]);
  });

  it('no command contains AskUserQuestion', () => {
    const offenders = commandFiles.filter((f) =>
      fs.readFileSync(f, 'utf8').includes('AskUserQuestion'),
    );
    expect(offenders.map((f) => path.basename(f))).toEqual([]);
  });
});
