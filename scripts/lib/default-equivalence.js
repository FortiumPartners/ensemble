/**
 * Default-toolchain equivalence helpers (TRD-2026-8d825f54 TRD-049, PRD REQ-024).
 *
 * Holds the covered-unit list, the golden-file shape, the deviation accounting that makes every
 * legitimate pre/post difference an explicit, justified record, and a maintainer capture CLI:
 *
 *   node scripts/lib/default-equivalence.js --capture        # (re)write goldens from BASE_REF
 *
 * Comparison model. A "sequence" is the ordered list of DISTINCT `[binary, subcommand]` tool
 * steps of a body, in order of first appearance (a body that restates the same step in a
 * description and again in its actions still performs it once), taken from literal tool
 * invocations plus every `toolchain-cli run <capability>` call resolved through the default
 * adapter manifest. `toolchain-cli preflight` calls are availability probes: they are resolved
 * through the same manifests (an unresolvable id is a failure) but are not execution steps.
 *
 * A golden stores the pre-refactor `sequence` captured from `BASE_REF`. When the refactor
 * intentionally changed it, the golden also stores `expectedPost` and the `deviations` that
 * account for EVERY difference between the two (removed / added / replaced / reordered), each
 * with a justification. The comparison itself is never loosened: post must equal `expectedPost`
 * element by element.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { extractSteps, loadDefaultTemplates } = require('./instruction-sequence');
const { isSkillBacked, resolveSkillFile, listSkillReferences } = require('./skill-backed-command');

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE_DIR = path.join(ROOT, 'scripts', 'tests', 'fixtures', 'default-equivalence');
const DEV_COMMANDS = 'packages/development/commands';

/** Covered units: one golden JSON per entry (TRD-049 list + the TRD-030/TRD-045 skills). */
const COVERED = [
  { name: 'list-issue', path: `${DEV_COMMANDS}/list-issue.yaml`, trd: 'TRD-028' },
  { name: 'requirement-status', path: `${DEV_COMMANDS}/requirement-status.yaml`, trd: 'TRD-028' },
  { name: 'analyze-complexity', path: `${DEV_COMMANDS}/analyze-complexity.yaml`, trd: 'TRD-028' },
  { name: 'onboard', path: `${DEV_COMMANDS}/onboard.yaml`, trd: 'TRD-028' },
  { name: 'retro', path: `${DEV_COMMANDS}/retro.yaml`, trd: 'TRD-028' },
  { name: 'implement-bead', path: `${DEV_COMMANDS}/implement-bead.yaml`, trd: 'TRD-029/TRD-039' },
  { name: 'beads-build-wave', path: `${DEV_COMMANDS}/beads-build-wave.yaml`, trd: 'TRD-029' },
  { name: 'beads-build', path: `${DEV_COMMANDS}/beads-build.yaml`, trd: 'TRD-030' },
  { name: 'implement-trd-beads', path: `${DEV_COMMANDS}/implement-trd-beads.yaml`, trd: 'TRD-031/TRD-045' },
  { name: 'pr-merge', path: 'packages/git/commands/pr-merge.yaml', trd: 'TRD-039' },
  { name: 'fix-issue', path: `${DEV_COMMANDS}/fix-issue.yaml`, trd: 'TRD-039' },
  { name: 'pr-review-cycle', path: 'packages/development/skills/pr-review-cycle/SKILL.md', trd: 'TRD-045' },
  {
    name: 'pr-review-remediation',
    path: 'packages/quality/skills/pr-review-remediation/SKILL.md',
    trd: 'TRD-045'
  },
  { name: 'act-local-ci', path: 'packages/git/skills/act-local-ci/SKILL.md', trd: 'TRD-045' }
];

const DEVIATION_TYPES = ['removed', 'added', 'replaced', 'reordered'];

function kindOf(file) {
  return file.endsWith('.yaml') ? 'yaml' : 'markdown';
}

function readBaseRef(fixtureDir = FIXTURE_DIR) {
  return fs.readFileSync(path.join(fixtureDir, 'BASE_REF'), 'utf8').trim();
}

/** Pre-refactor file content at `baseRef`, or null when the commit/path is not available. */
function gitShow(baseRef, file, cwd = ROOT) {
  try {
    return execFileSync('git', ['show', `${baseRef}:${file}`], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch {
    return null;
  }
}

/**
 * The post-refactor body of a covered file: what the executor reads. A skill-backed command's
 * YAML is a manifest with no prose, so its body is its skill (SKILL.md plus references/*.md),
 * read as markdown; every other file is its own text, kind by extension. A skill split into
 * references/ keeps its workflow phases there and its shared rules in SKILL.md, so the references
 * come first and SKILL.md after: the same "workflow steps first, shared rules appended" order the
 * sequence extraction applies to a YAML's `workflow` block versus its other blocks.
 * @param {string} file Repo-relative path
 * @returns {{text:string, kind:'yaml'|'markdown'}}
 */
function readPostSource(file, root = ROOT) {
  const abs = path.join(root, file);
  const text = fs.readFileSync(abs, 'utf8');
  if (file.endsWith('.yaml')) {
    const data = require('js-yaml').load(text);
    if (isSkillBacked(data)) {
      const skillFile = resolveSkillFile(abs, data.skill);
      const read = (file) => fs.readFileSync(file, 'utf8');
      const text = [...listSkillReferences(skillFile).map(read), read(skillFile).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')].join('\n');
      return { text, kind: 'markdown' };
    }
  }
  return { text, kind: kindOf(file) };
}

/** Distinct `[binary, subcommand]` steps in order of first appearance; preflight steps excluded. */
function dedupeSequence(steps) {
  const seen = new Set();
  const out = [];
  for (const s of steps) {
    if (s.source === 'preflight') continue;
    const key = `${s.binary}\u0000${s.sub}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([s.binary, s.sub]);
  }
  return out;
}

function preSequence(text, file) {
  return dedupeSequence(extractSteps(text, { kind: kindOf(file) }));
}

/**
 * Post-refactor result for one source text: the comparable sequence plus the preflight steps
 * (resolved through the same default manifests) and any capability id that did not resolve.
 */
function postSequence(text, file, templates, kind = kindOf(file)) {
  const steps = extractSteps(text, { kind, templates });
  return {
    sequence: dedupeSequence(steps),
    preflight: steps.filter((s) => s.source === 'preflight').map((s) => [s.binary, s.sub]),
    unresolved: steps.filter((s) => s.binary === '<unresolved>').map((s) => `${s.source}:${s.capability}`)
  };
}

const key = (step) => `${step[0]} ${step[1]}`;

/**
 * Check that `deviations` account for exactly the difference between `pre` and `expectedPost`.
 * @returns {string[]} problems (empty when the accounting is exact)
 */
function accountDeviations(pre, expectedPost, deviations) {
  const problems = [];
  const preKeys = new Set(pre.map(key));
  const postKeys = new Set(expectedPost.map(key));
  const removedClaims = new Set();
  const addedClaims = new Set();
  let reorderClaimed = false;

  for (const [i, d] of deviations.entries()) {
    const label = `deviation #${i}`;
    if (!DEVIATION_TYPES.includes(d.type)) problems.push(`${label}: unknown type "${d.type}"`);
    if (typeof d.justification !== 'string' || d.justification.trim().length < 20) {
      problems.push(`${label}: missing justification (>= 20 chars)`);
    }
    if (typeof d.trd !== 'string' || !/TRD-\d+|I\d|Deviation/.test(d.trd)) {
      problems.push(`${label}: missing trd/interpretation reference`);
    }
    const claim = (steps, set, present, absent, what) => {
      for (const s of steps || []) {
        if (!present.has(key(s))) problems.push(`${label}: ${what} step "${key(s)}" is not in the expected set`);
        if (absent.has(key(s))) problems.push(`${label}: ${what} step "${key(s)}" is on both sides`);
        if (set.has(key(s))) problems.push(`${label}: step "${key(s)}" claimed twice`);
        set.add(key(s));
      }
    };
    if (d.type === 'removed') claim(d.steps, removedClaims, preKeys, postKeys, 'removed');
    if (d.type === 'added') claim(d.steps, addedClaims, postKeys, preKeys, 'added');
    if (d.type === 'replaced') {
      claim(d.steps, removedClaims, preKeys, postKeys, 'replaced');
      claim(d.replacedBy, addedClaims, postKeys, preKeys, 'replacement');
    }
    if (d.type === 'reordered') reorderClaimed = true;
  }
  for (const k of preKeys) {
    if (!postKeys.has(k) && !removedClaims.has(k)) problems.push(`unaccounted removal of "${k}"`);
  }
  for (const k of postKeys) {
    if (!preKeys.has(k) && !addedClaims.has(k)) problems.push(`unaccounted addition of "${k}"`);
  }
  const commonPre = pre.filter((s) => postKeys.has(key(s))).map(key);
  const commonPost = expectedPost.filter((s) => preKeys.has(key(s))).map(key);
  const orderDiffers = commonPre.join('\n') !== commonPost.join('\n');
  if (orderDiffers && !reorderClaimed) problems.push('unaccounted reordering of steps present on both sides');
  if (!orderDiffers && reorderClaimed) problems.push('a "reordered" deviation is recorded but the common steps keep their order');
  return problems;
}

/** Index-wise differences between two sequences, for failure messages. */
function diffSequences(expected, actual) {
  const diffs = [];
  const n = Math.max(expected.length, actual.length);
  for (let i = 0; i < n; i += 1) {
    const e = expected[i] ? key(expected[i]) : '<none>';
    const a = actual[i] ? key(actual[i]) : '<none>';
    if (e !== a) diffs.push(`step ${i}: expected "${e}" but found "${a}"`);
  }
  return diffs;
}

function goldenPath(name, fixtureDir = FIXTURE_DIR) {
  return path.join(fixtureDir, `${name}.json`);
}

function loadGolden(name, fixtureDir = FIXTURE_DIR) {
  return JSON.parse(fs.readFileSync(goldenPath(name, fixtureDir), 'utf8'));
}

/**
 * Capture (or refresh) every golden's pre-refactor `sequence` from BASE_REF. Existing
 * `deviations`/`expectedPost` are preserved; a new golden starts with none (so an unrecorded
 * difference fails the test until a justified deviation is written).
 */
function capture(fixtureDir = FIXTURE_DIR) {
  const baseRef = readBaseRef(fixtureDir);
  if (!/^[0-9a-f]{40}$/.test(baseRef)) throw new Error('BASE_REF must hold a 40-character commit id');
  for (const unit of COVERED) {
    const text = gitShow(baseRef, unit.path);
    if (text === null) throw new Error(`cannot read ${unit.path} at ${baseRef}`);
    let previous = {};
    if (fs.existsSync(goldenPath(unit.name, fixtureDir))) previous = loadGolden(unit.name, fixtureDir);
    const golden = {
      command: unit.name,
      path: unit.path,
      baseRef,
      refactoredBy: unit.trd,
      sequence: preSequence(text, unit.path)
    };
    if (previous.deviations && previous.deviations.length) {
      golden.deviations = previous.deviations;
      golden.expectedPost = previous.expectedPost;
    }
    fs.writeFileSync(goldenPath(unit.name, fixtureDir), `${JSON.stringify(golden, null, 2)}\n`);
    console.log(`captured ${unit.name}: ${golden.sequence.length} steps`);
  }
}

module.exports = {
  ROOT,
  FIXTURE_DIR,
  COVERED,
  DEVIATION_TYPES,
  readBaseRef,
  gitShow,
  dedupeSequence,
  preSequence,
  postSequence,
  readPostSource,
  accountDeviations,
  diffSequences,
  loadGolden,
  goldenPath,
  capture,
  loadDefaultTemplates
};

if (require.main === module) {
  if (process.argv.includes('--capture')) capture();
  else {
    console.error('usage: node scripts/lib/default-equivalence.js --capture');
    process.exit(2);
  }
}
