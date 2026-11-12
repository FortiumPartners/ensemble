'use strict';

/**
 * Kata bh8w, through the real review-run CLI: a fix that only ADDS lines (`git diff -U0`: `@@ -104,0 +105,5 @@`) strictly inside a cited
 * range touches the finding it fixes, so the runner clears it when nobody raises it again; an insertion outside the range, or right
 * before its first line or right after its last, keeps it. Measured in the live delta `m2-pr291-re`: five lines added inside the
 * cited range 583-601 of Important f3 left it an open blocker.
 *
 * Real: git (an origin, a clone, a 19-file Medium PR, fix pushes), the CLI process (prepare and collect), prepare, the delta plan, the
 * carry hash, the fixed-finding check, the verify plan, the state report and the run files. Faked: `gh` (an executable stub first on
 * PATH) and the agents, which are this test writing `out-<name>.json` files exactly as a dispatched agent would.
 *
 * Fixtures live under ~/.omp/pr-review-speedup/prs-carry/fixtures (never /tmp) and are removed afterwards.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

jest.setTimeout(240000);

const CLI = path.join(__dirname, '..', 'lib', 'review-run-cli.js');
const FIXTURES = path.join(os.homedir(), '.omp', 'pr-review-speedup', 'prs-carry', 'fixtures');
const BODY = '## Testing\nran the relevant tests\n\n## Risk\nlow\n\n## How to revert\nrevert the commit\n';
const POLICY = '# Review\n\n```ensemble-review-policy\n{"sensitivePaths":["secure/**"],"highPaths":["wide/**"]}\n```\n';
/** The changed lines of the 19 paths of the Medium PR (the shape of the one real run): three slices, a whole-range reader and the lane. */
const LINES = [1, 127, 1, 159, 1, 145, 12, 8, 76, 125, 355, 38, 1, 8, 76, 159, 1, 145, 12];
const medPath = (index) => `med/a${String(index + 1).padStart(2, '0')}.js`;
const ALL_PATHS = LINES.map((_, index) => medPath(index));
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
  const pr = { headRefOid: state.head, baseRefName: 'main', state: state.prState || 'OPEN', body: state.body, author: { login: 'alice' }, isCrossRepository: state.isCrossRepository === undefined ? false : state.isCrossRepository };
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

/** origin + clone; `main` holds the policy; `head1` is the 19-file Medium PR; branches for each follow-up head are made by the tests. */
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
  LINES.forEach((count, index) => write(work, medPath(index), body(count)));
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'a wide Medium PR');
  fs.appendFileSync(path.join(work, '.git', 'info', 'exclude'), '.ensemble/\n');
  return { root, origin, work, bin, head1: git(work, 'rev-parse', 'HEAD'), baseSha: git(work, 'rev-parse', 'main'), stateFile: path.join(root, 'gh-state.json'), logFile: path.join(root, 'gh.log') };
}

beforeAll(() => {
  fx = buildFixture();
});

afterAll(() => {
  spawnSync('chmod', ['-R', 'u+w', fx.root]);
  fs.rmSync(fx.root, { recursive: true, force: true });
});

const setGh = (over = {}) => fs.writeFileSync(fx.stateFile, JSON.stringify({ head: fx.head1, body: BODY, reviews: [], ...over }));
beforeEach(() => {
  setGh();
  fs.writeFileSync(fx.logFile, '');
});

const cliEnv = () => ({ ...process.env, PATH: `${fx.bin}${path.delimiter}${process.env.PATH}`, STUB_GH_STATE: fx.stateFile, STUB_GH_LOG: fx.logFile, GIT_CONFIG_GLOBAL: '/dev/null' });

/** Runs the real CLI process: `{code, out}` with stdout parsed as the one JSON object. */
function cli(command, payload) {
  const r = spawnSync(process.execPath, [CLI, command], { input: JSON.stringify(payload), env: cliEnv(), encoding: 'utf8', cwd: fx.root, timeout: 180000 });
  let out;
  try {
    out = JSON.parse(r.stdout);
  } catch (error) {
    out = { unparsable: r.stdout, stderr: r.stderr, error: r.error && r.error.message };
  }
  return { code: r.status, out };
}
const prep = (runId, extra = {}) => cli('prepare', { repo: 'o/r', pr: 7, repoRoot: fx.work, runId, agentAuthored: false, ...extra });
const coll = (runId, extra = {}) => cli('collect', { repoRoot: fx.work, runId, ...extra });
const statePath = () => path.join(fx.work, '.ensemble', 'pr-review', 'pr-7.json');
const readStateFile = () => JSON.parse(fs.readFileSync(statePath(), 'utf8'));

const writeResult = (agent, object) => {
  fs.mkdirSync(path.dirname(agent.outPath), { recursive: true });
  const temp = `${agent.outPath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(object));
  fs.renameSync(temp, agent.outPath);
};

/** Stand-in agents: every reviewer lists the paths of its slice, the reader and the lane list every path they were given. */
function answerReview(manifest, { findings = {}, lanePaths = ALL_PATHS } = {}) {
  for (const agent of manifest.agents) writeResult(agent, { findings: findings[agent.name] || [], pathsReviewed: agent.paths || lanePaths });
}
/** Every agent votes `verdict` on every candidate it holds. */
const answerVotes = (manifest, verdict = 'real') => {
  for (const agent of manifest.agents) writeResult(agent, { votes: agent.candidateIds.map((id) => ({ candidateId: id, verdict, evidence: 'read it' })) });
};

/** Round one on head1 where every verifier answers `verdict` for every candidate: the findings `byReviewer` lists are settled (or refuted). */
function settledRound(runId, byReviewer, verdict = 'real') {
  setGh({ head: fx.head1 });
  fs.rmSync(statePath(), { force: true });
  const p = prep(runId);
  expect(p.code).toBe(0);
  answerReview(p.out, { findings: byReviewer });
  const v = coll(runId);
  expect(v.out).toMatchObject({ status: 'DISPATCH', round: 'verify' });
  answerVotes(v.out, verdict);
  const done = coll(runId);
  expect(done.out).toMatchObject({ ok: true, status: 'DONE', reviewStatus: { reviewedHeadSha: fx.head1 } });
  return { prepare: p.out, verify: v.out, done: done.out, state: readStateFile() };
}

/** A fix push: a new commit on top of `parent` that edits `edits` ({path: text}); returns its sha and makes it the PR's head. */
function push(parent, edits, name) {
  git(fx.work, 'checkout', '-q', '-B', name, parent);
  for (const [file, text] of Object.entries(edits)) write(fx.work, file, text);
  git(fx.work, 'add', '.');
  git(fx.work, 'commit', '-q', '-m', `fix push ${name}`);
  const sha = git(fx.work, 'rev-parse', 'HEAD');
  setGh({ head: sha });
  return sha;
}

/** The file `index` with `count` lines added after line `after` (a pure insertion for `git diff -U0`). */
function withInsertion(index, after, count) {
  const lines = body(LINES[index]).split('\n');
  lines.splice(after, 0, ...Array.from({ length: count }, (_, k) => `// added ${k + 1}`));
  return lines.join('\n');
}

/** The delta prepare of the push `head2` on the last round `fx.head1`. */
function deltaPrepare(runId, head2) {
  const p = prep(runId, { lastReviewedSha: fx.head1, remediationShas: [head2] });
  expect(p.code).toBe(0);
  expect(p.out.reReview).toMatchObject({ scope: 'delta', appliedRange: 'delta' });
  return p.out;
}
/** A claim as a reviewer writes it (what an agent's result file holds). */
const raised = (one, over = {}) => ({ locationOrLink: one.at, severity: 'important', failureMode: one.said, disposition: 'fix', evidence: one.evidence, ...over });

describe('a fix that only adds lines inside a cited range clears the finding it fixes (kata bh8w)', () => {
  const RANGE = { id: 'RANGE', at: 'med/a02.js:100-118', said: 'The block on lines 100-118 clamps the index with `Math.min` but never with `Math.max`, so a negative index reads before the start of the list instead of failing.', evidence: 'Called `pick(list, -1)`: it returned the last element of the list instead of throwing.' };
  const firstWithRange = (runId) => {
    const first = settledRound(runId, { 'reviewer-s1-a': [raised(RANGE)] });
    expect(first.done.ledger).toHaveLength(1);
    expect(first.done.ledger[0]).toMatchObject({ locationOrLink: RANGE.at, verification: { outcome: 'present' } });
    return first;
  };

  test('the repro: five lines added inside the range (`@@ -104,0 +105,5 @@`) and nobody raising the finding again: it is cleared, never verified again, never counted refuted', () => {
    const first = firstWithRange('i1');
    const id = first.done.ledger[0].id;
    const head2 = push(fx.head1, { 'med/a02.js': withInsertion(1, 104, 5) }, 'ins-inside');
    expect(git(fx.work, 'diff', '-U0', fx.head1, head2, '--', 'med/a02.js')).toMatch(/^@@ -104,0 \+105,5 @@/m);
    answerReview(deltaPrepare('i2', head2));
    const done = coll('i2');
    expect(done.out).toMatchObject({ ok: true, status: 'DONE', carry: { carried: 0, cleared: [id] } });
    const entry = done.out.ledger.find((candidate) => candidate.id === id);
    expect(entry).toMatchObject({ cleared: true, clearedBy: head2 });
    // cleared is not refuted: what the verifiers said last round stays as it was
    expect(entry.verification).toMatchObject({ outcome: 'present', tally: { real: 3, notReal: 0, expected: 3 } });
    expect(done.out.ledger.filter((candidate) => candidate.verification.outcome === 'filtered')).toEqual([]);
  });

  test('the control: five lines added OUTSIDE the range keep the finding open (a fix elsewhere in the file is not a fix of it)', () => {
    const first = firstWithRange('i3');
    const id = first.done.ledger[0].id;
    const head2 = push(fx.head1, { 'med/a02.js': withInsertion(1, 122, 5) }, 'ins-outside');
    expect(git(fx.work, 'diff', '-U0', fx.head1, head2, '--', 'med/a02.js')).toMatch(/^@@ -122,0 \+123,5 @@/m);
    answerReview(deltaPrepare('i4', head2));
    const done = coll('i4');
    expect(done.out).toMatchObject({ ok: true, status: 'DONE' });
    expect(done.out.carry.cleared || []).toEqual([]);
    const entry = done.out.ledger.find((candidate) => candidate.id === id);
    expect(entry.cleared).toBeUndefined();
    expect(entry).toMatchObject({ locationOrLink: RANGE.at, verification: { outcome: 'present' } });
  });

  test('the edges: an insertion right before the first cited line or right after the last one is no fix of the range', () => {
    for (const [after, name] of [[99, 'ins-before'], [118, 'ins-after']]) {
      const first = firstWithRange(`i5-${name}`);
      const id = first.done.ledger[0].id;
      const head2 = push(fx.head1, { 'med/a02.js': withInsertion(1, after, 5) }, name);
      answerReview(deltaPrepare(`i6-${name}`, head2));
      const done = coll(`i6-${name}`);
      expect(done.out.carry.cleared || []).toEqual([]);
      expect(done.out.ledger.find((candidate) => candidate.id === id).cleared).toBeUndefined();
    }
  });
});
