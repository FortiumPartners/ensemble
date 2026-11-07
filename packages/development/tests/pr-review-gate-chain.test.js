'use strict';

/**
 * End-to-end BEFORE/AFTER chains for the PR-review approval gate.
 *
 * Every case here is a CHAIN on one PR's recorded state: a real sequence of
 * `pr-review-cli` operations (`paths` -> `tier` -> `approvals` -> `description`
 * -> `gate`, plus `status`, `votes`, `slices`, `state-write`, `state-read`),
 * graded BEFORE a single state change and again AFTER it. The verdict is
 * asserted in both directions, so each case flips exactly one input and
 * expects exactly one verdict flip: remove the guard it covers and the case
 * fails (the "mutation-sensitivity" rule of the plan, section 3F: approval-
 * gate and path code keep a chain harness that runs on every gate change).
 *
 * Nothing is hand-built that the real chain would produce: the approvals, tier
 * and description inputs of the gate come out of the CLI handlers, never out
 * of literals, so a case cannot pass against a shape the gate never receives.
 *
 * Most chains call the CLI's exported handlers through `HANDLERS` (with a JSON
 * round trip, so what crosses the boundary is exactly what stdout would carry).
 * The `real process` block drives the same chains through
 * `node pr-review-cli.js <subcommand>` over stdin/stdout, so the true entry
 * point is exercised too.
 *
 * Deterministic: no clock, no randomness, no network, no git, no host config.
 * The only filesystem use is a temp dir for the state-file chains, removed
 * after the run.
 *
 * Plan reference: docs/plans/pr-review-speedup-plan.md section 3F.
 * Modules: lib/pr-review-cli.js, pr-review-gate.js, pr-review-approvals.js,
 * pr-review-tier.js, pr-review-ledger.js, pr-review-votes.js,
 * pr-review-depth.js, pr-review-status.js, pr-review-state.js.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const cli = require('../lib/pr-review-cli');
const { recordResolution, recordOperatorResolution, clearFixedFindings } = require('../lib/pr-review-ledger');

const CLI_PATH = path.join(__dirname, '..', 'lib', 'pr-review-cli.js');

const BASE = 'e'.repeat(40);
const HEAD_A = 'a'.repeat(40);
const HEAD_B = 'b'.repeat(40);
const TREE_X = '1'.repeat(40);
const TREE_Y = '2'.repeat(40);

const POLICY = Object.freeze({ botLogins: ['coderabbitai'], maintainerLogins: ['maintainer-m'] });

const DESCRIPTION = [
  '## Summary',
  '',
  'Adds a widget.',
  '',
  '## Testing',
  '',
  '`npx jest` in packages/development.',
  '',
  '## Risk',
  '',
  'Low.',
  '',
  '## How to revert',
  '',
  'Revert the commit.',
  '',
].join('\n');

// --- Runners: the same chain over the in-process handlers or a real process. -------------------

const inProcess = (subcommand, payload) => {
  const result = cli.HANDLERS[subcommand](JSON.parse(JSON.stringify(payload)));
  return JSON.parse(JSON.stringify(result));
};

const viaProcess = (subcommand, payload) => {
  const run = spawnSync('node', [CLI_PATH, subcommand], { input: JSON.stringify(payload), encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`pr-review-cli ${subcommand} exited ${run.status}: ${run.stdout}${run.stderr}`);
  return JSON.parse(run.stdout);
};

// --- One PR's recorded state, and the full chain that grades it. -------------------------------

/** An ordinary product PR, one human approval on the current head, nothing open. */
function makePr(overrides = {}) {
  return {
    head: HEAD_A,
    headTree: undefined,
    changedPaths: ['packages/development/lib/widget.js'],
    kind: 'product',
    author: 'author-a',
    policy: POLICY,
    secondAssessment: undefined,
    evidence: undefined,
    enabledBy: undefined,
    directedBy: undefined,
    agentAuthored: undefined,
    reviews: [{ author: 'human-a', state: 'APPROVED', commitSha: HEAD_A }],
    approvalsEvaluatedAt: undefined, // evaluate approvals against another head than the gate's (a stale result)
    ledger: [],
    security: { status: 'clean', findings: [] },
    body: DESCRIPTION,
    unavailable: undefined,
    ...overrides,
  };
}

/** paths -> tier -> approvals -> description -> gate, exactly as the skill chains them. */
function attempt(run, pr) {
  const paths = run('paths', { changedPaths: pr.changedPaths, baseSha: BASE, ...(pr.declaration ? { declaration: pr.declaration } : {}) });
  const tier = run('tier', {
    paths,
    kinds: [{ kind: pr.kind, paths: pr.changedPaths }],
    secondAssessment: pr.secondAssessment,
    policy: pr.policy,
    evidence: pr.evidence,
    enabledBy: pr.enabledBy,
    author: pr.author,
  });
  const approvals = run('approvals', {
    reviews: pr.reviews,
    headSha: pr.approvalsEvaluatedAt || pr.head,
    headTreeSha: pr.headTree,
    tier,
    policy: pr.policy,
    author: pr.author,
    directedBy: pr.directedBy,
    agentAuthored: pr.agentAuthored,
  });
  const description = run('description', { body: pr.body, agentAuthored: false });
  const gate = run('gate', {
    headSha: pr.head,
    policy: pr.policy,
    ledger: pr.ledger,
    approvals,
    tier,
    description,
    security: pr.security,
    unavailable: pr.unavailable,
  });
  return { tier, approvals, description, gate };
}

const codes = (gate) => gate.blockers.map((blocker) => blocker.code).sort();

const finding = (overrides = {}) => ({
  id: 'F-1',
  source: 'code-reviewer',
  locationOrLink: 'packages/development/lib/widget.js:12',
  severity: 'important',
  failureMode: 'unvalidated input reaches the writer',
  disposition: 'fix',
  evidence: 'line 12 writes payload.body unchecked',
  originalTextOrLink: 'https://example.invalid/pr/1#r1',
  headSha: HEAD_A,
  ...overrides,
});

const securityFinding = (overrides = {}) =>
  finding({
    id: 'S-1',
    source: 'security-reviewer',
    locationOrLink: 'packages/development/lib/widget.js:44',
    failureMode: 'the bearer token is logged in plain text',
    evidence: 'line 44 passes the token to console.log',
    ...overrides,
  });

/** A review record from `who` on `commitSha`. */
const approve = (who, commitSha = HEAD_A, extra = {}) => ({ author: who, state: 'APPROVED', commitSha, ...extra });

const DECIDED_AT = '2026-11-07T10:00:00Z';

/**
 * The operator's recorded decision on `target`, as the gate honours one: a stated reason, a login the policy lets
 * decide, a time, and the head it was decided against (`headSha`, which must be the head the gate is asked about).
 */
function decide(target, headSha = HEAD_A, overrides = {}) {
  const decision = { reason: 'accepted: the caller validates', by: 'maintainer-m', headSha, at: DECIDED_AT, ...overrides };
  const recorded = recordOperatorResolution(target, decision, POLICY);
  expect(recorded.ok).toBe(true);
  return recorded.finding;
}

// --- Chains. Each step is graded after its `apply` runs on the SAME evolving PR. -----------------

/**
 * A chain is `{ name, pr, steps: [{ label, apply?, mergeable, codes?, check? }] }`. The first step has no
 * `apply` (the BEFORE); every later step changes the PR state and asserts the AFTER. `codes` is the exact sorted
 * blocker code list expected ([] when mergeable).
 */
const CHAINS = [
  // ---- 1. Head moves after review --------------------------------------------------------------
  {
    name: '01 head moves A -> B: the approval given on A no longer counts at B, and re-approval on B restores it',
    pr: () => makePr(),
    steps: [
      { label: 'approved head A', mergeable: true, codes: [] },
      {
        label: 'push B (approval still names A)',
        apply: (pr) => { pr.head = HEAD_B; },
        mergeable: false,
        codes: ['approvals-unsatisfied'],
        check: ({ approvals }) => expect(approvals.ignored).toEqual([{ login: 'human-a', reason: 'stale-commit', commitSha: HEAD_A }]),
      },
      { label: 'human-a approves B', apply: (pr) => { pr.reviews.push(approve('human-a', HEAD_B)); }, mergeable: true, codes: [] },
    ],
  },
  {
    name: '02 head moves but the tree is identical (rebase/amend): the approval still counts; a different tree does not',
    pr: () => makePr({ headTree: TREE_X, reviews: [approve('human-a', HEAD_A, { treeSha: TREE_X })] }),
    steps: [
      { label: 'approved A', mergeable: true, codes: [] },
      { label: 'rebased to B, same tree', apply: (pr) => { pr.head = HEAD_B; }, mergeable: true, codes: [] },
      { label: 'B content changes (new tree)', apply: (pr) => { pr.headTree = TREE_Y; }, mergeable: false, codes: ['approvals-unsatisfied'] },
    ],
  },
  {
    name: '03 an approvals result computed at A and handed to a gate asked about B is refused as mismatched',
    pr: () => makePr({ head: HEAD_B, approvalsEvaluatedAt: HEAD_B, reviews: [approve('human-a', HEAD_B)] }),
    steps: [
      { label: 'approvals and gate both at B', mergeable: true, codes: [] },
      {
        label: 'approvals result is the one for A',
        apply: (pr) => { pr.approvalsEvaluatedAt = HEAD_A; pr.reviews = [approve('human-a', HEAD_A)]; },
        mergeable: false,
        codes: ['approvals-tier-mismatch'],
        check: ({ gate }) => expect(gate.blockers[0].problems.join(' ')).toContain(`not ${HEAD_B}`),
      },
    ],
  },
  {
    name: '04 an approval with no commit is unbound and never counts; binding it to the head makes it count',
    pr: () => makePr({ reviews: [{ author: 'human-a', state: 'APPROVED' }] }),
    steps: [
      { label: 'unbound approval', mergeable: false, codes: ['approvals-unsatisfied'], check: ({ approvals }) => expect(approvals.ignored[0].reason).toBe('unbound') },
      { label: 'bound to head', apply: (pr) => { pr.reviews = [approve('human-a')]; }, mergeable: true, codes: [] },
    ],
  },
  {
    name: '05 no head known: approvals cannot be bound and the gate refuses as unavailable data, naming headSha',
    pr: () => makePr(),
    steps: [
      { label: 'head present', mergeable: true, codes: [] },
      {
        label: 'head missing at the gate',
        apply: (pr) => { pr.head = undefined; },
        mergeable: false,
        codes: ['review-data-unavailable'],
        check: ({ gate }) => expect(gate.blockers.find((b) => b.code === 'review-data-unavailable').missing).toContain('headSha'),
      },
    ],
  },

  // ---- 2. Approvals by tier and by person ------------------------------------------------------
  {
    name: '06 High tier (sensitive path): one human is not enough, a second DISTINCT human is',
    pr: () => makePr({ changedPaths: ['.github/workflows/ci.yml'], reviews: [approve('human-a')] }),
    steps: [
      { label: 'one approver at High', mergeable: false, codes: ['approvals-unsatisfied'], check: ({ tier, gate }) => { expect(tier.effectiveTier).toBe('high'); expect(gate.blockers[0].humansRequired).toBe(2); } },
      { label: 'second distinct approver', apply: (pr) => { pr.reviews.push(approve('human-b')); }, mergeable: true, codes: [] },
    ],
  },
  {
    name: '07 High tier: the same person approving twice (any case, with or without @) is still one human',
    pr: () => makePr({ changedPaths: ['.github/workflows/ci.yml'], reviews: [approve('human-a'), approve('@Human-A')] }),
    steps: [
      { label: 'one person twice', mergeable: false, codes: ['approvals-unsatisfied'], check: ({ approvals }) => expect(approvals.humansCounted).toBe(1) },
      { label: 'a real second person', apply: (pr) => { pr.reviews.push(approve('human-b')); }, mergeable: true, codes: [] },
    ],
  },
  {
    name: '08 Medium tier needs one human: none refuses, one merges',
    pr: () => makePr({ reviews: [] }),
    steps: [
      { label: 'no approvals', mergeable: false, codes: ['approvals-unsatisfied'] },
      { label: 'one approval', apply: (pr) => { pr.reviews = [approve('human-a')]; }, mergeable: true, codes: [] },
    ],
  },
  {
    name: '09 Low waiver: a non-maintainer author still needs a human; the maintainer author with recorded evidence needs none',
    pr: () => makePr({
      changedPaths: ['docs/a.md'],
      kind: 'docs',
      author: 'outsider',
      reviews: [],
      secondAssessment: { needsAnotherPerson: false, reason: 'docs only' },
      policy: { ...POLICY, lowWaiverEnabled: true },
      evidence: { lowPrs: 25, days: 40, reverts: 0, incidents: 0 },
      enabledBy: { login: 'owner-o', isCodeOwner: true },
    }),
    steps: [
      { label: 'outsider docs PR', mergeable: false, codes: ['approvals-unsatisfied'], check: ({ tier }) => expect(tier.waiver.reason).toBe('author-not-maintainer') },
      { label: 'maintainer authors it', apply: (pr) => { pr.author = 'maintainer-m'; }, mergeable: true, codes: [], check: ({ tier, approvals }) => { expect(tier.effectiveTier).toBe('low'); expect(approvals.humansRequired).toBe(0); } },
      { label: 'a revert is recorded in the evidence', apply: (pr) => { pr.evidence = { lowPrs: 25, days: 40, reverts: 1, incidents: 0 }; }, mergeable: false, codes: ['approvals-unsatisfied'] },
    ],
  },
  {
    name: '10 bots never count: configured bot login, platform isBot flag and authorType bot are each ignored, a human then merges',
    pr: () => makePr({
      reviews: [
        approve('coderabbitai'),
        approve('some-app', HEAD_A, { isBot: true }),
        approve('other-app', HEAD_A, { authorType: 'Bot' }),
      ],
    }),
    steps: [
      { label: 'only bots approved', mergeable: false, codes: ['approvals-unsatisfied'], check: ({ approvals }) => expect(approvals.ignored.map((i) => i.reason)).toEqual(['automated', 'automated', 'automated']) },
      { label: 'a person approves too', apply: (pr) => { pr.reviews.push(approve('human-a')); }, mergeable: true, codes: [] },
    ],
  },
  {
    name: '11 the PR author approving their own PR never counts; another person does',
    pr: () => makePr({ reviews: [approve('author-a')] }),
    steps: [
      { label: 'self-approval', mergeable: false, codes: ['approvals-unsatisfied'], check: ({ approvals }) => expect(approvals.ignored[0].reason).toBe('self-approval') },
      { label: 'someone else approves', apply: (pr) => { pr.reviews.push(approve('human-a')); }, mergeable: true, codes: [] },
    ],
  },
  {
    name: '12 a later CHANGES_REQUESTED withdraws an earlier approval; a fresh approval after it restores it',
    pr: () => makePr(),
    steps: [
      { label: 'approved', mergeable: true, codes: [] },
      { label: 'human-a requests changes', apply: (pr) => { pr.reviews.push({ author: 'human-a', state: 'CHANGES_REQUESTED', commitSha: HEAD_A }); }, mergeable: false, codes: ['approvals-unsatisfied'] },
      { label: 'human-a approves again', apply: (pr) => { pr.reviews.push(approve('human-a')); }, mergeable: true, codes: [] },
    ],
  },
  {
    name: '13 a person who directed an agent-authored PR fills one slot; the same text on a human-authored PR fills none',
    pr: () => makePr({ reviews: [], directedBy: 'director-d', agentAuthored: true }),
    steps: [
      { label: 'agent PR directed by director-d', mergeable: true, codes: [], check: ({ approvals }) => expect(approvals.directedBy).toBe('director-d') },
      { label: 'not agent-authored', apply: (pr) => { pr.agentAuthored = false; }, mergeable: false, codes: ['approvals-unsatisfied'] },
    ],
  },
  {
    name: '14 High tier: director plus one approver is two humans; the director alone, or a bot as director, is not',
    pr: () => makePr({ changedPaths: ['.github/workflows/ci.yml'], reviews: [], directedBy: 'director-d', agentAuthored: true }),
    steps: [
      { label: 'director alone at High', mergeable: false, codes: ['approvals-unsatisfied'], check: ({ approvals }) => expect(approvals.humansCounted).toBe(1) },
      { label: 'plus one approver', apply: (pr) => { pr.reviews = [approve('human-a')]; }, mergeable: true, codes: [] },
      { label: 'director is a configured bot', apply: (pr) => { pr.directedBy = 'coderabbitai'; }, mergeable: false, codes: ['approvals-unsatisfied'] },
    ],
  },
  {
    name: '15 solo maintainer: High drops to one human only when the director (not the author) also approved the head, and never when the author is unknown',
    pr: () => makePr({
      changedPaths: ['secure/vault.js'],
      declaration: { sourceSha: BASE, high: ['secure/'] },
      secondAssessment: { needsAnotherPerson: false, reason: 'one maintainer repo' },
      policy: { soloMaintainer: true, maintainerLogins: ['solo-m'] },
      author: 'agent-x',
      directedBy: 'solo-m',
      agentAuthored: true,
      reviews: [],
    }),
    steps: [
      { label: 'director has not approved', mergeable: false, codes: ['approvals-unsatisfied'], check: ({ tier, approvals }) => { expect(tier.effectiveTier).toBe('high'); expect(approvals.warnings).toContain('solo-maintainer-director-not-approved'); } },
      { label: 'director approves the head', apply: (pr) => { pr.reviews = [approve('solo-m')]; }, mergeable: true, codes: [], check: ({ approvals }) => expect(approvals.soloMaintainer).toBe(true) },
      { label: 'head moves; director approval is stale', apply: (pr) => { pr.head = HEAD_B; }, mergeable: false, codes: ['approvals-unsatisfied'] },
      { label: 'director re-approves B', apply: (pr) => { pr.reviews.push(approve('solo-m', HEAD_B)); }, mergeable: true, codes: [] },
      { label: 'a sensitive path joins the PR: two humans again', apply: (pr) => { pr.changedPaths = ['secure/vault.js', '.github/workflows/ci.yml']; }, mergeable: false, codes: ['approvals-unsatisfied'] },
    ],
  },

  // ---- 3. Ledger findings ----------------------------------------------------------------------
  {
    name: '16 an open Important finding blocks and is named; fixing it on a later head (cleared) lets the PR merge',
    pr: () => makePr({ ledger: [finding()] }),
    steps: [
      { label: 'open Important', mergeable: false, codes: ['open-important-finding'], check: ({ gate }) => { expect(gate.blockers[0].findingId).toBe('F-1'); expect(gate.findings.open).toEqual(['F-1']); } },
      {
        label: 'head B changes the cited line and nobody re-reports it',
        apply: (pr) => {
          pr.head = HEAD_B;
          pr.reviews = [approve('human-a', HEAD_B)];
          const cleared = clearFixedFindings({ ledger: pr.ledger, changedLocations: ['packages/development/lib/widget.js:12'], reReported: [], headSha: HEAD_B });
          expect(cleared.cleared).toEqual(['F-1']);
          pr.ledger = cleared.findings;
        },
        mergeable: true,
        codes: [],
      },
    ],
  },
  {
    name: '17 a later head that touches other code and re-reports the finding does not clear it',
    pr: () => makePr({ ledger: [finding()] }),
    steps: [
      { label: 'open Important', mergeable: false, codes: ['open-important-finding'] },
      {
        label: 'head B changes other code, finding re-reported',
        apply: (pr) => {
          pr.head = HEAD_B;
          pr.reviews = [approve('human-a', HEAD_B)];
          const kept = clearFixedFindings({ ledger: pr.ledger, changedLocations: ['packages/development/lib/other.js:3'], reReported: [finding({ headSha: HEAD_B })], headSha: HEAD_B });
          expect(kept.cleared).toEqual([]);
          pr.ledger = kept.findings;
        },
        mergeable: false,
        codes: ['open-important-finding'],
      },
      { label: 'the operator records the decision on head B', apply: (pr) => { pr.ledger = [decide(finding({ headSha: HEAD_B }), HEAD_B)]; }, mergeable: true, codes: [] },
    ],
  },
  {
    name: "18 an Important finding is closed by the operator's recorded decision only: a reason, a login the policy lets decide, a time and THIS head",
    pr: () => makePr({ ledger: [finding()] }),
    steps: [
      {
        label: 'open Important; a blank reason records nothing',
        mergeable: false,
        codes: ['open-important-finding'],
        check: () => expect(recordOperatorResolution(finding(), { reason: '   ', by: 'maintainer-m', headSha: HEAD_A, at: DECIDED_AT }, POLICY).ok).toBe(false),
      },
      {
        label: 'a reason and a login, but no time and no head',
        apply: (pr) => { pr.ledger = [recordResolution(finding(), { reason: 'intentional: caller validates', by: 'maintainer-m' }).finding]; },
        mergeable: false,
        codes: ['open-important-finding'],
        check: ({ gate }) => expect(gate.blockers[0].resolutionRejected).toContain('timestamp'),
      },
      {
        label: 'complete, but decided against another head',
        apply: (pr) => { pr.ledger = [recordResolution(finding(), { reason: 'intentional: caller validates', by: 'maintainer-m', at: DECIDED_AT, headSha: HEAD_B }).finding]; },
        mergeable: false,
        codes: ['open-important-finding'],
        check: ({ gate }) => expect(gate.blockers[0].resolutionRejected).toContain('not the current head'),
      },
      {
        label: 'complete, but by a login the policy does not let decide',
        apply: (pr) => { pr.ledger = [recordResolution(finding(), { reason: 'intentional: caller validates', by: 'author-a', at: DECIDED_AT, headSha: HEAD_A }).finding]; },
        mergeable: false,
        codes: ['open-important-finding'],
        check: ({ gate }) => expect(gate.blockers[0].resolutionRejected).toContain('maintainerLogins'),
      },
      {
        label: 'complete, but by a bot login',
        apply: (pr) => { pr.ledger = [recordResolution(finding(), { reason: 'intentional: caller validates', by: 'coderabbitai', at: DECIDED_AT, headSha: HEAD_A }).finding]; },
        mergeable: false,
        codes: ['open-important-finding'],
        check: ({ gate }) => expect(gate.blockers[0].resolutionRejected).toContain('bot login'),
      },
      {
        label: "the operator's decision on this head",
        apply: (pr) => { pr.ledger = [decide(finding())]; },
        mergeable: true,
        codes: [],
      },
    ],
  },
  {
    name: '19 Nit and Pre-existing never block (Nit only warns); one Important added to the same ledger does',
    pr: () => makePr({ ledger: [finding({ id: 'N-1', severity: 'nit' }), finding({ id: 'P-1', severity: 'pre-existing' })] }),
    steps: [
      { label: 'nit + pre-existing', mergeable: true, codes: [], check: ({ gate }) => { expect(gate.warnings).toContain('open-nits-not-blocking'); expect(gate.findings.open).toEqual([]); } },
      { label: 'plus an Important', apply: (pr) => { pr.ledger.push(finding({ id: 'F-2' })); }, mergeable: false, codes: ['open-important-finding'], check: ({ gate }) => expect(gate.findings.open).toEqual(['F-2']) },
    ],
  },
  {
    name: '20 an unreadable severity is never demoted to Nit: it blocks as unrecognised until retagged Nit',
    pr: () => makePr({ ledger: [finding({ severity: 'cosmetic-ish' })] }),
    steps: [
      { label: 'unknown severity', mergeable: false, codes: ['open-unrecognised-finding'] },
      { label: 'retagged Nit', apply: (pr) => { pr.ledger = [finding({ severity: 'nit' })]; }, mergeable: true, codes: [] },
    ],
  },
  {
    name: "21 the review's own deferral of a non-blocking Important closes nothing at the gate; the operator's decision does",
    pr: () => makePr({ ledger: [finding({ disposition: 'deferred', blocking: false, reason: 'tracked in #12' })] }),
    steps: [
      {
        label: "deferred non-blocking Important with a reason (the triager's own word)",
        mergeable: false,
        codes: ['open-important-finding'],
        check: ({ gate }) => expect(gate.blockers[0].deferralRejected).toContain('not an operator'),
      },
      { label: 'the same, with no reason', apply: (pr) => { pr.ledger = [finding({ disposition: 'deferred', blocking: false })]; }, mergeable: false, codes: ['open-important-finding'] },
      {
        label: 'the operator records the decision on this head',
        apply: (pr) => { pr.ledger = [decide(finding({ disposition: 'deferred', blocking: false, reason: 'tracked in #12' }))]; },
        mergeable: true,
        codes: [],
      },
    ],
  },
  {
    name: '22 a resolved finding whose review thread was reopened blocks again; settling the thread lets it merge',
    pr: () => makePr({ ledger: [decide(finding())] }),
    steps: [
      { label: 'resolved', mergeable: true, codes: [] },
      { label: 'thread reopened', apply: (pr) => { pr.ledger[0] = { ...pr.ledger[0], unresolvedThread: true }; }, mergeable: false, codes: ['open-important-finding'] },
      { label: 'thread settled', apply: (pr) => { pr.ledger[0] = { ...pr.ledger[0], unresolvedThread: false }; }, mergeable: true, codes: [] },
    ],
  },
  {
    name: '23 a malformed finding (missing evidence, then an invalid disposition) fails closed as unusable data, not as a pass',
    pr: () => makePr({ ledger: [finding()] }),
    steps: [
      { label: 'complete finding', mergeable: false, codes: ['open-important-finding'] },
      {
        label: 'evidence removed',
        apply: (pr) => { pr.ledger = [finding({ id: 'F-9', severity: 'nit', evidence: undefined })]; },
        mergeable: false,
        codes: ['review-data-unavailable'],
        check: ({ gate }) => expect(gate.blockers[0].missing.join(' ')).toContain('F-9'),
      },
      { label: 'disposition invalid', apply: (pr) => { pr.ledger = [finding({ id: 'F-9', severity: 'nit', disposition: 'whatever' })]; }, mergeable: false, codes: ['review-data-unavailable'] },
      { label: 'finding repaired (Nit)', apply: (pr) => { pr.ledger = [finding({ id: 'F-9', severity: 'nit' })]; }, mergeable: true, codes: [] },
    ],
  },

  // ---- 3b. Security lane -----------------------------------------------------------------------
  {
    name: '24 an open security finding blocks and is named; the operator closing it with a stated reason records the reason and merges',
    pr: () => makePr({ security: { status: 'findings', findings: [securityFinding()] } }),
    steps: [
      { label: 'open security finding', mergeable: false, codes: ['security-finding-open'], check: ({ gate }) => { expect(gate.securityLane.open).toEqual(['S-1']); expect(gate.blockers[0].message).toContain('widget.js:44'); } },
      {
        label: 'closed with a reason',
        apply: (pr) => { pr.security = { status: 'findings', findings: [decide(securityFinding(), HEAD_A, { reason: 'false positive: redacted upstream' })] }; },
        mergeable: true,
        codes: [],
        check: ({ gate }) => expect(gate.securityLane.resolved).toEqual([{ id: 'S-1', reason: 'false positive: redacted upstream' }]),
      },
    ],
  },
  {
    name: '25 a security finding "closed" with no reason, or with a reason nobody put a login, a time and a head to, stays blocked',
    pr: () => makePr({ security: { status: 'findings', findings: [securityFinding({ disposition: 'resolved' })] } }),
    steps: [
      { label: 'resolved disposition, no reason', mergeable: false, codes: ['security-finding-open'], check: ({ gate }) => expect(gate.securityLane.resolved).toEqual([]) },
      { label: 'blank reason object', apply: (pr) => { pr.security = { status: 'findings', findings: [securityFinding({ resolution: { reason: '  ' } })] }; }, mergeable: false, codes: ['security-finding-open'] },
      {
        label: 'a real reason, but no deciding login, time or head',
        apply: (pr) => { pr.security = { status: 'findings', findings: [securityFinding({ resolution: { reason: 'accepted risk, see ADR-4' } })] }; },
        mergeable: false,
        codes: ['security-finding-open'],
        check: ({ gate }) => expect(gate.blockers[0].resolutionRejected).toContain('deciding login'),
      },
      {
        label: 'complete, but by a login the policy does not let decide',
        apply: (pr) => { pr.security = { status: 'findings', findings: [securityFinding({ resolution: { reason: 'accepted risk, see ADR-4', by: 'author-a', at: DECIDED_AT, headSha: HEAD_A } })] }; },
        mergeable: false,
        codes: ['security-finding-open'],
        check: ({ gate }) => expect(gate.blockers[0].resolutionRejected).toContain('maintainerLogins'),
      },
      {
        label: 'complete, but decided against another head',
        apply: (pr) => { pr.security = { status: 'findings', findings: [securityFinding({ resolution: { reason: 'accepted risk, see ADR-4', by: 'maintainer-m', at: DECIDED_AT, headSha: HEAD_B } })] }; },
        mergeable: false,
        codes: ['security-finding-open'],
        check: ({ gate }) => expect(gate.blockers[0].resolutionRejected).toContain('not the current head'),
      },
      {
        label: 'the operator records it on this head',
        apply: (pr) => { pr.security = { status: 'findings', findings: [decide(securityFinding(), HEAD_A, { reason: 'accepted risk, see ADR-4' })] }; },
        mergeable: true,
        codes: [],
      },
    ],
  },
  {
    name: '26 a later head that fixed the cited line clears the security finding; one re-reported there keeps blocking',
    pr: () => makePr({ security: { status: 'findings', findings: [securityFinding({ headSha: HEAD_A })] } }),
    steps: [
      { label: 'open at A', mergeable: false, codes: ['security-finding-open'] },
      {
        label: 'B fixes line 44, not re-reported',
        apply: (pr) => {
          pr.head = HEAD_B;
          pr.reviews = [approve('human-a', HEAD_B)];
          const result = clearFixedFindings({ ledger: pr.security.findings, changedLocations: ['packages/development/lib/widget.js:44'], reReported: [], headSha: HEAD_B });
          pr.security = { status: 'findings', findings: result.findings };
        },
        mergeable: true,
        codes: [],
        check: ({ gate }) => expect(gate.securityLane.cleared).toEqual(['S-1']),
      },
      {
        label: 'C: finding re-reported at the same line',
        apply: (pr) => {
          pr.head = HEAD_A;
          pr.reviews = [approve('human-a', HEAD_A)];
          pr.security = { status: 'findings', findings: [securityFinding({ headSha: HEAD_A })] };
        },
        mergeable: false,
        codes: ['security-finding-open'],
      },
    ],
  },
  {
    name: '27 a security lane that never ran blocks Medium; an unavailable, empty-but-"findings" or unreadable lane is unavailable data',
    pr: () => makePr({ security: { status: 'not-run' } }),
    steps: [
      { label: 'not-run at Medium', mergeable: false, codes: ['security-review-missing'] },
      { label: 'lane ran clean', apply: (pr) => { pr.security = { status: 'clean', findings: [] }; }, mergeable: true, codes: [] },
      { label: 'lane unavailable', apply: (pr) => { pr.security = { status: 'unavailable', reason: 'gh was rate-limited' }; }, mergeable: false, codes: ['review-data-unavailable'], check: ({ gate }) => expect(gate.blockers[0].message).toContain('gh was rate-limited') },
      { label: 'lane says findings but lists none', apply: (pr) => { pr.security = { status: 'findings', findings: [] }; }, mergeable: false, codes: ['review-data-unavailable'] },
      { label: 'lane status unreadable', apply: (pr) => { pr.security = { status: 'mostly-fine' }; }, mergeable: false, codes: ['review-data-unavailable'] },
    ],
  },
  {
    name: '28 a lane reported "clean" that nevertheless carries an open finding does not pass',
    pr: () => makePr({ security: { status: 'clean', findings: [] } }),
    steps: [
      { label: 'clean, empty', mergeable: true, codes: [] },
      { label: 'clean, with an open finding listed', apply: (pr) => { pr.security = { status: 'clean', findings: [securityFinding()] }; }, mergeable: false, codes: ['security-finding-open'] },
    ],
  },

  // ---- 5. Fail-closed inputs -------------------------------------------------------------------
  {
    name: '29 description sections: each missing section is named and refuses; completing it merges; a non-text body is unavailable data',
    pr: () => makePr(),
    steps: [
      { label: 'complete', mergeable: true, codes: [] },
      { label: 'no Risk section', apply: (pr) => { pr.body = DESCRIPTION.replace(/## Risk[\s\S]*?(?=## How)/, ''); }, mergeable: false, codes: ['description-section-missing'], check: ({ gate }) => expect(gate.blockers[0].section).toBe('risk') },
      { label: 'body is a number', apply: (pr) => { pr.body = 42; }, mergeable: false, codes: ['review-data-unavailable'] },
      { label: 'complete again', apply: (pr) => { pr.body = DESCRIPTION; }, mergeable: true, codes: [] },
    ],
  },
  {
    name: '30 the caller could not collect data (gh outage): refused and the outage is named, never a clean pass',
    pr: () => makePr(),
    steps: [
      { label: 'everything collected', mergeable: true, codes: [] },
      { label: 'gh unreachable', apply: (pr) => { pr.unavailable = ['gh-unreachable']; }, mergeable: false, codes: ['review-data-unavailable'], check: ({ gate }) => expect(gate.blockers[0].missing).toEqual(['gh-unreachable']) },
      { label: 'unavailable list unreadable', apply: (pr) => { pr.unavailable = 'gh-unreachable'; }, mergeable: false, codes: ['review-data-unavailable'] },
      { label: 'outage over', apply: (pr) => { pr.unavailable = []; }, mergeable: true, codes: [] },
    ],
  },
  {
    name: '31 wrong-typed reviews or an unreadable head: approvals refuses (invalid-reviews / invalid-head-sha) and the gate follows',
    pr: () => makePr(),
    steps: [
      { label: 'valid', mergeable: true, codes: [] },
      { label: 'reviews is an object', apply: (pr) => { pr.reviews = { author: 'human-a', state: 'APPROVED' }; }, mergeable: false, codes: ['review-data-unavailable'], check: ({ approvals, gate }) => { expect(approvals.reason).toBe('invalid-reviews'); expect(approvals.satisfied).toBe(false); expect(gate.blockers[0].missing.join(' ')).toContain('invalid-reviews'); } },
      { label: 'reviews back, head is a short ref', apply: (pr) => { pr.reviews = [approve('human-a')]; pr.head = 'abc123'; pr.approvalsEvaluatedAt = 'abc123'; }, mergeable: false, codes: ['review-data-unavailable'], check: ({ approvals }) => expect(approvals.reason).toBe('invalid-head-sha') },
    ],
  },
  {
    name: '32 a forged approvals result that requires fewer humans than the tier (Medium with humansRequired 0) is refused as mismatched',
    pr: () => makePr(),
    steps: [
      { label: 'honest approvals', mergeable: true, codes: [] },
      {
        label: 'approvals tampered to require 0 at Medium',
        apply: (pr) => { pr.tamper = (approvals) => ({ ...approvals, humansRequired: 0, satisfied: true, humansCounted: 0 }); pr.reviews = []; },
        mergeable: false,
        codes: ['approvals-tier-mismatch'],
        check: ({ gate }) => expect(gate.blockers[0].problems.join(' ')).toContain('tier requires 1'),
      },
    ],
  },
  {
    name: '33 a forged approvals result evaluated at a lower tier than the effective tier (low claim at High) is refused as mismatched',
    pr: () => makePr({ changedPaths: ['.github/workflows/ci.yml'], reviews: [approve('human-a'), approve('human-b')] }),
    steps: [
      { label: 'honest High approvals (two humans)', mergeable: true, codes: [] },
      {
        label: 'approvals relabelled as tier medium',
        apply: (pr) => { pr.tamper = (approvals) => ({ ...approvals, tier: 'medium' }); },
        mergeable: false,
        codes: ['approvals-tier-mismatch'],
        check: ({ gate }) => expect(gate.blockers[0].problems[0]).toContain("tier 'medium' but the effective tier is 'high'"),
      },
    ],
  },
];

/** `attempt`, with an optional tamper hook applied to the approvals the gate is handed. */
function attemptWithTamper(run, pr) {
  if (typeof pr.tamper !== 'function') return attempt(run, pr);
  const real = attempt(run, pr);
  const gate = run('gate', {
    headSha: pr.head,
    policy: pr.policy,
    ledger: pr.ledger,
    approvals: pr.tamper(real.approvals),
    tier: real.tier,
    description: real.description,
    security: pr.security,
    unavailable: pr.unavailable,
  });
  return { ...real, gate };
}

function runChain(run, chain) {
  const pr = chain.pr();
  chain.steps.forEach((step, index) => {
    if (step.apply) step.apply(pr);
    const result = attemptWithTamper(run, pr);
    const at = `step ${index} (${step.label})`;
    expect([at, result.gate.ok, result.gate.mergeable]).toEqual([at, true, step.mergeable]);
    expect([at, codes(result.gate)]).toEqual([at, step.codes]);
    expect(result.gate.reasons).toEqual(step.mergeable ? ['mergeable'] : [...new Set(result.gate.blockers.map((b) => b.code))]);
    if (step.check) step.check(result);
  });
}

describe('PR-review gate: BEFORE/AFTER chains through the CLI handlers', () => {
  test.each(CHAINS.map((chain) => [chain.name, chain]))('%s', (_name, chain) => {
    runChain(inProcess, chain);
  });

  test('the table covers all families: head, approvals, ledger, security lane, fail-closed', () => {
    expect(CHAINS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(CHAINS.map((chain) => chain.name.slice(0, 2))).size).toBe(CHAINS.length);
    // Every chain must flip the verdict at least once, or it guards nothing.
    for (const chain of CHAINS) {
      expect([chain.name, new Set(chain.steps.map((s) => s.mergeable)).size]).toEqual([chain.name, 2]);
    }
  });
});

// --- Status: the review-completion half of "may this head merge?" ---------------------------------

describe('PR-review gate chains: review completion (status) before and after the head moves', () => {
  const facts = (overrides = {}) => ({
    baseSha: BASE,
    headSha: HEAD_A,
    reviewedHeadSha: HEAD_A,
    findingCounts: { total: 0, actionable: 0, deferred: 0 },
    tests: { exitCode: 0 },
    remotePhase: 'REMOTE_REVIEW_COMPLETE',
    roundsUsed: 1,
    ...overrides,
  });

  test('34 review complete at A; head B pushed and nobody reviewed it: pending with a stale reviewedHeadSha, not complete', () => {
    const before = inProcess('status', facts());
    expect([before.status, before.next]).toEqual(['REVIEW_COMPLETE', 'none']);
    const after = inProcess('status', facts({ headSha: HEAD_B }));
    expect(after.status).toBe('REVIEW_PENDING');
    expect(after.reasons).toContain('stale reviewedHeadSha');
    expect(after.next).toBe('re-run-review-for-current-head');
    // the review catches up with B
    expect(inProcess('status', facts({ headSha: HEAD_B, reviewedHeadSha: HEAD_B })).status).toBe('REVIEW_COMPLETE');
  });

  test('35 head moved but reviewed tree == head tree (rebase) stays complete; a different tree is stale; a malformed tree id blocks', () => {
    expect(inProcess('status', facts({ headSha: HEAD_B, reviewedTreeSha: TREE_X, headTreeSha: TREE_X })).status).toBe('REVIEW_COMPLETE');
    expect(inProcess('status', facts({ headSha: HEAD_B, reviewedTreeSha: TREE_X, headTreeSha: TREE_Y })).status).toBe('REVIEW_PENDING');
    const bad = inProcess('status', facts({ headSha: HEAD_B, reviewedTreeSha: 'not-a-tree', headTreeSha: TREE_X }));
    expect(bad.status).toBe('REVIEW_BLOCKED');
    expect(bad.reasons.join(' ')).toContain('reviewedTreeSha');
  });

  test('36 an actionable finding, a failing test or a missing reviewedHeadSha each keep the head from completing; fixing exactly that completes it', () => {
    const cases = [
      [{ findingCounts: { total: 1, actionable: 1, deferred: 0 } }, 'REVIEW_PENDING', { findingCounts: { total: 1, actionable: 0, deferred: 1 } }],
      [{ tests: { exitCode: 1 } }, 'REVIEW_PENDING', { tests: { exitCode: 0 } }],
      [{ reviewedHeadSha: undefined }, 'REVIEW_BLOCKED', { reviewedHeadSha: HEAD_A }],
    ];
    for (const [broken, brokenStatus, fix] of cases) {
      expect([JSON.stringify(broken), inProcess('status', facts(broken)).status]).toEqual([JSON.stringify(broken), brokenStatus]);
      expect([JSON.stringify(fix), inProcess('status', facts(fix)).status]).toEqual([JSON.stringify(fix), 'REVIEW_COMPLETE']);
    }
  });

  test('37 an empty payload, or one that only claims a complete remote review, is never REVIEW_COMPLETE', () => {
    expect(inProcess('status', {}).status).toBe('REVIEW_BLOCKED');
    expect(inProcess('status', { remotePhase: 'REMOTE_REVIEW_COMPLETE', tests: { exitCode: 0 } }).status).not.toBe('REVIEW_COMPLETE');
  });
});

// --- Verification votes feeding the gate ---------------------------------------------------------

describe('PR-review gate chains: verifier votes decide what reaches the ledger, and the gate answers it', () => {
  const votesFor = (verdicts) => verdicts.map((verdict, index) => ({ verifier: `v${index}`, verdict }));

  /** The skill's hand-off: findings the tally PRESENTS are recorded in the ledger as open findings. */
  function ledgerFromVotes(tally) {
    return tally.presented.map((entry) => finding({ id: String(entry.id), headSha: HEAD_A }));
  }

  const candidate = (verdicts, extra = {}) => ({ id: 'F-1', severity: 'important', votes: votesFor(verdicts), ...extra });
  const gateAfterVotes = (findings, tallyExtra = {}) => {
    const tally = inProcess('votes', { depth: 'standard', findings, ...tallyExtra });
    const pr = makePr({ ledger: ledgerFromVotes(tally) });
    return { tally, gate: attempt(inProcess, pr).gate };
  };

  test('38 2 of 3 verifiers vote real: present and blocks; flip one vote to not-real: filtered and the PR merges', () => {
    const before = gateAfterVotes([candidate(['real', 'real', 'not-real'])]);
    expect(before.tally.findings[0].outcome).toBe('present');
    expect(before.gate.mergeable).toBe(false);
    expect(codes(before.gate)).toEqual(['open-important-finding']);

    const after = gateAfterVotes([candidate(['real', 'not-real', 'not-real'])]);
    expect(after.tally.findings[0].outcome).toBe('filtered');
    expect(after.tally.findings[0].reason).toBe('verifier-majority-not-reached');
    expect(after.gate.mergeable).toBe(true);
  });

  test('39 the denominator is the EXPECTED verifiers: two real votes of three expected pass, one real vote and two missing do not', () => {
    const two = inProcess('votes', { depth: 'standard', findings: [candidate(['real', 'real'])] });
    expect(two.findings[0].tally).toEqual(expect.objectContaining({ real: 2, expected: 3, needed: 2 }));
    expect(two.findings[0].outcome).toBe('present');
    const one = inProcess('votes', { depth: 'standard', findings: [candidate(['real'])] });
    expect(one.findings[0].outcome).toBe('filtered');
    expect(one.presented).toEqual([]);
    // raising the expected count to five makes the same two votes insufficient
    const five = inProcess('votes', { depth: 'standard', expectedVerifiers: 5, findings: [candidate(['real', 'real'])] });
    expect(five.findings[0].outcome).toBe('filtered');
  });

  test('40 a verifier that returned nothing leaves the finding unverified and PRESENTED (never dropped), so the gate still blocks; once it votes not-real it is filtered', () => {
    const missing = candidate(['not-real', 'not-real'], { incompleteVerifiers: [{ verifier: 'v2', reason: 'timeout' }] });
    const before = gateAfterVotes([missing]);
    expect(before.tally.findings[0]).toEqual(expect.objectContaining({ outcome: 'unverified', reason: 'verifier-incomplete', presented: true }));
    expect(before.tally.verification).not.toBe('performed');
    expect(before.gate.mergeable).toBe(false);

    const complete = gateAfterVotes([candidate(['not-real', 'not-real', 'not-real'])]);
    expect(complete.tally.findings[0].outcome).toBe('filtered');
    expect(complete.tally.verification).toBe('performed');
    expect(complete.gate.mergeable).toBe(true);
  });

  test('41 no verification capability at all: every finding is unverified and kept, so the gate blocks; with capability and not-real votes it merges', () => {
    const findings = [candidate(['not-real', 'not-real', 'not-real'])];
    const without = gateAfterVotes(findings, { verificationCapability: false });
    expect(without.tally.verification).toBe('not-performed');
    expect(without.tally.findings[0].reason).toBe('no-subagent-capability');
    expect(without.gate.mergeable).toBe(false);
    expect(gateAfterVotes(findings).gate.mergeable).toBe(true);
  });

  test('42 a security finding the verifiers reject is DISPUTED and kept for a person (blocks), not filtered like an ordinary finding', () => {
    const security = candidate(['real', 'not-real', 'not-real'], { security: true });
    const disputed = gateAfterVotes([security]);
    expect(disputed.tally.findings[0].outcome).toBe('disputed');
    expect(disputed.tally.findings[0].presented).toBe(true);
    expect(disputed.gate.mergeable).toBe(false);
    const ordinary = gateAfterVotes([candidate(['real', 'not-real', 'not-real'])]);
    expect(ordinary.tally.findings[0].outcome).toBe('filtered');
    expect(ordinary.gate.mergeable).toBe(true);
  });

  test('43 votes from the finding\'s own reviewer, a duplicate verifier or an unknown verdict do not count toward the majority', () => {
    const own = inProcess('votes', {
      depth: 'standard',
      findings: [{ id: 'F-1', severity: 'important', reviewer: 'v0', votes: [{ verifier: 'v0', verdict: 'real' }, { verifier: 'v1', verdict: 'real' }, { verifier: 'v2', verdict: 'not-real' }] }],
    });
    expect(own.findings[0].tally.real).toBe(1);
    expect(own.findings[0].outcome).toBe('filtered');
    const dup = inProcess('votes', { depth: 'standard', findings: [{ id: 'F-1', severity: 'important', votes: [{ verifier: 'v0', verdict: 'real' }, { verifier: 'v0', verdict: 'real' }, { verifier: 'v1', verdict: 'maybe' }] }] });
    expect(dup.findings[0].tally.real).toBe(1);
    expect(dup.findings[0].outcome).toBe('filtered');
  });

  test('44 an unknown depth or a finding with no id blocks the whole tally and presents nothing as agreed', () => {
    expect(inProcess('votes', { depth: 'extreme', findings: [candidate(['real', 'real', 'real'])] })).toEqual(expect.objectContaining({ ok: false, verification: 'blocked', presented: [] }));
    expect(inProcess('votes', { depth: 'standard', findings: [{ severity: 'important', votes: votesFor(['real', 'real', 'real']) }] })).toEqual(expect.objectContaining({ ok: false, verification: 'blocked' }));
    expect(inProcess('votes', { depth: 'standard', findings: [candidate(['real', 'real', 'real'])] }).ok).not.toBe(false);
  });
});

// --- Slices: a path nobody reviewed ----------------------------------------------------------------

describe('PR-review gate chains: a changed path nobody reviewed is reported, and the gate refuses on it', () => {
  const plan = {
    paths: [
      { path: 'a/x.js', lines: 900 },
      { path: 'b/y.js', lines: 900 },
      { path: 'c/z.js', lines: 10 },
    ],
    areas: ['a', 'b'],
    changedPaths: ['a/x.js', 'b/y.js', 'c/z.js'],
  };

  test('45 slice b unreviewed: its path is uncovered and ok is false; reviewing every slice covers the diff', () => {
    const planned = inProcess('slices', plan);
    expect(planned.sliced).toBe(true);
    const ids = planned.slices.map((slice) => slice.id);
    expect(ids.sort()).toEqual(['(repository root)', 'a', 'b']);

    const partial = inProcess('slices', { ...plan, reviewed: ['a', '(repository root)'] });
    expect(partial.ok).toBe(false);
    expect(partial.covered).toBe(false);
    expect(partial.uncovered).toEqual(['b/y.js']);
    expect(partial.unreviewedSlices).toEqual(['b']);

    const full = inProcess('slices', { ...plan, reviewed: ids });
    expect(full.ok).toBe(true);
    expect(full.covered).toBe(true);
    expect(full.uncovered).toEqual([]);
  });

  test('46 a changed path the plan never held is uncovered too, and an unknown reviewed slice id is reported rather than counted', () => {
    const ids = inProcess('slices', plan).slices.map((slice) => slice.id);
    const extra = inProcess('slices', { ...plan, reviewed: ids, changedPaths: [...plan.changedPaths, 'd/new.js'] });
    expect(extra.covered).toBe(false);
    expect(extra.uncovered).toEqual(['d/new.js']);
    const ghost = inProcess('slices', { ...plan, reviewed: [...ids, 'ghost-slice'] });
    expect(ghost.unknownReviewed).toEqual(['ghost-slice']);
    const onlyGhost = inProcess('slices', { ...plan, reviewed: ['ghost-slice'] });
    expect(onlyGhost.ok).toBe(false);
    expect(onlyGhost.uncovered).toEqual(expect.arrayContaining(['a/x.js', 'b/y.js', 'c/z.js']));
  });

  test('47 chain: the uncovered path is handed to the gate as unavailable review data -- refused while it is uncovered, merged once covered', () => {
    const ids = inProcess('slices', plan).slices.map((slice) => slice.id);
    const grade = (reviewed) => {
      const coverage = inProcess('slices', { ...plan, reviewed });
      return attempt(inProcess, makePr({ unavailable: coverage.uncovered.map((p) => `unreviewed path ${p}`) })).gate;
    };
    const before = grade(['a', '(repository root)']);
    expect(before.mergeable).toBe(false);
    expect(codes(before)).toEqual(['review-data-unavailable']);
    expect(before.blockers[0].missing).toEqual(['unreviewed path b/y.js']);
    expect(grade(ids).mergeable).toBe(true);
  });

  test('48 a plan built from no paths never covers a changed path; an unreadable plan is refused outright', () => {
    const none = inProcess('slices', { paths: [], areas: [], reviewed: [], changedPaths: ['a.js'] });
    expect(none.ok).toBe(false);
    expect(none.uncovered).toEqual(['a.js']);
    const unreadable = inProcess('slices', { reviewed: [] });
    expect(unreadable).toEqual(expect.objectContaining({ ok: false, reason: 'paths must be an array', slices: [] }));
  });
});

// --- State file chains: the recorded state of one PR on disk -----------------------------------------

describe('PR-review gate chains: recorded state on disk across a head change', () => {
  let cwd;
  beforeAll(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-review-gate-chain-'));
  });
  afterAll(() => {
    if (cwd) fs.rmSync(cwd, { recursive: true, force: true });
  });

  test('49 state recorded at A feeds the gate at A (Important blocks); at B it is discarded and the review is NOT complete, so empty state is never a green light', () => {
    const ledger = [finding()];
    expect(inProcess('state-write', { prId: 'chain-49', cwd, state: { headSha: HEAD_A, ledger, reviewedTreeSha: TREE_X } }).ok).toBe(true);

    const atA = inProcess('state-read', { prId: 'chain-49', cwd, headSha: HEAD_A });
    expect(atA.discarded).toBe(false);
    expect(atA.dispositionedFindings.map((f) => f.id)).toEqual(['F-1']);
    const gateA = attempt(inProcess, makePr({ ledger: atA.state.ledger })).gate;
    expect(codes(gateA)).toEqual(['open-important-finding']);

    const atB = inProcess('state-read', { prId: 'chain-49', cwd, headSha: HEAD_B });
    expect(atB).toEqual(expect.objectContaining({ exists: true, discarded: true, state: null, dispositionedFindings: [] }));
    const status = inProcess('status', {
      baseSha: BASE,
      headSha: HEAD_B,
      reviewedHeadSha: HEAD_A,
      findingCounts: { total: 1, actionable: 1, deferred: 0 },
      tests: { exitCode: 0 },
      remotePhase: 'REMOTE_REVIEW_COMPLETE',
      roundsUsed: 1,
    });
    expect(status.status).not.toBe('REVIEW_COMPLETE');
  });

  test('50 same tree at a new head (rebase): the recorded state is reused; a different tree discards it', () => {
    inProcess('state-write', { prId: 'chain-50', cwd, state: { headSha: HEAD_A, ledger: [finding()], reviewedTreeSha: TREE_X } });
    const rebased = inProcess('state-read', { prId: 'chain-50', cwd, headSha: HEAD_B, treeSha: TREE_X });
    expect(rebased.discarded).toBe(false);
    expect(rebased.dispositionedFindings.map((f) => f.id)).toEqual(['F-1']);
    const changed = inProcess('state-read', { prId: 'chain-50', cwd, headSha: HEAD_B, treeSha: TREE_Y });
    expect(changed.discarded).toBe(true);
    expect(changed.state).toBeNull();
  });

  test('51 corrupt recorded state fails closed: not ok, discarded, no findings; rewriting valid state recovers it', () => {
    const write = { prId: 'chain-51', cwd, state: { headSha: HEAD_A, ledger: [finding()] } };
    const { path: stored } = inProcess('state-write', write);
    fs.writeFileSync(stored, '{ this is not json');
    const corrupt = inProcess('state-read', { prId: 'chain-51', cwd, headSha: HEAD_A });
    expect(corrupt).toEqual(expect.objectContaining({ ok: false, reason: 'corrupt', discarded: true, state: null, dispositionedFindings: [] }));
    expect(inProcess('state-write', write).ok).toBe(true);
    const healed = inProcess('state-read', { prId: 'chain-51', cwd, headSha: HEAD_A });
    expect([healed.ok, healed.discarded]).toEqual([true, false]);
  });

  test('52 a state recorded with no head of its own is never resumed; a read with no headSha is an error, not a default', () => {
    inProcess('state-write', { prId: 'chain-52', cwd, state: { ledger: [finding()] } });
    const headless = inProcess('state-read', { prId: 'chain-52', cwd, headSha: HEAD_A });
    expect([headless.exists, headless.discarded, headless.state]).toEqual([true, true, null]);
    expect(() => cli.HANDLERS['state-read']({ prId: 'chain-52', cwd })).toThrow(/headSha/);
  });

  test('53 a state-write with a malformed reviewedTreeSha records nothing; a full object id is accepted and then read back', () => {
    const bad = inProcess('state-write', { prId: 'chain-53', cwd, state: { headSha: HEAD_A, reviewedTreeSha: 'short' } });
    expect(bad).toEqual({ ok: false, reason: 'reviewedTreeSha must be a full object id' });
    expect(inProcess('state-read', { prId: 'chain-53', cwd, headSha: HEAD_A }).exists).toBe(false);
    expect(inProcess('state-write', { prId: 'chain-53', cwd, state: { headSha: HEAD_A, reviewedTreeSha: TREE_X } }).ok).toBe(true);
    expect(inProcess('state-read', { prId: 'chain-53', cwd, headSha: HEAD_A }).exists).toBe(true);
  });

  test('54 a state path outside .ensemble/pr-review/ is refused for write and read (nothing is written)', () => {
    const outside = path.join(cwd, 'elsewhere.json');
    const written = inProcess('state-write', { targetPath: outside, cwd, state: { headSha: HEAD_A } });
    expect(written).toEqual({ ok: false, reason: 'path outside .ensemble/pr-review/' });
    expect(fs.existsSync(outside)).toBe(false);
    fs.writeFileSync(outside, JSON.stringify({ headSha: HEAD_A, ledger: [] }));
    expect(inProcess('state-read', { targetPath: outside, cwd, headSha: HEAD_A })).toEqual({ ok: false, reason: 'path outside .ensemble/pr-review/' });
  });
});

// --- Fail-closed gate inputs -------------------------------------------------------------------------

describe('PR-review gate chains: unusable gate input is refused with a named reason, never a clean pass', () => {
  const good = () => attempt(inProcess, makePr());

  test('55 each gate input removed or wrong-typed in turn flips mergeable true -> false with review-data-unavailable naming it', () => {
    const baseline = good();
    expect(baseline.gate.mergeable).toBe(true);
    const gateInput = (over) => ({
      headSha: HEAD_A,
      ledger: [],
      approvals: baseline.approvals,
      tier: baseline.tier,
      description: baseline.description,
      security: { status: 'clean', findings: [] },
      ...over,
    });
    expect(inProcess('gate', gateInput({})).mergeable).toBe(true);

    const broken = [
      ['ledger', { ledger: undefined }],
      ['ledger', { ledger: 'none' }],
      ['approvals', { approvals: undefined }],
      ['approvals', { approvals: { ok: false, reason: 'invalid-reviews' } }],
      ['description', { description: undefined }],
      ['description', { description: { ok: true, missing: 'risk' } }],
      ['security', { security: undefined }],
      ['security', { security: 'clean' }],
      ['headSha', { headSha: '   ' }],
    ];
    for (const [named, over] of broken) {
      const result = inProcess('gate', gateInput(over));
      const label = `${named} ${JSON.stringify(over)}`;
      expect([label, result.mergeable]).toEqual([label, false]);
      const unavailable = result.blockers.find((b) => b.code === 'review-data-unavailable');
      expect([label, unavailable === undefined ? null : unavailable.missing.join(' ').includes(named)]).toEqual([label, true]);
    }
  });

  test('56 a payload that is not an object, or an empty one, is refused as unreadable', () => {
    for (const payload of [null, 'merge', [], 7, {}]) {
      const result = cli.HANDLERS.gate(payload);
      expect([JSON.stringify(payload), result.mergeable]).toEqual([JSON.stringify(payload), false]);
      expect(result.blockers[0].code).toBe('review-data-unavailable');
    }
  });

  test('57 an unknown tier word, a tier record the evaluator refused, or no tier at all: approvals are blocked at High (two humans) and the gate refuses', () => {
    const baseline = good();
    const approve2 = (tier) => inProcess('approvals', { reviews: [approve('human-a'), approve('human-b')], headSha: HEAD_A, tier, policy: POLICY, author: 'author-a' });
    const gateWith = (tier, approvals) =>
      inProcess('gate', { headSha: HEAD_A, ledger: [], approvals, tier, description: baseline.description, security: { status: 'clean', findings: [] } });

    for (const [label, tier, reason] of [
      ['unknown tier', { ok: true, effectiveTier: 'ultra' }, 'unknown-tier'],
      ['refused tier record', { ok: false, effectiveTier: 'low' }, 'tier-blocked'],
      ['no tier record', undefined, 'invalid-tier'],
      ['tier record is a string', 'high', 'invalid-tier'],
    ]) {
      const approvals = approve2(tier);
      expect([label, approvals.satisfied, approvals.reason]).toEqual([label, false, reason]);
      expect([label, approvals.humansRequired]).toEqual([label, 2]);
      const gate = gateWith(tier, approvals);
      expect([label, gate.mergeable]).toEqual([label, false]);
    }
    // With a readable tier the same two approvers satisfy the same gate.
    const gate = gateWith(baseline.tier, approve2(baseline.tier));
    expect(gate.mergeable).toBe(true);
  });

  test('58 a tier the gate cannot read (but approvals could) falls back to the approvals tier; one neither can read is unavailable data', () => {
    const baseline = good();
    const gateWith = (tier, approvals) =>
      inProcess('gate', { headSha: HEAD_A, ledger: [], approvals, tier, description: baseline.description, security: { status: 'clean', findings: [] } });
    expect(gateWith(undefined, baseline.approvals).mergeable).toBe(true);
    const unreadable = gateWith(undefined, { ...baseline.approvals, tier: 'ultra' });
    expect(unreadable.mergeable).toBe(false);
    expect(unreadable.blockers.find((b) => b.code === 'review-data-unavailable').missing).toContain('tier');
  });

  test('59 a tier raised after approval (Medium -> High because a sensitive path joined) refuses the stale Medium approvals result, and re-evaluating at High with two humans merges', () => {
    const pr = makePr();
    const before = attempt(inProcess, pr);
    expect(before.gate.mergeable).toBe(true);
    pr.changedPaths = ['packages/development/lib/widget.js', '.github/workflows/ci.yml'];
    const { tier: highTier } = attempt(inProcess, pr);
    expect(highTier.effectiveTier).toBe('high');
    const gate = inProcess('gate', { headSha: HEAD_A, ledger: [], approvals: before.approvals, tier: highTier, description: before.description, security: pr.security });
    expect(codes(gate)).toEqual(['approvals-tier-mismatch']);
    pr.reviews.push(approve('human-b'));
    expect(attempt(inProcess, pr).gate.mergeable).toBe(true);
  });
});

// --- The real entry point ------------------------------------------------------------------------------

describe('PR-review gate chains: through a real `node pr-review-cli.js` process', () => {
  const byId = (prefix) => CHAINS.find((chain) => chain.name.startsWith(prefix));

  test('P1 head-moved chain (01): approval on A stops counting at B and re-approval restores it, over stdin/stdout', () => {
    runChain(viaProcess, byId('01'));
  });

  test('P2 security finding closed with and without a reason (25), over stdin/stdout', () => {
    runChain(viaProcess, byId('25'));
  });

  test('P3 High tier approvals by distinct person (07), over stdin/stdout', () => {
    runChain(viaProcess, byId('07'));
  });

  test('P4 invalid JSON on stdin or an unknown subcommand exits 1 with an error and no verdict; a missing request key is an error, not a default', () => {
    const run = (args, input) => spawnSync('node', [CLI_PATH, ...args], { input, encoding: 'utf8' });
    const badJson = run(['gate'], '{ nope');
    expect(badJson.status).toBe(1);
    expect(JSON.parse(badJson.stdout).error).toContain('invalid JSON');
    expect(badJson.stdout).not.toContain('mergeable');

    const unknown = run(['merge-anyway'], '{}');
    expect(unknown.status).toBe(1);
    expect(JSON.parse(unknown.stdout).error).toContain('Unknown subcommand');

    const noHead = run(['state-read'], JSON.stringify({ targetPath: path.join(os.tmpdir(), 'pr-review-gate-chain-never-written.json') }));
    expect(noHead.status).toBe(1);
    expect(JSON.parse(noHead.stdout).error).toContain('headSha');

    // An empty gate payload is graded (exit 0) and refused: a verdict, never a pass.
    const empty = run(['gate'], '{}');
    expect(empty.status).toBe(0);
    expect(JSON.parse(empty.stdout).mergeable).toBe(false);
  });
});
