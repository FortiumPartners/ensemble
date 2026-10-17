'use strict';

/**
 * Anti-drift guard for the PR-review status vocabulary.
 *
 * lib/pr-review-status.js is the single source of truth for the review words:
 * STATUSES, LOCAL_PHASES and REMOTE_PHASES. The commands and skills that
 * consume a review result (fix-issue, implement-trd-beads, complete-beads,
 * pr-review-cycle) name those words in YAML and prose. A caller that tests for
 * a word the grader can never emit -- or that tests for one specific BAD word
 * instead of requiring the one GOOD word -- fails OPEN: every other or missing
 * value silently proceeds. This is how fix-issue came to branch on
 * LOCAL_REVIEW_BLOCKED while the grader never produced it.
 *
 * So the words are pinned both ways:
 *   1. every review token written in those files is a member of the exported
 *      vocabularies (a misspelt, stale or invented word fails here);
 *   2. every member of the vocabularies is a value the grader can really emit
 *      (a word nobody can produce fails here);
 *   3. a caller compares the raw localPhase only by equality with the one good
 *      value, never with a bad literal.
 * Each check is a pure helper with a negative control in this file, proving it
 * can fail.
 */

const fs = require('fs');
const path = require('path');
const { deriveStatus, STATUSES, LOCAL_PHASES, REMOTE_PHASES } = require('../lib/pr-review-status.js');

const DEV_ROOT = path.join(__dirname, '..');
const SCANNED = [
  'commands/fix-issue.yaml',
  'commands/implement-trd-beads.yaml',
  'skills/complete-beads/SKILL.md',
  'skills/pr-review-cycle/SKILL.md',
];

const REVIEW_TOKEN = /\b(?:LOCAL|REMOTE)_REVIEW_[A-Z]+\b|\bREVIEW_(?:COMPLETE|PENDING|BLOCKED)\b/g;
// A comparison of the RAW skill field (not a derived variable) with a quoted review word.
const RAW_PHASE_COMPARISON = /\b(?:localPhase|LOCAL_PHASE)\s*(==|===|!=|!==)\s*'([A-Z_]+)'/g;

const VOCABULARY = new Set([...STATUSES, ...LOCAL_PHASES, ...REMOTE_PHASES]);
const GOOD_LOCAL_PHASE = 'LOCAL_REVIEW_COMPLETE';

/** Review tokens in `text` that are not in the grader's vocabularies. */
const unknownTokens = (text) => [...new Set(text.match(REVIEW_TOKEN) || [])].filter((token) => !VOCABULARY.has(token));

/** Raw localPhase comparisons in `text` that are not a positive equality with the one good value. */
const badPhaseComparisons = (text) =>
  [...text.matchAll(RAW_PHASE_COMPARISON)]
    .filter(([, operator, literal]) => operator !== '==' || literal !== GOOD_LOCAL_PHASE)
    .map(([whole]) => whole);

/** Members of `vocabulary` that none of `emitted` ever produced. */
const unreachable = (vocabulary, emitted) => vocabulary.filter((word) => !emitted.has(word));

const readScanned = (rel) => fs.readFileSync(path.join(DEV_ROOT, rel), 'utf8');

const SHA_BASE = 'b'.repeat(40);
const SHA_HEAD = 'a'.repeat(40);
const passing = {
  baseSha: SHA_BASE,
  headSha: SHA_HEAD,
  reviewedHeadSha: SHA_HEAD,
  findingCounts: { total: 0, actionable: 0, deferred: 0 },
  tests: { passed: true, skipped: false, command: 'npm test' },
  remotePhase: 'REMOTE_REVIEW_COMPLETE',
};
// Fact sets chosen to walk every branch of the grader: all good, failed tests, the round cap, no access, no facts.
const FACT_SETS = [
  passing,
  { ...passing, tests: { passed: false, skipped: false, command: 'npm test' }, remotePhase: undefined },
  { ...passing, findingCounts: { total: 1, actionable: 1, deferred: 0 }, roundsUsed: 2 },
  { ...passing, access: { ok: false, reason: 'no review access' } },
  {},
];

const emittedBy = (derive) => ({
  statuses: new Set(FACT_SETS.map((facts) => derive(facts).status)),
  localPhases: new Set(FACT_SETS.map((facts) => derive(facts).localPhase)),
  remotePhases: new Set(FACT_SETS.map((facts) => derive(facts).remotePhase)),
});

describe('PR-review status vocabulary (anti-drift)', () => {
  test.each(SCANNED)('every review token in %s is a member of the grader vocabulary', (rel) => {
    const text = readScanned(rel);

    // The scan itself must see tokens, otherwise "no unknown tokens" would be a vacuous pass.
    expect(text.match(REVIEW_TOKEN)).not.toBeNull();
    expect(unknownTokens(text)).toEqual([]);
  });

  test('the scan pattern covers every word of the vocabulary, so no vocabulary word can go unscanned', () => {
    // One good word exists and the three vocabularies are disjoint, so a token names exactly one thing.
    expect(LOCAL_PHASES).toContain(GOOD_LOCAL_PHASE);
    expect(VOCABULARY.size).toBe(LOCAL_PHASES.length + REMOTE_PHASES.length + STATUSES.length);
    // The pattern sees each whole word: a word it would miss (a new status, say) must extend the pattern.
    [...VOCABULARY].forEach((word) => expect(word.match(REVIEW_TOKEN)).toEqual([word]));
  });

  test('deriveStatus can actually emit every member of LOCAL_PHASES', () => {
    const { localPhases } = emittedBy(deriveStatus);

    expect(unreachable(LOCAL_PHASES, localPhases)).toEqual([]);
  });

  test('deriveStatus can actually emit every member of REMOTE_PHASES and STATUSES, and nothing outside them', () => {
    const { statuses, remotePhases, localPhases } = emittedBy(deriveStatus);

    expect(unreachable(REMOTE_PHASES, remotePhases)).toEqual([]);
    expect(unreachable(STATUSES, statuses)).toEqual([]);
    statuses.forEach((word) => expect(STATUSES).toContain(word));
    remotePhases.forEach((word) => expect(REMOTE_PHASES).toContain(word));
    localPhases.forEach((word) => expect(LOCAL_PHASES).toContain(word));
  });

  test.each(SCANNED)('%s compares the raw localPhase only by equality with the one good value', (rel) => {
    expect(badPhaseComparisons(readScanned(rel))).toEqual([]);
  });

  test('the scan sees the comparisons it is meant to police', () => {
    // At least the three gates (fix-issue, implement-trd-beads, complete-beads) compare the raw field.
    const total = SCANNED.map((rel) => [...readScanned(rel).matchAll(RAW_PHASE_COMPARISON)].length).reduce((a, b) => a + b, 0);

    expect(total).toBeGreaterThanOrEqual(3);
  });

  // These controls feed the same helpers a defect and require it to be reported. They add a defect to an in-memory
  // copy and look only at the difference it makes, so they hold whatever the real files currently contain.
  describe('negative controls: each check can fail', () => {
    test.each(SCANNED)('an invented token injected into an in-memory copy of %s is reported', (rel) => {
      const text = readScanned(rel);
      const injected = (word) => unknownTokens(`${text}\n${word}`).filter((token) => !unknownTokens(text).includes(token));

      expect(injected('LOCAL_REVIEW_BOGUS')).toEqual(['LOCAL_REVIEW_BOGUS']);
      expect(injected('REMOTE_REVIEW_NOSUCHWORD')).toEqual(['REMOTE_REVIEW_NOSUCHWORD']);
    });

    test('a stale variable name or a misspelling of a real word is reported', () => {
      const valid = 'LOCAL_REVIEW_COMPLETE REMOTE_REVIEW_PENDING REVIEW_BLOCKED';

      expect(unknownTokens(valid)).toEqual([]);
      ['LOCAL_REVIEW_PHASE', 'LOCAL_REVIEW_COMPLETED', 'LOCAL_REVIEW_BLOKED', 'REMOTE_REVIEW_DONE'].forEach((word) => {
        expect(unknownTokens(`${valid} ${word}`)).toEqual([word]);
      });
    });

    test('a grader that cannot emit a phase is reported as having an unreachable member', () => {
      const neverBlocked = () => ({ status: 'REVIEW_PENDING', localPhase: 'LOCAL_REVIEW_COMPLETE', remotePhase: 'REMOTE_REVIEW_PENDING' });
      const { localPhases, statuses } = emittedBy(neverBlocked);

      expect(unreachable(['LOCAL_REVIEW_COMPLETE', 'LOCAL_REVIEW_PENDING', 'LOCAL_REVIEW_BLOCKED'], localPhases)).toEqual([
        'LOCAL_REVIEW_PENDING',
        'LOCAL_REVIEW_BLOCKED',
      ]);
      expect(unreachable(['REVIEW_COMPLETE', 'REVIEW_PENDING', 'REVIEW_BLOCKED'], statuses)).toEqual(['REVIEW_COMPLETE', 'REVIEW_BLOCKED']);
    });

    test.each(SCANNED)('a gate keyed on a bad literal injected into an in-memory copy of %s is reported', (rel) => {
      const text = readScanned(rel);
      const existing = badPhaseComparisons(text).length;
      const added = (line) => badPhaseComparisons(`${text}\n${line}`).length - existing;

      expect(added("IF LOCAL_PHASE == 'LOCAL_REVIEW_BLOCKED': halt")).toBe(1);
      expect(added("when localPhase != 'LOCAL_REVIEW_BLOCKED' proceed")).toBe(1);
      expect(added("when localPhase=='LOCAL_REVIEW_PENDING' wait")).toBe(1);
      // A negated test of the GOOD value is still not a positive match on it.
      expect(added("IF localPhase != 'LOCAL_REVIEW_COMPLETE': halt")).toBe(1);
      // ... while the good gate itself is not reported.
      expect(added("IF LOCAL_PHASE == 'LOCAL_REVIEW_COMPLETE': proceed")).toBe(0);
    });
  });
});
