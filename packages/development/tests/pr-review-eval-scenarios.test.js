'use strict';

/**
 * TRD-031-TEST: Reviewer eval set (PRD scenarios).
 *
 * Validates PRD ACs: AC-020-1, AC-020-2, AC-020-3 (REQ-020).
 *
 * The Implementation AC tests for the module live in pr-review-eval.test.js.
 * These are the PRD-LEVEL scenarios, and they are run against the
 * repository's REAL ownership and rules state:
 *
 *   - owner confirmation is checked against the REAL `.github/CODEOWNERS`
 *     text of this repository, not an invented ownership table;
 *   - staleness is checked against the REAL hash of this repository's
 *     `REVIEW.md`, recomputed from the file on disk, and the file is EDITED
 *     between runs so "the case is re-reviewed whenever that area's review
 *     rules change" is shown rather than asserted;
 *   - cases live in REAL `<evalCasesDir>/<id>.json` FILES in a temporary
 *     checkout-shaped directory, and are loaded from disk the way the eval
 *     skill will load them.
 *
 * HONEST LIMIT, recorded deliberately: this repository ships NO eval cases
 * yet, and these scenarios do not invent any. A real case records a real
 * incident or revert and must be CONFIRMED BY THE CODE OWNER of the affected
 * area -- a human act that cannot be manufactured by a test or an agent.
 * Populating `docs/review-eval/cases/` is TRD-033's task, with the owner in
 * the loop. The fixtures below are openly test fixtures (`fixture-*` ids),
 * and every rule they are graded by is the repository's real one.
 *
 * Scenarios:
 *   - AC-020-1: a case records the change, the bug and where it lived, is
 *     confirmed by the code owner of the affected area, and is re-reviewed
 *     when that area's rules change.
 *   - AC-020-2: each case is scored for whether the reviewer found the bug,
 *     and the result is reported.
 *   - AC-020-3: a change that lowers the score is flagged as a regression,
 *     naming the cases that flipped.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { validateCase, scoreEval, compareEval, staleCases, DEFAULT_EVAL_CASES_DIR } = require('../lib/pr-review-eval');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CODEOWNERS = fs.readFileSync(path.join(REPO_ROOT, '.github/CODEOWNERS'), 'utf8');

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

/**
 * A case about a REAL defect this repository actually had: commit 9456221
 * decided the clean-tree gate before resume detection, so a resumed run was
 * refused on a dirty tree it had itself created. The record below is the
 * shape a maintainer fills in; the confirmation is the part only the owner
 * can supply, which is why nothing like this is committed to the repository.
 */
function fixtureCase(overrides = {}) {
  return {
    id: 'fixture-clean-tree-gate',
    change: 'https://github.com/Sunstone-Partners/ensemble/commit/9456221',
    bug: 'the clean-tree gate was decided before resume detection, refusing a resumed run on a tree it had created itself',
    location: { path: 'packages/development/lib/pr-review-state.js', startLine: 90, endLine: 120 },
    confirmedBy: '@ldangelo',
    rulesFile: 'REVIEW.md',
    rulesHash: sha256(fs.readFileSync(path.join(REPO_ROOT, 'REVIEW.md'), 'utf8')),
    ...overrides,
  };
}

/** Writes cases to disk the way the eval skill will read them: `<dir>/<id>.json`. */
function writeCases(root, cases, dir = DEFAULT_EVAL_CASES_DIR) {
  const target = path.join(root, dir);
  fs.mkdirSync(target, { recursive: true });
  return cases.map((record) => {
    const file = path.join(target, `${record.id}.json`);
    fs.writeFileSync(file, JSON.stringify(record, null, 2));
    return { record, relative: path.relative(root, file) };
  });
}

function withTempRepo(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-review-eval-'));
  try {
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('AC-020-1: a case records the change, the bug and its location, confirmed by the code owner', () => {
  test('every eval case the repository ships is owner-confirmed: a real case needs a real owner confirmation', () => {
    // Cases are added by a maintainer with the code owner's confirmation
    // (TRD-033); kata cwd4 shipped the first set. This used to pin "no cases
    // exist", which was a fact about one moment, not a rule; the rule is that
    // nothing in the directory is unconfirmed.
    const dir = path.join(REPO_ROOT, DEFAULT_EVAL_CASES_DIR);
    expect(fs.existsSync(dir)).toBe(true);
    const names = fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const record = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      const result = validateCase({ case: record, codeowners: CODEOWNERS, path: `${DEFAULT_EVAL_CASES_DIR}/${name}` });
      expect({ name, errors: result.errors }).toEqual({ name, errors: [] });
    }
  });

  test('a complete case, confirmed by the real CODEOWNERS owner of the path, is accepted', () => {
    withTempRepo((root) => {
      const [written] = writeCases(root, [fixtureCase()]);
      const loaded = JSON.parse(fs.readFileSync(path.join(root, written.relative), 'utf8'));

      const result = validateCase({ case: loaded, codeowners: CODEOWNERS, path: written.relative });
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
      expect(result.owners).toContain('@ldangelo');
    });
  });

  test('a case missing the change, the bug or the location is refused, each gap named', () => {
    const noChange = validateCase({ case: { ...fixtureCase(), change: '' }, codeowners: CODEOWNERS });
    expect(noChange.ok).toBe(false);
    expect(noChange.errors).toContainEqual({ field: 'change', reason: 'missing-field' });

    const noBug = validateCase({ case: { ...fixtureCase(), bug: '   ' }, codeowners: CODEOWNERS });
    expect(noBug.errors).toContainEqual({ field: 'bug', reason: 'missing-field' });

    const noLocation = validateCase({ case: { ...fixtureCase(), location: { path: 'lib/a.js' } }, codeowners: CODEOWNERS });
    expect(noLocation.errors).toContainEqual({ field: 'location', reason: 'invalid-location' });
  });

  test('a confirmation by somebody who does not own the affected area is refused', () => {
    const result = validateCase({ case: fixtureCase({ confirmedBy: '@a-passer-by' }), codeowners: CODEOWNERS });
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({ field: 'confirmedBy', reason: 'confirmed-by-not-owner' });
  });

  test('an unconfirmed case is refused: no owner, no case', () => {
    const result = validateCase({ case: fixtureCase({ confirmedBy: '' }), codeowners: CODEOWNERS });
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({ field: 'confirmedBy', reason: 'missing-confirmation' });
  });

  test('a case file outside the configured eval directory is not loaded', () => {
    withTempRepo((root) => {
      const [written] = writeCases(root, [fixtureCase()], 'docs/not-the-eval-dir');
      const result = validateCase({
        case: fixtureCase(),
        codeowners: CODEOWNERS,
        path: written.relative,
      });

      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({ field: 'path', reason: 'case-outside-eval-dir' });
    });
  });

  test('the case is re-reviewed when that area\'s review rules actually change', () => {
    withTempRepo((root) => {
      const rulesPath = path.join(root, 'REVIEW.md');
      fs.copyFileSync(path.join(REPO_ROOT, 'REVIEW.md'), rulesPath);
      const record = fixtureCase({ rulesHash: sha256(fs.readFileSync(rulesPath, 'utf8')) });

      const before = staleCases({ cases: [record], rulesHashes: { 'REVIEW.md': sha256(fs.readFileSync(rulesPath, 'utf8')) } });
      expect(before.stale).toEqual([]);
      expect(before.current).toEqual(['fixture-clean-tree-gate']);

      // A maintainer edits the rules for this area.
      fs.appendFileSync(rulesPath, '\n- **New rule.** Every fail-closed path names its reason.\n');

      const after = staleCases({ cases: [record], rulesHashes: { 'REVIEW.md': sha256(fs.readFileSync(rulesPath, 'utf8')) } });
      expect(after.stale).toEqual(['fixture-clean-tree-gate']);
      expect(after.reasons['fixture-clean-tree-gate']).toBe('rules-hash-changed');
    });
  });

  test('a rules file nobody can hash is stale, never quietly current', () => {
    const unknown = staleCases({ cases: [fixtureCase()], rulesHashes: {} });
    expect(unknown.stale).toEqual(['fixture-clean-tree-gate']);
    expect(unknown.reasons['fixture-clean-tree-gate']).toBe('rules-file-unknown');
  });
});

describe('AC-020-2: each case is scored for whether the reviewer found the bug', () => {
  const record = fixtureCase();

  const findingAt = (line, severity = 'important') => ({
    id: `F-${line}`,
    source: 'reviewer-a',
    locationOrLink: `packages/development/lib/pr-review-state.js:${line}`,
    severity,
    failureMode: 'clean-tree gate decided before resume detection',
    disposition: 'fix',
    evidence: 'the gate runs before the resume branch',
    originalTextOrLink: 'https://example.invalid/pr/1#r1',
  });

  test('an Important finding inside the recorded range counts as found, and the run reports a total', () => {
    const result = scoreEval({ cases: [record], findingsByCase: { [record.id]: [findingAt(95)] } });

    expect(result.ok).toBe(true);
    expect(result.cases).toEqual([
      { id: record.id, found: true, matchedFindingId: 'F-95', reason: 'important-finding-at-location' },
    ]);
    expect(result.total).toEqual({ cases: 1, found: 1, score: 1 });
  });

  test('a finding outside the recorded range is not the bug', () => {
    const result = scoreEval({ cases: [record], findingsByCase: { [record.id]: [findingAt(400)] } });
    expect(result.cases[0].found).toBe(false);
    expect(result.cases[0].reason).toBe('no-important-finding-at-location');
  });

  test('a Nit at the right place does not count: the reviewer did not find a bug', () => {
    const result = scoreEval({ cases: [record], findingsByCase: { [record.id]: [findingAt(95, 'nit')] } });
    expect(result.cases[0].found).toBe(false);
  });

  test('a case the run recorded nothing for is reported, never scored as found', () => {
    const result = scoreEval({ cases: [record], findingsByCase: {} });
    expect(result.cases[0]).toEqual({ id: record.id, found: false, matchedFindingId: null, reason: 'no-findings-recorded' });
    expect(result.total).toEqual({ cases: 1, found: 0, score: 0 });
  });

  test('a mixed run reports per-case results and the share found', () => {
    const second = fixtureCase({ id: 'fixture-second', location: { path: 'packages/development/lib/pr-review-votes.js', startLine: 1, endLine: 50 } });
    const result = scoreEval({
      cases: [record, second],
      findingsByCase: { [record.id]: [findingAt(95)], [second.id]: [findingAt(400)] },
    });

    expect(result.cases.map((entry) => entry.found)).toEqual([true, false]);
    expect(result.total).toEqual({ cases: 2, found: 1, score: 0.5 });
  });
});

describe('AC-020-3: a reviewer change that lowers the score is flagged as a regression', () => {
  const previous = {
    cases: [
      { id: 'fixture-a', found: true },
      { id: 'fixture-b', found: true },
    ],
  };

  test('a case that flips from found to missed is a regression, and the case is named', () => {
    const current = { cases: [{ id: 'fixture-a', found: true }, { id: 'fixture-b', found: false }] };
    const result = compareEval({ previous, current });

    expect(result.regression).toBe(true);
    expect(result.flipped).toEqual([{ id: 'fixture-b', from: true, to: false }]);
    expect(result.delta).toBe(-1);
  });

  test('a case dropped from the run is a regression too: a missing case is not a pass', () => {
    const result = compareEval({ previous, current: { cases: [{ id: 'fixture-a', found: true }] } });
    expect(result.regression).toBe(true);
    expect(result.missing).toEqual(['fixture-b']);
  });

  test('negative control: the same result twice is no regression', () => {
    expect(compareEval({ previous, current: previous }).regression).toBe(false);
  });

  test('an improvement is reported as gained, not as a regression', () => {
    const worse = { cases: [{ id: 'fixture-a', found: false }, { id: 'fixture-b', found: true }] };
    const better = { cases: [{ id: 'fixture-a', found: true }, { id: 'fixture-b', found: true }] };
    const result = compareEval({ previous: worse, current: better });

    expect(result.regression).toBe(false);
    expect(result.gained).toEqual([{ id: 'fixture-a', from: false, to: true }]);
  });

  test('the comparison runs on the real scorer output, not a hand-built summary', () => {
    const record = fixtureCase();
    const finding = {
      id: 'F1',
      source: 'reviewer-a',
      locationOrLink: 'packages/development/lib/pr-review-state.js:95',
      severity: 'important',
      failureMode: 'clean-tree gate decided before resume detection',
      disposition: 'fix',
      evidence: 'the gate runs before the resume branch',
      originalTextOrLink: 'https://example.invalid/pr/1#r1',
    };

    const before = scoreEval({ cases: [record], findingsByCase: { [record.id]: [finding] } });
    const after = scoreEval({ cases: [record], findingsByCase: { [record.id]: [{ ...finding, severity: 'nit' }] } });

    const comparison = compareEval({ previous: before, current: after });
    expect(comparison.regression).toBe(true);
    expect(comparison.flipped).toEqual([{ id: record.id, from: true, to: false }]);
  });
});
