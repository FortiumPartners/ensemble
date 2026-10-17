/**
 * `--foreman` handling in the /ensemble:feature front door (TRD-2026-1d3e0dd6, REQ-008).
 *
 * The flag is removed before validation (so the existing validation sentences, which
 * the existing suites pin, keep reading correctly) and inserted into the invocation
 * after it is constructed. Read-only: no file writes, no generators.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { checkFrontDoor, flat, step } = require('./helpers/foreman-invariants');

const REPO_ROOT = path.join(__dirname, '../../..');
const load = () => yaml.load(fs.readFileSync(path.join(__dirname, '../commands/feature.yaml'), 'utf-8'));
const clone = (doc) => JSON.parse(JSON.stringify(doc));

describe('feature front door --foreman', () => {
  let doc;
  beforeAll(() => {
    doc = load();
  });

  test('extraction: a leading --foreman is removed immediately after the keyword, before validation', () => {
    expect(checkFrontDoor(doc).extraction).toEqual([]);
  });

  test('insertion: --foreman goes right after /ensemble:new-feature, after the invocation is built and before it runs', () => {
    expect(checkFrontDoor(doc).insertion).toEqual([]);
  });

  test('--foreman anywhere else is ordinary text', () => {
    expect(checkFrontDoor(doc).ordinaryText).toEqual([]);
  });

  test('the dispatcher still lists exactly the four keywords and still forwards to new-feature', () => {
    const keywords = doc.dispatch.subcommands.map((s) => s.keyword);
    expect(keywords).toEqual(['new', 'resume', 'status', 'abandon']);
    expect(new Set(doc.dispatch.subcommands.map((s) => s.ref))).toEqual(new Set(['new-feature']));
  });

  describe('the checks can fail (TRD-011-TEST)', () => {
    test('control: the unmodified clone has no violations', () => {
      expect(flat(checkFrontDoor(clone(doc)))).toBe(0);
    });

    test('moving extraction after validation is caught', () => {
      const m = clone(doc);
      const s = step(m, 'Dispatch', 1);
      const i = s.actions.findIndex((a) => /--foreman/.test(a) && /remov/i.test(a));
      const [a] = s.actions.splice(i, 1);
      s.actions.splice(s.actions.length - 1, 0, a);
      expect(checkFrontDoor(m).extraction.length).toBeGreaterThan(0);
    });

    test('recognizing the flag anywhere (not only right after the keyword) is caught', () => {
      const m = clone(doc);
      const s = step(m, 'Dispatch', 1);
      s.actions = s.actions.map((a) => a.split('immediately after the keyword').join('anywhere in the arguments'));
      expect(checkFrontDoor(m).extraction.length).toBeGreaterThan(0);
    });

    test('dropping the insertion action is caught', () => {
      const m = clone(doc);
      const s = step(m, 'Dispatch', 1);
      s.actions = s.actions.filter((a) => !(/--foreman/.test(a) && /insert/i.test(a)));
      expect(checkFrontDoor(m).insertion.length).toBeGreaterThan(0);
    });

    test('inserting before the invocation is built is caught', () => {
      const m = clone(doc);
      const s = step(m, 'Dispatch', 1);
      const i = s.actions.findIndex((a) => /--foreman/.test(a) && /insert/i.test(a));
      const [a] = s.actions.splice(i, 1);
      s.actions.splice(1, 0, a);
      expect(checkFrontDoor(m).insertion.length).toBeGreaterThan(0);
    });

    test('dropping the ordinary-text rule is caught', () => {
      const m = clone(doc);
      const s = step(m, 'Dispatch', 1);
      s.actions = s.actions.map((a) => a.split('ordinary text').join('flag text'));
      expect(checkFrontDoor(m).ordinaryText.length).toBeGreaterThan(0);
    });
  });

  describe('generated artifacts carry the behavior (REQ-010, read-only)', () => {
    test.each([
      'packages/development/commands/ensemble/feature.md',
      'packages/pi/prompts/ensemble-feature.md',
      'packages/codex/.codex/skills/commands/ensemble-feature/SKILL.md',
    ])('%s describes the leading --foreman handling', (rel) => {
      const text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf-8');
      expect(text).toMatch(/--foreman/);
      expect(text).toMatch(/immediately after the keyword/);
    });
  });
});
