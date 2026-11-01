'use strict';

/**
 * br-0wx / br-r62: execution was scoped only by a title-substring match, and
 * implement-trd-beads passed `--label <TRD_LABEL>` to beads-build, which never parsed it
 * (and TRD_LABEL was never defined there). A repo with several active epics could get a
 * plan that starved, or mixed in, another TRD's beads.
 *
 * Contract pinned here: beads are created with the TRD slug as a label; beads-build and
 * the wave runner accept --label and pass it through (scope/LABEL/ROOT_EPIC_ID fields in the
 * track payload), but do NOT pass it as `--arg scope=` to the work-graph.plan/work-graph.ready
 * capability calls: no shipped adapter path (the real beads adapter's run template, nor
 * TRD-027's builtin link-based fallback) honors a scope input, so passing it would be a pure
 * no-op dead argument (PR 7 independent review item 3). Instead, when --label is set, the wave
 * runner scopes the plan itself (Step 3b, via tracker.list).
 *
 * Step 3b FILTERS, it does not refuse. Because no capability path honors a scope input, the
 * plan is repo-wide by construction, and a beads scheduler additionally returns beads that
 * merely neighbour a label member in the dependency graph (its own track reason is "All issues
 * in connected graph"). So an out-of-label bead in the plan is the normal case, and a guard
 * that HALTs on one refuses every labeled wave in any repo with other actionable work. That is
 * what it did: FortiumPartners/ensemble#127, hit on two separate repos, where the plan carried
 * label_scope and an exact label membership and 5 of 8 planned beads still sat outside it.
 *
 * Step 3b therefore HALTs in exactly two cases -- tracker.list unavailable (the scope cannot be
 * verified at all) and no bead carrying the label (an unrecognized label, where dispatching
 * would run the repo-wide plan) -- and otherwise drops the out-of-label ids and dispatches what
 * remains. A plan with nothing left in-label is zero actionable tracks, which Step 7 already
 * reports as blocked; it is not a HALT.
 */

const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const itb = read('commands/implement-trd-beads.yaml');
const build = read('commands/beads-build.yaml');
const wave = read('commands/beads-build-wave.yaml');
const waveAgent = read('agents/beads-build-wave.yaml');

describe('implement-trd-beads labels the beads it scaffolds', () => {
  test('tracker.create has no labels arg; every bead kind gets labeled via the beads-label backfill instead', () => {
    expect(itb).toMatch(/run tracker\.create --arg title=\\?"<title>\\?" --arg type=<type> --arg description=\\?"<description>\\?"/);
    expect(itb).toMatch(/no priority\/labels\/externalRef arg[^)]*labels backfilled later/);
    expect(itb).toMatch(/plan\.epic`, `plan\.stories\[\]`, `plan\.tasks\[\]`, `plan\.synthesizedTests\[\]/);
  });

  test('TRD_LABEL is defined (as the TRD slug), not just used', () => {
    expect(itb).toMatch(/TRD_LABEL = TRD_SLUG/);
  });

  test('execution delegates with --label and backfills beads scaffolded before labels existed', () => {
    expect(itb).toMatch(/beads-build <ROOT_EPIC_ID>.*--label <TRD_LABEL>/);
    // inside a double-quoted YAML string the quotes are stored escaped (\")
    expect(itb).toMatch(/beads-label --label \\?"<TRD_LABEL>\\?" --match \\?"\[trd:<TRD_SLUG>/);
  });
});

describe('beads-build.yaml', () => {
  test('advertises and parses --label', () => {
    expect(build).toMatch(/argument_hint: .*--label <label>/);
    expect(build).toMatch(/Parse --label <L> from \$ARGUMENTS/);
  });
});

describe('beads-build', () => {
  test('resolves LABEL from the root epic when --label is absent', () => {
    expect(build).toMatch(/exactly one entry, set LABEL to it/);
  });

  test('backfills labels through trd-cli before relying on them', () => {
    expect(build).toMatch(/beads-label --label "<LABEL>" --match "\[trd:<slug>"/);
  });

  test('refuses to continue when no bead carries the label', () => {
    expect(build).toMatch(/run tracker\.list.*LABEL_IDS = \.id of entries/);
    expect(build).toMatch(/no bead carries label <LABEL>/);
  });

  test('counts scoped work by label when one is set', () => {
    expect(build).toMatch(/REMAINING_SCOPED_COUNT = count of status=="open" entries filtered by LABEL when set/);
  });

  test('passes LABEL in the wave payload', () => {
    expect(build).toMatch(/wave_payload = \{[^}]*\bLABEL\b[^}]*\}/);
  });
});

describe('beads-build-wave', () => {
  test('does not pass --arg scope= to work-graph.plan: no adapter path honors it, so it would be a dead no-op argument (PR 7 item 3)', () => {
    expect(wave).not.toMatch(/run work-graph\.plan --run-id "\$RUN_ID" --arg scope=/);
  });

  test('drops out-of-label beads from the tracks instead of refusing the whole plan', () => {
    expect(wave).toMatch(/DROP every ID not in LABEL_IDS from every track/);
    expect(wave).toMatch(/drop any emptied track/);
    expect(wave).toMatch(/dispatch what survives/);
  });

  test('says an out-of-label bead is expected, so nobody reinstates the blanket refusal', () => {
    expect(wave).toMatch(/out-of-label beads are EXPECTED \(the plan is repo-wide, Step 2\), never a HALT/);
    // The refusal this replaced (#127). It must not come back under either wording.
    expect(wave).not.toMatch(/the scheduling source returned beads outside label/);
    expect(wave).not.toMatch(/bv returned beads outside label/);
    // Nor as the condition that produced it.
    expect(wave).not.toMatch(/any bead ID in the tracks is not in LABEL_IDS/);
  });

  test('HALTs when the scope cannot be verified at all', () => {
    expect(wave).toMatch(/tracker\.list unavailable: <error\.message>\); refusing to dispatch without scope verification/);
  });

  test('HALTs when no bead carries the label, because then the plan really is unscoped', () => {
    expect(wave).toMatch(/If LABEL_IDS is empty: print "ERROR: no bead carries label <LABEL>\. Refusing to dispatch\."/);
  });

  test('an emptied plan routes to Step 7 rather than HALTing', () => {
    expect(wave).toMatch(/No survivor -> Step 7/);
  });

  test('logs what it dropped, so a short wave is explainable without a rerun', () => {
    expect(wave).toMatch(/log dropped IDs/);
  });

  /**
   * The filter runs BEFORE the MAX_PARALLEL cut, and the order is the whole point.
   * The plan is repo-wide, so cutting to MAX_PARALLEL first can leave only out-of-label
   * tracks; the filter then empties them and the wave reports blocked while in-label beads
   * were ready in the tracks that the cut discarded. That turns the #127 over-refusal into
   * a false blocked, which beads-build.yaml escalates as "EXECUTION BLOCKED".
   */
  test('filters first and truncates second, in Step 3b', () => {
    expect(wave).toMatch(/THEN truncate to MAX_PARALLEL and dispatch what survives/);
    // Step 3 must not cut the plan before Step 3b has seen it.
    expect(wave).not.toMatch(/to extract the tracks \(up to MAX_PARALLEL\)/);
    // Step 2's pointer has to name the step that now owns the cut, or the spec contradicts itself.
    expect(wave).toMatch(/MAX_PARALLEL truncation happens after Step 3b''s filter, or in Step 3 when LABEL is unset/);
  });

  /**
   * Step 3b is headed "only when LABEL is set", so moving the cut there left an unlabeled
   * wave with no cap at all: every track in the repo-wide plan dispatched concurrently
   * against a --max-parallel default of 3. Step 3 keeps the cut for that path, and only
   * for that path, so the two cannot both truncate the same plan.
   */
  test('an unlabeled wave still truncates, in Step 3', () => {
    expect(wave).toMatch(/When LABEL is unset, truncate to MAX_PARALLEL here/);
  });

  test('carries LABEL in each track scope', () => {
    expect(wave).toMatch(/scope: \{ ROOT_EPIC_ID, EPIC_SLUG, LABEL \(or null\),/);
  });

  test('does not pass --arg scope= to work-graph.ready either, for the same reason', () => {
    expect(wave).not.toMatch(/run work-graph\.ready --run-id "\$RUN_ID" --arg scope=/);
  });

  test('the runner agent maps the payload LABEL to --label', () => {
    expect(waveAgent).toMatch(/LABEL\s+-> --label/);
  });
});
