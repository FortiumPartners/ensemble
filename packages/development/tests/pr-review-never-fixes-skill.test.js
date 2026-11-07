'use strict';

/**
 * The review never fixes (docs/plans/pr-review-speedup-plan.md section 3H items 2, 4 and 6;
 * kata sp4w, AC1).
 *
 * Structural assertions over the pr-review-cycle skill and its companions, in the style of
 * pr-review-cycle-skill.test.js: a skill has no runtime harness, so the contract is what a
 * maintainer or another skill reads. What the prose relies on from code (a resolution
 * closes a finding at the gate; the Fix on this PR option says the head moves) is checked
 * against the real modules, so the prose cannot drift from them unseen. The behavioural half
 * (a review run edits no tracked file and pushes nothing) is pr-review-run-edits-nothing.test.js.
 * The blocks after the original ones pin what review round 1 of PR #265 found, each against the
 * prose, the code or the command it describes.
 */

const { readSkillMain, readSkillReference } = require('./helpers/pr-review-cycle-skill');
const { evaluateGate } = require('../lib/pr-review-gate');
const { recordOperatorResolution } = require('../lib/pr-review-ledger');
const { buildDispositionChoices } = require('../lib/pr-review-disposition');

const flatten = (s) => s.replace(/\s+/g, ' ');
const MAIN = readSkillMain();
const FLAT_MAIN = flatten(MAIN);
const TRIAGE = flatten(readSkillReference('triage-fix-reverify.md'));
const GATE_REF = flatten(readSkillReference('merge-gate.md'));
const INPUTS = flatten(readSkillReference('inputs.md'));
const REMOTE = flatten(readSkillReference('remote-phase.md'));

/** `### Step <label> --` sections of SKILL.md's Algorithm, keyed by label ("1b", "5", "10"). */
function algorithmSteps() {
  const algorithm = MAIN.slice(MAIN.indexOf('## Algorithm'), MAIN.indexOf('## Safety rules'));
  const steps = {};
  const parts = algorithm.split(/^### Step /m).slice(1);
  for (const part of parts) {
    const label = part.slice(0, part.indexOf(' ')).trim();
    steps[label] = part;
  }
  return steps;
}

const STEPS = algorithmSteps();
const section = (title) => {
  const start = MAIN.indexOf(`## ${title}`);
  expect(start).toBeGreaterThan(-1);
  return flatten(MAIN.slice(start, MAIN.indexOf('\n---', start)));
};

describe('the review path has no fix or push step', () => {
  test('only Step 5 delegates to pr-review-remediation, and it says it is not part of any review run', () => {
    for (const [label, text] of Object.entries(STEPS)) {
      if (label === '5') continue;
      expect([label, text.includes('pr-review-remediation/SKILL.md')]).toEqual([label, false]);
    }
    expect(Object.keys(STEPS)).toEqual(expect.arrayContaining(['1', '4', '5', '6', '7', '8', '9', '10']));
    expect(flatten(STEPS['5'])).toContain('**Not part of any review run:** a fix run (`FIX_SELECTION`) or a pre-publication snapshot only');
  });

  test('the algorithm lists Step 5 for no review mode on a PR', () => {
    const algorithm = flatten(MAIN.slice(MAIN.indexOf('## Algorithm'), MAIN.indexOf('### Step 1 --')));
    expect(algorithm).toMatch(/`MODE=local` runs Steps 1-4, the tests fact of Step 6 and Steps 8-9 \(Step 5 and Step 6's post-fix verification only for a pre-publication snapshot\)/);
    expect(algorithm).toContain('`MODE=remote` runs Steps 1, 1b and 7-9');
    expect(algorithm).toContain('`MODE=gate` runs Steps 1, 1b and 10 -- and only those');
    expect(algorithm).toContain('A `MODE=local` run with `FIX_SELECTION` is a fix run: Steps 1 and 5');
  });

  test('a remote review records its findings and edits nothing: the old "fix as one batch before any push" rule is gone', () => {
    const step7 = flatten(STEPS['7']);
    expect(step7).toContain('Actionable remote findings are recorded, never fixed by this run');
    expect(step7).not.toMatch(/repeat Steps 4-6 as one batch/);
    expect(REMOTE).toContain('this run triages them (Step 4) and records them, and edits nothing: a review never fixes');
  });

  test('the merge gate fixes nothing and pushes nothing, and hands every answer to the operator', () => {
    const step10 = flatten(STEPS['10']);
    expect(step10).toContain('no reviewers, fixes or pushes');
    expect(step10).toContain("`gate` also returns the operator's decision list: show it before any merge question");
    expect(GATE_REF).toContain('Nothing here edits a file, commits or pushes.');
  });

  test('"The review never fixes" states the rule for every review mode before the algorithm starts', () => {
    const rule = section('The review never fixes');
    expect(MAIN.indexOf('## The review never fixes')).toBeLessThan(MAIN.indexOf('## Algorithm'));
    expect(rule).toContain('A review run (`MODE=local` of a PR, `remote`, `gate`) edits no tracked file, commits nothing and pushes nothing');
    expect(rule).toContain('An agent never chooses for the operator');
  });

  test('a PR review run is never the pre-publication snapshot: a PR URL, a PR number or REVIEW_ONLY each ends the carve-out', () => {
    expect(section('The review never fixes')).toContain(
      'A pre-publication snapshot (`MODE=local`, no `PR_URL`/`PR_NUMBER`, not `REVIEW_ONLY`)'
    );
    expect(TRIAGE).toContain('`MODE=local`, no `PR_URL`, no `PR_NUMBER`, no `REVIEW_ONLY`');
    expect(INPUTS).toContain('Only a pre-publication snapshot (no `PR_URL`, no `PR_NUMBER`, no `REVIEW_ONLY`) also runs Step 5');
  });
});

describe('--foreman logs and never fixes', () => {
  test('the rule names no fix agent, no waiver and a gate that stays closed', () => {
    const rule = section('The review never fixes');
    expect(rule).toContain('`--foreman` logs and never fixes, waives no blocking finding and leaves the gate `mergeable:false`');
  });

  test('every place a Foreman run could be told otherwise carries the rule', () => {
    expect(INPUTS).toMatch(/`FOREMAN` \| boolean \|[^|]*never asks, fixes, `resolve`s or waives anything/);
    expect(INPUTS).toContain('an open one keeps the gate `mergeable:false` until a person decides');
    expect(REMOTE).toContain('never dismiss the finding to force completion, never fix it and never record a `resolve` for it');
    expect(GATE_REF).toMatch(/\*\*`--foreman`\*\*: the list is logged and nothing is recorded as decided: no `resolve`, no fix run, no waiver/);
    expect(TRIAGE).toContain('Refuse (`REVIEW_BLOCKED`, nothing edited) when `FOREMAN` is true');
  });
});

describe('the operator chooses, and a Fix on this PR answer is never a resolution', () => {
  test('the prose forbids recording Fix on this PR with ledger resolve in every place it is explained', () => {
    expect(section('The review never fixes')).toContain('a Fix on this PR answer never does');
    expect(TRIAGE).toContain('The selection is never recorded with `ledger` `resolve`');
    expect(GATE_REF).toContain('**Fix on this PR: never `ledger` `resolve`.**');
    expect(INPUTS).toContain('Never written with `ledger` `resolve`, which would close the finding at the gate without the fix.');
  });

  test('the premise is true: the gate reads any resolution with provenance as the finding closed, whatever its reason', () => {
    const head = 'a'.repeat(40);
    const important = {
      id: 'F-1',
      source: 'reviewer-1',
      locationOrLink: 'src/b.js:1',
      severity: 'important',
      failureMode: 'unchecked input',
      disposition: 'fix',
      evidence: 'line 1',
      originalTextOrLink: 'https://example.invalid/r/1',
    };
    const gateFor = (ledger) =>
      evaluateGate({
        headSha: head,
        ledger,
        approvals: { ok: true, headSha: head, satisfied: true, reason: 'required-approvals-present', tier: 'medium', humansRequired: 1, humansCounted: 1, approvedBy: ['h'], directedBy: null, ignored: [], refusals: [], reasons: [], warnings: [] },
        tier: { ok: true, tier: 'medium', effectiveTier: 'medium', humansRequired: 1, refusals: [], reasons: [], warnings: [] },
        description: { ok: true, missing: [], present: ['testing', 'risk', 'rollback'], empty: [], ready: true, warnings: [] },
        security: { status: 'clean', findings: [] },
      });

    expect(gateFor([important]).mergeable).toBe(false);
    const recorded = recordOperatorResolution(important, { reason: 'Fix on this PR', by: 'ldangelo', headSha: head, at: '2026-11-07T10:00:00Z' });
    expect(recorded.ok).toBe(true);
    // Recording the selection would have passed the gate with no fix: why the skill must not.
    expect(gateFor([recorded.finding]).mergeable).toBe(true);
  });

  test('the decision list the skill shows says the head moves and approvals reset, and lets a blocking finding be fixed or accepted only', () => {
    const head = 'a'.repeat(40);
    const finding = {
      id: 'F-1',
      source: 'reviewer-1',
      locationOrLink: 'src/b.js:1',
      severity: 'important',
      failureMode: 'unchecked input',
      disposition: 'fix',
      evidence: 'line 1',
      originalTextOrLink: 'https://example.invalid/r/1',
    };
    const list = buildDispositionChoices({ ledger: [finding], security: { status: 'clean', findings: [] }, headSha: head });
    expect(list.ok).toBe(true);
    const entry = list.dispositionChoices.find((c) => c.id === 'F-1');
    expect(entry.choices.map((c) => c.id)).toEqual(['fix-here', 'accept']);
    const fixHere = entry.choices.find((c) => c.id === 'fix-here');
    expect(fixHere.note).toMatch(/head moves/);
    expect(fixHere.note).toMatch(/approvals reset/);
    expect(fixHere.default).toBe(true);
    expect(entry.choices.find((c) => c.id === 'accept').default).toBe(false);
  });

  test('the fix run is one agent and one push for the whole selection, then a delta re-review and the gate again', () => {
    expect(TRIAGE).toContain('One fix agent');
    expect(TRIAGE).toContain('**one push** for the whole selection');
    expect(TRIAGE).toContain('re-runs `MODE=local` on the new head (CLI `review-range`: a delta re-review) and `MODE=gate` again');
    expect(FLAT_MAIN).toContain('one fix agent, one push');
  });

  test('a fix run refuses an unreadable selection: empty, no login or time, unknown finding, or a head that moved', () => {
    for (const refusal of [
      'the selection is empty',
      'an entry lacks `by` or `at`',
      'names an `id` not in the ledger',
      'has a `headSha` other than `HEAD_SHA`',
    ]) {
      expect([refusal, TRIAGE.includes(refusal)]).toEqual([refusal, true]);
    }
  });
});

// ---------------------------------------------------------------------------
// Review round 1 (PR #265)
// ---------------------------------------------------------------------------

describe("Step 5 runs on the operator's selection or on a pre-publication snapshot, and every statement of the trigger says both", () => {
  test('the frontmatter description, the Default plan, the headline and the Safety rules each name the pre-publication case', () => {
    const description = MAIN.match(/^description: (.*)$/m)[1];
    const defaultPlan = flatten(MAIN.slice(MAIN.indexOf('**Default plan:**'), MAIN.indexOf('**Review-only')));
    const safety = flatten(MAIN.slice(MAIN.indexOf('* A PR review never edits'), MAIN.indexOf('* Guidance is the base commit')));
    expect(description).toContain('operator-selected unless pre-publication');
    expect(defaultPlan).toContain('(pre-publication: all actionable)');
    expect(section('The review never fixes')).toContain('or on a pre-publication snapshot');
    expect(safety).toContain('(a pre-publication snapshot excepted)');
  });

  test("no statement that Step 5 runs only on the operator's selection leaves out the pre-publication case", () => {
    let statements = 0;
    for (const [name, text] of [
      ['SKILL.md', FLAT_MAIN],
      ['triage-fix-reverify.md', TRIAGE],
      ['merge-gate.md', GATE_REF],
      ['inputs.md', INPUTS],
      ['remote-phase.md', REMOTE],
    ]) {
      for (const sentence of text.split(/(?<=[.!?]) /)) {
        if (!/runs only on the operator's `FIX_SELECTION`/.test(sentence)) continue;
        statements += 1;
        expect([name, sentence, sentence.includes('pre-publication')]).toEqual([name, sentence, true]);
      }
    }
    expect(statements).toBeGreaterThan(0);
  });

  test('the intro does not call every fix operator-selected, and the Stopping rule says what a deferral never blocks', () => {
    expect(FLAT_MAIN).toContain('**A PR review never fixes**: fixing is Step 5, a separate step composing `pr-review-remediation`');
    expect(FLAT_MAIN).not.toContain('a separate operator-selected step');
    expect(FLAT_MAIN).toContain('and never block `REVIEW_COMPLETE`');
    expect(FLAT_MAIN).not.toContain('never block the review');
  });
});

// ---------------------------------------------------------------------------
// The review steps instruct no push, commit or fix.
//
// A skill has no runtime to refuse an agent that is told to push, so this reads the prose the way
// the agent does: every clause of every review step outside Step 5 (SKILL.md's Algorithm steps and
// the companion text for them) is checked for an instruction to push, commit or fix. A clause that
// negates the verb ("commits nothing", "never push", "no fix agent") is not an instruction. The
// check knows the common shapes of one (an imperative opening a clause, a modal or an infinitive
// before the verb, a git or workflow command); it is a tripwire for a sentence added to the wrong
// step, not a proof that no phrasing gets past it. The two tables of cases below pin what it flags
// and what it leaves alone, so it cannot quietly stop working.
// ---------------------------------------------------------------------------

const ACTION = '(?:push|commit|fix|patch|amend|rebase|cherry-pick)';
const OBJECT = '(?:the|a|an|all|any|every|each|it|them|those|these|that|this|its|their|your|one|real|confirmed|actionable|important|selected|remaining|findings?|changes?|fixes|up|to|origin|directly)';
const NEGATION = /\b(?:never|not|no|nothing|none|neither|nor|without|cannot|refuse[sd]?)\b|n't\b/;
// "Fix on this PR" and "Fix in a follow-on PR" are the operator's option labels, and "fix run",
// "fix agent" and "fix id" are nouns, so a verb followed by one of those is not an instruction.
const LABEL = '(?! (?:on this pr|in a follow-on|run|agent|id|selection|answer|option|step))';
const ADVERB = '(?:(?:also|then|first|now|always|immediately|just|next|finally) )';
const INSTRUCTION_SHAPES = [
  // An imperative opening a clause: "Push the fixes.", "then commit it", "..., fix every finding".
  new RegExp(`(?:^|, )${ADVERB}*${ACTION}(?![\\w-])${LABEL}`),
  // A modal or an infinitive before the verb: "must push before the gate", "to fix it".
  new RegExp(
    `\\b(?:must|should|shall|will|may|can|could|would|might|need to|needs to|has to|have to|ought to|is to|are to|to) ${ADVERB}?${ACTION}(?![\\w-])${LABEL}`
  ),
  // A conjunction or a preposition before the verb, with an object after it: "and push the branch".
  new RegExp(`\\b(?:then|and|or|also|first|next|finally|before|after|until|once) ${ACTION}(?![\\w-]) ${OBJECT}\\b`),
  // A mutating command or capability.
  /\bgit (?:push|commit|add|apply|am|rebase|reset|cherry-pick|merge|revert)\b|\bworkflow\.(?:push|commit)\b|\bgh pr (?:create|merge)\b|\bhost\.change-request-(?:create|merge)\b/,
];

/** Lower-cased clauses of a markdown text: sentences, list items, table cells, `;` `:` ` -- ` and parentheses split. */
function clausesOf(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\n[ \t]*(?:[*-]|\d+\.)[ \t]+/g, '. ')
    .replace(/[*`]/g, '')
    .replace(/\|/g, ';')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?]) |; ?|: | -- | ?[()] ?/)
    .map((clause) => clause.trim().toLowerCase().replace(/[.!?;:,]+$/, ''))
    .filter(Boolean);
}

/** The clauses of `text` that tell a reader to push, commit or fix (a negation earlier in the clause excuses it). */
function instructions(text) {
  const found = [];
  for (const clause of clausesOf(text)) {
    for (const shape of INSTRUCTION_SHAPES) {
      const hit = shape.exec(clause);
      if (hit && !NEGATION.test(clause.slice(0, hit.index))) {
        found.push(clause);
        break;
      }
    }
  }
  return found;
}

/** The only clauses on the review path that use these verbs without negating them, and why. */
const ALLOWED_INSTRUCTIONS = [
  // The publication gate addresses the caller, who publishes; this skill never does.
  'push or create the pr only when it is exactly local_review_complete',
  // The brief renderer's refusal of a bad input: not a finding and not the PR.
  'fix the input, never route around it with a hand-written brief',
];

const withoutStep5 = (text) => text.slice(0, text.indexOf('### Step 5')) + text.slice(text.indexOf('### Step 6'));
const REVIEW_PATH = [
  ...Object.entries(STEPS)
    .filter(([label]) => label !== '5')
    .map(([label, text]) => [`SKILL.md Step ${label}`, text]),
  ...['inputs.md', 'scope-guidance-depth.md', 'ledger-and-verification.md', 'remote-phase.md', 'status-and-state.md', 'merge-gate.md'].map((name) => [
    `reference/${name}`,
    readSkillReference(name),
  ]),
  ['reference/triage-fix-reverify.md outside Step 5', withoutStep5(readSkillReference('triage-fix-reverify.md'))],
];

describe('the review steps instruct no push, commit or fix', () => {
  test.each([
    ['Push the fixes to the PR branch before running the gate.'],
    ['Commit the changes, then push them.'],
    ['Then fix every confirmed finding.'],
    ['The agent should fix the Important findings first.'],
    ['Run `git push origin HEAD` once the tests pass.'],
    ['After the gate passes, push a commit that addresses the finding.'],
    ['Apply the patch and commit it.'],
    ['Push, never force-push.'],
    ['Fix the findings before asking the operator.'],
    ['Before the gate, amend the commit and push.'],
    ['The agent must push before the gate.'],
    ['Agents should commit and push first.'],
    ['It needs to fix the finding.'],
    ['You can then push the branch.'],
    ['The skill may also commit.'],
  ])('the check flags an instruction: %s', (sentence) => {
    expect(instructions(sentence)).not.toEqual([]);
  });

  test.each([
    ['A review run edits no tracked file, commits nothing and pushes nothing.'],
    ['Nothing here edits a file, commits or pushes.'],
    ['A review never edits, commits or pushes; an agent never answers the decision list for the operator.'],
    ['Never edit, commit or push.'],
    ['It must not push the head.'],
    ['Never fix remote comments one at a time.'],
    ['**Fix on this PR: never `ledger` `resolve`.**'],
    ["**Fix in a follow-on PR** and **Accept without fixing**: `ledger` `resolve` with the operator's login."],
    ['No fix agent runs and no blocking finding is waived.'],
    ['The push moves the head, so approvals stop counting.'],
    ["Each finding's **Fix on this PR** option states that the head moves."],
    ['It reads the base commit, never the PR head.'],
    ['One fix agent, one push for the whole selection.'],
    ['A fix run (`FIX_SELECTION`) ends here: it re-reviews nothing.'],
    ['It must not push before the gate.'],
    ['It must never fix a finding.'],
    ['A review never needs to commit.'],
    ['Nothing here has to push.'],
    ['Nits and Pre-existing default to Fix in a follow-on PR.'],
  ])('the check leaves a negation or a noun alone: %s', (sentence) => {
    expect(instructions(sentence)).toEqual([]);
  });

  test.each(REVIEW_PATH)('%s', (label, text) => {
    const stray = instructions(text).filter((clause) => !ALLOWED_INSTRUCTIONS.includes(clause));
    expect(stray).toEqual([]);
  });

  test('a sentence telling the agent to push, added to a real review step, is caught', () => {
    const step7 = STEPS['7'] + '\nPush the fixes to the PR branch before running the gate.\n';
    expect(instructions(step7).filter((clause) => !ALLOWED_INSTRUCTIONS.includes(clause))).toEqual([
      'push the fixes to the pr branch before running the gate',
    ]);
  });

  test('every allowed clause is still in the review path, so an allowance for a reworded sentence is removed', () => {
    const present = new Set(REVIEW_PATH.flatMap(([, text]) => instructions(text)));
    for (const clause of ALLOWED_INSTRUCTIONS) expect([clause, present.has(clause)]).toEqual([clause, true]);
  });
});

describe('a fix run names its MODE and ends after its tests', () => {
  test('the Algorithm names the fix run, its steps, its end and the caller\'s re-run', () => {
    const preamble = flatten(MAIN.slice(MAIN.indexOf('## Algorithm'), MAIN.indexOf('### Step 1 --')));
    expect(preamble).toContain(
      "A `MODE=local` run with `FIX_SELECTION` is a fix run: Steps 1 and 5 and Step 6's tests, no re-review, status or state; the caller re-runs `MODE=local` for the new head."
    );
  });

  test('Inputs define the same fix run in the MODE and FIX_SELECTION rows', () => {
    expect(INPUTS).toContain('With `FIX_SELECTION`, a `local` run is a fix run instead (see `FIX_SELECTION`)');
    expect(INPUTS).toContain(
      "Its presence makes a `MODE=local` run a **fix run** (Steps 1 and 5 and Step 6's tests; no re-review, no status, no state): the caller re-runs `MODE=local` for the new head."
    );
    expect(INPUTS).toContain('Refused when `MODE` is not `local`');
  });

  test('Step 6 gives status and state to a review run only: a fix run ends after the broad gate', () => {
    const step6 = flatten(STEPS['6']);
    expect(step6).toContain('A review run records the tests fact, runs the optional prose-only security gate');
    expect(step6).toContain('a fix run ends there');
    expect(step6).not.toMatch(/`MODE=local` then derives status/);
    expect(TRIAGE).toContain('**A fix run (`FIX_SELECTION`) ends here:** it re-reviews nothing, derives no status and writes no state');
    expect(TRIAGE).toContain('the caller re-runs `MODE=local` on that head, then `MODE=gate`');
    expect(TRIAGE).toContain('Refuse (`REVIEW_BLOCKED`, nothing edited) when `FOREMAN` is true, `MODE` is not `local`');
  });

  test('the remote batch is verified by the fix run and re-reviewed by the caller\'s next MODE=local run', () => {
    expect(REMOTE).toContain('then verify) before any further push. The caller then re-runs `MODE=local` on the new head, which re-reviews it.');
  });
});

describe('a review run writes its gitignored state report, so it edits no tracked file', () => {
  test('the headline and the references say "no tracked file"', () => {
    expect(section('The review never fixes')).toContain('edits no tracked file, commits nothing and pushes nothing, and writes only the gitignored state report');
    expect(TRIAGE).toContain('edits no tracked file, commits nothing and pushes nothing (it writes only the gitignored state report)');
    expect(INPUTS).toContain('No review run edits a tracked file, commits or pushes on a PR');
  });

  test('the FOREMAN row cites the section by name, not a numbered item that is not there', () => {
    expect(INPUTS).toContain('("The review never fixes" in `SKILL.md`)');
    expect(INPUTS).not.toMatch(/never fixes", item \d/);
  });
});

// ---------------------------------------------------------------------------
// The docs half: reference/merge-gate.md, the user guide and the two CHANGELOG entries say what
// the code and pr-merge do today, and each premise check below names what to update when that changes.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const readRepo = (...parts) => fs.readFileSync(path.join(REPO_ROOT, ...parts), 'utf8');
const USER_GUIDE = readRepo('docs', 'guides', 'user-guide.md');
const GUIDE_RULE = flatten(USER_GUIDE.slice(USER_GUIDE.indexOf('**A review never fixes.**'), USER_GUIDE.indexOf('### 11.5')));
/** The changelog entry for this change: one line, found by its opening words. */
function changelogEntry(...parts) {
  const line = readRepo(...parts)
    .split('\n')
    .find((l) => /the PR review never fixes \(kata `sp4w`/i.test(l));
  if (!line) throw new Error(`${parts.join('/')} has no "The PR review never fixes (kata \`sp4w\`" entry`);
  return flatten(line);
}
const CHANGELOG_ROOT = changelogEntry('CHANGELOG.md');
const CHANGELOG_DEV = changelogEntry('packages', 'development', 'CHANGELOG.md');

describe('bead recording is stated as not implemented while nothing creates a bead', () => {
  test('premise: no CLI subcommand and no pr-review module records a bead yet', () => {
    const { HANDLERS } = require('../lib/pr-review-cli');
    const libDir = path.join(__dirname, '..', 'lib');
    const recorders = fs
      .readdirSync(libDir)
      .filter((file) => /^(?:pr-review-.*|review-precheck-cli)\.js$/.test(file))
      .filter((file) => /tracker-findings|create-detailed|tracker\.create/.test(fs.readFileSync(path.join(libDir, file), 'utf8')));
    if (Object.keys(HANDLERS).includes('beads') || fs.existsSync(path.join(libDir, 'pr-review-beads.js')) || recorders.length > 0) {
      throw new Error(
        'A bead recorder exists now (kata n350). Replace the "not implemented yet" notes in ' +
          'reference/merge-gate.md, docs/guides/user-guide.md and the two CHANGELOG entries with its call and skip path, ' +
          'then delete this premise check.'
      );
    }
  });

  test('merge-gate.md, the headline, the user guide and both changelogs say so instead of claiming the findings are recorded', () => {
    expect(GATE_REF).toContain('**Recording every confirmed finding as a bead is not implemented yet.**');
    expect(GATE_REF).toContain('The `beads` subcommand that would do it (kata `n350`) is not in `pr-review-cli.js`');
    expect(GATE_REF).not.toContain('It records every confirmed finding as a bead');
    expect(GATE_REF).not.toContain('Beads for the findings are recorded where the repository has a tracker');
    expect(FLAT_MAIN).not.toMatch(/records findings as beads/);
    expect(GUIDE_RULE).toContain('Recording each confirmed finding as a bead is not implemented yet');
    expect(GUIDE_RULE).not.toContain('It records each confirmed finding as a bead');
    expect(CHANGELOG_ROOT).toContain('Recording findings as beads awaits kata `n350`');
    expect(CHANGELOG_DEV).toContain('Recording findings as beads is not implemented yet');
  });
});

describe('the docs do not claim more than /ensemble:pr-merge does', () => {
  test('premise: pr-merge still dispatches remediation subagents that commit and push to the PR branch', () => {
    const prMerge = readRepo('packages', 'git', 'commands', 'pr-merge.yaml');
    if (!/name: Parallel Remediation Dispatch/.test(prMerge) || !/commit and git push to HEAD_REF/.test(prMerge)) {
      throw new Error(
        'pr-merge no longer pushes remediation fixes (kata 6k8d landed?). Remove the "Not yet true of /ensemble:pr-merge" ' +
          'notes from docs/guides/user-guide.md and the two CHANGELOG entries, then delete this premise check.'
      );
    }
  });

  test('the user guide and both changelogs say the no-fix rule does not bind pr-merge until kata 6k8d lands', () => {
    expect(GUIDE_RULE).toContain('> **Not yet true of `/ensemble:pr-merge`.**');
    expect(GUIDE_RULE).toContain('Until kata `6k8d` lands, `pr-merge` shows no decision list and still runs its own remediation stage');
    expect(GUIDE_RULE).toContain('subagents commit and push fixes for findings to the PR branch before it asks the gate');
    for (const entry of [CHANGELOG_ROOT, CHANGELOG_DEV]) {
      expect(entry).toContain('Not yet true of `/ensemble:pr-merge`: until kata `6k8d` lands it still runs its own remediation stage');
      expect(entry).toContain('commit and push fixes for findings to the PR branch before the gate');
    }
  });
});

describe('the merge gate reference, the user guide and both changelogs say a review edits no tracked file', () => {
  test('each says "no tracked file" and names the gitignored state report', () => {
    expect(GATE_REF).toContain('A review run edits no tracked file, commits nothing and pushes nothing (it writes only the gitignored state report)');
    expect(GUIDE_RULE).toContain('edits no tracked file, commits nothing and pushes nothing, and writes only its gitignored state report');
    expect(CHANGELOG_ROOT).toContain('edit no tracked file (they write only the gitignored state report)');
    expect(CHANGELOG_DEV).toContain('edit no tracked file (they write only the gitignored state report)');
  });
});
