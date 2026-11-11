'use strict';

/**
 * Quorum-first verification through the REAL review-run CLI process (kata 3ezq, acceptance criterion 5; plan v2 section 3 O3a and
 * section 5 child V2-3; owner decision D4).
 *
 * What is real: git (an origin, a clone, a base commit, a feature branch, a second commit on it, a High branch), the CLI process, prepare,
 * the result-file collector, the state report and the run files. What is faked: `gh`, by an executable stub first on PATH, and the
 * "agents", which are this test writing `out-<agent>.json` files exactly as dispatched agents would.
 *
 * The policy is read from the BASE commit's REVIEW.md, so there are three fixtures that differ in that block alone: the key ON, the key
 * ABSENT and the key explicitly false. Every scenario that says "unchanged" is compared with the key-off arm of the SAME fixture shape.
 *
 * Fixtures live under ~/.omp/pr-review-speedup/3ezq/fixtures (never /tmp) and are removed afterwards.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const { MIN_VERIFIER_MINUTES } = require('../lib/pr-review-sizing');

jest.setTimeout(240000);

const CLI = path.join(__dirname, '..', 'lib', 'review-run-cli.js');
const FIXTURES = path.join(os.homedir(), '.omp', 'pr-review-speedup', '3ezq', 'fixtures');
const BODY = '## Testing\nran the relevant tests\n\n## Risk\nlow\n\n## How to revert\nrevert the commit\n';
const SEVERITY = '## Severity\n\n- **Important** \u2014 fixture-important: the change is wrong.\n- **Nit** \u2014 fixture-nit: a preference.\n- **Pre-existing** \u2014 fixture-pre: not this PR.\n\n';
const policyText = (keyJson) => `# Review\n\n${SEVERITY}\`\`\`ensemble-review-policy\n{"sensitivePaths":["secure/**"],"highPaths":["wide/**"],"reviewerToolCalls":57,"reviewerSnippets":2${keyJson}}\n\`\`\`\n`;
const MINUTE = 60 * 1000;

const GH_STUB = `#!/usr/bin/env node
const fs = require('fs');
const cp = require('child_process');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.STUB_GH_LOG, JSON.stringify(args) + '\\n');
const state = JSON.parse(fs.readFileSync(process.env.STUB_GH_STATE, 'utf8'));
const out = (value) => { process.stdout.write(JSON.stringify(value)); process.exit(0); };
const fail = (stderr, stdout) => { process.stderr.write(stderr); if (stdout) process.stdout.write(stdout); process.exit(1); };
const joined = args.join(' ');
if (args[0] === 'pr' && args[1] === 'view') {
  out({ headRefOid: state.head, baseRefName: state.baseRefName || 'main', state: state.prState || 'OPEN', body: state.body, author: { login: 'alice' }, isCrossRepository: false });
}
if (args[0] !== 'api') fail('unexpected gh call: ' + joined);
if (args[1] === 'user') out({ login: 'maintainer' });
if (/\\/pulls\\/\\d+\\/reviews/.test(joined)) out([state.reviews || []]);
if (/\\/git\\/commits\\/[0-9a-f]{40}$/.test(joined)) {
  const sha = args[args.length - 1].split('/').pop();
  out({ tree: { sha: cp.execFileSync('git', ['rev-parse', sha + '^{tree}'], { encoding: 'utf8' }).trim() } });
}
if (/\\/branches\\/main\\/protection/.test(joined)) fail('gh: Not Found (HTTP 404)', JSON.stringify({ message: 'Branch not protected' }));
if (/\\/commits\\/[0-9a-f]{40}\\/statuses/.test(joined)) out([[]]);
if (/\\/issues\\/\\d+\\/comments/.test(joined)) {
  if (args.includes('-X')) out({ id: 99, html_url: 'https://example.invalid/c/99' });
  out([[]]);
}
fail('unexpected gh call: ' + joined);
`;

const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8' }).trim();
const write = (cwd, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
  fs.writeFileSync(path.join(cwd, rel), text);
};

/** One fixture per policy: origin + clone, `main` (base, with the policy), `feature` (H1), `feature2` (H2: one more commit, src/b.js only), `high` (a sensitive path). */
function buildFixture(name, keyJson) {
  fs.mkdirSync(FIXTURES, { recursive: true });
  const root = fs.mkdtempSync(path.join(FIXTURES, `${name}-`));
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), GH_STUB, { mode: 0o755 });
  git(root, 'init', '--bare', '-b', 'main', origin);
  git(root, 'init', '-b', 'main', work);
  git(work, 'remote', 'add', 'origin', origin);
  write(work, 'README.md', '# fixture\n');
  write(work, 'REVIEW.md', policyText(keyJson));
  write(work, 'src/a.js', 'module.exports = (list) => list.map((x) => x + 1);\n');
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'base');
  git(work, 'push', '-q', 'origin', 'main');
  git(work, 'checkout', '-q', '-b', 'high');
  write(work, 'secure/key.js', 'module.exports = "k";\n');
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'touch a sensitive path');
  git(work, 'checkout', '-q', 'main');
  git(work, 'checkout', '-q', '-b', 'feature');
  write(work, 'src/a.js', 'module.exports = (list) => list.map((x, i) => list[i + 1] + x);\n');
  write(work, 'src/b.js', 'module.exports = () => 1;\n');
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'feature');
  git(work, 'checkout', '-q', '-b', 'feature2');
  write(work, 'src/b.js', 'module.exports = () => 2;\n');
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'a second commit that leaves src/a.js alone');
  git(work, 'checkout', '-q', 'feature');
  fs.appendFileSync(path.join(work, '.git', 'info', 'exclude'), '.ensemble/\n');
  return { name, root, origin, work, bin, head: git(work, 'rev-parse', 'feature'), head2: git(work, 'rev-parse', 'feature2'), high: git(work, 'rev-parse', 'high'), stateFile: path.join(root, 'gh-state.json'), logFile: path.join(root, 'gh.log') };
}

const FX = {};
let fx;

beforeAll(() => {
  FX.on = buildFixture('on', ',"quorumFirstVerification":true');
  FX.absent = buildFixture('absent', '');
  FX.false = buildFixture('false', ',"quorumFirstVerification":false');
});
afterAll(() => {
  for (const f of Object.values(FX)) {
    // prepare seals the snapshot read-only; make it removable first
    spawnSync('chmod', ['-R', 'u+w', f.root]);
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

const setGh = (over = {}) => fs.writeFileSync(fx.stateFile, JSON.stringify({ head: fx.head, body: BODY, reviews: [], ...over }));
/** Selects the fixture the helpers below talk to, with a fresh stub state and log. */
function use(name) {
  fx = FX[name];
  setGh();
  fs.writeFileSync(fx.logFile, '');
}

const cliEnv = () => ({ ...process.env, PATH: `${fx.bin}${path.delimiter}${process.env.PATH}`, STUB_GH_STATE: fx.stateFile, STUB_GH_LOG: fx.logFile, GIT_CONFIG_GLOBAL: '/dev/null' });

/** Runs the real CLI process: `{code, out, stdout}` with stdout parsed as the one JSON object. */
function cli(command, payload) {
  const r = spawnSync(process.execPath, [CLI, command], { input: JSON.stringify(payload), env: cliEnv(), encoding: 'utf8', cwd: fx.root, timeout: 180000 });
  let out;
  try {
    out = JSON.parse(r.stdout);
  } catch (error) {
    out = { unparsable: r.stdout, stderr: r.stderr, parseError: error.message };
  }
  return { code: r.status, out, stdout: r.stdout, stderr: r.stderr };
}
const prep = (extra = {}) => cli('prepare', { repo: 'o/r', pr: 7, repoRoot: fx.work, agentAuthored: false, ...extra });
const coll = (runId, extra = {}) => cli('collect', { repoRoot: fx.work, runId, ...extra });
const runDir = (runId) => path.join(fx.work, '.ensemble', 'pr-review', 'run', runId);
const stateFilePath = () => path.join(fx.work, '.ensemble', 'pr-review', 'pr-7.json');
const stateOnDisk = () => JSON.parse(fs.readFileSync(stateFilePath(), 'utf8'));
const runFile = (runId) => JSON.parse(fs.readFileSync(path.join(runDir(runId), 'run.json'), 'utf8'));

const writeResult = (agent, object) => {
  fs.mkdirSync(path.dirname(agent.outPath), { recursive: true });
  const temp = `${agent.outPath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(object));
  fs.renameSync(temp, agent.outPath);
};
const reviewerFinding = (over = {}) => ({ locationOrLink: 'src/a.js:1', severity: 'important', failureMode: 'list[i + 1] reads one past the end on the last element', disposition: 'fix', evidence: 'src/a.js line 1 indexes list[list.length]', originalTextOrLink: 'src/a.js:1', ...over });

/** Every reviewer covers its paths, the lane covers every changed path. */
function answerReview(manifest, { findings = {}, changed = ['src/a.js', 'src/b.js'] } = {}) {
  for (const agent of manifest.agents) {
    if (agent.role === 'reviewer') writeResult(agent, { findings: findings[agent.name] || [], pathsReviewed: agent.paths });
    else writeResult(agent, { findings: findings[agent.name] || [], pathsReviewed: changed });
  }
}
/** One agent's votes: `[[candidateId, verdict], ...]`. */
const vote = (agent, entries) => writeResult(agent, { votes: entries.map(([candidateId, verdict]) => ({ candidateId, verdict, evidence: 'read it' })) });
/** Every listed agent votes `verdictFor(agentName, candidateId)` on each candidate it holds (a verdict word; `null` is NO entry). */
const voteAll = (agents, verdictFor = () => 'real') => {
  for (const agent of agents) vote(agent, agent.candidateIds.map((id) => [id, verdictFor(agent.name, id)]).filter(([, verdict]) => verdict !== null));
};
/** Time passes: the named agents were dispatched `minutes` ago, their deadlines with them. */
function age(runId, names, minutes) {
  const file = path.join(runDir(runId), 'run.json');
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const wave of stored.waves) {
    for (const agent of wave.agents) {
      if (!names.includes(agent.name)) continue;
      agent.dispatchedAt -= minutes * MINUTE;
      agent.deadlineAt -= minutes * MINUTE;
    }
  }
  fs.writeFileSync(file, JSON.stringify(stored));
}

const snapshotRepo = () => ({
  status: git(fx.work, 'status', '--porcelain'),
  head: git(fx.work, 'rev-parse', 'HEAD'),
  branch: git(fx.work, 'rev-parse', '--abbrev-ref', 'HEAD'),
  refs: git(fx.work, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads'),
  originRefs: git(fx.root, '--git-dir', fx.origin, 'for-each-ref', '--format=%(refname) %(objectname)'),
  tracked: git(fx.work, 'ls-files', '-s'),
});

/**
 * A copy of `value` with what legitimately differs between two fixtures and two runs replaced: the fixture root path, the run id, every
 * 40-hex sha (the base commits differ because REVIEW.md does), ISO timestamps and every number under a key ending in `At`, `Ms`
 * or `Millis` (clock readings and durations).
 */
function norm(value, runId) {
  let text = JSON.stringify(value);
  text = text.split(fx.root).join('<ROOT>').split(runId).join('<RUN>').replace(/\b[0-9a-f]{40}\b/g, '<SHA>').replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '<ISO>');
  return JSON.parse(text, (key, v) => (typeof v === 'number' && /(At|Ms|Millis)$/.test(key) ? 0 : v));
}

const CLAIMS = [
  ['src/a.js:1', 'the loop reads one past the end of the list'],
  ['src/b.js:1', 'the cache key ignores the tenant so entries leak'],
  ['src/a.js:1', 'the retry never backs off and hammers the host'],
];
const IDS = ['f1', 'f2', 'f3'];
const claimFindings = (claims = CLAIMS) => claims.map(([location, failureMode]) => reviewerFinding({ locationOrLink: location, originalTextOrLink: location, failureMode, evidence: `read ${failureMode}` }));

/** prepare -> the reviewers' three findings -> collect: the verify DISPATCH on the selected fixture. */
function verifyRound(runId, { findings = claimFindings(), head } = {}) {
  fs.rmSync(stateFilePath(), { force: true });
  if (head) setGh({ head });
  const review = prep({ runId });
  expect(review.code).toBe(0);
  expect(review.out).toMatchObject({ ok: true, status: 'DISPATCH' });
  answerReview(review.out, { findings: { 'reviewer-s1-a': findings } });
  const verify = coll(runId);
  expect(verify.code).toBe(0);
  expect(verify.stdout.trim().split('\n')).toHaveLength(1);
  expect(verify.out).toMatchObject({ ok: true, status: 'DISPATCH', round: 'verify' });
  return verify.out;
}
const holds = (manifest) => manifest.agents.map((a) => [a.name, a.candidateIds.join()]);
const outcomesOf = (answer) => answer.votes.outcomes.map((o) => [o.id, o.outcome, o.reason]);
const byId = (answer) => Object.fromEntries(answer.votes.outcomes.map((o) => [o.id, o]));
const WHAT_ONLY_QUORUM_WRITES = /quorumSettled|unaskedVerifiers|not-asked|quorum-settled/;
const smoke = (label, data) => process.stderr.write(`\nSMOKE ${label}: ${JSON.stringify(data)}\n`);

/** The key-off arm every test compares with: all three verifiers vote `verdictFor` (default: real). */
function offArm(name, runId, { verdictFor = () => 'real', findings, head } = {}) {
  use(name);
  const verify = verifyRound(runId, { findings, head });
  voteAll(verify.agents, verdictFor);
  const done = coll(runId);
  expect(done.code).toBe(0);
  return { verify, done: done.out, state: stateOnDisk(), root: fx.root };
}

describe('kata 3ezq: quorum-first verification through the real process', () => {
  test('1. KEY OFF (absent, and explicitly false): today\'s dispatch (verifier-1..3, each f1,f2,f3), every vote real is DONE and performed, nothing of the mode is written anywhere, the two arms are identical', () => {
    const arms = {};
    for (const [name, runId] of [['absent', 'q1-absent'], ['false', 'q1-false']]) {
      use(name);
      const before = snapshotRepo();
      const verify = verifyRound(runId);
      expect(holds(verify)).toEqual([['verifier-1', 'f1,f2,f3'], ['verifier-2', 'f1,f2,f3'], ['verifier-3', 'f1,f2,f3']]);
      expect(verify.agents.some((a) => a.secondWave !== undefined)).toBe(false);
      expect(verify.quorumFirst).toBeUndefined();
      // the key is a policy of the orchestrator: no dispatched agent is told about it, in the prompt or in the brief
      for (const agent of verify.agents) {
        expect(agent.prompt).not.toMatch(/quorum/i);
        expect(fs.readFileSync(agent.briefPath, 'utf8')).not.toMatch(/quorum/i);
      }
      voteAll(verify.agents);
      const done = coll(runId);
      expect(done.code).toBe(0);
      expect(done.stdout.trim().split('\n')).toHaveLength(1);
      expect(done.out).toMatchObject({ ok: true, status: 'DONE', votes: { verification: 'performed' } });
      expect(outcomesOf(done.out)).toEqual(IDS.map((id) => [id, 'present', 'verifier-majority']));
      for (const o of done.out.votes.outcomes) {
        expect(o.tally).toMatchObject({ real: 3, notReal: 0, expected: 3, needed: 2 });
        expect(o.quorumSettled).toBeUndefined();
        expect(o.unaskedVerifiers).toBeUndefined();
      }
      expect(done.out.notReviewed.incompleteVerifiers).toEqual([]);
      const state = stateOnDisk();
      expect(state.ledger.map((entry) => entry.verification.reason)).toEqual(['verifier-majority', 'verifier-majority', 'verifier-majority']);
      expect(state.verdicts.map((verdict) => verdict.id)).toEqual(IDS); // recorded, so a later round may carry them
      // not in the answer, the ledger, the state file on disk, the reduced review, or the run file
      for (const text of [JSON.stringify(done.out), JSON.stringify(state), done.out.reducedReview, JSON.stringify(runFile(runId).assignment)]) expect(text).not.toMatch(WHAT_ONLY_QUORUM_WRITES);
      expect(done.out.reducedReview).not.toMatch(/QUORUM-FIRST/);
      expect(runFile(runId).quorum).toBeUndefined();
      expect(snapshotRepo()).toEqual(before);
      arms[name] = { verify, done: done.out, state, root: fx.root, runId };
    }
    // the same run with the key absent and with the key false: identical but for what differs by fixture and clock (see `norm`)
    use('absent');
    const a = { verify: norm(arms.absent.verify, 'q1-absent'), done: norm(arms.absent.done, 'q1-absent') };
    use('false');
    const f = { verify: norm(arms.false.verify, 'q1-false'), done: norm(arms.false.done, 'q1-false') };
    expect(f.verify).toEqual(a.verify);
    expect(f.done).toEqual(a.done);
    smoke('1 key off', { verifiersAbsent: arms.absent.verify.agents.length, verifiersFalse: arms.false.verify.agents.length, outcomes: outcomesOf(arms.absent.done), verification: arms.absent.done.votes.verification });
  });

  test('2. KEY ON, everyone agrees: 2 verifiers (not 3), DONE in one collect after the verify wave, the key-off outcomes, every candidate quorum-settled, never partial, never carried', () => {
    const off = offArm('absent', 'q2-off');
    use('on');
    const before = snapshotRepo();
    const verify = verifyRound('q2-on');
    expect(holds(verify)).toEqual([['verifier-1', 'f1,f2,f3'], ['verifier-2', 'f1,f2,f3']]);
    expect(verify.agents.some((a) => a.secondWave !== undefined)).toBe(false);
    expect(verify.quorumFirst).toMatchObject({ expected: 3, needed: 2, secondWave: false });
    expect(verify.agents.length).toBe(off.verify.agents.length - 1);
    // the rest of the verify round's manifest has the shape of the key-off one: only the agents and the note about the mode differ
    const strip = ({ agents, quorumFirst, metrics, ...rest }) => rest;
    expect(Object.keys(verify).sort()).toEqual(expect.arrayContaining(Object.keys(strip(off.verify))));
    for (const key of Object.keys(strip(off.verify))) expect({ key, kind: typeof verify[key] }).toEqual({ key, kind: typeof off.verify[key] });
    expect(verify).toMatchObject({ round: 'verify', wave: '1 of 1', depth: { mode: 'standard', verifiersPerCandidate: 3 }, mode: { mode: 'light' } });
    voteAll(verify.agents);
    const done = coll('q2-on');
    expect(done.code).toBe(0);
    expect(done.stdout.trim().split('\n')).toHaveLength(1);
    expect(done.out).toMatchObject({ ok: true, status: 'DONE', votes: { verification: 'performed' } });
    expect(done.out.votes.reason).toBeUndefined();
    expect(done.out.votes.recoveryAction).toBeUndefined();
    expect(done.out.votes.quorumFirst).toMatchObject({ applied: true, expected: 3, needed: 2, settled: IDS, secondWave: [] });
    // the same outcome per candidate as with the whole electorate
    expect(outcomesOf(done.out)).toEqual(outcomesOf(off.done));
    expect(outcomesOf(done.out)).toEqual(IDS.map((id) => [id, 'present', 'verifier-majority']));
    for (const o of done.out.votes.outcomes) {
      expect(o).toMatchObject({ quorumSettled: true, unaskedVerifiers: 1, tally: { real: 2, notReal: 0, expected: 3, needed: 2 } });
      expect(o.settledOnMajority).toBeUndefined();
      expect(o.missing).toBeUndefined();
    }
    // not a lost verifier: nobody that was asked is missing, and the round is not partial
    expect(done.out.notReviewed.incompleteVerifiers).toEqual([]);
    expect(done.out.notReviewed.expiredAgents).toEqual([]);
    for (const entry of done.out.ledger) expect(entry.verification).toMatchObject({ outcome: 'present', reason: 'verifier-majority', quorumSettled: true, unaskedVerifiers: 1, incompleteVerifiers: [] });
    // the gate reads it as it reads a fully voted candidate
    expect(done.out.gate.mergeable).toBe(off.done.gate.mergeable);
    expect(done.out.gate.blockers.map((b) => b.code)).toEqual(off.done.gate.blockers.map((b) => b.code));
    expect(done.out.gate.findings).toEqual(off.done.gate.findings);
    expect(done.out.status).toBe(off.done.status);
    // the report names the mode
    expect(done.out.reducedReview).toMatch(/QUORUM-FIRST verification \(policy quorumFirstVerification; the electorate stays 3 and the vote rule is unchanged\)/);
    expect(done.out.reducedReview).toMatch(/Settled by their first 2 real votes: f1, f2, f3 /);
    expect(done.out.reducedReview).not.toMatch(/SETTLED ON A MAJORITY|verification partial/);
    // the state file on disk: marked, and (owner decision D4) no verdict recorded for a carry, where the key-off arm records f1, f2, f3
    const state = stateOnDisk();
    expect(state.ledger.map((entry) => [entry.id, entry.verification.quorumSettled])).toEqual(IDS.map((id) => [id, true]));
    expect(state.verdicts).toEqual([]);
    expect(off.state.verdicts.map((verdict) => verdict.id)).toEqual(IDS);
    expect(state.carry).toMatchObject({ recorded: 0 });
    expect(state.carry.skipped.map((s) => [s.id, s.reason])).toEqual(IDS.map((id) => [id, 'quorum-settled']));
    expect(state.verification).toMatchObject({ verification: 'performed', quorumFirst: { applied: true, settled: IDS } });
    expect(done.out.metrics.agentsByRole.verifier).toBe(2);
    expect(off.done.metrics.agentsByRole.verifier).toBe(3);
    expect(snapshotRepo()).toEqual(before);
    smoke('2 everyone agrees', { verifiersOff: off.verify.agents.length, verifiersOn: verify.agents.length, collectsAfterVerify: 1, outcomes: outcomesOf(done.out), quorumSettled: done.out.votes.outcomes.map((o) => o.quorumSettled) });
  });

  describe('3. a dissenting, abstaining first vote draws the rest of the electorate', () => {
    const SECOND = (runId, verdict) => {
      use('on');
      const before = snapshotRepo();
      const verify = verifyRound(runId);
      expect(holds(verify)).toEqual([['verifier-1', 'f1,f2,f3'], ['verifier-2', 'f1,f2,f3']]);
      voteAll(verify.agents, (name, id) => (name === 'verifier-1' && id === 'f2' ? verdict : 'real'));
      const second = coll(runId);
      expect(second.code).toBe(0);
      expect(second.stdout.trim().split('\n')).toHaveLength(1);
      // ONE fresh agent for f2 alone: f1 and f3 wait settled
      expect(second.out).toMatchObject({ ok: true, status: 'DISPATCH', round: 'verify', quorumFirst: { expected: 3, needed: 2, secondWave: true } });
      expect(holds(second.out)).toEqual([['verifier-3', 'f2']]);
      expect(second.out.agents[0].secondWave).toBe(true);
      expect(second.out.agents[0].deadlineAt - second.out.agents[0].dispatchedAt).toBeGreaterThanOrEqual(MIN_VERIFIER_MINUTES * MINUTE);
      expect(second.out.agents[0].name).not.toBe('verifier-1');
      return { verify, second: second.out, before };
    };

    test.each([['not-real'], ['abstain']])('a first %s vote on f2: verifier-3 holds f2 alone; real from it makes f2 present on 2 real of 3 (full electorate, NOT quorum-settled), f1 and f3 stay quorum-settled, every outcome equals the key-off arm with the same three votes', (verdict) => {
      const runId = `q3-${verdict}`;
      const off = offArm('absent', `${runId}-off`, { verdictFor: (name, id) => (name === 'verifier-1' && id === 'f2' ? verdict : 'real') });
      const { second, before } = SECOND(runId, verdict);
      expect(second.agents.length).toBe(1);
      vote(second.agents[0], [['f2', 'real']]);
      const done = coll(runId);
      expect(done.code).toBe(0);
      expect(done.out).toMatchObject({ ok: true, status: 'DONE', votes: { verification: 'performed' } });
      const o = byId(done.out);
      expect(o.f2).toMatchObject({ outcome: 'present', reason: 'verifier-majority', tally: { real: 2, expected: 3, needed: 2, ...(verdict === 'not-real' ? { notReal: 1 } : { abstain: 1 }) } });
      expect(o.f2.quorumSettled).toBeUndefined();
      expect(o.f2.unaskedVerifiers).toBeUndefined();
      for (const id of ['f1', 'f3']) expect(o[id]).toMatchObject({ outcome: 'present', reason: 'verifier-majority', quorumSettled: true, unaskedVerifiers: 1, tally: { real: 2, expected: 3 } });
      expect(done.out.votes.quorumFirst).toMatchObject({ applied: true, settled: ['f1', 'f3'] });
      expect(done.out.votes.quorumFirst.secondWave.map((s) => [s.id, s.reasons])).toEqual([['f2', [verdict]]]);
      expect(done.out.notReviewed.incompleteVerifiers).toEqual([]);
      // the final outcome of every candidate is the key-off arm's, and so is the gate
      expect(outcomesOf(done.out)).toEqual(outcomesOf(off.done));
      expect(done.out.gate.mergeable).toBe(off.done.gate.mergeable);
      expect(done.out.gate.findings).toEqual(off.done.gate.findings);
      // f2 was decided by a full electorate, so it is a verdict a later round may carry; f1 and f3 are not
      expect(stateOnDisk().verdicts.map((v) => v.id)).toEqual(['f2']);
      expect(snapshotRepo()).toEqual(before);
      smoke(`3 first ${verdict}`, { verifiersOff: off.verify.agents.length, verifiersOnFirstWave: 2, secondWave: 1, outcomes: outcomesOf(done.out) });
    });

    test('the second-wave verifier votes f2 not-real too: f2 is filtered, verifier-majority-not-reached, equal to the key-off arm with the same three votes', () => {
      const votes = (name, id) => (id === 'f2' && name !== 'verifier-2' ? 'not-real' : 'real');
      const off = offArm('absent', 'q3-nr-off', { verdictFor: votes });
      const { second, before } = SECOND('q3-nr', 'not-real');
      vote(second.agents[0], [['f2', 'not-real']]);
      const done = coll('q3-nr');
      expect(done.code).toBe(0);
      expect(done.out.status).toBe('DONE');
      const o = byId(done.out);
      expect(o.f2).toMatchObject({ outcome: 'filtered', reason: 'verifier-majority-not-reached', tally: { real: 1, notReal: 2, expected: 3 } });
      expect(o.f2.quorumSettled).toBeUndefined();
      expect(o.f1.quorumSettled).toBe(true);
      expect(o.f3.quorumSettled).toBe(true);
      expect(outcomesOf(done.out)).toEqual(outcomesOf(off.done));
      expect(outcomesOf(done.out)).toEqual([['f1', 'present', 'verifier-majority'], ['f2', 'filtered', 'verifier-majority-not-reached'], ['f3', 'present', 'verifier-majority']]);
      expect(done.out.gate.findings).toEqual(off.done.gate.findings);
      expect(done.out.gate.mergeable).toBe(off.done.gate.mergeable);
      expect(snapshotRepo()).toEqual(before);
      smoke('3 second not-real', { verifiersOff: off.verify.agents.length, verifiersOn: 3, outcomes: outcomesOf(done.out) });
    });
  });

  test('4. a MISSING first vote draws the rest: verifier-2 never writes, verifier-3 (second wave) holds what it held, the round is partial, the settled-on-majority candidates name verifier-2, the lost one is named', () => {
    use('on');
    const before = snapshotRepo();
    const verify = verifyRound('q4');
    const [v1, v2] = verify.agents;
    voteAll([v1]);
    age('q4', [v2.name], MIN_VERIFIER_MINUTES + 1); // verifier-2 is past its deadline, and its deadline is never under the floor
    const second = coll('q4');
    expect(second.code).toBe(0);
    expect(second.out).toMatchObject({ ok: true, status: 'DISPATCH', round: 'verify', quorumFirst: { secondWave: true } });
    expect(holds(second.out)).toEqual([['verifier-3', 'f1,f2,f3']]);
    const [v3] = second.out.agents;
    expect(v3.secondWave).toBe(true);
    expect(v3.deadlineAt - v3.dispatchedAt).toBeGreaterThanOrEqual(MIN_VERIFIER_MINUTES * MINUTE);
    expect(v3.deadlineAt).toBeGreaterThan(Date.now());
    voteAll([v3]);
    const done = coll('q4');
    expect(done.code).toBe(0);
    expect(done.out.status).toBe('DONE');
    for (const o of done.out.votes.outcomes) {
      expect(o).toMatchObject({ outcome: 'present', reason: 'verifier-majority', settledOnMajority: true, missing: ['verifier-2'], tally: { real: 2, expected: 3 } });
      expect(o.quorumSettled).toBeUndefined();
    }
    expect(done.out.votes).toMatchObject({ verification: 'partial', reason: 'some-verifiers-did-not-return' });
    expect(done.out.votes.quorumFirst.secondWave.map((s) => [s.id, s.reasons])).toEqual(IDS.map((id) => [id, ['missing']]));
    expect(done.out.notReviewed.incompleteVerifiers).toEqual([expect.objectContaining({ verifier: 'verifier-2', candidateIds: IDS })]);
    expect(done.out.notReviewed.expiredAgents.map((a) => a.name)).toEqual(['verifier-2']);
    expect(done.out.reducedReview).toMatch(/verification partial: some-verifiers-did-not-return/);
    // a candidate settled with a verifier missing is no carried verdict either (kata dx53)
    expect(stateOnDisk().verdicts).toEqual([]);
    expect(snapshotRepo()).toEqual(before);
    // the contrast: with the key on and everybody back (scenario 2) nothing is lost and the round is not partial
    smoke('4 missing first vote', { verifiersOn: 3, firstWave: 2, secondWave: 1, verification: done.out.votes.verification, outcomes: done.out.votes.outcomes.map((o) => [o.id, o.outcome, o.settledOnMajority, o.missing]) });
  });

  describe('5. FULL (Deep) mode, K=5', () => {
    const CANDIDATE = { locationOrLink: 'secure/key.js:1', failureMode: 'the module exports the secret to every importer without any access check', severity: 'important' };
    /** TRIAGE stop first, as the existing full-mode tests do; returns the verify manifest. */
    function deepVerify(runId) {
      setGh({ head: fx.high });
      fs.rmSync(stateFilePath(), { force: true });
      const review = prep({ runId });
      expect(review.code).toBe(0);
      expect(review.out).toMatchObject({ ok: true, status: 'DISPATCH', mode: { mode: 'full' }, depth: { mode: 'deep', verifiersPerCandidate: 5 } });
      answerReview(review.out, { changed: ['secure/key.js'], findings: { 'reviewer-s1-a': [reviewerFinding({ locationOrLink: 'secure/key.js:1', originalTextOrLink: 'secure/key.js:1', failureMode: 'the key is a constant string that is committed to the repository' })] } });
      expect(coll(runId).out.status).toBe('TRIAGE');
      const verify = coll(runId, { triage: { additionalCandidates: [CANDIDATE] } });
      expect(verify.code).toBe(0);
      expect(verify.out).toMatchObject({ ok: true, status: 'DISPATCH', round: 'verify', mode: { mode: 'full' } });
      return verify.out;
    }

    test('key on: 3 verifiers (not 5) each hold f1 and f2, all real is DONE with 3 of 5 real, quorum-settled with 2 seats never asked; key off asks 5', () => {
      use('absent');
      const off = deepVerify('q5-off');
      expect(off.agents.map((a) => a.name)).toEqual(['verifier-1', 'verifier-2', 'verifier-3', 'verifier-4', 'verifier-5']);
      voteAll(off.agents);
      const offDone = coll('q5-off');
      expect(offDone.out).toMatchObject({ ok: true, status: 'DONE', mode: { mode: 'full' } });

      use('on');
      const before = snapshotRepo();
      const verify = deepVerify('q5-on');
      expect(verify.quorumFirst).toMatchObject({ expected: 5, needed: 3, secondWave: false });
      expect(holds(verify)).toEqual([['verifier-1', 'f1,f2'], ['verifier-2', 'f1,f2'], ['verifier-3', 'f1,f2']]);
      voteAll(verify.agents);
      const done = coll('q5-on');
      expect(done.code).toBe(0);
      expect(done.out).toMatchObject({ ok: true, status: 'DONE', mode: { mode: 'full' }, votes: { verification: 'performed' } });
      for (const o of done.out.votes.outcomes) expect(o).toMatchObject({ outcome: 'present', reason: 'verifier-majority', quorumSettled: true, unaskedVerifiers: 2, tally: { real: 3, notReal: 0, expected: 5, needed: 3 } });
      expect(done.out.votes.outcomes.map((o) => o.id)).toEqual(['f1', 'f2']);
      expect(done.out.notReviewed.incompleteVerifiers).toEqual([]);
      expect(outcomesOf(done.out)).toEqual(outcomesOf(offDone.out));
      expect(done.out.gate.mergeable).toBe(offDone.out.gate.mergeable);
      expect(done.out.metrics.agentsByRole.verifier).toBe(3);
      expect(offDone.out.metrics.agentsByRole.verifier).toBe(5);
      expect(stateOnDisk().verdicts).toEqual([]);
      expect(snapshotRepo()).toEqual(before);
      smoke('5 deep K=5', { verifiersOff: off.agents.length, verifiersOn: verify.agents.length, outcomes: outcomesOf(done.out), unasked: done.out.votes.outcomes.map((o) => o.unaskedVerifiers) });
    });
  });

  describe('6. a delta review after a quorum round', () => {
    /** Round one on H1 (the three claims), then the delta prepare on H2 (src/b.js changed; src/a.js untouched) with the reviewers raising the same three again. */
    function deltaFlow(name, prefix) {
      use(name);
      const verify1 = verifyRound(`${prefix}1`);
      voteAll(verify1.agents);
      const done1 = coll(`${prefix}1`);
      expect(done1.out).toMatchObject({ ok: true, status: 'DONE', votes: { verification: 'performed' } });
      const stateAfter1 = stateOnDisk();
      setGh({ head: fx.head2 });
      const p = prep({ runId: `${prefix}2`, lastReviewedSha: fx.head, remediationShas: [fx.head2] });
      expect(p.code).toBe(0);
      answerReview(p.out, { findings: { 'reviewer-s1-a': claimFindings() } });
      const v = coll(`${prefix}2`);
      expect(v.code).toBe(0);
      return { verify1, done1, stateAfter1, prepare: p.out, verify2: v.out, candidates: runFile(`${prefix}2`).candidates };
    }

    test('the quorum-settled round is a valid delta base but carries nothing: all three are verified again; the key-off control carries the two the push left alone', () => {
      const control = deltaFlow('absent', 'q6-off');
      // control: the base is valid, the delta runs as a delta, src/a.js (f1, f3) is carried and only src/b.js (f2) is verified again
      expect(control.prepare.reReview).toMatchObject({ scope: 'delta', appliedRange: 'delta', delta: { lastReviewedSha: fx.head, changedPaths: 1 } });
      expect(control.prepare.reReview.reasons.some((r) => r.startsWith('prior-round-unusable'))).toBe(false);
      expect(control.verify2).toMatchObject({ status: 'DISPATCH', round: 'verify', carry: { carried: 2, verified: 1 } });
      // only src/b.js (the file the push changed) goes back to verifiers: the candidate the new round numbers for it
      const changedIds = control.candidates.filter((c) => c.locationOrLink.startsWith('src/b.js')).map((c) => c.id);
      expect(changedIds).toHaveLength(1);
      expect(new Set(control.verify2.agents.flatMap((a) => a.candidateIds))).toEqual(new Set(changedIds));
      expect(control.verify2.agents.map((a) => a.name)).toEqual(['verifier-1', 'verifier-2', 'verifier-3']);

      const quorum = deltaFlow('on', 'q6-on');
      expect(quorum.done1.out.votes.outcomes.every((o) => o.quorumSettled === true)).toBe(true);
      expect(quorum.stateAfter1.verdicts).toEqual([]);
      // a complete round, a normal delta base: not rejected as unverified or incomplete
      expect(quorum.prepare.reReview).toMatchObject({ scope: 'delta', appliedRange: 'delta', delta: { lastReviewedSha: fx.head, changedPaths: 1 } });
      expect(quorum.prepare.reReview.reasons.some((r) => r.startsWith('prior-round-unusable'))).toBe(false);
      expect(quorum.prepare.reReview.delta.unverifiedFromLastRound).toBeUndefined();
      expect(quorum.prepare.agents.map((a) => a.name)).toEqual(control.prepare.agents.map((a) => a.name));
      // NOT carried, although f1 and f3 cite src/a.js, which the push left untouched: the control carries exactly those two
      expect(quorum.verify2).toMatchObject({ status: 'DISPATCH', round: 'verify', carry: { carried: 0, verified: 3 } });
      // and verified again in the new round's verify dispatch (the quorum is on in the delta round too: 2 verifiers holding all three)
      const ids2 = quorum.candidates.map((c) => c.id);
      expect(ids2).toHaveLength(3);
      expect(quorum.candidates.map((c) => c.locationOrLink).sort()).toEqual(['src/a.js:1', 'src/a.js:1', 'src/b.js:1']);
      expect(quorum.verify2.agents.map((a) => [a.name, [...a.candidateIds].sort().join()])).toEqual([['verifier-1', [...ids2].sort().join()], ['verifier-2', [...ids2].sort().join()]]);
      voteAll(quorum.verify2.agents);
      const done2 = coll('q6-on2');
      expect(done2.code).toBe(0);
      expect(done2.out).toMatchObject({ ok: true, status: 'DONE', carry: { appliedRange: 'delta', carried: 0 }, votes: { verification: 'performed' } });
      expect(done2.out.coverage).toEqual({ complete: true, unreviewedSlices: [], uncovered: [] });
      expect(done2.out.votes.outcomes.map((o) => [o.id, o.outcome, o.reason]).sort()).toEqual([...ids2].sort().map((id) => [id, 'present', 'verifier-majority']));
      // the control's carried entries are the prior ones restamped; the quorum round's are all fresh verdicts of this round
      for (const entry of done2.out.ledger) expect(entry.carriedFrom).toBeUndefined();
      smoke('6 delta', { verifiersControlRound2: control.verify2.agents.length, carriedControl: control.verify2.carry.carried, verifiersQuorumRound2: quorum.verify2.agents.length, carriedQuorum: quorum.verify2.carry.carried, askedAgain: [...new Set(quorum.verify2.agents.flatMap((a) => a.candidateIds))] });
    });
  });

  test('7. FAIL CLOSED: a non-finding candidate (kind: style) makes the whole round ask the full electorate, and the answer says why; outcomes as with the key off', () => {
    const findings = [reviewerFinding({ locationOrLink: 'src/a.js:1', originalTextOrLink: 'src/a.js:1', failureMode: 'the module name is not capitalised', kind: 'style' }), reviewerFinding({ locationOrLink: 'src/b.js:1', originalTextOrLink: 'src/b.js:1', failureMode: 'distinct defect two in another subsystem' })];
    const off = offArm('absent', 'q7-off', { findings });
    use('on');
    const before = snapshotRepo();
    const verify = verifyRound('q7-on', { findings });
    expect(holds(verify)).toEqual([['verifier-1', 'f1,f2'], ['verifier-2', 'f1,f2'], ['verifier-3', 'f1,f2']]);
    expect(holds(verify)).toEqual(holds(off.verify));
    expect(verify.quorumFirst).toBeUndefined();
    expect(verify.agents.some((a) => a.secondWave !== undefined)).toBe(false);
    expect(runFile('q7-on').quorum).toMatchObject({ requested: true, applied: false, reason: expect.stringMatching(/no finding/) });
    voteAll(verify.agents);
    const done = coll('q7-on');
    expect(done.code).toBe(0);
    expect(done.out.status).toBe(off.done.status);
    expect(done.out.votes.quorumFirst).toMatchObject({ applied: false });
    expect(done.out.reducedReview).toMatch(/QUORUM-FIRST verification was asked for .* NOT applied/);
    expect(done.out.reducedReview).toMatch(/no finding/);
    for (const o of done.out.votes.outcomes) {
      expect(o.quorumSettled).toBeUndefined();
      expect(o.unaskedVerifiers).toBeUndefined();
      expect(o.tally).toMatchObject({ real: 3, expected: 3 });
    }
    expect(outcomesOf(done.out)).toEqual(outcomesOf(off.done));
    expect(outcomesOf(done.out)).toEqual([['f1', 'filtered', 'non-finding'], ['f2', 'present', 'verifier-majority']]);
    expect(done.out.gate.mergeable).toBe(off.done.gate.mergeable);
    expect(done.out.votes.verification).toBe(off.done.votes.verification);
    expect(snapshotRepo()).toEqual(before);
    smoke('7 fail closed', { verifiersOff: off.verify.agents.length, verifiersOn: verify.agents.length, outcomes: outcomesOf(done.out), reason: runFile('q7-on').quorum.reason });
  });
});
