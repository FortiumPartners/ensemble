'use strict';

/**
 * The review-run CLI end to end (kata znd1), against a REAL throwaway git repository and the real CLI process.
 *
 * What is real: git (an origin, a clone with a base, a feature branch and a High branch), the CLI process, prepare (snapshot,
 * diffs, facts), the result-file collector, the state report and the run files. What is faked: `gh`, by an executable stub
 * first on PATH that answers the PR / reviews / branch-protection / statuses / comments endpoints from a JSON file the test
 * edits (so a head can move between calls) and appends every argv to a log (so the test can say exactly which `gh` calls
 * wrote), and the "agents", which are this test writing `out-<name>.json` files exactly as a dispatched agent would.
 *
 * Fixtures live under ~/.omp/pr-review-speedup/znd1/fixtures (never /tmp), and are removed afterwards.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const { execute, main, buildDeps, peekRun, realFs } = require('../lib/review-run-cli');
const { defaultDeps: prepareGit } = require('../lib/review-prepare-runtime');
const { prepareReview } = require('../lib/pr-review-prepare');

const CLI = path.join(__dirname, '..', 'lib', 'review-run-cli.js');
const PR_REVIEW_CLI = path.join(__dirname, '..', 'lib', 'pr-review-cli.js');
const FIXTURES = path.join(os.homedir(), '.omp', 'pr-review-speedup', 'znd1', 'fixtures');
const BODY = '## Testing\nran the relevant tests\n\n## Risk\nlow\n\n## How to revert\nrevert the commit\n';
const POLICY = '# Review\n\n```ensemble-review-policy\n{"sensitivePaths":["secure/**"],"highPaths":["wide/**"]}\n```\n';
/** The changed lines of the 19 paths of the one real full-mode run (PR 271), in path order: the `wide` branch adds one new file of each size (kata sfpb). */
const WIDE_LINES = [1, 127, 1, 159, 1, 145, 12, 8, 76, 125, 355, 38, 1, 8, 76, 159, 1, 145, 12];
const widePath = (index) => `wide/a${String(index + 1).padStart(2, '0')}.js`;

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
  const pr = { headRefOid: state.head, baseRefName: state.baseRefName || 'main', state: state.prState || 'OPEN', body: state.body, author: { login: 'alice' }, isCrossRepository: state.isCrossRepository === undefined ? false : state.isCrossRepository };
  if (state.isCrossRepository === 'omit') delete pr.isCrossRepository;
  out(pr);
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
  write(work, 'src/a.js', 'module.exports = (list) => list.map((x) => x + 1);\n');
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'base');
  git(work, 'push', '-q', 'origin', 'main');
  git(work, 'checkout', '-q', '-b', 'high');
  write(work, 'secure/key.js', 'module.exports = "k";\n');
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'touch a sensitive path');
  git(work, 'checkout', '-q', 'main');
  // a High PR of the shape of the one real full-mode run: 19 new files holding 1450 changed lines between them (kata sfpb)
  git(work, 'checkout', '-q', '-b', 'wide');
  WIDE_LINES.forEach((count, index) => write(work, widePath(index), `${Array.from({ length: count }, (_, line) => `// line ${line + 1}`).join('\n')}\n`));
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'a wide High PR');
  git(work, 'checkout', '-q', 'main');
  // the same shape as a MEDIUM PR: 19 files under a path no policy declares, so the run is light (kata sfpb, review round 2)
  git(work, 'checkout', '-q', '-b', 'medwide');
  WIDE_LINES.forEach((count, index) => write(work, widePath(index).replace(/^wide\//, 'med/'), `${Array.from({ length: count }, (_, line) => `// line ${line + 1}`).join('\n')}\n`));
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'a wide Medium PR');
  git(work, 'checkout', '-q', 'main');
  git(work, 'checkout', '-q', '-b', 'feature');
  write(work, 'src/a.js', 'module.exports = (list) => list.map((x, i) => list[i + 1] + x);\n');
  write(work, 'src/b.js', 'module.exports = () => 1;\n');
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'feature');
  // a head whose own test file writes a marker outside the repository: proof that its code ran (or did not)
  const marker = path.join(root, 'MARKER');
  git(work, 'checkout', '-q', '-b', 'exec');
  write(work, 'src/b.test.js', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'the head code ran');\n`);
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'a test that records that it ran');
  git(work, 'checkout', '-q', 'feature');
  // a head whose tree holds a symlink that leads out of the snapshot: a PR can add any link it likes (the test makes the target a FIFO)
  git(work, 'checkout', '-q', '-b', 'link');
  fs.symlinkSync('../../escape', path.join(work, 'src', 'evil.js'));
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'a symlink out of the snapshot');
  git(work, 'checkout', '-q', 'feature');
  // the review state is gitignored in real repositories; the fixture does the same so `git status` can be exact
  fs.appendFileSync(path.join(work, '.git', 'info', 'exclude'), '.ensemble/\n');
  return { root, origin, work, bin, marker, head: git(work, 'rev-parse', 'feature'), high: git(work, 'rev-parse', 'high'), wide: git(work, 'rev-parse', 'wide'), medwide: git(work, 'rev-parse', 'medwide'), exec: git(work, 'rev-parse', 'exec'), link: git(work, 'rev-parse', 'link'), stateFile: path.join(root, 'gh-state.json'), logFile: path.join(root, 'gh.log') };
}

beforeAll(() => {
  fx = buildFixture();
});
afterAll(() => {
  // prepare seals the snapshot read-only; make it removable first
  spawnSync('chmod', ['-R', 'u+w', fx.root]);
  fs.rmSync(fx.root, { recursive: true, force: true });
});

const setGh = (over = {}) => fs.writeFileSync(fx.stateFile, JSON.stringify({ head: fx.head, body: BODY, reviews: [], ...over }));
beforeEach(() => {
  setGh();
  fs.writeFileSync(fx.logFile, '');
});

const cliEnv = () => ({ ...process.env, PATH: `${fx.bin}${path.delimiter}${process.env.PATH}`, STUB_GH_STATE: fx.stateFile, STUB_GH_LOG: fx.logFile, GIT_CONFIG_GLOBAL: '/dev/null' });

/** Runs the real CLI process: `{code, out}` with stdout parsed as the one JSON object. `timeout` (ms) kills a process that does not return. */
function cli(command, payload, { raw, timeout } = {}) {
  const r = spawnSync(process.execPath, [CLI, command], { input: raw === undefined ? JSON.stringify(payload) : raw, env: cliEnv(), encoding: 'utf8', cwd: fx.root, ...(timeout === undefined ? {} : { timeout }) });
  let out;
  try {
    out = JSON.parse(r.stdout);
  } catch (error) {
    out = { unparsable: r.stdout, stderr: r.stderr, parseError: error.message };
  }
  return { code: r.status, out, stderr: r.stderr, stdout: r.stdout, error: r.error };
}

const prep = (extra = {}) => cli('prepare', { repo: 'o/r', pr: 7, repoRoot: fx.work, agentAuthored: false, ...extra });
const coll = (runId, extra = {}) => cli('collect', { repoRoot: fx.work, runId, ...extra });
const ghLog = () => fs.readFileSync(fx.logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const runDir = (runId) => path.join(fx.work, '.ensemble', 'pr-review', 'run', runId);

const writeResult = (agent, object) => {
  fs.mkdirSync(path.dirname(agent.outPath), { recursive: true });
  const temp = `${agent.outPath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(object));
  fs.renameSync(temp, agent.outPath);
};
const reviewerFinding = (over = {}) => ({ locationOrLink: 'src/a.js:1', severity: 'important', failureMode: 'list[i + 1] reads one past the end on the last element', disposition: 'fix', evidence: 'src/a.js line 1 indexes list[list.length]', originalTextOrLink: 'src/a.js:1', ...over });

/** Answers a review manifest as real agents would: every reviewer covers its paths, the lane covers every changed path. */
function answerReview(manifest, { findings = {}, skip = [], changed = ['src/a.js', 'src/b.js'], partial = {} } = {}) {
  for (const agent of manifest.agents) {
    if (skip.includes(agent.name)) continue;
    if (agent.role === 'reviewer') writeResult(agent, { findings: findings[agent.name] || [], pathsReviewed: partial[agent.name] || agent.paths });
    else writeResult(agent, { findings: findings[agent.name] || [], pathsReviewed: changed });
  }
}
const answerVotes = (manifest, verdict = 'real') => {
  for (const agent of manifest.agents) writeResult(agent, { votes: agent.candidateIds.map((id) => ({ candidateId: id, verdict, evidence: 'read it' })) });
};

const snapshotRepo = () => ({
  status: git(fx.work, 'status', '--porcelain'),
  head: git(fx.work, 'rev-parse', 'HEAD'),
  branch: git(fx.work, 'rev-parse', '--abbrev-ref', 'HEAD'),
  refs: git(fx.work, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads'),
  originRefs: git(fx.root, '--git-dir', fx.origin, 'for-each-ref', '--format=%(refname) %(objectname)'),
  tracked: git(fx.work, 'ls-files', '-s'),
});

describe('the real CLI process on a real git fixture', () => {
  test('prepare: one JSON object, exit 0, a DISPATCH manifest over a real snapshot and diff', () => {
    const r = prep({ runId: 'smoke' });
    expect(r.code).toBe(0);
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
    const m = r.out;
    expect(m).toMatchObject({ ok: true, status: 'DISPATCH', runId: 'smoke', round: 'review', wave: '1 of 1', headSha: fx.head, prState: 'OPEN' });
    expect(m.mode).toMatchObject({ mode: 'light' });
    expect(m.tier).toMatchObject({ tier: 'medium', effectiveTier: 'medium' });
    expect(m.agents.map((a) => a.name)).toEqual(['reviewer-s1-a', 'reviewer-s1-b', 'security-lane']);
    expect(m.precheck).toMatchObject({ comment: { action: 'created', id: 99 } });
    // the diff and the snapshot the briefs name are the real prepared ones
    const brief = fs.readFileSync(m.agents[0].briefPath, 'utf8');
    const diffPath = /Diff for your slice: (\S+)/.exec(brief)[1];
    expect(fs.readFileSync(diffPath, 'utf8')).toContain('src/b.js');
    const snapshot = /snapshot of the reviewed commit: (\S+)/.exec(brief)[1];
    expect(fs.readFileSync(path.join(snapshot, 'src', 'b.js'), 'utf8')).toBe('module.exports = () => 1;\n');
    expect(brief).toMatch(/- src\/a\.js\n- src\/b\.js/);
    process.stderr.write(`\nSMOKE manifest: ${JSON.stringify({ status: m.status, runId: m.runId, round: m.round, wave: m.wave, tier: m.tier.effectiveTier, depth: m.depth, agents: m.agents.map((a) => ({ name: a.name, role: a.role, outPath: path.relative(fx.work, a.outPath), deadlineAtIso: a.deadlineAtIso })) })}\n`);
  });

  /** A base branch whose REVIEW.md policy block carries a stale sourceSha, and a head branch off it holding `files` (rel -> text). */
  function staleBranches(name, files) {
    const baseSha = git(fx.work, 'rev-parse', 'main');
    git(fx.work, 'checkout', '-q', '-b', `${name}base`, baseSha);
    write(fx.work, 'REVIEW.md', '# Review\n\n```ensemble-review-policy\n{"sourceSha":"4c1639e0000000000000000000000000000000aa","highPaths":["lib/**"]}\n```\n');
    git(fx.work, 'add', '.');
    git(fx.work, 'commit', '-q', '-m', 'stale policy base');
    git(fx.work, 'push', '-q', 'origin', `${name}base`);
    git(fx.work, 'checkout', '-q', '-b', `${name}head`);
    for (const [rel, text] of Object.entries(files)) write(fx.work, rel, text);
    git(fx.work, 'add', '.');
    git(fx.work, 'commit', '-q', '-m', 'the PR');
    const head = git(fx.work, 'rev-parse', 'HEAD');
    git(fx.work, 'checkout', '-q', 'main');
    return { head, baseRefName: `${name}base` };
  }

  test('a base whose REVIEW.md policy block is stale (policy-not-from-base) never lowers the tier: the PR is High, with the reason named (kata vhpf)', () => {
    const { head, baseRefName } = staleBranches('stale', { 'lib/bdd-mode.js': 'module.exports = 1;\n' });
    setGh({ head, baseRefName });
    const r = prep({ runId: 'stale' });
    expect(r.code).toBe(0);
    expect(r.out.status).toBe('DISPATCH');
    expect(r.out.tier).toMatchObject({ tier: 'high', effectiveTier: 'high' });
    expect(r.out.tier.reasons).toEqual(expect.arrayContaining(['owner-high-path', 'policy-untrusted:policy-not-from-base']));
    expect(r.out.mode).toMatchObject({ mode: 'full' });
    const state = JSON.parse(fs.readFileSync(path.join(runDir('stale'), 'run.json'), 'utf8'));
    expect(state.policyStatus).toEqual({ ok: false, reason: 'policy-not-from-base' });
    const prepared = path.join(fx.work, '.ensemble', 'pr-review', 'prepare', 'stale');
    const found = fs.readdirSync(prepared, { recursive: true }).filter((f) => String(f).endsWith('facts.json'));
    expect(found).toHaveLength(1);
    const facts = JSON.parse(fs.readFileSync(path.join(prepared, found[0]), 'utf8'));
    expect(facts.policy).toMatchObject({ ok: false, reason: 'policy-not-from-base' });
    expect(facts.paths.warnings).toContain('policy-untrusted-all-high:policy-not-from-base');
  });

  test('PINS CURRENT BEHAVIOUR (owner decision pending): a multi-slice PR on a stale base goes light -> full and loses the whole-range reader', () => {
    const files = {};
    for (let i = 0; i < 20; i += 1) files[`lib/m${i}.js`] = `${Array.from({ length: 60 }, (_, n) => `// ${i} ${n}`).join('\n')}\n`;
    const stale = staleBranches('multi', files);
    setGh(stale);
    const r = prep({ runId: 'multistale' });
    expect(r.code).toBe(0);
    expect(r.out.status).toBe('DISPATCH');
    expect(r.out.tier.effectiveTier).toBe('high');
    expect(r.out.mode.mode).toBe('full');
    const readers = r.out.agents.filter((a) => a.role === 'reviewer');
    expect(readers.length).toBeGreaterThan(1);
    expect(r.out.agents.some((a) => /whole|range/i.test(a.name))).toBe(false);
  });

  test('prepare -> agents -> collect -> verify wave -> collect -> ADJUDICATE -> adjudicate -> DONE, with the repository untouched', () => {
    const before = snapshotRepo();
    const prepared = prep({ runId: 'flow' });
    expect(prepared.code).toBe(0);
    const review = prepared.out;

    // nothing has arrived yet: PENDING, exit 0
    const pending = coll('flow');
    expect(pending.code).toBe(0);
    expect(pending.out).toMatchObject({ status: 'PENDING', round: 'review' });
    expect(pending.out.waitingOn.sort()).toEqual(['reviewer-s1-a', 'reviewer-s1-b', 'security-lane']);

    answerReview(review, { findings: { 'reviewer-s1-a': [reviewerFinding({ uncertain: true })] } });
    const verify = coll('flow');
    expect(verify.code).toBe(0);
    expect(verify.out).toMatchObject({ ok: true, status: 'DISPATCH', round: 'verify', wave: '1 of 1' });
    expect(verify.out.agents).toHaveLength(3);
    expect(verify.out.agents.every((a) => a.role === 'verifier' && a.candidateIds.join() === 'f1')).toBe(true);
    const verifierBrief = fs.readFileSync(verify.out.agents[0].briefPath, 'utf8');
    expect(verifierBrief).toContain('list[i + 1] reads one past the end');
    expect(verifierBrief).not.toContain('reviewer-s1');
    expect(verifierBrief).not.toContain('line 1 indexes');

    answerVotes(verify.out, 'real');
    const adjudicate = coll('flow');
    expect(adjudicate.code).toBe(0);
    expect(adjudicate.out).toMatchObject({ ok: true, status: 'ADJUDICATE' });
    expect(adjudicate.out.adjudicate).toEqual([{ id: 'f1', why: expect.stringContaining('uncertain') }]);
    expect(adjudicate.out.votes).toMatchObject({ verification: 'performed' });
    expect(adjudicate.out.security.status).toBe('clean');
    expect(adjudicate.out.coverage).toEqual({ complete: true, unreviewedSlices: [], uncovered: [] });
    expect(adjudicate.out.gate.mergeable).toBe(false);
    expect(adjudicate.out.gate.blockers.map((b) => b.code)).toEqual(expect.arrayContaining(['open-important-finding', 'approvals-unsatisfied']));
    expect(adjudicate.out.reviewStatus.status).not.toBe('REVIEW_COMPLETE');
    expect(adjudicate.out.metrics).toMatchObject({ runnerCalls: 4, dispatchRounds: 2, agentsDispatched: 6 });

    // the state report and final.json are on disk
    const statePath = path.join(fx.work, '.ensemble', 'pr-review', 'pr-7.json');
    expect(adjudicate.out.statePath).toBe(statePath);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    expect(state).toMatchObject({ prId: 7, runId: 'flow', reviewedHeadSha: fx.head, mode: 'light' });
    expect(state.ledger).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(path.join(runDir('flow'), 'final.json'), 'utf8')).status).toBe('ADJUDICATE');

    // idempotent re-entry
    expect(coll('flow').out).toEqual(adjudicate.out);

    // adjudicate: deferral of an Important finding does not unblock the gate
    const done = coll('flow', { adjudications: [{ id: 'f1', disposition: 'deferred', reason: 'tracked as a follow-up' }] });
    expect(done.code).toBe(0);
    expect(done.out).toMatchObject({ status: 'DONE', adjudicatedBy: 'orchestrator' });
    expect(done.out.gate.mergeable).toBe(false);
    expect(done.out.gate.findings.open).toEqual(['f1']);
    expect(coll('flow').out).toEqual(done.out);

    // AC3: no push, no checkout, no change to the tree or any ref, and the only gh write is the precheck's comment
    expect(snapshotRepo()).toEqual(before);
    const writes = ghLog().filter((a) => a.includes('-X'));
    expect(writes).toEqual([['api', '-X', 'POST', 'repos/o/r/issues/7/comments', '-f', expect.stringContaining('ensemble:pr-review-precheck')]]);
    expect(ghLog().some((a) => ['merge', 'close', 'edit', 'review', 'checkout'].includes(a[1]))).toBe(false);
    // the run directory is private
    expect(fs.statSync(runDir('flow')).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(runDir('flow'), 'run.json')).mode & 0o777).toBe(0o600);
  });

  test('the trace review-run writes is the stage contract pr-review-cli timing reads: ok, every stage found, a critical path inside the window (kata k0sh)', () => {
    const review = prep({ runId: 'timed' }).out;
    answerReview(review, { findings: { 'reviewer-s1-a': [reviewerFinding({ uncertain: true })] } });
    const verify = coll('timed').out;
    expect(verify).toMatchObject({ status: 'DISPATCH', round: 'verify' });
    answerVotes(verify, 'real');
    expect(coll('timed').out).toMatchObject({ status: 'ADJUDICATE' });

    const run = spawnSync(process.execPath, [PR_REVIEW_CLI, 'timing'], { input: JSON.stringify({ runId: 'timed', cwd: fx.work }), env: cliEnv(), encoding: 'utf8', cwd: fx.root });
    expect(run.status).toBe(0);
    const timing = JSON.parse(run.stdout);
    expect(timing.ok).toBe(true);
    expect(timing.wall.missing).toBe(false);
    expect(timing.warnings).toEqual([]);
    expect(timing.agents).toMatchObject({ count: 6, unusable: [], byRole: { reviewer: { count: 2 }, 'security-lane': { count: 1 }, verifier: { count: 3 } } });
    for (const stage of ['review.head-read', 'review.gate', 'review.verdict', 'review.reviewer', 'review.verifier', 'review.security-lane']) {
      expect({ stage, missing: timing.stages[stage].missing }).toEqual({ stage, missing: false });
    }
    // reviewer -> verifier -> verdict in round 1, none missing; the figures are the agents' own slowest, not the collect calls
    expect(timing.criticalPath.missing).toBe(false);
    expect(timing.criticalPath.rounds).toHaveLength(1);
    expect(timing.criticalPath.rounds[0]).toMatchObject({ round: 1, steps: [{ stage: 'reviewer', missing: false }, { stage: 'verifier', missing: false }, { stage: 'verdict', missing: false }] });
    // each step names the agent behind it, and the idle time between an agent's last message and the collect that closed its span is
    // recorded as linger rather than counted in the agent's length (the span ends at last_message_ts)
    const [reviewerStep, verifierStep] = timing.criticalPath.rounds[0].steps;
    expect(reviewerStep.name).toMatch(/^reviewer-s1-[ab]$/);
    expect(verifierStep.name).toMatch(/^verifier-\d+$/);
    expect(timing.agents.lingerMs).toBeGreaterThan(0);
    expect(timing.orchestratorOnly.missing).toBe(false);
    expect(timing.beforeFirstDispatch.missing).toBe(false);
    expect(timing.criticalPath.ms + timing.orchestratorOnly.ms).toBeLessThanOrEqual(timing.wall.ms);
    // the stage spans, not the runner's own names, are what the reader found: nothing of the old scheme is needed
    const starts = fs.readFileSync(path.join(fx.work, '.ensemble', 'state', 'toolchain', 'trace-timed.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.type === 'span_start');
    const names = starts.map((r) => r.name);
    expect(names.filter((n) => n === 'review')).toHaveLength(1);
    expect(names).not.toContain('gate');
    expect(names.some((n) => n.startsWith('agent:'))).toBe(false);
    // the spans the reader never knew (`precheck`, `prepare-head`) are gone, not kept beside the contract names
    expect(names.filter((n) => !n.startsWith('review'))).toEqual([]);
    // every agent span names its round and its wave (one wave of each kind here: the cap is 8)
    expect(starts.filter((r) => r.kind === 'agent').map((r) => [r.attrs.round, r.attrs.wave])).toEqual(Array(6).fill([1, 1]));
    // adjudicating re-runs the gate and the verdict after the root has closed: those spans lie outside the window, so the answer is unchanged
    expect(coll('timed', { adjudications: [{ id: 'f1', disposition: 'fix', reason: 'will fix' }] }).out.status).toBe('DONE');
    const again = JSON.parse(spawnSync(process.execPath, [PR_REVIEW_CLI, 'timing'], { input: JSON.stringify({ runId: 'timed', cwd: fx.work }), env: cliEnv(), encoding: 'utf8', cwd: fx.root }).stdout);
    expect(again).toMatchObject({ ok: true, warnings: [], wall: timing.wall, criticalPath: timing.criticalPath });
    expect(again.stages['review.verdict'].count).toBe(2);
  });

  test('a FULL-mode run (TRIAGE stop, five verifiers per candidate, the lane) writes the same stage contract: pr-review-cli timing is ok, every stage found, a critical path inside the window (kata dqcs on kata k0sh)', () => {
    setGh({ head: fx.high });
    fs.rmSync(path.join(fx.work, '.ensemble', 'pr-review', 'pr-7.json'), { force: true });
    const review = prep({ runId: 'timed-full' }).out;
    expect(review).toMatchObject({ ok: true, status: 'DISPATCH', mode: { mode: 'full' } });
    answerReview(review, { changed: ['secure/key.js'], findings: { 'reviewer-s1-a': [reviewerFinding({ locationOrLink: 'secure/key.js:1', originalTextOrLink: 'secure/key.js:1', failureMode: 'the key is a constant string that is committed to the repository' })] } });
    expect(coll('timed-full').out.status).toBe('TRIAGE');
    const verify = coll('timed-full', { triage: { additionalCandidates: [{ locationOrLink: 'secure/key.js:1', failureMode: 'the module exports the secret to every importer without any access check', severity: 'important' }] } }).out;
    expect(verify).toMatchObject({ ok: true, status: 'DISPATCH', round: 'verify' });
    answerVotes(verify, 'real');
    expect(coll('timed-full').out).toMatchObject({ ok: true, status: 'DONE', mode: { mode: 'full' } });

    const run = spawnSync(process.execPath, [PR_REVIEW_CLI, 'timing'], { input: JSON.stringify({ runId: 'timed-full', cwd: fx.work }), env: cliEnv(), encoding: 'utf8', cwd: fx.root });
    expect(run.status).toBe(0);
    const timing = JSON.parse(run.stdout);
    expect(timing.ok).toBe(true);
    expect(timing.wall.missing).toBe(false);
    expect(timing.warnings).toEqual([]);
    // two reviewers, the lane and five verifiers (two candidates settled by a pool of five), every one a span the reader can use
    expect(timing.agents).toMatchObject({ count: 8, unusable: [], byRole: { reviewer: { count: 2 }, 'security-lane': { count: 1 }, verifier: { count: 5 } } });
    for (const stage of ['review.head-read', 'review.gate', 'review.verdict', 'review.reviewer', 'review.verifier', 'review.security-lane']) {
      expect({ stage, missing: timing.stages[stage].missing }).toEqual({ stage, missing: false });
    }
    // the TRIAGE stop dispatches nothing and has no span of its own: it lies inside the `review` window as orchestrator-only time
    expect(timing.criticalPath.missing).toBe(false);
    expect(timing.criticalPath.rounds).toHaveLength(1);
    expect(timing.criticalPath.rounds[0]).toMatchObject({ round: 1, steps: [{ stage: 'reviewer', missing: false }, { stage: 'verifier', missing: false }, { stage: 'verdict', missing: false }] });
    expect(timing.orchestratorOnly.missing).toBe(false);
    expect(timing.criticalPath.ms + timing.orchestratorOnly.ms).toBeLessThanOrEqual(timing.wall.ms);
    const names = fs.readFileSync(path.join(fx.work, '.ensemble', 'state', 'toolchain', 'trace-timed-full.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.type === 'span_start').map((r) => r.name);
    expect(names.filter((n) => n === 'review')).toHaveLength(1);
    expect(names.filter((n) => n === 'review.verifier')).toHaveLength(5);
    expect(names.filter((n) => n === 'review.security-lane')).toHaveLength(1);
    expect(names.filter((n) => n === 'review.reviewer')).toHaveLength(2);
    expect(names.filter((n) => n === 'review.verdict')).toHaveLength(1);
    expect(names.filter((n) => n === 'gate' || n === 'precheck' || n === 'prepare-head' || n.startsWith('agent:'))).toEqual([]);
  });

  test('a run with no uncertain finding and every vote cast finishes DONE in one collect after the verify wave', () => {
    const review = prep({ runId: 'plain' }).out;
    answerReview(review, { findings: { 'reviewer-s1-b': [reviewerFinding({ locationOrLink: 'src/b.js:1', failureMode: 'the exported function ignores its arguments entirely' })] } });
    const verify = coll('plain').out;
    answerVotes(verify, 'not-real');
    const done = coll('plain');
    expect(done.code).toBe(0);
    expect(done.out.status).toBe('DONE');
    expect(done.out.ledger[0].verification).toMatchObject({ outcome: 'filtered', authorLabel: 'verifier disagrees' });
    expect(done.out.gate.findings.open).toEqual(['f1']); // filtered, still listed and still blocking
  });

  test('a pre-existing label on a line the real diff changes stays in the gate; one on a file the PR does not touch stays pre-existing (review of PR 264, P1)', () => {
    const review = prep({ runId: 'pre-existing' }).out;
    answerReview(review, {
      findings: {
        'reviewer-s1-a': [
          reviewerFinding({ severity: 'pre-existing', locationOrLink: 'src/a.js:1', failureMode: 'list[i + 1] reads one past the end on the last element' }),
          reviewerFinding({ severity: 'pre-existing', locationOrLink: 'README.md:1', originalTextOrLink: 'README.md:1', failureMode: 'the fixture readme says nothing about how to run it' }),
        ],
      },
    });
    const verify = coll('pre-existing').out;
    expect(verify).toMatchObject({ status: 'DISPATCH', round: 'verify' });
    answerVotes(verify, 'real');
    const done = coll('pre-existing');
    expect(done.out.status).toBe('DONE');
    expect(done.out.ledger.map((entry) => [entry.id, entry.severity])).toEqual([['f1', 'important'], ['f2', 'pre-existing']]);
    expect(done.out.ledger[0]).toMatchObject({ claimedSeverity: 'pre-existing', strippedFields: ['severity'] });
    expect(done.out.gate.findings).toMatchObject({ open: ['f1'], preExisting: 1 });
    expect(done.out.gate.blockers.map((b) => b.code)).toContain('open-important-finding');
  });

  test('a High (sensitive) path runs in full mode through the real process: DISPATCH, TRIAGE, a five-verifier wave, DONE, the repository untouched', () => {
    setGh({ head: fx.high });
    const before = snapshotRepo();
    const r = prep({ runId: 'high' });
    expect(r.code).toBe(0);
    expect(r.out).toMatchObject({ ok: true, status: 'DISPATCH', mode: { mode: 'full' }, depth: { mode: 'deep', verifiersPerCandidate: 5 }, reReview: { scope: 'first-review' } });
    expect(r.out.mode.reasons).toContain('sensitive-path');
    expect(r.out.agents.map((a) => a.role)).toContain('security');
    expect(r.out.agents.filter((a) => a.role === 'reviewer').length).toBeGreaterThanOrEqual(2);
    answerReview(r.out, { changed: ['secure/key.js'], findings: { 'reviewer-s1-a': [reviewerFinding({ locationOrLink: 'secure/key.js:1', originalTextOrLink: 'secure/key.js:1', failureMode: 'the key is a constant string that is committed to the repository' })] } });
    const triage = coll('high');
    expect(triage.code).toBe(0);
    expect(triage.out).toMatchObject({ ok: true, status: 'TRIAGE', dispatched: [], security: { status: 'clean' }, coverage: { complete: true } });
    expect(triage.out.candidates.map((c) => c.id)).toEqual(['f1']);
    expect(coll('high').out.status).toBe('TRIAGE'); // no triage payload: nothing advances
    const verify = coll('high', { triage: { additionalCandidates: [{ locationOrLink: 'secure/key.js:1', failureMode: 'the module exports the secret to every importer without any access check', severity: 'important' }] } });
    expect(verify.code).toBe(0);
    expect(verify.out).toMatchObject({ status: 'DISPATCH', round: 'verify', mode: { mode: 'full' } });
    const perCandidate = {};
    for (const a of verify.out.agents) for (const id of a.candidateIds) perCandidate[id] = (perCandidate[id] || 0) + 1;
    expect(perCandidate).toEqual({ f1: 5, f2: 5 });
    answerVotes(verify.out, 'real');
    const done = coll('high');
    expect(done.code).toBe(0);
    expect(done.out).toMatchObject({ status: 'DONE', mode: { mode: 'full' }, triage: { requested: 1, additionalCandidateIds: ['f2'] } });
    expect(done.out.gate.mergeable).toBe(false);
    expect(done.out.ledger.map((e) => e.source)).toEqual(['reviewer-s1-a', 'orchestrator']);
    expect(JSON.parse(fs.readFileSync(path.join(fx.work, '.ensemble', 'pr-review', 'pr-7.json'), 'utf8'))).toMatchObject({ mode: 'full' });
    process.stderr.write(`\nSMOKE full-mode: ${JSON.stringify({ wallMs: done.out.metrics.wallMs, orchestratorTurns: done.out.metrics.orchestratorTurns.atLeast, triageCalls: done.out.metrics.triageCalls, agents: done.out.metrics.agentsByRole })}\n`);
    expect(snapshotRepo()).toEqual(before);
  });

  test('a High PR of the real full-mode run\'s shape (19 paths, 1450 changed lines) through the real process: three slices in one wave, a diff per slice cut from real git output, the lane given 36 minutes (kata sfpb)', () => {
    setGh({ head: fx.wide });
    fs.rmSync(path.join(fx.work, '.ensemble', 'pr-review', 'pr-7.json'), { force: true });
    const before = snapshotRepo();
    const r = prep({ runId: 'wide' });
    expect(r.code).toBe(0);
    const m = r.out;
    expect(m).toMatchObject({ ok: true, status: 'DISPATCH', round: 'review', wave: '1 of 1', mode: { mode: 'full' }, depth: { mode: 'deep' }, maxConcurrentAgents: 8 });
    expect(m.mode.reasons).toContain('high-path');
    // the plan: three slices inside the limits, the whole round (six reviewers and the lane) in ONE wave
    expect(m.sizing.work).toEqual({ files: 19, lines: 1450 });
    expect(m.sizing.limits).toEqual({ sliceMaxFiles: 8, sliceTargetLines: 612, slicesAllowed: 3, slicesWanted: 3 });
    expect(m.sizing.slices.map((slice) => [slice.files, slice.lines, slice.overLimit, slice.diff])).toEqual([[8, 454, false, 'slice'], [3, 556, false, 'slice'], [8, 440, false, 'slice']]);
    expect(m.sizing.warnings).toEqual([]);
    const reviewers = m.agents.filter((a) => a.role === 'reviewer');
    expect(reviewers.map((a) => a.name)).toEqual(['reviewer-s1-a', 'reviewer-s1-b', 'reviewer-s2-a', 'reviewer-s2-b', 'reviewer-s3-a', 'reviewer-s3-b']);
    for (const a of reviewers) expect(a).toMatchObject({ deadlineMinutes: 15 });
    // the deadlines: 15 minutes for a slice the model says fits, 36 for the lane that took 17m45s on the run this is the shape of
    const lane = m.agents.find((a) => a.role === 'security');
    expect(lane).toMatchObject({ deadlineMinutes: 36, work: { files: 19, lines: 1450 } });
    expect((lane.deadlineAt - lane.dispatchedAt) / 60000).toBe(36);
    expect(lane.deadlineAt - lane.dispatchedAt).toBeGreaterThanOrEqual(17.75 * 60000 * 2);
    // each reviewer's brief names the diff of its slice, cut from the REAL `git diff`: the sections of its own paths and no one else's
    const sections = (text) => text.split('\n').filter((line) => line.startsWith('diff --git ')).map((line) => line.slice('diff --git a/'.length).split(' b/')[0]);
    for (const a of reviewers) {
      const brief = fs.readFileSync(a.briefPath, 'utf8');
      const diffPath = /Diff for your slice: (\S+)/.exec(brief)[1];
      expect(diffPath).toMatch(/\/slices\/slice-[123]\.diff$/);
      expect(sections(fs.readFileSync(diffPath, 'utf8'))).toEqual(a.paths);
      expect(brief).toContain('Timebox: 15 minutes');
    }
    const rangeDiff = /Diff: (\S+)/.exec(fs.readFileSync(lane.briefPath, 'utf8'))[1];
    expect(path.basename(rangeDiff)).toBe('range.diff');
    expect(sections(fs.readFileSync(rangeDiff, 'utf8'))).toHaveLength(19);
    // stand-in agents: every reviewer lists every path of its slice and the lane lists all 19, so nothing is left unreviewed
    answerReview(m, { changed: WIDE_LINES.map((_, index) => widePath(index)) });
    expect(coll('wide').out).toMatchObject({ ok: true, status: 'TRIAGE', security: { status: 'clean' }, coverage: { complete: true, unreviewedSlices: [], uncovered: [] } });
    process.stderr.write(`\nSMOKE sizing (the real run's shape): ${JSON.stringify({ wave: m.wave, agents: m.agents.length, limits: m.sizing.limits, slices: m.sizing.slices.map((slice) => ({ id: slice.id, files: slice.files, lines: slice.lines, diff: slice.diff })), deadlineMinutes: Object.fromEntries(m.agents.map((a) => [a.name, a.deadlineMinutes])) })}\n`);
    expect(snapshotRepo()).toEqual(before);
  });

  test('a High PR of the real run\'s shape (three slices) whose reviewer raises a candidate the verifier brief refuses: through the real process it ends DONE with that candidate UNVERIFIED (unbriefable), and every slice still carries its sized deadline (kata sfpb with kata 0g9n)', () => {
    setGh({ head: fx.wide });
    fs.rmSync(path.join(fx.work, '.ensemble', 'pr-review', 'pr-7.json'), { force: true });
    const before = snapshotRepo();
    const r = prep({ runId: 'wide-refused' });
    expect(r.code).toBe(0);
    const m = r.out;
    expect(m).toMatchObject({ ok: true, status: 'DISPATCH', round: 'review', wave: '1 of 1', mode: { mode: 'full' } });
    expect(m.sizing.slices.map((slice) => [slice.files, slice.diff])).toEqual([[8, 'slice'], [3, 'slice'], [8, 'slice']]);
    const sized = { 'reviewer-s1-a': 15, 'reviewer-s1-b': 15, 'reviewer-s2-a': 15, 'reviewer-s2-b': 15, 'reviewer-s3-a': 15, 'reviewer-s3-b': 15, 'security-lane': 36 };
    expect(Object.fromEntries(m.agents.map((a) => [a.name, a.deadlineMinutes]))).toEqual(sized);
    const changed = WIDE_LINES.map((_, index) => widePath(index));
    const KEY = 'compares the submitted key with the stored value using a loose equality so a type juggled key passes the check';
    // the reviewer of the SECOND slice (its 355-line file) raises a defect in its own slice whose wording the verifier brief refuses
    answerReview(m, { changed, findings: { 'reviewer-s2-a': [reviewerFinding({ locationOrLink: `${widePath(10)}:1`, originalTextOrLink: `${widePath(10)}:1`, failureMode: `the orchestrator ${KEY}` })] } });
    const triage = coll('wide-refused');
    expect(triage.code).toBe(0);
    expect(triage.out).toMatchObject({ ok: true, status: 'TRIAGE', security: { status: 'clean' }, coverage: { complete: true, unreviewedSlices: [], uncovered: [] } });
    expect(triage.out.candidates.map((c) => [c.id, c.unbriefable && c.unbriefable.kind])).toEqual([['f1', 'leak']]);
    expect(triage.out.slices.map((slice) => slice.paths.length)).toEqual([8, 3, 8]);
    const done = coll('wide-refused', { triage: {} });
    expect(done.code).toBe(0);
    expect(done.out).toMatchObject({ status: 'DONE', mode: { mode: 'full' }, votes: { reason: 'unbriefable-candidates' } });
    expect(done.out.notReviewed.unbriefable.map((u) => [u.id, u.kind])).toEqual([['f1', 'leak']]);
    expect(done.out.votes.outcomes.map((o) => [o.id, o.outcome, o.reason])).toEqual([['f1', 'unverified', 'unbriefable']]);
    expect(done.out.reducedReview).toMatch(/verification not-performed: unbriefable-candidates/);
    expect(done.out.reducedReview).toMatch(/UNVERIFIED, no verifier was asked [^\n]*: f1 \(leak, claim\)/);
    expect(done.out.reducedReview).toMatch(/cross-slice: 3 of 3 slices were each reviewed on their own slice's diff/);
    // the sized plan survived the unbriefable record: the same deadlines and slice diffs in the stored run, and no verify wave (nothing a verifier can be briefed with)
    const run = JSON.parse(fs.readFileSync(path.join(runDir('wide-refused'), 'run.json'), 'utf8'));
    expect(Object.fromEntries(run.waves[0].agents.map((a) => [a.name, a.deadlineMinutes]))).toEqual(sized);
    expect(run.sizing.slices.map((slice) => slice.diff)).toEqual(['slice', 'slice', 'slice']);
    expect(run.waves.map((wave) => wave.round)).toEqual(['review']);
    process.stderr.write(`\nSMOKE sized+refused: ${JSON.stringify({ deadlines: sized, outcomes: done.out.votes.outcomes.map((o) => `${o.id}:${o.outcome}:${o.reason}`), verification: done.out.votes.verification })}\n`);
    expect(snapshotRepo()).toEqual(before);
  });

  test('a MEDIUM PR of the real run\'s shape through the real process (light mode, three slices): ONE whole-range reader joins the slice reviewers and the lane in the one wave; a path it does not list leaves ITS read not reviewed while the slices stay reviewed; pr-review-cli timing stays ok (kata sfpb, review round 2)', () => {
    setGh({ head: fx.medwide });
    fs.rmSync(path.join(fx.work, '.ensemble', 'pr-review', 'pr-7.json'), { force: true });
    const before = snapshotRepo();
    const r = prep({ runId: 'medwide' });
    expect(r.code).toBe(0);
    const m = r.out;
    expect(m).toMatchObject({ ok: true, status: 'DISPATCH', round: 'review', wave: '1 of 1', mode: { mode: 'light' }, depth: { mode: 'standard' }, maxConcurrentAgents: 8 });
    expect(m.sizing.slices.map((slice) => [slice.files, slice.lines, slice.diff])).toEqual([[8, 454, 'slice'], [3, 556, 'slice'], [8, 440, 'slice']]);
    expect(m.sizing.wholeRangeReader).toBe(true);
    expect(m.agents.map((a) => a.name)).toEqual(['reviewer-s1-a', 'reviewer-s1-b', 'reviewer-s2-a', 'reviewer-s2-b', 'reviewer-s3-a', 'reviewer-s3-b', 'reviewer-range', 'security-lane']);
    const range = m.agents.find((a) => a.name === 'reviewer-range');
    expect(range).toMatchObject({ role: 'reviewer', deadlineMinutes: 36, work: { files: 19, lines: 1450 } });
    // its brief hands it the WHOLE range diff (a real git diff of all 19 files) and its deadline is the whole diff's
    const rangeBrief = fs.readFileSync(range.briefPath, 'utf8');
    expect(rangeBrief).toMatch(/^You are reviewing the whole of a pull request/); // its own brief: it reads the whole range, not a slice
    expect(rangeBrief).not.toMatch(/You are reviewing one slice|Your slice:/);
    const rangeDiff = /Diff for the whole range: (\S+)/.exec(rangeBrief)[1];
    expect(path.basename(rangeDiff)).toBe('range.diff');
    expect(fs.readFileSync(rangeDiff, 'utf8').split('\n').filter((line) => line.startsWith('diff --git '))).toHaveLength(19);
    // stand-in agents: the slice reviewers and the lane list everything; the whole-range reader stops after four paths
    const medPaths = WIDE_LINES.map((_, index) => widePath(index).replace(/^wide\//, 'med/'));
    answerReview(m, { changed: medPaths, partial: { 'reviewer-range': medPaths.slice(0, 4) } });
    const done = coll('medwide');
    expect(done.code).toBe(0);
    expect(done.out).toMatchObject({ status: 'DONE', mode: { mode: 'light' }, security: { status: 'clean' } });
    expect(done.out.notReviewed.unreviewedSlices).toEqual(['whole-range']);
    expect(done.out.notReviewed.unreviewedPaths).toEqual([]);
    expect(done.out.coverage.complete).toBe(false);
    expect(done.out.reducedReview).toMatch(/^NOT REVIEWED: whole-range read$/m);
    expect(done.out.reducedReview).toMatch(/whole-range read NOT REVIEWED \(reviewer-range: paths-not-reviewed; paths it did not list: med\/a05\.js/);
    // timing: ok, all eight agents counted, the reader is one more reviewer span in the same wave
    const t = spawnSync(process.execPath, [PR_REVIEW_CLI, 'timing'], { input: JSON.stringify({ runId: 'medwide', cwd: fx.work }), env: cliEnv(), encoding: 'utf8', cwd: fx.root });
    expect(t.status).toBe(0);
    const timing = JSON.parse(t.stdout);
    expect(timing.ok).toBe(true);
    expect(timing.agents).toMatchObject({ count: 8, unusable: [], byRole: { reviewer: { count: 7 }, 'security-lane': { count: 1 } } });
    process.stderr.write(`\nSMOKE medium-wide: ${JSON.stringify({ agents: m.agents.map((a) => `${a.name}:${a.deadlineMinutes}`), notReviewed: done.out.notReviewed.unreviewedSlices })}\n`);
    expect(snapshotRepo()).toEqual(before);
  });

  test('kata k48x, through the real process with stand-in agents: a MEDIUM PR holding the one approval it needs is mergeable when every reader arrived whole, and NOT mergeable when the whole-range reader is short or expired (a named blocker, a pending local phase, an Accept-only list entry); a replay says the same', () => {
    const approval = { user: { login: 'bob', type: 'User' }, state: 'APPROVED', commit_id: fx.medwide, submitted_at: '2026-01-01T00:00:00Z' };
    const medPaths = WIDE_LINES.map((_, index) => widePath(index).replace(/^wide\//, 'med/'));
    /** The reader's deadline passed with no result: what the collector measures arrival against is the stored run. */
    const expireAgent = (runId, name) => {
      const file = path.join(runDir(runId), 'run.json');
      const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const wave of stored.waves) {
        for (const agent of wave.agents) {
          if (agent.name !== name) continue;
          agent.dispatchedAt = Date.now() - 40 * 60 * 1000;
          agent.deadlineAt = Date.now() - 60 * 1000;
        }
      }
      fs.writeFileSync(file, JSON.stringify(stored));
    };
    const run = (runId, { answer = {}, expire } = {}) => {
      setGh({ head: fx.medwide, reviews: [approval] });
      fs.rmSync(path.join(fx.work, '.ensemble', 'pr-review', 'pr-7.json'), { force: true });
      const r = prep({ runId });
      expect(r.code).toBe(0);
      expect(r.out.agents.map((a) => a.name)).toContain('reviewer-range');
      answerReview(r.out, { changed: medPaths, ...answer });
      if (expire !== undefined) expireAgent(runId, expire);
      const done = coll(runId);
      expect(done.code).toBe(0);
      expect(done.out.status).toBe('DONE');
      return done.out;
    };

    const complete = run('cov-complete');
    expect(complete.gate).toMatchObject({ mergeable: true, blockers: [], coverage: { status: 'complete' } });
    expect(complete.reviewStatus.reasons.join(' ')).not.toMatch(/incomplete review coverage/);

    for (const [runId, options] of [
      ['cov-short', { answer: { partial: { 'reviewer-range': medPaths.slice(0, 4) } } }],
      ['cov-expired', { answer: { skip: ['reviewer-range'] }, expire: 'reviewer-range' }],
    ]) {
      const out = run(runId, options);
      expect([runId, out.gate.mergeable]).toEqual([runId, false]);
      expect([runId, out.gate.blockers.map((b) => b.code)]).toEqual([runId, ['review-coverage-incomplete']]); // approvals, description and the lane are fine: the coverage alone stops it
      expect(out.gate.blockers[0]).toMatchObject({ gapId: 'coverage:whole-range', gapType: 'whole-range' });
      expect(out.gate.coverage).toMatchObject({ status: 'incomplete', open: ['coverage:whole-range'] });
      expect(out.reviewStatus).toMatchObject({ status: 'REVIEW_PENDING', next: 'complete-review-coverage' });
      expect(out.reviewStatus.localPhase).not.toBe('LOCAL_REVIEW_COMPLETE');
      expect(out.gate.dispositionChoices.map((c) => [c.id, c.choices.map((x) => x.id)])).toEqual([['coverage:whole-range', ['accept']]]);
      expect(out.notReviewed.unreviewedSlices).toEqual(['whole-range']);
      expect(coll(runId).out.gate.mergeable).toBe(false); // the replay of the finished run is the stored answer, gap included
    }
  });

  test('through the real process: a triage claim the verifier brief refuses is triage-refused (exit 1, not terminal), and a mode label rewritten to light is mode-invariant (exit 1, nothing finalised) (review of PR 271)', () => {
    setGh({ head: fx.high });
    fs.rmSync(path.join(fx.work, '.ensemble', 'pr-review', 'pr-7.json'), { force: true });
    const r = prep({ runId: 'high-tamper' });
    expect(r.out).toMatchObject({ ok: true, status: 'DISPATCH', mode: { mode: 'full' } });
    answerReview(r.out, { changed: ['secure/key.js'] });
    expect(coll('high-tamper').out.status).toBe('TRIAGE');
    const refused = coll('high-tamper', { triage: { additionalCandidates: [{ locationOrLink: 'secure/key.js:1', failureMode: 'the verdict of the comparison is wrong', severity: 'important' }] } });
    expect(refused.code).toBe(1);
    expect(refused.out).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: 'triage-refused', error: expect.stringContaining('cannot be briefed to a verifier') });
    expect(coll('high-tamper').out.status).toBe('TRIAGE'); // the refusal is not terminal: the run still waits for triage
    const file = path.join(runDir('high-tamper'), 'run.json');
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    stored.mode.mode = 'light';
    fs.writeFileSync(file, JSON.stringify(stored));
    const tampered = coll('high-tamper', { triage: {} });
    expect(tampered.code).toBe(1);
    expect(tampered.out).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: 'mode-invariant' });
    expect(fs.existsSync(path.join(runDir('high-tamper'), 'final.json'))).toBe(false);
    expect(fs.existsSync(path.join(fx.work, '.ensemble', 'pr-review', 'pr-7.json'))).toBe(false);
  });

  // kata 0g9n, through the real process on the real git fixture and the real renderer: a candidate whose claim names the
  // orchestrator or a verdict, or whose path has whitespace, ends in a defined, named state -- never silently unverified.
  test('a LIGHT run: candidates that name the orchestrator or a verdict, or cite a path with a space, are kept UNVERIFIED with a named reason; the verifiable one still gets its three verifiers; the repository is untouched', () => {
    const before = snapshotRepo();
    const prepared = prep({ runId: 'refused-light' });
    expect(prepared.code).toBe(0);
    // the reviewers are told, in their own brief, what the verifier brief refuses
    const reviewerBrief = fs.readFileSync(prepared.out.agents[0].briefPath, 'utf8');
    expect(reviewerBrief).toMatch(/"orchestrator"[^]*"verdict"|"verdict"[^]*"orchestrator"/);
    expect(reviewerBrief).toMatch(/a finding it refuses is NOT verified/);
    expect(fs.readFileSync(prepared.out.agents.find((a) => a.role === 'security').briefPath, 'utf8')).not.toMatch(/unbriefable/);
    answerReview(prepared.out, {
      findings: {
        'reviewer-s1-a': [
          reviewerFinding({ failureMode: 'the orchestrator never rereads the list after the cache went stale' }),
          reviewerFinding({ failureMode: 'the verdict of the comparison is wrong for an empty list', locationOrLink: 'src/b.js:1', originalTextOrLink: 'src/b.js:1' }),
          reviewerFinding({ failureMode: 'a file name with a space in it is read without a length check', locationOrLink: 'src/my file.js:1', originalTextOrLink: 'src/my file.js:1' }),
          reviewerFinding({ failureMode: 'list[i + 1] reads one past the end on the last element and returns undefined' }),
        ],
      },
    });
    const verify = coll('refused-light');
    expect(verify.code).toBe(0);
    expect(verify.out).toMatchObject({ status: 'DISPATCH', round: 'verify' });
    const asked = {};
    for (const a of verify.out.agents) for (const id of a.candidateIds) asked[id] = (asked[id] || 0) + 1;
    expect(asked).toEqual({ f4: 3 }); // f1 (orchestrator), f2 (verdict) and f3 (a space) are not briefable; f4 is, by three verifiers
    answerVotes(verify.out, 'real');
    const done = coll('refused-light');
    expect(done.code).toBe(0);
    expect(done.out).toMatchObject({ status: 'DONE', votes: { verification: 'partial', reason: 'unbriefable-candidates' } });
    expect(done.out.notReviewed.unbriefable.map((u) => [u.id, u.kind, u.input])).toEqual([['f1', 'leak', 'claim'], ['f2', 'leak', 'claim'], ['f3', 'path', 'location']]);
    expect(done.out.votes.outcomes.map((o) => [o.id, o.outcome, o.reason])).toEqual([['f1', 'unverified', 'unbriefable'], ['f2', 'unverified', 'unbriefable'], ['f3', 'unverified', 'unbriefable'], ['f4', 'present', 'verifier-majority']]);
    expect(done.out.reducedReview).toMatch(/UNVERIFIED, no verifier was asked[^\n]*: f1 \(leak, claim\), f2 \(leak, claim\), f3 \(path, location\)/);
    // the gate holds every one of them open, and the operator's list says which were never put to a verifier, and why
    expect(done.out.gate.mergeable).toBe(false);
    const list = done.out.gate.dispositionChoices;
    expect(list.filter((c) => c.verification !== undefined).map((c) => [c.id, c.votes, c.verification.reason])).toEqual([['f1', null, 'unbriefable'], ['f2', null, 'unbriefable'], ['f3', null, 'unbriefable']]);
    expect(list.find((c) => c.id === 'f4')).toMatchObject({ votes: { real: 3, expected: 3 } });
    // the state report the gate and the merge flow read carries the same named state
    const state = JSON.parse(fs.readFileSync(path.join(fx.work, '.ensemble', 'pr-review', 'pr-7.json'), 'utf8'));
    expect(state.notReviewed.unbriefable).toHaveLength(3);
    expect(state.ledger.filter((e) => e.verification.reason === 'unbriefable').map((e) => e.id)).toEqual(['f1', 'f2', 'f3']);
    expect(state.verification).toMatchObject({ verification: 'partial', reason: 'unbriefable-candidates', recoveryAction: 'reword-the-claim-or-decide' });
    process.stderr.write(`\nSMOKE refused-light: ${JSON.stringify({ asked, votes: done.out.votes.verification, reason: done.out.votes.reason, unbriefable: done.out.notReviewed.unbriefable.map((u) => `${u.id}:${u.kind}:${u.input}`), operatorList: list.map((c) => ({ id: c.id, votes: c.votes, verification: c.verification && c.verification.reason })) })}\n`);
    expect(snapshotRepo()).toEqual(before);
  });

  test('a FULL run: TRIAGE names the refused candidate, the orchestrator ADDs a restatement that the renderer accepts, five verifiers settle it, and the refused one stays unverified, named, for a person', () => {
    setGh({ head: fx.high });
    fs.rmSync(path.join(fx.work, '.ensemble', 'pr-review', 'pr-7.json'), { force: true });
    const before = snapshotRepo();
    const r = prep({ runId: 'refused-full' });
    expect(r.out).toMatchObject({ ok: true, status: 'DISPATCH', mode: { mode: 'full' } });
    const KEY = 'compares the submitted key with the stored value using a loose equality so a type juggled key passes the check';
    answerReview(r.out, {
      changed: ['secure/key.js'],
      findings: {
        'reviewer-s1-a': [reviewerFinding({ locationOrLink: 'secure/key.js:1', originalTextOrLink: 'secure/key.js:1', failureMode: `the orchestrator ${KEY}` })],
        'reviewer-s1-b': [reviewerFinding({ locationOrLink: 'secure/key.js:1', originalTextOrLink: 'secure/key.js:1', failureMode: 'a second unrelated defect in the retry loop of the client library leaks a handle on every timeout' })],
      },
    });
    const triage = coll('refused-full');
    expect(triage.code).toBe(0);
    expect(triage.out).toMatchObject({ ok: true, status: 'TRIAGE' });
    expect(triage.out.candidates.map((c) => [c.id, c.unbriefable && c.unbriefable.kind])).toEqual([['f1', 'leak'], ['f2', undefined]]);
    expect(triage.out.rules.join(' ')).toMatch(/will NOT be put to any verifier/);
    const verify = coll('refused-full', { triage: { additionalCandidates: [{ locationOrLink: 'secure/key.js:1', failureMode: `the submitted key is ${KEY.replace('compares the submitted key', 'compared')}`, severity: 'important' }] } });
    expect(verify.code).toBe(0);
    expect(verify.out).toMatchObject({ status: 'DISPATCH', round: 'verify' });
    const asked = {};
    for (const a of verify.out.agents) for (const id of a.candidateIds) asked[id] = (asked[id] || 0) + 1;
    expect(asked).toEqual({ f2: 5, f3: 5 });
    answerVotes(verify.out, 'real');
    const done = coll('refused-full');
    expect(done.code).toBe(0);
    expect(done.out).toMatchObject({ status: 'DONE', mode: { mode: 'full' }, triage: { requested: 1, additionalCandidateIds: ['f3'], mergedIntoExisting: 0 } });
    expect(done.out.notReviewed.unbriefable.map((u) => [u.id, u.kind])).toEqual([['f1', 'leak']]);
    expect(done.out.votes.outcomes.map((o) => [o.id, o.outcome, o.reason])).toEqual([['f1', 'unverified', 'unbriefable'], ['f2', 'present', 'verifier-majority'], ['f3', 'present', 'verifier-majority']]);
    expect(done.out.ledger.map((e) => e.source)).toEqual(['reviewer-s1-a', 'reviewer-s1-b', 'orchestrator']);
    expect(done.out.gate.dispositionChoices.find((c) => c.id === 'f1')).toMatchObject({ votes: null, verification: { reason: 'unbriefable', unbriefable: { kind: 'leak', input: 'claim' } } });
    process.stderr.write(`\nSMOKE refused-full: ${JSON.stringify({ triageFlag: triage.out.candidates[0].unbriefable.kind, asked, outcomes: done.out.votes.outcomes.map((o) => `${o.id}:${o.outcome}:${o.reason}`) })}\n`);
    expect(snapshotRepo()).toEqual(before);
  });

  test('a head that moves between prepare and collect is RUN_INVALIDATED: exit 1, no ledger, no gate, no state report', () => {
    fs.rmSync(path.join(fx.work, '.ensemble', 'pr-review', 'pr-7.json'), { force: true });
    const review = prep({ runId: 'moved' }).out;
    answerReview(review);
    setGh({ head: 'd'.repeat(40) });
    const r = coll('moved');
    expect(r.code).toBe(1);
    expect(r.out).toMatchObject({ ok: false, status: 'RUN_INVALIDATED', reason: 'head-moved', expectedHead: fx.head, currentHead: 'd'.repeat(40) });
    expect(fs.existsSync(path.join(runDir('moved'), 'final.json'))).toBe(false);
    expect(fs.existsSync(path.join(fx.work, '.ensemble', 'pr-review', 'pr-7.json'))).toBe(false);
    setGh();
    expect(coll('moved').out.status).toBe('RUN_INVALIDATED');
  });

  test('a finished run whose head moved afterwards is RUN_INVALIDATED and its stored mergeable answer is never replayed (review of PR 264, P1)', () => {
    setGh({ reviews: [{ user: { login: 'bob', type: 'User' }, state: 'APPROVED', commit_id: fx.head, submitted_at: '2026-01-01T00:00:00Z' }] });
    const review = prep({ runId: 'done-then-moved' }).out;
    answerReview(review);
    const done = coll('done-then-moved');
    expect(done.out).toMatchObject({ status: 'DONE', gate: { mergeable: true } });

    setGh({ head: 'd'.repeat(40) });
    const moved = coll('done-then-moved');
    expect(moved.code).toBe(1);
    expect(moved.out).toMatchObject({ ok: false, status: 'RUN_INVALIDATED', reason: 'head-moved', expectedHead: fx.head, currentHead: 'd'.repeat(40) });
    expect(moved.stdout).not.toContain('mergeable');

    // the head back on the reviewed commit: the stored answer is the answer for that head again
    setGh();
    expect(coll('done-then-moved').out).toEqual(done.out);
  });

  test('a reviewer that never arrives: after its deadline the run is DONE with the slice NOT reviewed', () => {
    const review = prep({ runId: 'late' }).out;
    answerReview(review, { skip: ['reviewer-s1-b'] });
    const r = coll('late', { now: review.agents[1].deadlineAt + 60000 });
    expect(r.code).toBe(0);
    expect(r.out.status).toBe('DONE');
    expect(r.out.notReviewed.unreviewedSlices).toEqual(['whole-pr']);
    expect(r.out.notReviewed.expiredAgents.map((a) => a.name)).toEqual(['reviewer-s1-b']);
    expect(r.out.coverage.complete).toBe(false);
  });

  test('the process boundary rejects bad input as {ok:false} with exit 1', () => {
    expect(cli('nonsense', {})).toMatchObject({ code: 1, out: { ok: false, error: expect.stringContaining('unknown subcommand') } });
    expect(cli('prepare', null, { raw: 'not json' })).toMatchObject({ code: 1, out: { ok: false, error: expect.stringContaining('cannot read the payload') } });
    expect(cli('prepare', null, { raw: '' })).toMatchObject({ code: 1, out: { ok: false } });
    expect(prep({ dryrun: true })).toMatchObject({ code: 1, out: { ok: false, status: 'RUN_FAILED', reason: 'invalid-input' } });
    expect(cli('prepare', [1, 2])).toMatchObject({ code: 1, out: { ok: false, reason: 'invalid-input' } });
    expect(coll('does-not-exist')).toMatchObject({ code: 1, out: { ok: false, reason: 'run-not-found' } });
    expect(cli('collect', { repoRoot: fx.work, runId: 'x', stray: 1 })).toMatchObject({ code: 1, out: { reason: 'invalid-input' } });
  });

  test('output is redacted: a token-shaped string in a finding never reaches stdout or the files', () => {
    const secret = `ghp_${'A'.repeat(30)}`;
    const review = prep({ runId: 'secret' }).out;
    answerReview(review, { findings: { 'reviewer-s1-a': [reviewerFinding({ evidence: `the token ${secret} is logged`, uncertain: true })] } });
    const verify = coll('secret').out;
    answerVotes(verify);
    const r = coll('secret');
    expect(r.stdout).not.toContain(secret);
    expect(fs.readFileSync(path.join(runDir('secret'), 'final.json'), 'utf8')).not.toContain(secret);
    expect(fs.readFileSync(path.join(runDir('secret'), 'run.json'), 'utf8')).not.toContain(secret);
  });
});

describe('a head from outside this repository is never run (review of PR 264, P0)', () => {
  // `node` runs each related test file as a script: the head's own code, exactly what the baseline executes.
  const withNode = { testCommand: [process.execPath] };
  beforeEach(() => fs.rmSync(fx.marker, { force: true }));

  test('control: a same-repository head is prepared and its baseline runs the head\'s own test code', () => {
    setGh({ head: fx.exec });
    const r = prep({ runId: 'exec-control', ...withNode });
    expect(r.code).toBe(0);
    expect(r.out).toMatchObject({ ok: true, status: 'DISPATCH' });
    expect(fs.readFileSync(fx.marker, 'utf8')).toBe('the head code ran');
  });

  test.each([
    ['a fork head', true, 'cross-repository-head'],
    ['a head whose repository GitHub did not state', 'omit', 'head-repository-unknown'],
  ])('%s is refused by name: its code never runs, nothing is fetched, prepared or posted', (_label, isCrossRepository, reason) => {
    setGh({ head: fx.exec, isCrossRepository });
    const runId = `refused-${reason}`;
    const r = prep({ runId, ...withNode });
    expect(r.code).toBe(1);
    expect(r.out).toMatchObject({ ok: false, status: 'RUN_FAILED', reason, headSha: fx.exec });
    expect(fs.existsSync(fx.marker)).toBe(false);
    expect(fs.existsSync(runDir(runId))).toBe(false);
    expect(fs.existsSync(path.join(fx.work, '.ensemble', 'pr-review', 'prepare', runId))).toBe(false);
    // the one read of the PR is the only host call: no precheck comment, no gate, no reviews read
    const calls = ghLog();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((a) => a[0] === 'pr' && a[1] === 'view')).toBe(true);
  });

  // review of PR 264, round 2 (P2): the guard sits before the precheck/fetch/prepare split, so no option that skips one of those steps may skip it
  test.each([
    ['a fork head', true, 'cross-repository-head', { skipPrecheck: true }],
    ['a fork head', true, 'cross-repository-head', { dryRun: true }],
    ['a fork head', true, 'cross-repository-head', { skipPrecheck: true, dryRun: true }],
    ['a head whose repository GitHub did not state', 'omit', 'head-repository-unknown', { skipPrecheck: true }],
    ['a head whose repository GitHub did not state', 'omit', 'head-repository-unknown', { dryRun: true }],
  ])('%s is refused by name under %j too: its code never runs, nothing is fetched, prepared or posted', (_label, isCrossRepository, reason, options) => {
    setGh({ head: fx.exec, isCrossRepository });
    const runId = `refused-${reason}-${Object.keys(options).join('-')}`;
    const r = prep({ runId, ...withNode, ...options });
    expect(r.code).toBe(1);
    expect(r.out).toMatchObject({ ok: false, status: 'RUN_FAILED', reason, headSha: fx.exec });
    expect(fs.existsSync(fx.marker)).toBe(false);
    expect(fs.existsSync(runDir(runId))).toBe(false);
    expect(fs.existsSync(path.join(fx.work, '.ensemble', 'pr-review', 'prepare', runId))).toBe(false);
    const calls = ghLog();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((a) => a[0] === 'pr' && a[1] === 'view')).toBe(true);
  });
});

describe('the PR and its base are read from the host, not taken from the caller (review of PR 264, P2)', () => {
  test.each(['MERGED', 'CLOSED'])('a %s PR is refused: no agents, no precheck comment, no run', (prState) => {
    setGh({ prState });
    const r = prep({ runId: `not-open-${prState}` });
    expect(r.code).toBe(1);
    expect(r.out).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: 'pr-not-open', prState });
    expect(fs.existsSync(runDir(`not-open-${prState}`))).toBe(false);
    expect(ghLog().filter((a) => a.includes('-X'))).toEqual([]);
  });

  test('a baseSha inside the PR would grade only its suffix: refused, naming the real merge base; the merge base itself is accepted and the whole range is reviewed', () => {
    setGh({ head: fx.exec });
    const inside = git(fx.work, 'rev-parse', 'feature'); // exec = feature + one commit, so `feature` is a commit inside the PR
    const mergeBase = git(fx.work, 'rev-parse', 'main');
    const refused = prep({ runId: 'base-inside', baseSha: inside, testFiles: [] });
    expect(refused.code).toBe(1);
    expect(refused.out).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: 'base-not-merge-base' });
    expect(refused.out.error).toContain(inside);
    expect(refused.out.error).toContain(mergeBase);
    expect(fs.existsSync(runDir('base-inside'))).toBe(false);

    const accepted = prep({ runId: 'base-merge-base', baseSha: mergeBase, testFiles: [] });
    expect(accepted.code).toBe(0);
    expect(accepted.out).toMatchObject({ ok: true, status: 'DISPATCH' });
    const run = JSON.parse(fs.readFileSync(path.join(runDir('base-merge-base'), 'run.json'), 'utf8'));
    expect(run.baseSha).toBe(mergeBase);
    expect(run.changedPaths).toEqual(['src/a.js', 'src/b.js', 'src/b.test.js']); // not just the last commit's file
  });
});

describe('a pre-existing citation is checked against the head snapshot the real prepare made (review of PR 264, round 3)', () => {
  const posix = process.platform === 'win32' ? test.skip : test;
  const claim = (location, failureMode) => reviewerFinding({ severity: 'pre-existing', locationOrLink: location, originalTextOrLink: location, failureMode });
  const byId = (done) => Object.fromEntries(done.out.ledger.map((entry) => [entry.id, entry]));

  test('a line past the end of a file and a mis-cased path stay in the gate; the real path and line of a file the PR does not touch do not (findings 2 and 5)', () => {
    const review = prep({ runId: 'cited-head' }).out;
    answerReview(review, {
      findings: {
        'reviewer-s1-a': [
          claim('README.md:1', 'the fixture readme says nothing about how to run it'),
          claim('README.md:99999', 'the readme has a line nobody wrote that is wrong'),
          claim('readme.md:1', 'the readme named with the wrong case is wrong'),
        ],
      },
    });
    const verify = coll('cited-head').out;
    expect(verify).toMatchObject({ status: 'DISPATCH', round: 'verify' });
    answerVotes(verify, 'real');
    const done = coll('cited-head');
    expect(done.out.status).toBe('DONE');
    const ledger = byId(done);
    expect(ledger.f1.severity).toBe('pre-existing');
    expect(ledger.f2).toMatchObject({ severity: 'important', claimedSeverity: 'pre-existing', severityNote: expect.stringContaining('README.md has 1 line, so line 99999 is past its end') });
    expect(ledger.f3).toMatchObject({ severity: 'important', claimedSeverity: 'pre-existing', severityNote: expect.stringContaining('readme.md is not a file at this head') });
    expect(done.out.gate.findings).toMatchObject({ open: ['f2', 'f3'], preExisting: 1 });
    expect(done.out.gate.mergeable).toBe(false);
  });

  posix('a symlink the PR adds, pointing at a FIFO, is refused: collect returns and the claim stays in the gate (finding 1)', () => {
    setGh({ head: fx.link });
    const review = prep({ runId: 'fifo-link' }).out;
    expect(review).toMatchObject({ ok: true, status: 'DISPATCH' });
    // the snapshot is the head's tree, links included: src/evil.js -> ../../escape lands beside the snapshot, in the prepared directory
    const snapshot = JSON.parse(fs.readFileSync(path.join(runDir('fifo-link'), 'run.json'), 'utf8')).prepared.snapshotDir;
    expect(fs.readlinkSync(path.join(snapshot, 'src', 'evil.js'))).toBe('../../escape');
    execFileSync('mkfifo', [path.join(snapshot, '..', 'escape')]);
    answerReview(review, { changed: ['src/a.js', 'src/b.js', 'src/evil.js'], findings: { 'reviewer-s1-a': [claim('src/evil.js:1', 'the link is followed to a file the PR does not control')] } });
    // a deadline on every collect: one that opened the FIFO would block forever, and the test must fail rather than hang
    const collect = () => cli('collect', { repoRoot: fx.work, runId: 'fifo-link' }, { timeout: 30000 });
    const first = collect();
    expect(first.error).toBeUndefined();
    expect(first.out).toMatchObject({ status: 'DISPATCH', round: 'verify' });
    answerVotes(first.out, 'real');
    const done = collect();
    expect(done.error).toBeUndefined();
    expect(done.out.status).toBe('DONE');
    expect(byId(done).f1).toMatchObject({ severity: 'important', claimedSeverity: 'pre-existing', severityNote: expect.stringContaining('src/evil.js is not a file at this head') });
    expect(done.out.gate.mergeable).toBe(false);
  }, 120000);
});

describe('in-process: every process the runner starts is recorded', () => {
  const FORBIDDEN_GIT = /^(push|checkout|switch|reset|stash|commit|add|rebase|apply|merge|cherry-pick|revert|clean|rm|mv|restore|pull|tag|branch|update-ref|worktree|am|gc|prune)$/;

  test('no git call of a whole run (runner, precheck and prepare) edits, resets or pushes; the only gh write is the precheck comment', async () => {
    const calls = [];
    const real = require('../lib/review-run-cli').defaultRun;
    const run = async (cmd, args, opts) => {
      calls.push([cmd, ...args]);
      return real(cmd, args, opts);
    };
    const gitRecorded = (args, opts) => {
      calls.push(['git(prepare)', ...args]);
      return prepareGit().git(args, opts);
    };
    const injected = {
      run,
      prepareReview: (options) => prepareReview(options, { git: gitRecorded }),
    };
    const old = process.env;
    process.env = cliEnv();
    try {
      const payloads = [];
      const exec = async (command, payload) => {
        payloads.push(command);
        return execute(command, { ...injected, readJson: () => payload });
      };
      const p = await exec('prepare', { repo: 'o/r', pr: 7, repoRoot: fx.work, runId: 'inproc', agentAuthored: false });
      expect(p.code).toBe(0);
      answerReview(p.result, { findings: { 'reviewer-s1-a': [reviewerFinding()] } });
      const v = await exec('collect', { repoRoot: fx.work, runId: 'inproc' });
      expect(v.result.status).toBe('DISPATCH');
      answerVotes(v.result);
      const d = await exec('collect', { repoRoot: fx.work, runId: 'inproc' });
      expect(d.result.status).toBe('DONE');
    } finally {
      process.env = old;
    }
    const gits = calls.filter((c) => c[0] === 'git' || c[0] === 'git(prepare)');
    expect(gits.length).toBeGreaterThan(5);
    for (const c of gits) {
      expect(c[1]).not.toMatch(FORBIDDEN_GIT);
      if (c[1] === 'archive') expect(c).toEqual(expect.arrayContaining(['--format=tar', '-o']));
    }
    const ghWrites = calls.filter((c) => c[0] === 'gh' && c.includes('-X'));
    expect(ghWrites).toHaveLength(1);
    expect(ghWrites[0].slice(0, 4)).toEqual(['gh', 'api', '-X', 'POST']);
    expect(calls.filter((c) => c[0] === 'gh').every((c) => c[1] === 'api' || (c[1] === 'pr' && c[2] === 'view'))).toBe(true);
  });

  test('main() prints one redacted JSON line and returns the exit code', async () => {
    let text = '';
    const code = await main(['prepare'], { readJson: () => ({ repo: 'o/r', pr: 7, repoRoot: 'relative/path', runId: 'x' }) }, (t) => { text += t; });
    expect(code).toBe(1);
    expect(JSON.parse(text)).toMatchObject({ ok: false, reason: 'invalid-input' });
    expect(buildDeps({ repo: 'o/r', pr: 1, repoRoot: fx.work }, {}).notices).toEqual([]);
  });
});

describe('collect reads nothing for a runId collect would refuse (kata yz76: peekRun before validateCollect)', () => {
  const SCRATCH = path.join(os.homedir(), '.omp', 'pr-review-speedup', 'yz76', `t${process.pid}`);
  const root = path.join(SCRATCH, 'repo');
  const runBase = path.join(root, '.ensemble', 'pr-review', 'run');
  const outside = path.join(SCRATCH, 'outside');
  const canary = JSON.stringify({ repo: 'evil/evil', pr: 99 });
  let reads;
  let spy;

  beforeEach(() => {
    fs.rmSync(SCRATCH, { recursive: true, force: true });
    fs.mkdirSync(runBase, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'run.json'), canary);
    fs.mkdirSync(path.join(runBase, 'real'));
    fs.writeFileSync(path.join(runBase, 'real', 'run.json'), JSON.stringify({ repo: 'o/r', pr: 7 }));
    reads = [];
    const original = fs.readFileSync;
    spy = jest.spyOn(fs, 'readFileSync').mockImplementation((file, ...rest) => {
      if (typeof file === 'string' && file.startsWith(SCRATCH)) reads.push(file);
      return original.call(fs, file, ...rest);
    });
  });
  afterEach(() => {
    spy.mockRestore();
    fs.rmSync(SCRATCH, { recursive: true, force: true });
  });

  const collectOf = (payload) => execute('collect', { readJson: () => payload });
  const peeked = () => reads.filter((file) => file.endsWith('run.json'));

  test.each([
    ['dot-dot segments', '../../../../outside'],
    ['four dot-dots reaching the outside run.json', '../../../../outside'],
    ['a nested path', 'real/../real'],
    ['an absolute path', outside],
    ['a backslash path', '..\\outside'],
    ['a dotted name', 'real.json'],
    ['empty', ''],
    ['over-long (129 characters)', 'a'.repeat(129)],
    ['a NUL byte', 'real\0x'],
    ['not text', 7],
  ])('%s: invalid-input and run.json is never read', async (_label, runId) => {
    const answer = await collectOf({ repoRoot: root, runId });
    expect(answer.code).toBe(1);
    expect(answer.result).toMatchObject({ ok: false, reason: 'invalid-input' });
    expect(peeked()).toEqual([]);
  });

  test('a relative repoRoot is not read from either', async () => {
    const answer = await collectOf({ repoRoot: path.relative(process.cwd(), root), runId: 'real' });
    expect(answer.result).toMatchObject({ ok: false, reason: 'invalid-input' });
    expect(peeked()).toEqual([]);
  });

  test('a run directory that is a symlink out of the run area is not followed', async () => {
    fs.symlinkSync(outside, path.join(runBase, 'linked'));
    expect(peekRun({ repoRoot: root, runId: 'linked' })).toEqual({});
    expect(peeked()).toEqual([]);
  });

  test('a run.json that is a symlink to a file elsewhere is not read', async () => {
    fs.mkdirSync(path.join(runBase, 'sneaky'));
    fs.symlinkSync(path.join(outside, 'run.json'), path.join(runBase, 'sneaky', 'run.json'));
    expect(peekRun({ repoRoot: root, runId: 'sneaky' })).toEqual({});
    expect(peeked()).toEqual([]);
  });

  test('a real run is still peeked (the guard does not refuse good input)', async () => {
    expect(peekRun({ repoRoot: root, runId: 'real' })).toEqual({ repo: 'o/r', pr: 7 });
    expect(peeked()).toEqual([path.join(runBase, 'real', 'run.json')]);
  });

  // ---- the loader and the writers: the same containment, not only the peek (review round 1)
  const stored = () => JSON.stringify({ schema: 1, runId: 'linked', repoRoot: root, repo: 'o/r', pr: 7, phase: 'collecting', marker: 'untouched' });
  const noRun = { run: async () => ({ code: 1, stdout: '', stderr: 'no process runs here' }) };
  const answerOf = (promise) => promise.then((answer) => answer.result);
  const link = (name, target) => fs.symlinkSync(target, path.join(runBase, name));

  test('collect does not load or rewrite a run through a symlinked run directory', async () => {
    fs.writeFileSync(path.join(outside, 'run.json'), stored());
    link('linked', outside);
    const result = await answerOf(execute('collect', { readJson: () => ({ repoRoot: root, runId: 'linked' }), ...noRun }));
    expect(result.ok).toBe(false);
    expect(result.reason).not.toBe('mode-invariant');
    expect(fs.readFileSync(path.join(outside, 'run.json'), 'utf8')).toBe(stored());
    expect(fs.readdirSync(outside)).toEqual(['run.json']);
  });

  test('collect does not load a symlinked run.json, and leaves its target and the link as they were', async () => {
    fs.mkdirSync(path.join(runBase, 'linked'));
    fs.writeFileSync(path.join(outside, 'target.json'), stored());
    fs.symlinkSync(path.join(outside, 'target.json'), path.join(runBase, 'linked', 'run.json'));
    const result = await answerOf(execute('collect', { readJson: () => ({ repoRoot: root, runId: 'linked' }), ...noRun }));
    expect(result.ok).toBe(false);
    expect(result.reason).not.toBe('mode-invariant');
    expect(fs.readFileSync(path.join(outside, 'target.json'), 'utf8')).toBe(stored());
    expect(fs.lstatSync(path.join(runBase, 'linked', 'run.json')).isSymbolicLink()).toBe(true);
  });

  test('a dangling run.json link is refused, never written through or replaced', () => {
    fs.mkdirSync(path.join(runBase, 'linked'));
    fs.symlinkSync(path.join(outside, 'nothing.json'), path.join(runBase, 'linked', 'run.json'));
    const area = realFs({ runArea: runBase });
    expect(() => area.readText(path.join(runBase, 'linked', 'run.json'))).toThrow(/symbolic link/);
    expect(() => area.writeAtomic(path.join(runBase, 'linked', 'run.json'), 'x', 0o600)).toThrow(/symbolic link/);
    expect(fs.existsSync(path.join(outside, 'nothing.json'))).toBe(false);
    expect(fs.lstatSync(path.join(runBase, 'linked', 'run.json')).isSymbolicLink()).toBe(true);
  });

  test('the guard covers a link at any depth below the run area, directories and writes included, and nothing outside it', () => {
    link('linked', outside);
    const area = realFs({ runArea: runBase });
    expect(() => area.mkdirp(path.join(runBase, 'linked', 'results'), 0o700)).toThrow(/symbolic link/);
    expect(() => area.writeAtomic(path.join(runBase, 'linked', 'results', 'final.json'), 'x', 0o600)).toThrow(/symbolic link/);
    expect(fs.readdirSync(outside).sort()).toEqual(['run.json']);
    expect(area.readText(path.join(runBase, 'real', 'run.json'))).toContain('o/r');
    expect(area.readText(path.join(runBase, 'real', 'missing.json'))).toBeNull();
    expect(area.readText(path.join(outside, 'run.json'))).toBe(canary);
  });

  test('the result collector is not pointed through a link either', () => {
    link('linked', outside);
    const deps = buildDeps({ repo: 'o/r', pr: 7, repoRoot: root }, noRun);
    expect(() => deps.collectResults({ expected: [], dir: path.join(runBase, 'linked', 'results', '1'), now: Date.now() })).toThrow(/symbolic link/);
  });

  test('prepare does not treat a symlinked run directory as an existing run or write through it', async () => {
    link('linked', outside);
    const result = await answerOf(execute('prepare', { readJson: () => ({ repo: 'o/r', pr: 7, repoRoot: root, runId: 'linked', agentAuthored: false }), ...noRun }));
    expect(result.ok).toBe(false);
    expect(fs.readdirSync(outside)).toEqual(['run.json']);
  });
});
