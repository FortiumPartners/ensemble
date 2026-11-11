/**
 * `--foreman` behavior of new-feature.yaml (TRD-2026-1d3e0dd6, REQ-001..REQ-011).
 *
 * The checks live in helpers/foreman-invariants.js as pure functions over a parsed
 * document, so this file can (1) assert they hold for the real command and (2) prove
 * they can fail by running them on deliberately broken clones. Read-only: nothing
 * here writes a file or runs a generator.
 */

const fs = require('fs');
const path = require('path');
const { checkNewFeature, flat, step, actions, FOREMAN_RE, STAGE_SKILLS } = require('./helpers/foreman-invariants');
const { readNewFeature } = require('./helpers/new-feature-skill');

const REPO_ROOT = path.join(__dirname, '../../..');
// new-feature is skill-backed: the document the checks run over is rebuilt from its skill
// (SKILL.md + references/), in the shape its YAML had before the prompt moved there.
const load = () => readNewFeature();
const clone = (doc) => JSON.parse(JSON.stringify(doc));

describe('new-feature --foreman', () => {
  let doc;
  let result;
  beforeAll(() => {
    doc = load();
    result = checkNewFeature(doc);
  });

  test.each([
    ['parameter', 'REQ-001: boolean `foreman` parameter, default false'],
    ['flagRule', 'REQ-001: FOREMAN is defined once, supported, and not a --skip-refine equivalent'],
    ['forwarding', 'REQ-002: --foreman is forwarded to every stage skill, only under FOREMAN'],
    ['autoAccept', 'REQ-002: stage output is accepted without a prompt'],
    ['retry', 'REQ-003: a failed stage is retried once without asking, and never in a loop'],
    ['implApproval', 'REQ-004: implementation approval auto-grants in one recorded mutate()'],
    ['prApproval', 'REQ-005: PR approval auto-grants separately; the store precondition is untouched'],
    ['abandon', 'REQ-006: abandon needs no confirmation under FOREMAN'],
    ['event', 'REQ-007: an event payload is never auto-approved'],
    ['invariants', 'REQ-009: exclusivity, read-only --status and no-retry rules are untouched'],
    ['guard', 'REQ-009/011: every step that asks a human has a foreman branch'],
  ])('%s -- %s', (group) => {
    expect(result[group]).toEqual([]);
  });

  test('the interactive path is additive: no question point loses its human branch', () => {
    // Existing suites pin the original sentences; this asserts the structural side: each
    // question point keeps at least one action that asks and does not mention FOREMAN.
    const points = [
      ['Entry Point Resolution', 4],
      ['Entry Point Resolution', 6],
      ['Execute Stage', 5],
      ['Execute Stage', 6],
    ];
    for (const [phase, order] of points) {
      const asks = actions(step(doc, phase, order)).filter(
        (a) => /AskUserQuestion|ask(?:s|ed)? the user|explicit (?:approval|confirmation)|opt/i.test(a) && !FOREMAN_RE.test(a),
      );
      expect({ phase, order, humanBranches: asks.length > 0 }).toEqual({ phase, order, humanBranches: true });
    }
  });

  describe('the checks can fail (TRD-011-TEST)', () => {
    test('control: the unmodified clone has no violations', () => {
      expect(flat(checkNewFeature(clone(doc)))).toBe(0);
    });

    test('removing the parameter fails', () => {
      const m = clone(doc);
      m.parameters = m.parameters.filter((p) => p.name !== 'foreman');
      expect(checkNewFeature(m).parameter.length).toBeGreaterThan(0);
    });

    test.each(STAGE_SKILLS)('dropping the forward to %s fails and names it', (skill) => {
      const m = clone(doc);
      const s = step(m, 'Execute Stage', 1);
      s.actions = s.actions.map((a) => (FOREMAN_RE.test(a) ? a.split(skill).join('') : a));
      const violations = checkNewFeature(m).forwarding;
      expect(violations.some((x) => x.includes(skill))).toBe(true);
    });

    test.each(STAGE_SKILLS)('dropping only the --foreman flag from the %s forward fails and names only it', (skill) => {
      const m = clone(doc);
      const s = step(m, 'Execute Stage', 1);
      s.actions = s.actions.map((a) =>
        FOREMAN_RE.test(a) ? a.replace(new RegExp(`(${skill}(?: --plan)?) --foreman`), '$1') : a,
      );
      const violations = checkNewFeature(m).forwarding;
      expect(violations.some((x) => x.includes(skill))).toBe(true);
      for (const other of STAGE_SKILLS.filter((o) => o !== skill)) {
        expect(violations.some((x) => x.includes(other))).toBe(false);
      }
    });

    test('removing every foreman action from a question step trips the guard', () => {
      const m = clone(doc);
      const s = step(m, 'Execute Stage', 6);
      s.actions = s.actions.filter((a) => !FOREMAN_RE.test(a));
      expect(checkNewFeature(m).guard.length).toBeGreaterThan(0);
    });

    test('a new unguarded question anywhere trips the guard', () => {
      const m = clone(doc);
      step(m, 'Entry Point Resolution', 2).actions.push('Ask the user which repository to use via AskUserQuestion.');
      const guard = checkNewFeature(m).guard;
      expect(guard.some((x) => x.includes('Entry Point Resolution') && x.includes('step 2'))).toBe(true);
    });

    test('letting FOREMAN weaken the failure step is caught', () => {
      const m = clone(doc);
      step(m, 'Execute Stage', 3).actions.push('When FOREMAN is true, retry the stage again in the same invocation.');
      expect(checkNewFeature(m).retry.length).toBeGreaterThan(0);
    });

    test('letting FOREMAN touch the PR-creation precondition is caught', () => {
      const m = clone(doc);
      step(m, 'Execute Stage', 7).actions.push('When FOREMAN is true, skip reading prApprovedAt.');
      expect(checkNewFeature(m).prApproval.length).toBeGreaterThan(0);
    });

    test('auto-approving an event payload before validation is caught', () => {
      const m = clone(doc);
      const s = step(m, 'Entry Point Resolution', 5);
      const i = s.actions.findIndex((a) => FOREMAN_RE.test(a) && /human/i.test(a));
      const [refusal] = s.actions.splice(i, 1);
      s.actions.splice(1, 0, refusal); // before validateEventPayload
      expect(checkNewFeature(m).event.length).toBeGreaterThan(0);
    });

    test('putting FOREMAN into the exclusivity steps is caught', () => {
      const m = clone(doc);
      step(m, 'Entry Point Resolution', 2).actions.push('When FOREMAN is true, ignore RUN_ALREADY_ACTIVE.');
      expect(checkNewFeature(m).invariants.length).toBeGreaterThan(0);
    });
  });

  describe('generated artifacts carry the behavior (REQ-010, read-only)', () => {
    const assertForwards = (text) => {
      expect(text).toMatch(/--foreman/);
      for (const skill of STAGE_SKILLS) {
        // some line mentions this skill and --foreman together
        expect(text.split('\n').some((l) => l.includes(skill) && l.includes('--foreman'))).toBe(true);
      }
      expect(text).toMatch(/granted by --foreman policy/);
    };

    // The Claude Code command and the Pi prompt are thin entry points that load the skill;
    // the behavior lives in the skill they name, which is what they must point at.
    test.each([
      'packages/development/commands/ensemble/new-feature.md',
      'packages/pi/prompts/ensemble-new-feature.md',
    ])('%s is an entry point to the skill that forwards --foreman to every stage skill', (rel) => {
      const text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf-8');
      expect(text).toContain('ensemble-new-feature');
      assertForwards(doc.prompt);
    });

    // The Codex skill is a copy of the skill: its SKILL.md and the files of references/.
    test('the codex skill (SKILL.md and references/) forwards --foreman to every stage skill', () => {
      const dir = path.join(REPO_ROOT, 'packages/codex/.codex/skills/commands/ensemble-new-feature');
      const referencesDir = path.join(dir, 'references');
      const references = fs.existsSync(referencesDir)
        ? fs.readdirSync(referencesDir).sort().map((name) => fs.readFileSync(path.join(referencesDir, name), 'utf-8'))
        : [];
      assertForwards([fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf-8'), ...references].join('\n'));
    });
  });
});
