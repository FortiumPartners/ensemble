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
 * runner verifies the plan stayed inside the label itself (Step 3b, via tracker.list), HALTing
 * rather than trusting an unscoped or unknown-label scheduling result.
 */

const fs = require('fs');
const path = require('path');

const { readDevelopmentSkill } = require('./helpers/skill-workflow');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
// beads-build and implement-trd-beads are skill-backed: the prompt is the skill (SKILL.md +
// references/); the manifest YAML keeps only metadata such as argument_hint.
const itb = readDevelopmentSkill('ensemble-implement-trd-beads').prompt;
const build = readDevelopmentSkill('ensemble-beads-build').prompt;
const buildManifest = read('commands/beads-build.yaml');
const wave = readDevelopmentSkill('ensemble-beads-build-wave').prompt;
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
    expect(buildManifest).toMatch(/argument_hint: .*--label <label>/);
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

  test('verifies the plan stays inside the label instead of trusting the scheduling source', () => {
    expect(wave).toMatch(/the scheduling source returned beads outside label <LABEL>/);
    expect(wave).toMatch(/an unrecognized label can return the unscoped plan/);
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
