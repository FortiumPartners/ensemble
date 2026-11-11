'use strict';

/**
 * Light-mode runner (kata znd1), consumer-visible contract in the prose: SKILL.md names the
 * CLI, both subcommands, every status the model must handle and the NEEDS_FULL_MODE fallback
 * to the narrated procedure, and points at the reference that holds the detail.
 */

const fs = require('fs');
const path = require('path');
const { readSkillMain, readSkillReference, SKILL_DIR } = require('./helpers/pr-review-cycle-skill');

const STATUSES = ['DISPATCH', 'PENDING', 'DONE', 'ADJUDICATE', 'NEEDS_FULL_MODE', 'RUN_INVALIDATED', 'RUN_FAILED'];

describe('pr-review-cycle light-mode runner prose', () => {
  const main = readSkillMain();

  test('SKILL.md names the CLI, both subcommands and the reference', () => {
    expect(main).toContain('review-run-cli.js');
    expect(main).toMatch(/`prepare`/);
    expect(main).toMatch(/`collect`/);
    expect(main).toContain('reference/review-run.md');
    expect(fs.existsSync(path.join(SKILL_DIR, 'reference', 'review-run.md'))).toBe(true);
  });

  test('the reference tells the model what to do and what never to do', () => {
    const ref = readSkillReference('review-run.md').replace(/\s+/g, ' ');
    expect(ref).toMatch(/start exactly the agents in `agents\[\]`/);
    expect(ref).toMatch(/`prompt` UNEDITED/);
    expect(ref).toContain('maxConcurrentAgents');
    expect(ref).toContain('deadlineAtIso');
    expect(ref).toMatch(/composes no brief, computes no vote, sets no status/);
    expect(ref).toMatch(/Decide ONLY the items in `adjudicate\[\]`/);
  });

  test('SKILL.md falls back to the narrated Steps 1-10 on NEEDS_FULL_MODE', () => {
    expect(main).toMatch(/`NEEDS_FULL_MODE`[^.]*narrated Steps 1-10/);
    expect(main).toContain('### Step 1 -- Resolve scope');
    expect(main).toContain('### Step 10');
  });

  // Review of PR 264, round 3, findings 3 and 4. The skill is held to a word baseline (scripts/prompt-budget-baseline.json), and the
  // runner's pointer was first made to fit by dropping dev's owner paragraph and a clause; the pointer is the part that gives way.
  test('SKILL.md keeps the owner paragraph and the "before running it" clause the runner branch had dropped to fit the word baseline', () => {
    const flat = main.replace(/\s+/g, ' ');
    expect(flat).toContain('This skill owns the *editable* parts (Constitution Rule 8): review criteria, loop order, the 10-minute interactive wait, and Foreman-mode rules. It **composes** `packages/quality/skills/pr-review-remediation/SKILL.md` for every triage, regression-test and minimal-fix decision.');
    expect(flat).toContain('read the one a step names before running it. Their rules are normative.');
  });

  test('the light-mode pointer reads as a sentence: prepare then collect, the Steps below, the narrated Steps', () => {
    const flat = main.replace(/\s+/g, ' ');
    expect(flat).toContain('run `prepare` then `collect` of `lib/review-run-cli.js`');
    expect(flat).toContain('not the Steps below.');
    expect(flat).toContain('`NEEDS_FULL_MODE`: the narrated Steps 1-10, unchanged.');
  });

  test('the reference handles every status and the fallback', () => {
    const ref = readSkillReference('review-run.md');
    for (const s of STATUSES) expect(ref).toContain('`' + s + '`');
    expect(ref).toMatch(/NEEDS_FULL_MODE[\s\S]*narrated Steps 1-10/);
    expect(ref).toMatch(/cannot start model agents/);
    expect(ref).toMatch(/cannot stop an agent/);
    expect(ref).toContain('adjudications');
  });
});
