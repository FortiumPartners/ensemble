'use strict';

/**
 * TRD-012-TEST: complete-beads closure gating for
 * packages/development/skills/complete-beads/SKILL.md.
 *
 * These are structural/text assertions over the prose skill file -- there is
 * no runtime harness for a skill, so the Test AC is verified by parsing the
 * markdown the same way a maintainer or another skill would read it. Order
 * and terminal-condition assertions are used instead of pinning exact
 * line-wrapped sentences, per the project's "tests must be able to fail"
 * convention: we flatten whitespace so a re-wrap of the prose can never
 * silently break these assertions.
 */

const fs = require('fs');
const path = require('path');

const SKILL_PATH = path.join(__dirname, '..', 'skills', 'complete-beads', 'SKILL.md');

describe('complete-beads SKILL.md (TRD-012)', () => {
  const text = fs.readFileSync(SKILL_PATH, 'utf8');
  const flat = text.replace(/\s+/g, ' ');

  function sectionIndex(label) {
    const idx = text.indexOf(label);
    expect(idx).toBeGreaterThan(-1);
    return idx;
  }

  test('reuses the shared pr-review-cycle skill by the canonical repo-root path (no duplicated review logic)', () => {
    expect(flat).toContain(
      "invoke the shared `pr-review-cycle` skill, located at \"$(git rev-parse --show-toplevel 2>/dev/null)/packages/development/skills/pr-review-cycle/SKILL.md\""
    );
    expect(flat).toContain("MODE='local'");
    // complete-beads is non-interactive by construction: it never enters the
    // 10-minute interactive wait pr-review-cycle offers to non-Foreman callers.
    expect(flat).toContain('FOREMAN=true');
  });

  test('Scenario: result carries ledger and local status -- a quality-gate result includes the ledger and a local review status', () => {
    const prBoundary = sectionIndex('## PR Boundary Behavior');
    const invariants = sectionIndex('## Isolation Invariants');
    expect(invariants).toBeGreaterThan(prBoundary);
    const block = text.slice(prBoundary, invariants);

    expect(block).toContain('quality-gate result');
    expect(block).toMatch(/\{status, localPhase, ledger, reportPath\}/);
    expect(block).toContain('local_review = LOCAL_REVIEW_COMPLETE');
    expect(block).toContain('LOCAL_REVIEW_BLOCKED');
  });

  test('Scenario: COMPLETE_BEADS_RESULT gains per-PR local_review and remote_review fields', () => {
    const resultSentinel = sectionIndex('## Result Sentinel');
    const prBoundary = sectionIndex('## PR Boundary Behavior');
    expect(prBoundary).toBeGreaterThan(resultSentinel);
    const block = text.slice(resultSentinel, prBoundary);

    expect(block).toMatch(/local_review=<pr-id-1>:LOCAL_REVIEW_COMPLETE/);
    expect(block).toMatch(/remote_review=<pr-id-1>:REMOTE_REVIEW_PENDING/);
  });

  test('Scenario: roll-up needs local review complete -- a story with every child closed but a blocked local review stays open', () => {
    const processResults = sectionIndex('### ProcessResults(results)');
    const resultSentinel = sectionIndex('## Result Sentinel');
    expect(resultSentinel).toBeGreaterThan(processResults);
    const block = text.slice(processResults, resultSentinel);
    const flatBlock = block.replace(/\s+/g, ' ');

    // Step 6 (roll-up) must require LOCAL_REVIEW_COMPLETE for a PR-owning story.
    expect(flatBlock).toMatch(
      /6\. Roll up any story\/phase[\s\S]*?requires its recorded `local_review == LOCAL_REVIEW_COMPLETE`/
    );
    expect(flatBlock).toContain(
      'a story with every child closed but `local_review == LOCAL_REVIEW_BLOCKED` stays open'
    );
    expect(flatBlock).toContain('this is the REQ-016 closure gate, not a bug');
    // A story that owns no PR is NOT subject to this gate (existing DoD only).
    expect(flatBlock).toContain('A story that owns no PR');
    expect(flatBlock).toContain('rolls up on the existing DoD conditions alone, unchanged');
  });

  test('Scenario: blocking finding keeps the epic open -- a blocking local finding on any owned PR prevents epic closure', () => {
    const processResults = sectionIndex('### ProcessResults(results)');
    const resultSentinel = sectionIndex('## Result Sentinel');
    const block = text.slice(processResults, resultSentinel);
    const flatBlock = block.replace(/\s+/g, ' ');

    const step7Idx = flatBlock.indexOf('7. When no scoped descendants remain open');
    expect(step7Idx).toBeGreaterThan(-1);
    const step7 = flatBlock.slice(step7Idx);

    expect(step7).toContain("has `local_review == LOCAL_REVIEW_BLOCKED`");
    expect(step7).toContain('a blocking local finding on any owned PR keeps the epic open');
  });

  test('Scenario: remote pending does not block the epic -- every owned PR LOCAL_REVIEW_COMPLETE with remote pending may still close, each PR shown pending', () => {
    const processResults = sectionIndex('### ProcessResults(results)');
    const resultSentinel = sectionIndex('## Result Sentinel');
    const block = text.slice(processResults, resultSentinel);
    const flatBlock = block.replace(/\s+/g, ' ');

    expect(flatBlock).toContain(
      'When every owned PR is `LOCAL_REVIEW_COMPLETE`, close the epic regardless of `remote_review`'
    );
    expect(flatBlock).toContain(
      "each PR is reported `REMOTE_REVIEW_PENDING` until the remote service responds"
    );
    expect(flatBlock).toContain('epic closure is never gated on it');
  });

  test('Scenario: integration is not held for the remote service -- steps 1-5 integrate unconditionally, independent of local or remote review', () => {
    const processResults = sectionIndex('### ProcessResults(results)');
    const resultSentinel = sectionIndex('## Result Sentinel');
    const block = text.slice(processResults, resultSentinel);
    const flatBlock = block.replace(/\s+/g, ' ');

    // Integration (cherry-pick) steps 1-5 precede the review-gated steps 6-7.
    const cherryPickIdx = flatBlock.indexOf('2. `git cherry-pick`');
    const step6Idx = flatBlock.indexOf('6. Roll up any story/phase');
    expect(cherryPickIdx).toBeGreaterThan(-1);
    expect(step6Idx).toBeGreaterThan(cherryPickIdx);

    expect(flatBlock).toContain(
      'Steps 1-5 above already integrated every bead\'s work onto the integration branch unconditionally'
    );
    expect(flatBlock).toContain('integration is never held for local or remote review');
  });

  test('Scenario: Raw mode has no PR to gate -- local_review/remote_review stay empty and no review runs', () => {
    const prBoundary = sectionIndex('## PR Boundary Behavior');
    const invariants = sectionIndex('## Isolation Invariants');
    const block = text.slice(prBoundary, invariants);
    const flatBlock = block.replace(/\s+/g, ' ');

    expect(flatBlock).toMatch(
      /\*\*Raw mode\*\* \(no `PR_ACTIONS`\): complete scope, create no PR or branch stack, run no Quality Gate Review/
    );

    const resultSentinel = sectionIndex('## Result Sentinel');
    const sentinelBlock = text.slice(resultSentinel, prBoundary).replace(/\s+/g, ' ');
    expect(sentinelBlock).toContain('are omitted (empty) in Raw mode');
  });

  test('the Quality Gate Review precedes propose/append in both stacked and single-PR modes', () => {
    const prBoundary = sectionIndex('## PR Boundary Behavior');
    const invariants = sectionIndex('## Isolation Invariants');
    const block = text.slice(prBoundary, invariants);

    const gateIdx = block.indexOf('Quality Gate Review');
    const stackedProposeIdx = block.indexOf('call `git town propose` using action');
    const singlePrProposeIdx = block.indexOf("only for the `completion` action when");

    expect(gateIdx).toBeGreaterThan(-1);
    expect(stackedProposeIdx).toBeGreaterThan(gateIdx);
    expect(singlePrProposeIdx).toBeGreaterThan(gateIdx);
  });

  test('a LOCAL_REVIEW_BLOCKED gate is distinct from a propose/append failure and never reported as failed', () => {
    const prBoundary = sectionIndex('## PR Boundary Behavior');
    const invariants = sectionIndex('## Isolation Invariants');
    const block = text.slice(prBoundary, invariants);
    const flatBlock = block.replace(/\s+/g, ' ');

    expect(flatBlock).toContain(
      'distinct from a `LOCAL_REVIEW_BLOCKED` gate) returns `failed`'
    );
    expect(flatBlock).toContain('A `LOCAL_REVIEW_BLOCKED` gate is never reported as `failed`');
    expect(flatBlock).toContain('other scoped work continues');
  });
});
