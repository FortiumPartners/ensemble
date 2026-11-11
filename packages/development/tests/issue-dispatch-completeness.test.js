/**
 * TRD-017-TEST: Issue dispatch completeness (REQ-003, REQ-019).
 *
 * Verifies TRD-017: the `ensemble-issue` skill's `## Subcommands` section
 * (packages/development/skills/ensemble-issue/SKILL.md, the source of truth for the
 * skill-backed `issue` command) declares `resume`/`status`/`abandon` alongside
 * `fix`/`list`, and that the no-arg/unrecognized-action fallback (shared
 * invariant audited product-wide by TRD-006/TRD-006-TEST) still lists all
 * five keywords.
 */

const path = require('path');
const { readSkill } = require('../../product/tests/helpers/skill-prompt');
const { parseSubcommands, dispatchActions } = require('../../product/tests/helpers/skill-subcommands');

const PACKAGE_DIR = path.join(__dirname, '..');

describe('Issue dispatch completeness (TRD-017)', () => {
  let subcommands;
  let actions;
  let actionsText;

  beforeAll(() => {
    const skill = readSkill('ensemble-issue', PACKAGE_DIR);
    subcommands = parseSubcommands(skill);
    actions = dispatchActions(skill);
    actionsText = actions.join('\n');
  });

  describe('the Subcommands section declares all five keywords', () => {
    test('fix/list/resume/status/abandon are present', () => {
      expect(subcommands.map((s) => s.keyword)).toEqual(['fix', 'list', 'resume', 'status', 'abandon']);
    });

    test('resume/status/abandon each reference the fix-issue sibling command', () => {
      const byKeyword = Object.fromEntries(subcommands.map((s) => [s.keyword, s]));
      for (const keyword of ['resume', 'status', 'abandon']) {
        expect(byKeyword[keyword].ref).toBe('fix-issue');
        expect(byKeyword[keyword].skillPath).toBe('../ensemble-fix-issue/SKILL.md');
      }
    });

    test('fix still references fix-issue and list still references list-issue (unchanged)', () => {
      const byKeyword = Object.fromEntries(subcommands.map((s) => [s.keyword, s]));
      expect(byKeyword.fix.ref).toBe('fix-issue');
      expect(byKeyword.fix.skillPath).toBe('../ensemble-fix-issue/SKILL.md');
      expect(byKeyword.list.ref).toBe('list-issue');
      expect(byKeyword.list.skillPath).toBe('../ensemble-list-issue/SKILL.md');
    });
  });

  describe('Dispatch step constructs the correct fix-issue invocation per new keyword', () => {
    test('resume forwards the bare no-flags invocation', () => {
      expect(actionsText).toContain(
        'keyword `resume` with no remaining text: construct the bare invocation `/ensemble:fix-issue` with no flags',
      );
    });

    test('status forwards the --status invocation', () => {
      expect(actionsText).toContain(
        'keyword `status` with no remaining text: construct the invocation `/ensemble:fix-issue --status`',
      );
    });

    test('abandon forwards the --abandon invocation with optional reason', () => {
      expect(actionsText).toContain(
        'keyword `abandon`: the remaining text, if any, is an optional reason -- construct the invocation `/ensemble:fix-issue --abandon <remaining text>`',
      );
    });
  });

  describe('Test AC: no/unrecognized action lists all five actions', () => {
    test('Given ensemble-issue with no or an unrecognized action, the fallback prints fix/list/resume/status/abandon and HALTs with no side effects', () => {
      expect(actionsText).toMatch(
        /If the first token matches no keyword, or \$ARGUMENTS is empty: print the keyword table below \(keyword \+ one-line description\) and HALT without side effects\./,
      );
      // The keyword table referenced by that fallback is the Subcommands section
      // itself -- this asserts the list it prints is complete.
      expect(subcommands.map((s) => s.keyword)).toEqual(['fix', 'list', 'resume', 'status', 'abandon']);
    });

    test('the matched-keyword fallback path (fix/list) still performs no table-printing side effect of its own', () => {
      expect(actionsText).toContain(
        "If the first token matches a keyword below: read and follow that subcommand's own sibling skill (its path is in the Subcommands section above), passing the remaining argument text through unmodified. Do not re-implement its phases here.",
      );
    });
  });
});
