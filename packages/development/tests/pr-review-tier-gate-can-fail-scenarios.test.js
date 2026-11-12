'use strict';

/**
 * TRD-028-TEST: Tier, approval and merge gates fail when broken (PRD
 * scenarios).
 *
 * Verifies TRD-028 (the gate-can-fail proofs for the sensitive-path tier
 * floor, the bot filter, the commit/tree binding, the blocking security lane
 * and the open-Important merge block). Satisfies REQ-025. Validates PRD ACs:
 * AC-025-1, AC-025-2.
 *
 * TRD-028 shipped nine source-level mutation guards in
 * pr-review-cycle-mutation.test.js (Guards 11a/11b, 12a/12b/12c and
 * 13a/13b/13c/13d): each copies the real library and its real contract test
 * into a temp tree, proves the named test passes against the pristine copy
 * and fails against one mutation, and proves no other test moved. Those are
 * SOURCE-level proofs, and they are slow (two nested jest runs per guard).
 *
 * This file states the PRD scenarios those guards exist for, following the
 * TRD-021-TEST precedent (pr-review-vote-gate-scenarios.test.js) and proving
 * each gate three independent ways:
 *
 *   1. BEHAVIOUR -- the shipped module refuses the bad case AND admits the
 *      good one on the same call shape. AC-025-2 in full: no gate here is
 *      proven only in the direction that says yes, and the refusable second
 *      case is named in each describe.
 *   2. THE GATE IS A VARIABLE, NOT A CONSTANT -- moving one input (the
 *      sensitive declaration, the bot login list, the head tree, the recorded
 *      resolution) moves the verdict for otherwise identical facts. A check
 *      whose answer never moves is a constant wearing a gate's name, and it
 *      would satisfy a "passes on the happy path" test forever.
 *   3. THE BROKEN GATE IS ACTUALLY BROKEN -- the mutation the matching TRD-028
 *      guard applies is compiled HERE, in memory, from the real source text,
 *      and the mutant is shown to produce exactly the outcome the shipped
 *      module refuses (AC-025-1: deliberately broken, its check fails). This
 *      keeps the guards' assertions load-bearing without re-running the slow
 *      subprocess harness, and it fails loudly if a source anchor is reworded.
 *
 * The inventory block at the end pins that all nine TRD-028 guards are still
 * in the harness, still aimed at these failure modes, and that every contract
 * test they name still exists under that name -- so a guard cannot be deleted,
 * renamed or silently unaimed without this suite going red. It also pins the
 * two REQ-025 gates proven by sibling TRDs (the round cap, TRD-014-TEST, and
 * the verification threshold, TRD-021-TEST), so the six gates AC-025-1 names
 * are accounted for in one place.
 *
 * TRD Reference: docs/TRD/TRD-2026-70e784f2-code-review-process.md#trd-028-test
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

const { assignTier } = require('../lib/pr-review-tier');
const { evaluateApprovals } = require('../lib/pr-review-approvals');
const { evaluateGate, BLOCKER_CODES } = require('../lib/pr-review-gate');

const LIB_DIR = path.join(__dirname, '..', 'lib');
const HARNESS_PATH = path.join(__dirname, 'pr-review-cycle-mutation.test.js');

const HEAD = 'a'.repeat(40);
const HEAD_TREE = 'b'.repeat(40);
const OTHER_COMMIT = 'c'.repeat(40);
const OTHER_TREE = 'd'.repeat(40);

// ---------------------------------------------------------------------------
// In-memory mutant compiler (proof 3)
// ---------------------------------------------------------------------------

/**
 * Compile one of the real review libraries with a single mutation applied, in
 * this process, and return its exports.
 *
 * The anchor must be present (an anchor that no longer matches throws, never
 * passes silently), the mutation must change the text, and the mutant must
 * still compile and still export the graded function -- a module that merely
 * fails to load would "fail" every test while proving nothing.
 *
 * `require` is resolved from lib/, so a mutant that requires its real siblings
 * (pr-review-gate.js requires the ledger and the tier) loads the shipped,
 * unmutated ones: only the named file is mutated.
 */
function mutantModule(fileName, anchor, replacement) {
  const filePath = path.join(LIB_DIR, fileName);
  const source = fs.readFileSync(filePath, 'utf8');

  expect(source).toContain(anchor);
  const mutated = source.split(anchor).join(replacement);
  expect(mutated).not.toBe(source);

  const mod = { exports: {} };
  const wrapper = vm.runInThisContext(
    `(function (exports, module, require, __filename, __dirname) {${mutated}\n})`,
    { filename: `${filePath}#mutant` }
  );
  wrapper(mod.exports, mod, createRequire(filePath), filePath, LIB_DIR);

  return mod.exports;
}

// ---------------------------------------------------------------------------
// Fixtures, shaped the way each caller builds them
// ---------------------------------------------------------------------------

const noPaths = { sensitive: [], high: [] };

/** An `effectiveTier`-shaped result for the approvals and gate inputs. */
function tierResult(word, overrides = {}) {
  return {
    ok: true,
    tier: word,
    effectiveTier: word,
    humansRequired: { low: 0, medium: 1, high: 2 }[word],
    refusals: [],
    reasons: [],
    warnings: [],
    ...overrides,
  };
}

const approval = (author, overrides = {}) => ({ author, state: 'APPROVED', commitSha: HEAD, ...overrides });

const ignoredFor = (result, login) => result.ignored.find((entry) => entry.login === login);

/** A ledger finding with every field the gate reads. */
function finding(overrides = {}) {
  return {
    id: 'F-1',
    source: 'code-reviewer',
    locationOrLink: 'packages/development/lib/pr-review-gate.js:12',
    severity: 'important',
    failureMode: 'unchecked input reaches the gate',
    disposition: 'fix',
    evidence: 'line 12 reads payload.ledger without validating it',
    originalTextOrLink: 'https://example.invalid/pr/1#discussion_r1',
    ...overrides,
  };
}

const description = () => ({
  ok: true,
  missing: [],
  present: ['testing', 'risk', 'rollback'],
  empty: [],
  directedBy: null,
  agentAuthored: false,
  ready: true,
  warnings: [],
});

const approvalsResult = () => ({
  ok: true,
  headSha: HEAD,
  satisfied: true,
  reason: 'required-approvals-present',
  tier: 'medium',
  humansRequired: 1,
  humansCounted: 1,
  approvedBy: ['human-a'],
  directedBy: null,
  ignored: [],
  refusals: [],
  reasons: [],
  warnings: [],
});

/** A gate input with nothing to answer; override one part per scenario. */
function gateInput(overrides = {}) {
  return {
    ledger: [],
    approvals: approvalsResult(),
    tier: tierResult('medium'),
    description: description(),
    security: { status: 'clean' },
    coverage: { status: 'complete', gaps: [] },
    headSha: HEAD,
    ...overrides,
  };
}

const blockerCodes = (result) => result.blockers.map((entry) => entry.code);

// ---------------------------------------------------------------------------
// Gate 1 -- the sensitive-path tier floor (Guards 11a, 11b)
// ---------------------------------------------------------------------------

describe('AC-025-1 / AC-025-2: the sensitive-path tier floor', () => {
  const docsOnly = [{ kind: 'docs', paths: ['README.md'] }];
  const docsTouchingAuth = [{ kind: 'docs', paths: ['README.md', 'src/auth/session.js'] }];
  const sensitive = { sensitive: ['src/auth/session.js'], high: [] };

  test('the trivial passing case: a docs-only change with no sensitive path is Low', () => {
    const result = assignTier({ kinds: docsOnly, paths: noPaths });

    expect(result.tier).toBe('low');
    expect(result.reasons).toContain('all-kinds-low-risk');
  });

  test('the case that must be refused: the same low-risk kinds touching a declared sensitive path are floored to High', () => {
    const result = assignTier({ kinds: docsTouchingAuth, paths: sensitive });

    expect(result.tier).toBe('high');
    expect(result.reasons).toContain('sensitive-path');
    expect(result.sensitivePaths).toEqual(['src/auth/session.js']);
  });

  test('the floor is a variable, not a constant: removing the path from the declaration is what moves the tier', () => {
    const declared = assignTier({ kinds: docsTouchingAuth, paths: sensitive });
    const undeclared = assignTier({ kinds: docsTouchingAuth, paths: noPaths });

    // Identical kinds and identical paths on the PR -- only the repository's
    // declaration differs, and the tier follows it.
    expect(declared.tier).toBe('high');
    expect(undeclared.tier).toBe('low');
  });

  test('not even a code owner can lower a sensitive-path PR below the floor', () => {
    const result = assignTier({
      kinds: docsTouchingAuth,
      paths: sensitive,
      proposedTier: 'low',
      proposedBy: { login: 'owner-a', isCodeOwner: true },
    });

    expect(result.tier).toBe('high');
    expect(result.ignored).toContainEqual(expect.objectContaining({ reason: 'sensitive-floor-holds' }));
  });

  test('deliberately broken (Guard 11a: the floor never finds a sensitive path), the sensitive PR grades Low', () => {
    const broken = mutantModule(
      'pr-review-tier.js',
      "  if (classification.sensitive.length > 0) {\n    floor = 'high';",
      "  if (classification.sensitive.length < 0) {\n    floor = 'high';"
    );

    expect(broken.assignTier({ kinds: docsTouchingAuth, paths: sensitive }).tier).toBe('low');
    // The shipped module refuses that on the identical input.
    expect(assignTier({ kinds: docsTouchingAuth, paths: sensitive }).tier).toBe('high');
  });

  test('deliberately broken the other way (Guard 11b: every PR floored to High), the floor stops discriminating', () => {
    const broken = mutantModule(
      'pr-review-tier.js',
      "  if (classification.sensitive.length > 0) {\n    floor = 'high';",
      "  if (classification.sensitive.length >= 0) {\n    floor = 'high';"
    );

    // A floor that is always on is not a floor: the docs-only PR, which has no
    // sensitive path at all, is graded High.
    expect(broken.assignTier({ kinds: docsOnly, paths: noPaths }).tier).toBe('high');
    expect(assignTier({ kinds: docsOnly, paths: noPaths }).tier).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// Gate 2 -- the bot filter (Guard 12a)
// ---------------------------------------------------------------------------

describe('AC-025-1 / AC-025-2: a bot approval never fills a human slot', () => {
  const botAndNobodyElse = { reviews: [approval('@CodeRabbitAI')], headSha: HEAD, tier: tierResult('medium'), policy: { botLogins: ['coderabbitai'] } };

  test('the trivial passing case: one human approval on the head satisfies a Medium PR', () => {
    const result = evaluateApprovals({ reviews: [approval('human-a')], headSha: HEAD, tier: tierResult('medium') });

    expect(result.satisfied).toBe(true);
    expect(result.approvedBy).toEqual(['human-a']);
  });

  test('the case that must be refused: the configured bot approval leaves the PR unapproved', () => {
    const result = evaluateApprovals(botAndNobodyElse);

    expect(result.satisfied).toBe(false);
    expect(result.reason).toBe('insufficient-human-approvals');
    expect(ignoredFor(result, 'coderabbitai')).toMatchObject({ reason: 'automated' });
    expect(result.humansCounted).toBe(0);
  });

  test('the filter is a variable, not a constant: the same login counts when the repository does not call it a bot', () => {
    const notDeclared = evaluateApprovals({ ...botAndNobodyElse, policy: { botLogins: [] } });

    expect(notDeclared.satisfied).toBe(true);
    expect(notDeclared.approvedBy).toEqual(['coderabbitai']);
  });

  test('a platform-marked bot is refused even when the policy never named it', () => {
    const result = evaluateApprovals({
      reviews: [approval('some-app', { isBot: true })],
      headSha: HEAD,
      tier: tierResult('medium'),
    });

    expect(result.satisfied).toBe(false);
    expect(ignoredFor(result, 'some-app')).toMatchObject({ reason: 'automated' });
  });

  test('deliberately broken (Guard 12a: the automated check can never fire), the bot approval counts as a person', () => {
    const broken = mutantModule(
      'pr-review-approvals.js',
      '    const automated = automatedReason(login, review, botLogins);\n    if (automated !== null) {',
      '    const automated = automatedReason(login, review, botLogins);\n    if (automated === null && automated !== null) {'
    );
    const result = broken.evaluateApprovals(botAndNobodyElse);

    expect(result.satisfied).toBe(true);
    expect(result.approvedBy).toEqual(['coderabbitai']);
    // The shipped module refuses it on the identical input.
    expect(evaluateApprovals(botAndNobodyElse).satisfied).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Gate 3 -- approval bound to a commit (Guards 12b, 12c)
// ---------------------------------------------------------------------------

describe('AC-025-1 / AC-025-2: an approval is bound to the commit it was given on', () => {
  const onHead = {
    reviews: [approval('human-a')],
    headSha: HEAD,
    headTreeSha: HEAD_TREE,
    tier: tierResult('medium'),
  };
  const onOlderCommit = {
    reviews: [approval('human-a', { commitSha: OTHER_COMMIT, treeSha: OTHER_TREE })],
    headSha: HEAD,
    headTreeSha: HEAD_TREE,
    tier: tierResult('medium'),
  };
  const onIdenticalTree = {
    reviews: [approval('human-a', { commitSha: OTHER_COMMIT, treeSha: HEAD_TREE })],
    headSha: HEAD,
    headTreeSha: HEAD_TREE,
    tier: tierResult('medium'),
  };

  test('the trivial passing case: the approval was given on the head', () => {
    expect(evaluateApprovals(onHead).satisfied).toBe(true);
  });

  test('the case that must be refused: a push after the approval leaves it stale', () => {
    const result = evaluateApprovals(onOlderCommit);

    expect(result.satisfied).toBe(false);
    expect(ignoredFor(result, 'human-a')).toMatchObject({ reason: 'stale-commit' });
  });

  test('the second case that must be refused: an approval with no commit at all is unbound and never counts', () => {
    const result = evaluateApprovals({
      reviews: [approval('human-a', { commitSha: null })],
      headSha: HEAD,
      tier: tierResult('medium'),
    });

    expect(result.satisfied).toBe(false);
    expect(ignoredFor(result, 'human-a')).toMatchObject({ reason: 'unbound' });
  });

  test('the binding is a variable, not a constant: the same older commit counts when its tree equals the head tree', () => {
    expect(evaluateApprovals(onIdenticalTree).satisfied).toBe(true);
    expect(evaluateApprovals(onOlderCommit).satisfied).toBe(false);
  });

  test('deliberately broken (Guard 12b: any reviewed commit accepted), the stale approval merges a push nobody saw', () => {
    const broken = mutantModule(
      'pr-review-approvals.js',
      "  if (tree !== null && headTreeSha !== null && tree === headTreeSha) return null;\n  return 'stale-commit';",
      '  if (tree !== null && headTreeSha !== null && tree === headTreeSha) return null;\n  return null;'
    );

    expect(broken.evaluateApprovals(onOlderCommit).satisfied).toBe(true);
    expect(evaluateApprovals(onOlderCommit).satisfied).toBe(false);
  });

  test('deliberately broken the other way (Guard 12c: the tree comparison inverted), a re-commit of the reviewed content is thrown away', () => {
    const broken = mutantModule(
      'pr-review-approvals.js',
      '  if (tree !== null && headTreeSha !== null && tree === headTreeSha) return null;',
      '  if (tree !== null && headTreeSha !== null && tree !== headTreeSha) return null;'
    );

    // Refusing everything is not a gate either: the rebase that changed no
    // content loses its approval.
    expect(broken.evaluateApprovals(onIdenticalTree).satisfied).toBe(false);
    expect(evaluateApprovals(onIdenticalTree).satisfied).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Gate 4 -- the blocking security lane (Guards 13a, 13b)
// ---------------------------------------------------------------------------

describe('AC-025-1 / AC-025-2: the blocking security lane', () => {
  const openSecurityFinding = {
    status: 'findings',
    findings: [finding({ id: 'S-1', failureMode: 'token logged in plaintext' })],
  };
  const answeredSecurityFinding = {
    status: 'findings',
    findings: [
      finding({
        id: 'S-1',
        failureMode: 'token logged in plaintext',
        disposition: 'resolved',
        resolution: {
          decision: 'accept',
          reason: 'false positive: the logger redacts the token before write (src/log.js:40)',
          by: 'maintainer-m',
          headSha: HEAD,
          at: '2026-11-06T10:00:00Z',
        },
      }),
    ],
  };

  test('the trivial passing case: a clean security lane does not block the merge', () => {
    const result = evaluateGate(gateInput());

    expect(result.mergeable).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  test('the case that must be refused: an open security finding blocks and is named', () => {
    const result = evaluateGate(gateInput({ security: openSecurityFinding }));

    expect(result.mergeable).toBe(false);
    expect(blockerCodes(result)).toContain(BLOCKER_CODES.SECURITY_FINDING_OPEN);
    expect(JSON.stringify(result.blockers)).toContain('S-1');
  });

  test('the second case that must be refused: a Medium PR whose security lane never ran cannot merge', () => {
    const result = evaluateGate(gateInput({ security: { status: 'not-run' } }));

    expect(result.mergeable).toBe(false);
    expect(blockerCodes(result).join(' ')).toMatch(/security/i);
  });

  test('the lane is a variable, not a constant: the same finding closed with a stated reason stops blocking, and the reason is recorded', () => {
    const answered = evaluateGate(gateInput({ security: answeredSecurityFinding }));

    expect(answered.mergeable).toBe(true);
    expect(JSON.stringify(answered.securityLane)).toContain('false positive');
    expect(evaluateGate(gateInput({ security: openSecurityFinding })).mergeable).toBe(false);
  });

  test('deliberately broken (Guard 13a: the open finding recorded as a warning), the PR with an open security finding merges', () => {
    const broken = mutantModule(
      'pr-review-gate.js',
      '    record.open.push(id);\n    blockers.push(\n      blocker(\n        BLOCKER_CODES.SECURITY_FINDING_OPEN,',
      '    record.open.push(id);\n    warnings.push(\n      blocker(\n        BLOCKER_CODES.SECURITY_FINDING_OPEN,'
    );

    expect(broken.evaluateGate(gateInput({ security: openSecurityFinding })).mergeable).toBe(true);
    expect(evaluateGate(gateInput({ security: openSecurityFinding })).mergeable).toBe(false);
  });

  test('deliberately broken the other way (Guard 13b: the recorded resolution ignored), an answered finding blocks forever', () => {
    const broken = mutantModule(
      'pr-review-gate.js',
      '    const reason = resolutionReason(entry);\n    if (reason !== null && !isActionable(entry)) {',
      '    const reason = resolutionReason(entry);\n    if (reason === null && !isActionable(entry)) {'
    );

    expect(broken.evaluateGate(gateInput({ security: answeredSecurityFinding })).mergeable).toBe(false);
    expect(evaluateGate(gateInput({ security: answeredSecurityFinding })).mergeable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Gate 5 -- the finding-answered merge block (Guards 13c, 13d)
// ---------------------------------------------------------------------------

describe('AC-025-1 / AC-025-2: the finding-answered merge block', () => {
  const openImportant = [finding({ id: 'F-9' })];
  const answeredImportant = [
    finding({
      id: 'F-9',
      disposition: 'resolved',
      resolution: {
        decision: 'accept',
        reason: 'intentional: the retry is bounded by the caller',
        by: 'maintainer-m',
        headSha: HEAD,
        at: '2026-11-06T10:00:00Z',
      },
    }),
  ];
  const nitOnly = [finding({ id: 'F-2', severity: 'nit' })];

  test('the trivial passing case: an empty ledger merges', () => {
    expect(evaluateGate(gateInput()).mergeable).toBe(true);
  });

  test('the case that must be refused: an open Important finding blocks and is named', () => {
    const result = evaluateGate(gateInput({ ledger: openImportant }));

    expect(result.mergeable).toBe(false);
    expect(blockerCodes(result)).toContain(BLOCKER_CODES.OPEN_IMPORTANT_FINDING);
    expect(result.findings.open).toContain('F-9');
  });

  test('the block is a variable, not a constant: the same finding answered with a recorded reason stops blocking (AC-008-4 for nits too)', () => {
    expect(evaluateGate(gateInput({ ledger: answeredImportant })).mergeable).toBe(true);
    expect(evaluateGate(gateInput({ ledger: nitOnly })).mergeable).toBe(true);
    expect(evaluateGate(gateInput({ ledger: openImportant })).mergeable).toBe(false);
  });

  test('the second case that must be refused: a finding whose severity cannot be read blocks rather than being demoted to a nit', () => {
    const result = evaluateGate(gateInput({ ledger: [finding({ id: 'F-7', severity: 'spicy' })] }));

    expect(result.mergeable).toBe(false);
    expect(result.findings.unrecognised).toBeGreaterThan(0);
  });

  test('deliberately broken (Guard 13c: every ledger finding treated as answered), the open Important finding is waved through', () => {
    const broken = mutantModule(
      'pr-review-gate.js',
      '          if (!isActionable(entry)) continue;',
      '          if (isActionable(entry) || !isActionable(entry)) continue;'
    );

    expect(broken.evaluateGate(gateInput({ ledger: openImportant })).mergeable).toBe(true);
    expect(evaluateGate(gateInput({ ledger: openImportant })).mergeable).toBe(false);
  });

  test('deliberately broken the other way (Guard 13d: every finding treated as open), an answered PR can never merge', () => {
    const broken = mutantModule(
      'pr-review-gate.js',
      '          if (!isActionable(entry)) continue;',
      '          if (isActionable(entry) && !isActionable(entry)) continue;'
    );

    expect(broken.evaluateGate(gateInput({ ledger: answeredImportant })).mergeable).toBe(false);
    expect(evaluateGate(gateInput({ ledger: answeredImportant })).mergeable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The proofs above must themselves be able to fail
// ---------------------------------------------------------------------------

describe('No proof in this file can be vacuous', () => {
  test('a mutation that changes nothing, or an anchor the source does not contain, throws', () => {
    expect(() => mutantModule('pr-review-tier.js', "    floor = 'high';", "    floor = 'high';")).toThrow();
    expect(() => mutantModule('pr-review-gate.js', 'a-phrase-the-gate-module-never-contains', 'x')).toThrow();
  });

  test('a mutant that fails to export the graded function is not silently accepted as a refusal', () => {
    // `evaluateGate` is read off the mutant's exports; a mutant that exported
    // nothing would throw here, not quietly report `mergeable: undefined`.
    const broken = mutantModule(
      'pr-review-gate.js',
      'module.exports = { evaluateGate,',
      'module.exports = { notEvaluateGate: evaluateGate, evaluateGateMissing: undefined, _unused: '
    );

    expect(typeof broken.evaluateGate).toBe('undefined');
    expect(() => broken.evaluateGate(gateInput())).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// Inventory: every TRD-028 guard is still there, still aimed
// ---------------------------------------------------------------------------

describe('Inventory: TRD-028 still carries a source-level guard for each of these gates', () => {
  const HARNESS = fs.readFileSync(HARNESS_PATH, 'utf8');

  test('the harness names a guard for the tier floor, the approval binding and the merge gate', () => {
    expect(HARNESS).toMatch(/describe\('Guard \d+[a-z/\d]*: sensitive-path tier floor/);
    expect(HARNESS).toMatch(/describe\('Guard \d+[a-z/\d]*: bot filter and commit binding/);
    expect(HARNESS).toMatch(/describe\('Guard \d+[a-z/\d]*: security block and answered-findings merge block/);
  });

  test('all nine TRD-028 mutations are still declared', () => {
    for (const id of ['11a', '11b', '12a', '12b', '12c', '13a', '13b', '13c', '13d']) {
      expect(HARNESS).toContain(`id: 'Guard ${id}'`);
    }
  });

  test('each guarded contract test still exists, under the title the guard selects it by', () => {
    const guarded = {
      'pr-review-tier.test.js': [
        'a sensitive path is High whatever the classifier concluded (AC-013-3)',
        'documentation, copy and additive-behind-flag changes are Low',
      ],
      'pr-review-approvals.test.js': [
        'a bot approval never fills the required human slot',
        'a stale approval never fills the required human slot',
        'an approval on another commit whose tree EQUALS the head tree still counts',
      ],
      'pr-review-gate.test.js': [
        'an open security finding blocks the merge and names it',
        'a security finding closed with a stated reason stops blocking and the reason is recorded (AC-017-3)',
        'an open Important finding refuses the merge and names the finding',
        'an Important finding answered with a recorded reason stops blocking',
      ],
    };

    for (const [file, titles] of Object.entries(guarded)) {
      const contract = fs.readFileSync(path.join(__dirname, file), 'utf8');
      for (const title of titles) {
        expect(HARNESS).toContain(title);
        expect(contract).toContain(title);
      }
    }
  });

  test('the two REQ-025 gates proven by sibling TRDs are accounted for, so all six are covered', () => {
    const roundCap = fs.readFileSync(path.join(__dirname, 'pr-review-gate-can-fail-scenarios.test.js'), 'utf8');
    const voteGate = fs.readFileSync(path.join(__dirname, 'pr-review-vote-gate-scenarios.test.js'), 'utf8');

    expect(roundCap).toContain('the round cap');
    expect(voteGate).toContain('the verification vote threshold');
    expect(HARNESS).toMatch(/describe\('Guard \d+[a-z/\d]*: round cap/);
    expect(HARNESS).toMatch(/describe\('Guard \d+[a-z/\d]*: verification vote threshold/);
  });
});
