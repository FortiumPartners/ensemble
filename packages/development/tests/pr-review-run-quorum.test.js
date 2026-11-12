'use strict';

/**
 * Quorum-first verification (kata 3ezq; plan v2 section 3 O3a and section 5 child V2-3; owner decision D4) through the REAL review runner:
 * prepareRun / collectRun over fake deps, the real result-file collector and the real filesystem, exactly as pr-review-run.test.js does.
 *
 * What is pinned, each by a test that fails when its guard is removed:
 *   - with the policy key on, only the first strict majority of every candidate's electorate is dispatched (6 candidates: 4 verifiers where 6
 *     were dispatched), the electorate stays 3 and every candidate is asked of distinct fresh verifiers, none its raiser;
 *   - a candidate its first votes all settle is `quorum-settled`: present, no incomplete verifier, the round not `partial`, never carried;
 *   - a not-real, an abstain and a missing first vote (a verifier that never returned, and one that returned no entry for the candidate) each
 *     dispatch the rest of THAT candidate's electorate, fresh agents that join the verify queue under the cap and the verifier's deadline floor;
 *   - the outcome of every candidate equals the full electorate's;
 *   - whatever cannot be planned this way is asked in full, and the key off leaves everything as it was.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { prepareRun, collectRun } = require('../lib/pr-review-run');
const { collectResults } = require('../lib/pr-review-results');
const { renderBriefFromFiles } = require('../lib/pr-review-brief-files');
const { classifyPaths } = require('../lib/pr-review-paths');
const { loadPolicy } = require('../lib/pr-review-policy');
const { realFs } = require('../lib/review-run-cli');
const { redact } = require('../lib/pr-review-state');
const { MIN_VERIFIER_MINUTES } = require('../lib/pr-review-sizing');

const SCRATCH = path.join(os.homedir(), '.omp', 'pr-review-speedup', '3ezq', 'scratch');
const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const TREE = 'c'.repeat(40);
const GOOD_BODY = '## Testing\nran the relevant tests\n\n## Risk\nlow\n\n## How to revert\nrevert the commit\n';

const roots = [];
afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function makeFacts({ changedPaths, policyJson = {} }) {
  const text = `# Review\n\n\`\`\`ensemble-review-policy\n${JSON.stringify(policyJson)}\n\`\`\`\n`;
  const policy = loadPolicy({ text, baseSha: BASE, sourceSha: BASE });
  const declaration = { sourceSha: BASE, sensitive: policy.policy.sensitivePaths, high: policy.policy.highPaths };
  const paths = classifyPaths({ changedPaths, declaration, baseSha: BASE });
  return { schema: 2, baseSha: BASE, headSha: HEAD, changedPaths, numstat: changedPaths.map((p) => ({ path: p, added: 10, deleted: 2 })), policy, paths };
}

/** The same fake-deps harness as pr-review-run.test.js, cut to what these tests need. `renderBrief` may be replaced. */
function harness({ policyJson, overrides = {} } = {}) {
  fs.mkdirSync(SCRATCH, { recursive: true });
  const root = fs.mkdtempSync(path.join(SCRATCH, 'q-'));
  roots.push(root);
  const repoRoot = path.join(root, 'repo');
  const dir = path.join(root, 'prepared');
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.mkdirSync(path.join(dir, 'snapshot'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'range.diff'), 'diff --git a/x b/x\n');
  fs.writeFileSync(path.join(dir, 'facts.json'), JSON.stringify(makeFacts({ changedPaths: ['src/a.js'], policyJson })));
  fs.writeFileSync(path.join(dir, 'baseline.json'), JSON.stringify({ ran: false, reason: 'no-test-files', command: null, exitCode: null, timedOut: false, selection: [] }));
  const h = { root, repoRoot, stateWrites: [] };
  h.deps = {
    now: () => Date.now(),
    redact,
    fs: realFs(),
    readPr: async () => ({ ok: true, headSha: HEAD, baseRefName: 'main', state: 'OPEN', body: GOOD_BODY, author: 'alice', isCrossRepository: false }),
    readReviews: async () => ({ ok: true, reviews: [] }),
    readProtection: async () => ({ ok: true, notProtected: true }),
    git: async (args) => {
      if (args[0] === 'merge-base') return { status: 0, stdout: `${BASE}\n`, stderr: '' };
      if (args[0] === 'rev-parse') return { status: 0, stdout: `${TREE}\n`, stderr: '' };
      return { status: 1, stdout: '', stderr: 'unexpected git call' };
    },
    fetchRefs: async () => ({ ok: true }),
    precheck: async () => ({ ok: true, headSha: HEAD, blockers: [], comment: { action: 'created', id: 1 } }),
    prepareReview: async (options) => ({
      ok: true,
      status: 'PREPARED',
      reused: false,
      dir,
      manifestPath: path.join(dir, 'manifest.json'),
      headSha: options.headSha,
      baseSha: options.baseSha,
      mode: 'full',
      absent: {},
      artifacts: { snapshot: { path: path.join(dir, 'snapshot') }, 'range.diff': { path: path.join(dir, 'range.diff') }, 'facts.json': { path: path.join(dir, 'facts.json') }, 'baseline.json': { path: path.join(dir, 'baseline.json') } },
    }),
    collectResults: (input) => collectResults(input),
    renderBrief: (role, vars) => renderBriefFromFiles(role, vars),
    writeState: async (target, state) => {
      h.stateWrites.push({ target, state });
      return { ok: true, path: target };
    },
    makeTracer: () => ({ startSpan: () => 1, endSpan: () => true }),
    ...overrides,
  };
  h.prepare = (extra = {}) => prepareRun({ repo: 'o/r', pr: 7, repoRoot, runId: 'run1', agentAuthored: false, ...extra }, h.deps);
  h.collect = (extra = {}) => collectRun({ repoRoot, runId: 'run1', ...extra }, h.deps);
  h.readRun = () => JSON.parse(fs.readFileSync(path.join(repoRoot, '.ensemble', 'pr-review', 'run', 'run1', 'run.json'), 'utf8'));
  return h;
}

const writeResult = (agent, object) => {
  fs.mkdirSync(path.dirname(agent.outPath), { recursive: true });
  const temp = `${agent.outPath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(object));
  fs.renameSync(temp, agent.outPath);
};

const finding = (over = {}) => ({ locationOrLink: 'src/a.js:3', severity: 'important', failureMode: 'the loop reads past the end of the list', disposition: 'fix', evidence: 'src/a.js line 3 indexes list[list.length]', originalTextOrLink: 'src/a.js:3', ...over });

/** Six distinct candidates (f1 .. f6), all raised by reviewer-s1-a. */
const SIX = (name) => (name === 'reviewer-s1-a' ? [0, 1, 2, 3, 4, 5].map((i) => finding({ locationOrLink: `src/a.js:${i + 1}`, failureMode: `distinct defect number ${i} in a different subsystem ${'x'.repeat(i)}` })) : []);
const IDS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'];

function answerReview(manifest, findingsFor, paths) {
  for (const agent of manifest.agents) {
    if (agent.role === 'reviewer') writeResult(agent, { findings: findingsFor(agent.name), pathsReviewed: agent.paths });
    else writeResult(agent, { findings: [], pathsReviewed: paths });
  }
}

/** prepare -> review rounds (the cap may split them into several waves) -> the first verify manifest. */
async function toVerify(h, findingsFor = SIX) {
  let manifest = await h.prepare();
  for (;;) {
    answerReview(manifest, findingsFor, ['src/a.js']);
    manifest = await h.collect();
    if (manifest.round !== 'review') return manifest;
  }
}

/**
 * Every listed agent votes `verdictFor(agentName, candidateId)` on each candidate it holds: a verdict word, or `null` for NO entry (an honest
 * incomplete). `skip` lists agents that never write a file.
 */
function vote(agents, verdictFor = () => 'real', skip = []) {
  for (const agent of agents) {
    if (skip.includes(agent.name)) continue;
    const votes = agent.candidateIds.map((id) => ({ id, verdict: verdictFor(agent.name, id) })).filter((entry) => entry.verdict !== null);
    writeResult(agent, { votes: votes.map((entry) => ({ candidateId: entry.id, verdict: entry.verdict, evidence: 'checked' })) });
  }
}

/**
 * The agent is past its deadline now: a verifier's deadline is never under its floor, so a test that needs a verifier STOPPED cannot wait for one, and a
 * clock run ahead would date every later dispatch ahead of the files the test writes (a result is dated by its change time, which cannot be moved). So the
 * run's own record of the agent's deadline is moved back, which is what the passing of the time would have done.
 */
function expire(h, name) {
  const file = path.join(h.repoRoot, '.ensemble', 'pr-review', 'run', 'run1', 'run.json');
  const run = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const wave of run.waves) for (const agent of wave.agents) if (agent.name === name) Object.assign(agent, { dispatchedAt: Date.now() - 20 * 60 * 1000, deadlineAt: Date.now() - 1000 });
  fs.writeFileSync(file, JSON.stringify(run));
}

/** candidate id -> names of the agents of `agents` that hold it. */
function holders(agents) {
  const byCandidate = new Map();
  for (const agent of agents) for (const id of agent.candidateIds) byCandidate.set(id, [...(byCandidate.get(id) || []), agent.name]);
  return byCandidate;
}

const QUORUM = { quorumFirstVerification: true };
const outcomesOf = (answer) => answer.votes.outcomes.map((o) => [o.id, o.outcome, o.reason]);

describe('quorum-first verification: what is dispatched', () => {
  test('KEY OFF: the whole electorate is dispatched, 6 candidates are 6 verifiers of three claims each, and nothing of the mode is recorded anywhere', async () => {
    for (const policyJson of [undefined, { quorumFirstVerification: false }]) {
      const h = harness({ policyJson });
      const v1 = await toVerify(h);
      expect(v1).toMatchObject({ status: 'DISPATCH', round: 'verify', wave: '1 of 1' });
      expect(v1.agents.map((a) => a.name)).toEqual(['verifier-1', 'verifier-2', 'verifier-3', 'verifier-4', 'verifier-5', 'verifier-6']);
      for (const names of holders(v1.agents).values()) expect(new Set(names).size).toBe(3);
      expect(v1.quorumFirst).toBeUndefined();
      expect(v1.agents.some((a) => a.secondWave !== undefined)).toBe(false);
      vote(v1.agents);
      const done = await h.collect();
      expect(done.status).toBe('DONE');
      expect(done.votes.quorumFirst).toBeUndefined();
      expect(done.votes.outcomes.every((o) => o.quorumSettled === undefined && o.tally.real === 3)).toBe(true);
      const run = h.readRun();
      expect(run.quorum).toBeUndefined();
      expect(h.stateWrites[0].state.verification).toEqual({ verification: 'performed' });
      expect(done.ledger.every((entry) => entry.verification.quorumSettled === undefined)).toBe(true);
      expect(done.reducedReview).not.toMatch(/QUORUM-FIRST/);
      expect(done.metrics).toMatchObject({ agentsDispatched: 3 + 6 });
    }
  });

  test('KEY ON: only the first strict majority is asked: 6 candidates are 4 verifiers, each candidate two DISTINCT fresh verifiers, none its raiser, the electorate still 3, the mode named in the manifest', async () => {
    const h = harness({ policyJson: QUORUM });
    const v1 = await toVerify(h);
    expect(v1).toMatchObject({ ok: true, status: 'DISPATCH', round: 'verify', wave: '1 of 1', depth: { mode: 'standard', verifiersPerCandidate: 3 }, quorumFirst: { expected: 3, needed: 2, secondWave: false } });
    expect(v1.agents.map((a) => a.name)).toEqual(['verifier-1', 'verifier-2', 'verifier-3', 'verifier-4']);
    expect(v1.agents.some((a) => a.secondWave !== undefined)).toBe(false);
    const per = holders(v1.agents);
    expect([...per.keys()].sort()).toEqual(IDS);
    for (const names of per.values()) {
      expect(names).toHaveLength(2);
      expect(new Set(names).size).toBe(2);
      expect(names).not.toContain('reviewer-s1-a');
    }
    // no verifier is asked about more than three claims, as before
    expect(Math.max(...v1.agents.map((a) => a.candidateIds.length))).toBeLessThanOrEqual(3);
    const run = h.readRun();
    expect(run.quorum).toEqual({ requested: true, applied: true, expected: 3, needed: 2, nextVerifier: 5, secondWave: [], skipped: [] });
    expect(run.depth.verifiersPerCandidate).toBe(3);
    expect(run.assignment.map((entry) => entry.verifiers.length)).toEqual([2, 2, 2, 2, 2, 2]);
  });

  test('only the boolean true turns it on: "yes", 1 and a string are rejected by name and the whole electorate is asked', async () => {
    for (const value of ['yes', 1, 'true']) {
      const h = harness({ policyJson: { quorumFirstVerification: value } });
      const v1 = await toVerify(h);
      expect(v1.agents).toHaveLength(6);
      expect(v1.quorumFirst).toBeUndefined();
      expect(h.readRun().policy.quorumFirstVerification).toBe(false);
      expect(h.readRun().policyRejected).toEqual([{ key: 'quorumFirstVerification', reason: 'invalid-type', value }]);
    }
  });
});

describe('quorum-first verification: a candidate its first votes settle', () => {
  test('every first vote real: DONE in one verify wave, each candidate quorum-settled (present, 2 of 3, nobody missing), the round performed and not partial, the mode named in the report', async () => {
    const h = harness({ policyJson: QUORUM });
    const v1 = await toVerify(h);
    vote(v1.agents);
    const done = await h.collect();
    expect(done.status).toBe('DONE');
    expect(done.votes).toMatchObject({ verification: 'performed', quorumFirst: { applied: true, expected: 3, needed: 2, settled: IDS, secondWave: [] } });
    expect(done.votes.reason).toBeUndefined();
    expect(done.votes.recoveryAction).toBeUndefined();
    for (const o of done.votes.outcomes) {
      expect(o).toMatchObject({ outcome: 'present', reason: 'verifier-majority', quorumSettled: true, unaskedVerifiers: 1, tally: { real: 2, notReal: 0, abstain: 0, expected: 3, needed: 2 } });
      expect(o.settledOnMajority).toBeUndefined();
      expect(o.missing).toBeUndefined();
    }
    // not a lost verifier: the verifiers never asked are in no list of what went missing, and the ledger entry names nobody
    expect(done.notReviewed.incompleteVerifiers).toEqual([]);
    expect(done.notReviewed.expiredAgents).toEqual([]);
    for (const entry of done.ledger) {
      expect(entry.verification).toMatchObject({ outcome: 'present', reason: 'verifier-majority', quorumSettled: true, unaskedVerifiers: 1, incompleteVerifiers: [] });
      expect(entry.verification.settledOnMajority).toBeUndefined();
    }
    expect(done.reducedReview).toMatch(/QUORUM-FIRST verification \(policy quorumFirstVerification; the electorate stays 3 and the vote rule is unchanged\)/);
    expect(done.reducedReview).toMatch(/Settled by their first 2 real votes: f1, f2, f3, f4, f5, f6 /);
    expect(done.reducedReview).not.toMatch(/SETTLED ON A MAJORITY|verification partial/);
    expect(done.metrics).toMatchObject({ agentsDispatched: 3 + 4, agentsByRole: { verifier: 4 } });
    // the state report names the mode the same way
    expect(h.stateWrites[0].state.verification).toMatchObject({ verification: 'performed', quorumFirst: { applied: true, settled: IDS } });
  });

  test('the gate and the ledger read it exactly as they read a fully voted candidate: the same findings, the same blockers, the same outcome per candidate', async () => {
    const answers = [];
    for (const policyJson of [undefined, QUORUM]) {
      const h = harness({ policyJson });
      const v1 = await toVerify(h);
      vote(v1.agents);
      answers.push(await h.collect());
    }
    const [full, quorum] = answers;
    expect(outcomesOf(quorum)).toEqual(outcomesOf(full));
    expect(quorum.gate.mergeable).toBe(full.gate.mergeable);
    expect(quorum.gate.blockers.map((b) => b.code)).toEqual(full.gate.blockers.map((b) => b.code));
    expect(quorum.gate.findings).toEqual(full.gate.findings);
    expect(quorum.status).toBe(full.status);
  });

  test('it is never carried: the verdict records of the round hold none of its candidates, each named quorum-settled, and the full electorate of the same round records them', async () => {
    const recorded = [];
    for (const policyJson of [undefined, QUORUM]) {
      const h = harness({ policyJson });
      const v1 = await toVerify(h);
      vote(v1.agents);
      const done = await h.collect();
      recorded.push({ carry: done.carry, verdicts: h.stateWrites[0].state.verdicts });
    }
    const [full, quorum] = recorded;
    // the full electorate: no hasher is injected, so nothing here is hashed and recorded either; what the quorum round adds is the NAME
    expect(quorum.verdicts).toEqual([]);
    expect(quorum.carry.recorded).toBe(0);
    expect(quorum.carry.skipped.map((s) => [s.id, s.reason])).toEqual(IDS.map((id) => [id, 'quorum-settled']));
    expect(full.carry.skipped.some((s) => s.reason === 'quorum-settled')).toBe(false);
  });
});

describe('quorum-first verification: a first vote that is not real dispatches the rest of that candidate\'s electorate', () => {
  /** One first-wave verifier of f2 votes `verdict` on it; everyone else votes real. Returns the second-wave manifest. */
  async function dissent(h, v1, verdict) {
    const [dissenter] = holders(v1.agents).get('f2');
    vote(v1.agents, (name, id) => (name === dissenter && id === 'f2' ? verdict : 'real'));
    return h.collect();
  }

  test.each([['not-real'], ['abstain']])('a first %s vote: ONE fresh verifier is dispatched for that candidate alone, under the verifier floor, briefed with the claim and nothing of the first wave', async (verdict) => {
    const h = harness({ policyJson: QUORUM });
    const v1 = await toVerify(h);
    const v2 = await dissent(h, v1, verdict);
    expect(v2).toMatchObject({ ok: true, status: 'DISPATCH', round: 'verify', wave: '2 (rolling)', quorumFirst: { expected: 3, needed: 2, secondWave: true } });
    expect(v2.refill).toBeUndefined(); // nothing else runs: a wave of its own
    expect(v2.agents).toHaveLength(1);
    const [second] = v2.agents;
    expect(second).toMatchObject({ name: 'verifier-5', role: 'verifier', candidateIds: ['f2'], secondWave: true });
    expect(second.deadlineAt - second.dispatchedAt).toBe(MIN_VERIFIER_MINUTES * 60 * 1000);

    // independence: a FRESH name (never one of the first wave's), not the raiser, and a brief that carries the claim exactly as the first wave's does
    const first = [...holders(v1.agents).get('f2')];
    expect(first).not.toContain(second.name);
    const section = (text) => /### Candidate f2\n\n([\s\S]*?)(?:\n---\n|\n## Output contract)/.exec(text)[1];
    const firstBrief = fs.readFileSync(v1.agents.find((a) => a.name === first[0]).briefPath, 'utf8');
    const secondBrief = fs.readFileSync(second.briefPath, 'utf8');
    expect(section(secondBrief)).toBe(section(firstBrief));
    expect(secondBrief).not.toMatch(/verifier-[1-4]\b/);
    expect(secondBrief).toMatch(/# Findings to settle \(1\)/);

    vote(v2.agents);
    const done = await h.collect();
    expect(done.status).toBe('DONE');
    const f2 = done.votes.outcomes.find((o) => o.id === 'f2');
    // 2 of 3 real with one dissent: present, exactly what the full electorate says of [real, dissent, real]; its whole electorate was asked
    expect(f2).toMatchObject({ outcome: 'present', reason: 'verifier-majority', tally: { real: 2, notReal: verdict === 'not-real' ? 1 : 0, abstain: verdict === 'abstain' ? 1 : 0, expected: 3 } });
    expect(f2.quorumSettled).toBeUndefined();
    expect(done.votes.outcomes.filter((o) => o.quorumSettled === true).map((o) => o.id)).toEqual(['f1', 'f3', 'f4', 'f5', 'f6']);
    expect(done.votes.verification).toBe('performed');
    expect(done.votes.quorumFirst).toMatchObject({ settled: ['f1', 'f3', 'f4', 'f5', 'f6'], secondWave: [{ id: 'f2', reasons: [verdict], verifiers: ['verifier-5'] }] });
    expect(done.reducedReview).toMatch(new RegExp(`Given the rest of their electorate: f2 \\(${verdict}; asked verifier-5\\)`));
    // the electorate is complete: three distinct verifiers, none the raiser, the second-wave one never a first-wave name
    const entry = h.readRun().assignment.find((a) => a.id === 'f2');
    expect(entry.verifiers).toEqual([...first, 'verifier-5']);
    expect(new Set(entry.verifiers).size).toBe(3);
    expect(entry.verifiers).not.toContain('reviewer-s1-a');
    expect(done.metrics).toMatchObject({ agentsDispatched: 3 + 4 + 1 });
  });

  test('the second wave decides like the full electorate: a first not-real vote and a second one is a refutation, filtered; a second real vote is a confirmation, present', async () => {
    const outcomes = {};
    for (const second of ['real', 'not-real']) {
      const h = harness({ policyJson: QUORUM });
      const v1 = await toVerify(h);
      const v2 = await dissent(h, v1, 'not-real');
      vote(v2.agents, () => second);
      const done = await h.collect();
      outcomes[second] = done.votes.outcomes.find((o) => o.id === 'f2');
    }
    expect(outcomes.real).toMatchObject({ outcome: 'present', reason: 'verifier-majority', tally: { real: 2, notReal: 1 } });
    expect(outcomes['not-real']).toMatchObject({ outcome: 'filtered', reason: 'verifier-majority-not-reached', tally: { real: 1, notReal: 2 } });
  });

  test('an abstaining second vote leaves it short of the majority exactly as it does at full strength: [real, abstain, abstain] is filtered', async () => {
    const h = harness({ policyJson: QUORUM });
    const v1 = await toVerify(h);
    const v2 = await dissent(h, v1, 'abstain');
    vote(v2.agents, () => 'abstain');
    const done = await h.collect();
    expect(done.votes.outcomes.find((o) => o.id === 'f2')).toMatchObject({ outcome: 'filtered', tally: { real: 1, abstain: 2 } });
  });
});

describe('quorum-first verification: a first vote that is MISSING dispatches the rest too', () => {
  test('a verifier that never returns (stopped at its deadline): every candidate it held draws the rest, packed into one fresh verifier, and the round is partial because a verifier that WAS asked is lost', async () => {
    const h = harness({ policyJson: QUORUM });
    const v1 = await toVerify(h);
    const lost = v1.agents[0];
    expect(lost.candidateIds.length).toBeGreaterThan(1);
    vote(v1.agents, () => 'real', [lost.name]);
    expire(h, lost.name);
    const v2 = await h.collect();
    expect(v2).toMatchObject({ status: 'DISPATCH', round: 'verify', quorumFirst: { secondWave: true } });
    expect(v2.agents).toHaveLength(1);
    expect(v2.agents[0]).toMatchObject({ name: 'verifier-5', secondWave: true, candidateIds: [...lost.candidateIds].sort() });
    expect(v2.agents[0].deadlineAt - v2.agents[0].dispatchedAt).toBe(MIN_VERIFIER_MINUTES * 60 * 1000);

    vote(v2.agents);
    const done = await h.collect();
    expect(done.status).toBe('DONE');
    const drawn = new Set(lost.candidateIds);
    for (const o of done.votes.outcomes) {
      if (drawn.has(o.id)) {
        // [missing, real] + [real]: a strict majority of the electorate, with the verifier that was asked and returned nothing named
        expect(o).toMatchObject({ outcome: 'present', settledOnMajority: true, missing: [lost.name], tally: { real: 2, expected: 3 } });
        expect(o.quorumSettled).toBeUndefined();
      } else {
        expect(o).toMatchObject({ outcome: 'present', quorumSettled: true });
      }
    }
    expect(done.votes.verification).toBe('partial');
    expect(done.notReviewed.incompleteVerifiers).toEqual([expect.objectContaining({ verifier: lost.name, candidateIds: lost.candidateIds })]);
    expect(done.votes.quorumFirst.secondWave.map((s) => [s.id, s.reasons])).toEqual([...drawn].sort().map((id) => [id, ['missing']]));
  });

  test('a verifier that returns but gives NO entry for one candidate: that candidate alone draws the rest, and it is settled on a majority with the silent verifier named', async () => {
    const h = harness({ policyJson: QUORUM });
    const v1 = await toVerify(h);
    const [silent] = holders(v1.agents).get('f3');
    vote(v1.agents, (name, id) => (name === silent && id === 'f3' ? null : 'real'));
    const v2 = await h.collect();
    expect(v2).toMatchObject({ status: 'DISPATCH', round: 'verify', quorumFirst: { secondWave: true } });
    expect(v2.agents).toEqual([expect.objectContaining({ name: 'verifier-5', candidateIds: ['f3'], secondWave: true })]);
    vote(v2.agents);
    const done = await h.collect();
    expect(done.votes.outcomes.find((o) => o.id === 'f3')).toMatchObject({ outcome: 'present', settledOnMajority: true, missing: [silent] });
    expect(done.votes.outcomes.filter((o) => o.quorumSettled === true)).toHaveLength(5);
    expect(done.votes.verification).toBe('partial');
  });

  test('a first-wave vote the tally would not count (a verdict word that is no verdict) is missing too: the rest is dispatched', async () => {
    const h = harness({ policyJson: QUORUM });
    const v1 = await toVerify(h);
    const [odd] = holders(v1.agents).get('f4');
    for (const agent of v1.agents) {
      if (agent.name !== odd) {
        vote([agent]);
        continue;
      }
      writeResult(agent, { votes: agent.candidateIds.map((id) => ({ candidateId: id, verdict: id === 'f4' ? 'yes' : 'real', evidence: 'checked' })) });
    }
    // the collector refuses a file with a verdict outside real / not-real / abstain: the verifier is then not arrived, which is the same
    const v2 = await h.collect({ now: v1.agents.find((a) => a.name === odd).deadlineAt + 1000 });
    expect(v2).toMatchObject({ status: 'DISPATCH', round: 'verify', quorumFirst: { secondWave: true } });
    expect(v2.agents[0].candidateIds).toEqual(expect.arrayContaining(['f4']));
  });
});

describe('quorum-first verification: the second wave joins the verify queue, under the cap', () => {
  test('at a cap of 2 the verifier the first wave needs next waits behind the second wave\'s, no dispatch ever holds more than the cap, and the run still ends DONE with the same outcomes as the full electorate', async () => {
    const h = harness({ policyJson: { quorumFirstVerification: true, maxConcurrentAgents: 2 } });
    const v1 = await toVerify(h);
    expect(v1).toMatchObject({ status: 'DISPATCH', round: 'verify', wave: '1 of 2', maxConcurrentAgents: 2 });
    expect(v1.agents.map((a) => a.name)).toEqual(['verifier-1', 'verifier-2']);

    // verifier-1 and verifier-2 hold the same three candidates: one of them dissents on the first
    const [dissenter] = v1.agents;
    const target = dissenter.candidateIds[0];
    vote(v1.agents, (name, id) => (name === dissenter.name && id === target ? 'not-real' : 'real'));
    const v2 = await h.collect();
    // the second-wave verifier is at the HEAD of the queue: it is dispatched before verifier-3, which the first wave still needs
    expect(v2).toMatchObject({ status: 'DISPATCH', round: 'verify', wave: '2 (rolling)', quorumFirst: { secondWave: true } });
    expect(v2.agents.map((a) => a.name)).toEqual(['verifier-5', 'verifier-3']);
    expect(v2.agents[0]).toMatchObject({ secondWave: true, candidateIds: [target] });
    expect(v2.agents[1].secondWave).toBeUndefined();
    expect(v2.agents.length).toBeLessThanOrEqual(2);

    vote(v2.agents);
    const v3 = await h.collect();
    expect(v3).toMatchObject({ status: 'DISPATCH', round: 'verify', wave: '3 (rolling)' });
    expect(v3.agents.map((a) => a.name)).toEqual(['verifier-4']);
    expect(v3.quorumFirst.secondWave).toBe(false);
    vote(v3.agents);
    const done = await h.collect();
    expect(done.status).toBe('DONE');
    expect(done.votes.outcomes.filter((o) => o.quorumSettled === true)).toHaveLength(5);
    expect(done.votes.outcomes.find((o) => o.id === target)).toMatchObject({ outcome: 'present', tally: { real: 2, notReal: 1, expected: 3 } });
    expect(done.metrics).toMatchObject({ agentsByRole: { verifier: 5 } });
    const run = h.readRun();
    expect(run.waves.filter((w) => w.round === 'verify').map((w) => [w.wave, w.of, w.status, w.agents.length])).toEqual([[1, 2, 'collected', 2], [2, null, 'collected', 2], [3, null, 'collected', 1]]);
  });

  test('a second wave planned while first-wave verifiers still run is dispatched into the free slots as a REFILL: the cap counts both, the first wave keeps running', async () => {
    // eight candidates at a cap of 4: six first-wave verifiers; wave 1 is verifier-1 .. verifier-4, and the rolling refill starts verifier-5 and verifier-6
    const EIGHT = (name) => (name === 'reviewer-s1-a' ? [0, 1, 2, 3, 4, 5, 6, 7].map((i) => finding({ locationOrLink: `src/a.js:${i + 1}`, failureMode: `distinct defect number ${i} in a different subsystem ${'x'.repeat(i)}` })) : []);
    const h = harness({ policyJson: { quorumFirstVerification: true, maxConcurrentAgents: 4 } });
    const v1 = await toVerify(h, EIGHT);
    expect(v1).toMatchObject({ wave: '1 of 2', maxConcurrentAgents: 4 });
    expect(v1.agents.map((a) => a.name)).toEqual(['verifier-1', 'verifier-2', 'verifier-3', 'verifier-4']);
    vote([v1.agents[0]]);
    const r1 = await h.collect();
    expect(r1).toMatchObject({ status: 'DISPATCH', refill: true, wave: '2 (rolling)' });
    expect(r1.agents.map((a) => a.name)).toEqual(['verifier-5']);
    vote([v1.agents[1]]);
    const r2 = await h.collect();
    expect(r2).toMatchObject({ status: 'DISPATCH', refill: true, wave: '3 (rolling)' });
    expect(r2.agents.map((a) => a.name)).toEqual(['verifier-6']);

    // the two refilled verifiers hold a candidate of their own (f3 and f6 are asked of verifier-5 and verifier-6 only): verifier-5 dissents on it,
    // verifier-6 agrees; verifier-3 and verifier-4 are still running
    const shared = r1.agents[0].candidateIds.filter((id) => r2.agents[0].candidateIds.includes(id));
    expect(shared.length).toBeGreaterThan(0);
    vote([r1.agents[0]], (name, id) => (id === shared[0] ? 'not-real' : 'real'));
    vote([r2.agents[0]]);
    const refill = await h.collect();
    expect(refill).toMatchObject({ status: 'DISPATCH', round: 'verify', refill: true, quorumFirst: { secondWave: true } });
    expect(refill.agents).toEqual([expect.objectContaining({ name: 'verifier-7', secondWave: true, candidateIds: [shared[0]] })]);
    expect(refill.stillRunning).toEqual(['verifier-3', 'verifier-4']);
    expect(refill.stillRunning.length + refill.agents.length).toBeLessThanOrEqual(4);
    expect(refill.agents[0].deadlineAt - refill.agents[0].dispatchedAt).toBe(MIN_VERIFIER_MINUTES * 60 * 1000);

    vote([...v1.agents.slice(2)]);
    vote(refill.agents);
    const done = await h.collect();
    expect(done.status).toBe('DONE');
    expect(done.votes.outcomes).toHaveLength(8);
    expect(done.votes.outcomes.find((o) => o.id === shared[0])).toMatchObject({ outcome: 'present', tally: { real: 2, notReal: 1 } });
    expect(done.votes.outcomes.filter((o) => o.quorumSettled === true)).toHaveLength(7);
  });
});

describe('quorum-first verification: fail closed to the whole electorate', () => {
  test('a candidate that is no finding (kind: style) is filtered whatever the votes say, so the round asks everyone: the whole electorate, no quorum-first mark, the notice says why', async () => {
    const h = harness({ policyJson: QUORUM });
    const v1 = await toVerify(h, (name) => (name === 'reviewer-s1-a' ? [finding({ locationOrLink: 'src/a.js:1', failureMode: 'the module name is not capitalised' , kind: 'style' }), finding({ locationOrLink: 'src/a.js:2', failureMode: 'distinct defect two in another subsystem' })] : []));
    expect(v1.agents).toHaveLength(3);
    expect(v1.quorumFirst).toBeUndefined();
    for (const names of holders(v1.agents).values()) expect(new Set(names).size).toBe(3);
    expect(h.readRun().quorum).toMatchObject({ requested: true, applied: false, reason: expect.stringMatching(/no finding/) });
    vote(v1.agents);
    const done = await h.collect();
    expect(done.votes.quorumFirst).toMatchObject({ applied: false });
    expect(done.reducedReview).toMatch(/QUORUM-FIRST verification was asked for .* NOT applied/);
    expect(done.votes.outcomes.every((o) => o.quorumSettled === undefined && o.tally.real === 3)).toBe(true);
  });

  test('a candidate whose second wave cannot be briefed is never read as settled: it stays unverified with the seats it never asked named, and the round is partial', async () => {
    // the verifier brief renders every claim once to plan the round, then once more for the second wave: the second render of f2's claim is refused
    const seen = new Map();
    const h = harness({
      policyJson: QUORUM,
      overrides: {
        renderBrief: (role, vars) => {
          if (role === 'verifier') {
            const count = (seen.get(vars.claim) || 0) + 1;
            seen.set(vars.claim, count);
            if (vars.location === 'src/a.js:2' && count > 1) throw new Error('refused on the second render');
          }
          return renderBriefFromFiles(role, vars);
        },
      },
    });
    const v1 = await toVerify(h);
    const [dissenter] = holders(v1.agents).get('f2');
    vote(v1.agents, (name, id) => (name === dissenter && id === 'f2' ? 'abstain' : 'real'));
    // nothing can be dispatched for f2: the round goes on to its verdict
    const done = await h.collect();
    expect(done.status).toBe('DONE');
    expect(h.readRun().quorum.skipped).toEqual([expect.objectContaining({ id: 'f2', reason: expect.stringMatching(/^second-wave-unbriefable/) })]);
    const f2 = done.votes.outcomes.find((o) => o.id === 'f2');
    expect(f2).toMatchObject({ outcome: 'unverified', reason: 'verifier-incomplete' });
    expect(f2.quorumSettled).toBeUndefined();
    expect(done.ledger.find((e) => e.id === 'f2').verification.incompleteVerifiers).toEqual([{ verifier: '(not-asked)', reason: 'not-asked', missing: 1 }]);
    expect(done.votes.verification).toBe('partial');
    expect(done.votes.outcomes.filter((o) => o.quorumSettled === true)).toHaveLength(5);
    expect(done.reducedReview).toMatch(/the rest of the electorate could not be asked for f2/);
  });
});
