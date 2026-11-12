'use strict';
/**
 * Regression test for PR7 br-96hk (TRD-030): `packages/development/commands/beads-build.yaml`
 * and the skill `packages/development/skills/implement-trd-beads-reference/SKILL.md` must never
 * regain a literal `br `/`bv ` tracker-binary invocation or `--robot-` flag -- all tracker/
 * scheduling access now goes through `toolchain-cli run tracker.*`/`work-graph.*`. This mirrors
 * the exact AC-1 grep (`grep -noE '\bbr\b|\bbv\b|--robot-[a-z]+' <file>`) as a Jest assertion,
 * plus a broader `\b(br|bv) ` invocation sweep (same convention as the TRD-028/TRD-029 sibling
 * tests), so CI catches a regression, not just a manual grep run at review time.
 *
 * Previously documented exception, now FIXED (PR 8 independent review item 1): SKILL.md
 * section 5's `--reset-task` recovery step used to keep a single literal `br update <id>
 * --status=open` because `tracker.update`'s one `fields` input mapped only to `--notes`, with
 * no status-set operation to call instead. The new `tracker.set-status` capability (manifest
 * `variants`, PR 8 finding 1) now covers this, so SKILL.md carries zero `br`/`bv` tokens.
 *
 * It also asserts AC-3 (the `capabilities` block passes the real schema validator --
 * `validateCommandSchema`, the exact function `generate-markdown.js --validate` runs, plus
 * `validateCapabilityIds`, the exact function `scripts/validate-all.js`'s `main()` runs -- not a
 * hand-rolled string/regex check) and AC-4 (the Preflight phase's capability preamble lists
 * exactly `metadata.capabilities.required`, and the Execute phase's `confirm-status` call
 * precedes the wave loop's first actual capability write).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { readCommandProse } = require('../lib/skill-backed-command');
const { readDevelopmentSkill, parseWorkflow } = require('../../packages/development/tests/helpers/skill-workflow');
const { validateCommandSchema } = require('../lib/schema-validator');
const { loadValidCapabilityIds, checkCapabilityIds } = require('../lib/capability-ids-check');
const { validateCapabilityIds } = require('../validate-all');

const REPO_ROOT = path.join(__dirname, '..', '..');
const COMMAND_PATH = path.join(REPO_ROOT, 'packages', 'development', 'commands', 'beads-build.yaml');
const SKILL_PATH = path.join(
  REPO_ROOT,
  'packages',
  'development',
  'skills',
  'implement-trd-beads-reference',
  'SKILL.md'
);

// beads-build is a skill-backed command: the YAML is a manifest (metadata + `skill`) and the
// prompt lives in its skill (SKILL.md + references/*.md). PROSE is what these checks scan:
// the manifest plus the whole skill. PHASES reads the skill's workflow back as
// `[{order, name, steps: [{title, actions, order}]}]`.
const MANIFEST_TEXT = fs.readFileSync(COMMAND_PATH, 'utf8');
const MANIFEST = yaml.load(MANIFEST_TEXT);
const PROSE = readCommandProse(COMMAND_PATH, MANIFEST, MANIFEST_TEXT);
const PHASES = parseWorkflow(readDevelopmentSkill(MANIFEST.skill)).map((phase) => ({
  ...phase,
  steps: phase.steps.map((step, index) => ({ ...step, order: index + 1 })),
}));

// Same pattern as the AC-1 grep: a bare `br` or `bv` word followed by a space -- i.e. an
// invocation like `br list` or `bv --robot-plan`, not incidental prose like `br/bv`.
const TRACKER_BINARY_INVOCATION = /\b(?:br|bv) /;

// The literal AC-1 grep pattern (`\bbr\b|\bbv\b|--robot-[a-z]+`), translated to a JS RegExp.
const AC1_PATTERN = /\bbr\b|\bbv\b|--robot-[a-z]+/;

function findMatchLines(contents, pattern) {
  return contents
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => pattern.test(line));
}

describe('PR7 Track030: no literal br/bv tracker-binary invocation in beads-build.yaml or its reference skill', () => {
  test('beads-build.yaml contains zero br/bv invocations (broad sweep)', () => {
    const contents = PROSE;
    expect(findMatchLines(contents, TRACKER_BINARY_INVOCATION)).toEqual([]);
  });

  test('beads-build.yaml contains zero matches for the literal AC-1 grep pattern', () => {
    const contents = PROSE;
    expect(findMatchLines(contents, AC1_PATTERN)).toEqual([]);
  });

  test('SKILL.md contains zero br/bv tokens (the documented tracker.update gap is FIXED by tracker.set-status, PR 8 independent review item 1)', () => {
    const contents = fs.readFileSync(SKILL_PATH, 'utf8');
    const hits = findMatchLines(contents, AC1_PATTERN);
    expect(hits).toEqual([]);
  });

  test('mutation proof: reintroducing a literal br/bv invocation into the beads-build prose is caught', () => {
    const original = PROSE;

    // Sanity: the unmutated prose has no invocations (proves the detector isn't vacuously
    // true before we assert it catches the reintroduced one).
    expect(findMatchLines(original, TRACKER_BINARY_INVOCATION)).toEqual([]);
    expect(findMatchLines(original, AC1_PATTERN)).toEqual([]);

    const needle = 'node "$TOOLCHAIN_CLI" run tracker.sync';
    expect(original).toContain(needle);
    const mutated = original.replace(needle, 'br sync --flush-only');
    expect(mutated).not.toBe(original);

    const hitsBroad = findMatchLines(mutated, TRACKER_BINARY_INVOCATION);
    const hitsAc1 = findMatchLines(mutated, AC1_PATTERN);
    expect(hitsBroad.length).toBeGreaterThan(0);
    expect(hitsAc1.length).toBeGreaterThan(0);
    expect(hitsBroad[0].line).toContain('br sync --flush-only');

    // Confirm again against the real, unmutated prose: still zero.
    expect(findMatchLines(PROSE, TRACKER_BINARY_INVOCATION)).toEqual([]);
    expect(findMatchLines(PROSE, AC1_PATTERN)).toEqual([]);
  });

  test('beads-build.yaml declares the exact TRD-030 capabilities block', () => {
    const contents = fs.readFileSync(COMMAND_PATH, 'utf8');
    const required = ['tracker.show', 'tracker.list', 'tracker.sync', 'tracker.comment', 'tracker.close', 'work-graph.ready'];
    for (const id of required) {
      expect(contents).toContain(`      - ${id}\n`);
    }
    expect(contents).toMatch(/optional:\s*\n\s*- work-graph\.plan/);
  });

  test('Plan Mode path prints the ordering source from data.orderingSource (AC-2)', () => {
    const contents = PROSE;
    expect(contents).toContain('ORDERING_SOURCE=data.orderingSource');
    expect(contents).toContain('ordering source: <ORDERING_SOURCE>');
  });

  test('beads-build.yaml capabilities block passes real schema and capability-id validation (AC-3)', () => {
    // Real production validators, not a hand-rolled check: validateCommandSchema is the exact
    // function generate-markdown.js --validate (npm run generate:validate) runs against every
    // command YAML (AJV against schemas/command-yaml-schema.json, whose own description says
    // capability ids are "cross-referenced against packages/development/toolchain/categories/
    // *.yaml by scripts/validate-all.js"); validateCapabilityIds is the exact function
    // scripts/validate-all.js's main() calls (node scripts/validate-all.js / npm run validate)
    // to perform that cross-reference.
    const data = yaml.load(fs.readFileSync(COMMAND_PATH, 'utf8'));
    expect(() => validateCommandSchema(data, COMMAND_PATH)).not.toThrow();

    const failures = validateCapabilityIds().filter((message) => message.includes('beads-build.yaml'));
    expect(failures).toEqual([]);
  });

  test('mutation proof: an unknown capability id reintroduced in a /tmp copy of beads-build.yaml is caught by the real capability-id validator', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'track030-capability-mutation-'));
    try {
      const copyPath = path.join(tmpDir, 'beads-build.yaml');
      const original = fs.readFileSync(COMMAND_PATH, 'utf8');
      fs.writeFileSync(copyPath, original, 'utf8');

      const categoriesDir = path.join(REPO_ROOT, 'packages', 'development', 'toolchain', 'categories');
      const validIds = loadValidCapabilityIds(categoriesDir);

      // Sanity: the unmutated copy has zero capability-id failures (proves the detector isn't
      // vacuously true before we assert it catches the reintroduced one).
      const unmutatedData = yaml.load(fs.readFileSync(copyPath, 'utf8'));
      expect(checkCapabilityIds(unmutatedData, copyPath, validIds)).toEqual([]);

      const needle = '      - tracker.show\n';
      expect(original).toContain(needle);
      const mutated = original.replace(needle, `${needle}      - tracker.frobnicate\n`);
      expect(mutated).not.toBe(original);
      fs.writeFileSync(copyPath, mutated, 'utf8');

      const mutatedData = yaml.load(fs.readFileSync(copyPath, 'utf8'));
      const failures = checkCapabilityIds(mutatedData, copyPath, validIds);
      expect(failures.length).toBeGreaterThan(0);
      expect(failures[0]).toContain("unknown capability id 'tracker.frobnicate'");

      // Confirm again against the real, unmutated source: still zero.
      const realData = yaml.load(fs.readFileSync(COMMAND_PATH, 'utf8'));
      expect(checkCapabilityIds(realData, COMMAND_PATH, validIds)).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('beads-build.yaml opens with a preflight listing exactly its required capabilities, and confirm-status precedes the Execute phase first capability write (AC-4)', () => {
    const data = { metadata: MANIFEST.metadata, workflow: { phases: PHASES } };
    const requiredCapabilities = data.metadata.capabilities.required;

    const preflightPhase = data.workflow.phases.find((p) => p.name === 'Preflight');
    expect(preflightPhase).toBeDefined();
    expect(preflightPhase.order).toBe(1);

    const argParsingStep = preflightPhase.steps.find((s) => s.title === 'Argument Parsing');
    expect(argParsingStep).toBeDefined();
    expect(argParsingStep.actions.some((a) => a.includes('"$TOOLCHAIN_CLI"'))).toBe(false);

    const preflightStep = preflightPhase.steps.find((s) => s.title === 'Tool Capability Preflight');
    expect(preflightStep).toBeDefined();
    expect(preflightStep.order).toBeGreaterThan(argParsingStep.order);

    const preflightAction = preflightStep.actions.find((a) => a.includes('$TOOLCHAIN_CLI" preflight --require'));
    expect(preflightAction).toBeDefined();
    const listedCapabilities = [...preflightAction.matchAll(/--require ([a-z-]+\.[a-z-]+)/g)].map((m) => m[1]);
    expect(listedCapabilities.length).toBe(requiredCapabilities.length);
    expect([...listedCapabilities].sort()).toEqual([...requiredCapabilities].sort());

    const executePhase = data.workflow.phases.find((p) => p.name === 'Execute');
    expect(executePhase).toBeDefined();
    const waveLoopStep = executePhase.steps.find((s) => s.title.includes('Wave Loop'));
    expect(waveLoopStep).toBeDefined();

    const confirmIndex = waveLoopStep.actions.findIndex((a) => a.includes('confirm-status tracker.comment'));
    const firstWriteIndex = waveLoopStep.actions.findIndex(
      (a) => a.includes('$TOOLCHAIN_CLI" run tracker.') || a.includes('$TOOLCHAIN_CLI" run work-graph.')
    );
    expect(confirmIndex).toBeGreaterThanOrEqual(0);
    expect(firstWriteIndex).toBeGreaterThan(confirmIndex);
  });
});
