'use strict';

/**
 * The light-mode review runner (kata znd1): prepareRun / collectRun over fake deps.
 *
 * Everything that talks to the outside is a fake that RECORDS what it was asked (gh reads, git argv, the precheck, the
 * prepare step, the state writer, the tracer). The two real parts are the result-file collector and the filesystem, in a
 * private scratch directory under ~/.omp/pr-review-speedup/znd1/scratch (never /tmp), because an agent's result is a file
 * and its change time is part of the contract. One test per fail-closed rule of the protocol: each one fails if its guard
 * is removed (the mutation table is in the kata report).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { prepareRun, collectRun, PREPARE_KEYS, COLLECT_KEYS } = require('../lib/pr-review-run');
const S = require('../lib/pr-review-run-support');
const { collectResults } = require('../lib/pr-review-results');
const { renderBriefFromFiles } = require('../lib/pr-review-brief-files');
const { claimRules } = require('../lib/pr-review-briefs');
const { classifyPaths } = require('../lib/pr-review-paths');
const { loadPolicy } = require('../lib/pr-review-policy');
const { realFs, headFile } = require('../lib/review-run-cli');
const { redact, statePath } = require('../lib/pr-review-state');
const { createTracer } = require('../lib/run-trace');
const { loadReviewTiming } = require('../lib/pr-review-timing');

const SCRATCH = path.join(os.homedir(), '.omp', 'pr-review-speedup', 'znd1', 'scratch');
const HEAD = 'a'.repeat(40);
const MOVED = 'd'.repeat(40);
const BASE = 'b'.repeat(40);
const TREE = 'c'.repeat(40);
const GOOD_BODY = '## Testing\nran the relevant tests\n\n## Risk\nlow\n\n## How to revert\nrevert the commit\n';

let roots = [];
afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

const posix = process.platform === 'win32' ? test.skip : test;
const CLI_MODULE = path.join(__dirname, '..', 'lib', 'review-run-cli.js');

/** A snapshot directory holding `files` ({ 'src/a.js': 'text' }), in a scratch directory of its own: `{ root, snap }`. */
function headTree(files = {}) {
  fs.mkdirSync(SCRATCH, { recursive: true });
  const root = fs.mkdtempSync(path.join(SCRATCH, 'hf-'));
  roots.push(root);
  const snap = path.join(root, 'snap');
  fs.mkdirSync(snap);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(snap, rel)), { recursive: true });
    fs.writeFileSync(path.join(snap, rel), text);
  }
  return { root, snap };
}

/**
 * The file system under `root` as a CASE-INSENSITIVE volume answers it (the default on macOS and Windows): a path reaches
 * whatever its segments match ignoring case, while a directory listing still gives every name as it is stored. With it one
 * test pins the exact-name rule on any host: a lookup that reads the cited path instead of matching it against the listing
 * is fooled here exactly as it is on a Mac.
 */
function caseInsensitive(root) {
  const fold = (target) => {
    if (!target.startsWith(`${root}${path.sep}`)) return target;
    let current = root;
    for (const name of path.relative(root, target).split(path.sep)) {
      let names;
      try {
        names = fs.readdirSync(current);
      } catch {
        return target;
      }
      const hit = names.find((entry) => entry.toLowerCase() === name.toLowerCase());
      if (hit === undefined) return target;
      current = path.join(current, hit);
    }
    return current;
  };
  return {
    io: { readdirSync: fs.readdirSync, openSync: (target, flags, mode) => fs.openSync(fold(target), flags, mode), fstatSync: fs.fstatSync, readSync: fs.readSync, closeSync: fs.closeSync },
    readText: (file) => realFs().readText(fold(file)),
  };
}

function makeFacts({ changedPaths, numstat, policyJson = {} }) {
  const text = `# Review\n\n\`\`\`ensemble-review-policy\n${JSON.stringify(policyJson)}\n\`\`\`\n`;
  const policy = loadPolicy({ text, baseSha: BASE, sourceSha: BASE });
  const declaration = { sourceSha: BASE, sensitive: policy.policy.sensitivePaths, high: policy.policy.highPaths };
  const paths = classifyPaths({ changedPaths, declaration, baseSha: BASE });
  return { schema: 2, baseSha: BASE, headSha: HEAD, changedPaths, numstat, policy, paths };
}

/**
 * A harness: scratch repo root, a prepared directory with facts/baseline, and fake deps with call logs.
 * `overrides` replaces any fake dep; `facts`/`baseline`/`rangeDiff` replace what the prepared directory holds.
 */
function harness({ changedPaths = ['src/a.js'], numstat, policyJson, facts, baseline, overrides = {}, prepareOverride, rangeDiff = 'diff --git a/x b/x\n' } = {}) {
  fs.mkdirSync(SCRATCH, { recursive: true });
  const root = fs.mkdtempSync(path.join(SCRATCH, 'u-'));
  roots.push(root);
  const repoRoot = path.join(root, 'repo');
  const dir = path.join(root, 'prepared');
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.mkdirSync(path.join(dir, 'snapshot'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'range.diff'), rangeDiff);
  const theFacts = facts === undefined ? makeFacts({ changedPaths, numstat: numstat || changedPaths.map((p) => ({ path: p, added: 10, deleted: 2 })), policyJson }) : facts;
  fs.writeFileSync(path.join(dir, 'facts.json'), JSON.stringify(theFacts));
  const theBaseline = baseline === undefined ? { ran: false, reason: 'no-test-files', command: null, exitCode: null, timedOut: false, selection: [] } : baseline;
  fs.writeFileSync(path.join(dir, 'baseline.json'), JSON.stringify(theBaseline));

  const h = {
    root,
    repoRoot,
    head: HEAD,
    gitCalls: [],
    ghReads: [],
    precheckCalls: [],
    prepareCalls: [],
    stateWrites: [],
    spans: [],
    pr: { ok: true, headSha: HEAD, baseRefName: 'main', state: 'OPEN', body: GOOD_BODY, author: 'alice', isCrossRepository: false },
    reviews: { ok: true, reviews: [] },
    protection: { ok: true, notProtected: true },
  };
  let spanSeq = 0;
  h.deps = {
    now: () => Date.now(),
    redact,
    fs: realFs(),
    readPr: async () => {
      h.ghReads.push('readPr');
      return { ...h.pr, headSha: h.head };
    },
    readReviews: async () => {
      h.ghReads.push('readReviews');
      return h.reviews;
    },
    readProtection: async () => {
      h.ghReads.push('readProtection');
      return h.protection;
    },
    git: async (args) => {
      h.gitCalls.push(args);
      if (args[0] === 'merge-base') return { status: 0, stdout: `${BASE}\n`, stderr: '' };
      if (args[0] === 'rev-parse') return { status: 0, stdout: `${TREE}\n`, stderr: '' };
      return { status: 1, stdout: '', stderr: 'unexpected git call' };
    },
    fetchRefs: async () => ({ ok: true }),
    precheck: async (opts) => {
      h.precheckCalls.push(opts);
      return { ok: true, headSha: HEAD, blockers: [], comment: { action: 'created', id: 1 } };
    },
    prepareReview: async (options) => {
      h.prepareCalls.push(options);
      if (prepareOverride) return prepareOverride(options);
      return {
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
      };
    },
    collectResults: (input) => collectResults(input),
    renderBrief: (role, vars) => renderBriefFromFiles(role, vars),
    writeState: async (target, state) => {
      h.stateWrites.push({ target, state });
      return { ok: true, path: target };
    },
    makeTracer: () => ({
      startSpan: (name, opts) => {
        spanSeq += 1;
        h.spans.push({ type: 'start', id: spanSeq, name, kind: opts.kind, attrs: opts.attrs });
        return spanSeq;
      },
      endSpan: (id, opts) => {
        h.spans.push({ type: 'end', id, status: opts.status, attrs: opts.attrs });
        return true;
      },
    }),
    ...overrides,
  };
  h.prepare = (extra = {}) => prepareRun({ repo: 'o/r', pr: 7, repoRoot, runId: 'run1', agentAuthored: false, ...extra }, h.deps);
  h.collect = (extra = {}) => collectRun({ repoRoot, runId: extra.runId || 'run1', ...extra }, h.deps);
  h.runDir = (runId = 'run1') => path.join(repoRoot, '.ensemble', 'pr-review', 'run', runId);
  h.readRun = (runId) => JSON.parse(fs.readFileSync(path.join(h.runDir(runId), 'run.json'), 'utf8'));
  return h;
}

const writeResult = (agent, object) => {
  fs.mkdirSync(path.dirname(agent.outPath), { recursive: true });
  const temp = `${agent.outPath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(object));
  fs.renameSync(temp, agent.outPath);
};

const finding = (over = {}) => ({ locationOrLink: 'src/a.js:3', severity: 'important', failureMode: 'the loop reads past the end of the list', disposition: 'fix', evidence: 'src/a.js line 3 indexes list[list.length]', originalTextOrLink: 'src/a.js:3', ...over });

/** Writes every reviewer's result (all paths reviewed) and the lane's; `findingsFor(name)` may add findings. */
function answerReview(manifest, { findingsFor = () => [], skip = [], lane = { findings: [] }, partial = {} } = {}) {
  for (const agent of manifest.agents) {
    if (skip.includes(agent.name)) continue;
    if (agent.role === 'reviewer') writeResult(agent, { findings: findingsFor(agent.name), pathsReviewed: partial[agent.name] || agent.paths });
    else if (agent.role === 'security') writeResult(agent, { findings: lane.findings, pathsReviewed: lane.pathsReviewed || partial[agent.name] || (lane.all || []) });
  }
}

const allPaths = (h) => h.readRun().changedPaths;

/** prepare -> answer every agent -> collect. Returns {manifest, next}. */
async function reviewRound(h, options = {}) {
  const manifest = await h.prepare(options.prepare);
  expect(manifest.status).toBe('DISPATCH');
  const lane = options.lane || { findings: [], pathsReviewed: allPaths(h) };
  answerReview(manifest, { ...options, lane });
  const next = await h.collect(options.collect);
  return { manifest, next };
}

function voteAll(manifest, verdictFor = () => 'real', skip = []) {
  for (const agent of manifest.agents) {
    if (skip.includes(agent.name)) continue;
    writeResult(agent, { votes: agent.candidateIds.map((id) => ({ candidateId: id, verdict: verdictFor(agent.name, id), evidence: 'checked' })) });
  }
}

const pause = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));

describe('prepare: the dispatch manifest', () => {
  test('a Medium PR dispatches two reviewers and the security lane with generated briefs and prompts', async () => {
    const h = harness();
    const m = await h.prepare();
    expect(m).toMatchObject({ ok: true, status: 'DISPATCH', runId: 'run1', round: 'review', wave: '1 of 1', headSha: HEAD, maxConcurrentAgents: 8 });
    expect(m.mode).toMatchObject({ mode: 'light', securityLane: true });
    expect(m.tier).toMatchObject({ tier: 'medium', effectiveTier: 'medium' });
    expect(m.depth).toMatchObject({ mode: 'standard', reviewersPerSlice: 2, verifiersPerCandidate: 3 });
    expect(m.agents.map((a) => [a.name, a.role])).toEqual([['reviewer-s1-a', 'reviewer'], ['reviewer-s1-b', 'reviewer'], ['security-lane', 'security']]);
    for (const a of m.agents) {
      expect(a.deadlineAt).toBeGreaterThan(a.dispatchedAt);
      expect(a.prompt).toContain(a.briefPath);
      expect(a.prompt).toContain(a.outPath);
      expect(a.prompt).toContain(a.deadlineAtIso);
      const brief = fs.readFileSync(a.briefPath, 'utf8');
      expect(brief).toContain('Output contract');
      expect(brief).not.toMatch(/\{\{/);
    }
    expect(fs.readFileSync(m.agents[0].briefPath, 'utf8')).toContain('src/a.js');
    expect(m.rules.join(' ')).toMatch(/cannot enforce/);
    // the honest limit on coverage is in every manifest (review of PR 264, nit): self-reported, and read-only is not enforced
    expect(m.rules.join(' ')).toMatch(/Coverage is self-reported[^]*`pathsReviewed`[^]*cannot tell a read from a claim[^]*cannot enforce/);
    expect(m.next).toContain('collect');
    // the run directory and its files are private
    expect(fs.statSync(h.runDir()).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(h.runDir(), 'run.json')).mode & 0o777).toBe(0o600);
    expect(h.readRun().phase).toBe('review-dispatched');
  });

  test('the precheck runs first, before prepare, and is advisory when it fails', async () => {
    const order = [];
    const h = harness();
    const precheck = h.deps.precheck;
    h.deps.precheck = async (o) => {
      order.push('precheck');
      return precheck({ ...o }).then(() => ({ ok: false, stage: 'pr', error: 'the pull request is "MERGED", not OPEN' }));
    };
    const prepareReview = h.deps.prepareReview;
    h.deps.prepareReview = async (o) => {
      order.push('prepare');
      return prepareReview(o);
    };
    const m = await h.prepare();
    expect(order).toEqual(['precheck', 'prepare']);
    expect(m.status).toBe('DISPATCH');
    expect(m.precheck).toMatchObject({ ok: false, error: expect.stringContaining('MERGED') });
  });

  test('skipPrecheck skips it and says so; dryRun is passed through', async () => {
    const h = harness();
    const skipped = await h.prepare({ skipPrecheck: true });
    expect(h.precheckCalls).toEqual([]);
    expect(skipped.precheck).toEqual({ skipped: true, reason: 'requested' });
    const dry = harness();
    await dry.prepare({ dryRun: true });
    expect(dry.precheckCalls).toEqual([{ dryRun: true }]);
  });

  test('prepare is handed the merge base, the head and the passthrough options', async () => {
    const h = harness();
    await h.prepare({ lastReviewedSha: 'e'.repeat(40), remediationShas: ['f'.repeat(40)], testFiles: ['t/x.test.js'] });
    expect(h.prepareCalls[0]).toMatchObject({ repoRoot: h.repoRoot, runId: 'run1', baseSha: BASE, headSha: HEAD, lastReviewedSha: 'e'.repeat(40), remediationShas: ['f'.repeat(40)], testFiles: ['t/x.test.js'] });
    expect(h.gitCalls.some((a) => a[0] === 'merge-base')).toBe(true);
  });

  test('a stated baseSha is a check, not an override: it is accepted only when it IS the merge base (a base inside the PR would leave its earlier commits unreviewed and unreported)', async () => {
    const same = harness();
    await same.prepare({ baseSha: BASE });
    expect(same.prepareCalls[0].baseSha).toBe(BASE);
    expect(same.gitCalls.some((a) => a[0] === 'merge-base')).toBe(true);

    const inside = harness();
    const out = await inside.prepare({ baseSha: '9'.repeat(40) });
    expect(out).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: 'base-not-merge-base' });
    expect(out.error).toContain('9'.repeat(40));
    expect(out.error).toContain(BASE);
    expect(inside.prepareCalls).toEqual([]);
    expect(fs.existsSync(path.join(inside.runDir(), 'run.json'))).toBe(false);
  });

  test('the base and the head are fetched even when the caller states the base', async () => {
    const h = harness();
    h.deps.fetchRefs = async () => ({ ok: false, error: 'network' });
    expect(await h.prepare({ baseSha: BASE })).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: 'refs-unavailable' });
    expect(h.prepareCalls).toEqual([]);
  });

  test.each(['MERGED', 'CLOSED', 'open', undefined])('a PR whose state is %p is refused before anything runs (it was reviewed and answered mergeable before; review of PR 264, P2)', async (state) => {
    const h = harness();
    h.pr.state = state;
    const out = await h.prepare();
    expect(out).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: 'pr-not-open', error: expect.stringContaining('not OPEN') });
    expect(h.precheckCalls).toEqual([]);
    expect(h.prepareCalls).toEqual([]);
    expect(h.gitCalls).toEqual([]);
    expect(fs.existsSync(path.join(h.repoRoot, '.ensemble'))).toBe(false);
  });

  test('the default run id names the PR, the head and the second; a run id that is not file-name safe is refused', async () => {
    const h = harness();
    const m = await prepareRun({ repo: 'o/r', pr: 7, repoRoot: h.repoRoot, agentAuthored: false }, h.deps);
    expect(m.runId).toMatch(/^pr7-aaaaaaaaaaaa-\d+$/);
    const bad = await prepareRun({ repo: 'o/r', pr: 7, repoRoot: h.repoRoot, runId: '../escape' }, h.deps);
    expect(bad).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: 'invalid-runId' });
    const dotted = await prepareRun({ repo: 'o/r', pr: 7, repoRoot: h.repoRoot, runId: 'a.b' }, h.deps);
    expect(dotted.reason).toBe('invalid-runId');
  });

  test('an unknown payload key, a bad value and an existing run are refused', async () => {
    const h = harness();
    expect(await h.prepare({ dryrun: true })).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: 'invalid-input', error: expect.stringContaining('dryrun') });
    expect(await h.prepare({ pr: 0 })).toMatchObject({ reason: 'invalid-input' });
    expect(await h.prepare({ baseSha: 'main' })).toMatchObject({ reason: 'invalid-input' });
    expect((await h.prepare()).status).toBe('DISPATCH');
    expect(await h.prepare()).toMatchObject({ ok: false, reason: 'run-exists' });
    expect(PREPARE_KEYS).toContain('stateRoot');
    expect(COLLECT_KEYS).toEqual(['repoRoot', 'runId', 'now', 'adjudications', 'triage']);
    expect(await h.collect({ extra: 1 })).toMatchObject({ ok: false, reason: 'invalid-input' });
  });
});

describe('prepare: a head from outside this repository is refused before anything runs (review of PR 264, P0)', () => {
  const refused = async (isCrossRepository, reason, options = {}) => {
    const h = harness();
    h.pr.isCrossRepository = isCrossRepository;
    let fetches = 0;
    h.deps.fetchRefs = async () => {
      fetches += 1;
      return { ok: true };
    };
    const out = await h.prepare(options);
    expect(out).toMatchObject({ ok: false, status: 'RUN_FAILED', reason, headSha: HEAD });
    expect(out.error).toMatch(/head/);
    // nothing was fetched, prepared (the baseline test run lives there), prechecked, classified or written
    expect(fetches).toBe(0);
    expect(h.prepareCalls).toEqual([]);
    expect(h.precheckCalls).toEqual([]);
    expect(h.gitCalls).toEqual([]);
    expect(h.stateWrites).toEqual([]);
    expect(h.ghReads).toEqual(['readPr']);
    expect(fs.existsSync(path.join(h.repoRoot, '.ensemble'))).toBe(false);
    return out;
  };

  test('a fork head', async () => {
    const out = await refused(true, 'cross-repository-head');
    expect(out.error).toMatch(/fork/);
  });

  test.each([[undefined], [null], ['false'], [0]])('a head whose repository is not stated as exactly `false` (%p) is not "this repository"', async (value) => {
    await refused(value, 'head-repository-unknown');
  });

  // review of PR 264, round 2 (P2): the guard sits before the precheck/fetch/prepare split, so an option that skips one of those steps must not skip it
  test.each([
    ['skipPrecheck', { skipPrecheck: true }],
    ['dryRun', { dryRun: true }],
    ['skipPrecheck and dryRun', { skipPrecheck: true, dryRun: true }],
  ])('a fork head is refused under %s too: no option set skips the guard', async (_label, options) => {
    const out = await refused(true, 'cross-repository-head', options);
    expect(out.error).toMatch(/fork/);
  });

  test.each([
    ['skipPrecheck', { skipPrecheck: true }],
    ['dryRun', { dryRun: true }],
  ])('a head whose repository is not stated as exactly `false` is refused under %s too', async (_label, options) => {
    await refused(undefined, 'head-repository-unknown', options);
    await refused('false', 'head-repository-unknown', options);
  });

  test('a head stated to be on this repository is prepared as before', async () => {
    const h = harness();
    h.pr.isCrossRepository = false;
    expect((await h.prepare()).status).toBe('DISPATCH');
    expect(h.prepareCalls).toHaveLength(1);
  });
});

describe('full mode (kata dqcs): the same runner, with Deep depth, the security lane and a triage stop', () => {
  /** prepare -> answer every agent of the review round -> collect: the TRIAGE answer of a full run. */
  async function toTriage(h, { findingsFor, lane, prepare, collect } = {}) {
    const manifest = await h.prepare(prepare);
    expect(manifest).toMatchObject({ ok: true, status: 'DISPATCH', mode: { mode: 'full' } });
    answerReview(manifest, { findingsFor, lane: lane || { findings: [], pathsReviewed: allPaths(h) } });
    const triage = await h.collect(collect);
    return { manifest, triage };
  }
  const sensitive = () => {
    const h = harness({ changedPaths: ['secure/key.js'], policyJson: { sensitivePaths: ['secure/**'] } });
    const dir = path.join(h.root, 'prepared', 'snapshot', 'secure');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'key.js'), `${Array.from({ length: 30 }, (_, i) => `// line ${i + 1}`).join('\n')}\n`);
    return h;
  };
  const keyFinding = (over = {}) => finding({ locationOrLink: 'secure/key.js:3', originalTextOrLink: 'secure/key.js:3', ...over });
  const onlyA = (n) => (n.endsWith('-a') ? [keyFinding()] : []);
  const LATE = () => Date.now() + 6 * 3600 * 1000;

  describe('AC1: anything that is not clearly light selects full and runs the full path end to end', () => {
    const causes = [
      ['a sensitive path', () => harness({ changedPaths: ['secure/key.js'], policyJson: { sensitivePaths: ['secure/**'] } }), /sensitive-path/],
      ['an owner-declared High path', () => harness({ changedPaths: ['core/x.js'], policyJson: { highPaths: ['core/**'] } }), /high-path/],
      ['an unreadable path classification (the tier module answers High and not ok)', () => {
        const facts = makeFacts({ changedPaths: ['src/a.js'], numstat: [{ path: 'src/a.js', added: 1, deleted: 0 }] });
        delete facts.paths;
        return harness({ facts });
      }, /tier-result-not-ok|paths-unreadable|unknown|high/i],
    ];
    for (const [name, make, reason] of causes) {
      test(`${name}: Deep depth, five verifiers per finding, the security lane, then TRIAGE, a verify wave and DONE`, async () => {
        const h = make();
        const manifest = await h.prepare();
        expect(manifest).toMatchObject({ ok: true, status: 'DISPATCH', round: 'review', mode: { mode: 'full' }, depth: { mode: 'deep', verifiersPerCandidate: 5 } });
        expect(manifest.depth.reviewersPerSlice).toBeGreaterThanOrEqual(2);
        expect(manifest.mode.reasons.join(',')).toMatch(reason);
        expect(manifest.agents.map((a) => a.role)).toContain('security');
        expect(manifest.agents.filter((a) => a.role === 'reviewer').length).toBeGreaterThanOrEqual(2);
        for (const a of manifest.agents) expect(fs.readFileSync(a.briefPath, 'utf8')).toContain('Output contract');
        const at = `${allPaths(h)[0]}:3`;
        answerReview(manifest, { findingsFor: (n) => (n.endsWith('-a') ? [finding({ locationOrLink: at, originalTextOrLink: at })] : []), lane: { findings: [], pathsReviewed: allPaths(h) } });
        const triage = await h.collect();
        expect(triage).toMatchObject({ ok: true, status: 'TRIAGE', dispatched: [], mode: { mode: 'full' } });
        expect(triage.candidates).toHaveLength(1);
        const verify = await h.collect({ triage: {} });
        expect(verify).toMatchObject({ ok: true, status: 'DISPATCH', round: 'verify' });
        expect(verify.agents.length).toBeGreaterThanOrEqual(5);
        voteAll(verify, () => 'real');
        const done = await h.collect();
        expect(done).toMatchObject({ ok: true, status: 'DONE', mode: { mode: 'full' }, depth: { mode: 'deep', verifiersPerCandidate: 5 } });
        expect(done.gate.mergeable).toBe(false);
        expect(h.stateWrites[h.stateWrites.length - 1].state).toMatchObject({ mode: 'full' });
      });
    }

    // HONEST LIMIT: prepareRun passes assignTier no second assessment and no proposed tier, so no runner input can raise a
    // tier today. This feeds the runner a tier record that carries a raise (the shape the tier module emits) and proves the
    // runner honours selectMode's answer for it; selectMode's own raised-tier rule is covered in pr-review-mode.test.js.
    test('a tier record that carries a raise (injected: the runner has no input that raises a tier): full, end to end', async () => {
      let isolated;
      jest.isolateModules(() => {
        jest.doMock('../lib/pr-review-tier', () => {
          const real = jest.requireActual('../lib/pr-review-tier');
          return { ...real, tierRecord: (args) => ({ ...real.tierRecord(args), raised: [{ from: 'medium', to: 'high', reason: 'second-assessor' }] }) };
        });
        isolated = require('../lib/pr-review-run');
      });
      jest.dontMock('../lib/pr-review-tier');
      const h = harness();
      const manifest = await isolated.prepareRun({ repo: 'o/r', pr: 7, repoRoot: h.repoRoot, runId: 'run1', agentAuthored: false }, h.deps);
      expect(manifest).toMatchObject({ ok: true, status: 'DISPATCH', mode: { mode: 'full' }, depth: { mode: 'deep', verifiersPerCandidate: 5 } });
      expect(manifest.mode.reasons).toContain('tier-raised');
      answerReview(manifest, { lane: { findings: [], pathsReviewed: allPaths(h) } });
      expect(await isolated.collectRun({ repoRoot: h.repoRoot, runId: 'run1' }, h.deps)).toMatchObject({ ok: true, status: 'TRIAGE' });
      const done = await isolated.collectRun({ repoRoot: h.repoRoot, runId: 'run1', triage: {} }, h.deps);
      expect(done).toMatchObject({ ok: true, status: 'DONE', mode: { mode: 'full', reasons: expect.arrayContaining(['tier-raised']) } });
    });

    test('a PR with no changed paths cites no kind: ambiguity selects full (never light); a review with nothing to brief is RUN_FAILED, never NEEDS_FULL_MODE or a verdict', async () => {
      const h = harness({ changedPaths: [], numstat: [] });
      const out = await h.prepare();
      expect(out).toMatchObject({ ok: false, status: 'RUN_FAILED', mode: { mode: 'full' }, dispatched: [] });
      expect(out.mode.reasons.join(',')).toMatch(/no-kinds-cited|uncited|unreadable/);
      expect(out.reason).toMatch(/^brief-refused/);
      expect(h.readRun()).toMatchObject({ phase: 'failed', mode: { mode: 'full' } });
      expect(h.stateWrites).toEqual([]);
    });

    test('a light PR is untouched: standard depth, no TRIAGE, the verify wave follows the review round directly', async () => {
      const h = harness();
      const m = await h.prepare();
      expect(m).toMatchObject({ mode: { mode: 'light' }, depth: { mode: 'standard', verifiersPerCandidate: 3 } });
      expect(m.reReview).toBeUndefined();
      answerReview(m, { findingsFor: (n) => (n.endsWith('-a') ? [finding()] : []), lane: { findings: [], pathsReviewed: allPaths(h) } });
      expect(await h.collect()).toMatchObject({ status: 'DISPATCH', round: 'verify' });
    });
  });

  describe('triage: the model orchestrator may add candidates and nothing else', () => {
    test('TRIAGE dispatches nothing and repeats until the orchestrator answers; it lists the candidates, coverage and security lane', async () => {
      const h = sensitive();
      const { triage } = await toTriage(h, { findingsFor: onlyA });
      expect(triage).toMatchObject({ status: 'TRIAGE', dispatched: [], maxAdditionalCandidates: 20, security: { status: 'clean' }, coverage: { complete: true, uncovered: [] } });
      expect(triage.candidates).toEqual([expect.objectContaining({ id: 'f1', locationOrLink: 'secure/key.js:3', source: 'reviewer-s1-a' })]);
      expect(triage.rules.join(' ')).toMatch(/can only ADD/);
      const wavesBefore = h.readRun().waves.length;
      expect(await h.collect()).toMatchObject({ status: 'TRIAGE' });
      expect(h.readRun().waves.length).toBe(wavesBefore);
      expect(h.readRun().phase).toBe('triage');
    });

    test('an entry that matches an existing candidate never displaces or re-grades it: the reviewer\'s candidate stays exactly as it was (a review of this PR found the dedupe let the orchestrator take it over)', async () => {
      const h = sensitive();
      await toTriage(h, { findingsFor: (n) => (n.endsWith('-a') ? [keyFinding({ severity: 'nit' })] : []) });
      const before = h.readRun().candidates;
      expect(before).toEqual([expect.objectContaining({ id: 'f1', source: 'reviewer-s1-a', severity: 'nit' })]);
      const verify = await h.collect({ triage: { additionalCandidates: [{ locationOrLink: 'secure/key.js:3', failureMode: keyFinding().failureMode, severity: 'important' }] } });
      expect(verify).toMatchObject({ status: 'DISPATCH', round: 'verify' });
      const after = h.readRun();
      expect(after.candidates).toEqual(before);
      expect(after.triage).toMatchObject({ requested: 1, additionalCandidateIds: [], mergedIntoExisting: 1 });
      voteAll(verify, () => 'real');
      const done = await h.collect();
      expect(done.ledger.map((e) => [e.id, e.source, e.severity])).toEqual([['f1', 'reviewer-s1-a', 'nit']]);
      expect(done.triage).toMatchObject({ additionalCandidateIds: [], mergedIntoExisting: 1 });
    });

    test('an added candidate is verified by five independent verifiers from a brief that carries the claim and location only, and lands in the ledger as the orchestrator\'s', async () => {
      const h = sensitive();
      await toTriage(h, { findingsFor: onlyA });
      const verify = await h.collect({ triage: { additionalCandidates: [{ locationOrLink: 'secure/key.js:9', failureMode: 'the key is compared with == so a type-juggled value passes', severity: 'important', evidence: 'ORCHESTRATOR-CONCLUSION-MUST-NOT-LEAK' }] } });
      expect(verify).toMatchObject({ status: 'DISPATCH', round: 'verify' });
      const byCandidate = new Map();
      for (const a of verify.agents) for (const id of a.candidateIds) byCandidate.set(id, [...(byCandidate.get(id) || []), a.name]);
      expect([...byCandidate.keys()].sort()).toEqual(['f1', 'f2']);
      for (const names of byCandidate.values()) expect(new Set(names).size).toBe(5);
      for (const a of verify.agents) {
        const brief = fs.readFileSync(a.briefPath, 'utf8');
        expect(brief).not.toContain('ORCHESTRATOR-CONCLUSION-MUST-NOT-LEAK');
        expect(brief).not.toMatch(/orchestrator/i);
      }
      expect(fs.readFileSync(verify.agents.find((a) => a.candidateIds.includes('f2')).briefPath, 'utf8')).toContain('type-juggled');
      voteAll(verify, () => 'real');
      const done = await h.collect();
      expect(done.status).toBe('DONE');
      expect(done.ledger.map((e) => [e.id, e.source])).toEqual([['f1', 'reviewer-s1-a'], ['f2', 'orchestrator']]);
      expect(done.ledger[1].verification).toMatchObject({ outcome: expect.any(String) });
      expect(done.triage).toMatchObject({ requested: 1, additionalCandidateIds: ['f2'] });
      expect(done.metrics.triageCalls).toBe(2); // the call that answered TRIAGE and the one that submitted it; later calls are the protocol's own
      expect(done.gate.mergeable).toBe(false);
    });

    test('submitting triage is what leads to verification: a full run with candidates never skips straight to the ledger', async () => {
      const h = sensitive();
      await toTriage(h, { findingsFor: onlyA });
      const next = await h.collect({ triage: {} });
      expect(next).toMatchObject({ status: 'DISPATCH', round: 'verify' });
      expect(h.readRun().waves.filter((w) => w.round === 'verify')).toHaveLength(1);
    });

    test('a full run with no candidates still stops at TRIAGE, and finishes DONE on an empty triage', async () => {
      const h = sensitive();
      const { triage } = await toTriage(h);
      expect(triage).toMatchObject({ status: 'TRIAGE', candidates: [] });
      const done = await h.collect({ triage: {} });
      expect(done).toMatchObject({ status: 'DONE', mode: { mode: 'full' }, ledger: [] });
    });

    // kata 0g9n: a reviewer's candidate the verifier brief refuses cannot be reworded by anyone in this run, so TRIAGE says it will
    // not be verified, and the one lever the orchestrator has (it may ADD a candidate) works: an entry that restates it is not a
    // duplicate of anything a verifier will check, so it is kept and verified, and the refused candidate stays as it was.
    describe('a reviewer candidate the verifier brief refuses (kata 0g9n)', () => {
      const KEY_TEXT = 'compares the submitted key with the stored value using a loose equality so a type juggled key passes the check';
      const LEAKY_KEY = `the orchestrator ${KEY_TEXT}`;
      const OTHER = 'a second unrelated defect in the retry loop of the client library leaks a handle on every timeout';
      const raised = (n) => {
        if (n === 'reviewer-s1-a') return [keyFinding({ failureMode: LEAKY_KEY })];
        if (n === 'reviewer-s1-b') return [keyFinding({ locationOrLink: 'secure/key.js:20', originalTextOrLink: 'secure/key.js:20', failureMode: OTHER })];
        return [];
      };
      const restated = { locationOrLink: 'secure/key.js:3', failureMode: `the submitted key is ${KEY_TEXT.replace('compares the submitted key', 'compared')}` };

      test('TRIAGE marks it (kind, input, the renderer\'s reason), leaves the verifiable one unmarked and says how its defect can still get an independent check', async () => {
        const h = sensitive();
        const { triage } = await toTriage(h, { findingsFor: raised });
        expect(triage.candidates.map((c) => [c.id, c.source])).toEqual([['f1', 'reviewer-s1-a'], ['f2', 'reviewer-s1-b']]);
        expect(triage.candidates[0].unbriefable).toEqual({ kind: 'leak', input: 'claim', reason: expect.stringContaining('reads as the orchestrator') });
        expect(triage.candidates[0].failureMode).toBe(LEAKY_KEY); // shown as written: the orchestrator is not a verifier
        expect(triage.candidates[1]).not.toHaveProperty('unbriefable');
        expect(triage.rules.join(' ')).toMatch(/marked `unbriefable`[^]*will NOT be put to any verifier[^]*You cannot reword or remove it[^]*ADD a candidate for it/);
        // asking again repeats the same answer and decides nothing
        expect((await h.collect()).candidates[0].unbriefable).toMatchObject({ kind: 'leak' });
        expect(h.readRun().phase).toBe('triage');
      });

      test('an entry that restates it is kept and verified by five verifiers; the refused candidate and the other one stay exactly as they were', async () => {
        const h = sensitive();
        await toTriage(h, { findingsFor: raised });
        const before = h.readRun().candidates;
        const verify = await h.collect({ triage: { additionalCandidates: [restated] } });
        expect(verify).toMatchObject({ status: 'DISPATCH', round: 'verify' });
        const run = h.readRun();
        expect(run.candidates.map((c) => [c.id, c.source])).toEqual([['f1', 'reviewer-s1-a'], ['f2', 'reviewer-s1-b'], ['f3', 'orchestrator']]);
        expect(run.candidates.slice(0, 2)).toEqual(before); // triage still only ADDS
        expect(run.triage).toMatchObject({ requested: 1, additionalCandidateIds: ['f3'], mergedIntoExisting: 0 });
        const asked = new Map();
        for (const a of verify.agents) for (const id of a.candidateIds) asked.set(id, [...(asked.get(id) || []), a.name]);
        expect([...asked.keys()].sort()).toEqual(['f2', 'f3']);
        for (const names of asked.values()) expect(new Set(names).size).toBe(5);
        for (const a of verify.agents) {
          const brief = fs.readFileSync(a.briefPath, 'utf8');
          expect(brief).toContain('type juggled');
          expect(brief).not.toContain(LEAKY_KEY); // the refused claim reaches no verifier, and nor does its word
          expect(brief).not.toMatch(/orchestrator/i);
        }
        voteAll(verify, () => 'real');
        const done = await h.collect();
        const byId = new Map(done.ledger.map((e) => [e.id, e]));
        expect(byId.get('f1').verification).toMatchObject({ outcome: 'unverified', reason: 'unbriefable', tally: null, assigned: [] });
        expect(byId.get('f2').verification).toMatchObject({ outcome: 'present' });
        expect(byId.get('f3')).toMatchObject({ source: 'orchestrator', verification: { outcome: 'present', tally: { real: 5, expected: 5 } } });
        expect(done.notReviewed.unbriefable.map((u) => u.id)).toEqual(['f1']);
        expect(done.votes).toMatchObject({ verification: 'partial', reason: 'unbriefable-candidates' });
      });

      test('an entry that restates a candidate a verifier WILL check is still dropped: only a refused candidate stops being a duplicate target', async () => {
        const h = sensitive();
        // f1 is refused; f2 and f3 are not, and the entry restates f2 -- in a round of three findings, where the dedupe can tell the
        // defect from the topic the round shares
        await toTriage(h, {
          findingsFor: (n) => {
            if (n === 'reviewer-s1-a') return [keyFinding({ locationOrLink: 'secure/key.js:10', originalTextOrLink: 'secure/key.js:10', failureMode: 'the orchestrator ignores a stale entry in the cache after a reload' }), keyFinding({ failureMode: KEY_TEXT.replace('compares', 'the key check compares') })];
            if (n === 'reviewer-s1-b') return [keyFinding({ locationOrLink: 'secure/key.js:20', originalTextOrLink: 'secure/key.js:20', failureMode: OTHER })];
            return [];
          },
        });
        const before = h.readRun().candidates;
        expect(before.map((c) => c.id)).toEqual(['f1', 'f2', 'f3']);
        const verify = await h.collect({ triage: { additionalCandidates: [restated] } });
        expect(verify).toMatchObject({ status: 'DISPATCH', round: 'verify' });
        const run = h.readRun();
        expect(run.candidates).toEqual(before);
        expect(run.triage).toMatchObject({ requested: 1, additionalCandidateIds: [], mergedIntoExisting: 1 });
      });

      test('an entry that is itself refused still refuses the whole payload, with the renderer\'s reason, and keeps nothing: the restatement must pass the same screen', async () => {
        const h = sensitive();
        await toTriage(h, { findingsFor: raised });
        const before = h.readRun();
        const refused = await h.collect({ triage: { additionalCandidates: [{ locationOrLink: 'secure/key.js:3', failureMode: LEAKY_KEY }] } });
        expect(refused).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: 'triage-refused', error: expect.stringMatching(/additionalCandidates\[0\][^]*cannot be briefed to a verifier[^]*reads as the orchestrator/) });
        expect(h.readRun()).toMatchObject({ phase: 'triage', candidates: before.candidates, triage: before.triage });
      });

      test('when nothing is added the refused candidate simply stays: verification covers the others, and the run is DONE with it named', async () => {
        const h = sensitive();
        await toTriage(h, { findingsFor: raised });
        const verify = await h.collect({ triage: {} });
        expect([...new Set(verify.agents.flatMap((a) => a.candidateIds))]).toEqual(['f2']);
        voteAll(verify, () => 'real');
        const done = await h.collect();
        expect(done.status).toBe('DONE');
        expect(done.notReviewed.unbriefable).toEqual([{ id: 'f1', kind: 'leak', input: 'claim', reason: expect.any(String) }]);
        expect(done.votes.outcomes.map((o) => [o.id, o.outcome, o.reason])).toEqual([['f1', 'unverified', 'unbriefable'], ['f2', 'present', 'verifier-majority']]);
      });
    });

    const refusals = [
      ['an unknown key (nothing can remove or close a candidate)', { dismiss: ['f1'] }, /unknown triage key "dismiss"/],
      ['a candidate key that re-grades or closes', { additionalCandidates: [{ locationOrLink: 'secure/key.js:9', failureMode: 'x y z', resolution: 'resolved' }] }, /unknown key "resolution"/],
      ['a pre-existing label', { additionalCandidates: [{ locationOrLink: 'secure/key.js:9', failureMode: 'x y z', severity: 'pre-existing' }] }, /severity must be one of important, nit/],
      ['a location a verifier cannot be briefed with', { additionalCandidates: [{ locationOrLink: 'secure/key.js', failureMode: 'x y z' }] }, /path\/to\/file:line/],
      ['an absolute path', { additionalCandidates: [{ locationOrLink: '/etc/passwd:1', failureMode: 'x y z' }] }, /repository-relative/],
      ['a home-relative path', { additionalCandidates: [{ locationOrLink: '~/.ssh/id_rsa:1', failureMode: 'x y z' }] }, /repository-relative/],
      ['a path that climbs out with ..', { additionalCandidates: [{ locationOrLink: 'secure/../../x.js:1', failureMode: 'x y z' }] }, /repository-relative/],
      ['a file the head snapshot does not hold', { additionalCandidates: [{ locationOrLink: 'secure/missing.js:1', failureMode: 'x y z' }] }, /not a line of a regular file of the head snapshot/],
      ['a line past the end of the file', { additionalCandidates: [{ locationOrLink: 'secure/key.js:31', failureMode: 'x y z' }] }, /not a line of a regular file of the head snapshot/],
      ['a range that runs past the end of the file', { additionalCandidates: [{ locationOrLink: 'secure/key.js:29-31', failureMode: 'x y z' }] }, /not a line of a regular file of the head snapshot/],
      ['no failure mode', { additionalCandidates: [{ locationOrLink: 'secure/key.js:9' }] }, /failureMode/],
      // A claim the verifier brief refuses is refused here, with the renderer's own reason, before the run depends on it:
      // accepted, it is appended, refused when the verify round is planned, and left unverified, blocking the gate.
      ['a claim that names the orchestrator (the verifier brief refuses it)', { additionalCandidates: [{ locationOrLink: 'secure/key.js:9', failureMode: 'the orchestrator never checks the key' }] }, /additionalCandidates\[0\] \(secure\/key\.js:9\) cannot be briefed to a verifier.*reads as the orchestrator \("orchestrator"\)/],
      ['a claim that names a verdict (the verifier brief refuses it)', { additionalCandidates: [{ locationOrLink: 'secure/key.js:9', failureMode: 'the verdict of the comparison is wrong' }] }, /cannot be briefed to a verifier.*reads as a verdict \("verdict"\)/],
      ['more than 20 candidates', { additionalCandidates: Array.from({ length: 21 }, (_, i) => ({ locationOrLink: `secure/key.js:${i + 1}`, failureMode: 'something is wrong here' })) }, /at most 20/],
    ];
    for (const [name, payload, reason] of refusals) {
      test(`${name} is refused, not terminal, and changes nothing; a correct retry then works`, async () => {
        const h = sensitive();
        await toTriage(h, { findingsFor: onlyA });
        const before = h.readRun();
        const refused = await h.collect({ triage: payload });
        expect(refused).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: 'triage-refused' });
        expect(refused.error).toMatch(reason);
        const after = h.readRun();
        expect(after.phase).toBe('triage');
        expect(after.candidates).toEqual(before.candidates);
        expect(after.waves).toHaveLength(before.waves.length);
        expect(await h.collect({ triage: {} })).toMatchObject({ status: 'DISPATCH', round: 'verify' });
      });
    }

    test('a path with whitespace is refused at triage with the renderer\'s own reason, because no verifier can be briefed with it', async () => {
      const h = sensitive();
      fs.writeFileSync(path.join(h.root, 'prepared', 'snapshot', 'secure', 'my key.js'), `${Array.from({ length: 30 }, (_, i) => `// line ${i + 1}`).join('\n')}\n`);
      await toTriage(h, { findingsFor: onlyA });
      const before = h.readRun();
      const refused = await h.collect({ triage: { additionalCandidates: [{ locationOrLink: 'secure/my key.js:3', failureMode: 'the key file is read without a length check' }] } });
      expect(refused).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: 'triage-refused' });
      expect(refused.error).toMatch(/additionalCandidates\[0\] \(secure\/my key\.js:3\) cannot be briefed to a verifier.*no whitespace/);
      expect(h.readRun()).toMatchObject({ phase: 'triage', candidates: before.candidates });
    });

    test('one entry the verifier brief refuses refuses the whole payload; the corrected payload is then all briefed and verified by five verifiers each', async () => {
      const h = sensitive();
      await toTriage(h, { findingsFor: onlyA });
      const before = h.readRun();
      const good = { locationOrLink: 'secure/key.js:9', failureMode: 'the key is compared with == so a type-juggled value passes' };
      const refused = await h.collect({ triage: { additionalCandidates: [good, { locationOrLink: 'secure/key.js:12', failureMode: 'the orchestrator trusts the caller here' }] } });
      expect(refused).toMatchObject({ ok: false, reason: 'triage-refused', error: expect.stringContaining('additionalCandidates[1]') });
      expect(h.readRun()).toMatchObject({ phase: 'triage', candidates: before.candidates, triage: before.triage });
      const verify = await h.collect({ triage: { additionalCandidates: [good, { locationOrLink: 'secure/key.js:12', failureMode: 'the caller is trusted here without a check' }] } });
      expect(verify).toMatchObject({ status: 'DISPATCH', round: 'verify' });
      expect(h.readRun().unbriefable).toEqual([]);
      const perCandidate = new Map();
      for (const a of verify.agents) for (const id of a.candidateIds) perCandidate.set(id, (perCandidate.get(id) || 0) + 1);
      expect([...perCandidate.entries()].sort()).toEqual([['f1', 5], ['f2', 5], ['f3', 5]]);
    });

    // The check is the renderer's own call, not a copy of its grammar: what the renderer refuses is refused here, whatever it
    // is, and what it accepts is accepted here, even a claim a private word list would have refused.
    test('triage asks the verifier brief renderer itself and keeps no grammar of its own', async () => {
      const h = sensitive();
      await toTriage(h, { findingsFor: onlyA });
      h.deps.renderBrief = (role, vars) => {
        if (role === 'verifier' && /zebra/.test(vars.claim)) throw new Error('the verifier brief refuses its input: a zebra is not a failure mode');
        return renderBriefFromFiles(role, vars);
      };
      const refused = await h.collect({ triage: { additionalCandidates: [{ locationOrLink: 'secure/key.js:9', failureMode: 'a zebra crosses the comparison' }] } });
      expect(refused).toMatchObject({ ok: false, reason: 'triage-refused', error: expect.stringContaining('a zebra is not a failure mode') });
      h.deps.renderBrief = () => '# a brief the renderer accepts';
      const accepted = await h.collect({ triage: { additionalCandidates: [{ locationOrLink: 'secure/key.js:9', failureMode: 'the orchestrator never checks the key' }] } });
      expect(accepted).toMatchObject({ ok: true, status: 'DISPATCH', round: 'verify' });
    });

    test('triage outside the triage stop is refused (a verify wave in flight, a finished run, a run still in its review round)', async () => {
      const h = sensitive();
      await toTriage(h, { findingsFor: onlyA });
      const verify = await h.collect({ triage: {} });
      expect(await h.collect({ triage: {} })).toMatchObject({ ok: false, reason: 'triage-not-pending' });
      voteAll(verify, () => 'real');
      expect((await h.collect()).status).toBe('DONE');
      expect(await h.collect({ triage: {} })).toMatchObject({ ok: false, reason: 'triage-not-pending' });
      const early = sensitive();
      expect((await early.prepare()).status).toBe('DISPATCH');
      expect(await early.collect({ triage: {} })).toMatchObject({ ok: false, reason: 'triage-not-pending' });
    });

    test('a head that moves during triage invalidates the run: no verify wave, no ledger, no state report', async () => {
      const h = sensitive();
      await toTriage(h, { findingsFor: onlyA });
      h.head = MOVED;
      expect(await h.collect({ triage: {} })).toMatchObject({ ok: false, status: 'RUN_INVALIDATED', reason: 'head-moved' });
      expect(h.stateWrites).toEqual([]);
      expect(h.readRun().waves.filter((w) => w.round === 'verify')).toEqual([]);
    });
  });

  describe('AC2: no code path downgrades a full run', () => {
    test('the mode comes from the tier alone: a payload cannot ask for one', async () => {
      const h = sensitive();
      expect(await h.prepare({ mode: 'light' })).toMatchObject({ ok: false, reason: 'invalid-input', error: expect.stringContaining('"mode"') });
      expect(await h.prepare({ depth: 'quick' })).toMatchObject({ ok: false, reason: 'invalid-input' });
    });

    test('a full run keeps Deep depth, five verifiers and the lane in every stored phase, whatever happens to its agents', async () => {
      const h = sensitive();
      const manifest = await h.prepare();
      // the security lane never arrives: the run reports the gap, it does not lighten itself
      answerReview(manifest, { skip: ['security-lane'], findingsFor: onlyA });
      const triage = await h.collect({ now: LATE() });
      expect(triage).toMatchObject({ status: 'TRIAGE', security: { status: 'not-run' } });
      const verify = await h.collect({ triage: {} });
      expect(verify.depth).toMatchObject({ mode: 'deep', verifiersPerCandidate: 5 });
      expect(new Set(verify.agents.map((a) => a.name)).size).toBe(5);
      expect(h.readRun()).toMatchObject({ mode: { mode: 'full' }, depth: { mode: 'deep', verifiersPerCandidate: 5 }, securityLane: true });
      voteAll(verify, () => 'real');
      const done = await h.collect();
      expect(done).toMatchObject({ status: 'DONE', mode: { mode: 'full' } });
      expect(done.coverage.complete).toBe(false); // the lane did not run: reported, never read as covered
      expect(done.gate.mergeable).toBe(false);
    });

    const tampered = [
      ['a lighter depth', (run) => { run.depth.mode = 'standard'; }],
      ['fewer verifiers', (run) => { run.depth.verifiersPerCandidate = 3; }],
      ['one reviewer per slice', (run) => { run.depth.reviewersPerSlice = 1; }],
      ['no security lane', (run) => { run.securityLane = false; }],
      // The mode label is what every later call reads, so it is part of the invariant: a stored label is only ever what
      // selectMode says for the tier the run stores (a review of this PR rewrote it to light and got DONE, mode light).
      ['its mode label rewritten to light', (run) => { run.mode.mode = 'light'; }],
      ['no mode label', (run) => { delete run.mode.mode; }],
      ['an unknown mode label', (run) => { run.mode.mode = 'turbo'; }],
      ['no mode record', (run) => { delete run.mode; }],
    ];
    for (const [name, mutate] of tampered) {
      test(`a stored full run with ${name} is not continued: RUN_FAILED mode-invariant, and it stays failed`, async () => {
        const h = sensitive();
        const manifest = await h.prepare();
        answerReview(manifest, { lane: { findings: [], pathsReviewed: allPaths(h) } });
        const stored = h.readRun();
        mutate(stored);
        fs.writeFileSync(path.join(h.runDir(), 'run.json'), JSON.stringify(stored));
        expect(await h.collect()).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: 'mode-invariant' });
        expect(await h.collect()).toMatchObject({ ok: false, reason: 'mode-invariant' });
        expect(h.stateWrites).toEqual([]);
      });
    }

    test('a label-only rewrite to light does not skip TRIAGE or relabel the run: it is refused by name, and nothing is finalised', async () => {
      const h = sensitive();
      const manifest = await h.prepare();
      answerReview(manifest, { lane: { findings: [], pathsReviewed: allPaths(h) } });
      const stored = h.readRun();
      expect(stored.mode.mode).toBe('full');
      stored.mode.mode = 'light';
      fs.writeFileSync(path.join(h.runDir(), 'run.json'), JSON.stringify(stored));
      const out = await h.collect();
      expect(out).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: 'mode-invariant', error: expect.stringMatching(/mode "light".*selects full/) });
      expect(h.readRun().phase).toBe('failed');
      expect(fs.existsSync(path.join(h.runDir(), 'final.json'))).toBe(false);
      expect(h.stateWrites).toEqual([]);
    });

    // Every stored phase is checked, not only the first collect: the label is rewritten after the run reached the phase.
    const phases = [
      ['waiting for triage', async (h) => { await toTriage(h, { findingsFor: onlyA }); }],
      ['in its verify round', async (h) => { await toTriage(h, { findingsFor: onlyA }); await h.collect({ triage: {} }); }],
      ['that has finished', async (h) => {
        await toTriage(h, { findingsFor: onlyA });
        voteAll(await h.collect({ triage: {} }), () => 'real');
        expect((await h.collect()).status).toBe('DONE');
      }],
    ];
    for (const [name, advance] of phases) {
      test(`a mode label rewritten to light on a run ${name} is refused at the next collect, never continued or replayed as a light run`, async () => {
        const h = sensitive();
        await advance(h);
        const stored = h.readRun();
        stored.mode.mode = 'light';
        fs.writeFileSync(path.join(h.runDir(), 'run.json'), JSON.stringify(stored));
        expect(await h.collect()).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: 'mode-invariant' });
      });
    }

    test('a brief the renderer refuses in a full run is RUN_FAILED brief-refused, never NEEDS_FULL_MODE and never a lighter run', async () => {
      const h = harness({ changedPaths: ['core/a b.js'], policyJson: { highPaths: ['core/**'] } });
      const out = await h.prepare();
      expect(out).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: expect.stringContaining('brief-refused'), dispatched: [] });
      expect(h.readRun().phase).toBe('failed');
      expect(await h.collect()).toMatchObject({ status: 'RUN_FAILED' });
    });

    // The unstated design decision a review of this PR found: before full mode ran in the runner every full PR answered
    // NEEDS_FULL_MODE and the narrated Steps 1-10 applied; now a full run that cannot be briefed fails closed, and the answer
    // itself says that, and what the operator may do about it, instead of leaving a bare RUN_FAILED to be read as "blocked".
    test('that refusal states the decision (never lighter, nothing dispatched, no verdict) and the operator\'s way forward, and every later collect repeats it', async () => {
      const h = harness({ changedPaths: ['core/a b.js'], policyJson: { highPaths: ['core/**'] } });
      const out = await h.prepare();
      expect(out).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: expect.stringContaining('brief-refused'), mode: { mode: 'full' }, dispatched: [] });
      expect(out.decision).toMatch(/never lowered to light mode/);
      expect(out.decision).toMatch(/nothing was dispatched/);
      expect(out.decision).toMatch(/no review and no verdict/);
      expect(out.fallback).toMatch(/rename the path/);
      expect(out.fallback).toMatch(/narrated Steps 1-10/);
      expect(out.fallback).toMatch(/start a new run/);
      expect(out.fallback).toMatch(/same renderer, so it refuses the same input/); // the manual procedure is not offered as a way round the refusal
      expect(h.spans.filter((s) => s.type === 'start' && /^agent:/.test(s.name))).toEqual([]);
      expect(await h.collect()).toEqual(out);
      expect(h.stateWrites).toEqual([]);
    });

    test('the light refusal is not that decision: NEEDS_FULL_MODE carries none, because the narrated procedure is its route', async () => {
      const out = await harness({ changedPaths: ['src/a b.js'] }).prepare();
      expect(out).toMatchObject({ ok: false, status: 'NEEDS_FULL_MODE' });
      expect(out.decision).toBeUndefined();
      expect(out.fallback).toBeUndefined();
    });
  });

  describe('AC3: the gate, approvals, independence and completeness are the light mode\'s', () => {
    test('an Important finding the verifiers confirm blocks the gate and is listed open; the review is not complete', async () => {
      const h = sensitive();
      await toTriage(h, { findingsFor: onlyA });
      const verify = await h.collect({ triage: {} });
      voteAll(verify, () => 'real');
      const done = await h.collect();
      expect(done.gate.mergeable).toBe(false);
      expect(done.gate.findings.open).toEqual(['f1']);
      expect(done.gate.blockers.map((b) => b.code)).toContain('open-important-finding');
      expect(done.reviewStatus.complete).not.toBe(true);
    });

    test('no verifier is a reviewer, the security lane or the orchestrator', async () => {
      const h = sensitive();
      await toTriage(h, { findingsFor: onlyA });
      const verify = await h.collect({ triage: {} });
      expect(verify.agents.map((a) => a.name).some((n) => /^reviewer|^security|orchestrator/.test(n))).toBe(false);
    });

    test('a slice nobody reviewed is reported as not reviewed in the TRIAGE answer and the final answer', async () => {
      const h = sensitive();
      const manifest = await h.prepare();
      answerReview(manifest, { skip: ['reviewer-s1-b'], lane: { findings: [], pathsReviewed: allPaths(h) } });
      const triage = await h.collect({ now: LATE() });
      expect(triage).toMatchObject({ status: 'TRIAGE', coverage: { complete: false } });
      expect(triage.coverage.unreviewedSlices).toEqual(['whole-pr']);
      const done = await h.collect({ triage: {} });
      expect(done.status).toBe('DONE');
      expect(done.notReviewed.unreviewedSlices).toEqual(['whole-pr']);
      expect(done.gate.mergeable).toBe(false);
    });
  });

  describe('the re-review scope rule is recorded for a full run', () => {
    const lastReviewedSha = '1'.repeat(40);
    const deltaFacts = () => {
      const facts = makeFacts({ changedPaths: ['secure/key.js', 'src/a.js'], numstat: [{ path: 'secure/key.js', added: 3, deleted: 1 }, { path: 'src/a.js', added: 3, deleted: 1 }], policyJson: { sensitivePaths: ['secure/**'] } });
      return { ...facts, delta: { lastReviewedSha, reviewedHeadSha: lastReviewedSha, reviewedBaseSha: BASE, changedPaths: ['src/a.js'] }, deltaPlan: { mode: 'delta', reasons: ['delta-since-last-review'], readSet: [] } };
    };
    const deltaHarness = (facts) => {
      const h = harness({
        facts,
        prepareOverride: async (options) => {
          const dir = path.join(h.root, 'prepared');
          return { ok: true, status: 'PREPARED', reused: false, dir, manifestPath: path.join(dir, 'manifest.json'), headSha: options.headSha, baseSha: options.baseSha, mode: 'delta', absent: {}, artifacts: { snapshot: { path: path.join(dir, 'snapshot') }, 'range.diff': { path: path.join(dir, 'range.diff') }, 'facts.json': { path: path.join(dir, 'facts.json') }, 'baseline.json': { path: path.join(dir, 'baseline.json') } } };
        },
      });
      return h;
    };

    test('no previous head: first-review', async () => {
      const m = await sensitive().prepare();
      expect(m.reReview).toMatchObject({ scope: 'first-review', reasons: ['no-previous-head'] });
    });

    test('a delta that touches no High or sensitive path, on a head the CLI has seen: delta (and the run still reads the whole range)', async () => {
      const h = deltaHarness(deltaFacts());
      const m = await h.prepare({ lastReviewedSha });
      expect(m).toMatchObject({ status: 'DISPATCH', mode: { mode: 'full' }, reReview: { scope: 'delta', reasons: [], appliedRange: 'full-range' } });
      expect(h.readRun().reReview).toMatchObject({ scope: 'delta' });
    });

    test('a delta that touches a sensitive path is a full re-read, even when the plan said delta', async () => {
      const facts = deltaFacts();
      facts.delta.changedPaths = ['secure/key.js'];
      const m = await deltaHarness(facts).prepare({ lastReviewedSha });
      expect(m.reReview).toMatchObject({ scope: 'full', reasons: expect.arrayContaining(['sensitive-path-touched']) });
    });

    test('a head the CLI has never seen is a full re-read', async () => {
      const facts = deltaFacts();
      facts.delta.reviewedHeadSha = '2'.repeat(40);
      const m = await deltaHarness(facts).prepare({ lastReviewedSha });
      expect(m.reReview).toMatchObject({ scope: 'full', reasons: expect.arrayContaining(['head-never-seen']) });
    });

    test('the TRIAGE and final answers carry the decision', async () => {
      const h = deltaHarness(deltaFacts());
      const m = await h.prepare({ lastReviewedSha });
      answerReview(m, { lane: { findings: [], pathsReviewed: allPaths(h) } });
      expect(await h.collect()).toMatchObject({ status: 'TRIAGE', reReview: { scope: 'delta' } });
      expect(await h.collect({ triage: {} })).toMatchObject({ status: 'DONE', reReview: { scope: 'delta' }, triage: { requested: 0 } });
    });
  });
});

describe('fail closed: what light mode still refuses, and what is not escalated', () => {

  test('a brief the renderer refuses (a path with a space) cannot be reviewed mechanically: full mode', async () => {
    const h = harness({ changedPaths: ['src/a b.js'] });
    const out = await h.prepare();
    expect(out).toMatchObject({ ok: false, status: 'NEEDS_FULL_MODE', reason: expect.stringContaining('brief-refused') });
    expect(h.readRun().phase).toBe('needs-full-mode');
  });

  test('a prose-only PR is Low but not waived: Medium, light, standard depth', async () => {
    const h = harness({ changedPaths: ['docs/guide.md', 'README.md'] });
    const m = await h.prepare();
    expect(m.status).toBe('DISPATCH');
    expect(m.tier).toMatchObject({ tier: 'low', effectiveTier: 'medium' });
    expect(m.depth.mode).toBe('standard');
  });
});

describe('fail closed: a head that moves invalidates the run (AC4)', () => {
  test('moved between prepare and collect: RUN_INVALIDATED, nothing computed, and the answer is stable', async () => {
    const h = harness();
    const m = await h.prepare();
    answerReview(m, { lane: { findings: [], pathsReviewed: allPaths(h) } });
    h.head = MOVED;
    const out = await h.collect();
    expect(out).toMatchObject({ ok: false, status: 'RUN_INVALIDATED', reason: 'head-moved', expectedHead: HEAD, currentHead: MOVED });
    expect(h.stateWrites).toEqual([]);
    expect(fs.existsSync(path.join(h.runDir(), 'final.json'))).toBe(false);
    expect(h.readRun()).toMatchObject({ phase: 'invalidated' });
    expect(h.readRun().candidates).toBeUndefined();
    // terminal: even if the head moves back, the run stays invalid
    h.head = HEAD;
    expect(await h.collect()).toMatchObject({ ok: false, status: 'RUN_INVALIDATED' });
  });

  test('moved while prepare ran: RUN_INVALIDATED before anything is dispatched', async () => {
    const h = harness();
    const prepared = h.deps.prepareReview;
    h.deps.prepareReview = async (o) => {
      const result = await prepared(o);
      h.head = MOVED;
      return result;
    };
    const out = await h.prepare();
    expect(out).toMatchObject({ ok: false, status: 'RUN_INVALIDATED', reason: 'head-moved' });
    expect(h.readRun().waves).toEqual([]);
  });

  test('moved between dispatch and the gate (after the last wave): RUN_INVALIDATED, no ledger, gate, state or final', async () => {
    const h = harness();
    const m = await h.prepare();
    answerReview(m, { lane: { findings: [], pathsReviewed: allPaths(h) } });
    // the first head read (collect step 1) is still the old head; the read made for the gate is the moved one
    let reads = 0;
    h.deps.readPr = async () => {
      reads += 1;
      return { ...h.pr, headSha: reads === 1 ? HEAD : MOVED };
    };
    const out = await h.collect();
    expect(out).toMatchObject({ ok: false, status: 'RUN_INVALIDATED', reason: 'head-moved' });
    expect(reads).toBe(2);
    expect(h.stateWrites).toEqual([]);
    expect(fs.existsSync(path.join(h.runDir(), 'final.json'))).toBe(false);
    expect(h.readRun().phase).toBe('invalidated');
  });

  test('an unreadable head is RUN_FAILED without changing the phase, and a later call proceeds', async () => {
    const h = harness();
    const m = await h.prepare();
    answerReview(m, { lane: { findings: [], pathsReviewed: allPaths(h) } });
    const good = h.deps.readPr;
    h.deps.readPr = async () => ({ ok: false, error: 'gh: rate limited' });
    const out = await h.collect();
    expect(out).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: 'head-unreadable' });
    expect(h.readRun().phase).toBe('review-dispatched');
    h.deps.readPr = good;
    expect((await h.collect()).status).toBe('DONE');
  });

  test('a head read that returns a malformed sha is unreadable, never "the same head"', async () => {
    const h = harness();
    await h.prepare();
    h.deps.readPr = async () => ({ ...h.pr, headSha: 'not-a-sha' });
    expect(await h.collect()).toMatchObject({ status: 'RUN_FAILED', reason: 'head-unreadable' });
  });
});

describe('fail closed: a PR that is no longer open gets no verdict (review of PR 264, P2)', () => {
  test('closed while the agents ran: collect refuses before collecting anything, records nothing, and a retry on a reopened PR proceeds', async () => {
    const h = harness();
    const m = await h.prepare();
    answerReview(m, { lane: { findings: [], pathsReviewed: allPaths(h) } });
    h.pr.state = 'CLOSED';
    const out = await h.collect();
    expect(out).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: 'pr-not-open', prState: 'CLOSED', runId: 'run1' });
    expect(h.stateWrites).toEqual([]);
    expect(h.readRun().phase).toBe('review-dispatched');
    expect(h.readRun().waves[0].status).toBe('dispatched');
    h.pr.state = 'OPEN';
    expect((await h.collect()).status).toBe('DONE');
  });

  test('closed while the preparation ran: prepare refuses at the second head read, before any agent is dispatched or anything is recorded; the same call on the reopened PR proceeds (review of PR 264, round 2 nit)', async () => {
    const h = harness();
    const prepared = h.deps.prepareReview;
    h.deps.prepareReview = async (options) => {
      const result = await prepared(options);
      h.pr.state = 'CLOSED';
      return result;
    };
    const out = await h.prepare();
    expect(out).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: 'pr-not-open', prState: 'CLOSED', runId: 'run1', headSha: HEAD });
    expect(h.stateWrites).toEqual([]);
    expect(fs.existsSync(path.join(h.runDir(), 'run.json'))).toBe(false);
    h.pr.state = 'OPEN';
    h.deps.prepareReview = prepared;
    expect(await h.prepare()).toMatchObject({ status: 'DISPATCH' });
  });

  test('merged between the last wave and the gate: no verdict, no state report, no final.json; the phase is unchanged', async () => {
    const h = harness();
    const m = await h.prepare();
    answerReview(m, { lane: { findings: [], pathsReviewed: allPaths(h) } });
    // the first head read (collect step 1) still says OPEN; the read made for the gate says MERGED
    let reads = 0;
    h.deps.readPr = async () => {
      reads += 1;
      return { ...h.pr, headSha: HEAD, state: reads === 1 ? 'OPEN' : 'MERGED' };
    };
    const out = await h.collect();
    expect(out).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: 'pr-not-open', prState: 'MERGED' });
    expect(reads).toBe(2);
    expect(h.stateWrites).toEqual([]);
    expect(fs.existsSync(path.join(h.runDir(), 'final.json'))).toBe(false);
    expect(h.readRun().phase).not.toBe('done');
  });
});

describe('collect: pending, expired and missing agents', () => {
  test('PENDING while an agent has not arrived and its deadline has not passed; nothing else changes', async () => {
    const h = harness();
    const m = await h.prepare();
    answerReview(m, { skip: ['reviewer-s1-b'], lane: { findings: [], pathsReviewed: allPaths(h) } });
    const out = await h.collect();
    expect(out).toMatchObject({ ok: true, status: 'PENDING', round: 'review', waitingOn: ['reviewer-s1-b'] });
    expect(out.retryAfterMs).toBeGreaterThanOrEqual(1000);
    expect(out.earliestDeadlineAt).toBe(m.agents[1].deadlineAt);
    const run = h.readRun();
    expect(run.phase).toBe('review-dispatched');
    expect(run.candidates).toBeUndefined();
    expect(run.calls.map((c) => c.call)).toEqual(['prepare', 'collect']);
  });

  test('a reviewer that never arrived: its slice is NOT reviewed, coverage is never complete, and it is named', async () => {
    const h = harness();
    const m = await h.prepare();
    answerReview(m, { skip: ['reviewer-s1-b'], lane: { findings: [], pathsReviewed: allPaths(h) } });
    const after = m.agents[1].deadlineAt + 1000;
    const out = await h.collect({ now: after });
    expect(out.status).toBe('DONE');
    expect(out.notReviewed.unreviewedSlices).toEqual(['whole-pr']);
    expect(out.notReviewed.unreviewedPaths).toEqual(['src/a.js']);
    expect(out.notReviewed.expiredAgents).toEqual([expect.objectContaining({ name: 'reviewer-s1-b', state: 'expired' })]);
    expect(out.coverage.complete).toBe(false);
    expect(out.reducedReview).toMatch(/NOT REVIEWED/);
    expect(h.stateWrites[0].state.notReviewed.unreviewedSlices).toEqual(['whole-pr']);
  });

  test('a reviewer that arrived without covering every path of its slice also leaves the slice unreviewed', async () => {
    const h = harness({ changedPaths: ['src/a.js', 'src/b.js'] });
    const m = await h.prepare();
    answerReview(m, { partial: { 'reviewer-s1-a': ['src/a.js'] }, lane: { findings: [], pathsReviewed: allPaths(h) } });
    const out = await h.collect();
    expect(out.notReviewed.unreviewedSlices).toEqual(['whole-pr']);
    expect(out.notReviewed.unreviewedPaths).toEqual(['src/a.js', 'src/b.js']);
    expect(out.coverage.complete).toBe(false);
  });

  test('every reviewer and the lane arrived and covered everything: coverage is complete', async () => {
    const h = harness();
    const { next } = await reviewRound(h);
    expect(next.status).toBe('DONE');
    expect(next.coverage).toEqual({ complete: true, unreviewedSlices: [], uncovered: [] });
    expect(next.notReviewed.expiredAgents).toEqual([]);
  });
});

describe('the security lane (merge-gate 10c)', () => {
  test('clean only when the lane arrived and covered every changed path', async () => {
    const h = harness();
    const { next } = await reviewRound(h);
    expect(next.security).toEqual({ status: 'clean', findings: [] });
    expect(next.gate.securityLane.status).toBe('clean');
  });

  test('a lane that never arrived is not clean: the gate blocks a Medium PR on it', async () => {
    const h = harness();
    const m = await h.prepare();
    answerReview(m, { skip: ['security-lane'] });
    const out = await h.collect({ now: m.agents[2].deadlineAt + 1000 });
    expect(out.security.status).toBe('not-run');
    expect(out.security.status).not.toBe('clean');
    expect(out.gate.mergeable).toBe(false);
    expect(out.gate.blockers.map((b) => b.code)).toContain('security-review-missing');
    expect(out.coverage.complete).toBe(false);
  });

  test('a lane file that is not valid is not clean either', async () => {
    const h = harness();
    const m = await h.prepare();
    answerReview(m, { skip: ['security-lane'] });
    const lane = m.agents.find((a) => a.role === 'security');
    fs.mkdirSync(path.dirname(lane.outPath), { recursive: true });
    fs.writeFileSync(lane.outPath, '{ not json');
    const out = await h.collect({ now: lane.deadlineAt + 1000 });
    expect(out.security.status).not.toBe('clean');
    expect(out.gate.blockers.map((b) => b.code)).toContain('security-review-missing');
  });

  test('a lane that reported clean without having read every changed path is unavailable, never clean', async () => {
    const h = harness({ changedPaths: ['src/a.js', 'src/b.js'] });
    const { next } = await reviewRound(h, { lane: { findings: [], pathsReviewed: ['src/a.js'] } });
    expect(next.security.status).toBe('unavailable');
    expect(next.security.reason).toContain('src/b.js');
    expect(next.gate.blockers[0].code).toBe('review-data-unavailable');
  });

  test('lane findings go to the gate as `security`, not to the verifiers, and block until fixed', async () => {
    const h = harness();
    const m = await h.prepare();
    answerReview(m, { lane: { findings: [finding({ failureMode: 'the path is spliced into a shell command' })], pathsReviewed: allPaths(h) } });
    const out = await h.collect();
    expect(out.status).toBe('DONE');
    expect(out.security.status).toBe('findings');
    expect(out.security.findings[0]).toMatchObject({ id: 's1', source: 'security-lane' });
    expect(out.ledger).toEqual([]);
    expect(out.gate.blockers.map((b) => b.code)).toContain('security-finding-open');
    expect(out.gate.securityLane.open).toEqual(['s1']);
  });
});

describe('findings: completed, never dropped, never closed by an agent', () => {
  test('ids are unique across agents, source is the agent that wrote the file, missing fields are filled and named', async () => {
    const h = harness();
    const m = await h.prepare();
    answerReview(m, {
      findingsFor: (name) => (name === 'reviewer-s1-a' ? [{ id: 'dup', source: 'someone-else', locationOrLink: 'src/a.js:1' }, finding({ id: 'dup', locationOrLink: 'src/a.js:9', failureMode: 'second distinct defect in another place entirely' })] : [{ id: 'dup', locationOrLink: 'src/a.js:40', failureMode: 'a third unrelated problem with the cache invalidation' }]),
      lane: { findings: [], pathsReviewed: allPaths(h) },
    });
    const next = await h.collect();
    expect(next.status).toBe('DISPATCH');
    const run = h.readRun();
    const ids = run.candidates.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(['f1', 'f2', 'f3']);
    const first = run.candidates.find((c) => c.id === 'f1');
    expect(first).toMatchObject({ source: 'reviewer-s1-a', reportedId: 'dup', reportedSource: 'someone-else', severity: 'important', disposition: 'fix' });
    expect(first.completedFields).toEqual(expect.arrayContaining(['severity', 'failureMode', 'evidence', 'originalTextOrLink', 'disposition']));
  });

  test('resolution, cleared and blocking:false written by an agent are stripped: the finding still blocks the gate', async () => {
    const h = harness();
    const m = await h.prepare();
    answerReview(m, {
      findingsFor: (name) => (name === 'reviewer-s1-a' ? [finding({ cleared: true, blocking: false, disposition: 'deferred', reason: 'later', resolution: { reason: 'ok', by: 'maintainer', at: new Date().toISOString(), headSha: HEAD } })] : []),
      lane: { findings: [], pathsReviewed: allPaths(h) },
    });
    let next = await h.collect();
    expect(next.status).toBe('DISPATCH');
    const entry = h.readRun().candidates[0];
    expect(entry.strippedFields).toEqual(expect.arrayContaining(['cleared', 'blocking', 'resolution']));
    expect(entry.cleared).toBeUndefined();
    expect(entry.blocking).toBeUndefined();
    expect(entry.resolution).toBeUndefined();
    voteAll(next, () => 'real');
    next = await h.collect();
    expect(next.status).toBe('DONE');
    expect(next.gate.mergeable).toBe(false);
    expect(next.gate.findings.open).toEqual(['f1']);
  });

  test('an agent cannot resolve a finding by naming the disposition `resolved`', () => {
    const entry = S.completeFinding({ ...finding(), disposition: 'resolved' }, 'reviewer-s1-a', 'f1');
    expect(entry.disposition).toBe('fix');
    expect(entry.completedFields).toContain('disposition');
  });

  test('a severity the ledger does not know is kept (the gate blocks on it), an absent one is Important', () => {
    expect(S.completeFinding(finding({ severity: 'catastrophic' }), 'r', 'f1').severity).toBe('catastrophic');
    expect(S.completeFinding({ ...finding(), severity: undefined }, 'r', 'f1').severity).toBe('important');
  });

  test('non-boolean flags the ledger would refuse are stripped, not carried', () => {
    const entry = S.completeFinding(finding({ uncertain: 'yes', unresolvedThread: true }), 'r', 'f1');
    expect(entry.uncertain).toBeUndefined();
    expect(entry.unresolvedThread).toBe(true);
    expect(entry.strippedFields).toContain('uncertain');
  });

  test('zero candidates skip the verify round', async () => {
    const h = harness();
    const { next } = await reviewRound(h);
    expect(next.status).toBe('DONE');
    expect(next.ledger).toEqual([]);
    expect(h.readRun().waves.map((w) => w.round)).toEqual(['review']);
  });
});

describe('a `pre-existing` label is a claim about provenance and is checked against the diff (review of PR 264, P1)', () => {
  // A unified diff as git writes it: hunks in a changed file, a new file, a deleted file and a binary file.
  const DIFF = `${[
    'diff --git a/src/a.js b/src/a.js',
    'index 1111111..2222222 100644',
    '--- a/src/a.js',
    '+++ b/src/a.js',
    '@@ -1,3 +1,4 @@ function head()',
    ' one',
    '+two',
    ' three',
    ' four',
    '@@ -40,2 +41,2 @@',
    '-old forty',
    '+new forty-one',
    ' tail',
    'diff --git a/src/new.js b/src/new.js',
    'new file mode 100644',
    'index 0000000..3333333',
    '--- /dev/null',
    '+++ b/src/new.js',
    '@@ -0,0 +1,2 @@',
    '+a',
    '+b',
    'diff --git a/old.js b/old.js',
    'deleted file mode 100644',
    'index 4444444..0000000',
    '--- a/old.js',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-x',
    '-y',
    'diff --git a/img.png b/img.png',
    'index 5555555..6666666 100644',
    'Binary files a/img.png and b/img.png differ',
  ].join('\n')}\n`;
  // the files of the head the fake tree holds (the run reads the real snapshot directory); the deleted old.js is not one of them
  const HEAD_FILES = new Set(['src/a.js', 'src/new.js', 'src/other.js', 'src/c.js', 'img.png', 'README.md']);
  // every file is long enough for the lines cited below (a line past the end of a file has its own test)
  const diffOf = (over = {}) => ({ index: S.parseDiffHunks(DIFF), changedPaths: ['src/a.js', 'src/new.js', 'old.js', 'img.png'], snapshotDir: '/snap/dir', exists: (rel) => HEAD_FILES.has(rel), lines: () => 200, ...over });
  const claim = (location, over = {}) => S.completeFinding(finding({ severity: 'pre-existing', locationOrLink: location, ...over }), 'reviewer-s1-a', 'f1');

  test('parseDiffHunks: the new-side range of every hunk, per file; a deleted and a binary file have none', () => {
    const { files } = S.parseDiffHunks(DIFF);
    expect([...files.keys()].sort()).toEqual(['src/a.js', 'src/new.js']);
    expect(files.get('src/a.js').hunks).toEqual([[1, 4], [41, 42]]);
    expect(files.get('src/new.js').hunks).toEqual([[1, 2]]);
    expect(S.parseDiffHunks(null)).toBeNull();
    expect(S.parseDiffHunks('').files.size).toBe(0);
  });

  test('parseDiffHunks counts hunk bodies: an added line `++ x` (read `+++ x`) and a removed `-- x` (read `--- x`) start no file', () => {
    const trap = `${[
      'diff --git a/notes.md b/notes.md',
      '--- a/notes.md',
      '+++ b/notes.md',
      '@@ -1,2 +1,3 @@',
      '--- a/not-a-header.txt',
      '+++ b/not-a-header.txt',
      ' context',
      '+added',
      '\\ No newline at end of file',
      'diff --git a/after.js b/after.js',
      '--- a/after.js',
      '+++ b/after.js',
      '@@ -5 +5 @@',
      '-x',
      '+y',
    ].join('\n')}\n`;
    const { files } = S.parseDiffHunks(trap);
    expect([...files.keys()].sort()).toEqual(['after.js', 'notes.md']);
    expect(files.get('notes.md').hunks).toEqual([[1, 3]]);
    expect(files.get('after.js').hunks).toEqual([[5, 5]]);
  });

  test('parseDiffHunks reads the quoted path git writes for a non-ASCII name', () => {
    const quoted = `${['diff --git "a/caf\\303\\251.js" "b/caf\\303\\251.js"', '--- "a/caf\\303\\251.js"', '+++ "b/caf\\303\\251.js"', '@@ -3 +3 @@', '-a', '+b'].join('\n')}\n`;
    expect(S.parseDiffHunks(quoted).files.get('caf\u00e9.js').hunks).toEqual([[3, 3]]);
  });

  // src/a.js changes lines 1-4 and 41-42 (context included); src/new.js is new (lines 1-2)
  test.each([
    ['src/a.js:1', false],
    ['src/a.js:4', false],
    ['src/a.js:5', true],
    ['src/a.js:40', true],
    ['src/a.js:41', false],
    ['src/a.js:42', false],
    ['src/a.js:43', true],
    ['src/a.js:3-10', false],
    ['src/a.js:10-3', false],
    ['src/a.js:5-39', true],
    ['src/a.js:39-41', false],
    ['src/other.js:7', true],
    ['README.md:1', true],
    ['./src/a.js:2', false],
    ['SRC/A.JS:2', false],
    // the path is looked up exactly: a mis-cased spelling names no file of a case-sensitive head (review of PR 264, round 2, finding 1)
    ['SRC/A.JS:20', false],
    ['/snap/dir/src/a.js:2', false],
    ['/snap/dir/src/a.js:20', true],
    ['src/new.js:1', false],
    ['img.png:1', false],
    ['old.js:1', false],
    ['src/a.js', false],
    ['src/a.js:12:5', false],
    ['src/a.js#L12', false],
    ['src/a.js:0', false],
    ['unspecified', false],
    ['../escape.js:3', false],
    ['/etc/passwd:3', false],
  ])('a pre-existing claim at %s is honoured: %p', (location, honoured) => {
    const out = S.gradePreExisting(claim(location), diffOf());
    expect(out.severity).toBe(honoured ? 'pre-existing' : 'important');
  });

  test('a claim the diff does not bear out is graded Important, the agent\'s word kept beside it and the severity named as stripped', () => {
    const out = S.gradePreExisting(claim('src/a.js:2', { preExisting: true }), diffOf());
    expect(out).toMatchObject({ severity: 'important', claimedSeverity: 'pre-existing', severityNote: expect.stringContaining('inside a hunk'), strippedFields: ['severity'], locationOrLink: 'src/a.js:2' });
    expect(out.preExisting).toBeUndefined();
  });

  test('an unreadable diff bears nothing out; any other severity, and the spellings of pre-existing the ledger reads, are handled as the gate reads them', () => {
    expect(S.gradePreExisting(claim('src/c.js:7'), diffOf({ index: null })).severity).toBe('important');
    expect(S.gradePreExisting(claim('src/c.js:7'), diffOf({ index: null })).severityNote).toMatch(/could not be read/);
    for (const severity of ['Pre-Existing', 'PREEXISTING', 'pre existing']) {
      expect(S.gradePreExisting(claim('src/a.js:2', { severity }), diffOf())).toMatchObject({ severity: 'important', claimedSeverity: severity });
    }
    for (const severity of ['important', 'nit', 'critical', 'catastrophic']) {
      const entry = S.completeFinding(finding({ severity, locationOrLink: 'src/a.js:2' }), 'reviewer-s1-a', 'f1');
      expect(S.gradePreExisting(entry, diffOf())).toBe(entry);
    }
  });

  test('a citation that names no file at the head is never honoured: truncated, prefixed, snapshot-relative and invented spellings of a changed file (review of PR 264, round 2, finding 1)', () => {
    const real = 'packages/development/lib/a.js';
    const other = 'packages/development/lib/other.js';
    const hunk = ['@@ -10,3 +10,3 @@', ' keep', '-old', '+new', ' keep'];
    const diff = { index: S.parseDiffHunks(`${[`diff --git a/${real} b/${real}`, 'index 1111111..2222222 100644', `--- a/${real}`, `+++ b/${real}`, ...hunk].join('\n')}\n`), changedPaths: [real], snapshotDir: '/snap/dir', exists: (rel) => rel === real || rel === other, lines: () => 100 };
    // controls: the exact path of a file the diff does not touch, or a line of the changed file outside its hunk, is honoured; a line inside the hunk is not
    expect(S.gradePreExisting(claim(`${other}:3`), diff).severity).toBe('pre-existing');
    expect(S.gradePreExisting(claim(`${real}:30`), diff).severity).toBe('pre-existing');
    expect(S.gradePreExisting(claim(`${real}:11`), diff).severity).toBe('important');
    for (const spelling of ['lib/a.js:30', 'development/lib/a.js:30', `a/${real}:30`, `b/${real}:30`, `.ensemble/pr-review/run/run1/snapshot/${real}:30`, 'packages/development/lib/nope.js:5', 'packages/development/lib:5']) {
      expect(S.gradePreExisting(claim(spelling), diff)).toMatchObject({ severity: 'important', claimedSeverity: 'pre-existing', severityNote: expect.stringContaining('is not a file at this head'), strippedFields: ['severity'] });
    }
    // nothing to tell what exists: fail closed
    expect(S.gradePreExisting(claim(`${real}:30`), { ...diff, exists: undefined }).severity).toBe('important');
  });

  test('a citation past the end of the file names no line and is never honoured (review of PR 264, round 3, finding 5)', () => {
    const diff = diffOf({ lines: (rel) => (rel === 'src/c.js' ? 40 : 1) });
    // src/c.js has 40 lines and the diff does not touch it: its last line is borne out, the next one is not
    for (const [location, honoured] of [['src/c.js:1', true], ['src/c.js:40', true], ['src/c.js:30-40', true], ['src/c.js:41', false], ['src/c.js:99999', false], ['src/c.js:30-41', false], ['src/c.js:41-30', false], ['src/other.js:1', true], ['src/other.js:2', false]]) {
      expect([location, S.gradePreExisting(claim(location), diff).severity]).toEqual([location, honoured ? 'pre-existing' : 'important']);
    }
    expect(S.gradePreExisting(claim('src/c.js:41'), diff)).toMatchObject({ severity: 'important', claimedSeverity: 'pre-existing', severityNote: expect.stringContaining('src/c.js has 40 lines, so line 41 is past its end'), strippedFields: ['severity'] });
    expect(S.gradePreExisting(claim('src/other.js:2'), diff).severityNote).toContain('src/other.js has 1 line, so line 2 is past its end');
    // nothing to tell how long it is: fail closed, and say so
    expect(S.gradePreExisting(claim('src/c.js:7'), diffOf({ lines: undefined })).severity).toBe('important');
    expect(S.gradePreExisting(claim('src/c.js:7'), diffOf({ lines: () => null })).severityNote).toMatch(/length of src\/c\.js[^]*could not be read/);
  });

  // the files the through-a-run cases cite hold 60 lines: a line past the end of a file is not borne out
  const FILE_TEXT = 'line\n'.repeat(60);

  async function claimsRun(h, locations, files = ['src/a.js', 'src/c.js']) {
    // the cited files exist at the head: a citation of a file that does not is never honoured as pre-existing
    for (const file of files) {
      const target = path.join(h.root, 'prepared', 'snapshot', file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, FILE_TEXT);
    }
    h.reviews = { ok: true, reviews: [{ login: 'bob', authorType: 'User', state: 'APPROVED', commitSha: HEAD, submittedAt: '2026-01-01T00:00:00Z' }] };
    const m = await h.prepare();
    answerReview(m, {
      findingsFor: (name) => (name === 'reviewer-s1-a' ? locations.map((location, i) => finding({ severity: 'pre-existing', locationOrLink: location, failureMode: `defect number ${i} of a different kind in ${location}` })) : []),
      lane: { findings: [], pathsReviewed: allPaths(h) },
    });
    const verify = await h.collect();
    expect(verify).toMatchObject({ status: 'DISPATCH', round: 'verify' });
    voteAll(verify, () => 'real');
    return h.collect();
  }

  test('through a run: a pre-existing finding on a changed line stays in the gate as Important; ones the diff bears out stay pre-existing and do not block', async () => {
    const h = harness({ rangeDiff: DIFF });
    const out = await claimsRun(h, ['src/a.js:2', 'src/c.js:7', 'src/a.js:20']);
    expect(out.status).toBe('DONE');
    const byId = Object.fromEntries(out.ledger.map((entry) => [entry.id, entry]));
    expect(byId.f1).toMatchObject({ severity: 'important', claimedSeverity: 'pre-existing' });
    expect(byId.f2.severity).toBe('pre-existing');
    expect(byId.f3.severity).toBe('pre-existing');
    expect(out.gate.findings).toMatchObject({ open: ['f1'], important: 1, preExisting: 2 });
    expect(out.gate.blockers.map((b) => b.code)).toContain('open-important-finding');
    expect(out.gate.mergeable).toBe(false);
    expect(out.reducedReview).toMatch(/graded Important, not pre-existing[^\n]*f1 \(src\/a\.js:2\)/);
    expect(h.stateWrites[0].state.ledger.find((entry) => entry.id === 'f1').claimedSeverity).toBe('pre-existing');
  });

  test('control: the same claims all on lines the diff does not touch leave the gate mergeable', async () => {
    const h = harness({ rangeDiff: DIFF });
    const out = await claimsRun(h, ['src/c.js:7', 'src/a.js:20']);
    expect(out.gate.findings).toMatchObject({ open: [], important: 0, preExisting: 2 });
    expect(out.gate.mergeable).toBe(true);
    expect(out.reducedReview).not.toMatch(/graded Important, not pre-existing/);
  });

  test('through a run: a truncated, prefixed or invented citation stays blocking even though no hunk holds it; the exact path of a file the diff does not touch does not (review of PR 264, round 2, finding 1)', async () => {
    const real = 'pkg/lib/a.js';
    const diff = `${[`diff --git a/${real} b/${real}`, 'index 1111111..2222222 100644', `--- a/${real}`, `+++ b/${real}`, '@@ -10,3 +10,3 @@', ' keep', '-old', '+new', ' keep'].join('\n')}\n`;
    const h = harness({ changedPaths: [real], rangeDiff: diff });
    const out = await claimsRun(h, ['lib/a.js:30', 'a/pkg/lib/a.js:30', 'pkg/lib/nope.js:5', 'pkg/lib/other.js:3'], [real, 'pkg/lib/other.js']);
    expect(out.status).toBe('DONE');
    const byId = Object.fromEntries(out.ledger.map((entry) => [entry.id, entry]));
    for (const id of ['f1', 'f2', 'f3']) {
      expect(byId[id]).toMatchObject({ severity: 'important', claimedSeverity: 'pre-existing', severityNote: expect.stringContaining('is not a file at this head') });
    }
    expect(byId.f4.severity).toBe('pre-existing');
    expect(out.gate.findings).toMatchObject({ open: ['f1', 'f2', 'f3'], important: 3, preExisting: 1 });
    expect(out.gate.blockers.map((b) => b.code)).toContain('open-important-finding');
    expect(out.gate.mergeable).toBe(false);
  });

  const snapshotAt = (h, rel) => path.join(h.root, 'prepared', 'snapshot', rel);
  const seed = (h, rel, text = FILE_TEXT) => {
    fs.mkdirSync(path.dirname(snapshotAt(h, rel)), { recursive: true });
    fs.writeFileSync(snapshotAt(h, rel), text);
  };
  const link = (h, rel, target) => {
    fs.mkdirSync(path.dirname(snapshotAt(h, rel)), { recursive: true });
    fs.symlinkSync(target, snapshotAt(h, rel));
  };

  posix('through a run: a symlink is never followed and a mis-cased name names no file, so none of them bears a pre-existing claim out (review of PR 264, round 3, findings 1 and 2)', async () => {
    const h = harness({ rangeDiff: DIFF });
    const outside = path.join(h.root, 'outside.txt');
    fs.writeFileSync(outside, FILE_TEXT);
    seed(h, 'src/c.js'); // control: a regular file of the head
    link(h, 'src/alias.js', 'c.js'); // a link to a file inside the snapshot
    link(h, 'src/leak.js', outside); // a link out of the snapshot, to a file that has the cited line
    link(h, 'src/device.js', '/dev/null'); // a link to a device
    link(h, 'linked', 'src'); // a link where a directory should be
    const out = await claimsRun(h, ['src/c.js:7', 'src/alias.js:7', 'src/leak.js:7', 'src/device.js:7', 'linked/c.js:7', 'SRC/C.JS:7', 'src/C.js:7'], []);
    expect(out.status).toBe('DONE');
    const byId = Object.fromEntries(out.ledger.map((entry) => [entry.id, entry]));
    expect(byId.f1.severity).toBe('pre-existing');
    for (const id of ['f2', 'f3', 'f4', 'f5', 'f6', 'f7']) {
      expect(byId[id]).toMatchObject({ severity: 'important', claimedSeverity: 'pre-existing', severityNote: expect.stringContaining('is not a file at this head') });
    }
    expect(out.gate.findings).toMatchObject({ open: ['f2', 'f3', 'f4', 'f5', 'f6', 'f7'], important: 6, preExisting: 1 });
    expect(out.gate.mergeable).toBe(false);
  });

  test('through a run on a case-insensitive filesystem a mis-cased name still names no file (review of PR 264, round 3, finding 2)', async () => {
    const h = harness({ rangeDiff: DIFF });
    seed(h, 'src/c.js');
    const volume = caseInsensitive(path.join(h.root, 'prepared', 'snapshot'));
    h.deps.fs = { ...h.deps.fs, readText: volume.readText, headFile: (root, rel) => headFile(root, rel, volume.io) };
    const out = await claimsRun(h, ['src/c.js:7', 'SRC/C.JS:7', 'src/C.js:7', 'Src/c.JS:7'], []);
    expect(out.status).toBe('DONE');
    const byId = Object.fromEntries(out.ledger.map((entry) => [entry.id, entry]));
    expect(byId.f1.severity).toBe('pre-existing');
    for (const id of ['f2', 'f3', 'f4']) {
      expect(byId[id]).toMatchObject({ severity: 'important', claimedSeverity: 'pre-existing', severityNote: expect.stringContaining('is not a file at this head') });
    }
    expect(out.gate.mergeable).toBe(false);
  });

  test('through a run: a line past the end of the file is graded Important and the last line is not (review of PR 264, round 3, finding 5)', async () => {
    const h = harness({ rangeDiff: DIFF });
    const out = await claimsRun(h, ['src/c.js:60', 'src/c.js:61', 'src/c.js:99999', 'src/c.js:50-70', 'src/c.js:1-60'], ['src/c.js']);
    expect(out.status).toBe('DONE');
    const byId = Object.fromEntries(out.ledger.map((entry) => [entry.id, entry]));
    expect(byId.f1.severity).toBe('pre-existing');
    expect(byId.f5.severity).toBe('pre-existing');
    for (const id of ['f2', 'f3', 'f4']) {
      expect(byId[id]).toMatchObject({ severity: 'important', claimedSeverity: 'pre-existing', severityNote: expect.stringContaining('src/c.js has 60 lines') });
    }
    expect(out.gate.findings).toMatchObject({ open: ['f2', 'f3', 'f4'], important: 3, preExisting: 2 });
    expect(out.gate.mergeable).toBe(false);
  });

  test('a file system that cannot look a file up, or throws, bears nothing out', async () => {
    for (const lookup of [undefined, () => { throw new Error('EIO'); }, () => ({ lines: 'many' }), () => ({})]) {
      const h = harness({ rangeDiff: DIFF });
      h.deps.fs = { ...h.deps.fs, headFile: lookup };
      const out = await claimsRun(h, ['src/c.js:7'], ['src/c.js']);
      expect(out.ledger[0]).toMatchObject({ severity: 'important', claimedSeverity: 'pre-existing' });
      expect(out.gate.mergeable).toBe(false);
    }
  });

  test('a diff that cannot be read bears nothing out: every pre-existing claim is graded Important', async () => {
    const h = harness({ rangeDiff: DIFF });
    const out = await (async () => {
      h.reviews = { ok: true, reviews: [] };
      const m = await h.prepare();
      fs.rmSync(path.join(h.root, 'prepared', 'range.diff'));
      answerReview(m, { findingsFor: (name) => (name === 'reviewer-s1-a' ? [finding({ severity: 'pre-existing', locationOrLink: 'src/c.js:7' })] : []), lane: { findings: [], pathsReviewed: allPaths(h) } });
      const verify = await h.collect();
      voteAll(verify, () => 'real');
      return h.collect();
    })();
    expect(out.ledger[0]).toMatchObject({ severity: 'important', claimedSeverity: 'pre-existing', severityNote: expect.stringContaining('could not be read') });
    expect(out.gate.findings.open).toEqual(['f1']);
  });

  test('the diff is read only when a pre-existing claim needs it, and a security-lane finding is never regraded (it blocks whatever its label)', async () => {
    const reads = [];
    const h = harness({ rangeDiff: DIFF });
    const real = h.deps.fs;
    h.deps.fs = { ...real, readText: (file) => (reads.push(path.basename(file)), real.readText(file)) };
    const m = await h.prepare();
    answerReview(m, { findingsFor: (name) => (name === 'reviewer-s1-a' ? [finding()] : []), lane: { findings: [finding({ severity: 'pre-existing', locationOrLink: 'src/c.js:7', failureMode: 'the path is spliced into a shell command' })], pathsReviewed: allPaths(h) } });
    const verify = await h.collect();
    voteAll(verify, () => 'real');
    const out = await h.collect();
    expect(reads.filter((name) => name === 'range.diff')).toEqual([]);
    expect(out.security.findings[0]).toMatchObject({ id: 's1', severity: 'pre-existing' });
    expect(out.gate.blockers.map((b) => b.code)).toContain('security-finding-open');
  });

  test('the reviewer is told how the label is checked', async () => {
    const h = harness();
    const m = await h.prepare();
    expect(fs.readFileSync(m.agents[0].briefPath, 'utf8')).toMatch(/pre-existing[^\n]*checks the `file:line` you cite against the diff[^\n]*graded Important/);
  });

  test('the reviewer is told that a symlink is not followed and that a line past the end of the file is graded Important', async () => {
    const h = harness();
    const m = await h.prepare();
    expect(fs.readFileSync(m.agents[0].briefPath, 'utf8')).toMatch(/pre-existing[^\n]*regular file at the head[^\n]*symlink[^\n]*past the end of that file[^\n]*graded Important/);
  });
});

describe('headFile: the file a citation names -- exactly spelled, a regular file, never followed -- and its line count (review of PR 264, round 3, findings 1, 2 and 5)', () => {
  // the count is read in 64 KiB pieces: the cases around that size pin what carries over from one read to the next
  test.each([
    ['an empty file', '', 0],
    ['no newline at all', 'a', 1],
    ['one line', 'a\n', 1],
    ['a last line without a newline', 'a\nb', 2],
    ['two lines', 'a\nb\n', 2],
    ['one empty line', '\n', 1],
    ['two empty lines', '\n\n', 2],
    ['CRLF endings', 'a\r\nb\r\n', 2],
    ['a newline that is the last byte of the first read', `${'x'.repeat(65535)}\n`, 1],
    ['a partial line after that newline', `${'x'.repeat(65535)}\ny`, 2],
    ['a newline in the first read and none after', `\n${'x'.repeat(70000)}`, 2],
    ['many reads', 'x\n'.repeat(70000), 70000],
    ['many reads and a partial last line', `${'x\n'.repeat(70000)}y`, 70001],
    ['a first read that ends mid-line and a last read that ends with the newline', `${'x'.repeat(70000)}\n`, 1],
  ])('counts the lines of %s', (_label, text, count) => {
    const { snap } = headTree({ 'src/f.txt': text });
    expect(headFile(snap, 'src/f.txt')).toEqual({ lines: count });
  });

  test('every segment of the path must match a directory entry exactly: a mis-cased name names no file, whatever the host does', () => {
    const { snap } = headTree({ 'src/Deep/a.js': 'x\n' });
    expect(headFile(snap, 'src/Deep/a.js')).toEqual({ lines: 1 });
    for (const rel of ['SRC/Deep/a.js', 'src/deep/a.js', 'src/Deep/A.js', 'src/Deep/a.JS', 'SRC/DEEP/A.JS']) expect([rel, headFile(snap, rel)]).toEqual([rel, null]);
  });

  test('the same on a case-insensitive volume, where a path reaches whatever its segments match ignoring case', () => {
    const { snap } = headTree({ 'src/Deep/a.js': 'x\n' });
    const volume = caseInsensitive(snap);
    const fd = volume.io.openSync(path.join(snap, 'SRC', 'deep', 'A.JS'), fs.constants.O_RDONLY); // the volume really does answer for a mis-cased name
    fs.closeSync(fd);
    expect(headFile(snap, 'src/Deep/a.js', volume.io)).toEqual({ lines: 1 });
    for (const rel of ['SRC/Deep/a.js', 'src/deep/a.js', 'src/Deep/A.js', 'SRC/DEEP/A.JS']) expect([rel, headFile(snap, rel, volume.io)]).toEqual([rel, null]);
  });

  test('a path that is not a plain relative path to a file names nothing', () => {
    const { snap } = headTree({ 'src/a.js': 'x\n', 'top.js': 'y\n' });
    for (const rel of ['', '.', '..', '../snap/src/a.js', 'src/../src/a.js', './src/a.js', 'src//a.js', '/src/a.js', 'src/a.js/', 'src', 'src/', 'nope.js', 'src/nope.js', 'src/a.js/x', 'src/a.js\0']) {
      expect([rel, headFile(snap, rel)]).toEqual([rel, null]);
    }
    expect(headFile(snap, undefined)).toBeNull();
    expect(headFile(snap, 5)).toBeNull();
    expect(headFile(snap, 'top.js')).toEqual({ lines: 1 });
  });

  posix('a symlink is not a file of the head: wherever it points, whatever it points at', () => {
    const { root, snap } = headTree({ 'src/a.js': 'x\n', 'real/b.js': 'y\n' });
    const outside = path.join(root, 'outside.txt');
    fs.writeFileSync(outside, 'secret\n');
    fs.symlinkSync('a.js', path.join(snap, 'src', 'inside.js')); // to a file inside the snapshot
    fs.symlinkSync(path.join('..', '..', 'outside.txt'), path.join(snap, 'src', 'relative-out.js')); // out of the snapshot, relative
    fs.symlinkSync(outside, path.join(snap, 'src', 'absolute-out.js')); // out of the snapshot, absolute
    fs.symlinkSync('/dev/null', path.join(snap, 'src', 'device.js')); // to a device
    fs.symlinkSync('nope.js', path.join(snap, 'src', 'dangling.js')); // to nothing
    fs.symlinkSync('real', path.join(snap, 'linked')); // a directory link inside the snapshot
    fs.symlinkSync(root, path.join(snap, 'out-dir')); // a directory link out of the snapshot
    for (const rel of ['src/inside.js', 'src/relative-out.js', 'src/absolute-out.js', 'src/device.js', 'src/dangling.js', 'linked/b.js', 'out-dir/outside.txt', 'linked']) {
      expect([rel, headFile(snap, rel)]).toEqual([rel, null]);
    }
    // controls: the files themselves
    expect(headFile(snap, 'src/a.js')).toEqual({ lines: 1 });
    expect(headFile(snap, 'real/b.js')).toEqual({ lines: 1 });
  });

  posix('a symlink to a FIFO, or a FIFO itself, is refused at once instead of blocking the collector', () => {
    const { root, snap } = headTree({ 'src/a.js': 'x\n' });
    expect(spawnSync('mkfifo', [path.join(root, 'fifo')]).status).toBe(0);
    fs.symlinkSync(path.join('..', '..', 'fifo'), path.join(snap, 'src', 'evil.js'));
    expect(spawnSync('mkfifo', [path.join(snap, 'src', 'direct.js')]).status).toBe(0);
    // a child process with a deadline: a lookup that opened the FIFO would block forever, and the test must fail rather than hang
    const script = `const { headFile } = require(${JSON.stringify(CLI_MODULE)}); console.log(JSON.stringify(['src/evil.js', 'src/direct.js', 'src/a.js'].map((rel) => headFile(${JSON.stringify(snap)}, rel))));`;
    const child = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 10000 });
    expect(child.error).toBeUndefined();
    expect(JSON.parse(child.stdout)).toEqual([null, null, { lines: 1 }]);
  }, 20000);

  posix('an entry swapped for a FIFO or a symlink after it was listed is still refused, at the descriptor', () => {
    const { snap } = headTree({ 'src/ok.js': 'x\n', 'src/target.js': 'a\nb\nc\n' });
    expect(spawnSync('mkfifo', [path.join(snap, 'src', 'swapped-fifo.js')]).status).toBe(0);
    fs.symlinkSync('target.js', path.join(snap, 'src', 'swapped-link.js'));
    // the listing is stale: it still calls both entries regular files, as it did before they were swapped
    const script = `
      const fs = require('fs');
      const { headFile } = require(${JSON.stringify(CLI_MODULE)});
      const stale = new Set(['swapped-fifo.js', 'swapped-link.js']);
      const io = {
        openSync: fs.openSync, fstatSync: fs.fstatSync, readSync: fs.readSync, closeSync: fs.closeSync,
        readdirSync: (dir, options) => fs.readdirSync(dir, options).map((entry) => (stale.has(entry.name) ? { name: entry.name, isFile: () => true, isDirectory: () => false } : entry)),
      };
      const answer = (rel) => { try { return headFile(${JSON.stringify(snap)}, rel, io); } catch (error) { return { threw: error.code }; } };
      console.log(JSON.stringify(['src/swapped-fifo.js', 'src/swapped-link.js', 'src/ok.js'].map(answer)));
    `;
    const child = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 10000 });
    expect(child.error).toBeUndefined();
    const [fifo, symlink, ok] = JSON.parse(child.stdout);
    expect(fifo).toBeNull(); // opened without blocking, then refused: it is not a regular file
    expect(['ELOOP', 'EMLINK']).toContain(symlink.threw); // never followed
    expect(ok).toEqual({ lines: 1 });
  }, 20000);
});

describe('the verify round', () => {
  async function toVerify(h, findings) {
    const { next } = await reviewRound(h, { findingsFor: (name) => (name === 'reviewer-s1-a' ? findings : []) });
    return next;
  }

  test('K=3 fresh verifiers per candidate, never the raiser, at most three candidates each; the brief carries only the failure mode', async () => {
    const h = harness();
    const m = await toVerify(h, [finding(), finding({ locationOrLink: 'src/a.js:20', failureMode: 'an unrelated defect in the retry loop of the client' })]);
    expect(m).toMatchObject({ status: 'DISPATCH', round: 'verify', wave: '1 of 1' });
    expect(m.agents.every((a) => a.role === 'verifier' && a.candidateIds.length <= 3)).toBe(true);
    const perCandidate = new Map();
    for (const a of m.agents) for (const id of a.candidateIds) perCandidate.set(id, (perCandidate.get(id) || 0) + 1);
    expect([...perCandidate.values()]).toEqual([3, 3]);
    expect(m.agents.some((a) => /reviewer/.test(a.name))).toBe(false);
    const brief = fs.readFileSync(m.agents[0].briefPath, 'utf8');
    expect(brief).toContain('the loop reads past the end of the list');
    expect(brief).toContain('src/a.js:3');
    expect(brief).not.toContain('reviewer-s1-a');
    expect(brief).not.toContain('line 3 indexes list'); // the reviewer's evidence is not handed over
    expect(brief).toContain('Output contract');
  });

  test('three real votes -> the finding is present and the gate holds it open; the lane is untouched', async () => {
    const h = harness();
    const m = await toVerify(h, [finding()]);
    voteAll(m, () => 'real');
    const out = await h.collect();
    expect(out.status).toBe('DONE');
    expect(out.votes.verification).toBe('performed');
    expect(out.votes.outcomes[0]).toMatchObject({ id: 'f1', outcome: 'present' });
    expect(out.ledger[0].verification).toMatchObject({ outcome: 'present', tally: { real: 3, expected: 3 } });
    expect(out.gate.blockers.map((b) => b.code)).toEqual(expect.arrayContaining(['open-important-finding']));
    expect(h.stateWrites[0].state.verification.verification).toBe('performed');
  });

  test('a verifier that never arrived: the candidate is unverified, never read as agreement, even when the others voted real', async () => {
    const h = harness();
    const m = await toVerify(h, [finding()]);
    voteAll(m, () => 'real', [m.agents[2].name]);
    const out = await h.collect({ now: m.agents[2].deadlineAt + 1000 });
    expect(out.status).toBe('DONE');
    const outcome = out.votes.outcomes[0];
    expect(outcome.outcome).toBe('unverified');
    expect(outcome.reason).toBe('verifier-incomplete');
    expect(outcome.outcome).not.toBe('present');
    expect(out.notReviewed.incompleteVerifiers.map((v) => v.verifier)).toEqual([m.agents[2].name]);
    expect(out.notReviewed.expiredAgents.map((a) => a.name)).toEqual([m.agents[2].name]);
    expect(out.votes.verification).toBe('not-performed');
    expect(out.reducedReview).toMatch(/verification not-performed/);
    // unverified is presented, and still open at the gate
    expect(out.gate.findings.open).toEqual(['f1']);
  });

  test('verifiers that vote not-real do not delete the finding: it stays in the ledger and the gate still holds it open', async () => {
    const h = harness();
    const m = await toVerify(h, [finding()]);
    voteAll(m, () => 'not-real');
    const out = await h.collect();
    expect(out.ledger).toHaveLength(1);
    expect(out.ledger[0].verification.outcome).toBe('filtered');
    expect(out.ledger[0].verification.authorLabel).toBe('verifier disagrees');
    expect(out.gate.findings.open).toEqual(['f1']);
  });

  test('an unbriefable candidate is KEPT: recorded unbriefable with the reason and its kind, unverified, and listed in the result', async () => {
    const h = harness();
    const m = await toVerify(h, [finding({ failureMode: 'the verdict of the cache is stale after reload' }), finding({ locationOrLink: 'src/a.js:20', failureMode: 'an unrelated defect in the retry loop of the client' })]);
    expect(m.status).toBe('DISPATCH');
    const ids = new Set(m.agents.flatMap((a) => a.candidateIds));
    expect(ids).toEqual(new Set(['f2']));
    voteAll(m, () => 'real');
    const out = await h.collect();
    expect(out.ledger.map((e) => e.id).sort()).toEqual(['f1', 'f2']);
    // kata 0g9n: the record also says WHY (the renderer's own tag, not parsed from its message) and which input
    expect(out.notReviewed.unbriefable).toEqual([{ id: 'f1', kind: 'leak', input: 'claim', reason: expect.stringContaining('verdict') }]);
    const kept = out.votes.outcomes.find((o) => o.id === 'f1');
    expect(kept.outcome).toBe('unverified');
    expect(out.notReviewed.unbriefable).toHaveLength(1);
    expect(out.gate.findings.open).toContain('f1');
  });

  test('a location the renderer refuses (no line) is unbriefable too, not dropped', async () => {
    const h = harness();
    const m = await toVerify(h, [finding({ locationOrLink: 'src/a.js' }), finding({ locationOrLink: 'src/a.js:2', failureMode: 'a second finding about the parser' })]);
    voteAll(m, () => 'real');
    const out = await h.collect();
    expect(out.notReviewed.unbriefable.map((u) => u.id)).toEqual(['f1']);
    expect(out.ledger).toHaveLength(2);
  });

  test('the concurrency cap makes WAVES: wave k+1 is emitted only after wave k is collected, with fresh deadlines', async () => {
    const h = harness({ policyJson: { maxConcurrentAgents: 2 } });
    const manifest = await h.prepare();
    // review round: 3 agents at a cap of 2 -> 2 waves
    expect(manifest).toMatchObject({ round: 'review', wave: '1 of 2', maxConcurrentAgents: 2 });
    expect(manifest.agents).toHaveLength(2);
    answerReview(manifest, { lane: { findings: [], pathsReviewed: allPaths(h) } });
    const second = await h.collect();
    expect(second).toMatchObject({ status: 'DISPATCH', round: 'review', wave: '2 of 2' });
    expect(second.agents.map((a) => a.name)).toEqual(['security-lane']);
    expect(second.agents[0].dispatchedAt).toBeGreaterThanOrEqual(manifest.agents[0].dispatchedAt);
    // still pending while wave 2 has not been answered
    expect((await h.collect()).status).toBe('PENDING');
    answerReview(second, { lane: { findings: [], pathsReviewed: allPaths(h) } });
    const done = await h.collect();
    expect(done.status).toBe('DONE');
    expect(done.coverage.complete).toBe(true);
  });

  test('verifier waves: 4 candidates x 3 verifiers at a cap of 2', async () => {
    const h = harness({ policyJson: { maxConcurrentAgents: 2 } });
    const m1 = await h.prepare();
    answerReview(m1, { findingsFor: (n) => (n === 'reviewer-s1-a' ? [0, 1, 2, 3].map((i) => finding({ locationOrLink: `src/a.js:${i + 1}`, failureMode: `distinct defect number ${i} in a different subsystem ${'x'.repeat(i)}` })) : []), lane: { findings: [], pathsReviewed: allPaths(h) } });
    const m2 = await h.collect();
    expect(m2.round).toBe('review');
    answerReview(m2, { lane: { findings: [], pathsReviewed: allPaths(h) } });
    let m = await h.collect();
    expect(m.round).toBe('verify');
    expect(m.agents.length).toBeLessThanOrEqual(2);
    const waves = [m];
    const [, total] = m.wave.split(' of ').map(Number);
    expect(total).toBeGreaterThan(1);
    for (let i = 1; i < total; i += 1) {
      voteAll(m, () => 'real');
      m = await h.collect();
      waves.push(m);
      expect(m.round).toBe('verify');
    }
    voteAll(m, () => 'real');
    const out = await h.collect();
    expect(out.status).toBe('DONE');
    expect(waves.every((w) => w.agents.length <= 2)).toBe(true);
    const names = waves.flatMap((w) => w.agents.map((a) => a.name));
    expect(new Set(names).size).toBe(names.length);
    expect(out.votes.outcomes.every((o) => o.outcome === 'present')).toBe(true);
    expect(out.metrics.dispatchRounds).toBe(2 + total);
  });
});

describe('a candidate the verifier brief refuses (kata 0g9n): never verified, never dropped, never read as verified', () => {
  // Reviewers of review infrastructure write these words about the code; the verifier brief refuses them in a claim (by design:
  // the claim must be reworded by whoever wrote it), so the candidate cannot be put to a verifier. The REAL renderer is used.
  const LEAKY = 'the orchestrator never rereads the list after the cache went stale';
  const leaky = (over = {}) => finding({ failureMode: LEAKY, ...over });
  const clean = (n) => finding({ locationOrLink: `src/a.js:${n * 10}`, originalTextOrLink: `src/a.js:${n * 10}`, failureMode: `distinct defect number ${n} in a different subsystem ${'x'.repeat(n)}` });
  const toVerify = async (h, findings) => (await reviewRound(h, { findingsFor: (name) => (name === 'reviewer-s1-a' ? findings : []) })).next;
  const askedOf = (m) => {
    const byCandidate = new Map();
    for (const a of m.agents) for (const id of a.candidateIds) byCandidate.set(id, [...(byCandidate.get(id) || []), a.name]);
    return byCandidate;
  };

  test('the verification plan is for the candidates a verifier can be briefed with: each gets K distinct verifiers, the pool is sized for them alone and the refused one has no slot', async () => {
    const h = harness();
    const m = await toVerify(h, [leaky(), clean(2), clean(3), clean(4)]);
    expect(m).toMatchObject({ status: 'DISPATCH', round: 'verify' });
    const asked = askedOf(m);
    expect([...asked.keys()].sort()).toEqual(['f2', 'f3', 'f4']);
    for (const names of asked.values()) expect(new Set(names).size).toBe(3); // K = 3 distinct verifiers, nobody short
    expect(m.agents).toHaveLength(3); // a pool for three candidates; planned for four it would be four agents
    const run = h.readRun();
    expect(run.assignment.map((a) => a.id)).toEqual(['f2', 'f3', 'f4']);
    expect(run.assignment.every((a) => a.verifiers.length === 3 && !a.verifiers.includes('reviewer-s1-a'))).toBe(true);
    expect(run.unbriefable).toEqual([{ id: 'f1', kind: 'leak', input: 'claim', reason: expect.stringContaining('reads as the orchestrator') }]);
    // independence: no verifier is handed the refused claim, and nothing about the orchestrator reaches a brief
    for (const a of m.agents) {
      const brief = fs.readFileSync(a.briefPath, 'utf8');
      expect(brief).not.toContain(LEAKY);
      expect(brief).not.toMatch(/orchestrator/i);
    }
  });

  test('it ends UNVERIFIED with a named reason in the ledger, the votes, the notice, the state report and the operator\'s list; its tally is none, never a zero count', async () => {
    const h = harness();
    const m = await toVerify(h, [leaky(), clean(2)]);
    voteAll(m, () => 'real');
    const out = await h.collect();
    expect(out.status).toBe('DONE');
    const f1 = out.ledger.find((e) => e.id === 'f1');
    expect(f1.failureMode).toBe(LEAKY); // the reviewer's claim is kept exactly as written
    expect(f1.verification).toEqual({
      outcome: 'unverified',
      reason: 'unbriefable',
      authorLabel: 'unverified',
      presented: true,
      tally: null,
      assigned: [],
      incompleteVerifiers: [],
      ignoredVotes: [],
      unbriefable: { kind: 'leak', input: 'claim', reason: expect.stringContaining('reads as the orchestrator') },
    });
    expect(out.ledger.find((e) => e.id === 'f2').verification).toMatchObject({ outcome: 'present', tally: { real: 3, expected: 3 } });
    // the verification summary is never `performed` while a candidate was never asked about
    expect(out.votes).toMatchObject({ verification: 'partial', reason: 'unbriefable-candidates', recoveryAction: 'reword-the-claim-or-decide' });
    expect(out.votes.outcomes.find((o) => o.id === 'f1')).toEqual({ id: 'f1', outcome: 'unverified', reason: 'unbriefable', authorLabel: 'unverified', tally: null });
    expect(out.notReviewed.unbriefable).toEqual([{ id: 'f1', kind: 'leak', input: 'claim', reason: expect.stringContaining('orchestrator') }]);
    expect(out.reducedReview).toMatch(/verification partial: unbriefable-candidates/);
    expect(out.reducedReview).toMatch(/UNVERIFIED, no verifier was asked[^\n]*: f1 \(leak, claim\)/);
    // the gate holds it open like any other Important finding; the operator is told it was not verified, and by what
    expect(out.gate.findings.open).toEqual(expect.arrayContaining(['f1', 'f2']));
    expect(out.gate.dispositionChoices.find((c) => c.id === 'f1')).toMatchObject({
      group: 'blocking',
      votes: null,
      verification: { outcome: 'unverified', reason: 'unbriefable', unbriefable: { kind: 'leak', input: 'claim', reason: expect.stringContaining('orchestrator') } },
    });
    expect(out.gate.dispositionChoices.find((c) => c.id === 'f2')).not.toHaveProperty('verification');
    const state = h.stateWrites[h.stateWrites.length - 1].state;
    expect(state.notReviewed.unbriefable.map((u) => u.id)).toEqual(['f1']);
    expect(state.verification).toMatchObject({ verification: 'partial', reason: 'unbriefable-candidates' });
    expect(state.ledger.find((e) => e.id === 'f1').verification).toMatchObject({ outcome: 'unverified', reason: 'unbriefable' });
  });

  test('when every candidate is refused there is no verify wave: the run goes straight to DONE, verification is not-performed and each candidate is named', async () => {
    const h = harness();
    const { next } = await reviewRound(h, { findingsFor: (n) => (n === 'reviewer-s1-a' ? [leaky(), finding({ locationOrLink: 'src/my file.js:1', originalTextOrLink: 'src/my file.js:1', failureMode: 'a file name with a space in it is read without a length check' })] : []) });
    expect(next.status).toBe('DONE');
    expect(h.readRun().waves.filter((w) => w.round === 'verify')).toEqual([]);
    expect(next.votes).toMatchObject({ verification: 'not-performed', reason: 'unbriefable-candidates', recoveryAction: 'reword-the-claim-or-decide' });
    expect(next.votes.outcomes.map((o) => [o.id, o.outcome, o.reason])).toEqual([['f1', 'unverified', 'unbriefable'], ['f2', 'unverified', 'unbriefable']]);
    expect(next.notReviewed.unbriefable.map((u) => [u.id, u.kind, u.input])).toEqual([['f1', 'leak', 'claim'], ['f2', 'path', 'location']]);
    expect(next.gate.mergeable).toBe(false);
    expect(next.gate.findings.open).toEqual(['f1', 'f2']);
  });

  test('a refusal the renderer did not tag is recorded as kind other, and a kind outside the vocabulary is not trusted', async () => {
    // A stand-in renderer that throws a plain Error (a missing template, a broken install) or an Error with a made-up kind: the run
    // still keeps the candidate unverified and names why, in the closed vocabulary, without reading the message.
    const refusing = (thrown) => harness({ overrides: { renderBrief: (role, vars) => {
      if (role === 'verifier' && /STANDIN/.test(vars.claim)) throw thrown;
      return renderBriefFromFiles(role, vars);
    } } });
    for (const [thrown, expected] of [
      [new Error('the template store is unreachable'), { id: 'f1', kind: 'other', reason: expect.stringContaining('the template store is unreachable') }],
      [Object.assign(new Error('an odd refusal'), { kind: 'weird', input: 'claim' }), { id: 'f1', kind: 'other', input: 'claim', reason: expect.stringContaining('an odd refusal') }],
    ]) {
      const h = refusing(thrown);
      const m = await toVerify(h, [finding({ failureMode: 'STANDIN the cache is read after it was cleared' }), clean(2)]);
      expect([...askedOf(m).keys()]).toEqual(['f2']);
      expect(h.readRun().unbriefable).toEqual([expected]);
    }
  });

  test.each([
    ['a path with whitespace', { locationOrLink: 'src/my file.js:3', originalTextOrLink: 'src/my file.js:3' }, 'path', 'location'],
    ['a path with parentheses', { locationOrLink: 'src/a(1).js:3', originalTextOrLink: 'src/a(1).js:3' }, 'path', 'location'],
    ['a location with no line', { locationOrLink: 'src/a.js', originalTextOrLink: 'src/a.js' }, 'location', 'location'],
    ['a claim with placeholder braces', { failureMode: 'the template {{name}} is rendered twice' }, 'claim', 'claim'],
    ['a claim over the length cap', { failureMode: 'x'.repeat(4001) }, 'claim', 'claim'],
    ['a claim that reads as a vote', { failureMode: 'three verifiers voted real on this' }, 'leak', 'claim'],
    ['a claim that reads as a conclusion', { failureMode: 'the guard is a real bug that never runs' }, 'leak', 'claim'],
  ])('%s ends in the same named state as a claim that names the orchestrator: kept, unverified, kind %s on input %s, and the others still get their K verifiers', async (_label, over, kind, input) => {
    const h = harness();
    const m = await toVerify(h, [finding(over), clean(2)]);
    expect([...askedOf(m).keys()]).toEqual(['f2']);
    expect(askedOf(m).get('f2')).toHaveLength(3);
    voteAll(m, () => 'real');
    const out = await h.collect();
    expect(out.notReviewed.unbriefable).toEqual([{ id: 'f1', kind, input, reason: expect.any(String) }]);
    expect(out.ledger.find((e) => e.id === 'f1').verification).toMatchObject({ outcome: 'unverified', reason: 'unbriefable', tally: null, assigned: [], unbriefable: { kind, input } });
    expect(out.ledger.find((e) => e.id === 'f2').verification).toMatchObject({ outcome: 'present' });
    expect(out.gate.dispositionChoices.find((c) => c.id === 'f1')).toMatchObject({ votes: null, verification: { reason: 'unbriefable', unbriefable: { kind, input } } });
  });

  test('a vote for a refused candidate counts for nothing: nobody was asked, so it can never make the candidate present or filtered', async () => {
    const h = harness();
    const m = await toVerify(h, [leaky(), clean(2)]);
    for (const agent of m.agents) writeResult(agent, { votes: [...agent.candidateIds, 'f1'].map((id) => ({ candidateId: id, verdict: 'real', evidence: 'x' })) });
    const out = await h.collect();
    expect(out.ledger.find((e) => e.id === 'f1').verification).toMatchObject({ outcome: 'unverified', reason: 'unbriefable', tally: null, assigned: [] });
    expect(out.votes.outcomes.find((o) => o.id === 'f1')).toMatchObject({ outcome: 'unverified', reason: 'unbriefable' });
    expect(out.ledger.find((e) => e.id === 'f2').verification).toMatchObject({ outcome: 'present', tally: { real: 3 } });
  });

  test('a run stored before refused candidates were planned out (every candidate assigned K verifiers) is still read: the plan for the refused one is ignored, not blocked on', async () => {
    const h = harness();
    const m = await toVerify(h, [leaky(), clean(2)]);
    const stored = h.readRun();
    stored.assignment = [{ id: 'f1', verifiers: ['verifier-1', 'verifier-2', 'verifier-3'] }, ...stored.assignment];
    fs.writeFileSync(path.join(h.runDir(), 'run.json'), JSON.stringify(stored));
    voteAll(m, () => 'real');
    const out = await h.collect();
    expect(out.status).toBe('DONE');
    expect(out.votes.outcomes.find((o) => o.id === 'f1')).toMatchObject({ outcome: 'unverified', reason: 'unbriefable' });
  });

  test('a briefable candidate is untouched by all of this: no unbriefable record, a performed verification and no verification field in the operator\'s list', async () => {
    const h = harness();
    const m = await toVerify(h, [clean(2), clean(3)]);
    voteAll(m, () => 'real');
    const out = await h.collect();
    expect(out.notReviewed.unbriefable).toEqual([]);
    expect(out.votes).toMatchObject({ verification: 'performed' });
    expect(out.votes.reason).toBeUndefined();
    expect(out.reducedReview).not.toMatch(/UNVERIFIED|unbriefable/);
    expect(out.gate.dispositionChoices.every((c) => c.verification === undefined)).toBe(true);
  });

  test('every reviewer is told what the verifier brief refuses, in the renderer\'s own words; the security lane, whose findings are never put to verifiers, is not', async () => {
    const h = harness();
    const m = await h.prepare();
    const rules = claimRules();
    expect(rules.refusedWords.length).toBeGreaterThan(10);
    for (const agent of m.agents) {
      const brief = fs.readFileSync(agent.briefPath, 'utf8');
      if (agent.role === 'reviewer') {
        for (const word of rules.refusedWords) expect(brief).toContain(`"${word}"`);
        expect(brief).toContain(rules.pathGrammar);
        expect(brief).toContain(`at most ${rules.maxClaimLength} characters`);
        expect(brief).toMatch(/a finding it refuses is NOT verified: the run lists it as unbriefable and a person must decide it without a verifier's help/);
        expect(brief).not.toMatch(/\{\{/); // an instruction about braces must not itself look like an unrendered placeholder
      } else {
        expect(brief).not.toMatch(/unbriefable|verifier brief/);
      }
    }
  });
});

describe('the gate stage', () => {
  test('REVIEW_COMPLETE is only what deriveStatus says: every runner-side input is good and a gate blocker exists, so it is not complete', async () => {
    const h = harness({ baseline: { ran: true, exitCode: 0, timedOut: false, command: ['jest'], selection: [{ file: 't/a.test.js', why: 'related' }] } });
    const { next } = await reviewRound(h);
    expect(next.status).toBe('DONE');
    // no findings, clean lane, tests passed, fresh head: every fact the runner supplies is "good"
    expect(next.reviewStatus.tests.passed).toBe(true);
    expect(next.reviewStatus.findingCounts).toEqual({ total: 0, actionable: 0, deferred: 0 });
    // ... and approvals are short (a Medium PR needs one human), so the gate blocks
    expect(next.gate.mergeable).toBe(false);
    expect(next.gate.blockers.map((b) => b.code)).toContain('approvals-unsatisfied');
    expect(next.reviewStatus.status).not.toBe('REVIEW_COMPLETE');
    expect(next.reviewStatus.remotePhase).toBe('REMOTE_REVIEW_PENDING');
    expect(next.reviewStatus.localPhase).toBe('LOCAL_REVIEW_COMPLETE');
  });

  test('the runner source never names or sets the complete status', () => {
    for (const file of ['pr-review-run.js', 'pr-review-run-support.js', 'review-run-cli.js']) {
      const text = fs.readFileSync(path.join(__dirname, '..', 'lib', file), 'utf8');
      expect(text).not.toMatch(/REVIEW_COMPLETE/);
      expect(text).not.toMatch(/REMOTE_REVIEW_COMPLETE/);
    }
  });

  test('tests are the real baseline exit code, labelled as relevant files only; a non-zero exit is a failed test', async () => {
    const pass = harness({ baseline: { ran: true, exitCode: 0, timedOut: false, command: ['jest'], selection: [{ file: 't/a.test.js' }] } });
    const ok = (await reviewRound(pass)).next;
    expect(ok.reviewStatus.tests).toMatchObject({ exitCode: 0, passed: true });
    expect(ok.reviewStatus.tests.command).toMatch(/relevant test files only/);
    expect(ok.reducedReview).toMatch(/relevant test files only/);
    const fail = harness({ baseline: { ran: true, exitCode: 1, timedOut: false, command: ['jest'], selection: [{ file: 't/a.test.js' }] } });
    const bad = (await reviewRound(fail)).next;
    expect(bad.reviewStatus.tests.passed).toBe(false);
    expect(bad.reviewStatus.reasons).toContain('failed test');
  });

  test('an absent or timed-out baseline is tests NOT shown: skipped, never a pass and never a failure it did not have', async () => {
    for (const baseline of [{ ran: false, reason: 'no-test-files', exitCode: null, timedOut: false, selection: [] }, { ran: true, exitCode: 0, timedOut: true, command: ['jest'], selection: [{ file: 't' }] }]) {
      const h = harness({ baseline });
      const out = (await reviewRound(h)).next;
      expect(out.reviewStatus.tests.passed).toBe(false);
      expect(out.reviewStatus.tests.skipped).toBe(true);
      expect(out.reviewStatus.reasons).toContain('tests skipped');
      expect(out.reviewStatus.reasons).not.toContain('failed test');
      expect(out.reviewStatus.status).not.toBe('REVIEW_COMPLETE');
      expect(out.reducedReview).toMatch(/tests not shown/);
    }
  });

  test('reads that fail twice are named unavailable (one retry only); a read that succeeds on the retry is not', async () => {
    const h = harness();
    let calls = 0;
    h.deps.readReviews = async () => {
      calls += 1;
      return { ok: false, error: 'HTTP 502' };
    };
    h.deps.readProtection = async () => ({ ok: false, error: 'HTTP 403' });
    const out = (await reviewRound(h)).next;
    expect(calls).toBe(2);
    expect(out.unavailable).toEqual(['reviews', 'branch-protection']);
    expect(out.gate.mergeable).toBe(false);
    expect(out.gate.blockers[0]).toMatchObject({ code: 'review-data-unavailable' });
    expect(out.gate.blockers[0].message).toMatch(/reviews/);
    expect(out.protection.state).toBe('unknown');

    const retry = harness();
    let n = 0;
    retry.deps.readReviews = async () => {
      n += 1;
      return n === 1 ? { ok: false, error: 'blip' } : { ok: true, reviews: [] };
    };
    const ok = (await reviewRound(retry)).next;
    expect(n).toBe(2);
    expect(ok.unavailable).toEqual([]);
  });

  test('approvals are counted for the head from the host: a human approval on the head satisfies a Medium PR; a stale one does not', async () => {
    const h = harness();
    h.reviews = { ok: true, reviews: [{ login: 'bob', authorType: 'User', state: 'APPROVED', commitSha: HEAD, submittedAt: '2026-01-01T00:00:00Z' }] };
    const out = (await reviewRound(h)).next;
    expect(out.approvals).toMatchObject({ satisfied: true, humansCounted: 1 });
    expect(out.gate.mergeable).toBe(true);
    const stale = harness();
    stale.reviews = { ok: true, reviews: [{ login: 'bob', authorType: 'User', state: 'APPROVED', commitSha: 'e'.repeat(40), submittedAt: '2026-01-01T00:00:00Z' }] };
    stale.deps.git = async (args) => (args[0] === 'rev-parse' && /^e+\^\{tree\}$/.test(args[args.length - 1]) ? { status: 0, stdout: `${'1'.repeat(40)}\n`, stderr: '' } : { status: 0, stdout: `${args[0] === 'merge-base' ? BASE : TREE}\n`, stderr: '' });
    const out2 = (await reviewRound(stale)).next;
    expect(out2.approvals.humansCounted).toBe(0);
    expect(out2.gate.mergeable).toBe(false);
  });

  test('the PR body is read fresh: missing sections block; the agent-authored default is the strict one', async () => {
    const h = harness();
    h.pr.body = 'nothing here';
    const out = (await reviewRound(h)).next;
    expect(out.gate.blockers.map((b) => b.code)).toContain('description-section-missing');
    const strict = harness();
    const m = await prepareRun({ repo: 'o/r', pr: 7, repoRoot: strict.repoRoot, runId: 'run1' }, strict.deps); // agentAuthored not stated
    answerReview(m, { lane: { findings: [], pathsReviewed: allPaths(strict) } });
    const res = await strict.collect();
    expect(res.gate.blockers.some((b) => b.section === 'directed-by')).toBe(true);
  });

  test('agentAuthored is the caller\'s statement and the answer says so: true (a credit), false (a waiver); absent is the strictest reading and says nothing (review of PR 264, P2)', async () => {
    const answer = async (extra) => {
      const h = harness();
      h.pr.body = `${GOOD_BODY}\nDirected by: @boss\n`;
      const m = await prepareRun({ repo: 'o/r', pr: 7, repoRoot: h.repoRoot, runId: 'run1', ...extra }, h.deps);
      answerReview(m, { lane: { findings: [], pathsReviewed: allPaths(h) } });
      return h.collect();
    };
    const stated = (out) => out.warnings.filter((w) => w.startsWith('agent-authored-unverified'));
    const yes = await answer({ agentAuthored: true });
    expect(stated(yes)).toEqual([expect.stringMatching(/agentAuthored:true[^]*credits the person it names as one approval[^]*cannot verify who wrote/)]);
    expect(yes.approvals).toMatchObject({ directedBy: 'boss', humansCounted: 1 });
    const no = await answer({ agentAuthored: false });
    expect(stated(no)).toEqual([expect.stringMatching(/agentAuthored:false[^]*no "Directed by:" line was required[^]*cannot verify who wrote/)]);
    expect(no.approvals).toMatchObject({ directedBy: null, humansCounted: 0 });
    expect(stated(await answer({}))).toEqual([]);
  });

  test('the state report is written once, redacted, under the PR id, with the status facts, the ledger and the reduced-review notice', async () => {
    const h = harness();
    const { next } = await reviewRound(h);
    expect(h.stateWrites).toHaveLength(1);
    const { target, state } = h.stateWrites[0];
    expect(target).toBe(statePath(7, h.repoRoot));
    expect(state).toMatchObject({ prId: 7, runId: 'run1', mode: 'light', reviewedHeadSha: HEAD, headSha: HEAD, reviewedTreeSha: TREE, headTreeSha: TREE, security: { status: 'clean' } });
    expect(state.tier.tier).toBe('medium');
    expect(next.statePath).toBe(target);
    expect(fs.existsSync(path.join(h.runDir(), 'final.json'))).toBe(true);
    expect(h.readRun().phase).toBe('done');
  });

  test('a state report that could not be written is RUN_FAILED, the phase is unchanged and a retry can finish', async () => {
    const h = harness();
    const m = await h.prepare();
    answerReview(m, { lane: { findings: [], pathsReviewed: allPaths(h) } });
    h.deps.writeState = async () => ({ ok: false, reason: 'disk full' });
    expect(await h.collect()).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: 'state-write-failed' });
    expect(h.readRun().phase).not.toBe('done');
    h.deps.writeState = async (t) => ({ ok: true, path: t });
    expect((await h.collect()).status).toBe('DONE');
  });
});

describe('adjudication re-entry', () => {
  async function uncertainRun(severity = 'important') {
    const h = harness();
    const m = await h.prepare();
    answerReview(m, { findingsFor: (n) => (n === 'reviewer-s1-a' ? [finding({ uncertain: true, severity })] : []), lane: { findings: [], pathsReviewed: allPaths(h) } });
    const verify = await h.collect();
    voteAll(verify, () => 'real');
    const out = await h.collect();
    return { h, out };
  }

  test('an uncertain finding is ADJUDICATE: listed, and the gate already treats it as open', async () => {
    const { out } = await uncertainRun();
    expect(out).toMatchObject({ ok: true, status: 'ADJUDICATE' });
    expect(out.adjudicate).toEqual([{ id: 'f1', why: expect.stringContaining('uncertain') }]);
    expect(out.gate.findings.open).toEqual(['f1']);
  });

  test('collect on a finished run is idempotent: the head is re-read (one host read and nothing else) and the stored result returned while it is unchanged', async () => {
    const { h, out } = await uncertainRun();
    const reads = h.ghReads.length;
    const again = await h.collect();
    expect(again).toEqual(JSON.parse(JSON.stringify(out)));
    expect(h.ghReads.slice(reads)).toEqual(['readPr']);
    expect(h.stateWrites).toHaveLength(1);
  });

  test('a finished run whose head moved is RUN_INVALIDATED and its stored mergeable answer is NOT returned; it is the answer again only for the head it reviewed (review of PR 264, P1)', async () => {
    const h = harness();
    h.reviews = { ok: true, reviews: [{ login: 'bob', authorType: 'User', state: 'APPROVED', commitSha: HEAD, submittedAt: '2026-01-01T00:00:00Z' }] };
    const { next } = await reviewRound(h);
    expect(next).toMatchObject({ status: 'DONE', gate: { mergeable: true } });
    h.head = MOVED;
    const out = await h.collect();
    expect(out).toMatchObject({ ok: false, status: 'RUN_INVALIDATED', reason: 'head-moved', expectedHead: HEAD, currentHead: MOVED });
    expect(JSON.stringify(out)).not.toContain('mergeable');
    expect(h.stateWrites).toHaveLength(1);
    h.head = HEAD;
    expect(await h.collect()).toMatchObject({ status: 'DONE', gate: { mergeable: true } });
  });

  test('a finished run whose head cannot be read, or whose PR is no longer open, gets no stored answer either', async () => {
    const h = harness();
    h.reviews = { ok: true, reviews: [{ login: 'bob', authorType: 'User', state: 'APPROVED', commitSha: HEAD, submittedAt: '2026-01-01T00:00:00Z' }] };
    await reviewRound(h);
    const good = h.deps.readPr;
    h.deps.readPr = async () => ({ ok: false, error: 'gh: rate limited' });
    const unreadable = await h.collect();
    expect(unreadable).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: 'head-unreadable' });
    expect(JSON.stringify(unreadable)).not.toContain('mergeable');
    h.deps.readPr = good;
    h.pr.state = 'MERGED';
    const merged = await h.collect();
    expect(merged).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: 'pr-not-open', prState: 'MERGED' });
    expect(JSON.stringify(merged)).not.toContain('mergeable');
    h.pr.state = 'OPEN';
    expect(await h.collect()).toMatchObject({ status: 'DONE', gate: { mergeable: true } });
  });

  test('an adjudication is applied only to findings that were listed', async () => {
    const { h } = await uncertainRun();
    expect(await h.collect({ adjudications: [{ id: 'nope', disposition: 'fix', reason: 'because' }] })).toMatchObject({ ok: false, reason: 'adjudication-refused', error: expect.stringContaining('not listed') });
    expect(await h.collect({ adjudications: [{ id: 'f1', disposition: 'closed', reason: 'because' }] })).toMatchObject({ reason: 'adjudication-refused' });
    expect(await h.collect({ adjudications: [{ id: 'f1', disposition: 'fix', reason: '' }] })).toMatchObject({ reason: 'adjudication-refused' });
    expect(await h.collect({ adjudications: [{ id: 'f1', disposition: 'fix', reason: 'a' }, { id: 'f1', disposition: 'fix', reason: 'b' }] })).toMatchObject({ reason: 'adjudication-refused' });
    expect(h.stateWrites).toHaveLength(1);
  });

  test('a security-lane finding cannot be adjudicated (it is not a listed ledger finding)', async () => {
    const h = harness();
    const m = await h.prepare();
    answerReview(m, { lane: { findings: [finding({ uncertain: true })], pathsReviewed: allPaths(h) } });
    const out = await h.collect();
    expect(out.status).toBe('DONE');
    expect(out.adjudicate).toBeUndefined();
    expect(await h.collect({ adjudications: [{ id: 's1', disposition: 'not-applicable', reason: 'nah' }] })).toMatchObject({ reason: 'adjudication-refused' });
  });

  test('deferring an Important finding does NOT stop it blocking: the gate ignores a review-side deferral; adjudicatedBy is recorded', async () => {
    const { h } = await uncertainRun('important');
    const out = await h.collect({ adjudications: [{ id: 'f1', disposition: 'deferred', reason: 'tracked in a follow-up' }] });
    expect(out.status).toBe('DONE'); // nothing left to adjudicate...
    expect(out.adjudicatedBy).toBe('orchestrator');
    expect(out.ledger[0]).toMatchObject({ disposition: 'deferred', adjudicatedBy: 'orchestrator', uncertain: false });
    // ... but the finding is still open at the gate
    expect(out.gate.mergeable).toBe(false);
    expect(out.gate.findings.open).toEqual(['f1']);
    expect(out.gate.blockers.map((b) => b.code)).toContain('open-important-finding');
    expect(out.reviewStatus.findingCounts.actionable).toBe(1);
    // the recomputed state report carries the decision
    expect(h.stateWrites).toHaveLength(2);
    expect(h.stateWrites[1].state).toMatchObject({ adjudicatedBy: 'orchestrator' });
  });

  test('adjudicating a Nit as deferred with a reason closes it (what isActionable allows), and the list empties', async () => {
    const { h, out } = await uncertainRun('nit');
    expect(out.status).toBe('ADJUDICATE');
    const done = await h.collect({ adjudications: [{ id: 'f1', disposition: 'deferred', reason: 'cosmetic' }] });
    expect(done.status).toBe('DONE');
    expect(done.adjudicate).toBeUndefined();
    expect(done.reviewStatus.findingCounts).toMatchObject({ actionable: 0, deferred: 1 });
    // and the stored answer is now the adjudicated one
    expect((await h.collect()).adjudicatedBy).toBe('orchestrator');
  });

  test('an adjudication of a moved head decides nothing: RUN_INVALIDATED and the stored answer stays', async () => {
    const { h, out } = await uncertainRun();
    h.head = MOVED;
    const answer = await h.collect({ adjudications: [{ id: 'f1', disposition: 'fix', reason: 'will fix' }] });
    expect(answer).toMatchObject({ ok: false, status: 'RUN_INVALIDATED' });
    h.head = HEAD;
    expect((await h.collect()).status).toBe(out.status);
  });
});

describe('AC3: nothing is edited, checked out or pushed', () => {
  const FORBIDDEN = /^(push|checkout|switch|reset|stash|commit|add|rebase|apply|merge|cherry-pick|revert|clean|rm|mv|restore|fetch|pull|tag|branch|update-ref|worktree)$/;

  test('every git call of a whole run is merge-base or rev-parse; every host call is a read', async () => {
    const h = harness();
    const m = await h.prepare();
    answerReview(m, { findingsFor: (n) => (n === 'reviewer-s1-a' ? [finding()] : []), lane: { findings: [], pathsReviewed: allPaths(h) } });
    const verify = await h.collect();
    voteAll(verify, () => 'real');
    await h.collect();
    expect(h.gitCalls.length).toBeGreaterThan(0);
    for (const args of h.gitCalls) {
      expect(['merge-base', 'rev-parse']).toContain(args[0]);
      expect(args[0]).not.toMatch(FORBIDDEN);
    }
    // the only host reads the logic itself makes
    expect(new Set(h.ghReads)).toEqual(new Set(['readPr', 'readReviews', 'readProtection']));
  });
});

describe('metrics and the acvv recorder', () => {
  test('metrics come from the call log and agent times: calls, rounds, agents, wait, orchestrator-only', async () => {
    const h = harness();
    let t = 1_000_000;
    h.deps.now = () => {
      t += 1000;
      return t;
    };
    const m = await h.prepare();
    // the agents arrive 5 s of (fake) wall time later; files carry real ctimes, so collect "now" is real
    answerReview(m, { lane: { findings: [], pathsReviewed: allPaths(h) } });
    const out = await h.collect({ now: Date.now() });
    expect(out.status).toBe('DONE');
    const x = out.metrics;
    expect(x).toMatchObject({ runnerCalls: 2, dispatchRounds: 1, agentsDispatched: 3, adjudicationCalls: 0, agentsByRole: { reviewer: 2, security: 1 }, orchestratorTurns: { atLeast: 3 } });
    expect(x.wallMs).toBeGreaterThan(0);
    expect(x.runnerMs).toBeGreaterThan(0);
    expect(x.runnerMs).toBeLessThanOrEqual(x.wallMs);
    expect(x.orchestratorOnlyMs).toBe(Math.max(0, x.wallMs - x.runnerMs - x.agentActiveMs));
    expect(Object.keys(x).sort()).toEqual(['adjudicationCalls', 'agentActiveMs', 'agentsByRole', 'agentsDispatched', 'dispatchRounds', 'orchestratorOnlyMs', 'orchestratorTurns', 'runnerCalls', 'runnerMs', 'wallMs']);
  });

  test('AC1: the orchestrator turns the protocol itself requires are counted and recorded (a lower bound), with the agents by role and the adjudication calls', async () => {
    // prepare -> review agents -> collect -> verify wave -> collect -> ADJUDICATE -> collect with adjudications -> DONE
    const h = harness();
    const m = await h.prepare();
    answerReview(m, { findingsFor: (name) => (name === 'reviewer-s1-a' ? [finding({ uncertain: true })] : []), lane: { findings: [], pathsReviewed: allPaths(h) } });
    const verify = await h.collect();
    voteAll(verify, () => 'real');
    const adjudicate = await h.collect();
    expect(adjudicate.status).toBe('ADJUDICATE');
    expect(adjudicate.metrics).toMatchObject({ runnerCalls: 3, dispatchRounds: 2, agentsDispatched: 6, adjudicationCalls: 0, agentsByRole: { reviewer: 2, security: 1, verifier: 3 }, orchestratorTurns: { atLeast: 5 } });
    const done = await h.collect({ adjudications: [{ id: 'f1', disposition: 'fix', reason: 'will fix' }] });
    expect(done.metrics).toMatchObject({ runnerCalls: 4, dispatchRounds: 2, adjudicationCalls: 1, orchestratorTurns: { atLeast: 6 } });
    expect(done.metrics.orchestratorTurns.basis).toMatch(/lower bound, not a measurement of the model/);
    // recorded with the run, and re-reading a finished run is not another turn of the protocol
    expect(h.readRun().metrics).toEqual(JSON.parse(JSON.stringify(done.metrics)));
    expect((await h.collect()).metrics).toEqual(done.metrics);
    expect(h.readRun().calls.map((c) => c.call)).toEqual(['prepare', 'collect', 'collect', 'collect']);
  });

  test('computeMetrics and unionMs on a hand-made run', () => {
    expect(S.unionMs([[0, 10], [5, 20], [30, 40]])).toBe(30);
    expect(S.unionMs([])).toBe(0);
    const run = { calls: [{ call: 'prepare', startedAt: 0, endedAt: 100 }, { call: 'collect', startedAt: 9000, endedAt: 9100, adjudication: true }], waves: [{ status: 'collected', agents: [{ role: 'reviewer', dispatchedAt: 100, arrivedAt: 5000, deadlineAt: 99999 }, { role: 'verifier', dispatchedAt: 100, arrivedAt: 8000, deadlineAt: 99999 }] }, { status: 'planned', agents: [{}] }] };
    expect(S.computeMetrics(run, 9100)).toEqual({ wallMs: 9100, runnerCalls: 2, dispatchRounds: 1, agentsDispatched: 2, agentsByRole: { reviewer: 1, verifier: 1 }, adjudicationCalls: 1, orchestratorTurns: { atLeast: 3, basis: expect.stringContaining('lower bound') }, runnerMs: 200, agentActiveMs: 7900, orchestratorOnlyMs: 1000 });
  });

  test('stage spans use the names and kinds lib/pr-review-timing.js reads: the review root, head-read, one span per agent from dispatch to collection, the gate and the verdict', async () => {
    const h = harness();
    await reviewRound(h);
    const started = h.spans.filter((s) => s.type === 'start');
    expect(started.map((s) => s.name)).toEqual(['review', 'review.head-read', 'review.reviewer', 'review.reviewer', 'review.security-lane', 'review.gate', 'review.verdict']);
    expect(Object.fromEntries(started.map((s) => [s.name, s.kind]))).toEqual({ review: 'phase', 'review.head-read': 'io', 'review.reviewer': 'agent', 'review.security-lane': 'agent', 'review.gate': 'gate', 'review.verdict': 'phase' });
    expect(started.filter((s) => s.kind === 'agent').map((s) => s.attrs.agent)).toEqual(['reviewer-s1-a', 'reviewer-s1-b', 'security-lane']);
    // every span names its round: the verdict is only a step of a round's critical path when it carries one
    for (const span of started) expect(span.attrs.round).toBe(1);
    const ended = h.spans.filter((s) => s.type === 'end');
    expect(ended).toHaveLength(started.length);
    // the root is one span and it closes last
    expect(started.filter((s) => s.name === 'review')).toHaveLength(1);
    expect(ended[ended.length - 1].id).toBe(started.find((s) => s.name === 'review').id);
    expect(h.readRun().waves[0].agents.every((a) => a.spanId !== null && a.spanId !== undefined)).toBe(true);
  });

  test('an agent span ends at its last message: last_message_ts is when its result file arrived, and an agent that never arrived has none', async () => {
    const h = harness();
    const m = await h.prepare();
    answerReview(m, { skip: ['reviewer-s1-b'], lane: { findings: [], pathsReviewed: allPaths(h) } });
    // the collector dates an arrival by the result file's change time (ctime), which a writer cannot backdate
    const arrived = ['reviewer-s1-a', 'security-lane'].map((name) => fs.statSync(m.agents.find((a) => a.name === name).outPath).ctimeMs);
    const after = m.agents[1].deadlineAt + 1000;
    await h.collect({ now: after });
    const ends = new Map(h.spans.filter((s) => s.type === 'end').map((s) => [s.id, s]));
    const byAgent = Object.fromEntries(h.spans.filter((s) => s.type === 'start' && s.kind === 'agent').map((s) => [s.attrs.agent, ends.get(s.id)]));
    expect(byAgent['reviewer-s1-a'].attrs.last_message_ts).toBe(new Date(Math.round(arrived[0])).toISOString());
    expect(byAgent['security-lane'].attrs.last_message_ts).toBe(new Date(Math.round(arrived[1])).toISOString());
    expect(byAgent['reviewer-s1-b']).toMatchObject({ status: expect.not.stringMatching(/^ok$/) });
    expect(byAgent['reviewer-s1-b'].attrs.last_message_ts).toBeUndefined();
  });

  test('the root stays open while the run is PENDING and is closed by the call that ends it', async () => {
    const h = harness();
    const m = await h.prepare();
    const root = h.spans.find((s) => s.type === 'start' && s.name === 'review');
    expect(h.spans.some((s) => s.type === 'end' && s.id === root.id)).toBe(false);
    expect(h.readRun().rootSpanId).toBe(root.id);
    answerReview(m, { skip: ['reviewer-s1-b'], lane: { findings: [], pathsReviewed: allPaths(h) } });
    expect((await h.collect()).status).toBe('PENDING');
    expect(h.spans.some((s) => s.type === 'end' && s.id === root.id)).toBe(false);
    answerReview(m, { lane: { findings: [], pathsReviewed: allPaths(h) } });
    expect((await h.collect()).status).toBe('DONE');
    expect(h.spans.filter((s) => s.type === 'end' && s.id === root.id)).toEqual([{ type: 'end', id: root.id, status: 'ok', attrs: { phase: 'done' } }]);
    // a finished run re-read, or adjudicated, closes nothing twice
    await h.collect();
    expect(h.spans.filter((s) => s.type === 'end' && s.id === root.id)).toHaveLength(1);
  });

  test('a run that ends without a verdict still closes its root: invalidated, a brief the renderer refuses (light or full mode), or failed in prepare', async () => {
    const moved = harness();
    const m = await moved.prepare();
    answerReview(m, { lane: { findings: [], pathsReviewed: allPaths(moved) } });
    moved.head = MOVED;
    expect((await moved.collect()).status).toBe('RUN_INVALIDATED');
    const root = moved.spans.find((s) => s.type === 'start' && s.name === 'review');
    expect(moved.spans.filter((s) => s.type === 'end' && s.id === root.id)).toEqual([{ type: 'end', id: root.id, status: 'error', attrs: { phase: 'invalidated' } }]);
    expect((await moved.collect()).status).toBe('RUN_INVALIDATED');
    expect(moved.spans.filter((s) => s.type === 'end' && s.id === root.id)).toHaveLength(1);

    // A High path no longer ends the run at prepare (full mode runs in the runner: kata dqcs); what still ends it there is a
    // brief the renderer refuses: NEEDS_FULL_MODE for a light run, RUN_FAILED brief-refused for a full one.
    const light = harness({ changedPaths: ['src/a b.js'] });
    expect((await light.prepare()).status).toBe('NEEDS_FULL_MODE');
    const lightRoot = light.spans.find((s) => s.type === 'start' && s.name === 'review');
    expect(light.spans.filter((s) => s.type === 'end' && s.id === lightRoot.id)).toHaveLength(1);

    const full = harness({ changedPaths: ['core/a b.js'], policyJson: { highPaths: ['core/**'] } });
    expect(await full.prepare()).toMatchObject({ ok: false, status: 'RUN_FAILED', mode: { mode: 'full' } });
    const fullRoot = full.spans.find((s) => s.type === 'start' && s.name === 'review');
    expect(full.spans.filter((s) => s.type === 'end' && s.id === fullRoot.id)).toEqual([{ type: 'end', id: fullRoot.id, status: 'error', attrs: { status: 'RUN_FAILED' } }]);

    const broken = harness();
    broken.deps.fetchRefs = async () => ({ ok: false, error: 'network' });
    expect((await broken.prepare()).status).toBe('RUN_FAILED');
    const brokenRoot = broken.spans.find((s) => s.type === 'start' && s.name === 'review');
    expect(broken.spans.filter((s) => s.type === 'end' && s.id === brokenRoot.id)).toHaveLength(1);
    expect(broken.spans.find((s) => s.name === 'review.head-read' && s.type === 'start')).toBeDefined();
  });

  test('a delta re-review (lastReviewedSha) is round 2 on every contract span', async () => {
    const h = harness();
    await reviewRound(h, { prepare: { lastReviewedSha: 'e'.repeat(40) } });
    const contract = h.spans.filter((s) => s.type === 'start' && s.name.startsWith('review'));
    expect(contract.length).toBeGreaterThan(0);
    for (const span of contract) expect(span.attrs.round).toBe(2);
  });

  test('an agent span names its wave: the review agents and the verifiers are numbered apart, each from 1, and carry no second round-like attr (review of PR 270, round 1)', async () => {
    // a cap of 2: the review is two waves (both reviewers, then the lane) and the three verifiers are two more
    const h = harness({ policyJson: { maxConcurrentAgents: 2 } });
    const m1 = await h.prepare();
    answerReview(m1, { findingsFor: (name) => (name === 'reviewer-s1-a' ? [finding()] : []) });
    const m2 = await h.collect();
    answerReview(m2, { lane: { findings: [], pathsReviewed: allPaths(h) } });
    const v1 = await h.collect();
    voteAll(v1, () => 'real');
    const v2 = await h.collect();
    expect([m1.wave, m2.wave, v1.wave, v2.wave]).toEqual(['1 of 2', '2 of 2', '1 of 2', '2 of 2']);
    voteAll(v2, () => 'real');
    expect((await h.collect()).status).toBe('DONE');
    const agents = h.spans.filter((s) => s.type === 'start' && s.kind === 'agent');
    expect(agents.map((s) => [s.name, s.attrs.wave])).toEqual([
      ['review.reviewer', 1],
      ['review.reviewer', 1],
      ['review.security-lane', 2],
      ['review.verifier', 1],
      ['review.verifier', 1],
      ['review.verifier', 2],
    ]);
    for (const span of agents) {
      expect(span.attrs.round).toBe(1);
      expect(span.attrs).not.toHaveProperty('stage'); // whether it is a review or a verify wave is the span's name; a second round-like attr misleads
    }
  });

  test('read back through the real recorder and reader, a run whose agents ran in several waves has a critical path step per wave, and the lane alone in its wave is named as uncounted (review of PR 270, round 1)', async () => {
    // a cap of 1: the review is three waves (reviewer-s1-a, reviewer-s1-b, the security lane) and the verification three more
    const h = harness({ policyJson: { maxConcurrentAgents: 1 } });
    h.deps.makeTracer = (runId) => createTracer({ runId, projectRoot: h.repoRoot });
    const answerWave = async (manifest, answer) => {
      await pause(); // the agents work
      answer(manifest);
      await pause(); // their results wait for the dispatcher's collect
      return h.collect();
    };
    let m = await h.prepare();
    expect(m).toMatchObject({ round: 'review', wave: '1 of 3' });
    m = await answerWave(m, (x) => answerReview(x, { findingsFor: (name) => (name === 'reviewer-s1-a' ? [finding()] : []) }));
    m = await answerWave(m, (x) => answerReview(x, {}));
    m = await answerWave(m, (x) => answerReview(x, { lane: { findings: [], pathsReviewed: allPaths(h) } }));
    expect(m).toMatchObject({ status: 'DISPATCH', round: 'verify', wave: '1 of 3' });
    m = await answerWave(m, (x) => voteAll(x, () => 'real'));
    m = await answerWave(m, (x) => voteAll(x, () => 'real'));
    expect((await answerWave(m, (x) => voteAll(x, () => 'real'))).status).toBe('DONE');

    const timing = loadReviewTiming({ runId: 'run1', projectRoot: h.repoRoot });
    expect(timing).toMatchObject({ ok: true, warnings: [] });
    expect(timing.agents).toMatchObject({ count: 6, unusable: [] });
    const [round] = timing.criticalPath.rounds;
    expect(round.steps.map((s) => [s.stage, s.wave])).toEqual([
      ['reviewer', 1],
      ['reviewer', 2],
      ['verifier', 1],
      ['verifier', 2],
      ['verifier', 3],
      ['verdict', undefined],
    ]);
    // each wave ran at least as long as its agents worked, and a wave of the review that holds only the lane is no step
    expect(round.steps.every((s) => !s.missing && (s.stage === 'verdict' || s.ms >= 10))).toBe(true);
    expect(round.uncountedWaves).toEqual([3]);
    expect(timing.criticalPath).toMatchObject({ missing: false, lowerBound: true });
    // the chain is the SUM of its steps, so it is longer than any one of them (one slowest reviewer across the waves was the longest alone)
    expect(timing.criticalPath.ms).toBe(round.steps.reduce((n, s) => n + s.ms, 0));
    expect(timing.criticalPath.ms).toBeGreaterThan(Math.max(...round.steps.map((s) => s.ms)));
    expect(timing.orchestratorOnly.missing).toBe(false);
    expect(timing.criticalPath.ms + timing.orchestratorOnly.ms).toBeLessThanOrEqual(timing.wall.ms);
  });

  describe('a collect retried after a failure ends the failed verdict span in error: ONE verdict in the window (review of PR 270, rounds 1 and 2)', () => {
    /** The harness's state writer, failing its first write. */
    function failOnce(h) {
      const write = h.deps.writeState;
      let attempts = 0;
      h.deps.writeState = async (target, state) => {
        attempts += 1;
        return attempts === 1 ? { ok: false, reason: 'disk full' } : write(target, state);
      };
    }
    /** The harness's file writer, throwing once when it is asked to write a file whose path ends with `suffix`. */
    function throwOnce(h, suffix) {
      const { writeAtomic } = h.deps.fs;
      let thrown = false;
      h.deps.fs = {
        ...h.deps.fs,
        writeAtomic: (file, text, mode) => {
          if (!thrown && file.endsWith(suffix)) {
            thrown = true;
            throw new Error('disk full');
          }
          return writeAtomic(file, text, mode);
        },
      };
    }
    const verdictsOf = (h) => {
      const ends = new Map(h.spans.filter((s) => s.type === 'end').map((s) => [s.id, s]));
      return h.spans.filter((s) => s.type === 'start' && s.name === 'review.verdict').map((s) => ends.get(s.id));
    };

    test('a failed state write ends that attempt\'s verdict in error and the retry records the verdict: the window keeps one, and the root stays open until the retry', async () => {
      const h = harness();
      failOnce(h);
      const m = await h.prepare();
      answerReview(m, { lane: { findings: [], pathsReviewed: allPaths(h) } });
      expect(await h.collect()).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: 'state-write-failed' });
      const root = h.spans.find((s) => s.type === 'start' && s.name === 'review');
      expect(h.spans.some((s) => s.type === 'end' && s.id === root.id)).toBe(false); // not over: the retry is part of the same window
      expect((await h.collect()).status).toBe('DONE');
      const [failed, recorded] = verdictsOf(h);
      expect(verdictsOf(h)).toHaveLength(2);
      expect(failed).toMatchObject({ status: 'error', attrs: { reason: 'state-write-failed' } });
      expect(recorded.status).toBe('ok'); // the retry's own derivation, not the first attempt's
      const started = h.spans.filter((s) => s.type === 'start');
      expect(started.filter((s) => s.name === 'review.gate')).toHaveLength(2); // the gate did run twice, and its span says so
      expect(h.spans.filter((s) => s.type === 'end')).toHaveLength(started.length); // every span closed once
      expect(h.spans.filter((s) => s.type === 'end' && s.id === root.id)).toHaveLength(1);
      // no bookkeeping in the run file for the guard: it rests on the trace, which no failed write of the run file can reopen
      expect(h.readRun().verdictRecorded).toBeUndefined();
    });

    test('a throw after the state report was written (final.json cannot be written) ends the verdict in error too: nothing in the run file decides it', async () => {
      const h = harness();
      throwOnce(h, 'final.json');
      const m = await h.prepare();
      answerReview(m, { lane: { findings: [], pathsReviewed: allPaths(h) } });
      await expect(h.collect()).rejects.toThrow('disk full');
      expect((await h.collect()).status).toBe('DONE');
      const [failed, recorded] = verdictsOf(h);
      expect(verdictsOf(h)).toHaveLength(2);
      expect(failed).toMatchObject({ status: 'error', attrs: { error: 'disk full' } });
      expect(recorded.status).toBe('ok');
      const root = h.spans.find((s) => s.type === 'start' && s.name === 'review');
      expect(h.spans.filter((s) => s.type === 'end' && s.id === root.id)).toHaveLength(1);
    });

    test.each([
      ['a failed state write', failOnce],
      ['a throw after the state report was written', (h) => throwOnce(h, 'final.json')],
    ])('read back through the real recorder and reader, the critical path after %s is computed, not MISSING for two verdicts', async (_, failure) => {
      const h = harness();
      h.deps.makeTracer = (runId) => createTracer({ runId, projectRoot: h.repoRoot });
      failure(h);
      const m = await h.prepare();
      await pause();
      answerReview(m, { findingsFor: (name) => (name === 'reviewer-s1-a' ? [finding()] : []), lane: { findings: [], pathsReviewed: allPaths(h) } });
      await pause();
      const verify = await h.collect();
      await pause();
      voteAll(verify, () => 'real');
      await pause();
      const failed = await h.collect().catch((error) => ({ status: 'THREW', reason: error.message }));
      expect(['RUN_FAILED', 'THREW']).toContain(failed.status);
      expect((await h.collect()).status).toBe('DONE');
      const timing = loadReviewTiming({ runId: 'run1', projectRoot: h.repoRoot });
      expect(timing).toMatchObject({ ok: true, warnings: [] });
      expect(timing.criticalPath).toMatchObject({ missing: false });
      expect(timing.stages['review.verdict'].count).toBe(2); // the failed attempt's (error) and the recorded one
      expect(timing.stages['review.gate'].count).toBe(2);
    });

    test('an adjudication after the root has closed is another matter: it re-runs the gate and the verdict outside the window and records both there', async () => {
      const h = harness();
      const m = await h.prepare();
      answerReview(m, { findingsFor: (name) => (name === 'reviewer-s1-a' ? [finding({ uncertain: true })] : []), lane: { findings: [], pathsReviewed: allPaths(h) } });
      const verify = await h.collect();
      voteAll(verify, () => 'real');
      expect((await h.collect()).status).toBe('ADJUDICATE');
      expect((await h.collect({ adjudications: [{ id: 'f1', disposition: 'fix', reason: 'will fix' }] })).status).toBe('DONE');
      const root = h.spans.find((s) => s.type === 'start' && s.name === 'review');
      const rootEnd = h.spans.findIndex((s) => s.type === 'end' && s.id === root.id);
      const verdicts = h.spans.filter((s) => s.type === 'start' && s.name === 'review.verdict');
      expect(verdicts).toHaveLength(2);
      expect(h.spans.indexOf(verdicts[0])).toBeLessThan(rootEnd);
      expect(h.spans.indexOf(verdicts[1])).toBeGreaterThan(rootEnd);
      expect(verdictsOf(h).map((v) => v.status)).toEqual(['ok', 'ok']);
    });
  });

  describe('the end of the root is trace bookkeeping: it never turns a finished review into a failure (review of PR 270, round 2)', () => {
    /** Makes every write of `run.json` after the first one that records `phase` throw: the disk fills up once the run is over. */
    function failRunFileAfter(h, phase) {
      const { writeAtomic } = h.deps.fs;
      let over = false;
      h.deps.fs = {
        ...h.deps.fs,
        writeAtomic: (file, text, mode) => {
          if (file.endsWith('run.json')) {
            if (over) throw new Error('disk full');
            if (JSON.parse(text).phase === phase) over = true;
          }
          return writeAtomic(file, text, mode);
        },
      };
    }

    test('a finished run records the end of the root in the same write as its verdict: a later write that fails changes nothing, and the root is closed once', async () => {
      const h = harness();
      failRunFileAfter(h, 'done');
      const m = await h.prepare();
      answerReview(m, { lane: { findings: [], pathsReviewed: allPaths(h) } });
      expect((await h.collect()).status).toBe('DONE');
      expect(h.readRun()).toMatchObject({ phase: 'done', rootEnded: true }); // one write holds both
      const root = h.spans.find((s) => s.type === 'start' && s.name === 'review');
      expect(h.spans.filter((s) => s.type === 'end' && s.id === root.id)).toEqual([{ type: 'end', id: root.id, status: 'ok', attrs: { phase: 'done' } }]);
      // and it closes after the verdict that ends the run, which is what keeps that verdict inside the window
      const verdict = h.spans.find((s) => s.type === 'start' && s.name === 'review.verdict');
      const verdictEnd = h.spans.findIndex((s) => s.type === 'end' && s.id === verdict.id);
      expect(h.spans.findIndex((s) => s.type === 'end' && s.id === root.id)).toBeGreaterThan(verdictEnd);
    });

    test('a run that ended without a verdict keeps its answer when the write that records the end of its root fails', async () => {
      const h = harness();
      failRunFileAfter(h, 'invalidated');
      const m = await h.prepare();
      answerReview(m, { lane: { findings: [], pathsReviewed: allPaths(h) } });
      h.head = MOVED;
      expect((await h.collect()).status).toBe('RUN_INVALIDATED');
      const root = h.spans.find((s) => s.type === 'start' && s.name === 'review');
      expect(h.spans.filter((s) => s.type === 'end' && s.id === root.id)).toEqual([{ type: 'end', id: root.id, status: 'error', attrs: { phase: 'invalidated' } }]);
    });
  });

  describe('an agent ends at its last message, and a last message the runner cannot place is said so (review of PR 270, round 1)', () => {
    /** A run whose collect reads its clock `skewMs` BEFORE the result files were written (skew between the file system and the process). */
    async function skewedCollect(skewMs) {
      const h = harness();
      h.deps.notices = [];
      let skew = 0;
      h.deps.now = () => Date.now() - skew;
      const m = await h.prepare();
      answerReview(m, { lane: { findings: [], pathsReviewed: allPaths(h) } });
      const arrived = Object.fromEntries(m.agents.map((a) => [a.name, Math.round(fs.statSync(a.outPath).ctimeMs)]));
      skew = skewMs;
      expect((await h.collect()).status).toBe('DONE');
      const ends = new Map(h.spans.filter((s) => s.type === 'end').map((s) => [s.id, s]));
      const lastMessages = Object.fromEntries(h.spans.filter((s) => s.type === 'start' && s.kind === 'agent').map((s) => [s.attrs.agent, ends.get(s.id).attrs.last_message_ts]));
      return { h, arrived, lastMessages };
    }

    test('a result file dated well after the collect call that read it cannot be placed: it is warned about and stamped as it is, so the reader refuses that agent', async () => {
      const { h, arrived, lastMessages } = await skewedCollect(60000);
      expect(h.deps.notices).toHaveLength(1);
      expect(h.deps.notices[0]).toContain('reviewer-s1-a, reviewer-s1-b, security-lane');
      expect(h.deps.notices[0]).toContain('cannot be placed');
      // stamped as it is (outside the span, which the reader reports as unusable), never dropped to fall back to the collect call
      for (const [name, at] of Object.entries(arrived)) expect(lastMessages[name]).toBe(new Date(at).toISOString());
    });

    test('a change time a moment past the collect call is the clock resolution: no warning, and the span ends at the call', async () => {
      const { h, arrived, lastMessages } = await skewedCollect(200);
      expect(h.deps.notices).toEqual([]);
      for (const [name, at] of Object.entries(arrived)) {
        expect(Date.parse(lastMessages[name])).toBeLessThan(at);
        expect(at - Date.parse(lastMessages[name])).toBeLessThanOrEqual(1000);
      }
    });

    /** A run whose collector reports `reviewer-s1-a` as having arrived `offsetMs` after its dispatch (negative: before it). */
    async function arrivedAt(offsetMs) {
      const h = harness();
      h.deps.notices = [];
      h.deps.collectResults = (input) => {
        const answer = collectResults(input);
        return { ...answer, agents: answer.agents.map((a) => (a.name === 'reviewer-s1-a' ? { ...a, arrivedAt: a.dispatchedAt + offsetMs } : a)) };
      };
      const m = await h.prepare();
      answerReview(m, { lane: { findings: [], pathsReviewed: allPaths(h) } });
      expect((await h.collect()).status).toBe('DONE');
      const ends = new Map(h.spans.filter((s) => s.type === 'end').map((s) => [s.id, s]));
      const byAgent = Object.fromEntries(h.spans.filter((s) => s.type === 'start' && s.kind === 'agent').map((s) => [s.attrs.agent, ends.get(s.id).attrs]));
      return { h, byAgent, dispatchedAt: m.agents.find((a) => a.name === 'reviewer-s1-a').dispatchedAt };
    }

    test('a result dated before the agent was dispatched is no message of this dispatch (a stale file): no last_message_ts, a notice that names it, and the other agents are untouched (review of PR 270, round 2)', async () => {
      const { h, byAgent } = await arrivedAt(-500);
      expect(byAgent['reviewer-s1-a'].last_message_ts).toBeUndefined(); // stamped before its span started, the reader would blame the recorder
      expect(byAgent['reviewer-s1-b'].last_message_ts).toEqual(expect.any(String));
      expect(byAgent['security-lane'].last_message_ts).toEqual(expect.any(String));
      expect(h.deps.notices).toHaveLength(1);
      expect(h.deps.notices[0]).toContain('reviewer-s1-a');
      expect(h.deps.notices[0]).not.toContain('reviewer-s1-b');
      expect(h.deps.notices[0]).toContain('before the agent was dispatched');
    });

    test('a result dated exactly at the dispatch is this dispatch\'s: it is stamped, with no notice', async () => {
      const { h, byAgent, dispatchedAt } = await arrivedAt(0);
      expect(byAgent['reviewer-s1-a'].last_message_ts).toBe(new Date(dispatchedAt).toISOString());
      expect(h.deps.notices).toEqual([]);
    });
  });

  test('tracing never fails the run: a tracer that throws on everything changes nothing', async () => {
    const h = harness();
    h.deps.makeTracer = () => ({
      startSpan: () => {
        throw new Error('trace disk full');
      },
      endSpan: () => {
        throw new Error('trace disk full');
      },
    });
    const { next } = await reviewRound(h);
    expect(next.status).toBe('DONE');
    const noFactory = harness();
    noFactory.deps.makeTracer = () => {
      throw new Error('boom');
    };
    expect((await reviewRound(noFactory)).next.status).toBe('DONE');
  });
});

describe('failures that are reported, not hidden', () => {
  test('an unreadable PR, an unfetchable base and an unresolvable merge base are RUN_FAILED with a named reason', async () => {
    const a = harness();
    a.deps.readPr = async () => ({ ok: false, error: 'gh: not found' });
    expect(await a.prepare()).toMatchObject({ status: 'RUN_FAILED', reason: 'pr-unreadable' });
    const b = harness();
    b.deps.fetchRefs = async () => ({ ok: false, error: 'network' });
    expect(await b.prepare()).toMatchObject({ status: 'RUN_FAILED', reason: 'refs-unavailable' });
    const c = harness();
    c.deps.git = async () => ({ status: 1, stdout: '', stderr: 'fatal' });
    expect(await c.prepare()).toMatchObject({ status: 'RUN_FAILED', reason: 'base-unresolved' });
  });

  test('a prepare step that failed is RUN_FAILED and leaves no run behind, so the same run id can be retried', async () => {
    const h = harness({ prepareOverride: () => ({ ok: false, status: 'PREPARE_FAILED', reason: 'snapshot-failed', stage: 'snapshot', detail: 'git archive failed' }) });
    expect(await h.prepare()).toMatchObject({ status: 'RUN_FAILED', reason: 'prepare-failed', error: expect.stringContaining('snapshot-failed') });
    expect(fs.existsSync(path.join(h.runDir(), 'run.json'))).toBe(false);
  });

  test('collect on an unknown or unreadable run', async () => {
    const h = harness();
    expect(await h.collect({ runId: 'ghost' })).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: 'run-not-found' });
    await h.prepare();
    fs.writeFileSync(path.join(h.runDir(), 'run.json'), '{ truncated');
    expect(await h.collect()).toMatchObject({ ok: false, reason: 'run-unreadable' });
  });

  test('a prepared directory for another head is refused', async () => {
    const h = harness({ prepareOverride: (o) => ({ ok: true, dir: '/x', headSha: 'e'.repeat(40), baseSha: o.baseSha, artifacts: {} }) });
    expect(await h.prepare()).toMatchObject({ status: 'RUN_FAILED' });
  });
});

describe('support helpers', () => {
  test('deriveKinds cites every changed path exactly once and never anything below Medium for code', () => {
    const kinds = S.deriveKinds(['README.md', 'src/a.js', 'docs/x.rst']);
    expect(kinds).toEqual([{ kind: 'docs', paths: ['README.md', 'docs/x.rst'] }, { kind: 'product', paths: ['src/a.js'] }]);
    expect(S.deriveKinds([])).toEqual([]);
    expect(S.deriveKinds('x')).toEqual([]);
  });

  test('planDepth: Medium is standard, 2 reviewers per slice, 3 verifiers; a Low waiver is quick with one reviewer and none', () => {
    const medium = S.planDepth({ tier: 'medium', effectiveTier: 'medium', waiver: { applies: false } });
    expect(medium.depth).toMatchObject({ mode: 'standard', reviewersPerSlice: 2, verifiersPerCandidate: 3 });
    const quick = S.planDepth({ tier: 'low', effectiveTier: 'low', waiver: { applies: true } });
    expect(quick.depth).toMatchObject({ mode: 'quick', reviewersPerSlice: 1, verifiersPerCandidate: 0 });
    const high = S.planDepth({ tier: 'high', effectiveTier: 'high', waiver: { applies: false } });
    expect(high.depth.mode).toBe('deep');
    expect(S.planDepth({ tier: 'nonsense', effectiveTier: 'nonsense' }).ok).toBe(false);
  });

  test('planVerifierPool never hands a verifier more than three candidates and never the raiser', () => {
    const candidates = Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, source: 'reviewer-s1-a' }));
    const plan = S.planVerifierPool({ candidates, mode: 'standard', k: 3 });
    expect(plan.ok).toBe(true);
    expect(Math.max(...plan.agents.map((a) => a.candidates.length))).toBeLessThanOrEqual(3);
    expect(plan.assignments.every((a) => a.verifiers.length === 3 && !a.verifiers.includes('reviewer-s1-a'))).toBe(true);
    expect(S.planVerifierPool({ candidates: [], mode: 'standard', k: 3 }).ok).toBe(true);
  });

  test('chunk, locationFile and adjudicateList', () => {
    expect(S.chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(S.chunk([1, 2], 0)).toEqual([[1], [2]]);
    expect(S.locationFile('a/b.js:12-14')).toBe('a/b.js');
    expect(S.locationFile('a/b.js')).toBeNull();
    expect(S.adjudicateList([{ id: 1, uncertain: true }, { id: 2, disposition: 'adjudicate' }, { id: 3, verification: { outcome: 'disputed' } }, { id: 4 }, { id: 5, uncertain: true, adjudication: { by: 'orchestrator' } }]).map((x) => x.id)).toEqual([1, 2, 3]);
  });
});

describe('the review is sharded by slice and lens (the shared plan): each reviewer holds one lens, so a path is read under distinct lenses', () => {
  test('the dispatched reviewers carry the plan\'s distinct lenses, the security lane its own, and every brief names its lens', async () => {
    const h = harness();
    const m = await h.prepare();
    expect(m.status).toBe('DISPATCH');
    const agents = h.readRun().waves[0].agents;
    const reviewers = agents.filter((agent) => agent.role === 'reviewer');
    expect(reviewers.map((agent) => agent.name)).toEqual(['reviewer-s1-a', 'reviewer-s1-b']);
    expect(new Set(reviewers.map((agent) => agent.lens)).size).toBe(2);
    expect(reviewers.map((agent) => agent.lens)).toEqual(['correctness', 'security']);
    expect(agents.find((agent) => agent.role === 'security')).toMatchObject({ lens: 'security' });
    for (const agent of reviewers) expect(fs.readFileSync(agent.briefPath, 'utf8')).toContain(`Your lens: ${agent.lens}`);
  });
});
