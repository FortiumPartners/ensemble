'use strict';
/**
 * Tests for TRD-039-TEST (TRD-2026-8d825f54 "tool-abstraction-layer", PR 9, REQ-015):
 * verifies the TRD-039 refactor (commit 86c545e) of `packages/git/commands/pr-merge.yaml`,
 * `packages/development/commands/fix-issue.yaml` and
 * `packages/development/commands/implement-bead.yaml` away from direct `gh pr`/`az repos`/
 * `git town` invocations onto `host.change-request-*`/`workflow.*` toolchain capabilities.
 *
 * Covers all four TRD-039-TEST acceptance scenarios against the REAL committed files (no
 * fixtures):
 *   1. No host or workflow binary remains -- a word-boundary-safe regex sweep for the literal
 *      invocation shapes `gh pr <sub>`, `az repos <sub>`, `git town <sub>` (the hyphenated
 *      string `git-town`, used as an adapter/skill-directory name, is explicitly NOT a match
 *      and is expected to remain).
 *   2. Merge safety rules unchanged -- after the rebase onto dev, the NEVER-merge rule is the
 *      local-ci-gate rule; this scenario asserts every safety condition (verified passing local
 *      gate for the exact head, human CHANGES_REQUESTED refusal, bots not a refusal,
 *      classification by account type, MERGEABLE required, fail closed when review state is
 *      unavailable via host.change-request-reviews) in the CURRENT wording.
 *   3. Capabilities validate -- both the real `validateCapabilityIds`/
 *      `validateCapabilityInvocationDrift` functions `scripts/validate-all.js` exports
 *      (filtered to these three files) and a real `node scripts/validate-all.js` subprocess
 *      are exercised.
 *   4. Command preamble present -- each file's own `metadata.capabilities.required` (parsed
 *      from the SAME YAML, never hand-duplicated) is cross-checked against the `--require`
 *      flags its preflight step actually issues, and every capability that gets an explicit
 *      `confirm-status <id>` gate is checked to call it strictly before that id's first `run
 *      <id>` invocation.
 *
 * Plus a mutation proof (two, in fact) showing the check-1 forbidden-invocation sweep and the
 * check-4 confirm-before-run ordering check both fail on a deliberately broken in-memory
 * scratch copy -- never the real on-disk file -- proving neither passes vacuously.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const yaml = require('js-yaml');

const { validateCapabilityIds, validateCapabilityInvocationDrift } = require('../validate-all');
const { readCommandProse } = require('../lib/skill-backed-command');

const REPO_ROOT = path.join(__dirname, '..', '..');
const VALIDATE_ALL_PATH = path.join(REPO_ROOT, 'scripts', 'validate-all.js');

const COMMANDS = {
  'pr-merge.yaml': path.join(REPO_ROOT, 'packages', 'git', 'commands', 'pr-merge.yaml'),
  'fix-issue.yaml': path.join(REPO_ROOT, 'packages', 'development', 'commands', 'fix-issue.yaml'),
  'implement-bead.yaml': path.join(
    REPO_ROOT,
    'packages',
    'development',
    'commands',
    'implement-bead.yaml'
  )
};

// Same `path.join('packages', pkg, 'commands', file)` shape `scripts/validate-all.js` uses to
// label its failure messages, so filtering those arrays down to "just these three files" is a
// plain string-prefix match rather than re-deriving the relative path a second way.
const RELATIVE_PATHS = [
  path.join('packages', 'git', 'commands', 'pr-merge.yaml'),
  path.join('packages', 'development', 'commands', 'fix-issue.yaml'),
  path.join('packages', 'development', 'commands', 'implement-bead.yaml')
];

// `rawText` is the command's prose: the manifest plus its skill (SKILL.md + references/*.md) for the
// skill-backed pr-merge, fix-issue and implement-bead. `parsed` is always the YAML (metadata incl.
// capabilities).
function loadCommand(filePath) {
  const yamlText = fs.readFileSync(filePath, 'utf8');
  const parsed = yaml.load(yamlText);
  return { rawText: readCommandProse(filePath, parsed, yamlText), parsed };
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Word-boundary-safe: `\s+` between the two words means the hyphenated adapter/skill-directory
// name `git-town` can never match `git town` (and `git-town` SHOULD still appear in these
// files -- it is a legitimate skill-directory reference, not a forbidden invocation).
const FORBIDDEN_INVOCATIONS = [
  { label: 'gh pr', re: /\bgh\s+pr\b/i },
  { label: 'az repos', re: /\baz\s+repos\b/i },
  { label: 'git town', re: /\bgit\s+town\b/i }
];

function findForbiddenInvocations(text) {
  return FORBIDDEN_INVOCATIONS.filter(({ re }) => re.test(text)).map(({ label }) => label);
}

// Same two literal invocation shapes `scripts/lib/capability-ids-check.js`'s
// `checkCapabilityInvocationDrift` scans for (that module does not export its regexes, hence
// the duplication here, documented rather than silent).
const PREFLIGHT_REQUIRE_ID_RE = /--require\s+(\S+)/g;
const CONFIRM_STATUS_ID_RE = /\bconfirm-status\s+(\S+)/g;

/**
 * For every capability id that gets an explicit `confirm-status <id>` gate somewhere in the
 * body, assert that gate's first occurrence precedes that same id's first real `run <id>`
 * invocation. Case-insensitive on `run` because the three files phrase the actual invocation
 * both as the literal CLI subcommand (`node "$TOOLCHAIN_CLI" run host.change-request-merge`)
 * and as plain English prose (`Run workflow.commit --arg message=...`).
 *
 * @returns {string[]} capability ids where the gate is missing, or does not precede its run
 */
function confirmBeforeRunViolations(rawText) {
  const confirmedIds = new Set();
  for (const m of rawText.matchAll(CONFIRM_STATUS_ID_RE)) confirmedIds.add(m[1]);

  const violations = [];
  for (const id of confirmedIds) {
    const confirmIdx = rawText.indexOf(`confirm-status ${id}`);
    const runRe = new RegExp(`\\brun\\s+${escapeRegExp(id)}\\b`, 'i');
    const runMatch = runRe.exec(rawText);
    if (confirmIdx === -1 || !runMatch || confirmIdx >= runMatch.index) {
      violations.push(id);
    }
  }
  return { confirmedIds, violations };
}

describe('TRD-039-TEST Scenario: No host or workflow binary remains', () => {
  for (const [name, filePath] of Object.entries(COMMANDS)) {
    test(`${name} contains zero "gh pr"/"az repos"/"git town" invocations`, () => {
      const { rawText } = loadCommand(filePath);
      expect(findForbiddenInvocations(rawText)).toEqual([]);
    });
  }

  test('implement-bead.yaml still names the hyphenated "git-town" adapter/skill-directory string (not a forbidden match)', () => {
    const { rawText } = loadCommand(COMMANDS['implement-bead.yaml']);
    expect(rawText).toMatch(/git-town/);
    expect(findForbiddenInvocations(rawText)).toEqual([]);
  });
});

describe('TRD-039-TEST mutation proof: the forbidden-invocation sweep can actually fail', () => {
  test('findForbiddenInvocations flags a reintroduced "gh pr merge" in an in-memory scratch copy, never the real file', () => {
    const { rawText: real } = loadCommand(COMMANDS['pr-merge.yaml']);
    expect(findForbiddenInvocations(real)).toEqual([]); // sanity: the real file is clean

    const mutated = real.replace(
      'Merge: run node "$TOOLCHAIN_CLI" run host.change-request-merge',
      'Merge: run node "$TOOLCHAIN_CLI" run host.change-request-merge # fallback: gh pr merge --squash'
    );
    expect(mutated).not.toEqual(real); // the replace actually matched something
    expect(findForbiddenInvocations(mutated)).toEqual(['gh pr']);

    // The review-state reads this rebase moved onto host.change-request-reviews are covered too.
    const reviewsMutated = real.replace(
      'run host.change-request-reviews --run-id',
      'run gh pr view <PR_NUMBER> --json reviews,reviewDecision,latestReviews --run-id'
    );
    expect(reviewsMutated).not.toEqual(real);
    expect(findForbiddenInvocations(reviewsMutated)).toEqual(['gh pr']);

    // The file on disk is untouched -- `mutated` only ever existed as a local string.
    // (`real` is the manifest plus its skill, so a fresh read of both must equal it)
    expect(loadCommand(COMMANDS['pr-merge.yaml']).rawText).toEqual(real);
  });
});

describe('TRD-039-TEST Scenario: Merge safety rules unchanged', () => {
  // The pre-TRD-039 rule ("NEVER merge while any required check is failing/pending ...") was
  // superseded on dev by the local-ci-gate rule (merge on the verified local gate verdict for
  // the exact head; reviews read from the host). After the rebase onto dev the safety
  // conditions are asserted against the CURRENT wording, and every review-state read goes
  // through host.change-request-reviews (no literal `gh`), failing closed.
  // pr-merge is skill-backed: its YAML is a manifest (metadata only), so the constraints and the workflow are
  // read back from its skill (packages/git/skills/ensemble-pr-merge/SKILL.md) in the shape the YAML used to hold.
  const parsed = require('../../packages/development/tests/helpers/pr-merge-skill').COMMAND;
  const rule = parsed.constraints.find((c) => c.startsWith('NEVER merge'));
  const actionsOfPhase = (name) =>
    parsed.workflow.phases.find((p) => p.name === name).steps.flatMap((s) => s.actions || []);
  const allActions = parsed.workflow.phases.flatMap((p) => p.steps.flatMap((s) => s.actions || []));

  test('the NEVER-merge rule requires a verified passing local gate for the exact head', () => {
    expect(rule).toBeDefined();
    expect(rule).toMatch(/verified passing local CI status bound to the exact head SHA/);
    expect(rule).toContain('local-ci-gate skill');
    expect(rule).toMatch(/no run, a failed run, or a stale run/);
  });

  test('a HUMAN reviewer\'s latest decisive CHANGES_REQUESTED review is a refusal; bot accounts are not; classification is by account type, never name', () => {
    const sentences = rule.split(/(?<=\.)\s+/);
    const refusal = sentences.find((s) => /^Refuse to merge/.test(s));
    expect(refusal).toMatch(/HUMAN reviewer's latest decisive review is CHANGES_REQUESTED/);
    expect(refusal).not.toMatch(/\bbot\b/i);
    expect(sentences.find((s) => /bot account's CHANGES_REQUESTED/i.test(s))).toMatch(/NOT a refusal/);
    expect(rule).toMatch(/account type field \(Bot vs User\), never by account name/);
    const reviewsAction = allActions.find((a) => a.startsWith('Reviews:'));
    expect(reviewsAction).toMatch(/authorType field \(Bot vs User\), never by name/);
    expect(reviewsAction).toMatch(/HUMAN reviewer whose latest decisive review is CHANGES_REQUESTED/);
    expect(reviewsAction).toMatch(/unresolved threads\) is one finding/);
  });

  test('the pre-merge re-check requires MERGEABLE and re-reads review state through host.change-request-reviews', () => {
    const recheck = actionsOfPhase('Merge and Report').find((a) => a.startsWith('Immediately before merging'));
    expect(recheck).toContain('host.change-request-reviews');
    expect(recheck).toMatch(/data\.mergeable is not MERGEABLE/);
    expect(recheck).toMatch(/human reviewer's latest decisive review is CHANGES_REQUESTED \(bots excluded, by account type\)/);
    expect(recheck).toMatch(/abort and run another verification round/);
    const rebuild = actionsOfPhase('Verification and Round Loop').find((a) => a.startsWith('Rebuild the manifest'));
    expect(rebuild).toContain('host.change-request-reviews');
  });

  test('review state fails closed: unavailable or ok:false halts for a human, never "no reviews"', () => {
    expect(rule).toMatch(/cannot be read through the host adapter \(host\.change-request-reviews unavailable or ok:false\), refuse to merge and escalate to a human; never treat it as no reviews/);
    const reviewsAction = allActions.find((a) => a.startsWith('Reviews:'));
    expect(reviewsAction).toMatch(/ok:false: print that review state cannot be verified through this host adapter and HALT for a human; never treat it as no reviews/);
    const preflight = allActions.find((a) => a.includes('preflight --require'));
    expect(preflight).toContain('--require host.change-request-reviews');
    expect(preflight).toMatch(/cannot be verified through this host adapter and HALT for a human/);
    expect(parsed.metadata.capabilities.required).toContain('host.change-request-reviews');
  });

  test('mutation proof: removing the fail-closed clause or the human/bot refusal wording makes these checks fail', () => {
    const weakened = rule.replace(/ If review state cannot be read.*$/, '');
    expect(weakened).not.toMatch(/never treat it as no reviews/);
    const botBlocking = rule.replace('NOT a refusal', 'a refusal');
    expect(botBlocking).not.toMatch(/NOT a refusal/);
  });
});

describe('TRD-039-TEST Scenario: Capabilities validate', () => {
  test('validateCapabilityIds() reports zero errors for these three files', () => {
    const failures = validateCapabilityIds();
    const relevant = failures.filter((msg) => RELATIVE_PATHS.some((p) => msg.startsWith(`${p}:`)));
    expect(relevant).toEqual([]);
  });

  test('validateCapabilityInvocationDrift() reports zero errors for these three files', () => {
    const failures = validateCapabilityInvocationDrift();
    const relevant = failures.filter((msg) => RELATIVE_PATHS.some((p) => msg.startsWith(`${p}:`)));
    expect(relevant).toEqual([]);
  });

  test(
    'real `node scripts/validate-all.js` subprocess exits 0 and reports the command-capability checks ran',
    () => {
      const proc = spawnSync(process.execPath, [VALIDATE_ALL_PATH], {
        cwd: REPO_ROOT,
        encoding: 'utf8'
      });
      expect(proc.status).toBe(0);
      expect(proc.stdout).toMatch(/command YAML file\(s\) checked for valid capability ids/);
      expect(proc.stdout).toMatch(
        /command YAML file\(s\) checked for capability declaration\/invocation drift/
      );
      expect(proc.stdout).not.toMatch(/pr-merge\.yaml.*unknown capability/i);
      expect(proc.stdout).not.toMatch(/fix-issue\.yaml.*unknown capability/i);
      expect(proc.stdout).not.toMatch(/implement-bead\.yaml.*unknown capability/i);
    },
    60000
  );
});

describe('TRD-039-TEST Scenario: Command preamble present', () => {
  for (const [name, filePath] of Object.entries(COMMANDS)) {
    test(`${name} opens with a preflight listing exactly its required capabilities`, () => {
      const { rawText, parsed } = loadCommand(filePath);
      const required = (parsed.metadata.capabilities.required || []).slice().sort();
      expect(required.length).toBeGreaterThan(0);

      expect(rawText.toLowerCase()).toContain('toolchain-cli');
      expect(rawText.toLowerCase()).toContain('preflight');

      const preflightIds = new Set();
      for (const m of rawText.matchAll(PREFLIGHT_REQUIRE_ID_RE)) preflightIds.add(m[1]);
      expect([...preflightIds].sort()).toEqual(required);
    });

    test(`${name} calls confirm-status before the first run invocation of each capability it gates`, () => {
      const { rawText } = loadCommand(filePath);
      const { confirmedIds, violations } = confirmBeforeRunViolations(rawText);
      expect(confirmedIds.size).toBeGreaterThan(0); // at least one confirm-status gate exists
      expect(violations).toEqual([]);
    });
  }
});

describe('TRD-039-TEST mutation proof: the confirm-before-run ordering check can actually fail', () => {
  test('confirmBeforeRunViolations flags a capability whose confirm-status gate comes AFTER its run invocation', () => {
    const correctOrder = 'confirm-status host.change-request-merge --run-id X\nrun host.change-request-merge --run-id X\n';
    expect(confirmBeforeRunViolations(correctOrder).violations).toEqual([]);

    const reversedOrder = 'run host.change-request-merge --run-id X\nconfirm-status host.change-request-merge --run-id X\n';
    expect(confirmBeforeRunViolations(reversedOrder).violations).toEqual(['host.change-request-merge']);

    const missingGate = 'run host.change-request-merge --run-id X\n';
    expect(confirmBeforeRunViolations(missingGate).confirmedIds.size).toBe(0);
  });
});
