'use strict';

/**
 * Kata nj2d (plan v2 section 5 child V2-1, owner decision D8), through the real CLIs: the dispatcher passes what it knows about each agent in
 * the collect payload (`agentStats`), the runner stamps it on the agent spans of the real trace file, and `pr-review-cli timing` (and
 * `pr-review-timing.js`, its text form) prints it by role, with the host load the sampler took while the agents ran.
 *
 * Real: git (an origin, a clone, a small Medium PR), the `review-run-cli.js` process (prepare and collect), prepare, the verify plan, the
 * trace recorder, `pr-review-cli.js timing` and `pr-review-timing.js` as processes, and the load sampler as a process of its own (one sample per
 * call, taken at a moment the test chooses; the continuous sampler is pr-review-load.test.js's). Faked: `gh` (an executable stub first on PATH) and the agents, which are this test writing
 * `out-<name>.json` files exactly as a dispatched agent would.
 *
 * Fixtures live under ~/.omp/pr-review-speedup/prs-agent-stats/fixtures (never /tmp) and are removed afterwards.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

jest.setTimeout(240000);

const LIB = path.join(__dirname, '..', 'lib');
const RUN_CLI = path.join(LIB, 'review-run-cli.js');
const REVIEW_CLI = path.join(LIB, 'pr-review-cli.js');
const TIMING = path.join(LIB, 'pr-review-timing.js');
const LOAD = path.join(LIB, 'pr-review-load.js');
const FIXTURES = path.join(os.homedir(), '.omp', 'pr-review-speedup', 'prs-agent-stats', 'fixtures');
const BODY = '## Testing\nran the relevant tests\n\n## Risk\nlow\n\n## How to revert\nrevert the commit\n';
const POLICY = '# Review\n\n```ensemble-review-policy\n{"sensitivePaths":["secure/**"],"highPaths":["wide/**"]}\n```\n';
const PATHS = ['med/a01.js', 'med/a02.js', 'med/a03.js'];
const body = (count) => `${Array.from({ length: count }, (_, line) => `// line ${line + 1}`).join('\n')}\n`;

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
  out({ headRefOid: state.head, baseRefName: 'main', state: 'OPEN', body: state.body, author: { login: 'alice' }, isCrossRepository: false });
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

let fx;

/** origin + clone; `main` holds the policy; the PR adds three small files, one slice: two reviewers and the lane. */
function buildFixture() {
  fs.mkdirSync(FIXTURES, { recursive: true });
  const root = fs.mkdtempSync(path.join(FIXTURES, 'e2e-'));
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), GH_STUB, { mode: 0o755 });
  git(root, 'init', '--bare', '-b', 'main', origin);
  git(root, 'init', '-b', 'main', work);
  git(work, 'remote', 'add', 'origin', origin);
  write(work, 'README.md', '# fixture\n');
  write(work, 'REVIEW.md', POLICY);
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'base');
  git(work, 'push', '-q', 'origin', 'main');
  git(work, 'checkout', '-q', '-b', 'pr');
  PATHS.forEach((rel) => write(work, rel, body(20)));
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'a small Medium PR');
  fs.appendFileSync(path.join(work, '.git', 'info', 'exclude'), '.ensemble/\n');
  return { root, origin, work, bin, head: git(work, 'rev-parse', 'HEAD'), stateFile: path.join(root, 'gh-state.json'), logFile: path.join(root, 'gh.log') };
}

beforeAll(() => {
  fx = buildFixture();
  fs.writeFileSync(fx.stateFile, JSON.stringify({ head: fx.head, body: BODY, reviews: [] }));
  fs.writeFileSync(fx.logFile, '');
});

afterAll(() => {
  spawnSync('chmod', ['-R', 'u+w', fx.root]);
  fs.rmSync(fx.root, { recursive: true, force: true });
});

const cliEnv = () => ({ ...process.env, PATH: `${fx.bin}${path.delimiter}${process.env.PATH}`, STUB_GH_STATE: fx.stateFile, STUB_GH_LOG: fx.logFile, GIT_CONFIG_GLOBAL: '/dev/null' });

/** Runs a real CLI process on one JSON payload: `{code, out}` with stdout parsed as the one JSON object. */
function cli(script, args, payload) {
  const r = spawnSync(process.execPath, [script, ...args], { input: JSON.stringify(payload), env: cliEnv(), encoding: 'utf8', cwd: fx.root, timeout: 180000 });
  let out;
  try {
    out = JSON.parse(r.stdout);
  } catch (error) {
    out = { unparsable: r.stdout, stderr: r.stderr, error: r.error && r.error.message };
  }
  return { code: r.status, out };
}
const prep = (runId, extra = {}) => cli(RUN_CLI, ['prepare'], { repo: 'o/r', pr: 7, repoRoot: fx.work, runId, agentAuthored: false, ...extra });
const coll = (runId, extra = {}) => cli(RUN_CLI, ['collect'], { repoRoot: fx.work, runId, ...extra });
const timing = (runId) => cli(REVIEW_CLI, ['timing'], { runId, cwd: fx.work });
const tracePath = (runId) => path.join(fx.work, '.ensemble', 'state', 'toolchain', `trace-${runId}.jsonl`);

const writeResult = (agent, object) => {
  fs.mkdirSync(path.dirname(agent.outPath), { recursive: true });
  const temp = `${agent.outPath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(object));
  fs.renameSync(temp, agent.outPath);
};
const CLAIM = { locationOrLink: 'med/a01.js:5', severity: 'important', failureMode: 'The loop on line 5 reads one element past the end of the list, so the last iteration sees undefined.', disposition: 'fix', evidence: 'Called with a list of 3: the fourth iteration read undefined.', originalTextOrLink: 'med/a01.js:5' };
/** Stand-in agents: every reviewer lists the paths it was given, `reviewer-s1-a` raises one finding, the lane lists every path. */
const answerReview = (manifest) => {
  for (const agent of manifest.agents) writeResult(agent, { findings: agent.name === 'reviewer-s1-a' ? [CLAIM] : [], pathsReviewed: agent.paths || PATHS });
};
const answerVotes = (manifest) => {
  for (const agent of manifest.agents) writeResult(agent, { votes: agent.candidateIds.map((id) => ({ candidateId: id, verdict: 'real', evidence: 'read it' })) });
};

/** What the verdict of a run says, without what only names the run or dates it (its id, the time a record was made): the gate, the ledger, the votes and what was not reviewed. */
const verdictOf = (done) => JSON.stringify({ status: done.status, gate: done.gate, reviewStatus: done.reviewStatus, ledger: done.ledger, votes: done.votes, notReviewed: done.notReviewed, coverage: done.coverage, tier: done.tier, mode: done.mode }, (key, value) => (key === 'at' || key === 'runId' ? undefined : value));

/**
 * One whole review through the CLI; `first` and `second` are the payload keys of the review-round collect and of the verify-round collect.
 * `whileReviewing` runs while the review agents run (dispatched, not yet answered) and `whileVerifying` while the verifiers do, so a test can take a
 * load sample inside the window of one round's agents and of no other, with no sleep and no race.
 */
function review(runId, { first = {}, second = {}, whileReviewing = () => {}, whileVerifying = () => {} } = {}) {
  const p = prep(runId);
  expect(p.code).toBe(0);
  expect(p.out.agents.map((a) => a.name)).toEqual(['reviewer-s1-a', 'reviewer-s1-b', 'security-lane']);
  whileReviewing();
  answerReview(p.out);
  const v = coll(runId, first);
  expect(v.out).toMatchObject({ ok: true, status: 'DISPATCH', round: 'verify' });
  whileVerifying();
  answerVotes(v.out);
  const done = coll(runId, second);
  expect(done.out).toMatchObject({ ok: true, status: 'DONE' });
  return { prepare: p.out, verify: v.out, done: done.out };
}

const FIGURES = {
  'reviewer-s1-a': { tool_calls: 31, turns: 33, effort: 'hi', model: 'claude-opus-4-5', retries: 0, rate_limits: 0 },
  'reviewer-s1-b': { tool_calls: null, tool_calls_reason: 'the harness job result reports no tool-call count', turns: null, turns_reason: 'the harness job result reports no turn count', effort: 'hi', model: 'claude-opus-4-5' },
  // the security lane is not named at all
};
const VERIFIER_FIGURES = { 'verifier-1': { tool_calls: 9, effort: 'hi' }, 'verifier-2': { tool_calls: 0, effort: 'hi' } /* verifier-3: not named */ };

describe('agentStats through the real CLIs (kata nj2d)', () => {
  test('a malformed agentStats is refused with exit 1 and records nothing; the same collect with a valid one is accepted', () => {
    const p = prep('stats-refused');
    answerReview(p.out);
    const before = fs.readFileSync(path.join(fx.work, '.ensemble', 'pr-review', 'run', 'stats-refused', 'run.json'));
    for (const bad of [{ 'reviewer-s1-a': { tool_calls: -3 } }, { 'reviewer-s1-a': { tool_calls: '31' } }, { 'reviewer-s1-z': { tool_calls: 3 } }, { 'reviewer-s1-a': { tool_calls: null } }]) {
      const refused = coll('stats-refused', { agentStats: bad });
      expect(refused.code).toBe(1);
      expect(refused.out).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: 'invalid-input' });
      expect(refused.out.error).toContain('agentStats');
    }
    expect(fs.readFileSync(path.join(fx.work, '.ensemble', 'pr-review', 'run', 'stats-refused', 'run.json')).equals(before)).toBe(true);
    const ends = () => fs.readFileSync(tracePath('stats-refused'), 'utf8').split('\n').filter((l) => l.includes('"span_end"'));
    expect(ends().every((l) => !l.includes('tool_calls'))).toBe(true);
    // a valid one is accepted by the same call, and what it said is on the span of the agent it names
    expect(coll('stats-refused', { agentStats: { 'reviewer-s1-a': { tool_calls: 4 } } })).toMatchObject({ code: 0, out: { ok: true, status: 'DISPATCH', round: 'verify' } });
    expect(ends().filter((l) => l.includes('"tool_calls":4'))).toHaveLength(1);
  });

  test('stats supplied, one load sample taken while the reviewers ran: the trace carries the figures and timing prints them by role, with the host load each agent saw', () => {
    const runId = 'stats-full';
    // the real sampler process, one sample per call (`--max-samples 1`), at a moment the test chooses: while the review agents run and not while the verifiers do
    const sample = () => {
      const s = spawnSync(process.execPath, [LOAD, 'sample', '--run-id', runId, '--cwd', fx.work, '--max-samples', '1'], { encoding: 'utf8', env: cliEnv() });
      expect(s.status).toBe(0);
    };
    const r = review(runId, { first: { agentStats: FIGURES }, second: { agentStats: VERIFIER_FIGURES }, whileReviewing: sample });
    expect(r.done.reviewStatus).toBeDefined();

    // the real trace file: every figure on the span of the agent it names, nothing on the others
    const spans = fs.readFileSync(tracePath(runId), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const nameOf = Object.fromEntries(spans.filter((s) => s.type === 'span_start').map((s) => [s.span_id, s.attrs.agent]));
    const endAttrs = Object.fromEntries(spans.filter((s) => s.type === 'span_end' && nameOf[s.span_id]).map((s) => [nameOf[s.span_id], s.attrs]));
    for (const [name, figures] of Object.entries({ ...FIGURES, ...VERIFIER_FIGURES })) expect(endAttrs[name]).toMatchObject(figures);
    for (const name of ['security-lane', 'verifier-3']) expect(Object.keys(endAttrs[name]).sort()).toEqual(['last_message_ts', 'state']);

    // `pr-review-cli timing`, the real process
    const t = timing(runId);
    expect(t.code).toBe(0);
    expect(t.out.ok).toBe(true);
    const row = Object.fromEntries(t.out.agentStats.agents.map((a) => [a.name, a]));
    expect(Object.keys(row).sort()).toEqual(['reviewer-s1-a', 'reviewer-s1-b', 'security-lane', 'verifier-1', 'verifier-2', 'verifier-3']);
    expect(row['reviewer-s1-a']).toMatchObject({ toolCalls: 31, turns: 33, effort: 'hi', model: 'claude-opus-4-5', retries: 0, rateLimits: 0 });
    expect(row['reviewer-s1-b']).toMatchObject({ toolCalls: null, turns: null, effort: 'hi' });
    expect(t.out.agentStats.byRole.reviewer.without).toEqual(expect.arrayContaining([
      { figure: 'toolCalls', reason: 'the harness job result reports no tool-call count', agents: ['reviewer-s1-b'] },
      { figure: 'turns', reason: 'the harness job result reports no turn count', agents: ['reviewer-s1-b'] },
    ]));
    expect(row['security-lane'].toolCalls).toBeNull();
    expect(t.out.agentStats.byRole['security-lane'].without).toContainEqual({ figure: 'toolCalls', reason: 'the dispatcher supplied no tool_calls for this agent at collect', agents: ['security-lane'] });
    expect(row['verifier-1'].toolCalls).toBe(9);
    expect(row['verifier-2'].toolCalls).toBe(0);
    expect(row['verifier-3'].toolCalls).toBeNull();
    expect(t.out.agentStats.byRole.reviewer.toolCalls).toMatchObject({ known: 1, missing: 1, total: 31, lowerBound: true });
    expect(t.out.agentStats.byRole.verifier.toolCalls).toMatchObject({ known: 2, missing: 1, total: 9, min: 0, max: 9, lowerBound: true });
    // the host load: the one sample lies inside the orchestrator window and inside the window of every agent of the review round, and of no verifier
    expect(t.out.hostLoad).toMatchObject({ missing: false, scope: 'orchestrator window', samples: 1, cpus: os.cpus().length });
    for (const name of ['reviewer-s1-a', 'reviewer-s1-b', 'security-lane']) expect(row[name].hostLoad).toEqual({ samples: 1, load1Max: expect.any(Number) });
    for (const name of ['verifier-1', 'verifier-2', 'verifier-3']) expect(row[name].hostLoad).toBeNull();
    expect(t.out.agentStats.byRole.verifier.without).toContainEqual({ figure: 'hostLoad', reason: expect.stringMatching(/^no load sample was taken while this agent ran/), agents: ['verifier-1', 'verifier-2', 'verifier-3'] });

    // the text form (`node pr-review-timing.js <runId>`)
    const text = spawnSync(process.execPath, [TIMING, runId, '--cwd', fx.work], { encoding: 'utf8' });
    expect(text.status).toBe(0);
    for (const name of Object.keys(row)) expect(text.stdout).toContain(name);
    expect(text.stdout).toMatch(/reviewer-s1-a[^\n]*tool calls 31\b/);
    expect(text.stdout).toMatch(/reviewer-s1-b[^\n]*tool calls MISSING/);
    expect(text.stdout).toMatch(/host load \(1-minute average\):\s+max /);
  });

  test('a review whose dispatcher supplied nothing: every agent is named without a figure, and the host load says no sampler ran', () => {
    review('stats-none');
    const t = timing('stats-none');
    expect(t.out.ok).toBe(true);
    expect(t.out.agentStats.agents).toHaveLength(6);
    for (const a of t.out.agentStats.agents) {
      expect(a.toolCalls).toBeNull();
      expect(a.hostLoad).toBeNull();
    }
    for (const role of ['reviewer', 'security-lane', 'verifier']) {
      const group = t.out.agentStats.byRole[role].without.find((g) => g.figure === 'toolCalls');
      expect(group.reason).toBe('the dispatcher supplied no tool_calls for this agent at collect');
      expect(group.agents).toHaveLength(t.out.agentStats.byRole[role].count);
    }
    expect(t.out.hostLoad.missing).toBe(true);
    expect(t.out.hostLoad.reason).toMatch(/the sampler was not run/);
  });

  test('the verdict is the same with the stats as without them: they decide nothing', () => {
    const withStats = review('stats-same-1', { first: { agentStats: FIGURES }, second: { agentStats: VERIFIER_FIGURES } });
    const without = review('stats-same-2');
    expect(verdictOf(withStats.done)).toBe(verdictOf(without.done));
    expect(withStats.done.gate).toEqual(without.done.gate);
    expect(withStats.done.metrics.agentsDispatched).toBe(without.done.metrics.agentsDispatched);
  });
});
