'use strict';

/**
 * br-0wx / br-r62: execution was scoped only by a title-substring match, and
 * implement-trd-beads passed `--label <TRD_LABEL>` to beads-build, which never parsed it
 * (and TRD_LABEL was never defined there). A repo with several active epics could get a
 * plan that starved, or mixed in, another TRD's beads.
 *
 * Contract pinned here: beads are created with the TRD slug as a label; beads-build and
 * the wave runner accept --label, pass it to `bv --robot-plan`, verify the plan stays inside
 * the label (bv silently ignores an unknown label), and backfill labels on older TRDs.
 */

const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const itb = read('commands/implement-trd-beads.yaml');
const build = read('commands/beads-build.yaml');
const wave = read('commands/beads-build-wave.yaml');
const waveAgent = read('agents/beads-build-wave.yaml');

describe('implement-trd-beads labels the beads it scaffolds', () => {
  test.each(['epic', 'stories[i]', 'tasks[j]', 'synthesizedTests[k]'])(
    'br create for PLAN.%s passes --labels',
    (entry) => {
      const create = itb
        .split('\n')
        .find((l) => l.includes(`run br create using PLAN.${entry} fields verbatim`));
      expect(create).toBeDefined();
      expect(create).toMatch(new RegExp(`--labels=<PLAN\\.${entry.replace(/[[\]]/g, '\\$&')}\\.labels`));
    }
  );

  test('TRD_LABEL is defined (as the TRD slug), not just used', () => {
    expect(itb).toMatch(/Set TRD_LABEL = TRD_SLUG/);
    expect(itb).toMatch(/NOT the TRD's frontmatter Label/);
  });

  test('execution delegates with --label and backfills beads scaffolded before labels existed', () => {
    expect(itb).toMatch(/beads-build with arguments: .*--label <TRD_LABEL>/);
    // inside a double-quoted YAML string the quotes are stored escaped (\")
    expect(itb).toMatch(/beads-label --label \\?"<TRD_LABEL>\\?" --match \\?"\[trd:<TRD_SLUG>/);
  });
});

describe.each([
  ['beads-build.yaml', build],
  ['beads-build-wave.yaml', wave],
])('%s', (_name, text) => {
  test('advertises and parses --label', () => {
    expect(text).toMatch(/argument_hint: .*--label <label>/);
    expect(text).toMatch(/Parse --label <L> from \$ARGUMENTS/);
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
    expect(build).toMatch(/br list --all --label <LABEL> --json/);
    expect(build).toMatch(/no bead carries label <LABEL>/);
  });

  test('counts scoped work by label when one is set', () => {
    expect(build).toMatch(/br list --status=open --label <LABEL> --json/);
  });

  test('passes LABEL in the wave payload', () => {
    expect(build).toMatch(/wave_payload = \{[^}]*\bLABEL\b[^}]*\}/);
  });
});

describe('beads-build-wave', () => {
  test('scopes the plan with bv --label when LABEL is set', () => {
    expect(wave).toMatch(/bv --robot-plan --label <LABEL> --format toon/);
  });

  test('verifies the plan stays inside the label instead of trusting bv', () => {
    expect(wave).toMatch(/bv returned beads outside label <LABEL>/);
    expect(wave).toMatch(/bv ignores an unknown label/);
  });

  test('carries LABEL in each track scope', () => {
    expect(wave).toMatch(/scope: \{ ROOT_EPIC_ID, EPIC_SLUG, LABEL \(or null\),/);
  });

  test('the runner agent maps the payload LABEL to --label', () => {
    expect(waveAgent).toMatch(/LABEL\s+-> --label/);
  });
});
