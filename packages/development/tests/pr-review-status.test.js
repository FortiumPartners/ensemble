const {
  deriveStatus,
  MAX_AUTO_ROUNDS,
  STATUSES,
  LOCAL_PHASES,
  REMOTE_PHASES,
} = require('../lib/pr-review-status');

// Full object ids -- the only shape the grader accepts for a SHA: 40 hex (SHA-1) or 64 hex (SHA-256).
const BASE_SHA = '8b87a6d71146cd2e36e09c4fc265b6bb336f8798';
const HEAD_SHA = 'b8fe66aeb70b304237e584311a2b481a3c990f91';
const OTHER_SHA = '914369d8ebedb871a1f1f619f3ad410f48350642';
const SHA256 = 'ab12'.repeat(16);
// Tree ids as `git rev-parse <commit>^{tree}` prints them: full object ids, like every SHA the grader reads.
const TREE_A = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const TREE_B = '9daeafb9864cf43055ae93beb0afd6c7d144bfa4';
const TREE_256 = 'cd34'.repeat(16);

function baseFacts(overrides = {}) {
  return {
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    prUrl: 'https://github.com/org/repo/pull/1',
    reviewedHeadSha: HEAD_SHA,
    roundsUsed: 0,
    findingCounts: { total: 0, actionable: 0, deferred: 0 },
    tests: { passed: true, skipped: false, command: 'npx jest tests/foo.test.js' },
    remotePhase: 'REMOTE_REVIEW_COMPLETE',
    access: { ok: true },
    reportPath: '.ensemble/pr-review/pr-1.json',
    ...overrides,
  };
}

/** baseFacts with `key` absent entirely -- a fact nobody supplied, not an undefined-valued one. */
function without(key) {
  const facts = baseFacts();
  delete facts[key];
  return facts;
}

describe('pr-review-status: MAX_AUTO_ROUNDS', () => {
  test('is bounded at 2', () => {
    expect(MAX_AUTO_ROUNDS).toBe(2);
  });
});

describe('pr-review-status: deriveStatus', () => {
  test('a fully satisfied set of facts yields REVIEW_COMPLETE with both qualifiers', () => {
    const result = deriveStatus(baseFacts());
    expect(result.status).toBe('REVIEW_COMPLETE');
    expect(result.localPhase).toBe('LOCAL_REVIEW_COMPLETE');
    expect(result.remotePhase).toBe('REMOTE_REVIEW_COMPLETE');
  });

  test('result carries the full contract: SHAs, rounds, counts, tests and report path', () => {
    const result = deriveStatus(baseFacts({ roundsUsed: 1 }));
    expect(result.baseSha).toBe(BASE_SHA);
    expect(result.headSha).toBe(HEAD_SHA);
    expect(result.prUrl).toBe('https://github.com/org/repo/pull/1');
    expect(result.rounds).toEqual({ used: 1, max: MAX_AUTO_ROUNDS });
    expect(result.findingCounts).toEqual({ total: 0, actionable: 0, deferred: 0 });
    expect(result.tests).toEqual({ passed: true, skipped: false, command: 'npx jest tests/foo.test.js' });
    expect(result.reportPath).toBe('.ensemble/pr-review/pr-1.json');
  });

  test('at most two rounds -- roundsUsed at the cap with an unresolved finding permits no further automatic round', () => {
    const result = deriveStatus(
      baseFacts({ roundsUsed: MAX_AUTO_ROUNDS, findingCounts: { total: 1, actionable: 1, deferred: 0 } })
    );
    expect(result.next).not.toMatch(/auto|another-round|fix-round/i);
  });

  test('round limit never completes -- the cap is reached with actionable findings', () => {
    const result = deriveStatus(
      baseFacts({ roundsUsed: MAX_AUTO_ROUNDS, findingCounts: { total: 1, actionable: 1, deferred: 0 } })
    );
    expect(result.status).not.toBe('REVIEW_COMPLETE');
    expect(result.status).toBe('REVIEW_BLOCKED');
    expect(result.localPhase).toBe('LOCAL_REVIEW_BLOCKED');
    expect(result.reasons).toContain('round limit reached');
    expect(result.next).toBe('escalate-to-human');
  });

  test('unauthorized access blocks -- a 403 from review retrieval names the access problem', () => {
    const result = deriveStatus(baseFacts({ access: { ok: false, reason: '403 Forbidden' } }));
    expect(result.status).toBe('REVIEW_BLOCKED');
    expect(result.localPhase).toBe('LOCAL_REVIEW_BLOCKED');
    expect(result.remotePhase).toBe('REMOTE_REVIEW_BLOCKED');
    expect(result.next).toBe('resolve-review-access');
    expect(result.reasons).toContain('403 Forbidden');
  });

  test('not-yet-posted review is pending, not blocked', () => {
    const result = deriveStatus(baseFacts({ remotePhase: 'REMOTE_REVIEW_PENDING' }));
    expect(result.status).toBe('REVIEW_PENDING');
  });

  test('failed required check prevents completion', () => {
    const result = deriveStatus(baseFacts({ tests: { passed: false, skipped: false, command: 'npx jest x' } }));
    expect(result.status).not.toBe('REVIEW_COMPLETE');
  });

  test.each([
    ['unresolved finding', { findingCounts: { total: 1, actionable: 1, deferred: 0 } }],
    ['failed test', { tests: { passed: false, skipped: false, command: 'npx jest x' } }],
    ['pending review', { remotePhase: 'REMOTE_REVIEW_PENDING' }],
    ['stale SHA', { reviewedHeadSha: OTHER_SHA }],
  ])('each blocker alone prevents completion: %s', (_label, overrides) => {
    const result = deriveStatus(baseFacts(overrides));
    expect(result.status).not.toBe('REVIEW_COMPLETE');
  });

  test('qualifiers are reported beside the terminal status', () => {
    const result = deriveStatus(baseFacts({ remotePhase: 'REMOTE_REVIEW_PENDING' }));
    expect(result.localPhase).toBe('LOCAL_REVIEW_COMPLETE');
    expect(result.remotePhase).toBe('REMOTE_REVIEW_PENDING');
  });

  test('local complete plus remote pending is pending', () => {
    const result = deriveStatus(baseFacts({ remotePhase: 'REMOTE_REVIEW_PENDING' }));
    expect(result.localPhase).toBe('LOCAL_REVIEW_COMPLETE');
    expect(result.status).toBe('REVIEW_PENDING');
  });

  test('override never relabels -- a caller override on an incomplete result leaves it incomplete', () => {
    const result = deriveStatus(baseFacts({ remotePhase: 'REMOTE_REVIEW_PENDING', override: true }));
    expect(result.status).toBe('REVIEW_PENDING');
  });

  test('skip-tests keeps local review complete but the overall status is not REVIEW_COMPLETE', () => {
    const result = deriveStatus(baseFacts({ tests: { passed: false, skipped: true, command: 'npx jest x' } }));
    expect(result.localPhase).toBe('LOCAL_REVIEW_COMPLETE');
    expect(result.status).not.toBe('REVIEW_COMPLETE');
  });

  test('skip-tests reports its reason and the test command to run', () => {
    const result = deriveStatus(baseFacts({ tests: { passed: false, skipped: true, command: 'npx jest x' } }));
    expect(result.status).toBe('REVIEW_PENDING');
    expect(result.reasons).toContain('tests skipped');
    expect(result.tests.command).toBe('npx jest x');
  });
});

describe('pr-review-status: closed vocabulary', () => {
  const scenarios = {
    complete: baseFacts(),
    'remote pending': baseFacts({ remotePhase: 'REMOTE_REVIEW_PENDING' }),
    'actionable finding with rounds left': baseFacts({ findingCounts: { total: 1, actionable: 1, deferred: 0 } }),
    'round limit reached': baseFacts({
      roundsUsed: MAX_AUTO_ROUNDS,
      findingCounts: { total: 1, actionable: 1, deferred: 0 },
    }),
    'stale head': baseFacts({ reviewedHeadSha: OTHER_SHA }),
    'tests failed': baseFacts({ tests: { passed: false, skipped: false, command: 'npx jest x' } }),
    'tests skipped': baseFacts({ tests: { passed: false, skipped: true, command: 'npx jest x' } }),
    'access failure': baseFacts({ access: { ok: false, reason: '403 Forbidden' } }),
    'missing facts': {},
    'no argument': undefined,
  };

  test('exports the status, local-phase and remote-phase vocabularies callers gate on', () => {
    expect(STATUSES).toEqual(['REVIEW_COMPLETE', 'REVIEW_PENDING', 'REVIEW_BLOCKED']);
    expect(LOCAL_PHASES).toEqual(['LOCAL_REVIEW_COMPLETE', 'LOCAL_REVIEW_PENDING', 'LOCAL_REVIEW_BLOCKED']);
    expect(REMOTE_PHASES).toEqual(['REMOTE_REVIEW_COMPLETE', 'REMOTE_REVIEW_PENDING', 'REMOTE_REVIEW_BLOCKED']);
  });

  test.each(Object.entries(scenarios))(
    'every status and phase returned for "%s" is a member of the vocabulary, never null',
    (_label, facts) => {
      const result = deriveStatus(facts);
      expect(STATUSES).toContain(result.status);
      expect(LOCAL_PHASES).toContain(result.localPhase);
      expect(REMOTE_PHASES).toContain(result.remotePhase);
    }
  );

  test('every member of LOCAL_PHASES can actually be emitted', () => {
    const emitted = new Set(Object.values(scenarios).map((facts) => deriveStatus(facts).localPhase));
    expect(emitted).toEqual(new Set(LOCAL_PHASES));
  });
});

describe('pr-review-status: fails closed on missing or invalid facts', () => {
  test.each([
    ['baseSha', 'baseSha'],
    ['headSha', 'headSha'],
    ['reviewedHeadSha', 'reviewedHeadSha'],
    ['findingCounts', 'findingCounts.actionable'],
  ])('a missing %s is never complete: blocked, names the missing fact, asks for the facts', (key, factName) => {
    const result = deriveStatus(without(key));
    expect(result.status).toBe('REVIEW_BLOCKED');
    expect(result.localPhase).toBe('LOCAL_REVIEW_BLOCKED');
    expect(result.next).toBe('supply-review-facts');
    expect(result.reasons.join(' ')).toContain(factName);
  });

  test.each(
    ['baseSha', 'headSha', 'reviewedHeadSha'].flatMap((key) => [
      [key, 'an empty string', ''],
      [key, 'whitespace only', '   '],
      [key, 'a number', 42],
      [key, 'null', null],
    ])
  )('%s as %s is not a valid fact', (key, _label, value) => {
    const result = deriveStatus(baseFacts({ [key]: value }));
    expect(result.status).toBe('REVIEW_BLOCKED');
    expect(result.localPhase).toBe('LOCAL_REVIEW_BLOCKED');
    expect(result.reasons.join(' ')).toContain(key);
  });

  test.each([
    ['undefined', { total: 3, actionable: undefined, deferred: 0 }],
    ['absent', { total: 3, deferred: 0 }],
    ['null', { total: 3, actionable: null, deferred: 0 }],
    ['NaN', { total: 3, actionable: NaN, deferred: 0 }],
    ['Infinity', { total: 3, actionable: Infinity, deferred: 0 }],
    ['negative', { total: 3, actionable: -1, deferred: 0 }],
    ['a numeric string', { total: 3, actionable: '0', deferred: 0 }],
  ])('findingCounts.actionable that is %s is not a valid fact', (_label, findingCounts) => {
    const result = deriveStatus(baseFacts({ findingCounts }));
    expect(result.status).toBe('REVIEW_BLOCKED');
    expect(result.localPhase).toBe('LOCAL_REVIEW_BLOCKED');
    expect(result.reasons.join(' ')).toContain('findingCounts.actionable');
  });

  test.each([
    ['no argument', undefined],
    ['an empty object', {}],
    ['null', null],
  ])('%s is blocked and never complete', (_label, facts) => {
    const result = deriveStatus(facts);
    expect(result.status).toBe('REVIEW_BLOCKED');
    expect(result.localPhase).toBe('LOCAL_REVIEW_BLOCKED');
    expect(result.next).toBe('supply-review-facts');
  });

  test('the payloads that used to complete on almost no facts are no longer complete', () => {
    const noReviewFacts = deriveStatus({ remotePhase: 'REMOTE_REVIEW_COMPLETE', tests: { passed: true } });
    expect(noReviewFacts.status).not.toBe('REVIEW_COMPLETE');
    expect(noReviewFacts.localPhase).not.toBe('LOCAL_REVIEW_COMPLETE');

    const undefinedActionable = deriveStatus({
      headSha: 'a',
      findingCounts: { actionable: undefined, total: 3, deferred: 0 },
      remotePhase: 'REMOTE_REVIEW_COMPLETE',
      tests: { passed: true },
    });
    expect(undefinedActionable.status).not.toBe('REVIEW_COMPLETE');
    expect(undefinedActionable.localPhase).not.toBe('LOCAL_REVIEW_COMPLETE');
  });

  test('a missing findingCounts is not reported back as zero counts', () => {
    const result = deriveStatus(without('findingCounts'));
    expect(result.findingCounts).not.toEqual({ total: 0, actionable: 0, deferred: 0 });
  });

  test.each([
    ['an empty object', {}],
    ['a bare string', 'ok'],
    ['ok given as a string', { ok: 'true' }],
    ['no ok flag', { reason: 'something' }],
  ])('an unrecognised access fact (%s) is never treated as fine', (_label, access) => {
    const result = deriveStatus(baseFacts({ access }));
    expect(result.status).toBe('REVIEW_BLOCKED');
    expect(result.localPhase).toBe('LOCAL_REVIEW_BLOCKED');
    expect(result.reasons.join(' ')).toContain('access');
  });

  test('an absent access fact is not a blocker -- access is only ever a failure signal', () => {
    expect(deriveStatus(without('access')).status).toBe('REVIEW_COMPLETE');
  });

  test.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],
    ['the bare word COMPLETE', 'COMPLETE'],
    ['a wrong-case phase', 'remote_review_complete'],
    ['a number', 42],
  ])('an unrecognised remotePhase (%s) never completes', (_label, remotePhase) => {
    const result = deriveStatus(baseFacts({ remotePhase }));
    expect(result.status).not.toBe('REVIEW_COMPLETE');
    expect(result.remotePhase).toBe('REMOTE_REVIEW_PENDING');
  });
});

describe('pr-review-status: localPhase is the only publication gate', () => {
  test('LOCAL_REVIEW_COMPLETE when every local fact is present, valid and positive', () => {
    expect(deriveStatus(baseFacts()).localPhase).toBe('LOCAL_REVIEW_COMPLETE');
  });

  test.each([
    ['unresolved finding', { findingCounts: { total: 1, actionable: 1, deferred: 0 } }],
    ['failed test', { tests: { passed: false, skipped: false, command: 'npx jest x' } }],
    ['stale SHA', { reviewedHeadSha: OTHER_SHA }],
  ])('a single local blocker keeps the local phase pending, not complete: %s', (_label, overrides) => {
    const result = deriveStatus(baseFacts(overrides));
    expect(result.localPhase).toBe('LOCAL_REVIEW_PENDING');
    expect(result.status).not.toBe('REVIEW_COMPLETE');
  });

  test('tests that never ran are not a pass: the local phase stays pending and asks for a test run', () => {
    const result = deriveStatus(without('tests'));
    expect(result.localPhase).toBe('LOCAL_REVIEW_PENDING');
    expect(result.status).toBe('REVIEW_PENDING');
    expect(result.next).toMatch(/^run-tests/);
  });

  test('COMPLETE needs every fact: breaking any single fact, or any combination, is never complete', () => {
    const breakers = {
      baseSha: (facts) => delete facts.baseSha,
      headSha: (facts) => delete facts.headSha,
      reviewedHeadSha: (facts) => {
        facts.reviewedHeadSha = OTHER_SHA;
      },
      // A published commit that differs from the reviewed snapshot AND holds a different tree: not what was reviewed.
      treeMismatch: (facts) => {
        facts.reviewedHeadSha = OTHER_SHA;
        facts.reviewedTreeSha = TREE_A;
        facts.headTreeSha = TREE_B;
      },
      actionable: (facts) => {
        facts.findingCounts = { total: 1, actionable: 1, deferred: 0 };
      },
      tests: (facts) => {
        facts.tests = { passed: false, skipped: false, command: 'npx jest x' };
      },
      access: (facts) => {
        facts.access = { ok: false, reason: 'unavailable' };
      },
      remote: (facts) => {
        facts.remotePhase = 'REMOTE_REVIEW_PENDING';
      },
    };
    const keys = Object.keys(breakers);
    for (let mask = 0; mask < 2 ** keys.length; mask += 1) {
      const broken = keys.filter((_key, index) => mask & (1 << index));
      const facts = baseFacts();
      broken.forEach((key) => breakers[key](facts));
      const result = deriveStatus(facts);
      const label = broken.join('+') || 'nothing broken';
      expect([label, result.status === 'REVIEW_COMPLETE']).toEqual([label, broken.length === 0]);
      expect([label, result.localPhase === 'LOCAL_REVIEW_COMPLETE']).toEqual([
        label,
        broken.every((key) => key === 'remote'),
      ]);
    }
  });
});

// ---------------------------------------------------------------------------
// Round 2. The grader enforces what the docs claim: a SHA that is not a full
// object id, a bad round count or inconsistent finding counts is a missing
// fact, so none of them can produce a completed phase.
// ---------------------------------------------------------------------------

/** What a payload can carry where something else was expected. */
const WRONG_VALUES = [undefined, null, '', '   ', 0, 1, -1, 0.5, NaN, Infinity, true, false, 'x', {}, [], [[]], ['x'], [null]];

const NOT_OBJECT_IDS = [
  ['a branch name', 'main'],
  ['HEAD', 'HEAD'],
  ['a remote-tracking ref', 'origin/main'],
  ['a relative ref', 'HEAD~1'],
  ['an abbreviated SHA', HEAD_SHA.slice(0, 7)],
  ['a 39-character hex string', HEAD_SHA.slice(0, 39)],
  ['a 41-character hex string', `${HEAD_SHA}a`],
  ['a 63-character hex string', SHA256.slice(0, 63)],
  ['a 65-character hex string', `${SHA256}a`],
  ['non-hex characters at full length', 'g'.repeat(40)],
  ['a SHA padded with whitespace', ` ${HEAD_SHA}`],
  ['a SHA with a trailing newline', `${HEAD_SHA}\n`],
  ['a number', 12345],
  ['an array wrapping a valid SHA', [HEAD_SHA]],
  ['an object wrapping a valid SHA', { sha: HEAD_SHA }],
  ['the name __proto__', '__proto__'],
  ['the name constructor', 'constructor'],
];

const isBlockedForFacts = (result, factName) => {
  expect(result.status).toBe('REVIEW_BLOCKED');
  expect(result.localPhase).toBe('LOCAL_REVIEW_BLOCKED');
  expect(result.next).toBe('supply-review-facts');
  expect(result.reasons.join(' ')).toContain(factName);
};

describe('pr-review-status: baseSha, headSha and reviewedHeadSha must be full object ids', () => {
  describe.each(['baseSha', 'headSha', 'reviewedHeadSha'])('%s', (key) => {
    test.each(NOT_OBJECT_IDS)('%s is not a valid fact: blocked, naming it', (_label, value) => {
      isBlockedForFacts(deriveStatus(baseFacts({ [key]: value })), key);
    });
  });

  test('a moving ref that equals itself is no longer a head-bound review', () => {
    for (const ref of ['HEAD', 'main', 'origin/main', 'head1']) {
      const result = deriveStatus(baseFacts({ baseSha: BASE_SHA, headSha: ref, reviewedHeadSha: ref }));
      isBlockedForFacts(result, 'headSha');
      expect(result.status).not.toBe('REVIEW_COMPLETE');
      expect(result.localPhase).not.toBe('LOCAL_REVIEW_COMPLETE');
    }
  });

  test('accepts 40-hex and 64-hex object ids, in either letter case', () => {
    expect(deriveStatus(baseFacts({ baseSha: BASE_SHA.toUpperCase() })).status).toBe('REVIEW_COMPLETE');
    const sha256 = baseFacts({ baseSha: SHA256, headSha: SHA256.toUpperCase(), reviewedHeadSha: SHA256.toUpperCase() });
    expect(deriveStatus(sha256).status).toBe('REVIEW_COMPLETE');
  });

  test('a reviewed head that differs from the head only in letter case is stale, never complete', () => {
    const result = deriveStatus(baseFacts({ reviewedHeadSha: HEAD_SHA.toUpperCase() }));
    expect(result.status).not.toBe('REVIEW_COMPLETE');
    expect(result.localPhase).toBe('LOCAL_REVIEW_PENDING');
  });

  test('the object-id rule is the scope module\'s own: status delegates to it instead of keeping a copy', () => {
    const accepted = 'accepted-by-the-scope-module';
    let isolated;
    jest.isolateModules(() => {
      jest.doMock('../lib/pr-review-scope', () => ({
        ...jest.requireActual('../lib/pr-review-scope'),
        isObjectId: (value) => typeof value === 'string' && /^accepted-by-the-scope-module$/.test(value),
      }));
      isolated = require('../lib/pr-review-status');
    });
    jest.dontMock('../lib/pr-review-scope');

    const withRule = isolated.deriveStatus(baseFacts({ baseSha: accepted, headSha: accepted, reviewedHeadSha: accepted }));
    expect(withRule.status).toBe('REVIEW_COMPLETE');
    // ... and a real hex SHA is refused once the shared rule says so.
    expect(isolated.deriveStatus(baseFacts()).status).toBe('REVIEW_BLOCKED');
  });
});

describe('pr-review-status: roundsUsed must be a non-negative integer', () => {
  test.each(['x', '1', NaN, Infinity, -Infinity, -1, -9, 0.5, 1.5, null, true, false, {}, [], [1], 2 ** 53, 1e21])(
    'roundsUsed %p is not a valid fact: blocked, naming it',
    (roundsUsed) => {
      isBlockedForFacts(deriveStatus(baseFacts({ roundsUsed })), 'roundsUsed');
    }
  );

  test('a bad roundsUsed is blocked even when no actionable finding makes the round count matter', () => {
    expect(deriveStatus(baseFacts({ roundsUsed: 'x', findingCounts: { total: 0, actionable: 0, deferred: 0 } })).status).toBe(
      'REVIEW_BLOCKED'
    );
  });

  test.each([0, 1, 2, 3, 10])('roundsUsed %p is a valid count', (roundsUsed) => {
    const result = deriveStatus(baseFacts({ roundsUsed }));
    expect(result.status).toBe('REVIEW_COMPLETE');
    expect(result.rounds).toEqual({ used: roundsUsed, max: MAX_AUTO_ROUNDS });
  });

  test('an absent roundsUsed means no round has been used yet', () => {
    const result = deriveStatus(without('roundsUsed'));
    expect(result.status).toBe('REVIEW_COMPLETE');
    expect(result.rounds).toEqual({ used: 0, max: MAX_AUTO_ROUNDS });
  });

  test('a count above the cap with actionable findings still blocks through the round limit', () => {
    const result = deriveStatus(baseFacts({ roundsUsed: MAX_AUTO_ROUNDS + 5, findingCounts: { total: 1, actionable: 1, deferred: 0 } }));
    expect(result.localPhase).toBe('LOCAL_REVIEW_BLOCKED');
    expect(result.next).toBe('escalate-to-human');
  });
});

describe('pr-review-status: findingCounts must be consistent non-negative integers', () => {
  const BAD_COUNTS = [null, NaN, Infinity, -Infinity, -1, 0.5, '0', '1', true, false, {}, [], [0], 2 ** 53];

  describe.each(['actionable', 'total', 'deferred'])('findingCounts.%s', (name) => {
    test.each(BAD_COUNTS)('%p is not a valid fact: blocked, naming it', (value) => {
      const findingCounts = { total: 3, actionable: 1, deferred: 1, [name]: value };
      isBlockedForFacts(deriveStatus(baseFacts({ findingCounts })), `findingCounts.${name}`);
    });

    test('absent is not a valid fact either', () => {
      const findingCounts = { total: 3, actionable: 1, deferred: 1 };
      delete findingCounts[name];
      isBlockedForFacts(deriveStatus(baseFacts({ findingCounts })), `findingCounts.${name}`);
    });
  });

  test.each([
    [0, 1, 0],
    [0, 0, 1],
    [1, 1, 1],
    [2, 2, 1],
    [1, 0, 2],
  ])('a total of %p that is below actionable %p plus deferred %p is inconsistent: blocked', (total, actionable, deferred) => {
    isBlockedForFacts(deriveStatus(baseFacts({ findingCounts: { total, actionable, deferred } })), 'findingCounts');
  });

  test.each([
    [3, 1, 2],
    [5, 1, 2],
    [0, 0, 0],
    [4, 0, 4],
  ])('a total of %p that covers actionable %p plus deferred %p is consistent', (total, actionable, deferred) => {
    const result = deriveStatus(baseFacts({ findingCounts: { total, actionable, deferred }, roundsUsed: 0 }));
    expect(result.status).toBe(actionable === 0 ? 'REVIEW_COMPLETE' : 'REVIEW_PENDING');
    expect(result.next).not.toBe('supply-review-facts');
  });

  test('an inconsistent count is blocked as missing facts, not escalated as a round limit', () => {
    const result = deriveStatus(baseFacts({ roundsUsed: MAX_AUTO_ROUNDS, findingCounts: { total: 1, actionable: 1, deferred: 1 } }));
    expect(result.next).toBe('supply-review-facts');
  });

  test.each([undefined, null, 'x', 5, true, [], [{ total: 0, actionable: 0, deferred: 0 }]])(
    'findingCounts %p that is not an object names every count as missing',
    (findingCounts) => {
      const result = deriveStatus(baseFacts({ findingCounts }));
      for (const name of ['actionable', 'total', 'deferred']) isBlockedForFacts(result, `findingCounts.${name}`);
    }
  );

  test('the payload that used to complete with an unusable total and deferred is blocked', () => {
    const result = deriveStatus(
      baseFacts({ baseSha: 'b', headSha: 'HEAD', reviewedHeadSha: 'HEAD', findingCounts: { actionable: 0, total: 'x', deferred: -5 } })
    );
    expect(result.status).toBe('REVIEW_BLOCKED');
    const onlyActionable = deriveStatus(baseFacts({ findingCounts: { actionable: 0 } }));
    isBlockedForFacts(onlyActionable, 'findingCounts.total');
  });
});

describe('pr-review-status: adversarial sweep -- nothing completes unless every required fact is valid', () => {
  const isId = (value) => typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value);
  const isCount = (value) => Number.isInteger(value) && value >= 0;
  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

  /** A tree fact nobody supplied (absent or null) is fine; one that was supplied must be a full object id. */
  const treeReadable = (value) => value === undefined || value === null || isId(value);
  /** Fresh: the reviewed head IS the head, or both trees were supplied and are the identical object id. */
  const isFresh = (facts) =>
    facts.reviewedHeadSha === facts.headSha ||
    (isId(facts.reviewedTreeSha) && isId(facts.headTreeSha) && facts.reviewedTreeSha === facts.headTreeSha);

  /** What a locally complete fact set must at least look like, stated independently of the grader. */
  const localPreconditions = (facts) =>
    isId(facts.baseSha) &&
    isId(facts.headSha) &&
    isId(facts.reviewedHeadSha) &&
    treeReadable(facts.reviewedTreeSha) &&
    treeReadable(facts.headTreeSha) &&
    isFresh(facts) &&
    isObject(facts.findingCounts) &&
    isCount(facts.findingCounts.actionable) &&
    isCount(facts.findingCounts.total) &&
    isCount(facts.findingCounts.deferred) &&
    facts.findingCounts.total >= facts.findingCounts.actionable + facts.findingCounts.deferred &&
    facts.findingCounts.actionable === 0 &&
    (facts.roundsUsed === undefined || isCount(facts.roundsUsed)) &&
    (facts.access === undefined || facts.access === null || (isObject(facts.access) && facts.access.ok === true)) &&
    isObject(facts.tests) &&
    ['passed', 'skipped'].every((flag) => facts.tests[flag] === undefined || typeof facts.tests[flag] === 'boolean') &&
    (facts.tests.passed === true || facts.tests.skipped === true);

  const fullPreconditions = (facts) =>
    localPreconditions(facts) && facts.remotePhase === 'REMOTE_REVIEW_COMPLETE' && facts.tests.passed === true && facts.tests.skipped !== true;

  const check = (label, facts) => {
    const result = deriveStatus(facts);
    expect(STATUSES).toContain(result.status);
    expect(LOCAL_PHASES).toContain(result.localPhase);
    expect(REMOTE_PHASES).toContain(result.remotePhase);
    expect(result.reasons.every((reason) => typeof reason === 'string')).toBe(true);
    if (result.localPhase === 'LOCAL_REVIEW_COMPLETE') expect([label, 'local', localPreconditions(facts)]).toEqual([label, 'local', true]);
    if (result.status === 'REVIEW_COMPLETE') expect([label, 'full', fullPreconditions(facts)]).toEqual([label, 'full', true]);
    return result;
  };

  test('control: the base fact set completes and meets the preconditions, so the sweep below can fail', () => {
    expect(deriveStatus(baseFacts()).status).toBe('REVIEW_COMPLETE');
    expect(fullPreconditions(baseFacts())).toBe(true);
    // The oracle itself rejects a broken set.
    expect(localPreconditions(baseFacts({ baseSha: 'main' }))).toBe(false);
    expect(localPreconditions(baseFacts({ findingCounts: { total: 0, actionable: 1, deferred: 0 } }))).toBe(false);
    // ... including the freshness rule: a different head is only fresh through an identical, readable tree.
    expect(localPreconditions(baseFacts({ reviewedHeadSha: OTHER_SHA }))).toBe(false);
    expect(localPreconditions(baseFacts({ reviewedHeadSha: OTHER_SHA, reviewedTreeSha: TREE_A, headTreeSha: TREE_A }))).toBe(true);
    expect(localPreconditions(baseFacts({ reviewedHeadSha: OTHER_SHA, reviewedTreeSha: TREE_A, headTreeSha: TREE_B }))).toBe(false);
    expect(localPreconditions(baseFacts({ reviewedTreeSha: 'main' }))).toBe(false);
  });

  test.each(['baseSha', 'headSha', 'reviewedHeadSha', 'reviewedTreeSha', 'headTreeSha', 'findingCounts', 'tests', 'remotePhase', 'roundsUsed', 'access'])(
    'wrong %s values, or the key deleted, complete only while the preconditions still hold',
    (key) => {
      const values = [...WRONG_VALUES, ...NOT_OBJECT_IDS.map(([, value]) => value), 'REMOTE_REVIEW_PENDING', 'REMOTE_REVIEW_BLOCKED', 'remote_review_complete'];
      for (const value of values) check(`${key}=${String(value)}`, baseFacts({ [key]: value }));
      check(`${key} deleted`, without(key));
    }
  );

  test.each([
    ['findingCounts', ['actionable', 'total', 'deferred']],
    ['tests', ['passed', 'skipped', 'command']],
    ['access', ['ok', 'reason']],
  ])('wrong %s members complete only while the preconditions still hold', (key, members) => {
    for (const member of members) {
      for (const value of [...WRONG_VALUES, '0', 2 ** 53]) {
        const facts = baseFacts({ access: { ok: true }, [key]: { ...baseFacts({ access: { ok: true } })[key], [member]: value } });
        check(`${key}.${member}=${String(value)}`, facts);
      }
    }
  });

  test.each([undefined, null, [], 'x', 5, true])('facts that are not an object (%p) are blocked', (facts) => {
    const result = check(String(facts), facts);
    expect(result.status).toBe('REVIEW_BLOCKED');
    expect(result.localPhase).toBe('LOCAL_REVIEW_BLOCKED');
  });

  test('a JSON payload that smuggles __proto__ or constructor keys never completes', () => {
    const smuggled = JSON.parse(
      `{"__proto__":{"baseSha":"${BASE_SHA}","headSha":"${HEAD_SHA}","reviewedHeadSha":"${HEAD_SHA}"},` +
        '"constructor":{"prototype":{"remotePhase":"REMOTE_REVIEW_COMPLETE"}},' +
        '"findingCounts":{"total":0,"actionable":0,"deferred":0},"tests":{"passed":true},"remotePhase":"REMOTE_REVIEW_COMPLETE"}'
    );
    const result = deriveStatus(smuggled);
    expect(result.status).not.toBe('REVIEW_COMPLETE');
    expect(result.localPhase).not.toBe('LOCAL_REVIEW_COMPLETE');
  });

  test('a caller override never relabels a result that the facts made incomplete', () => {
    for (const key of ['baseSha', 'roundsUsed', 'findingCounts']) {
      const result = deriveStatus({ ...baseFacts({ [key]: 'x' }), override: true });
      expect(result.status).toBe('REVIEW_BLOCKED');
    }
  });
});

// A recorded `tests` fact is read as booleans or not at all: a flag that is present but is not a boolean is a fact nobody
// can read, not a "false" and not a "true" -- so it never rides along into a completed phase beside a passing flag.
describe('pr-review-status: a recorded tests fact must be readable', () => {
  const NOT_BOOLEAN = WRONG_VALUES.filter((value) => value !== undefined && typeof value !== 'boolean');
  const NOT_AN_OBJECT = [5, 0, NaN, 'x', 'passed', true, false, [], [{ passed: true }], ['x']];
  const COMPANIONS = { passed: [{}, { skipped: true }, { skipped: false }], skipped: [{}, { passed: true }, { passed: false }] };

  test.each(['passed', 'skipped'])('a %s flag that is present but not a boolean is unreadable: blocked, naming it', (flag) => {
    expect(NOT_BOOLEAN.length).toBeGreaterThan(10);
    for (const value of NOT_BOOLEAN) {
      for (const companion of COMPANIONS[flag]) {
        const result = deriveStatus(baseFacts({ tests: { ...companion, [flag]: value, command: 'npm test' } }));
        expect([String(value), JSON.stringify(companion), result.status]).toEqual([String(value), JSON.stringify(companion), 'REVIEW_BLOCKED']);
        isBlockedForFacts(result, `tests.${flag}`);
      }
    }
  });

  test.each(NOT_AN_OBJECT)('a recorded tests fact that is not an object (%p) is unreadable: blocked, naming it', (tests) => {
    isBlockedForFacts(deriveStatus(baseFacts({ tests })), 'tests');
  });

  test('tests nobody recorded -- absent, undefined or null -- never ran: pending, with the tests to run, not blocked', () => {
    for (const facts of [baseFacts({ tests: undefined }), baseFacts({ tests: null }), without('tests')]) {
      const result = deriveStatus(facts);
      expect([result.status, result.localPhase, result.next]).toEqual(['REVIEW_PENDING', 'LOCAL_REVIEW_PENDING', 'run-tests']);
    }
  });

  test.each([
    ['passed alone', { passed: true }, 'REVIEW_COMPLETE', 'LOCAL_REVIEW_COMPLETE'],
    ['passed and not skipped', { passed: true, skipped: false }, 'REVIEW_COMPLETE', 'LOCAL_REVIEW_COMPLETE'],
    ['skipped alone', { skipped: true }, 'REVIEW_PENDING', 'LOCAL_REVIEW_COMPLETE'],
    ['passed and skipped contradict each other, so the review is not complete', { passed: true, skipped: true }, 'REVIEW_PENDING', 'LOCAL_REVIEW_COMPLETE'],
    ['failed', { passed: false }, 'REVIEW_PENDING', 'LOCAL_REVIEW_PENDING'],
    ['an empty record', {}, 'REVIEW_PENDING', 'LOCAL_REVIEW_PENDING'],
  ])('booleans are read as written: %s', (_label, tests, status, localPhase) => {
    const result = deriveStatus(baseFacts({ tests }));
    expect([result.status, result.localPhase]).toEqual([status, localPhase]);
  });
});

// ---------------------------------------------------------------------------
// Round 3. fix-issue's local review is bound to a SNAPSHOT commit (a synthetic commit built from a temporary index); PR
// Creation then makes the one real commit. So the published head differs from the reviewed head even when it holds exactly
// the reviewed content, and a freshness rule of head equality alone makes local -> publish -> remote unable to reach
// COMPLETE. Freshness is head equality OR an identical tree -- and a tree fact nobody can read is never an identical tree.
// ---------------------------------------------------------------------------

describe('pr-review-status: a published commit that holds the reviewed tree is fresh', () => {
  /** The published-commit shape: the reviewed snapshot (OTHER_SHA) and the pushed head (HEAD_SHA) are different commits. */
  const published = (overrides = {}) => baseFacts({ reviewedHeadSha: OTHER_SHA, reviewedTreeSha: TREE_A, headTreeSha: TREE_A, ...overrides });
  const verdict = (result) => [result.status, result.localPhase, result.next];
  const STALE = ['REVIEW_PENDING', 'LOCAL_REVIEW_PENDING', 're-run-review-for-current-head'];

  test('local -> publish -> remote reaches REVIEW_COMPLETE: a different head holding the identical tree is the reviewed content', () => {
    const result = deriveStatus(published());
    expect([result.status, result.localPhase, result.remotePhase]).toEqual(['REVIEW_COMPLETE', 'LOCAL_REVIEW_COMPLETE', 'REMOTE_REVIEW_COMPLETE']);
    expect(result.next).toBe('none');
  });

  test('with the remote review still pending the local phase is complete and the next step is to await it', () => {
    expect(verdict(deriveStatus(published({ remotePhase: 'REMOTE_REVIEW_PENDING' })))).toEqual(['REVIEW_PENDING', 'LOCAL_REVIEW_COMPLETE', 'await-remote-review']);
  });

  test('64-hex tree ids work the same, and ids that are equal in either letter case are equal', () => {
    expect(deriveStatus(published({ reviewedTreeSha: TREE_256, headTreeSha: TREE_256 })).status).toBe('REVIEW_COMPLETE');
    expect(deriveStatus(published({ reviewedTreeSha: TREE_A.toUpperCase(), headTreeSha: TREE_A.toUpperCase() })).status).toBe('REVIEW_COMPLETE');
  });

  test('a tree that differs only in letter case is a different tree, exactly as a head that differs only in letter case is a different head', () => {
    expect(verdict(deriveStatus(published({ headTreeSha: TREE_A.toUpperCase() })))).toEqual(STALE);
  });

  test('a different tree is not the reviewed content: stale, and the local review is re-run', () => {
    expect(verdict(deriveStatus(published({ headTreeSha: TREE_B })))).toEqual(STALE);
    expect(verdict(deriveStatus(published({ reviewedTreeSha: TREE_B })))).toEqual(STALE);
    // 64-hex against 40-hex are different ids too.
    expect(verdict(deriveStatus(published({ headTreeSha: TREE_256 })))).toEqual(STALE);
  });

  test.each([
    ['only the reviewed tree', { headTreeSha: undefined }],
    ['only the head tree', { reviewedTreeSha: undefined }],
    ['neither tree', { reviewedTreeSha: undefined, headTreeSha: undefined }],
    ['null trees, which mean not supplied', { reviewedTreeSha: null, headTreeSha: null }],
    ['a null reviewed tree beside a head tree', { reviewedTreeSha: null }],
    ['a null head tree beside a reviewed tree', { headTreeSha: null }],
  ])('different heads with %s: tree equivalence is not established, so the review is stale -- never blocked, never complete', (_label, overrides) => {
    expect(verdict(deriveStatus(published(overrides)))).toEqual(STALE);
  });

  test('the keys deleted outright, not just undefined, are the same as not supplied', () => {
    for (const keys of [['reviewedTreeSha'], ['headTreeSha'], ['reviewedTreeSha', 'headTreeSha']]) {
      const facts = published();
      keys.forEach((key) => delete facts[key]);
      expect([keys.join('+'), verdict(deriveStatus(facts))]).toEqual([keys.join('+'), STALE]);
    }
  });

  test('the identical head completes whatever trees are named, or none: head equality suffices (decided, not accidental)', () => {
    // A head names exactly one tree, so two readable trees that differ beside an identical head are a caller's inconsistency;
    // what was reviewed is still what is being published, because the commit is the same one.
    expect(deriveStatus(baseFacts({ reviewedTreeSha: TREE_A, headTreeSha: TREE_B })).status).toBe('REVIEW_COMPLETE');
    expect(deriveStatus(baseFacts({ reviewedTreeSha: TREE_A })).status).toBe('REVIEW_COMPLETE');
    expect(deriveStatus(baseFacts({ reviewedTreeSha: null, headTreeSha: null })).status).toBe('REVIEW_COMPLETE');
    expect(deriveStatus(baseFacts()).status).toBe('REVIEW_COMPLETE');
  });

  test('tree equivalence only ends staleness: it never overrides a finding, a failed test, a pending remote review or a missing fact', () => {
    const blockers = {
      'an actionable finding': { findingCounts: { total: 1, actionable: 1, deferred: 0 } },
      'failed tests': { tests: { passed: false, skipped: false, command: 'npm test' } },
      'skipped tests': { tests: { passed: false, skipped: true, command: 'npm test' } },
      'tests nobody recorded': { tests: undefined },
      'a pending remote review': { remotePhase: 'REMOTE_REVIEW_PENDING' },
      'an access failure': { access: { ok: false, reason: '403 Forbidden' } },
      'a missing baseSha': { baseSha: undefined },
      'the round limit': { roundsUsed: MAX_AUTO_ROUNDS, findingCounts: { total: 1, actionable: 1, deferred: 0 } },
    };
    for (const [label, overrides] of Object.entries(blockers)) {
      const result = deriveStatus(published(overrides));
      expect([label, result.status]).not.toEqual([label, 'REVIEW_COMPLETE']);
    }
    expect(deriveStatus(published(blockers['an actionable finding'])).next).toBe('run-fix-round');
    expect(deriveStatus(published(blockers['failed tests'])).next).toMatch(/^run-tests/);
    expect(deriveStatus(published(blockers['the round limit'])).next).toBe('escalate-to-human');
  });

  test('the result echoes the heads and trees it graded, so the report recorded from it carries what was reviewed', () => {
    const complete = deriveStatus(published());
    expect([complete.headSha, complete.reviewedHeadSha, complete.reviewedTreeSha, complete.headTreeSha]).toEqual([HEAD_SHA, OTHER_SHA, TREE_A, TREE_A]);
    // Also when access fails and nothing else is graded.
    const denied = deriveStatus(published({ access: { ok: false, reason: '403 Forbidden' } }));
    expect([denied.reviewedHeadSha, denied.reviewedTreeSha, denied.headTreeSha]).toEqual([OTHER_SHA, TREE_A, TREE_A]);
    // A tree nobody supplied is null, never a made-up value.
    const none = deriveStatus(baseFacts());
    expect([none.reviewedHeadSha, none.reviewedTreeSha, none.headTreeSha]).toEqual([HEAD_SHA, null, null]);
  });

  test('a tree that is not a full object id is not echoed: the blocked result can still be recorded, and names the fact', () => {
    const result = deriveStatus(published({ reviewedTreeSha: 'main', headTreeSha: ` ${TREE_A}` }));
    expect([result.reviewedTreeSha, result.headTreeSha]).toEqual([null, null]);
    isBlockedForFacts(result, 'reviewedTreeSha');
    isBlockedForFacts(result, 'headTreeSha');
  });
});

describe('pr-review-status: a tree fact that cannot be read blocks, whatever the heads say', () => {
  const UNREADABLE = [
    ...NOT_OBJECT_IDS,
    ...WRONG_VALUES.filter((value) => value !== undefined && value !== null).map((value) => [
      `${typeof value} ${typeof value === 'object' ? JSON.stringify(value) : JSON.stringify(String(value))}`,
      value,
    ]),
  ];

  describe.each(['reviewedTreeSha', 'headTreeSha'])('%s', (side) => {
    const other = side === 'reviewedTreeSha' ? 'headTreeSha' : 'reviewedTreeSha';

    test.each(UNREADABLE)('different heads, the other tree readable and equal: %s is unreadable -- blocked, naming it', (_label, value) => {
      const result = deriveStatus(baseFacts({ reviewedHeadSha: OTHER_SHA, [other]: TREE_A, [side]: value }));
      isBlockedForFacts(result, side);
      expect(result.status).not.toBe('REVIEW_COMPLETE');
    });

    test.each(UNREADABLE)('the identical head, which needs no tree: %s is still unreadable -- blocked, naming it', (_label, value) => {
      const result = deriveStatus(baseFacts({ [side]: value }));
      isBlockedForFacts(result, side);
      expect(result.status).not.toBe('REVIEW_COMPLETE');
    });
  });

  test.each(UNREADABLE)('two trees that are equal because they are both %s are never an identical tree: blocked, never complete', (_label, value) => {
    const result = deriveStatus(baseFacts({ reviewedHeadSha: OTHER_SHA, reviewedTreeSha: value, headTreeSha: value }));
    isBlockedForFacts(result, 'reviewedTreeSha');
    isBlockedForFacts(result, 'headTreeSha');
    expect(result.localPhase).toBe('LOCAL_REVIEW_BLOCKED');
  });

  test.each([
    ['padded on both sides of a lowercase id', ` ${TREE_A}\n`],
    ['padded around an uppercase id', `\t${TREE_A.toUpperCase()} `],
    ['trailing newline only', `${TREE_A}\n`],
  ])('a tree id %s is not the tree id it wraps: blocked, whichever side carries it', (_label, padded) => {
    for (const [reviewedTreeSha, headTreeSha] of [[padded, TREE_A], [TREE_A, padded], [padded, padded]]) {
      const result = deriveStatus(baseFacts({ reviewedHeadSha: OTHER_SHA, reviewedTreeSha, headTreeSha }));
      expect([result.status, result.localPhase, result.next]).toEqual(['REVIEW_BLOCKED', 'LOCAL_REVIEW_BLOCKED', 'supply-review-facts']);
    }
  });
});

describe('pr-review-status: freshness sweep -- complete exactly when the head matches or the trees are identical and readable', () => {
  const isId = (value) => typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value);
  const VALUES = [undefined, null, TREE_A, TREE_A.toUpperCase(), TREE_B, TREE_256, '', '   ', 'main', TREE_A.slice(0, 39), ` ${TREE_A}`, `${TREE_A}\n`, 5, true, {}, [TREE_A], ['x']];
  const readable = (value) => value === undefined || value === null || isId(value);

  /** Stated independently of the grader, from the rule in the module header. */
  const expectedComplete = (reviewedHeadSha, reviewedTreeSha, headTreeSha) =>
    readable(reviewedTreeSha) &&
    readable(headTreeSha) &&
    (reviewedHeadSha === HEAD_SHA || (isId(reviewedTreeSha) && isId(headTreeSha) && reviewedTreeSha === headTreeSha));

  test('every combination of reviewed head and the two tree facts agrees with the oracle, in both directions', () => {
    let completes = 0;
    let refuses = 0;
    for (const reviewedHeadSha of [HEAD_SHA, OTHER_SHA]) {
      for (const reviewedTreeSha of VALUES) {
        for (const headTreeSha of VALUES) {
          const label = `reviewed=${reviewedHeadSha === HEAD_SHA ? 'head' : 'other'} rt=${JSON.stringify(reviewedTreeSha)} ht=${JSON.stringify(headTreeSha)}`;
          const result = deriveStatus(baseFacts({ reviewedHeadSha, reviewedTreeSha, headTreeSha }));
          const expected = expectedComplete(reviewedHeadSha, reviewedTreeSha, headTreeSha);
          expect([label, result.status === 'REVIEW_COMPLETE', result.localPhase === 'LOCAL_REVIEW_COMPLETE']).toEqual([label, expected, expected]);
          // Unreadable tree facts are the only way to a blocked local phase here; a readable stale one is pending.
          const blocked = !(readable(reviewedTreeSha) && readable(headTreeSha));
          expect([label, result.localPhase === 'LOCAL_REVIEW_BLOCKED']).toEqual([label, blocked]);
          if (expected) completes += 1;
          else refuses += 1;
        }
      }
    }
    // The sweep is not vacuous: both outcomes occur, many times.
    expect(completes).toBeGreaterThan(20);
    expect(refuses).toBeGreaterThan(100);
  });
});
