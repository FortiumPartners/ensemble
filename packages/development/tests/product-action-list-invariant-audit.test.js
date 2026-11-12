/**
 * Audit-proof test for TRD-006 / TRD-006-TEST (REQ-003).
 *
 * A prior wave audited every product-wide dispatcher command and found
 * prd, trd, issue and the other dispatchers' Dispatch step 1 already comply
 * with the shared no-arg/unrecognized-action invariant -- no source fix was
 * needed. (feature's own compliance with this same invariant is proven
 * separately by feature-command.test.js, TRD-002/TRD-002-TEST.)
 *
 * This file is that audit's own dedicated proof: it asserts, against the
 * real skill prose each dispatcher is backed by (its SKILL.md, the source of
 * truth), that every product-wide dispatcher prints the keyword table and
 * HALTs with no side effect on both a no-arg and an unrecognized first token.
 */

const path = require('path');
const { readSkill } = require('../../product/tests/helpers/skill-prompt');
const { dispatchActions } = require('../../product/tests/helpers/skill-subcommands');

const PACKAGES_DIR = path.join(__dirname, '..', '..');

const COMMANDS = [
  { name: 'ensemble-prd', pkg: 'product' },
  { name: 'ensemble-trd', pkg: 'development' },
  { name: 'ensemble-issue', pkg: 'development' },
  { name: 'ensemble-reqnroll', pkg: 'product' },
  { name: 'ensemble-standards', pkg: 'core' },
];

describe('Product-wide action-list invariant audit (TRD-006)', () => {
  describe.each(COMMANDS)('$name', ({ name, pkg }) => {
    let text;

    beforeAll(() => {
      text = dispatchActions(readSkill(name, path.join(PACKAGES_DIR, pkg))).join('\n');
    });

    test('no-arg prints the keyword table and halts with no side effect', () => {
      expect(text).toMatch(
        /If the first token matches no keyword, or \$ARGUMENTS is empty: print the keyword table below \(keyword \+ one-line description\) and HALT without side effects\./,
      );
    });

    test('unrecognized action prints the keyword table and halts with no side effect', () => {
      // Same sentence covers both branches -- "matches no keyword" is the
      // unrecognized-action case, "or $ARGUMENTS is empty" the no-arg case,
      // both resolving to the identical print-table-and-HALT action.
      expect(text).toMatch(/matches no keyword.*print the keyword table below.*HALT without side effects/s);
    });

    test('the matched-keyword path performs no fallback/table-printing side effect of its own', () => {
      expect(text).toContain(
        "If the first token matches a keyword below: read and follow that subcommand's own sibling skill (its path is in the Subcommands section above), passing the remaining argument text through unmodified. Do not re-implement its phases here.",
      );
    });
  });
});
