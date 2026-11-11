'use strict';
/**
 * Regression test for PR7 br-h1jk (TRD-028): the five command YAMLs this task refactored
 * (list-issue, requirement-status, analyze-complexity, onboard, retro) must never regain a
 * literal `br `/`bv ` tracker-binary invocation — all tracker access now goes through
 * `toolchain-cli run tracker.*`/`work-graph.*`. This mirrors the exact AC-1 grep
 * (`grep -nE '\b(br|bv) ' ...`) as a Jest assertion so CI catches a regression, not just a
 * manual grep run at review time.
 *
 * Extended by br-qbzx (TRD-028-TEST) to prove the commit's other three ACs with real
 * assertions instead of a one-time manual check:
 *  - AC-2 (capabilities validate): reuses scripts/validate-all.js's OWN capability-id
 *    mechanism (scripts/lib/capability-ids-check.js's checkCapabilityIds/loadValidCapabilityIds,
 *    plus the exported validateCapabilityIds from scripts/validate-all.js itself) -- not a
 *    hand-rolled check.
 *  - AC-3 (retro.yaml non-tracker steps unchanged): diffs the 10 git-log/estimate/PRD-metric/
 *    incident/report-writing action lines against the pre-refactor commit
 *    (dfbd1f1) for byte-identity.
 *  - AC-4 (command preamble): asserts each file's toolchain-cli preflight line lists exactly
 *    its declared capability ids (required + optional), and that tracker.create-declaring
 *    files (onboard, retro) call confirm-status before their first tracker.create call while
 *    the three read-only files never call confirm-status at all.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');
const { checkCapabilityIds, loadValidCapabilityIds } = require('../lib/capability-ids-check');
const { readCommandProse } = require('../lib/skill-backed-command');
const { validateCapabilityIds } = require('../validate-all');

const REPO_ROOT = path.join(__dirname, '..', '..');
const COMMANDS_DIR = path.join(REPO_ROOT, 'packages', 'development', 'commands');
const TARGET_FILES = ['list-issue.yaml', 'requirement-status.yaml', 'analyze-complexity.yaml', 'onboard.yaml', 'retro.yaml'];
// Superset used ONLY by the generic "no literal br/bv invocation" describe block below: PR 7
// independent review P2 found verify-requirements.yaml still called `br list --json`/`br
// comment list <id>` directly with no CI coverage at all (absent from TARGET_FILES above,
// which drives three OTHER, TRD-028-specific ACs -- capabilities-schema validation against a
// fixed required/optional shape, retro.yaml's own byte-identical-to-pre-refactor check, and
// AC-4's preflight-matches-declared-ids check -- none of which verify-requirements.yaml's
// different, all-optional-with-no-preflight design would satisfy). Only the no-literal-
// invocation sweep is generic enough to apply to it unmodified.
const NO_BINARY_TARGET_FILES = [...TARGET_FILES, 'verify-requirements.yaml'];

// Same pattern as the AC-1 grep: a bare `br` or `bv` word followed by a space -- i.e. an
// invocation like `br list` or `bv --robot-triage`, not incidental prose like `br/bv` or
// `(br, bv, ...)`.
const TRACKER_BINARY_INVOCATION = /\b(?:br|bv) /;

function findInvocationLines(contents) {
  return contents
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => TRACKER_BINARY_INVOCATION.test(line));
}

const PRE_REFACTOR_REF = 'dfbd1f1';
const CATEGORIES_DIR = path.join(REPO_ROOT, 'packages', 'development', 'toolchain', 'categories');

function readPreRefactorFile(relPath) {
  return execFileSync('git', ['show', `${PRE_REFACTOR_REF}:${relPath}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
}

function loadCommandYaml(file) {
  return yaml.load(fs.readFileSync(path.join(COMMANDS_DIR, file), 'utf8'));
}

// These six commands are skill-backed: the YAML is a manifest (metadata + `skill`) and the prompt
// lives in the skill (SKILL.md + references/*.md). proseOf is the text a raw-text check scans: the
// manifest plus its skill. The capability declarations (metadata.capabilities) stay in the manifest,
// so loadCommandYaml keeps serving the structural checks.
function proseOf(file) {
  const yamlPath = path.join(COMMANDS_DIR, file);
  const raw = fs.readFileSync(yamlPath, 'utf8');
  return readCommandProse(yamlPath, yaml.load(raw), raw);
}

// The single `node "$TOOLCHAIN_CLI" preflight --require ... --json` line each of the five
// files opens its tracker-facing step with (AC-4). Not tied to a fixed YAML path because
// retro.yaml's preflight call lives in a step `actions` entry while the other four embed it
// in a step `description` -- a raw-text line scan is robust to that structural difference.
function findPreflightLine(contents) {
  return contents.split('\n').find((line) => line.includes('preflight --require'));
}

function extractRequireIds(line) {
  return [...line.matchAll(/--require (\S+)/g)].map((m) => m[1]);
}

describe('PR7 Track028: no literal br/bv tracker-binary invocation in refactored command YAMLs', () => {
  for (const file of NO_BINARY_TARGET_FILES) {
    test(`${file} contains zero br/bv invocations`, () => {
      const contents = proseOf(file);
      const hits = findInvocationLines(contents);
      expect(hits).toEqual([]);
    });
  }

  test('mutation proof: reintroducing a literal br/bv invocation in a /tmp copy is caught', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'track028-mutation-'));
    try {
      const copyPath = path.join(tmpDir, 'retro.yaml');
      const original = proseOf('retro.yaml');
      fs.writeFileSync(copyPath, original, 'utf8');

      // Sanity: the unmutated copy has no invocations (proves the detector isn't vacuously
      // true before we assert it catches the reintroduced one).
      expect(findInvocationLines(fs.readFileSync(copyPath, 'utf8'))).toEqual([]);

      const mutated = original.replace(
        'node "$TOOLCHAIN_CLI" run tracker.list --json > a temp file',
        'br list --all --json > a temp file'
      );
      expect(mutated).not.toBe(original);
      fs.writeFileSync(copyPath, mutated, 'utf8');

      const hitsAfterMutation = findInvocationLines(fs.readFileSync(copyPath, 'utf8'));
      expect(hitsAfterMutation.length).toBeGreaterThan(0);
      expect(hitsAfterMutation[0].line).toContain('br list --all --json');

      // Confirm again against the real, unmutated source: still zero.
      expect(findInvocationLines(proseOf('retro.yaml'))).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('PR7 Track028 AC-2: capabilities declarations validate against the real toolchain-cli category contracts', () => {
  const validIds = loadValidCapabilityIds(CATEGORIES_DIR);

  for (const file of TARGET_FILES) {
    test(`${file} metadata.capabilities passes scripts/validate-all.js's own capability-id check (checkCapabilityIds)`, () => {
      const commandData = loadCommandYaml(file);
      const failures = checkCapabilityIds(commandData, `packages/development/commands/${file}`, validIds);
      expect(failures).toEqual([]);
    });
  }

  test("the real scripts/validate-all.js exported validateCapabilityIds() reports zero failures for these five files", () => {
    // Calls the exact function `npm run validate` runs (scripts/validate-all.js's
    // validateCapabilityIds), not a reimplementation, then narrows its repo-wide failure
    // list to just the five TRD-028 files.
    const allFailures = validateCapabilityIds();
    const relevant = allFailures.filter((msg) =>
      TARGET_FILES.some((file) => msg.startsWith(`packages/development/commands/${file}:`))
    );
    expect(relevant).toEqual([]);
  });

  test('mutation proof: an invalid capability id in a /tmp copy of list-issue.yaml is caught by checkCapabilityIds, and the real source still validates clean', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'track028-capability-mutation-'));
    try {
      const src = path.join(COMMANDS_DIR, 'list-issue.yaml');
      const original = fs.readFileSync(src, 'utf8');
      const needle = '    required:\n      - tracker.list\n';
      expect(original).toContain(needle);
      const mutated = original.replace(needle, '    required:\n      - tracker.not-a-real-capability\n');
      expect(mutated).not.toBe(original);

      const copyPath = path.join(tmpDir, 'list-issue.yaml');
      fs.writeFileSync(copyPath, mutated, 'utf8');

      const mutatedData = yaml.load(fs.readFileSync(copyPath, 'utf8'));
      const failures = checkCapabilityIds(mutatedData, 'packages/development/commands/list-issue.yaml', validIds);
      expect(failures.length).toBeGreaterThan(0);
      expect(failures[0]).toContain('tracker.not-a-real-capability');

      // Confirm again against the real, unmutated source: still zero failures.
      const realData = loadCommandYaml('list-issue.yaml');
      expect(checkCapabilityIds(realData, 'packages/development/commands/list-issue.yaml', validIds)).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('PR7 Track028 AC-3: retro non-tracker steps are byte-identical to the pre-refactor commit', () => {
  // The pre-refactor retro.yaml (YAML) carried each step action as a quoted YAML string; the skill
  // carries the same action as one `- <action>` bullet line. The comparison is therefore on the
  // decoded action text: the pre-refactor action must appear, byte for byte, as a bullet line of the
  // current skill prose.
  const preRefactorData = yaml.load(readPreRefactorFile('packages/development/commands/retro.yaml'));
  const current = proseOf('retro.yaml');
  const currentLines = current.split('\n');

  const strings = (value) =>
    typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
  const preActions = preRefactorData.workflow.phases.flatMap((phase) => phase.steps.flatMap((step) => strings(step.actions)));

  // Every retro action NOT touched by TRD-028 -- i.e. everything except the
  // tracker.list listing bullet (Collect What Shipped) and the tracker.create confirm-status/
  // approval bullet (Propose Follow-ups) -- identified by reading both the pre- and
  // post-refactor retro.yaml side by side (git show 881381c6...:retro.yaml vs. current).
  // Three further lines were deliberately reworded afterwards by the tool-abstraction PR 11 lint
  // cleanup (TRD-047/TRD-049: no literal git/gh invocation in a shared command) and are therefore
  // no longer byte-identical: the --release range line, the git log/gh pr list line (now
  // workflow.log + host.change-request-list) and the gh issue list line (reworded without the literal command).
  const NON_TRACKER_ACTION_PREFIXES = [
    'Resolve ESTIMATE_ACTUAL (RELATIVE_PATH packages/development/lib/estimate-actual.js)',
    'Narrow its beads to the shipped set.',
    'Find the TRD for the release (docs/TRD/, from bead labels or titles).',
    "Extract the PRD's success metrics.",
    'Query an error-tracker MCP tool ONLY if one is configured',
    'Sections: What Shipped (PRs, beads), Estimate Accuracy',
    'List proposed beads (title, rationale, source:'
  ];

  const preActionFor = (prefix) => preActions.find((action) => action.startsWith(prefix));
  const currentLineFor = (prefix) => currentLines.find((line) => line.startsWith(`- ${prefix}`));

  for (const prefix of NON_TRACKER_ACTION_PREFIXES) {
    test(`non-tracker line byte-identical to pre-refactor: ${JSON.stringify(prefix.slice(0, 48))}`, () => {
      const preAction = preActionFor(prefix);
      const currentLine = currentLineFor(prefix);
      expect(preAction).toBeTruthy();
      expect(currentLine).toBeTruthy();
      expect(currentLine).toBe(`- ${preAction}`);
    });
  }

  test('mutation proof: breaking byte-identity of a non-tracker line in a /tmp copy of the retro prose is caught', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'track028-retro-nontracker-mutation-'));
    try {
      const prefix = 'Sections: What Shipped (PRs, beads), Estimate Accuracy';
      const preAction = preActionFor(prefix);
      const realCurrentLine = currentLineFor(prefix);
      expect(realCurrentLine).toBe(`- ${preAction}`); // sanity: real source passes before mutating

      const copyPath = path.join(tmpDir, 'retro.md');
      const mutated = current.replace(realCurrentLine, realCurrentLine.replace('Follow-ups', 'Follow-ups, MUTATED'));
      expect(mutated).not.toBe(current);
      fs.writeFileSync(copyPath, mutated, 'utf8');

      const mutatedLine = fs.readFileSync(copyPath, 'utf8').split('\n').find((l) => l.startsWith(`- ${prefix}`));
      expect(mutatedLine).not.toBe(`- ${preAction}`);

      // Confirm again against the real, unmutated source: still byte-identical.
      expect(currentLineFor(prefix)).toBe(`- ${preAction}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('PR7 Track028 AC-4: command preamble lists capabilities and gates tracker.create writes behind confirm-status', () => {
  // Capabilities declared `optional` that a file's preflight line ALSO requires anyway, as a
  // deliberate fail-fast UX choice confirmed by that file's own prose (no documented fallback
  // exists for them -- retro.yaml's tracker.create is only ever invoked later, behind
  // confirm-status, after explicit user approval; preflighting it has no alternate behavior to
  // make unreachable). Every OTHER optional capability must be ABSENT from the preflight
  // --require list: preflighting an optional capability that DOES have a documented fallback
  // (e.g. list-issue.yaml's work-graph.plan -> tracker.list) makes that fallback unreachable
  // (PR 7 independent review P2 finding).
  const OPTIONAL_CAPABILITIES_ALSO_PREFLIGHTED = {
    'retro.yaml': ['tracker.create']
  };

  for (const file of TARGET_FILES) {
    test(`${file} preflight line lists exactly its required capability ids, plus any optional id this file deliberately also preflights (no documented fallback)`, () => {
      const contents = proseOf(file);
      const commandData = loadCommandYaml(file);
      const required = commandData.metadata.capabilities.required || [];
      const optional = commandData.metadata.capabilities.optional || [];
      const alsoPreflighted = OPTIONAL_CAPABILITIES_ALSO_PREFLIGHTED[file] || [];
      const expected = new Set([...required, ...alsoPreflighted]);

      const preflightLine = findPreflightLine(contents);
      expect(preflightLine).toBeTruthy();
      expect(preflightLine).toMatch(/TOOLCHAIN_CLI\\?" preflight/);

      const listedIds = extractRequireIds(preflightLine);
      expect(new Set(listedIds)).toEqual(expected);
      expect(listedIds.length).toBe(expected.size);

      // Every optional capability with a documented fallback (i.e. not in this file's own
      // deliberate-preflight allowlist above) must be ABSENT from the preflight line.
      const fallbackOptionalIds = optional.filter((id) => !alsoPreflighted.includes(id));
      for (const id of fallbackOptionalIds) {
        expect(listedIds).not.toContain(id);
      }
    });

    test(`${file} calls toolchain-cli confirm-status before its first tracker.create call iff it declares tracker.create`, () => {
      const contents = proseOf(file);
      const commandData = loadCommandYaml(file);
      const required = commandData.metadata.capabilities.required || [];
      const optional = commandData.metadata.capabilities.optional || [];
      const declaresCreate = required.includes('tracker.create') || optional.includes('tracker.create');

      const confirmStatusIdx = contents.indexOf('confirm-status tracker.create');
      const firstRunCreateIdx = contents.indexOf('run tracker.create --arg');

      if (declaresCreate) {
        expect(confirmStatusIdx).toBeGreaterThan(-1);
        expect(firstRunCreateIdx).toBeGreaterThan(-1);
        expect(confirmStatusIdx).toBeLessThan(firstRunCreateIdx);
      } else {
        // Matches the commit's documented contract: a read-only command "has no
        // side-effecting write and so never calls confirm-status/confirm-record".
        expect(confirmStatusIdx).toBe(-1);
      }
    });
  }

  test("mutation proof: reintroducing the optional work-graph.plan into list-issue.yaml's preflight --require list (PR 7 independent review P2) is caught, and the real source still passes", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'track028-preflight-optional-mutation-'));
    try {
      const original = proseOf('list-issue.yaml');
      const needle = 'preflight --require tracker.list [add --non-interactive when FOREMAN_TASK_TITLE is set] --json';
      expect(original).toContain(needle);
      const mutated = original.replace(
        needle,
        'preflight --require tracker.list --require work-graph.plan [add --non-interactive when FOREMAN_TASK_TITLE is set] --json'
      );
      expect(mutated).not.toBe(original);

      const copyPath = path.join(tmpDir, 'list-issue.yaml');
      fs.writeFileSync(copyPath, mutated, 'utf8');

      const mutatedContents = fs.readFileSync(copyPath, 'utf8');
      const required = loadCommandYaml('list-issue.yaml').metadata.capabilities.required || [];
      const listedIds = extractRequireIds(findPreflightLine(mutatedContents));
      // The mutant now preflights 'work-graph.plan' even though it carries a documented
      // fallback (the exact regression this task fixed) -- listedIds no longer equals
      // required-only, proving the mutation is observable.
      expect(new Set(listedIds)).not.toEqual(new Set(required));
      expect(listedIds).toContain('work-graph.plan');

      // Confirm again against the real, unmutated source: work-graph.plan is absent.
      const realContents = proseOf('list-issue.yaml');
      expect(extractRequireIds(findPreflightLine(realContents))).not.toContain('work-graph.plan');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('mutation proof: dropping a --require flag from the preflight line in a /tmp copy of requirement-status.yaml is caught', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'track028-preflight-mutation-'));
    try {
      const original = proseOf('requirement-status.yaml');
      const needle = 'preflight --require tracker.list --require tracker.comments';
      expect(original).toContain(needle);
      const mutated = original.replace(needle, 'preflight --require tracker.list');
      expect(mutated).not.toBe(original);

      const copyPath = path.join(tmpDir, 'requirement-status.yaml');
      fs.writeFileSync(copyPath, mutated, 'utf8');

      const mutatedContents = fs.readFileSync(copyPath, 'utf8');
      const mutatedData = loadCommandYaml('requirement-status.yaml');
      const declared = new Set([
        ...(mutatedData.metadata.capabilities.required || []),
        ...(mutatedData.metadata.capabilities.optional || [])
      ]);
      const listedIds = extractRequireIds(findPreflightLine(mutatedContents));
      expect(new Set(listedIds)).not.toEqual(declared);
      expect(listedIds).not.toContain('tracker.comments');

      // Confirm again against the real, unmutated source: still lists both declared ids.
      const realContents = proseOf('requirement-status.yaml');
      const realData = loadCommandYaml('requirement-status.yaml');
      const realDeclared = new Set([
        ...(realData.metadata.capabilities.required || []),
        ...(realData.metadata.capabilities.optional || [])
      ]);
      expect(new Set(extractRequireIds(findPreflightLine(realContents)))).toEqual(realDeclared);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
