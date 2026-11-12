'use strict';

/**
 * /ensemble:pr-merge presents the operator's dispositions before it asks to merge
 * (kata 6k8d; plan docs/plans/pr-review-speedup-plan.md section 3H, acceptance tests (d) and (e)).
 *
 * The command is prose a model follows, so the contract is its flow and what it relies on from
 * code. Flow: the disposition step sits between the review gate and the merge, the confirmation
 * question is reachable only after it, and the remediation-skip shortcut still passes through it.
 * Reliance: every gate field, blocker code and halted_reason the prose names is checked against
 * the real gate (a spawned `pr-review-cli.js gate`) and the procedure the prose delegates to
 * (`reference/merge-gate.md`), so a rename on either side fails here instead of drifting.
 *
 * Routing (plan 3H.7): a review-cycle finding is never auto-dispatched or looped on (only the operator's Fix on this
 * PR selection fixes one); only check failures and unresolved human threads are. The sentences that carry that are pinned by structure (which sentence
 * names which blocker, which phases can see a review finding), against the codes the real gate raises, and in every
 * shipped rendering: the Claude and Codex renderings carry the workflow only, never `constraints`, so a constraint
 * alone would not reach them.
 *
 * The live drive (rpc-ui) and the real dry-run are recorded on the PR, not pinned here.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { COMMAND, SKILL_REL, SKILL_TEXT } = require('./helpers/pr-merge-skill');

const { BLOCKER_CODES } = require('../lib/pr-review-gate');
const { recordOperatorResolution } = require('../lib/pr-review-ledger');
const { COLLAPSE_THRESHOLD } = require('../lib/pr-review-disposition');
const { CEILINGS, countWords, loadBaseline } = require('../../../scripts/lib/prompt-budget');
const { readSkillReference } = require('./helpers/pr-review-cycle-skill');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(__dirname, '..', 'lib', 'pr-review-cli.js');
const read = (...parts) => fs.readFileSync(path.join(REPO_ROOT, ...parts), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');
const sentencesOf = (text) => text.split(/(?<=\.)\s+/);

const COMMAND_PATH = 'packages/git/commands/pr-merge.yaml';
const GATE_REF = flat(readSkillReference('merge-gate.md'));

/**
 * Every shipped rendering that carries the prose: the skill (the one source -- the command YAML
 * is a manifest with no prompt) and its verbatim copies for pi and Codex. The `constraints` are
 * part of the skill, so every one of these carries them. The Claude command and the pi prompt
 * are stubs that point at the skill; see STUBS.
 */
const SURFACES = {
  skill: SKILL_REL,
  'pi skill': 'packages/pi/skills/ensemble-pr-merge/SKILL.md',
  codex: 'packages/codex/.codex/skills/commands/ensemble-pr-merge/SKILL.md',
};
const STUBS = {
  claude: 'packages/git/commands/ensemble/pr-merge.md',
  'pi prompt': 'packages/pi/prompts/ensemble-pr-merge.md',
};
const surfaceText = (file) => flat(read(...file.split('/')));

/** Every action in workflow order, each with where it sits. */
function actionsInOrder() {
  const out = [];
  for (const phase of COMMAND.workflow.phases) {
    for (const step of phase.steps) {
      for (const action of step.actions || []) out.push({ phase: phase.name, step: step.title, text: action });
    }
  }
  return out;
}
const phaseOf = (phaseName) => COMMAND.workflow.phases.find((p) => p.name === phaseName);
const stepOf = (phaseName, title) => phaseOf(phaseName).steps.find((s) => s.title === title);
const dispositionActions = () => stepOf('Merge and Report', 'Operator Disposition').actions;
const interactiveAction = () => dispositionActions().find((a) => a.startsWith('Interactive:'));

/** The text of `text` from `from` up to (not including) `to`. */
function between(text, from, to) {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start + from.length);
  if (start < 0 || end < 0) throw new Error(`cannot slice ${JSON.stringify(from)} .. ${JSON.stringify(to)}`);
  return text.slice(start, end);
}

const MERGE_QUESTION = 'Allow the host adapter to merge PR';

/** The blockers the real gate raises for a review finding (an open Important, an unrecognised severity, a security finding). */
const REVIEW_FINDING_CODES = Object.values(BLOCKER_CODES).filter((code) => /finding/.test(code));

const HEAD = 'a'.repeat(40);
function gateInput(extra = {}) {
  return {
    headSha: HEAD,
    ledger: [],
    approvals: {
      ok: true, headSha: HEAD, satisfied: true, reason: 'required-approvals-present', tier: 'medium',
      humansRequired: 1, humansCounted: 1, approvedBy: ['human-a'], directedBy: null, ignored: [],
      refusals: [], reasons: [], warnings: [],
    },
    tier: { ok: true, tier: 'medium', effectiveTier: 'medium', humansRequired: 1, refusals: [], reasons: [], warnings: [] },
    description: { ok: true, missing: [], present: ['testing', 'risk', 'rollback'], empty: [], ready: true, warnings: [] },
    security: { status: 'clean', findings: [] },
    coverage: { status: 'complete', gaps: [] },
    ...extra,
  };
}
function runGate(payload) {
  const run = spawnSync('node', [CLI, 'gate'], { input: JSON.stringify(payload), encoding: 'utf8' });
  expect(run.status).toBe(0);
  return JSON.parse(run.stdout);
}
const importantFinding = (id = 'F-1') => ({
  id, source: 'code-reviewer', locationOrLink: 'packages/development/lib/widget.js:12', severity: 'important',
  failureMode: 'unchecked input', disposition: 'fix', evidence: 'line 12', originalTextOrLink: 'https://example.invalid/pr/1#r1',
});
const nitFinding = (id, file = 'packages/development/lib/same.js') => ({
  ...importantFinding(id), severity: 'nit', locationOrLink: `${file}:${id.replace(/\D/g, '') || 1}`,
});

describe('AC1: the merge-confirmation question is not asked until the operator answered the list', () => {
  test('Merge and Report runs gate, then disposition, then merge, then report', () => {
    const steps = COMMAND.workflow.phases.find((p) => p.name === 'Merge and Report').steps;
    expect(steps.map((s) => [s.order, s.title])).toEqual([
      [1, 'Review Merge Gate'],
      [2, 'Operator Disposition'],
      [3, 'Merge'],
      [4, 'Final Report'],
    ]);
  });

  test('the disposition questions come before the merge question and the merge question only exists in the Merge step', () => {
    const actions = actionsInOrder();
    const firstList = actions.findIndex((a) => a.step === 'Operator Disposition' && /multi-select/.test(a.text));
    const asks = actions.map((a, i) => (a.text.includes(MERGE_QUESTION) ? i : -1)).filter((i) => i >= 0);
    expect(firstList).toBeGreaterThan(-1);
    expect(asks).toHaveLength(1);
    expect(asks[0]).toBeGreaterThan(firstList);
    expect(actions[asks[0]].step).toBe('Merge');
  });

  test('the merge question carries the summary of what is being accepted, and says it follows the disposition step', () => {
    const merge = stepOf('Merge and Report', 'Merge').actions.join(' ');
    expect(merge).toContain(`"<MERGE_SUMMARY> ${MERGE_QUESTION}`);
    const disposition = dispositionActions().join(' ');
    expect(disposition).toMatch(/MERGE_SUMMARY \(open beads, accepted blocking findings with reason and login\)/);
    expect(disposition).toMatch(/asked only after this step has finished on this head/);
  });

  test('the operator sees the numbered list before the first question: in the Interactive action, in the reference (Show before the multi-select question) and in every rendering', () => {
    const interactive = interactiveAction();
    const list = interactive.indexOf('print the numbered list');
    const login = interactive.indexOf("ask the operator's own login");
    const question = interactive.indexOf('AskUserQuestion');
    expect(list).toBeGreaterThan(-1);
    expect(question).toBeGreaterThan(-1);
    expect(list).toBeLessThan(login);
    expect(login).toBeLessThan(question);
    expect(GATE_REF.indexOf('**Show.**')).toBeGreaterThan(-1);
    expect(GATE_REF.indexOf('**Show.**')).toBeLessThan(GATE_REF.indexOf('**One multi-select question per group**'));
    for (const [name, file] of Object.entries(SURFACES)) {
      const text = surfaceText(file);
      const at = text.indexOf('Interactive: print the numbered list');
      expect([name, at > -1]).toEqual([name, true]);
      const asked = text.search(/ONE multi-select (AskUserQuestion|ask) per group/); // pi renders AskUserQuestion as ask
      expect([name, asked > at]).toEqual([name, true]);
    }
  });

  test('a constraint forbids the question before the answer, and the ask tool is allowed (it maps to ask on pi)', () => {
    expect(COMMAND.constraints.some((c) => /NEVER ask the merge-confirmation question before the operator has answered/.test(c))).toBe(true);
    expect(COMMAND.metadata.allowed_tools).toContain('AskUserQuestion');
  });

  test.each(Object.entries(SURFACES))('%s: the step says the answer comes before the merge question', (_name, file) => {
    const text = surfaceText(file);
    expect(text).toContain("Every review finding gets the operator's answer BEFORE the merge-confirmation question; this command never fixes one itself.");
    expect(text).toContain('asked only after this step has finished on this head');
  });
});

describe('AC3: the remediation-skip shortcut still reaches the disposition step', () => {
  test('the skip action names the disposition step and the gate, and the disposition step runs on every path', () => {
    const skip = stepOf('PR Discovery', 'Baseline Findings Manifest').actions.find((a) => /skip to Merge and Report/.test(a));
    expect(skip).toMatch(/never skips the Review Merge Gate or the Operator Disposition step/);
    const first = dispositionActions()[0];
    expect(first).toMatch(/EVERY path to Merge, including the remediation-skip shortcut and a mergeable:true gate/);
  });
});

describe('AC2: --foreman records nothing as decided, runs no fix agent, and the gate keeps refusing', () => {
  test('the prose says so in the step (every rendering) and in the pi constraint', () => {
    const foreman = dispositionActions().find((a) => a.startsWith('--foreman'));
    expect(foreman).toMatch(/ask, resolve, fix, default and waive nothing/);
    expect(foreman).toMatch(/mergeable:false HALTs findings-need-operator/);
    expect(COMMAND.constraints.some((c) => /NEVER auto-dispatch or loop on a review-cycle finding .*: only the operator's Fix on this PR selection fixes one; NEVER ask the merge-confirmation question/.test(c))).toBe(true);
    for (const [name, file] of Object.entries(SURFACES)) expect([name, surfaceText(file).includes(flat(foreman))]).toEqual([name, true]);
  });

  test('what the prose relies on is true of the real gate: an undecided Important finding refuses, is listed, and offers no follow-on or default Accept', () => {
    const out = runGate(gateInput({ ledger: [importantFinding()] }));
    expect(out.mergeable).toBe(false);
    expect(out.blockers.map((b) => b.code)).toEqual(['open-important-finding']);
    const entry = out.dispositionChoices[0];
    expect(entry.group).toBe('blocking');
    expect(entry.choices.map((c) => c.id)).toEqual(['fix-here', 'accept']);
    expect(entry.default).toBe('fix-here');
    expect(entry.requiresReason).toBe(true);
    // Nothing was decided, so asking the gate again (what --foreman leaves behind) refuses again.
    expect(runGate(gateInput({ ledger: [importantFinding()] })).mergeable).toBe(false);
  });

  test('an operator accept closes the finding whatever its reason text says, and a Fix on this PR answer cannot be recorded as a resolution: the prose must not resolve it', () => {
    const at = '2026-11-07T10:00:00Z';
    const closedByAccept = {
      ...importantFinding(),
      disposition: 'resolved',
      resolution: { decision: 'accept', reason: 'fix on this PR', by: 'ldangelo', at, headSha: HEAD },
    };
    expect(runGate(gateInput({ ledger: [closedByAccept] })).mergeable).toBe(true);
    for (const answer of ['fix-here', 'Fix on this PR']) {
      const refused = recordOperatorResolution(importantFinding(), { decision: answer, reason: 'fix on this PR', by: 'ldangelo', at, headSha: HEAD });
      expect(refused.ok).toBe(false);
      expect(refused.reason).toContain('FIX_SELECTION');
      expect(runGate(gateInput({ ledger: [refused.finding] })).mergeable).toBe(false);
    }
    const fix = sentencesOf(interactiveAction()).find((s) => /FIX_SELECTION/.test(s));
    expect(fix).toMatch(/Fix on this PR: ONE pr-review-cycle MODE=local fix run with FIX_SELECTION \(never ledger resolve\)/);
  });
});

describe('review findings are never auto-fixed (plan 3H.7): the routing, pinned by structure and by the real gate', () => {
  const routing = () => stepOf('Merge and Report', 'Review Merge Gate').actions.find((a) => /^mergeable:true is REQUIRED/.test(a));

  test('the codes the command names are exactly the finding blockers the real gate raises, and each one is a dispositionChoices entry', () => {
    const cases = [
      ['open-important-finding', gateInput({ ledger: [importantFinding('F-1')] }), 'F-1'],
      ['open-unrecognised-finding', gateInput({ ledger: [{ ...importantFinding('U-1'), severity: 'catastrophic-ish' }] }), 'U-1'],
      ['security-finding-open', gateInput({ security: { status: 'findings', findings: [importantFinding('S-1')] } }), 'S-1'],
    ];
    expect(cases.map(([code]) => code).sort()).toEqual([...REVIEW_FINDING_CODES].sort());
    for (const [code, input, id] of cases) {
      const out = runGate(input);
      expect([code, out.blockers.map((b) => b.code)]).toEqual([code, [code]]);
      expect([code, out.dispositionChoices.map((e) => e.id)]).toEqual([code, [id]]);
    }
  });

  test('ONE sentence names every review-finding blocker and says it is never auto-dispatched or looped on and is decided in Operator Disposition', () => {
    const naming = sentencesOf(routing()).filter((s) => REVIEW_FINDING_CODES.some((code) => s.includes(code)));
    expect(naming).toHaveLength(1);
    for (const code of REVIEW_FINDING_CODES) expect(naming[0]).toContain(code);
    expect(naming[0]).toMatch(/never auto-dispatched or looped on/);
    expect(naming[0]).toMatch(/decided in Operator Disposition/);
    expect(naming[0]).not.toMatch(/Verification and Round Loop|round cap|remediated/);
  });

  test('the only findings sent back to the verification loop are check and review_thread ones', () => {
    const toLoop = sentencesOf(routing()).filter((s) => /Verification and Round Loop/.test(s));
    expect(toLoop).toHaveLength(1);
    expect(toLoop[0]).toMatch(/^Check and review_thread findings/);
    for (const code of REVIEW_FINDING_CODES) expect(toLoop[0]).not.toContain(code);
  });

  test('the manifest has two kinds, check and review_thread: a review-cycle finding has no kind to be dispatched under', () => {
    const manifest = stepOf('PR Discovery', 'Baseline Findings Manifest').actions.find((a) => /^Otherwise write a numbered manifest/.test(a));
    expect(/kind: ([A-Za-z_|]+)/.exec(manifest)[1]).toBe('check|review_thread');
  });

  test('nothing in the routing, dispatch or verification phases can see a review-cycle finding', () => {
    for (const name of ['Classification and Routing', 'Parallel Remediation Dispatch', 'Verification and Round Loop']) {
      const text = JSON.stringify(phaseOf(name));
      for (const needle of [...REVIEW_FINDING_CODES, 'dispositionChoices', 'Operator Disposition', 'FIX_SELECTION']) {
        expect([name, needle, text.includes(needle)]).toEqual([name, needle, false]);
      }
    }
  });

  test('the pi constraint forbids auto-dispatching or looping on a review-cycle finding and names the operator-selected Fix on this PR as the only way one is fixed', () => {
    const constraint = COMMAND.constraints.find((c) => /NEVER auto-dispatch or loop on a review-cycle finding/.test(c));
    expect(constraint).toContain("NEVER auto-dispatch or loop on a review-cycle finding (any dispositionChoices entry): only the operator's Fix on this PR selection fixes one");
    for (const file of [SURFACES.skill, SURFACES['pi skill']]) expect(surfaceText(file)).toContain(flat(constraint));
  });

  test('no rule forbids the Fix on this PR path this command adds: the constraint and the routing sentence carve it out, and FIX_SELECTION appears only in Operator Disposition', () => {
    const constraint = COMMAND.constraints.find((c) => /review-cycle finding/.test(c));
    const routingSentence = sentencesOf(routing()).find((s) => REVIEW_FINDING_CODES.every((code) => s.includes(code)));
    // The designed path: the operator's selection runs a fix (ONE MODE=local fix run with FIX_SELECTION).
    expect(interactiveAction()).toMatch(/a selection means Fix on this PR: ONE pr-review-cycle MODE=local fix run with FIX_SELECTION/);
    // So no rule may say a review finding is never sent or dispatched to a fixer without saying who may start one.
    expect(constraint).not.toMatch(/NEVER send a review-cycle finding/);
    expect(constraint).toMatch(/only the operator's Fix on this PR selection fixes one/);
    expect(routingSentence).not.toMatch(/never dispatched/);
    expect(routingSentence).toMatch(/never auto-dispatched or looped on, decided in Operator Disposition/);
    // Nothing outside Operator Disposition starts a fix run for a review finding.
    for (const a of actionsInOrder().filter((x) => x.step !== 'Operator Disposition')) expect([a.step, /FIX_SELECTION/.test(a.text)]).toEqual([a.step, false]);
  });

  test.each(Object.entries(SURFACES))('%s: the routing and the no-fix contract are rendered (not only in the constraints)', (_name, file) => {
    const text = surfaceText(file);
    for (const sentence of sentencesOf(routing()).filter((s) => /never auto-dispatched or looped on|^Check and review_thread findings/.test(s))) {
      expect(text).toContain(sentence);
    }
    expect(text).toContain('this command never fixes one itself');
  });

  test('a Fix on this PR answer is never recorded with ledger resolve: resolve is attached only to Accept and follow-on', () => {
    const sentences = sentencesOf(interactiveAction());
    const fix = sentences.find((s) => /FIX_SELECTION/.test(s));
    expect(fix).toMatch(/\(never ledger resolve\)/);
    const resolving = sentences.filter((s) => /ledger resolve/.test(s) && !/never ledger resolve/.test(s));
    expect(resolving.length).toBeGreaterThan(0);
    for (const s of resolving) {
      expect(s).toMatch(/Accept/);
      expect(s).toMatch(/follow-on/);
      expect(s).not.toMatch(/FIX_SELECTION|Fix on this PR/);
    }
  });
});

describe('Fix on this PR: one fix run, then a delta re-review of the new head, then the gate (plan 3H.2)', () => {
  test('the command runs the MODE=local fix run, the MODE=local delta re-review and MODE=gate in that order, and does not loop back through the verification round', () => {
    const fix = sentencesOf(interactiveAction()).find((s) => /FIX_SELECTION/.test(s));
    const at = ['MODE=local fix run with FIX_SELECTION', 'delta re-review (MODE=local) of the new head', 'MODE=gate and this step again'].map((p) => fix.indexOf(p));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(fix).toMatch(/one round against the cap/);
    expect(fix).not.toMatch(/Verification and Round Loop/);
  });

  test('the reference gives the same order, with the PR identity that keeps the re-review a PR review and the reason it must precede the gate', () => {
    const step = between(GATE_REF, '7. **Any Fix on this PR selected:**', '8. **Nothing selected for fixing.**');
    const at = [
      '(a) ONE `MODE=local` fix run with `FIX_SELECTION`',
      '(b) a delta re-review of the NEW head: `MODE=local` of this PR',
      '(c) `MODE=gate` for that head and this procedure again',
    ].map((p) => step.indexOf(p));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(step).toContain('give no `FIX_SELECTION`');
    expect(step).toContain('without a PR identity it would be a pre-publication snapshot');
    expect(step).toContain('a gate on a head with no recorded review blocks `review-data-unavailable`');
    expect(step).toContain('ONE round against the round cap');
    expect(step).toContain('`resolve` nothing');
  });

  test('the skill documents the fix run as ending without a re-review, so the caller has to run MODE=local again (the step the old text skipped)', () => {
    const skill = flat(read('packages', 'development', 'skills', 'pr-review-cycle', 'SKILL.md'));
    expect(skill).toContain('A `MODE=local` run with `FIX_SELECTION` is a fix run');
    expect(skill).toContain('no re-review, status or state; the caller re-runs `MODE=local` for the new head');
  });

  test('without that re-review the real gate has no review to read for the new head: it blocks review-data-unavailable', () => {
    const { ledger, ...noRecordedReview } = gateInput();
    expect(ledger).toEqual([]);
    const out = runGate(noRecordedReview);
    expect(out.mergeable).toBe(false);
    expect(out.blockers.map((b) => b.code)).toEqual(['review-data-unavailable']);
    expect(out.dispositionChoices).toEqual([]);
  });

  test.each(Object.entries(SURFACES))('%s renders the sequence', (_name, file) => {
    expect(surfaceText(file)).toContain('a delta re-review (MODE=local) of the new head, then MODE=gate and this step again, one round against the cap');
  });
});

describe('--dry-run stops before any question, resolve or fix run', () => {
  test('the --dry-run action comes before every action that asks, resolves or fixes, and says it stops', () => {
    const actions = dispositionActions();
    const dry = actions.findIndex((a) => a.startsWith('--dry-run'));
    expect(dry).toBeGreaterThan(-1);
    expect(actions[dry]).toMatch(/stop and report merge-readiness \(no question, no resolve, no fix run\)/);
    const mutating = actions.map((a, i) => (/AskUserQuestion|ledger resolve|FIX_SELECTION/.test(a) ? i : -1)).filter((i) => i >= 0);
    expect(mutating.length).toBeGreaterThan(0);
    for (const i of mutating) expect(i).toBeGreaterThan(dry);
  });

  test('nothing earlier in the workflow asks the operator, records a decision or starts a fix run', () => {
    const actions = actionsInOrder();
    const dry = actions.findIndex((a) => a.step === 'Operator Disposition' && a.text.startsWith('--dry-run'));
    expect(dry).toBeGreaterThan(-1);
    for (const a of actions.slice(0, dry)) {
      expect([a.step, /AskUserQuestion|ledger resolve|FIX_SELECTION/.test(a.text)]).toEqual([a.step, false]);
    }
  });

  test('the reference puts the dry-run step before the first question and forbids question, resolve, fix and push', () => {
    const step = between(GATE_REF, '3. **`--dry-run`.**', '4. **`--foreman`.**');
    expect(step).toContain('then stop with the merge-readiness report');
    for (const phrase of ['no question', 'no `resolve`', 'no fix run', 'no push']) expect([phrase, step.includes(phrase)]).toEqual([phrase, true]);
    expect(GATE_REF.indexOf('3. **`--dry-run`.**')).toBeLessThan(GATE_REF.indexOf('6. **One multi-select question per group**'));
  });

  test.each(Object.entries(SURFACES))('%s: the dry-run text precedes the first multi-select question', (_name, file) => {
    const text = surfaceText(file);
    const dry = text.indexOf('--dry-run: print the numbered list and the gate result');
    expect(dry).toBeGreaterThan(-1);
    expect(dry).toBeLessThan(text.indexOf('multi-select'));
  });
});

describe('collapsed file: groups can be fixed on this PR', () => {
  const nits = Array.from({ length: COLLAPSE_THRESHOLD + 1 }, (_, i) => nitFinding(`N-${i + 1}`));

  test('the real gate collapses same-file Nits into an entry whose id is not a ledger id but whose members are', () => {
    const out = runGate(gateInput({ ledger: nits }));
    const entry = out.dispositionChoices.find((e) => e.collapsed);
    expect(entry.id).toBe('file:packages/development/lib/same.js');
    expect(entry.choices.map((c) => c.id)).toContain('fix-here');
    const ledgerIds = new Set(nits.map((n) => n.id));
    expect(ledgerIds.has(entry.id)).toBe(false);
    expect(entry.members.map((m) => m.id)).toEqual(nits.map((n) => n.id));
    for (const member of entry.members) expect(ledgerIds.has(member.id)).toBe(true);
  });

  test('a fix run refuses an id the ledger lacks, which is why the entry itself cannot be the Fix option', () => {
    expect(flat(readSkillReference('triage-fix-reverify.md'))).toContain('names an `id` not in the ledger');
  });

  test('the command and the reference offer the members for Fix, and expand the entry again before recording a decision', () => {
    expect(interactiveAction()).toMatch(/\(a collapsed file: entry is offered as its members\)/);
    const question = between(GATE_REF, '6. **One multi-select question per group**', '7. **Any Fix on this PR selected:**');
    expect(question).toContain('A collapsed `file:<path>` entry is not a ledger id');
    expect(question).toContain('offer its `members` (each a ledger id) as the options instead of the entry');
    const decide = between(GATE_REF, '8. **Nothing selected for fixing.**', '9. **Re-gate.**');
    expect(decide).toContain('a collapsed `file:<path>` entry expands to its members first');
  });

  test.each(Object.entries(SURFACES))('%s renders it', (_name, file) => {
    expect(surfaceText(file)).toContain('a collapsed file: entry is offered as its members');
  });
});

describe('the merge summary is printed whether or not a confirmation question follows', () => {
  test('the last disposition action prints MERGE_SUMMARY before the Merge step, apart from the confirm-status question that also carries it', () => {
    const actions = dispositionActions();
    const print = actions.find((a) => a.startsWith('Print MERGE_SUMMARY'));
    expect(print).toBeDefined();
    expect(print).toMatch(/before the Merge step/);
    expect(actions.indexOf(print)).toBe(actions.length - 1);
    expect(stepOf('Merge and Report', 'Merge').actions.join(' ')).toContain(`"<MERGE_SUMMARY> ${MERGE_QUESTION}`);
    const step = between(GATE_REF, '10. **Merge summary.**', 'A caller reaches all of this');
    expect(step).toContain('before the Merge step, whether or not a confirmation is asked');
  });
});

describe('follow-on applies to non-blocking findings only', () => {
  test('the real gate offers a blocking finding Fix on this PR or Accept, and a Nit follow-on as well', () => {
    const out = runGate(gateInput({ ledger: [importantFinding('F-1'), nitFinding('N-1', 'packages/development/lib/other.js')] }));
    const byId = Object.fromEntries(out.dispositionChoices.map((e) => [e.id, e.choices.map((c) => c.id)]));
    expect(byId['F-1']).toEqual(['fix-here', 'accept']);
    expect(byId['N-1']).toEqual(['fix-here', 'follow-on', 'accept']);
  });

  test('the command and the reference say so, and so do the docs that describe the step', () => {
    expect(interactiveAction()).toContain('for a non-blocking finding only, follow-on');
    expect(GATE_REF).toContain('A blocking or security finding offers Accept only (it has no follow-on)');
    const docs = {
      'root CHANGELOG': read('CHANGELOG.md').split('\n').find((l) => l.startsWith('- **packages/git:** `/ensemble:pr-merge` 2.4.0')),
      'git CHANGELOG': read('packages', 'git', 'CHANGELOG.md').split('\n').find((l) => l.startsWith('- `/ensemble:pr-merge` 2.4.0')),
      'git README': read('packages', 'git', 'README.md').split('\n').find((l) => l.startsWith('**Review findings (operator disposition):**')),
      'user guide': read('docs', 'guides', 'user-guide.md').split('\n').find((l) => l.startsWith('> **`/ensemble:pr-merge` follows this.**')),
    };
    for (const [name, line] of Object.entries(docs)) {
      expect([name, typeof line]).toEqual([name, 'string']);
      expect([name, /non-blocking/.test(line)]).toEqual([name, true]);
    }
  });
});

describe('the command stays within the word budget without a baseline entry', () => {
  test('pr-merge.yaml is within the command ceiling (it was exactly at it on dev) and is not baselined', () => {
    expect(countWords(SKILL_TEXT)).toBeLessThanOrEqual(CEILINGS.command);
    expect(loadBaseline()).not.toHaveProperty([COMMAND_PATH]);
    expect(loadBaseline()[SKILL_REL]).toBeGreaterThanOrEqual(countWords(SKILL_TEXT));
  });
});

describe('the prose names only what the real gate and its reference provide', () => {
  const yamlText = flat(SKILL_TEXT);

  test('the review-finding blocker codes the command lists are exactly the gate\'s finding blockers', () => {
    const gateFindingCodes = Object.values(BLOCKER_CODES).filter((code) => /finding/.test(code)).sort();
    const named = [...yamlText.matchAll(/\b(open-[a-z-]+-finding|security-finding-open)\b/g)].map((m) => m[1]);
    expect([...new Set(named)].sort()).toEqual(gateFindingCodes);
  });

  test('a real gate returns every field the command and the reference say Operator Disposition reads', () => {
    const out = runGate(gateInput());
    for (const key of ['mergeable', 'blockers', 'dispositionChoices', 'dispositionGroups', 'mergeConfirmation']) {
      expect(out).toHaveProperty(key);
      expect(yamlText + GATE_REF).toContain(key);
    }
    expect(out.mergeConfirmation).toHaveProperty('summary');
    expect(out.mergeConfirmation).toHaveProperty('acceptedBlocking');
    expect(out.mergeConfirmation).toHaveProperty('openBeads');
  });

  test('a list the gate cannot build comes back with dispositionReason and no entries, which the command halts on', () => {
    const out = runGate(gateInput({ ledger: [{ severity: 'important' }] }));
    expect(out.mergeable).toBe(false);
    expect(typeof out.dispositionReason).toBe('string');
    expect(out.dispositionChoices).toEqual([]);
    expect(yamlText).toMatch(/dispositionReason set, or no dispositionChoices array\) HALTs disposition-unavailable/);
  });

  test('every halted_reason the command introduces is described in the procedure it delegates to', () => {
    const introduced = ['disposition-unavailable', 'disposition-incomplete', 'gate-blocked', 'findings-need-operator'];
    for (const reason of introduced) {
      expect([reason, yamlText.includes(reason)]).toEqual([reason, true]);
      expect([reason, GATE_REF.includes(reason)]).toEqual([reason, true]);
    }
  });

  test('the procedure the command points at exists under the name the command gives', () => {
    expect(GATE_REF).toContain('Driving the list from `/ensemble:pr-merge` (Operator Disposition)');
    expect(yamlText).toContain("'Driving the list from /ensemble:pr-merge' in reference/merge-gate.md of the pr-review-cycle skill");
  });
});

describe('AC4: every shipped rendering carries the disposition step, in order, at the command version', () => {
  test.each(Object.entries(SURFACES))('%s: the disposition step precedes the merge question', (_name, file) => {
    const text = surfaceText(file);
    const disposition = text.indexOf('Operator Disposition');
    const question = text.indexOf(MERGE_QUESTION);
    expect(disposition).toBeGreaterThan(-1);
    expect(question).toBeGreaterThan(disposition);
  });

  test('the stubs and the pi skill carry the YAML version (a stale generation would not)', () => {
    for (const [name, file] of [...Object.entries(STUBS), ['pi skill', SURFACES['pi skill']]]) {
      expect([name, read(...file.split('/')).includes(COMMAND.metadata.version)]).toEqual([name, true]);
    }
    expect(SKILL_TEXT).toContain(`version: "${COMMAND.metadata.version}"`);
  });

  test('the Claude command and the pi prompt are stubs that point at the skill and carry no prose of their own', () => {
    for (const [name, file] of Object.entries(STUBS)) {
      const text = read(...file.split('/'));
      expect([name, /ensemble-pr-merge/.test(text)]).toEqual([name, true]);
      expect([name, text.includes('Operator Disposition')]).toEqual([name, false]);
    }
  });

  test('the version was raised past the one before this change (2.3.0)', () => {
    const [major, minor] = COMMAND.metadata.version.split('.').map(Number);
    expect(major * 1000 + minor).toBeGreaterThanOrEqual(2 * 1000 + 4);
  });

  test('the pi renderings call the question tool ask, not AskUserQuestion', () => {
    // The pi prompt is a stub that names no tool. The pi skill is the copy of the skill the Pi
    // skill copier maps AskUserQuestion to ask in, as the command's prompt always was.
    expect(read(...STUBS['pi prompt'].split('/'))).not.toContain('AskUserQuestion');
    const piSkill = surfaceText(SURFACES['pi skill']);
    expect(piSkill).not.toContain('AskUserQuestion');
    expect(piSkill).toMatch(/multi-select ask per group/);
  });
});
