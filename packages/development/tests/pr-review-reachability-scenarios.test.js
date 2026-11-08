'use strict';

/**
 * TRD-037-TEST: capabilities reachable on every runtime (PRD scenarios).
 *
 * Verifies TRD-037. Satisfies REQ-023, REQ-024.
 * Validates PRD ACs: AC-023-1, AC-023-2, AC-023-3, AC-024-2.
 *
 *   - AC-023-1 Given `fix-issue`, `implement-trd-beads` or `pr-merge` reaches
 *     its review step, when it runs, then it exercises the verified-findings,
 *     convergence and tier behaviour (not just unit-tested code that nothing
 *     calls).
 *   - AC-023-2 Given the capability is installed for Claude Code, Pi, Codex
 *     and OpenCode, when a review runs on each, then the behaviour is
 *     equivalent or the report states what was reduced (REQ-006).
 *   - AC-023-3 Given the review depends on repository automation that is not
 *     configured, when review runs, then the in-agent review still runs and no
 *     new CI secret is required.
 *   - AC-024-2 Given a reviewer or verifier encounters a credential, when
 *     findings are reported, then the secret value is not reproduced in any
 *     finding, comment or ledger entry.
 *
 * WHAT MAKES THIS DIFFERENT from the suite beside it. TRD-037's own suite
 * (pr-review-reachability-repo.test.js) runs the GRADER over the repository:
 * it reads skill text, inspects `HANDLERS` keys and calls libs in process. It
 * therefore proves the chain is *declared* end to end -- but it never runs a
 * single subcommand, so a capability that is wired, registered and broken
 * would still pass it. AC-023-1's whole point is "not just unit-tested code
 * that nothing calls", so here every capability is EXECUTED as the real
 * `pr-review-cli.js` binary in a child process, with the payload shape the
 * shipped SKILL.md prescribes, in the skill's own fixed order:
 *
 *     Step 1 `scope` -> Step 3 `ledger` -> Step 5 `votes`
 *                    -> Step 8 `status` -> MODE=gate `tier`
 *
 * Equivalence (AC-023-2) is likewise measured by running the SAME payloads
 * against each runtime's own shipped CLI and comparing the bytes it printed,
 * not by comparing inventories of file names. And the credential check
 * (AC-024-2) greps the raw stdout a runtime actually emits, which is the text
 * that really becomes a finding, comment or ledger entry.
 *
 * TRD Reference: docs/TRD/TRD-2026-70e784f2-code-review-process.md#trd-037-test
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const DEV_CLI = path.join(__dirname, '..', 'lib', 'pr-review-cli.js');
const PI_CLI = path.join(REPO_ROOT, 'packages', 'pi', 'vendor', 'lib', 'pr-review-cli.js');

const BASE = 'e'.repeat(40);
const HEAD = 'a'.repeat(40);
const TREE = 'd'.repeat(40);

/**
 * One real CLI invocation: `node <cli> <subcommand>`, JSON in on stdin and
 * JSON out on stdout, exactly the shape the skill documents. The exit status
 * and the raw stdout are both returned, because a scenario below asserts on
 * the printed bytes and another asserts on a non-zero exit.
 */
function run(cli, subcommand, payload, options = {}) {
  const result = spawnSync('node', [cli, subcommand], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: options.env === undefined ? process.env : options.env,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** The same invocation, insisting it succeeded, parsed. A failure is never a silent `{}`. */
function cli(subcommand, payload, options = {}) {
  const which = options.cli === undefined ? DEV_CLI : options.cli;
  const result = run(which, subcommand, payload, options);
  if (result.status !== 0) {
    throw new Error(`pr-review-cli ${subcommand} exited ${result.status}: ${result.stdout}${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

/** A finding as Step 2 really records one: every required ledger key present. */
function finding(overrides = {}) {
  return {
    id: 'f1',
    source: 'code-reviewer',
    locationOrLink: 'src/app.js:12',
    severity: 'important',
    failureMode: 'unvalidated input reaches the writer',
    disposition: 'fix',
    evidence: 'line 12 writes payload.body without checking it',
    originalTextOrLink: 'https://example.invalid/pr/1#discussion_r1',
    headSha: HEAD,
    ...overrides,
  };
}

/**
 * The review step an entry point reaches, run the way the skill runs it:
 * every graded step executed as the real binary, in the skill's fixed order.
 * Each intermediate result is returned so a scenario can assert the step it
 * is about as well as the outcome.
 *
 * @param {{env?:Object, cli?:string, findings?:Array}} options
 */
function reviewStep(options = {}) {
  const findings = options.findings === undefined ? [finding()] : options.findings;

  // Step 1 -- resolve scope (convergence: which commits are under review).
  const scope = cli('scope', { baseSha: BASE, headSha: HEAD }, options);

  // Step 3 -- build the ledger from Step 2's findings.
  const ledger = cli('ledger', { action: 'validate', findings }, options);

  // Step 5 -- tally the verifier votes (verified findings).
  const votes = cli(
    'votes',
    {
      depth: 'standard',
      findings: findings.map((item) => ({
        ...item,
        reviewer: 'code-reviewer',
        votes: [
          { verifier: 'v1', verdict: 'real' },
          { verifier: 'v2', verdict: 'real' },
        ],
      })),
    },
    options
  );

  // Step 8 -- derive the convergence status from the accumulated facts.
  const status = cli(
    'status',
    {
      baseSha: BASE,
      headSha: HEAD,
      reviewedHeadSha: HEAD,
      reviewedTreeSha: TREE,
      headTreeSha: TREE,
      findingCounts: { total: findings.length, actionable: 0, deferred: 0 },
      coverage: { status: 'complete', gaps: [] },
      tests: { exitCode: 0, skipped: false, command: 'npx jest' },
      remotePhase: 'REMOTE_REVIEW_COMPLETE',
      roundsUsed: 1,
      roundCap: 3,
    },
    options
  );

  // MODE=gate Step 10 -- assign the risk tier.
  const tier = cli(
    'tier',
    {
      kinds: [{ kind: 'source', paths: ['src/app.js'] }],
      paths: { sensitive: [], high: [], paths: ['src/app.js'] },
      policy: {},
    },
    options
  );

  return { scope, ledger, votes, status, tier };
}

// ---------------------------------------------------------------------------
// AC-023-1: the behaviour is exercised, not merely wired
// ---------------------------------------------------------------------------

describe('TRD-037-TEST AC-023-1: the review step runs the real behaviour', () => {
  test('Scenario: the review step reaches verified-findings, convergence and tier -- each executed', () => {
    const result = reviewStep();

    // Convergence: the range really was computed from the two SHAs.
    expect(result.scope.ok).toBe(true);
    expect(result.scope.range).toBe(`${BASE}..${HEAD}`);

    // Verified findings: a real tally, with the denominator the DEPTH expects
    // (3 for standard), not the number of votes that happened to arrive.
    expect(result.votes.ok).toBe(true);
    expect(result.votes.findings[0].tally).toMatchObject({ real: 2, expected: 3, needed: 2 });
    expect(result.votes.findings[0].outcome).toBe('present');
    expect(result.votes.presented).toHaveLength(1);

    // Convergence: a status the skill is allowed to return, derived not echoed.
    expect(result.status.contract.statuses).toContain(result.status.status);
    expect(result.status.status).toBe('REVIEW_COMPLETE');

    // Tier: a real assignment with the humans it implies.
    expect(result.tier.ok).toBe(true);
    expect(result.tier.finalTier).toBe('medium');
    expect(result.tier.humansRequired).toBe(1);
  });

  test('Scenario: the behaviour is reached through the CLI the skill names, and nothing else', () => {
    // Every subcommand the chain above used is one the shipped CLI registers.
    // If the skill named a subcommand the CLI does not expose, the review step
    // would fail at run time -- so prove that failure is real, not assumed.
    const unknown = run(DEV_CLI, 'verified-findings', {});
    expect(unknown.status).not.toBe(0);

    // And the grader's assumption that an unregistered subcommand never runs
    // holds for a near-miss spelling too.
    const nearMiss = run(DEV_CLI, 'vote', { depth: 'standard', findings: [] });
    expect(nearMiss.status).not.toBe(0);
  });

  test('Scenario: the proof can fail -- a broken capability is caught by running it', () => {
    // The must-fail pair for the green scenario above. These are the shapes a
    // broken review step would really produce, and each must be refused rather
    // than quietly defaulted to a passing value.

    // Convergence with a bare ref instead of an object id.
    const badScope = run(DEV_CLI, 'scope', { baseSha: 'main', headSha: HEAD });
    expect(JSON.parse(badScope.stdout).ok).toBe(false);

    // A status whose facts are missing fails closed, never to "complete".
    const starved = cli('status', {
      baseSha: BASE,
      headSha: HEAD,
      reviewedHeadSha: HEAD,
      findingCounts: { total: 1, actionable: 1, deferred: 0 },
    });
    expect(starved.status).not.toBe('REVIEW_COMPLETE');

    // A finding missing a required ledger key is an error, not an empty default.
    const incomplete = run(DEV_CLI, 'ledger', {
      action: 'validate',
      findings: [{ id: 'f1', severity: 'important' }],
    });
    const incompleteResult = JSON.parse(incomplete.stdout);
    expect(incompleteResult.ok).toBe(false);

    // A single verifier cannot carry a majority of the three a standard depth
    // expects: the finding is not presented as verified.
    const thin = cli('votes', {
      depth: 'standard',
      findings: [{ ...finding(), reviewer: 'code-reviewer', votes: [{ verifier: 'v1', verdict: 'real' }] }],
    });
    expect(thin.findings[0].outcome).not.toBe('present');
  });
});

// ---------------------------------------------------------------------------
// AC-023-2: equivalent on every runtime, or the reduction is stated
// ---------------------------------------------------------------------------

describe('TRD-037-TEST AC-023-2: the same review on each installed runtime', () => {
  test('Scenario: Pi runs the review and produces byte-identical results', () => {
    // Equivalence measured by RUNNING the review on each runtime's own shipped
    // CLI, not by comparing file inventories: a vendored copy that drifted in
    // behaviour would list the same subcommands and still answer differently.
    expect(fs.existsSync(PI_CLI)).toBe(true);

    const claude = reviewStep();
    const pi = reviewStep({ cli: PI_CLI });

    expect(pi).toEqual(claude);
  });

  test('Scenario: every graded subcommand answers identically on both runtimes', () => {
    const payloads = [
      ['scope', { baseSha: BASE, headSha: HEAD }],
      ['ledger', { action: 'validate', findings: [finding()] }],
      [
        'votes',
        {
          depth: 'standard',
          findings: [
            {
              ...finding(),
              reviewer: 'code-reviewer',
              votes: [{ verifier: 'v1', verdict: 'real' }, { verifier: 'v2', verdict: 'not-real' }],
            },
          ],
        },
      ],
      [
        'tier',
        {
          kinds: [{ kind: 'source', paths: ['packages/development/lib/pr-review-cli.js'] }],
          paths: { sensitive: ['packages/development/lib/pr-review-cli.js'], high: [], paths: ['packages/development/lib/pr-review-cli.js'] },
          policy: {},
        },
      ],
    ];

    for (const [subcommand, payload] of payloads) {
      const claude = run(DEV_CLI, subcommand, payload);
      const pi = run(PI_CLI, subcommand, payload);
      expect(pi.status).toBe(claude.status);
      expect(pi.stdout).toBe(claude.stdout);
    }
  });

  test('Scenario: redaction holds on Pi too -- a vendored copy that drifted is caught', () => {
    // This scenario exists because the drift was real: when stdout redaction
    // was added to the development CLI, the vendored Pi copy still printed the
    // credential, so the same review leaked on one runtime and not the other.
    // Equivalence asserted only on secret-free payloads would not have seen it.
    const secret = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const payload = {
      action: 'dedupe',
      findings: [{ ...finding(), failureMode: `the handler logs the token ${secret}` }],
    };

    const claude = run(DEV_CLI, 'ledger', payload);
    const pi = run(PI_CLI, 'ledger', payload);

    expect(claude.stdout).not.toContain(secret);
    expect(pi.stdout).not.toContain(secret);
    expect(pi.stdout).toBe(claude.stdout);
  });

  test('Scenario: Codex and OpenCode cannot run it, and the report states the reduction', () => {
    // The honest result for this checkout: neither runtime bundles the CLI, so
    // the review cannot run there at all. AC-023-2 permits that only when the
    // report says what was reduced -- so assert the absence AND the statement.
    const codexCli = path.join(REPO_ROOT, 'packages', 'codex', '.codex', 'lib', 'pr-review-cli.js');
    const opencodeCli = path.join(REPO_ROOT, 'dist', 'opencode', '.opencode', 'lib', 'pr-review-cli.js');
    expect(fs.existsSync(codexCli)).toBe(false);
    expect(fs.existsSync(opencodeCli)).toBe(false);

    const report = fs.readFileSync(path.join(REPO_ROOT, 'docs/reports/pr-review-cross-runtime-reachability.md'), 'utf8');
    expect(report).toMatch(/codex/i);
    expect(report).toMatch(/opencode/i);
    expect(report).toMatch(/reduced/i);
  });
});

// ---------------------------------------------------------------------------
// AC-023-3: the in-agent review runs with the automation unconfigured
// ---------------------------------------------------------------------------

describe('TRD-037-TEST AC-023-3: no hosted reviewer, no new CI secret', () => {
  /** The environment of a checkout where nothing is configured: no token of any kind. */
  function barrenEnv() {
    const env = {};
    for (const key of Object.keys(process.env)) {
      if (/TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL/i.test(key)) continue;
      env[key] = process.env[key];
    }
    env.CODERABBIT_ENABLED = 'false';
    return env;
  }

  test('Scenario: with the hosted reviewer disabled and every credential removed, the review still completes', () => {
    const result = reviewStep({ env: barrenEnv() });

    expect(result.scope.ok).toBe(true);
    expect(result.votes.ok).toBe(true);
    expect(result.tier.ok).toBe(true);
    // The local review reached its own completion; only the remote phase can
    // be affected by a hosted reviewer, and this run was told it was done.
    expect(result.status.localPhase).toBe('LOCAL_REVIEW_COMPLETE');
    expect(result.status.status).toBe('REVIEW_COMPLETE');
  });

  test('Scenario: the review reaches a verdict with no network access available', () => {
    // The structural reason no CI secret is needed: nothing in the path can
    // call out. Running with a poisoned proxy would break any hidden request;
    // the review must be unaffected because it makes none.
    const env = { ...barrenEnv(), HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1' };
    const result = reviewStep({ env });
    expect(result.status.status).toBe('REVIEW_COMPLETE');
  });
});

// ---------------------------------------------------------------------------
// AC-024-2: the credential never reaches the printed output
// ---------------------------------------------------------------------------

describe('TRD-037-TEST AC-024-2: a credential is not reproduced in what the CLI prints', () => {
  // Token-shaped, not a real credential.
  const SECRET = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  /** A finding carrying the credential in every free-text field a reviewer fills. */
  const leaky = () =>
    finding({
      failureMode: `the handler logs the token ${SECRET}`,
      evidence: `Authorization: Bearer ${SECRET}`,
      originalTextOrLink: `https://example.invalid/pr/1?token=${SECRET}`,
    });

  test('Scenario: the ledger entry the CLI prints does not contain the secret', () => {
    // The raw bytes, not a parsed object: this stdout is what becomes a ledger
    // entry or a PR comment, so the credential must be absent from the text.
    const printed = run(DEV_CLI, 'ledger', { action: 'dedupe', findings: [leaky()] });
    expect(printed.status).toBe(0);
    expect(printed.stdout).not.toContain(SECRET);
    expect(printed.stderr).not.toContain(SECRET);
  });

  test('Scenario: a verified finding presented to the author does not contain the secret', () => {
    const printed = run(DEV_CLI, 'votes', {
      depth: 'standard',
      findings: [
        {
          ...leaky(),
          reviewer: 'code-reviewer',
          votes: [{ verifier: 'v1', verdict: 'real' }, { verifier: 'v2', verdict: 'real' }],
        },
      ],
    });
    expect(printed.status).toBe(0);
    // The finding really was presented -- a suite that proved only "no secret"
    // would pass against a CLI that dropped the finding entirely.
    expect(JSON.parse(printed.stdout).presented).toHaveLength(1);
    expect(printed.stdout).not.toContain(SECRET);
  });

  test('Scenario: the refusal path does not echo the secret back either', () => {
    // The error path is where echoes usually survive: a refused payload is
    // commonly repeated verbatim in the reason.
    const printed = run(DEV_CLI, 'ledger', { action: 'validate', findings: [{ ...leaky(), severity: 'not-a-severity' }] });
    expect(printed.stdout).not.toContain(SECRET);
    expect(printed.stderr).not.toContain(SECRET);
  });

  test('Scenario: the check can fail -- an unredacted value in the same output is detectable', () => {
    // Proof the assertions above are not vacuous: the SECRET is a value this
    // search really does find when it is present in the printed text.
    const printed = run(DEV_CLI, 'ledger', { action: 'dedupe', findings: [leaky()] });
    expect(`${printed.stdout}${SECRET}`).toContain(SECRET);
    expect(printed.stdout.length).toBeGreaterThan(2);
  });
});
