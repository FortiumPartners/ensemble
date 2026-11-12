'use strict';

/**
 * Precheck (kata 4ev6): the human-blocker list, the idempotent gate start and the one-comment rule, graded through
 * `runPrecheck` with injected deps. Each guard below has a case that fails when the guard is removed.
 */

const { runPrecheck, formatComment, buildReport, decideGate, COMMENT_MARKER } = require('../lib/pr-review-precheck');

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const TREE = 'c'.repeat(40);
const CONTEXT = 'ensemble/local-ci';
const GOOD_BODY = '## Testing\nran the suite\n\n## Risk\nlow\n\n## How to revert\nrevert the commit\n';
const DIRECTED_BODY = `${GOOD_BODY}\nDirected by: @maintainer\n`;

const review = (login, state, commitSha, extra = {}) => ({ login, state, commitSha, ...extra });

function makeDeps(over = {}) {
  const calls = { prepare: 0, startGate: 0, claim: 0, release: 0, post: [], update: [], find: 0, order: [] };
  const deps = {
    readPr: async () => ({ ok: true, headSha: HEAD, baseRefName: 'dev', state: 'OPEN', body: GOOD_BODY, author: 'someone', isCrossRepository: false }),
    readReviews: async () => ({ ok: true, reviews: [] }),
    readHeadTree: async () => ({ ok: true, treeSha: TREE }),
    readProtection: async () => ({ ok: true, protection: { required_pull_request_reviews: { required_approving_review_count: 2 } } }),
    readStatuses: async () => ({ ok: true, statuses: [] }),
    readGateConfig: async () => ({ ok: true, statusContext: CONTEXT }),
    readPolicy: async () => ({ ok: true, policy: { lowWaiverEnabled: false } }),
    prepareGate: async () => {
      calls.prepare += 1;
      calls.order.push('prepare');
      return { ok: true };
    },
    claimGateStart: async () => {
      calls.claim += 1;
      calls.order.push('claim');
      return { claimed: true };
    },
    startGate: async () => {
      calls.startGate += 1;
      calls.order.push('start');
      return { ok: true, pid: 4242, logPath: '/log', startedAt: '2026-11-06T00:00:00.000Z' };
    },
    releaseGateStart: async () => {
      calls.release += 1;
    },
    findComment: async () => {
      calls.find += 1;
      return { ok: true, comment: null };
    },
    postComment: async (body) => {
      calls.post.push(body);
      return { ok: true, id: 1, url: 'u' };
    },
    updateComment: async (id, body) => {
      calls.update.push({ id, body });
      return { ok: true, id, url: 'u' };
    },
    ...over,
  };
  return { deps, calls };
}

describe('gate start (AC1)', () => {
  it('starts the gate exactly once when no status exists for the head', async () => {
    const { deps, calls } = makeDeps();
    const r = await runPrecheck({}, deps);
    expect(r.gate.action).toBe('started');
    expect(calls.startGate).toBe(1);
  });

  it('says the detached gate posts the status when it finishes unless hosted CI already verified the head (then it posts nothing)', async () => {
    const { deps } = makeDeps();
    const r = await runPrecheck({}, deps);
    expect(r.comment.body).toContain(`It posts \`${CONTEXT}\` on this head when it finishes, unless hosted CI already verified the head: then it runs nothing and posts nothing (its log says \`stage hosted\`).`);
  });

  it('does not start it when the configured status is already on this head, whatever its state', async () => {
    for (const state of ['success', 'failure', 'pending', 'error']) {
      const { deps, calls } = makeDeps({ readStatuses: async () => ({ ok: true, statuses: [{ context: CONTEXT, state, sha: HEAD }] }) });
      const r = await runPrecheck({}, deps);
      expect(r.gate).toMatchObject({ action: 'status-present', state });
      expect(calls.startGate).toBe(0);
      expect(calls.claim).toBe(0);
    }
  });

  it('matches the status context case-insensitively, as GitHub does', async () => {
    const { deps, calls } = makeDeps({ readStatuses: async () => ({ ok: true, statuses: [{ context: 'Ensemble/Local-CI', state: 'success', sha: HEAD }] }) });
    await runPrecheck({}, deps);
    expect(calls.startGate).toBe(0);
  });

  it('starts it when the only status is for an OLD head', async () => {
    const { deps, calls } = makeDeps({ readStatuses: async () => ({ ok: true, statuses: [{ context: CONTEXT, state: 'success', sha: OLD }] }) });
    const r = await runPrecheck({}, deps);
    expect(calls.startGate).toBe(1);
    expect(r.gate.oldHeadStatus).toEqual({ sha: OLD, state: 'success' });
  });

  it('ignores statuses in other contexts', async () => {
    const { deps, calls } = makeDeps({ readStatuses: async () => ({ ok: true, statuses: [{ context: 'ci/hosted', state: 'success', sha: HEAD }] }) });
    await runPrecheck({}, deps);
    expect(calls.startGate).toBe(1);
  });

  it('does not start a second gate when one was already started (claim refused)', async () => {
    const { deps, calls } = makeDeps({ claimGateStart: async () => ({ claimed: false, existing: { pid: 7, startedAt: 't0', alive: true } }) });
    const r = await runPrecheck({}, deps);
    expect(r.gate.action).toBe('already-started');
    expect(calls.startGate).toBe(0);
    expect(r.comment.body).toContain('already started');
  });

  it('says so when the earlier gate process is gone and posted nothing, instead of restarting it', async () => {
    const { deps, calls } = makeDeps({ claimGateStart: async () => ({ claimed: false, existing: { pid: 7, startedAt: 't0', alive: false } }) });
    const r = await runPrecheck({}, deps);
    expect(calls.startGate).toBe(0);
    expect(r.comment.body).toContain('no longer running');
  });

  it('never starts a gate it cannot decide about: unreadable statuses or unreadable config', async () => {
    for (const over of [
      { readStatuses: async () => ({ ok: false, error: 'rate limited' }) },
      { readStatuses: async () => { throw new Error('boom'); } },
      { readGateConfig: async () => ({ ok: false, error: 'no config' }) },
    ]) {
      const { deps, calls } = makeDeps(over);
      const r = await runPrecheck({}, deps);
      expect(calls.startGate).toBe(0);
      expect(r.gate.action).toBe('not-started');
      expect(r.comment.body).toMatch(/not started/i);
    }
  });

  it('releases the start claim when the gate fails to start so a retry can start it', async () => {
    const { deps, calls } = makeDeps({ startGate: async () => ({ ok: false, error: 'spawn failed' }) });
    const r = await runPrecheck({}, deps);
    expect(r.gate.action).toBe('start-failed');
    expect(calls.release).toBe(1);
    expect(r.comment.body).toContain('could NOT be started');
  });

  it('passes dryRun through to the claim and the start', async () => {
    const seen = [];
    const { deps } = makeDeps({
      claimGateStart: async (a) => { seen.push(['claim', a.dryRun]); return { claimed: true }; },
      startGate: async (a) => { seen.push(['start', a.dryRun]); return { ok: true, pid: 1, logPath: 'l', startedAt: 't' }; },
    });
    await runPrecheck({ dryRun: true }, deps);
    expect(seen).toEqual([['claim', true], ['start', true]]);
  });

  it('decideGate only trusts statuses carrying the head sha', () => {
    expect(decideGate({ statusesResult: { ok: true, statuses: [{ context: CONTEXT, state: 'success' }] }, statusContext: CONTEXT, headSha: HEAD }).action).toBe('start');
  });
});

describe('the gate runs the head\'s own code, so only a same-repository head starts it (review round 1, finding 3)', () => {
  const prFrom = (extra) => async () => ({ ok: true, headSha: HEAD, baseRefName: 'dev', state: 'OPEN', body: GOOD_BODY, author: 'someone', ...extra });

  it('refuses a fork head with a named reason and claims, prepares and starts nothing, dry run or not', async () => {
    for (const dryRun of [false, true]) {
      const { deps, calls } = makeDeps({ readPr: prFrom({ isCrossRepository: true }) });
      const r = await runPrecheck({ dryRun }, deps);
      expect(r.gate).toMatchObject({ action: 'not-started', code: 'cross-repository-head' });
      expect(calls.prepare + calls.claim + calls.startGate + calls.release).toBe(0);
      expect(r.comment.body).toContain('Local CI gate: not started. the head of this pull request is on a fork');
    }
  });

  it('refuses when GitHub did not say where the head is: not knowing is not "same repository"', async () => {
    for (const extra of [{}, { isCrossRepository: null }, { isCrossRepository: 'false' }, { isCrossRepository: 0 }]) {
      const { deps, calls } = makeDeps({ readPr: prFrom(extra) });
      const r = await runPrecheck({}, deps);
      expect(r.gate).toMatchObject({ action: 'not-started', code: 'head-repository-unknown' });
      expect(calls.claim + calls.startGate).toBe(0);
    }
  });

  it('still posts the blocker list for a fork head: only the gate start is refused', async () => {
    const { deps, calls } = makeDeps({ readPr: prFrom({ isCrossRepository: true, body: '## Testing\nok\n' }) });
    const r = await runPrecheck({}, deps);
    expect(r.comment.action).toBe('created');
    expect(calls.post[0]).toContain('PR description is missing');
    expect(r.ok).toBe(true);
  });

  it('starts the gate for a head on this repository', async () => {
    const { deps, calls } = makeDeps({ readPr: prFrom({ isCrossRepository: false }) });
    expect((await runPrecheck({}, deps)).gate.action).toBe('started');
    expect(calls.startGate).toBe(1);
  });

  it('says a pending status that no run is working on needs forceLocal:true, and only for pending', async () => {
    for (const [state, expected] of [['pending', true], ['failure', false], ['success', false]]) {
      const { deps } = makeDeps({ readStatuses: async () => ({ ok: true, statuses: [{ context: CONTEXT, state, sha: HEAD }] }) });
      const body = (await runPrecheck({}, deps)).comment.body;
      expect(body).toContain(`is already posted on this head (${state}); not started.`);
      expect(body.includes('needs a gate run with `forceLocal:true`')).toBe(expected);
    }
  });

  it('reports a status already on a fork head as it is: nothing is started either way', async () => {
    const { deps } = makeDeps({ readPr: prFrom({ isCrossRepository: true }), readStatuses: async () => ({ ok: true, statuses: [{ context: CONTEXT, state: 'success', sha: HEAD }] }) });
    expect((await runPrecheck({}, deps)).gate.action).toBe('status-present');
  });
});

describe('a start leaves no claim behind that never started a gate (review round 1, finding 4)', () => {
  it('does every network step before it claims, and claims before it starts', async () => {
    const { deps, calls } = makeDeps();
    await runPrecheck({}, deps);
    expect(calls.order).toEqual(['prepare', 'claim', 'start']);
  });

  it('a failed or throwing preparation claims nothing, starts nothing and says so', async () => {
    for (const prepareGate of [async () => ({ ok: false, error: 'git fetch failed: network down' }), async () => { throw new Error('network down'); }]) {
      const { deps, calls } = makeDeps({ prepareGate });
      const r = await runPrecheck({}, deps);
      expect(r.gate).toMatchObject({ action: 'start-failed' });
      expect(calls.claim + calls.startGate + calls.release).toBe(0);
      expect(r.comment.body).toContain('could NOT be started');
      expect(r.comment.body).toContain('network down');
    }
  });

  it('a claim whose run died before it recorded a gate is reported as interrupted, with how to retry, and starts no second gate', async () => {
    const existing = { alive: false, orphaned: true, claimer: 4242, marker: '.ensemble/pr-review/precheck-pr-9-x.gate.json' };
    const { deps, calls } = makeDeps({ claimGateStart: async () => ({ claimed: false, existing }) });
    const r = await runPrecheck({}, deps);
    expect(r.gate.action).toBe('already-started');
    expect(calls.startGate).toBe(0);
    expect(r.comment.body).toContain('an earlier start was interrupted');
    expect(r.comment.body).toContain('`.ensemble/pr-review/precheck-pr-9-x.gate.json`');
    expect(r.comment.body).toContain('delete the marker');
    expect(r.comment.body).not.toContain('already started');
  });

  it('says another run is starting the gate while a young claim is still being made, and starts nothing', async () => {
    const { deps, calls } = makeDeps({ claimGateStart: async () => ({ claimed: false, existing: { alive: null, orphaned: false, claimer: 4242 } }) });
    const r = await runPrecheck({}, deps);
    expect(calls.startGate).toBe(0);
    expect(r.comment.body).toContain('another precheck run is starting it right now');
  });
});

describe('a gate that may be running keeps its claim (review round 1, finding 5)', () => {
  it('does not release the claim when startGate says a gate may still be running, and says so', async () => {
    const { deps, calls } = makeDeps({ startGate: async () => ({ ok: false, error: 'it could not be recorded', mayBeRunning: true, pid: 9 }) });
    const r = await runPrecheck({}, deps);
    expect(calls.release).toBe(0);
    expect(r.gate).toMatchObject({ action: 'start-failed', mayBeRunning: true, pid: 9 });
    expect(r.comment.body).toContain('A gate process may still be running');
  });

  it('releases the claim when nothing can be running: the start failed before a process existed, or the gate was stopped', async () => {
    for (const answer of [{ ok: false, error: 'spawn failed' }, { ok: false, error: 'stopped', mayBeRunning: false, pid: 9 }]) {
      const { deps, calls } = makeDeps({ startGate: async () => answer });
      const r = await runPrecheck({}, deps);
      expect(calls.release).toBe(1);
      expect(r.comment.body).not.toContain('may still be running');
    }
  });

  it('a startGate that throws is read as a failed start with nothing running (the real deps never throw after a spawn)', async () => {
    const { deps, calls } = makeDeps({ startGate: async () => { throw new Error('boom'); } });
    const r = await runPrecheck({}, deps);
    expect(r.gate).toMatchObject({ action: 'start-failed', reason: 'boom' });
    expect(calls.release).toBe(1);
  });
});

describe('one gate per head: a claim refused because another gate holds the head\'s clone (review round 1, finding 6)', () => {
  it('reports the refusal by name, starts nothing and releases nothing (the deps already gave the claim back)', async () => {
    const blocked = { kind: 'gate-running-for-head', reason: 'a dry-run gate for this head is still running (pid 7)' };
    const { deps, calls } = makeDeps({ claimGateStart: async () => ({ claimed: false, blocked }) });
    const r = await runPrecheck({}, deps);
    expect(r.gate).toMatchObject({ action: 'not-started', code: 'gate-running-for-head' });
    expect(calls.startGate + calls.release).toBe(0);
    expect(r.comment.body).toContain('Local CI gate: not started. a dry-run gate for this head is still running (pid 7)');
  });
});

describe('human blockers (AC2)', () => {
  it('lists every missing description section', async () => {
    const { deps } = makeDeps({ readPr: async () => ({ ok: true, headSha: HEAD, baseRefName: 'dev', state: 'OPEN', body: '## Testing\nok\n', author: 'x' }) });
    const r = await runPrecheck({}, deps);
    expect(r.description).toMatchObject({ state: 'missing', missing: ['risk', 'how-to-revert'] });
    expect(r.blockers.find((b) => b.code === 'description-section-missing').message).toBe('PR description is missing: risk, how-to-revert.');
  });

  it('reports no description blocker when all sections are present', async () => {
    const { deps } = makeDeps();
    const r = await runPrecheck({}, deps);
    expect(r.description.state).toBe('complete');
    expect(r.blockers.some((b) => b.code === 'description-section-missing')).toBe(false);
  });

  it('an unreadable PR body is unknown, never complete', () => {
    const report = buildReport({ headSha: HEAD, baseRefName: 'dev', pr: { ok: false, error: 'x' }, reviewsResult: { ok: true, reviews: [] }, protectionResult: { ok: true, notProtected: true }, policyResult: { ok: true, policy: { lowWaiverEnabled: false } } });
    expect(report.description.state).toBe('unknown');
    expect(report.blockers.some((b) => b.subject === 'description' && b.code === 'review-data-unavailable')).toBe(true);
  });

  it('reports the approvals shortfall as a LOWER BOUND while the tier is unknown', async () => {
    const { deps } = makeDeps();
    const r = await runPrecheck({}, deps);
    expect(r.approvals).toMatchObject({ state: 'short', lowerBound: true, required: 1, counted: 0, shortfall: 1 });
    const b = r.blockers.find((x) => x.code === 'approvals-unsatisfied');
    expect(b.lowerBound).toBe(true);
    expect(b.message).toContain('at least 1 more human approval');
    expect(b.message).toContain('lower bound');
  });

  it('does not invent a minimum when the policy cannot say the Low waiver is off', async () => {
    const { deps } = makeDeps({ readPolicy: async () => ({ ok: false, error: 'no' }) });
    const r = await runPrecheck({}, deps);
    expect(r.approvals).toMatchObject({ lowerBound: true, required: 0, state: 'not-established' });
    expect(r.blockers.some((b) => b.code === 'approvals-unsatisfied')).toBe(false);
    expect(r.comment.body).toContain('lower bound');
  });

  it('a supplied tier makes the requirement exact: no "at least"', async () => {
    const { deps } = makeDeps();
    const r = await runPrecheck({ tier: { ok: true, effectiveTier: 'high', humansRequired: 2 } }, deps);
    expect(r.approvals).toMatchObject({ lowerBound: false, required: 2, shortfall: 2, tier: 'high' });
    expect(r.blockers.find((b) => b.code === 'approvals-unsatisfied').message).not.toMatch(/at least|lower bound/);
  });

  it('counts only approvals bound to this head; one on an earlier commit does not satisfy it', async () => {
    const stale = makeDeps({ readReviews: async () => ({ ok: true, reviews: [review('alice', 'APPROVED', OLD)] }) });
    expect((await runPrecheck({}, stale.deps)).approvals).toMatchObject({ counted: 0, state: 'short' });
    const fresh = makeDeps({ readReviews: async () => ({ ok: true, reviews: [review('alice', 'APPROVED', HEAD)] }) });
    const r = await runPrecheck({}, fresh.deps);
    expect(r.approvals).toMatchObject({ counted: 1, state: 'not-established' });
    expect(r.blockers.some((b) => b.code === 'approvals-unsatisfied')).toBe(false);
  });

  it('a bot approval and the author\'s own approval fill no slot', async () => {
    const { deps } = makeDeps({
      readReviews: async () => ({ ok: true, reviews: [review('robot', 'APPROVED', HEAD, { authorType: 'Bot' }), review('someone', 'APPROVED', HEAD)] }),
    });
    expect((await runPrecheck({}, deps)).approvals.counted).toBe(0);
  });

  it('credits a named director as the gate would, and says that the credit assumes an agent wrote the PR', async () => {
    const { deps } = makeDeps({ readPr: async () => ({ ok: true, headSha: HEAD, baseRefName: 'dev', state: 'OPEN', body: DIRECTED_BODY, author: 'someone' }) });
    const r = await runPrecheck({}, deps);
    expect(r.approvals).toMatchObject({ counted: 1, directedBy: 'maintainer' });
    expect(r.comment.body).toContain('Directed by: @maintainer');
    expect(r.comment.body).toContain('if a person wrote it, that credit does not apply');
  });

  it('unreadable reviews are approvals: unknown, never satisfied', async () => {
    const { deps } = makeDeps({ readReviews: async () => ({ ok: false, error: 'rate limited' }) });
    const r = await runPrecheck({}, deps);
    expect(r.approvals.state).toBe('unknown');
    expect(r.blockers.find((b) => b.subject === 'approvals').code).toBe('review-data-unavailable');
  });

  it('survives a dep that throws: that fact is unknown, the run still completes', async () => {
    const { deps } = makeDeps({ readReviews: async () => { throw new Error('socket hang up'); } });
    const r = await runPrecheck({}, deps);
    expect(r.ok).toBe(true);
    expect(r.approvals.state).toBe('unknown');
  });

  it('runs and answers without a tier and without any classifier input (AC4)', async () => {
    const { deps } = makeDeps();
    const names = Object.keys(deps);
    expect(names.some((n) => /tier|classif/i.test(n))).toBe(false);
    const r = await runPrecheck({}, deps);
    expect(r.ok).toBe(true);
    expect(r.approvals.lowerBound).toBe(true);
    expect(r.comment.body).toContain('lower bound');
  });
});

describe('approvals are never reported as met from a bound (review round 1, finding 1)', () => {
  const HIGH = { ok: true, effectiveTier: 'high', humansRequired: 2 };
  const prWith = (body, author = 'someone') => async () => ({ ok: true, headSha: HEAD, baseRefName: 'dev', state: 'OPEN', body, author });
  const approvals = (...logins) => async () => ({ ok: true, reviews: logins.map((l) => review(l, 'APPROVED', HEAD)) });
  const NO_BLOCKERS = 'No human-actionable blockers found at this point.';

  it('a PR whose director is its author, with no approvals and no tier, says approvals are not established (the shape of the PR that found this)', async () => {
    const { deps, calls } = makeDeps({ readPr: prWith(DIRECTED_BODY, 'maintainer') });
    const r = await runPrecheck({}, deps);
    expect(r.approvals.state).toBe('not-established');
    expect(r.notEstablished.map((n) => n.subject)).toEqual(['approvals']);
    expect(calls.post[0]).not.toContain(NO_BLOCKERS);
    expect(calls.post[0]).toContain('Approvals: not established.');
    expect(calls.post[0]).toContain('a High PR needs 2');
  });

  it('one real approval and no tier is still not established: the tier may need two', async () => {
    const { deps } = makeDeps({ readReviews: approvals('alice') });
    const r = await runPrecheck({ dryRun: true }, deps);
    expect(r.approvals).toMatchObject({ state: 'not-established', counted: 1, lowerBound: true });
    expect(r.comment.body).not.toContain(NO_BLOCKERS);
    expect(r.comment.body).toContain('Approvals: not established.');
  });

  it('names what is not established and the blockers that are: both appear, the "no blockers" line does not', async () => {
    const { deps } = makeDeps({ readReviews: approvals('alice'), readPr: prWith('## Testing\nok\n') });
    const r = await runPrecheck({ dryRun: true }, deps);
    expect(r.blockers.map((b) => b.code)).toEqual(['description-section-missing']);
    expect(r.comment.body).toContain('Things a person can act on now');
    expect(r.comment.body).toContain('Not established yet:');
  });

  it('a known tier is satisfied only when the count holds WITHOUT the director credit', async () => {
    // alice + the credited director = 2 of 2, but the director earns a slot only if an agent wrote the PR.
    const credited = await runPrecheck({ tier: HIGH, dryRun: true }, makeDeps({ readPr: prWith(DIRECTED_BODY), readReviews: approvals('alice') }).deps);
    expect(credited.approvals).toMatchObject({ state: 'not-established', counted: 2, required: 2, lowerBound: false });
    expect(credited.approvals.reason).toContain('without that credit the count is 1');
    expect(credited.comment.body).toContain('if a person wrote it, that credit does not apply');
    expect(credited.comment.body).not.toContain(NO_BLOCKERS);

    // two real approvals meet it whoever wrote the PR.
    const real = await runPrecheck({ tier: HIGH, dryRun: true }, makeDeps({ readPr: prWith(DIRECTED_BODY), readReviews: approvals('alice', 'bob') }).deps);
    expect(real.approvals).toMatchObject({ state: 'satisfied', lowerBound: false });
    expect(real.comment.body).toContain(NO_BLOCKERS);

    const medium = await runPrecheck({ tier: { ok: true, effectiveTier: 'medium', humansRequired: 1 }, dryRun: true }, makeDeps({ readPr: prWith(DIRECTED_BODY), readReviews: approvals('alice') }).deps);
    expect(medium.approvals.state).toBe('satisfied');
  });

  it('a shortfall that holds even with the director credited is still a blocker', async () => {
    const r = await runPrecheck({ tier: HIGH, dryRun: true }, makeDeps({ readPr: prWith(DIRECTED_BODY) }).deps);
    expect(r.approvals).toMatchObject({ state: 'short', counted: 1, required: 2, shortfall: 1 });
    expect(r.blockers.map((b) => b.code)).toContain('approvals-unsatisfied');
  });

  it('a tier record that refused a relaxation is not established even when the count suffices', async () => {
    const refused = { ...HIGH, refusals: [{ code: 'solo-maintainer-refused' }] };
    const r = await runPrecheck({ tier: refused, dryRun: true }, makeDeps({ readReviews: approvals('alice', 'bob') }).deps);
    expect(r.approvals.state).toBe('not-established');
    expect(r.approvals.reason).toContain('tier-relaxation-refused');
    expect(r.comment.body).not.toContain(NO_BLOCKERS);
  });
});

describe('branch protection is never claimed without a read (AC2)', () => {
  const protection = (readProtection) => runPrecheck({}, makeDeps({ readProtection }).deps);

  it('an unreadable read is `unknown` and the comment never says enforced', async () => {
    const r = await protection(async () => ({ ok: false, error: 'HTTP 403' }));
    expect(r.protection.state).toBe('unknown');
    expect(r.comment.body).toContain('unknown');
    expect(r.comment.body).not.toMatch(/enforced/);
  });

  it('a thrown read is `unknown`', async () => {
    expect((await protection(async () => { throw new Error('x'); })).protection.state).toBe('unknown');
  });

  it('a malformed answer is `unknown`', async () => {
    expect((await protection(async () => ({ ok: true, protection: 'nope' }))).protection.state).toBe('unknown');
  });

  it('a branch with no rule prints the SERVER-SIDE ENFORCEMENT ABSENT notice', async () => {
    const r = await protection(async () => ({ ok: true, notProtected: true }));
    expect(r.protection.state).toBe('absent');
    expect(r.comment.body).toContain('SERVER-SIDE ENFORCEMENT ABSENT: dev does not require the approvals this tier needs');
    expect(r.comment.body).toContain('Recommended: require 1 approving review(s) on dev in branch protection.');
  });

  it('a rule requiring fewer reviews than the tier needs is absent, not enforced', async () => {
    const r = await runPrecheck({ tier: { ok: true, effectiveTier: 'high', humansRequired: 2 } }, makeDeps({ readProtection: async () => ({ ok: true, protection: { required_pull_request_reviews: { required_approving_review_count: 1 } } }) }).deps);
    expect(r.protection).toMatchObject({ state: 'absent', needed: 2, requiredReviews: 1 });
  });

  it('a rule with no required reviews at all is absent', async () => {
    expect((await protection(async () => ({ ok: true, protection: { required_status_checks: {} } }))).protection.state).toBe('absent');
  });

  it('is enforced only when the rule requires at least the approvals the tier needs', async () => {
    const r = await protection(async () => ({ ok: true, protection: { required_pull_request_reviews: { required_approving_review_count: 1 } } }));
    expect(r.protection).toMatchObject({ state: 'enforced', requiredReviews: 1 });
  });
});

describe('one comment, updated in place (AC3)', () => {
  it('creates the comment when none exists', async () => {
    const { deps, calls } = makeDeps();
    const r = await runPrecheck({}, deps);
    expect(r.comment.action).toBe('created');
    expect(calls.post).toHaveLength(1);
    expect(calls.update).toHaveLength(0);
    expect(calls.post[0].startsWith(COMMENT_MARKER)).toBe(true);
  });

  it('updates the existing comment and never posts a second one', async () => {
    const { deps, calls } = makeDeps({ findComment: async () => ({ ok: true, comment: { id: 77, body: `${COMMENT_MARKER}\nold` } }) });
    const r = await runPrecheck({}, deps);
    expect(r.comment).toMatchObject({ action: 'updated', id: 77 });
    expect(calls.post).toHaveLength(0);
    expect(calls.update).toHaveLength(1);
    expect(calls.update[0].id).toBe(77);
  });

  it('a second run for a NEW head still updates the same comment, now naming the new head', async () => {
    const NEW = 'd'.repeat(40);
    const { deps, calls } = makeDeps({
      readPr: async () => ({ ok: true, headSha: NEW, baseRefName: 'dev', state: 'OPEN', body: GOOD_BODY, author: 'x' }),
      findComment: async () => ({ ok: true, comment: { id: 5, body: `${COMMENT_MARKER}\nhead aaaaaaaa` } }),
    });
    await runPrecheck({}, deps);
    expect(calls.post).toHaveLength(0);
    expect(calls.update[0].body).toContain('dddddddd');
  });

  it('dry run posts and updates nothing and does not even look for the comment', async () => {
    const { deps, calls } = makeDeps();
    const r = await runPrecheck({ dryRun: true }, deps);
    expect(r.comment.action).toBe('dry-run');
    expect(calls.post).toHaveLength(0);
    expect(calls.update).toHaveLength(0);
    expect(calls.find).toBe(0);
    expect(r.comment.body).toContain(COMMENT_MARKER);
  });

  it('a failed lookup posts nothing (it would risk a duplicate) and the run is ok:false', async () => {
    const { deps, calls } = makeDeps({ findComment: async () => ({ ok: false, error: 'no viewer' }) });
    const r = await runPrecheck({}, deps);
    expect(calls.post).toHaveLength(0);
    expect(r.comment.action).toBe('failed');
    expect(r.ok).toBe(false);
  });

  it('a failed write is reported, not swallowed', async () => {
    const { deps } = makeDeps({ postComment: async () => ({ ok: false, error: 'HTTP 403' }) });
    const r = await runPrecheck({}, deps);
    expect(r).toMatchObject({ ok: false, comment: { action: 'failed', error: 'HTTP 403' } });
  });
});

describe('PR facts', () => {
  it('fails closed with no comment and no gate when the PR cannot be read', async () => {
    const { deps, calls } = makeDeps({ readPr: async () => ({ ok: false, error: 'gh: not found' }) });
    const r = await runPrecheck({}, deps);
    expect(r).toMatchObject({ ok: false, stage: 'pr' });
    expect(calls.startGate + calls.post.length).toBe(0);
  });

  it('refuses a PR that is not OPEN and a head that is not a full sha', async () => {
    const closed = makeDeps({ readPr: async () => ({ ok: true, headSha: HEAD, baseRefName: 'dev', state: 'MERGED', body: '', author: 'x' }) });
    expect((await runPrecheck({}, closed.deps)).ok).toBe(false);
    const short = makeDeps({ readPr: async () => ({ ok: true, headSha: 'abc123', baseRefName: 'dev', state: 'OPEN', body: '', author: 'x' }) });
    const r = await runPrecheck({}, short.deps);
    expect(r.ok).toBe(false);
    expect(short.calls.startGate).toBe(0);
  });
});

describe('comment text', () => {
  it('shows no blockers honestly and still carries the marker, the head and the not-the-gate disclaimer', async () => {
    const { deps } = makeDeps({ readReviews: async () => ({ ok: true, reviews: [review('alice', 'APPROVED', HEAD)] }) });
    const r = await runPrecheck({}, deps);
    const MEDIUM = { ok: true, effectiveTier: 'medium', humansRequired: 1 };
    const body = formatComment(buildReport({ headSha: HEAD, baseRefName: 'dev', pr: { ok: true, body: GOOD_BODY, author: 'x' }, reviewsResult: { ok: true, reviews: [review('alice', 'APPROVED', HEAD)] }, protectionResult: { ok: true, protection: { required_pull_request_reviews: { required_approving_review_count: 1 } } }, policyResult: { ok: true, policy: { lowWaiverEnabled: false } }, tier: MEDIUM }), r.gate);
    expect(body.split('\n')[0]).toBe(COMMENT_MARKER);
    expect(body).toContain('No human-actionable blockers found at this point.');
    expect(body).toContain('aaaaaaaa');
    expect(body).toContain('REVIEW_COMPLETE and the merge decision come only from the review gate');
  });
});
