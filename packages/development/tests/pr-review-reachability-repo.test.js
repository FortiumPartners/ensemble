'use strict';

/**
 * TRD-037: the proof ITSELF, run over the real repository artifacts.
 *
 * `pr-review-reachability.test.js` grades the grader. This file is the thing
 * the AC actually asks for: it reads the REAL entry command text, the REAL
 * skills, the REAL CLI handler table and the REAL per-runtime bundles, and
 * asserts the chain holds -- so "reachable" is a measurement of this
 * checkout, not a claim about it.
 *
 * Implementation AC (REQ-023, REQ-024):
 *   1. AC-023-1 fix-issue, implement-trd-beads and pr-merge each reach the
 *      verified-findings, convergence and tier behaviour THROUGH the skill;
 *   2. AC-023-2 Claude, Pi, Codex and OpenCode carry the same procedures and
 *      subcommands, or the report states what is reduced;
 *   3. AC-023-3 the in-agent review needs no new CI secret;
 *   4. AC-024-2 credential-like text is redacted by every new lib -- proved
 *      by pushing a real credential THROUGH each lib and reading its output.
 */

const fs = require('fs');
const { readSkillBundle } = require('./helpers/pr-review-cycle-skill');
const path = require('path');

const {
  traceCapabilities,
  compareRuntimes,
  gradeSecretHygiene,
  RUNTIMES,
} = require('../lib/pr-review-reachability');
const { HANDLERS } = require('../lib/pr-review-cli');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const read = (relative) => fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(REPO_ROOT, relative));

/** The three real entry points REQ-023 names, and where their text lives. */
const ENTRY_POINTS = [
  { id: 'fix-issue', file: 'packages/development/commands/fix-issue.yaml' },
  { id: 'implement-trd-beads', file: 'packages/development/commands/implement-trd-beads.yaml' },
  { id: 'pr-merge', file: 'packages/git/commands/pr-merge.yaml' },
];

/** Every pr-review procedure skill shipped from the development package. */
const SKILL_IDS = ['pr-review-cycle', 'pr-review-eval', 'pr-review-explainer', 'pr-review-sweep'];

const skillRecords = (base) =>
  SKILL_IDS.filter((id) => exists(`${base}/${id}/SKILL.md`)).map((id) => ({
    id,
    path: `${base}/${id}/SKILL.md`,
    text: id === 'pr-review-cycle' && base === 'packages/development/skills' ? readSkillBundle() : read(`${base}/${id}/SKILL.md`),
  }));

// ---------------------------------------------------------------------------
// AC-023-1: reached from the real entry points, through the real skill
// ---------------------------------------------------------------------------

describe('TRD-037 AC-023-1: the real entry points reach the real behaviour', () => {
  const entryPoints = ENTRY_POINTS.map((entry) => ({ id: entry.id, text: read(entry.file) }));
  const skills = skillRecords('packages/development/skills');
  const subcommands = Object.keys(HANDLERS);
  const result = traceCapabilities({ entryPoints, skills, subcommands });

  test('every entry point reaches verified-findings, convergence and tier', () => {
    expect(result.ok).toBe(true);
    expect(result.unreachable).toEqual([]);

    for (const entry of ENTRY_POINTS) {
      const trace = result.entryPoints.find((item) => item.id === entry.id);
      expect(trace).toBeDefined();
      expect(trace.unreachable).toEqual([]);
      expect(trace.reached.slice().sort()).toEqual(['convergence', 'mode', 'tier', 'verified-findings']);
    }
  });

  test('each capability names the skill and subcommand that carried it', () => {
    for (const entry of ENTRY_POINTS) {
      const trace = result.entryPoints.find((item) => item.id === entry.id);
      for (const capability of trace.capabilities) {
        expect(capability.via.length).toBeGreaterThan(0);
        for (const link of capability.via) {
          expect(SKILL_IDS).toContain(link.skill);
          expect(subcommands).toContain(link.subcommand);
        }
      }
    }
  });

  test('the chain goes THROUGH the skill: no entry point calls the CLI directly', () => {
    // The TRD integration contract: "callers invoke the skill". A direct CLI
    // reference would bypass the procedure the proof is about.
    for (const entry of result.entryPoints) {
      expect(entry.directCliReferences).toEqual([]);
      expect(entry.skills).toContain('pr-review-cycle');
    }
  });

  test('the proof can fail: breaking the real chain makes the real capability unreachable', () => {
    // Without this, a green result above would prove only that the grader is
    // permissive. Remove `votes` from the CLI handler list and the same real
    // inputs must report verified-findings as unreachable.
    const broken = traceCapabilities({
      entryPoints,
      skills,
      subcommands: subcommands.filter((name) => name !== 'votes'),
    });
    expect(broken.ok).toBe(false);
    expect(broken.unreachable).toContain('verified-findings');

    // And an entry point whose text lost the skill reference reaches nothing.
    const severed = traceCapabilities({
      entryPoints: [{ id: 'fix-issue', text: 'Fix the issue and open a PR.' }],
      skills,
      subcommands,
    });
    expect(severed.ok).toBe(false);
    expect(severed.entryPoints[0].reason).toBe('entry-point-reaches-no-skill');
  });

  test('the reachability grader is itself reachable: the CLI registers it', () => {
    expect(Object.keys(HANDLERS)).toContain('reachability');
  });
});

// ---------------------------------------------------------------------------
// AC-023-2: the four runtimes, and an honest statement of what is reduced
// ---------------------------------------------------------------------------

/**
 * What each runtime's installable bundle really carries.
 *
 * Claude is the baseline (the source packages). Pi vendors both the skills
 * and the CLI. Codex and OpenCode generate command artifacts but bundle only
 * FRAMEWORK skills -- `scripts/generate-codex/index.js` rewrites a fixed
 * framework list, and `scripts/generate-opencode` copies
 * `packages/<pkg>/skills/SKILL.md`, a layout the multi-skill development
 * package does not use. That is a real reduction, and it is stated rather
 * than papered over.
 */
function runtimeInventory() {
  const subcommandsOf = (relative) => {
    if (!exists(relative)) return [];
    const module = require(path.join(REPO_ROOT, relative));
    return module.HANDLERS === undefined ? [] : Object.keys(module.HANDLERS);
  };

  const codexSkills = SKILL_IDS.filter((id) => exists(`packages/codex/.codex/skills/${id}/SKILL.md`));
  const opencodeSkills = SKILL_IDS.filter((id) => exists(`dist/opencode/.opencode/skill/${id}/SKILL.md`));

  return {
    claude: {
      procedures: skillRecords('packages/development/skills').map((skill) => skill.id),
      subcommands: subcommandsOf('packages/development/lib/pr-review-cli.js'),
    },
    pi: {
      procedures: skillRecords('packages/pi/skills').map((skill) => skill.id),
      subcommands: subcommandsOf('packages/pi/vendor/lib/pr-review-cli.js'),
    },
    codex: { procedures: codexSkills, subcommands: [] },
    opencode: { procedures: opencodeSkills, subcommands: [] },
  };
}

describe('TRD-037 AC-023-2: runtime equivalence, or a stated reduction', () => {
  const comparison = compareRuntimes({ runtimes: runtimeInventory(), baseline: 'claude' });

  test('the comparison is readable and covers all four runtimes', () => {
    expect(comparison.ok).toBe(true);
    expect(comparison.report.map((entry) => entry.runtime).sort()).toEqual(RUNTIMES.slice().sort());
  });

  test('Pi is equivalent to the Claude baseline: same procedures, same subcommands', () => {
    const pi = comparison.report.find((entry) => entry.runtime === 'pi');
    expect(pi.present).toBe(true);
    expect(pi.missingProcedures).toEqual([]);
    expect(pi.missingSubcommands).toEqual([]);
    expect(pi.equivalent).toBe(true);
  });

  test('Codex and OpenCode are REDUCED, and the report says so in words', () => {
    // The honest result for this checkout. Both runtimes get the command
    // entry points, but neither bundles the pr-review procedure skills or a
    // vendored CLI, so the behaviour is not equivalent and must not be
    // reported as if it were.
    for (const name of ['codex', 'opencode']) {
      const entry = comparison.report.find((item) => item.runtime === name);
      expect(entry.equivalent).toBe(false);
      expect(entry.missingProcedures).toContain('pr-review-cycle');
      expect(entry.reduction).toMatch(/pr-review-cycle/);
    }

    expect(comparison.equivalent).toBe(false);
    expect(comparison.reductions.length).toBeGreaterThan(0);
  });

  test('the stated reduction is published where a maintainer will read it', () => {
    const report = read('docs/reports/pr-review-cross-runtime-reachability.md');
    for (const name of RUNTIMES) expect(report).toMatch(new RegExp(name, 'i'));
    // It must name the reduction, not merely mention the runtimes.
    expect(report).toMatch(/pr-review-cycle/);
    expect(report).toMatch(/reduced/i);
  });
});

// ---------------------------------------------------------------------------
// AC-023-3: no new CI secret
// ---------------------------------------------------------------------------

describe('TRD-037 AC-023-3: the in-agent review needs no new CI secret', () => {
  /** Workflow texts this TRD added or touched for review automation. */
  function reviewWorkflows() {
    const dir = path.join(REPO_ROOT, '.github', 'workflows');
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((name) => /\.ya?ml$/.test(name))
      .filter((name) => /review/i.test(name))
      .map((name) => ({ path: `.github/workflows/${name}`, text: fs.readFileSync(path.join(dir, name), 'utf8') }));
  }

  test('no review workflow requires a secret beyond those that already existed', () => {
    // The allow-list is PRE-EXISTING secrets only, each verified against git
    // history rather than assumed:
    //   GITHUB_TOKEN           injected by Actions; never configured by anyone
    //   CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY
    //                          added with .github/workflows/claude-code-review.yml
    //                          in 3765f11 (2025-12-29), ~10 months before this TRD
    // AC-023-3 is about what THIS TRD requires: adding a name here is only
    // honest for a secret that demonstrably pre-dates it.
    const result = gradeSecretHygiene({
      workflows: reviewWorkflows(),
      allowedSecrets: ['GITHUB_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'],
      hostedReviewerConfigured: false,
      samples: [],
    });

    expect(result.newSecrets).toEqual([]);
    expect(result.inAgentReviewRuns).toBe(true);
    expect(result.notes).toContain('hosted-reviewer-not-configured');
  });

  test('the proof can fail: a workflow needing a genuinely new secret is caught', () => {
    const result = gradeSecretHygiene({
      workflows: [
        ...reviewWorkflows(),
        { path: '.github/workflows/hypothetical.yml', text: 'key: ${{ secrets.NEW_REVIEWER_KEY }}' },
      ],
      allowedSecrets: ['GITHUB_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'],
      samples: [],
    });

    expect(result.ok).toBe(false);
    expect(result.newSecrets).toEqual([{ secret: 'NEW_REVIEWER_KEY', path: '.github/workflows/hypothetical.yml' }]);
    expect(result.inAgentReviewRuns).toBe(false);
  });

  test('the in-agent review path holds no network call and no credential read', () => {
    // The structural reason no new secret is needed: every graded fact is a
    // pure local module. If one of these ever reached the network, the "no
    // new CI secret" promise would quietly become false.
    const libs = fs
      .readdirSync(path.join(REPO_ROOT, 'packages/development/lib'))
      .filter((name) => name.startsWith('pr-review-') && name.endsWith('.js'))
      .filter((name) => name !== 'pr-review-cli.js' && name !== 'pr-review-state.js');

    for (const name of libs) {
      const source = read(`packages/development/lib/${name}`);
      expect(source).not.toMatch(/require\('(https?|net|child_process)'\)/);
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toMatch(/process\.env\.[A-Z_]*(TOKEN|KEY|SECRET)/);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-024-2: a real credential, pushed through every new lib
// ---------------------------------------------------------------------------

describe('TRD-037 AC-024-2: no lib reproduces a credential it was shown', () => {
  // A token-shaped value the redaction is expected to recognise. It is not a
  // real credential; it is the shape of one.
  const SECRET = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  /**
   * Pushes SECRET through each new lib's real entry point and collects what
   * each one actually returned. This is the measurement AC-024-2 asks for --
   * not an inspection of the redaction helper, but of every output path that
   * could carry a credential to a finding, comment or ledger entry.
   */
  function samples() {
    const { normalizeFinding, recordResolution } = require('../lib/pr-review-ledger');
    const { tallyVotes } = require('../lib/pr-review-votes');
    const { redact } = require('../lib/pr-review-state');

    const finding = {
      id: 'f1',
      severity: 'Important',
      locationOrLink: 'lib/x.js:3',
      failureMode: `leaked token ${SECRET}`,
      evidence: `Authorization: Bearer ${SECRET}`,
    };

    const collected = [
      { lib: 'pr-review-ledger (normalizeFinding)', secret: SECRET, output: normalizeFinding(finding) },
      {
        lib: 'pr-review-ledger (recordResolution)',
        secret: SECRET,
        output: recordResolution(finding, { reason: `rotated ${SECRET}`, by: 'alice' }),
      },
      {
        // The error path, not just the happy path: a REFUSED resolution
        // echoes the finding back, and that echo must be redacted too.
        lib: 'pr-review-ledger (recordResolution refusal)',
        secret: SECRET,
        output: recordResolution(finding, { reason: '' }),
      },
      { lib: 'pr-review-state (redact)', secret: SECRET, output: redact({ note: `token ${SECRET}` }) },
      {
        lib: 'pr-review-votes (tallyVotes)',
        secret: SECRET,
        output: tallyVotes({
          depth: 'standard',
          findings: [{ ...normalizeFinding(finding), reviewer: 'r', votes: [{ verifier: 'v1', verdict: 'real' }] }],
        }),
      },
    ];
    return collected;
  }

  test('every sampled lib returns output with the credential removed', () => {
    const result = gradeSecretHygiene({ workflows: [], allowedSecrets: [], samples: samples() });

    expect(result.leaks).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.libsChecked.length).toBeGreaterThanOrEqual(4);
  });

  test('the check can fail: an unredacted output is caught and named', () => {
    // Proof that the assertion above is not vacuous.
    const result = gradeSecretHygiene({
      workflows: [],
      allowedSecrets: [],
      samples: [...samples(), { lib: 'deliberately-unredacted', secret: SECRET, output: { note: SECRET } }],
    });

    expect(result.ok).toBe(false);
    expect(result.leaks).toEqual([{ lib: 'deliberately-unredacted', where: 'note' }]);
  });
});
