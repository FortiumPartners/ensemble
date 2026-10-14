const { evaluateRemoteReview } = require('../lib/pr-review-remote');

const HEAD = 'head-sha-current';
const BOT_LOGINS = ['coderabbit[bot]'];

/** A bot review bound to the current head; any field can be overridden per review. */
const botReview = (state, overrides = {}) => ({
  id: 'r1',
  author: 'coderabbit[bot]',
  commitSha: HEAD,
  state,
  ...overrides,
});

/** Evaluates `reviews` for the current head with the single configured bot, unless `extra` overrides the facts. */
const evaluate = (reviews, extra = {}) =>
  evaluateRemoteReview({
    headSha: HEAD,
    reviews,
    comments: [],
    threads: [],
    checkRuns: [],
    botLogins: BOT_LOGINS,
    ...extra,
  });

describe('pr-review-remote: evaluateRemoteReview', () => {
  test('complete set collected -- reviews, inline comments and an unresolved thread on the head are all present', () => {
    const result = evaluateRemoteReview({
      headSha: HEAD,
      reviews: [{ id: 'r1', author: 'coderabbit[bot]', commitSha: HEAD, state: 'commented' }],
      comments: [{ id: 'c1', author: 'human1', commitSha: HEAD }],
      threads: [{ id: 't1', resolved: false }],
      checkRuns: [],
      botLogins: BOT_LOGINS,
    });
    expect(result.collected.map((i) => i.id).sort()).toEqual(['c1', 'r1']);
    expect(result.unresolvedThreads).toHaveLength(1);
    expect(result.unresolvedThreads[0].id).toBe('t1');
  });

  test('older head review does not count -- a bot review of a previous head leaves the phase pending', () => {
    const result = evaluateRemoteReview({
      headSha: 'head-B',
      reviews: [{ id: 'r1', author: 'coderabbit[bot]', commitSha: 'head-A', state: 'approved' }],
      comments: [],
      threads: [],
      checkRuns: [],
      botLogins: BOT_LOGINS,
    });
    expect(result.remotePhase).toBe('REMOTE_REVIEW_PENDING');
    expect(result.collected).toHaveLength(0);
  });

  test('non-bot review does not count -- a human approval bound to the head without a bot review is not complete', () => {
    const result = evaluateRemoteReview({
      headSha: HEAD,
      reviews: [{ id: 'r1', author: 'human1', commitSha: HEAD, state: 'approved' }],
      comments: [],
      threads: [],
      checkRuns: [],
      botLogins: BOT_LOGINS,
    });
    expect(result.remotePhase).not.toBe('REMOTE_REVIEW_COMPLETE');
    expect(result.remotePhase).toBe('REMOTE_REVIEW_PENDING');
  });

  test('summary without commit identity is unverifiable and keeps the phase pending', () => {
    const result = evaluateRemoteReview({
      headSha: HEAD,
      reviews: [],
      comments: [{ id: 'c1', author: 'coderabbit[bot]', commitSha: undefined, body: 'Summary' }],
      threads: [],
      checkRuns: [],
      botLogins: BOT_LOGINS,
    });
    expect(result.remotePhase).toBe('REMOTE_REVIEW_PENDING');
    expect(result.unverifiable.map((i) => i.id)).toEqual(['c1']);
  });

  test('a bot review bound to the exact head with no unresolved threads is complete', () => {
    const result = evaluateRemoteReview({
      headSha: HEAD,
      reviews: [{ id: 'r1', author: 'coderabbit[bot]', commitSha: HEAD, state: 'approved' }],
      comments: [],
      threads: [{ id: 't1', resolved: true }],
      checkRuns: [],
      botLogins: BOT_LOGINS,
    });
    expect(result.remotePhase).toBe('REMOTE_REVIEW_COMPLETE');
    expect(result.unresolvedThreads).toHaveLength(0);
  });

  test('a bot check run bound to the head counts toward completion', () => {
    const result = evaluateRemoteReview({
      headSha: HEAD,
      reviews: [],
      comments: [],
      threads: [],
      checkRuns: [{ id: 'chk1', author: 'coderabbit[bot]', commitSha: HEAD, conclusion: 'success' }],
      botLogins: BOT_LOGINS,
    });
    expect(result.remotePhase).toBe('REMOTE_REVIEW_COMPLETE');
  });

  test('unavailable or unauthorized access reports pending with the access reason', () => {
    const result = evaluateRemoteReview({
      headSha: HEAD,
      reviews: [{ id: 'r1', author: 'coderabbit[bot]', commitSha: HEAD, state: 'approved' }],
      comments: [],
      threads: [],
      checkRuns: [],
      botLogins: BOT_LOGINS,
      access: { ok: false, reason: '403 Forbidden' },
    });
    expect(result.remotePhase).toBe('REMOTE_REVIEW_PENDING');
    expect(result.reasons).toContain('403 Forbidden');
  });
});

describe('pr-review-remote: only a review in a terminal reviewed state counts', () => {
  test.each(['COMMENTED', 'APPROVED'])('a bot review in state %s bound to the head completes the remote phase', (state) => {
    expect(evaluate([botReview(state)]).remotePhase).toBe('REMOTE_REVIEW_COMPLETE');
  });

  test.each(['commented', 'Approved'])('the review state is matched regardless of letter case (%s)', (state) => {
    expect(evaluate([botReview(state)]).remotePhase).toBe('REMOTE_REVIEW_COMPLETE');
  });

  test.each(['CHANGES_REQUESTED', 'changes_requested', 'Changes Requested', 'ChangesRequested'])(
    'a bot review in state %s never completes the remote phase and carries a reason',
    (state) => {
      const result = evaluate([botReview(state)]);
      expect(result.remotePhase).toBe('REMOTE_REVIEW_PENDING');
      expect(result.reasons.length).toBeGreaterThan(0);
    }
  );

  test.each(['PENDING', 'DISMISSED'])('a bot review in state %s is ignored and never counts', (state) => {
    const result = evaluate([botReview(state)]);
    expect(result.remotePhase).toBe('REMOTE_REVIEW_PENDING');
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  test.each(['SUBMITTED', 'STALE', 'something-new'])('a bot review in an unrecognised state (%s) never counts', (state) => {
    expect(evaluate([botReview(state)]).remotePhase).toBe('REMOTE_REVIEW_PENDING');
  });

  test('PENDING and DISMISSED reviews are ignored rather than blocking: a terminal review on the same head still completes', () => {
    const result = evaluate([
      botReview('DISMISSED', { id: 'r0' }),
      botReview('PENDING', { id: 'r2' }),
      botReview('COMMENTED', { id: 'r3' }),
    ]);
    expect(result.remotePhase).toBe('REMOTE_REVIEW_COMPLETE');
  });

  test.each([
    ['approved before it', ['APPROVED', 'CHANGES_REQUESTED']],
    ['commented around it', ['COMMENTED', 'CHANGES_REQUESTED', 'COMMENTED']],
  ])('a CHANGES_REQUESTED review that is the latest decisive review blocks completion beside other reviews (%s)', (_label, states) => {
    const reviews = states.map((state, index) => botReview(state, { id: `r${index}` }));
    expect(evaluate(reviews).remotePhase).toBe('REMOTE_REVIEW_PENDING');
  });

  test('a CHANGES_REQUESTED review from an older head still blocks the current head until a later decisive review supersedes it', () => {
    const olderRequest = botReview('CHANGES_REQUESTED', { id: 'r0', commitSha: 'head-sha-older' });
    // A later COMMENTED review on the current head does not clear the request ...
    expect(evaluate([olderRequest, botReview('COMMENTED', { id: 'r1' })]).remotePhase).toBe('REMOTE_REVIEW_PENDING');
    // ... a later APPROVED review does.
    expect(evaluate([olderRequest, botReview('APPROVED', { id: 'r1' })]).remotePhase).toBe('REMOTE_REVIEW_COMPLETE');
  });

  test('items that carry no state keep their meaning: a bot comment and a bot check run on the head still count', () => {
    const comment = evaluate([], { comments: [{ id: 'c1', author: 'coderabbit[bot]', commitSha: HEAD }] });
    expect(comment.remotePhase).toBe('REMOTE_REVIEW_COMPLETE');
    const check = evaluate([], {
      checkRuns: [{ id: 'chk1', author: 'coderabbit[bot]', commitSha: HEAD, conclusion: 'success' }],
    });
    expect(check.remotePhase).toBe('REMOTE_REVIEW_COMPLETE');
  });

  test('an ignored or blocking state does not change what is collected for the head', () => {
    const result = evaluate([
      botReview('DISMISSED', { id: 'r0' }),
      botReview('CHANGES_REQUESTED', { id: 'r1' }),
      botReview('COMMENTED', { id: 'r2' }),
    ]);
    expect(result.collected.map((item) => item.id).sort()).toEqual(['r0', 'r1', 'r2']);
  });

  test('a terminal review still needs every thread resolved', () => {
    const result = evaluate([botReview('APPROVED')], { threads: [{ id: 't1', resolved: false }] });
    expect(result.remotePhase).toBe('REMOTE_REVIEW_PENDING');
  });
});

describe('pr-review-remote: the effective reviewer state is the latest APPROVED / CHANGES_REQUESTED / DISMISSED review', () => {
  const T1 = '2026-10-14T10:00:00Z';
  const T2 = '2026-10-14T10:05:00Z';
  const FIRST_BOT = 'coderabbit[bot]';
  const SECOND_BOT = 'second-reviewer[bot]';
  const BOTH_BOTS = { botLogins: [FIRST_BOT, SECOND_BOT] };

  // A stateless bot comment on the head is fallback evidence. Where a test needs the effective request to be the ONLY
  // thing keeping the phase pending, adding it makes a wrongly cleared request flip the result to COMPLETE.
  const FALLBACK_EVIDENCE = { comments: [{ id: 'c-fallback', author: FIRST_BOT, commitSha: HEAD }] };

  /** One bound bot review per [state, overrides] spec, in the order GitHub returns them (oldest first). */
  const inOrder = (...specs) =>
    specs.map(([state, overrides], index) => botReview(state, { id: `r${index}`, ...overrides }));
  const phaseOf = (...specs) => evaluate(inOrder(...specs)).remotePhase;

  describe('a later decisive review by the same bot supersedes an earlier one (input order)', () => {
    test('CHANGES_REQUESTED followed by APPROVED completes -- the approval supersedes the request', () => {
      const result = evaluate(inOrder(['CHANGES_REQUESTED'], ['APPROVED']));
      expect(result.remotePhase).toBe('REMOTE_REVIEW_COMPLETE');
      expect(result.reasons).toEqual([]);
    });

    test('APPROVED followed by CHANGES_REQUESTED is not complete -- the request supersedes the approval', () => {
      const reviews = inOrder(['APPROVED'], ['CHANGES_REQUESTED']);
      const result = evaluate(reviews);
      expect(result.remotePhase).toBe('REMOTE_REVIEW_PENDING');
      expect(result.reasons.length).toBeGreaterThan(0);
      // Even with other evidence on the head, the effective request alone keeps the phase pending.
      expect(evaluate(reviews, FALLBACK_EVIDENCE).remotePhase).toBe('REMOTE_REVIEW_PENDING');
    });

    test('CHANGES_REQUESTED followed by COMMENTED is still not complete -- a comment does not supersede a request', () => {
      expect(phaseOf(['CHANGES_REQUESTED'], ['COMMENTED'])).toBe('REMOTE_REVIEW_PENDING');
    });

    test('CHANGES_REQUESTED followed by a PENDING draft is still not complete', () => {
      const reviews = inOrder(['CHANGES_REQUESTED'], ['PENDING']);
      expect(evaluate(reviews).remotePhase).toBe('REMOTE_REVIEW_PENDING');
      expect(evaluate(reviews, FALLBACK_EVIDENCE).remotePhase).toBe('REMOTE_REVIEW_PENDING');
    });

    test.each(['COMMENTED', 'PENDING'])('APPROVED followed by %s still counts -- it is not superseded', (later) => {
      expect(phaseOf(['APPROVED'], [later])).toBe('REMOTE_REVIEW_COMPLETE');
    });

    test('only the latest decisive review counts: request, approval, request is not complete; approval, request, approval is', () => {
      expect(phaseOf(['CHANGES_REQUESTED'], ['APPROVED'], ['CHANGES_REQUESTED'])).toBe('REMOTE_REVIEW_PENDING');
      expect(phaseOf(['APPROVED'], ['CHANGES_REQUESTED'], ['APPROVED'])).toBe('REMOTE_REVIEW_COMPLETE');
    });

    test('states are compared in normalised form, so spelling and letter case never hide a supersession', () => {
      expect(phaseOf(['changes requested'], ['approved'])).toBe('REMOTE_REVIEW_COMPLETE');
      expect(phaseOf(['Approved'], ['CHANGES_REQUESTED'])).toBe('REMOTE_REVIEW_PENDING');
    });
  });

  describe('DISMISSED', () => {
    test('CHANGES_REQUESTED followed by DISMISSED is ignored: it neither blocks nor counts, so alone it is not complete', () => {
      expect(phaseOf(['CHANGES_REQUESTED'], ['DISMISSED'])).toBe('REMOTE_REVIEW_PENDING');
    });

    test('CHANGES_REQUESTED followed by DISMISSED falls back to the other evidence on the head', () => {
      const dismissed = inOrder(['CHANGES_REQUESTED'], ['DISMISSED']);
      const botComment = { id: 'c1', author: FIRST_BOT, commitSha: HEAD };
      const botCheck = { id: 'chk1', author: FIRST_BOT, commitSha: HEAD, conclusion: 'success' };
      expect(evaluate(dismissed, { comments: [botComment] }).remotePhase).toBe('REMOTE_REVIEW_COMPLETE');
      expect(evaluate(dismissed, { checkRuns: [botCheck] }).remotePhase).toBe('REMOTE_REVIEW_COMPLETE');
      expect(phaseOf(['CHANGES_REQUESTED'], ['DISMISSED'], ['COMMENTED'])).toBe('REMOTE_REVIEW_COMPLETE');
    });

    test('an approval superseded by a later DISMISSED no longer counts', () => {
      expect(phaseOf(['APPROVED'], ['DISMISSED'])).toBe('REMOTE_REVIEW_PENDING');
    });

    test('DISMISSED followed by APPROVED counts the approval', () => {
      expect(phaseOf(['DISMISSED'], ['APPROVED'])).toBe('REMOTE_REVIEW_COMPLETE');
    });
  });

  describe('with several configured bots, each bot is judged on its own latest decisive review', () => {
    const by = (author) => ({ author });

    test.each([
      ['the request comes first', [['CHANGES_REQUESTED', by(FIRST_BOT)], ['APPROVED', by(SECOND_BOT)]]],
      ['the approval comes first', [['APPROVED', by(SECOND_BOT)], ['CHANGES_REQUESTED', by(FIRST_BOT)]]],
    ])('one bot requesting changes and another approving is not complete (%s)', (_label, specs) => {
      expect(evaluate(inOrder(...specs), BOTH_BOTS).remotePhase).toBe('REMOTE_REVIEW_PENDING');
    });

    test('a bot superseding its own request does not clear the request of another bot', () => {
      const result = evaluate(
        inOrder(
          ['CHANGES_REQUESTED', by(FIRST_BOT)],
          ['APPROVED', by(FIRST_BOT)],
          ['CHANGES_REQUESTED', by(SECOND_BOT)]
        ),
        BOTH_BOTS
      );
      expect(result.remotePhase).toBe('REMOTE_REVIEW_PENDING');
    });

    test('every bot superseding its own request completes', () => {
      const result = evaluate(
        inOrder(
          ['CHANGES_REQUESTED', by(FIRST_BOT)],
          ['CHANGES_REQUESTED', by(SECOND_BOT)],
          ['APPROVED', by(FIRST_BOT)],
          ['APPROVED', by(SECOND_BOT)]
        ),
        BOTH_BOTS
      );
      expect(result.remotePhase).toBe('REMOTE_REVIEW_COMPLETE');
    });

    test('a bot is one reviewer whatever the letter case of its login', () => {
      const result = evaluate(inOrder(['CHANGES_REQUESTED', by('CodeRabbit[bot]')], ['APPROVED', by('coderabbit[BOT]')]));
      expect(result.remotePhase).toBe('REMOTE_REVIEW_COMPLETE');
    });

    test('a human approval never supersedes a bot request', () => {
      const reviews = inOrder(['CHANGES_REQUESTED'], ['APPROVED', by('human1')]);
      expect(evaluate(reviews).remotePhase).toBe('REMOTE_REVIEW_PENDING');
      expect(evaluate(reviews, FALLBACK_EVIDENCE).remotePhase).toBe('REMOTE_REVIEW_PENDING');
    });
  });

  describe('"latest" is decided by submittedAt; ties and missing timestamps keep input order', () => {
    test('a newer approval listed before an older request still wins: timestamps beat input order', () => {
      expect(phaseOf(['APPROVED', { submittedAt: T2 }], ['CHANGES_REQUESTED', { submittedAt: T1 }])).toBe(
        'REMOTE_REVIEW_COMPLETE'
      );
    });

    test('a newer request listed before an older approval still blocks: timestamps beat input order', () => {
      expect(phaseOf(['CHANGES_REQUESTED', { submittedAt: T2 }], ['APPROVED', { submittedAt: T1 }])).toBe(
        'REMOTE_REVIEW_PENDING'
      );
    });

    test('timestamps are compared as instants, not as text or in input order', () => {
      // 12:30+02:00 is 10:30Z, earlier than 10:45Z although it sorts after it as a string.
      const earlierApproval = { submittedAt: '2026-10-14T12:30:00+02:00' };
      const laterRequest = { submittedAt: '2026-10-14T10:45:00Z' };
      expect(phaseOf(['CHANGES_REQUESTED', laterRequest], ['APPROVED', earlierApproval])).toBe('REMOTE_REVIEW_PENDING');
    });

    test('equal timestamps keep input order', () => {
      expect(phaseOf(['CHANGES_REQUESTED', { submittedAt: T1 }], ['APPROVED', { submittedAt: T1 }])).toBe(
        'REMOTE_REVIEW_COMPLETE'
      );
      expect(phaseOf(['APPROVED', { submittedAt: T1 }], ['CHANGES_REQUESTED', { submittedAt: T1 }])).toBe(
        'REMOTE_REVIEW_PENDING'
      );
    });

    test('a missing timestamp never makes an older request look newer than a later review that has one', () => {
      expect(phaseOf(['CHANGES_REQUESTED'], ['APPROVED', { submittedAt: T1 }])).toBe('REMOTE_REVIEW_COMPLETE');
      expect(
        phaseOf(['CHANGES_REQUESTED'], ['DISMISSED', { submittedAt: T1 }], ['COMMENTED', { submittedAt: T2 }])
      ).toBe('REMOTE_REVIEW_COMPLETE');
    });

    test('missing timestamps keep input order', () => {
      expect(phaseOf(['CHANGES_REQUESTED'], ['APPROVED'])).toBe('REMOTE_REVIEW_COMPLETE');
      expect(phaseOf(['APPROVED'], ['CHANGES_REQUESTED'])).toBe('REMOTE_REVIEW_PENDING');
      expect(phaseOf(['APPROVED', { submittedAt: T1 }], ['CHANGES_REQUESTED'])).toBe('REMOTE_REVIEW_PENDING');
      expect(phaseOf(['CHANGES_REQUESTED', { submittedAt: T1 }], ['APPROVED'])).toBe('REMOTE_REVIEW_COMPLETE');
    });

    test.each(['', '   ', 'not a date', null])('an unusable timestamp (%p) counts as missing', (submittedAt) => {
      expect(phaseOf(['CHANGES_REQUESTED', { submittedAt }], ['APPROVED', { submittedAt: T1 }])).toBe(
        'REMOTE_REVIEW_COMPLETE'
      );
      expect(phaseOf(['APPROVED', { submittedAt: T1 }], ['CHANGES_REQUESTED', { submittedAt }])).toBe(
        'REMOTE_REVIEW_PENDING'
      );
    });
  });

  describe('the earlier rules still hold', () => {
    test('head binding: an approval on an older head never supersedes a request on the current head', () => {
      // The stateless bot comment is fallback evidence: were the request wrongly superseded, it would complete.
      const botComment = { id: 'c1', author: FIRST_BOT, commitSha: HEAD };
      const reviews = inOrder(['CHANGES_REQUESTED'], ['APPROVED', { commitSha: 'head-sha-older' }]);
      expect(evaluate(reviews, { comments: [botComment] }).remotePhase).toBe('REMOTE_REVIEW_PENDING');
    });

    test('every thread must still be resolved after a request is superseded', () => {
      const result = evaluate(inOrder(['CHANGES_REQUESTED'], ['APPROVED']), {
        threads: [{ id: 't1', resolved: false }],
      });
      expect(result.remotePhase).toBe('REMOTE_REVIEW_PENDING');
    });

    test('supersession changes what counts, not what is collected for the head', () => {
      const result = evaluate(inOrder(['CHANGES_REQUESTED'], ['APPROVED']));
      expect(result.collected.map((item) => item.id)).toEqual(['r0', 'r1']);
    });
  });
});

// ---------------------------------------------------------------------------
// Round 2. Every kind of item (review, check run, comment, thread) and every
// state it can be in has a defined verdict, and only a recognised good value
// completes: missing, null, malformed, wrong-typed or unrecognised input keeps
// the phase pending with a reason.
// ---------------------------------------------------------------------------

const COMPLETE = 'REMOTE_REVIEW_COMPLETE';
const PENDING = 'REMOTE_REVIEW_PENDING';
const BOT = 'coderabbit[bot]';
const OLDER = 'head-sha-older';

const botComment = (overrides = {}) => ({ id: 'c1', author: BOT, commitSha: HEAD, ...overrides });
const botCheck = (conclusion, overrides = {}) => ({ id: 'chk1', author: BOT, commitSha: HEAD, conclusion, ...overrides });

/** A fact set the evaluator completes: one bound bot approval, every collection supplied, every thread resolved. */
const completeFacts = (overrides = {}) => ({
  headSha: HEAD,
  reviews: [botReview('APPROVED')],
  comments: [],
  threads: [{ id: 't1', resolved: true }],
  checkRuns: [],
  botLogins: BOT_LOGINS,
  ...overrides,
});

/** What a payload can carry where something else was expected: absent, null, blanks, numbers, booleans, text, containers. */
const WRONG_VALUES = [undefined, null, '', '   ', 0, 1, -1, 0.5, NaN, Infinity, true, false, 'x', {}, [], [[]], ['x'], [null]];

describe('pr-review-remote: a bot check run counts only when it concluded success or neutral', () => {
  test.each(['success', 'neutral', 'SUCCESS', 'Neutral'])('a bound bot check run that concluded %s is evidence', (conclusion) => {
    expect(evaluate([], { checkRuns: [botCheck(conclusion)] }).remotePhase).toBe(COMPLETE);
  });

  const NEVER_EVIDENCE = [
    'failure', 'cancelled', 'timed_out', 'action_required', 'skipped', 'stale', 'startup_failure', 'bogus', 'successful',
    ' success', 'success ', '', '   ', null, undefined, 0, 1, true, {}, [], ['success'],
  ];

  test.each(NEVER_EVIDENCE)('a bound bot check run with conclusion %p is never evidence on its own', (conclusion) => {
    const result = evaluate([], { checkRuns: [botCheck(conclusion)] });
    expect(result.remotePhase).toBe(PENDING);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  test.each(['failure', 'cancelled', 'timed_out', 'action_required'])(
    'a bound bot check run that concluded %s blocks completion even beside an approval, and the reason names it',
    (conclusion) => {
      const result = evaluate([botReview('APPROVED')], { checkRuns: [botCheck(conclusion)] });
      expect(result.remotePhase).toBe(PENDING);
      expect(result.reasons.join(' ')).toContain(conclusion);
    }
  );

  test.each([null, undefined, '', '   ', 'in_progress', 'queued', 'startup_failure', 'bogus', 5, true, {}])(
    'a bound bot check run that has not concluded or has an unknown conclusion (%p) blocks even beside an approval',
    (conclusion) => {
      const result = evaluate([botReview('APPROVED')], { checkRuns: [botCheck(conclusion)] });
      expect(result.remotePhase).toBe(PENDING);
      expect(result.reasons.length).toBeGreaterThan(0);
    }
  );

  test('a check run on another commit, or by someone who is not a configured bot, says nothing about this head', () => {
    const unrelated = [botCheck('failure', { id: 'chk2', commitSha: OLDER }), botCheck('failure', { id: 'chk3', author: 'ci-bot' })];
    expect(evaluate([botReview('APPROVED')], { checkRuns: unrelated }).remotePhase).toBe(COMPLETE);
  });

  test('a failing bot check run with no commit identity cannot be shown to concern another commit, so it blocks', () => {
    const unidentified = botCheck('failure', { commitSha: undefined });
    expect(evaluate([botReview('APPROVED')], { checkRuns: [unidentified] }).remotePhase).toBe(PENDING);
  });

  test('a succeeding bot check run with no commit identity is reported unverifiable and is not evidence', () => {
    const result = evaluate([], { checkRuns: [botCheck('success', { commitSha: undefined })] });
    expect(result.remotePhase).toBe(PENDING);
    expect(result.unverifiable.map((item) => item.id)).toEqual(['chk1']);
  });

  test('a bot check run whose commit identity is not text is unverifiable and never bound to the head', () => {
    const result = evaluate([botReview('APPROVED')], { checkRuns: [botCheck('success', { commitSha: 5 })] });
    expect(result.unverifiable.map((item) => item.id)).toEqual(['chk1']);
    expect(result.collected.map((item) => item.id)).toEqual(['r1']);
  });

  test.each(['skipped', 'stale'])('a %s bot check run neither counts nor blocks: beside an approval it changes nothing', (conclusion) => {
    expect(evaluate([botReview('APPROVED')], { checkRuns: [botCheck(conclusion)] }).remotePhase).toBe(COMPLETE);
  });

  test('a bot comment on the head can never override a failed check run', () => {
    const result = evaluate([], { comments: [botComment()], checkRuns: [botCheck('failure')] });
    expect(result.remotePhase).toBe(PENDING);
  });
});

describe('pr-review-remote: every review state has a defined verdict', () => {
  const UNRECOGNISED = [
    'REQUEST_CHANGES', 'REQUESTED_CHANGES', 'APPROVE', 'COMMENT', 'SUBMITTED', 'STALE', 'APPROVED_', 'A_P_P_R_O_V_E_D',
    'COMMENTED!', ' APPROVED', 'APPROVED ', 'APPROVED\n', '', '   ', undefined, null, 0, 1, true, {}, [], ['APPROVED'],
  ];

  // [state, phase when it is the only bound bot item, phase when a bound bot comment is also present]
  test.each([
    ['APPROVED', COMPLETE, COMPLETE],
    ['COMMENTED', COMPLETE, COMPLETE],
    ['approved', COMPLETE, COMPLETE],
    ['commented', COMPLETE, COMPLETE],
    ['DISMISSED', PENDING, COMPLETE],
    ['PENDING', PENDING, COMPLETE],
    ['CHANGES_REQUESTED', PENDING, PENDING],
    ['changes_requested', PENDING, PENDING],
    ['Changes Requested', PENDING, PENDING],
    ['ChangesRequested', PENDING, PENDING],
    ...UNRECOGNISED.map((state) => [state, PENDING, PENDING]),
  ])('review state %p -> %s alone, %s beside a bound bot comment', (state, alone, beside) => {
    expect(evaluate([botReview(state)]).remotePhase).toBe(alone);
    expect(evaluate([botReview(state)], { comments: [botComment()] }).remotePhase).toBe(beside);
  });

  test('an unrecognised state carries a reason that names it', () => {
    const result = evaluate([botReview('REQUEST_CHANGES')], { comments: [botComment()] });
    expect(result.remotePhase).toBe(PENDING);
    expect(result.reasons.join(' ')).toContain('REQUEST_CHANGES');
  });

  test('an unrecognised state blocks whatever head it is bound to, and no later review clears it', () => {
    const approval = botReview('APPROVED', { id: 'r1' });
    const onOlderHead = botReview('REQUEST_CHANGES', { id: 'r0', commitSha: OLDER });
    const noIdentity = botReview('REQUEST_CHANGES', { id: 'r0', commitSha: undefined });
    expect(evaluate([onOlderHead, approval], { comments: [botComment()] }).remotePhase).toBe(PENDING);
    expect(evaluate([noIdentity, approval], { comments: [botComment()] }).remotePhase).toBe(PENDING);
    expect(evaluate([approval, onOlderHead]).remotePhase).toBe(PENDING);
  });

  test('an unrecognised state on a review by someone who is not a configured bot is ignored', () => {
    const human = botReview('REQUEST_CHANGES', { id: 'r9', author: 'human1' });
    expect(evaluate([botReview('APPROVED'), human]).remotePhase).toBe(COMPLETE);
  });

  test('a bot comment on the head can never override a blocking review', () => {
    for (const state of ['CHANGES_REQUESTED', 'REQUEST_CHANGES']) {
      expect(evaluate([botReview(state)], { comments: [botComment()] }).remotePhase).toBe(PENDING);
    }
  });
});

describe("pr-review-remote: a bot's standing is judged over all of its reviews, whatever head they are bound to", () => {
  const reviewsOf = (...specs) => specs.map(([state, overrides], index) => botReview(state, { id: `r${index}`, ...overrides }));
  const phaseWith = (specs, extra) => evaluate(reviewsOf(...specs), extra).remotePhase;
  const EVIDENCE = { comments: [botComment()], checkRuns: [botCheck('success')] };

  test('an unsuperseded request from an older head blocks, however much other evidence the current head has', () => {
    expect(phaseWith([['CHANGES_REQUESTED', { commitSha: OLDER }], ['COMMENTED']], EVIDENCE)).toBe(PENDING);
    expect(phaseWith([['CHANGES_REQUESTED', { commitSha: OLDER }]], EVIDENCE)).toBe(PENDING);
  });

  test('a request that carries no commit identity blocks too: it cannot be shown to concern another head', () => {
    expect(phaseWith([['CHANGES_REQUESTED', { commitSha: undefined }], ['COMMENTED']], EVIDENCE)).toBe(PENDING);
  });

  test('a later approval on the current head supersedes the older request and is itself evidence', () => {
    expect(phaseWith([['CHANGES_REQUESTED', { commitSha: OLDER }], ['APPROVED']])).toBe(COMPLETE);
  });

  test('a later dismissal supersedes the older request but is no evidence: other evidence is still needed', () => {
    expect(phaseWith([['CHANGES_REQUESTED', { commitSha: OLDER }], ['DISMISSED']])).toBe(PENDING);
    expect(phaseWith([['CHANGES_REQUESTED', { commitSha: OLDER }], ['DISMISSED']], EVIDENCE)).toBe(COMPLETE);
  });

  test.each(['COMMENTED', 'PENDING'])('a later %s review never clears an older request', (later) => {
    expect(phaseWith([['CHANGES_REQUESTED', { commitSha: OLDER }], [later]], EVIDENCE)).toBe(PENDING);
  });

  test('an approval of an even older head supersedes the request but is no evidence for the current head', () => {
    const specs = [['CHANGES_REQUESTED', { commitSha: OLDER }], ['APPROVED', { commitSha: 'head-sha-oldest' }]];
    expect(phaseWith(specs)).toBe(PENDING);
    expect(phaseWith(specs, EVIDENCE)).toBe(COMPLETE);
  });

  test('the reviewer\'s latest decisive review decides even when it is bound to an older head', () => {
    expect(phaseWith([['APPROVED'], ['CHANGES_REQUESTED', { commitSha: OLDER }]], EVIDENCE)).toBe(PENDING);
  });

  test('timestamps decide which review is later across heads too', () => {
    const T1 = '2026-10-14T10:00:00Z';
    const T2 = '2026-10-14T10:05:00Z';
    expect(phaseWith([['APPROVED', { submittedAt: T2 }], ['CHANGES_REQUESTED', { commitSha: OLDER, submittedAt: T1 }]])).toBe(COMPLETE);
    expect(phaseWith([['CHANGES_REQUESTED', { commitSha: OLDER, submittedAt: T2 }], ['APPROVED', { submittedAt: T1 }]])).toBe(PENDING);
  });

  test('with several bots, one bot\'s older request blocks although another bot approves the current head', () => {
    const second = 'second-reviewer[bot]';
    const reviews = [
      botReview('CHANGES_REQUESTED', { id: 'r0', commitSha: OLDER }),
      botReview('APPROVED', { id: 'r1', author: second }),
    ];
    expect(evaluate(reviews, { botLogins: [BOT, second] }).remotePhase).toBe(PENDING);
  });
});

describe('pr-review-remote: access, when supplied, must be exactly { ok: boolean }', () => {
  const MALFORMED = [
    { ok: 'no' }, { ok: 'true' }, { ok: 1 }, { ok: 0 }, { ok: null }, { ok: undefined }, {}, { reason: 'x' },
    null, 'ok', 5, true, false, [], [{ ok: true }],
  ];

  test.each(MALFORMED)('access %p is malformed: pending with a reason, never complete', (access) => {
    const result = evaluate([botReview('APPROVED')], { access });
    expect(result.remotePhase).toBe(PENDING);
    expect(result.reasons.join(' ')).toContain('access');
  });

  test('absent access, or { ok: true }, does not block', () => {
    expect(evaluate([botReview('APPROVED')], { access: undefined }).remotePhase).toBe(COMPLETE);
    expect(evaluate([botReview('APPROVED')], { access: { ok: true } }).remotePhase).toBe(COMPLETE);
  });

  test('{ ok: false } is pending and carries its reason, or a default one when it has none', () => {
    expect(evaluate([botReview('APPROVED')], { access: { ok: false, reason: '403 Forbidden' } }).reasons).toContain('403 Forbidden');
    for (const access of [{ ok: false }, { ok: false, reason: '' }, { ok: false, reason: 5 }]) {
      const result = evaluate([botReview('APPROVED')], { access });
      expect(result.remotePhase).toBe(PENDING);
      expect(result.reasons.length).toBeGreaterThan(0);
      expect(result.reasons.every((reason) => typeof reason === 'string' && reason.trim() !== '')).toBe(true);
    }
  });
});

describe('pr-review-remote: a thread is resolved only when its resolved flag is exactly true', () => {
  const OPEN = [
    null, undefined, 0, 1, '', 'x', true, false, [], {}, { id: 't' }, { resolved: false }, { resolved: 'true' },
    { resolved: 1 }, { resolved: null }, { resolved: [] }, { resolved: undefined },
  ];

  test.each(OPEN)('thread entry %p counts as unresolved: pending, and listed in unresolvedThreads', (thread) => {
    const result = evaluate([botReview('APPROVED')], { threads: [thread] });
    expect(result.remotePhase).toBe(PENDING);
    expect(result.unresolvedThreads).toHaveLength(1);
  });

  test('resolved threads beside an open one leave exactly the open one', () => {
    const open = { id: 't2', resolved: false };
    const result = evaluate([botReview('APPROVED')], { threads: [{ id: 't1', resolved: true }, null, open, { id: 't3', resolved: true }] });
    expect(result.remotePhase).toBe(PENDING);
    expect(result.unresolvedThreads).toEqual([null, open]);
  });
});

describe('pr-review-remote: the facts themselves must be well-formed', () => {
  test.each([null, [], 'x', 5, true])('facts that are not an object (%p) are pending with a reason', (facts) => {
    const result = evaluateRemoteReview(facts);
    expect(result.remotePhase).toBe(PENDING);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  test('no argument at all is pending with a reason', () => {
    const result = evaluateRemoteReview();
    expect(result.remotePhase).toBe(PENDING);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  test.each(WRONG_VALUES)('headSha %p never completes: items are bound only to a real head', (headSha) => {
    expect(evaluateRemoteReview(completeFacts({ headSha })).remotePhase).toBe(PENDING);
  });

  test.each(WRONG_VALUES.filter((value) => typeof value !== 'string' || value.trim() === ''))(
    'a headSha that is not text (%p) is named in the reasons',
    (headSha) => {
      expect(evaluateRemoteReview(completeFacts({ headSha })).reasons.join(' ')).toContain('headSha');
    }
  );

  test('a numeric head never binds an item to a numeric commit', () => {
    const facts = completeFacts({ headSha: 5, reviews: [botReview('APPROVED', { commitSha: 5 })] });
    expect(evaluateRemoteReview(facts).remotePhase).toBe(PENDING);
  });

  test.each([...WRONG_VALUES.filter((value) => !Array.isArray(value) || value.length === 0 || !value.every((login) => typeof login === 'string')), [''], ['   '], [5], [null], [undefined], [BOT, ''], [BOT, 5], [[BOT]]])(
    'botLogins %p is malformed: pending, and named in the reasons',
    (botLogins) => {
      const result = evaluateRemoteReview(completeFacts({ botLogins }));
      expect(result.remotePhase).toBe(PENDING);
      expect(result.reasons.join(' ')).toContain('botLogins');
    }
  );

  test('a well-formed botLogins naming nobody who reviewed never completes', () => {
    expect(evaluateRemoteReview(completeFacts({ botLogins: ['x'] })).remotePhase).toBe(PENDING);
  });

  test('an empty bot login never matches an item whose author is blank or missing', () => {
    for (const author of [undefined, '', '   ']) {
      const blankAuthored = { id: 'r1', author, commitSha: HEAD, state: 'APPROVED' };
      expect(evaluateRemoteReview(completeFacts({ botLogins: [''], reviews: [blankAuthored] })).remotePhase).toBe(PENDING);
      expect(evaluateRemoteReview(completeFacts({ botLogins: [BOT, ''], reviews: [blankAuthored] })).remotePhase).toBe(PENDING);
    }
  });

  test('a hole in botLogins is a malformed login, not a skipped one', () => {
    const logins = [BOT];
    logins[2] = BOT;
    expect(evaluateRemoteReview(completeFacts({ botLogins: logins })).remotePhase).toBe(PENDING);
  });

  const NOT_ARRAYS = WRONG_VALUES.filter((value) => !Array.isArray(value));
  describe.each(['reviews', 'comments', 'threads', 'checkRuns'])('the %s collection', (key) => {
    test.each(NOT_ARRAYS)('%p instead of an array never completes, even with other evidence on the head', (value) => {
      const facts = completeFacts({ comments: [botComment()], checkRuns: [botCheck('success')], [key]: value });
      const result = evaluateRemoteReview(facts);
      expect(result.remotePhase).toBe(PENDING);
      expect(result.reasons.join(' ')).toContain(key);
    });

    test('a key that is absent altogether never completes', () => {
      const facts = completeFacts({ comments: [botComment()], checkRuns: [botCheck('success')] });
      delete facts[key];
      const result = evaluateRemoteReview(facts);
      expect(result.remotePhase).toBe(PENDING);
      expect(result.reasons.join(' ')).toContain(key);
    });

    test.each(['x', 5, true, [], [[]], [null]])('an entry %p that is not an object never completes', (entry) => {
      const facts = completeFacts({ comments: [botComment()], checkRuns: [botCheck('success')] });
      facts[key] = [...facts[key], entry];
      const result = evaluateRemoteReview(facts);
      // threads: a malformed entry is an open thread; the others: a malformed item hides what it might be.
      expect(result.remotePhase).toBe(PENDING);
      expect(result.reasons.join(' ')).toContain(key);
    });
  });

  test('a sparse array cannot hide an entry: a hole is a malformed entry', () => {
    const sparseReviews = [botReview('APPROVED')];
    sparseReviews[2] = botReview('APPROVED', { id: 'r2' });
    expect(evaluateRemoteReview(completeFacts({ reviews: sparseReviews })).remotePhase).toBe(PENDING);
    const sparseThreads = [{ id: 't1', resolved: true }];
    sparseThreads[2] = { id: 't3', resolved: true };
    expect(evaluateRemoteReview(completeFacts({ threads: sparseThreads })).remotePhase).toBe(PENDING);
  });
});

describe('pr-review-remote: adversarial sweep -- nothing completes unless every required fact is valid', () => {
  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const isText = (value) => typeof value === 'string' && value.trim() !== '';

  /** What a completing fact set must at least look like, stated independently of the evaluator. */
  const preconditions = (facts) =>
    isText(facts.headSha) &&
    Array.isArray(facts.botLogins) &&
    facts.botLogins.length > 0 &&
    facts.botLogins.every(isText) &&
    ['reviews', 'comments', 'threads', 'checkRuns'].every((key) => Array.isArray(facts[key])) &&
    ['reviews', 'comments', 'checkRuns'].every((key) => facts[key].every(isObject)) &&
    facts.threads.every((thread) => isObject(thread) && thread.resolved === true) &&
    (facts.access === undefined || (isObject(facts.access) && typeof facts.access.ok === 'boolean' && facts.access.ok));

  test('control: the base fact set completes and meets the preconditions, so the sweep below can fail', () => {
    expect(evaluateRemoteReview(completeFacts()).remotePhase).toBe(COMPLETE);
    expect(preconditions(completeFacts())).toBe(true);
    // The oracle itself rejects a broken set.
    expect(preconditions(completeFacts({ threads: [null] }))).toBe(false);
  });

  test.each(['headSha', 'reviews', 'comments', 'threads', 'checkRuns', 'botLogins', 'access'])(
    'wrong %s values, or the key deleted, complete only while the preconditions still hold',
    (key) => {
      const variants = WRONG_VALUES.map((value) => completeFacts({ [key]: value }));
      const deleted = completeFacts();
      delete deleted[key];
      for (const facts of [...variants, deleted]) {
        if (evaluateRemoteReview(facts).remotePhase === COMPLETE) {
          expect([key, facts[key], preconditions(facts)]).toEqual([key, facts[key], true]);
        }
      }
    }
  );

  test.each(['author', 'commitSha', 'state'])('the only evidence is a bot approval: a wrong %s never completes', (field) => {
    for (const value of WRONG_VALUES) {
      const facts = completeFacts({ reviews: [botReview('APPROVED', { [field]: value })] });
      expect([field, value, evaluateRemoteReview(facts).remotePhase]).toEqual([field, value, PENDING]);
    }
  });

  // A bound bot review that is not evidence (a draft). With it present, "no bot item is bound to the head" can never be
  // the reason the phase stays pending, so the evidence item under test is the only thing that could complete it.
  const DRAFT = botReview('PENDING', { id: 'draft' });

  test.each(['author', 'commitSha', 'conclusion'])('the only evidence is a bot check run: a wrong %s never completes', (field) => {
    expect(evaluate([DRAFT], { checkRuns: [botCheck('success')] }).remotePhase).toBe(COMPLETE);
    for (const value of WRONG_VALUES) {
      const facts = completeFacts({ reviews: [DRAFT], checkRuns: [botCheck('success', { [field]: value })] });
      expect([field, value, evaluateRemoteReview(facts).remotePhase]).toEqual([field, value, PENDING]);
    }
  });

  test.each(['author', 'commitSha'])('the only evidence is a bot comment: a wrong %s never completes', (field) => {
    expect(evaluate([DRAFT], { comments: [botComment()] }).remotePhase).toBe(COMPLETE);
    for (const value of WRONG_VALUES) {
      const facts = completeFacts({ reviews: [DRAFT], comments: [botComment({ [field]: value })] });
      expect([field, value, evaluateRemoteReview(facts).remotePhase]).toEqual([field, value, PENDING]);
    }
  });

  // Each kind of evidence, and each way it can fail to be about this head from a configured bot.
  const EVIDENCE_KINDS = {
    'an approved review': (overrides) => ({ reviews: [DRAFT, botReview('APPROVED', { id: 'r2', ...overrides })] }),
    'a commented review': (overrides) => ({ reviews: [DRAFT, botReview('COMMENTED', { id: 'r2', ...overrides })] }),
    'a comment': (overrides) => ({ reviews: [DRAFT], comments: [botComment(overrides)] }),
    'a successful check run': (overrides) => ({ reviews: [DRAFT], checkRuns: [botCheck('success', overrides)] }),
  };
  const NOT_ABOUT_THIS_HEAD = {
    'bound to another head': { commitSha: OLDER },
    'carrying no commit identity': { commitSha: undefined },
    'carrying a commit identity that is not text': { commitSha: 5 },
    'written by a human': { author: 'human1' },
    'written by nobody': { author: undefined },
  };

  test.each(Object.keys(EVIDENCE_KINDS))('%s bound to the head by the bot completes (control)', (kind) => {
    expect(evaluateRemoteReview(completeFacts({ ...EVIDENCE_KINDS[kind]({}) })).remotePhase).toBe(COMPLETE);
  });

  test.each(
    Object.keys(EVIDENCE_KINDS).flatMap((kind) => Object.keys(NOT_ABOUT_THIS_HEAD).map((flaw) => [kind, flaw]))
  )('%s %s is never evidence beside a bound bot draft', (kind, flaw) => {
    const facts = completeFacts({ ...EVIDENCE_KINDS[kind](NOT_ABOUT_THIS_HEAD[flaw]) });
    expect(evaluateRemoteReview(facts).remotePhase).toBe(PENDING);
  });

  test('a thread whose resolved flag is anything but true never completes', () => {
    for (const value of WRONG_VALUES.filter((candidate) => candidate !== true)) {
      const facts = completeFacts({ threads: [{ id: 't1', resolved: value }] });
      expect([value, evaluateRemoteReview(facts).remotePhase]).toEqual([value, PENDING]);
    }
  });

  test('one bad item beside an otherwise complete set blocks it, whatever shape the bad item has', () => {
    // An empty object is a bad review and a bad check run -- an objection nobody can read -- but an empty comment is
    // inert, since comments carry no verdict; so only a comment that is not an object is bad.
    const notObjects = WRONG_VALUES.filter((value) => value === null || typeof value !== 'object' || Array.isArray(value));
    const blocking = [
      ...WRONG_VALUES.map((value) => ({ reviews: [botReview('APPROVED'), value] })),
      ...WRONG_VALUES.map((state) => ({ reviews: [botReview('APPROVED'), botReview(state, { id: 'r2' })] })),
      ...WRONG_VALUES.map((value) => ({ checkRuns: [value] })),
      ...WRONG_VALUES.map((conclusion) => ({ checkRuns: [botCheck(conclusion)] })),
      ...notObjects.map((value) => ({ comments: [value] })),
      ...WRONG_VALUES.map((value) => ({ threads: [{ id: 't1', resolved: true }, value] })),
    ];
    expect(blocking.length).toBeGreaterThan(WRONG_VALUES.length * 3);
    for (const overrides of blocking) {
      const label = JSON.stringify(overrides, (_key, value) => (value === undefined ? '<undefined>' : Number.isNaN(value) ? '<NaN>' : value));
      expect([label, evaluateRemoteReview(completeFacts(overrides)).remotePhase]).toEqual([label, PENDING]);
    }
  });

  test('a JSON payload that smuggles __proto__ or constructor keys never completes', () => {
    const smuggled = JSON.parse(
      `{"headSha":"${HEAD}","botLogins":["${BOT}"],"comments":[],"threads":[],"checkRuns":[],` +
        `"reviews":[{"__proto__":{"author":"${BOT}","commitSha":"${HEAD}","state":"APPROVED"}},` +
        `{"constructor":{"prototype":{"author":"${BOT}","commitSha":"${HEAD}","state":"APPROVED"}}}]}`
    );
    expect(evaluateRemoteReview(smuggled).remotePhase).toBe(PENDING);
    expect(evaluateRemoteReview(JSON.parse(`{"__proto__":{"headSha":"${HEAD}"},"constructor":"x"}`)).remotePhase).toBe(PENDING);
  });

  test('whatever the facts, the result keeps its shape and a pending result always says why', () => {
    const inputs = [
      undefined, null, [], 'x', 5, {}, completeFacts(),
      ...WRONG_VALUES.map((value) =>
        completeFacts({ threads: [value], checkRuns: [botCheck(value)], reviews: [botReview(value)], access: value, comments: [value] })
      ),
    ];
    for (const input of inputs) {
      const result = evaluateRemoteReview(input);
      expect([COMPLETE, PENDING]).toContain(result.remotePhase);
      for (const key of ['collected', 'unresolvedThreads', 'unverifiable', 'reasons']) {
        expect([key, Array.isArray(result[key])]).toEqual([key, true]);
      }
      expect(result.reasons.every(isText)).toBe(true);
      expect(result.remotePhase === COMPLETE).toBe(result.reasons.length === 0);
    }
  });
});

// An item whose author cannot be read could be the bot's own, so it can object -- but with whose item it is unknown it
// can never count as evidence. Without this a review or check run that lost its author would silently fall out of the
// comparison and an objection would complete the phase.
describe("pr-review-remote: an item whose author cannot be read might be the bot's -- it can object, never count", () => {
  const readable = (value) => typeof value === 'string' && value.trim() !== '';
  const NO_AUTHOR = WRONG_VALUES.filter((value) => !readable(value));
  const SPELLINGS_OF_CHANGES_REQUESTED = ['CHANGES_REQUESTED', 'changes_requested', 'changes requested', 'ChangesRequested'];
  const UNREADABLE_STATES = ['REQUEST_CHANGES', 'APPROVE', 'SOMETHING_ELSE', '', '   ', undefined, null, 5, {}];
  const BINDINGS = { 'bound to the head': HEAD, 'bound to an older head': OLDER, 'carrying no commit identity': undefined };

  const withReview = (overrides, state) => completeFacts({ reviews: [botReview('APPROVED'), botReview(state, { id: 'r2', ...overrides })] });
  const withCheck = (overrides, conclusion) => completeFacts({ checkRuns: [botCheck(conclusion, overrides)] });

  test('control: the facts the cases below add to complete, and a readable human author is simply ignored', () => {
    expect(evaluateRemoteReview(completeFacts()).remotePhase).toBe(COMPLETE);
    for (const state of [...SPELLINGS_OF_CHANGES_REQUESTED, ...UNREADABLE_STATES]) {
      expect([state, evaluateRemoteReview(withReview({ author: 'human1' }, state)).remotePhase]).toEqual([state, COMPLETE]);
    }
    for (const conclusion of ['failure', 'cancelled', 'timed_out', 'action_required', undefined, 'bogus']) {
      expect([conclusion, evaluateRemoteReview(withCheck({ author: 'github-actions' }, conclusion)).remotePhase]).toEqual([conclusion, COMPLETE]);
    }
  });

  test('a review requesting changes blocks when its author cannot be read, whatever head it is bound to', () => {
    for (const author of NO_AUTHOR) {
      for (const [binding, commitSha] of Object.entries(BINDINGS)) {
        for (const state of SPELLINGS_OF_CHANGES_REQUESTED) {
          const result = evaluateRemoteReview(withReview({ author, commitSha }, state));
          expect([String(author), binding, state, result.remotePhase]).toEqual([String(author), binding, state, PENDING]);
          expect(result.reasons.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test('a review whose state cannot be read blocks when its author cannot be read, whatever head it is bound to', () => {
    for (const author of NO_AUTHOR) {
      for (const [binding, commitSha] of Object.entries(BINDINGS)) {
        for (const state of UNREADABLE_STATES) {
          const phase = evaluateRemoteReview(withReview({ author, commitSha }, state)).remotePhase;
          expect([String(author), binding, String(state), phase]).toEqual([String(author), binding, String(state), PENDING]);
        }
      }
    }
  });

  test.each(['APPROVED', 'COMMENTED', 'DISMISSED', 'PENDING'])(
    'a %s review with no readable author neither blocks nor counts: beside real evidence it changes nothing, alone it is no evidence',
    (state) => {
      const draft = botReview('PENDING', { id: 'draft' });
      for (const author of NO_AUTHOR) {
        expect([state, String(author), evaluateRemoteReview(withReview({ author }, state)).remotePhase]).toEqual([state, String(author), COMPLETE]);
        const alone = completeFacts({ reviews: [draft, botReview(state, { id: 'r2', author })] });
        expect([state, String(author), evaluateRemoteReview(alone).remotePhase]).toEqual([state, String(author), PENDING]);
      }
    }
  );

  test('a check run that objects blocks when its author cannot be read -- bound to the head or carrying no commit identity', () => {
    const objections = ['failure', 'cancelled', 'timed_out', 'action_required', 'FAILURE', undefined, null, '', '   ', 'bogus', 5, {}];
    for (const author of NO_AUTHOR) {
      for (const commitSha of [HEAD, undefined]) {
        for (const conclusion of objections) {
          const phase = evaluateRemoteReview(withCheck({ author, commitSha }, conclusion)).remotePhase;
          expect([String(author), String(commitSha), String(conclusion), phase]).toEqual([String(author), String(commitSha), String(conclusion), PENDING]);
        }
      }
    }
  });

  test('a check run bound to another commit says nothing about this head, whoever wrote it', () => {
    for (const author of NO_AUTHOR) {
      expect([String(author), evaluateRemoteReview(withCheck({ author, commitSha: OLDER }, 'failure')).remotePhase]).toEqual([String(author), COMPLETE]);
    }
  });

  test.each(['success', 'neutral', 'skipped', 'stale'])('a %s check run with no readable author neither blocks nor counts', (conclusion) => {
    const draft = botReview('PENDING', { id: 'draft' });
    for (const author of NO_AUTHOR) {
      expect([conclusion, String(author), evaluateRemoteReview(withCheck({ author }, conclusion)).remotePhase]).toEqual([conclusion, String(author), COMPLETE]);
      const alone = completeFacts({ reviews: [draft], checkRuns: [botCheck(conclusion, { author })] });
      expect([conclusion, String(author), evaluateRemoteReview(alone).remotePhase]).toEqual([conclusion, String(author), PENDING]);
    }
  });

  test('a comment with no readable author is inert: it never blocks and is never evidence', () => {
    const draft = botReview('PENDING', { id: 'draft' });
    for (const author of NO_AUTHOR) {
      expect([String(author), evaluateRemoteReview(completeFacts({ comments: [botComment({ author })] })).remotePhase]).toEqual([String(author), COMPLETE]);
      const alone = completeFacts({ reviews: [draft], comments: [botComment({ author })] });
      expect([String(author), evaluateRemoteReview(alone).remotePhase]).toEqual([String(author), PENDING]);
    }
  });

  test('an empty review or check run is an objection, an empty comment is not: nothing is read into what is not there', () => {
    expect(evaluateRemoteReview(completeFacts({ reviews: [botReview('APPROVED'), {}] })).remotePhase).toBe(PENDING);
    expect(evaluateRemoteReview(completeFacts({ checkRuns: [{}] })).remotePhase).toBe(PENDING);
    expect(evaluateRemoteReview(completeFacts({ comments: [{}] })).remotePhase).toBe(COMPLETE);
  });
});
