/**
 * pr-merge x local-ci gate integration (TRD-009-TEST)
 *
 * Reads the pr-merge YAML source with js-yaml and the four GENERATED outputs
 * from disk. Structure is asserted (phase order, which refusal conditions
 * exist, preserved constraints equal to their pre-change text); regenerate
 * (npm run generate && generate:pi && generate:codex) after editing the source,
 * this test fails on stale output.
 *
 * This test reads NO git history. Hosted CI checks out with `fetch-depth: 1`, and the local
 * gate clones the head, so an old commit's tree is not there; an earlier version shelled out to
 * `git show <old sha>` and failed on every hosted run. The pre-change file is a committed fixture
 * instead.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SOURCE_REL = 'packages/git/commands/pr-merge.yaml';
const GENERATED_REL = {
  markdown: 'packages/git/commands/ensemble/pr-merge.md',
  piPrompt: 'packages/pi/prompts/ensemble-pr-merge.md',
  piSkill: 'packages/pi/skills/ensemble-pr-merge/SKILL.md',
  codexSkill: 'packages/codex/.codex/skills/commands/ensemble-pr-merge/SKILL.md',
};

const flat = (t) => t.replace(/\s+/g, ' ').trim();
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const FIXTURES = path.join(__dirname, 'fixtures', 'pr-merge');
// pr-merge.yaml exactly as it was BEFORE the local-ci gate changed it (taken from dev at 1d96158, the last commit that
// touched it). The test compares the new source against this to prove safety constraints were preserved.
const PRE_CHANGE_FIXTURE = path.join(FIXTURES, 'pr-merge.before-local-ci.yaml');

const source = yaml.load(read(SOURCE_REL));
const committed = yaml.load(fs.readFileSync(PRE_CHANGE_FIXTURE, 'utf8'));
const generated = Object.fromEntries(Object.entries(GENERATED_REL).map(([k, rel]) => [k, flat(read(rel))]));

const phases = source.workflow.phases;
const phase = (name) => phases.find((p) => p.name === name);
const actionsOf = (p) => p.steps.flatMap((s) => s.actions || []);
const allStrings = () => [
  ...source.constraints,
  ...phases.flatMap((p) => p.steps.flatMap((s) => [...(s.actions || []), s.delegation?.context].filter(Boolean))),
];
// The merge action is identified by the host capability that performs it (TRD-039: no literal `gh pr merge`).
const MERGE_ACTION = /run host\.change-request-merge/;
const isGateRun = (a) => /local-ci-gate/.test(a) && /^Run |^Checks: run /.test(a);
const isSweep = (a) => /local-ci-cli\.js sweep/.test(a);

describe('gate precedes merge', () => {
  test('a gate invocation exists in an earlier phase than the merge phase and before the merge action', () => {
    const mergePhase = phase('Merge and Report');
    const mergeActions = mergePhase.steps.find((s) => s.title === 'Merge').actions;
    const mergeIdx = mergeActions.findIndex((a) => MERGE_ACTION.test(a));
    expect(mergeIdx).toBeGreaterThan(-1);
    const gateInMerge = mergeActions.findIndex(isGateRun);
    expect(gateInMerge).toBeGreaterThan(-1);
    expect(gateInMerge).toBeLessThan(mergeIdx);
    const earlier = phases.filter((p) => p.order < mergePhase.order);
    expect(earlier.some((p) => actionsOf(p).some(isGateRun))).toBe(true);
  });

  test('merge phase calls the gate by name and does not restate gate logic', () => {
    const merge = phase('Merge and Report');
    const text = JSON.stringify(merge);
    expect(text).toMatch(/local-ci-gate/);
    // gate internals live in the skill / lib, never in this command
    expect(JSON.stringify(source)).not.toMatch(/runGate|postStatus|ci:local|npm ci|statuses\/|app token|private key/i);
    expect(fs.existsSync(path.join(REPO_ROOT, 'packages/development/skills/local-ci-gate/SKILL.md'))).toBe(true);
  });

  test.each(Object.keys(GENERATED_REL))('%s output places the gate before the merge step', (key) => {
    const text = read(GENERATED_REL[key]);
    const mergePhaseAt = text.search(/Phase 5: Merge and Report/);
    const mergeCmdAt = text.search(MERGE_ACTION);
    const lastGateBeforeMerge = text.lastIndexOf('local-ci-gate skill', mergeCmdAt);
    expect(mergePhaseAt).toBeGreaterThan(-1);
    expect(lastGateBeforeMerge).toBeGreaterThan(mergePhaseAt);
  });
});

describe('bot review no longer refuses; human review does', () => {
  test('every CHANGES_REQUESTED mention in the source is qualified by human or bot', () => {
    const mentions = allStrings().filter((s) => s.includes('CHANGES_REQUESTED'));
    expect(mentions.length).toBeGreaterThan(0);
    for (const s of mentions) expect(s).toMatch(/human|\bbot\b/i);
  });

  test('refusal constraint names human CHANGES_REQUESTED and the gate states; bot exempt; classified by account type', () => {
    const gateRule = source.constraints.find((c) => /local-ci-gate/.test(c));
    expect(gateRule).toBeDefined();
    const sentences = gateRule.split(/(?<=\.)\s+/);
    const refusal = sentences.find((s) => /^Refuse to merge/.test(s));
    expect(refusal).toMatch(/HUMAN/);
    expect(refusal).toMatch(/CHANGES_REQUESTED/);
    expect(refusal).not.toMatch(/\bbot\b/i);
    const exempt = sentences.find((s) => /\bbot\b/i.test(s) && /CHANGES_REQUESTED/.test(s));
    expect(exempt).toMatch(/NOT a refusal/);
    expect(gateRule).toMatch(/account type/i);
    expect(gateRule).toMatch(/never by account name/i);
  });

  test('the old unconditional refusal is gone', () => {
    const oldRule = committed.constraints.find((c) => /NEVER merge while/.test(c));
    expect(oldRule).toBeDefined();
    expect(source.constraints).not.toContain(oldRule);
    expect(allStrings().join('\n')).not.toMatch(/every required check SUCCESS/);
    expect(allStrings().join('\n')).not.toMatch(/watched to a terminal state/);
  });
});

describe('safety constraints preserved', () => {
  const preserved = (needle) => committed.constraints.find((c) => c.includes(needle));

  test.each([
    ['no-test-weakening', 'NEVER delete, skip, xfail'],
    ['no-force-push / no-bypass', 'NEVER force-push'],
    // The round bound is deliberately reworded by the shared-round-cap change (AC-009-3): a command keeps no
    // private number, the repository policy cap applies and --max-rounds may only lower it. Its safety meaning
    // (bounded, HALT-and-escalate, every open finding listed) is asserted in the dedicated test below.
    ['independent re-verify', 'independently re-verified'],
    ['concurrent dispatch', 'dispatches ALL findings'],
  ])('%s equals its committed text and is present', (_n, needle) => {
    const before = preserved(needle);
    expect(before).toBeDefined();
    // TRD-039 reworded only the state source of the re-verify rule (host-neutral, no `gh`); its meaning is unchanged.
    const expected = _n === 'independent re-verify' ? before.replace('fresh gh state', 'fresh host-adapter state') : before;
    expect(source.constraints).toContain(expected);
  });

  test('max-rounds bound still bounds remediation and escalates (reworded to the shared policy cap, AC-009-3)', () => {
    const bound = source.constraints.find((c) => c.includes('Bound remediation to the repository\'s SHARED round cap'));
    expect(bound).toBeDefined();
    expect(bound).toContain('--max-rounds=N may only LOWER that cap');
    expect(bound).toContain('HALT-and-escalate');
    expect(bound).toContain('every still-open finding');
    // The old private-number wording is gone from the constraints.
    expect(source.constraints.some((c) => /Bound remediation to --max-rounds \(default 5\)/.test(c))).toBe(false);
  });

  test('--dry-run behaviour and parameter unchanged', () => {
    // The Merge step's own dry-run stop. The Operator Disposition step (kata 6k8d) sits before it in the same phase and
    // also names --dry-run (it prints the list and stops before any question), so the first match in the whole phase is
    // no longer this action; the assertion is unchanged for the step the local-ci change touched.
    const dryAction = (src) =>
      src.workflow.phases.find((p) => p.name === 'Merge and Report').steps.find((s) => s.title === 'Merge').actions.find((a) => /--dry-run/.test(a));
    expect(dryAction(source)).toBe(dryAction(committed));
    const param = (src) => src.expectedInput.sections.find((s) => s.name === 'Dry Run');
    expect(param(source)).toEqual(param(committed));
    // --foreman and --method were added after this fixture; the hint must still start with every pre-existing flag.
    expect(source.metadata.argument_hint.startsWith(committed.metadata.argument_hint)).toBe(true);
  });

  test('max-rounds loop actions unchanged', () => {
    const loop = (src) => actionsOf(src.workflow.phases.find((p) => p.name === 'Verification and Round Loop')).filter((a) => /max-rounds/.test(a));
    expect(loop(source).length).toBeGreaterThan(0);
    expect(loop(source)).toEqual(loop(committed));
  });

  test('Pi outputs carry the preserved constraints verbatim', () => {
    for (const c of source.constraints) {
      expect(generated.piPrompt).toContain(flat(c));
      expect(generated.piSkill).toContain(flat(c));
    }
  });
});

describe('sweep runs around the merge', () => {
  test('source: a sweep action before and one after the merge action, in the merge step', () => {
    const actions = phase('Merge and Report').steps.find((s) => s.title === 'Merge').actions;
    const merge = actions.findIndex((a) => MERGE_ACTION.test(a));
    const sweeps = actions.map((a, i) => (isSweep(a) ? i : -1)).filter((i) => i >= 0);
    expect(sweeps.length).toBe(2);
    expect(sweeps[0]).toBeLessThan(merge);
    expect(sweeps[1]).toBeGreaterThan(merge);
    for (const i of sweeps) expect(actions[i]).toMatch(/\bbr\b/);
  });

  test.each(Object.keys(GENERATED_REL))('%s output has sweep before and after the host.change-request-merge action', (key) => {
    const text = read(GENERATED_REL[key]);
    const merge = text.search(MERGE_ACTION);
    const first = text.indexOf('local-ci-cli.js sweep');
    const last = text.lastIndexOf('local-ci-cli.js sweep');
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(merge);
    expect(last).toBeGreaterThan(merge);
  });

  test('source: the post-merge sweep runs before the source branch is deleted (the delete is its own, later action)', () => {
    const actions = phase('Merge and Report').steps.find((s) => s.title === 'Merge').actions;
    const merge = actions.findIndex((a) => MERGE_ACTION.test(a));
    const del = actions.findIndex((a) => /delete the source branch/i.test(a) && !MERGE_ACTION.test(a));
    const sweeps = actions.map((a, i) => (isSweep(a) ? i : -1)).filter((i) => i >= 0);
    expect(del).toBeGreaterThan(-1);
    expect(merge).toBeLessThan(sweeps[1]);
    expect(sweeps[1]).toBeLessThan(del);
  });

  test.each(Object.keys(GENERATED_REL))('%s output deletes the source branch only after the post-merge sweep', (key) => {
    const text = read(GENERATED_REL[key]);
    const del = text.indexOf('delete the source branch unless');
    expect(del).toBeGreaterThan(-1);
    expect(text.lastIndexOf('local-ci-cli.js sweep')).toBeLessThan(del);
  });

  test('the sweep step does not hard-code a repo-relative CLI path (it must work from an installed plugin or the Pi bundle)', () => {
    for (const a of actionsOf(phase('Merge and Report')).filter(isSweep)) {
      expect(a).not.toMatch(/packages\/development\/lib/);
      expect(a).toMatch(/tool-path-resolution/);
    }
  });

  test('the CLI the sweep step names really has a sweep subcommand, so the instruction can be carried out', () => {
    const { HANDLERS } = require('../lib/local-ci-cli');
    expect(Object.keys(HANDLERS)).toContain('sweep');
  });
});

describe('runtimes agree on gate and review rules', () => {
  const ruleActions = () =>
    phases.flatMap((p) => actionsOf(p)).filter((a) => /local-ci-gate|CHANGES_REQUESTED|sweep/.test(a));

  test('every gate/review/sweep action appears in all four generated outputs', () => {
    const rules = ruleActions();
    expect(rules.length).toBeGreaterThanOrEqual(6);
    for (const [name, text] of Object.entries(generated)) {
      for (const a of rules) {
        if (!text.includes(flat(a))) throw new Error(`${name} is missing: ${a}`);
      }
    }
  });

  test('the gate refusal constraint reaches both Pi outputs', () => {
    const rule = flat(source.constraints.find((c) => /local-ci-gate/.test(c)));
    expect(generated.piPrompt).toContain(rule);
    expect(generated.piSkill).toContain(rule);
  });

  test('no output still carries the old refusal', () => {
    for (const text of Object.values(generated)) {
      expect(text).not.toMatch(/every required check SUCCESS/);
      expect(text).not.toMatch(/NEVER merge while any required check/);
    }
  });
});
