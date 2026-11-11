'use strict';

/**
 * Per-agent stats the DISPATCHER supplies at collect (kata nj2d, plan v2 section 5 child V2-1, owner decision D8) through the REAL review
 * runner: prepareRun / collectRun over fake deps, the real result-file collector and the real filesystem, exactly as
 * pr-review-run.test.js does; the last block reads the trace back through the real recorder and the real reader.
 *
 * The runner cannot see the model, so it cannot know an agent's tool calls, turns, effort, model, retries or 429s: the dispatcher passes
 * what it knows in the collect payload's `agentStats`, the runner stamps each figure on the span of the agent it names, and
 * `pr-review-cli timing` reports them. What is pinned, each by a test that fails when its guard is removed:
 *   - every figure the dispatcher supplied is on the span of the agent it names (reviewers, the lane, verifiers), as supplied; a figure it
 *     could not supply is `null` WITH a reason, a zero stays a zero and is never taken for "unknown";
 *   - a collect that supplies no stats ends every span with exactly what it ended it with before (`state`, `reason`, `last_message_ts`), and its
 *     answers and spans are byte-identical to the ones recorded from the runner before this change (tests/fixtures/pr-review-agent-stats);
 *   - stats decide nothing: the answers are the same with, without and with an empty `agentStats`;
 *   - a malformed `agentStats` (negative, NaN, a string, an unknown figure, a figure no reason explains) is refused as `invalid-input`, nothing
 *     is recorded, and the same collect without it still works; an agent the run does not have is refused;
 *   - a figure for an agent this call does not record (its wave still outstanding, or recorded by an earlier collect) is not stamped and the
 *     answer's `warnings` say so.
 *
 * Regenerating the golden (only when the runner's answers or spans are meant to change): UPDATE_GOLDEN=1 npx jest --runInBand <this file>.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { prepareRun, collectRun, COLLECT_KEYS } = require('../lib/pr-review-run');
const { collectResults, defaultDeps } = require('../lib/pr-review-results');
const { renderBriefFromFiles } = require('../lib/pr-review-brief-files');
const { classifyPaths } = require('../lib/pr-review-paths');
const { loadPolicy } = require('../lib/pr-review-policy');
const { realFs } = require('../lib/review-run-cli');
const { redact } = require('../lib/pr-review-state');
const { createTracer } = require('../lib/run-trace');
const { loadReviewTiming, formatReviewTiming } = require('../lib/pr-review-timing');

const SCRATCH = path.join(os.homedir(), '.omp', 'pr-review-speedup', 'prs-agent-stats', 'scratch');
const GOLDEN = path.join(__dirname, 'fixtures', 'pr-review-agent-stats', 'collect-without-stats.golden.json');
const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const TREE = 'c'.repeat(40);
const GOOD_BODY = '## Testing\nran the relevant tests\n\n## Risk\nlow\n\n## How to revert\nrevert the commit\n';
/** The one instant a frozen run lives at (an arbitrary constant: nothing reads the real clock, so the bytes never depend on when the test ran). */
const FROZEN_AT = Date.UTC(2026, 10, 11, 12, 0, 0);

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

/**
 * The collector's file-system deps with every file dated `at`. `readFile` is handed the real times it checks a file against (a file that is
 * swapped between the stat and the read is still refused), so only what the collector REPORTS is pinned.
 */
function pinnedDeps(at) {
  const base = defaultDeps();
  const pin = (facts) => (facts === null ? null : { ...facts, mtimeMs: at, ctimeMs: at });
  return {
    ...base,
    lstat: (file) => pin(base.lstat(file)),
    readFile: (file, expected) => {
      const real = base.lstat(file);
      return base.readFile(file, expected && real ? { ...expected, mtimeMs: real.mtimeMs, ctimeMs: real.ctimeMs } : expected);
    },
  };
}

/**
 * The fake-deps harness of pr-review-run.test.js, cut to what these tests need. `frozenAt` makes the run deterministic: the clock reads that
 * instant for good, and the collector sees every result file dated that instant (the change time of a file is the one thing a test cannot
 * set), so every agent arrives the moment it was dispatched and two runs of one scenario produce the same bytes. The collector itself is
 * the real one: only the times it reads from the file system are pinned.
 */
function harness({ policyJson, frozenAt } = {}) {
  fs.mkdirSync(SCRATCH, { recursive: true });
  const root = fs.mkdtempSync(path.join(SCRATCH, 'a-'));
  roots.push(root);
  const repoRoot = path.join(root, 'repo');
  const dir = path.join(root, 'prepared');
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.mkdirSync(path.join(dir, 'snapshot'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'range.diff'), 'diff --git a/x b/x\n');
  fs.writeFileSync(path.join(dir, 'facts.json'), JSON.stringify(makeFacts({ changedPaths: ['src/a.js'], policyJson })));
  fs.writeFileSync(path.join(dir, 'baseline.json'), JSON.stringify({ ran: false, reason: 'no-test-files', command: null, exitCode: null, timedOut: false, selection: [] }));
  const h = { root, repoRoot, stateWrites: [], spans: [], notices: [] };
  let spanSeq = 0;
  h.deps = {
    now: frozenAt === undefined ? () => Date.now() : () => frozenAt,
    redact,
    notices: h.notices,
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
    collectResults: (input) => collectResults(input, frozenAt === undefined ? undefined : pinnedDeps(frozenAt)),
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
  };
  h.prepare = (extra = {}) => prepareRun({ repo: 'o/r', pr: 7, repoRoot, runId: 'run1', agentAuthored: false, ...extra }, h.deps);
  h.collect = (extra = {}) => collectRun({ repoRoot, runId: 'run1', ...extra }, h.deps);
  h.runFile = path.join(repoRoot, '.ensemble', 'pr-review', 'run', 'run1', 'run.json');
  h.readRun = () => JSON.parse(fs.readFileSync(h.runFile, 'utf8'));
  h.ends = () => h.spans.filter((s) => s.type === 'end');
  /** The end of the span of the agent called `name`: `{status, attrs}`, or undefined while it is open. */
  h.endOf = (name) => {
    const start = h.spans.find((s) => s.type === 'start' && s.kind === 'agent' && s.attrs.agent === name);
    return start === undefined ? undefined : h.spans.find((s) => s.type === 'end' && s.id === start.id);
  };
  return h;
}

const writeResult = (agent, object) => {
  fs.mkdirSync(path.dirname(agent.outPath), { recursive: true });
  const temp = `${agent.outPath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(object));
  fs.renameSync(temp, agent.outPath);
};

const finding = (over = {}) => ({ locationOrLink: 'src/a.js:3', severity: 'important', failureMode: 'the loop reads past the end of the list', disposition: 'fix', evidence: 'src/a.js line 3 indexes list[list.length]', originalTextOrLink: 'src/a.js:3', ...over });

/** Every reviewer writes its result (all paths reviewed; `reviewer-s1-a` raises one finding) and the lane writes its own; `skip` lists agents that write nothing. */
function answerReview(h, manifest, { skip = [] } = {}) {
  const all = h.readRun().changedPaths;
  for (const agent of manifest.agents) {
    if (skip.includes(agent.name)) continue;
    if (agent.role === 'reviewer') writeResult(agent, { findings: agent.name === 'reviewer-s1-a' ? [finding()] : [], pathsReviewed: agent.paths });
    else writeResult(agent, { findings: [], pathsReviewed: all });
  }
}

const voteAll = (manifest) => {
  for (const agent of manifest.agents) writeResult(agent, { votes: agent.candidateIds.map((id) => ({ candidateId: id, verdict: 'real', evidence: 'checked' })) });
};

/** What a dispatcher that knows everything reports for each agent of the light Medium run: two reviewers, the lane, three verifiers. */
const FULL = {
  'reviewer-s1-a': { tool_calls: 31, turns: 33, effort: 'hi', model: 'claude-opus-4-5', retries: 0, rate_limits: 0 },
  'reviewer-s1-b': { tool_calls: 40, turns: 41, effort: 'hi', model: 'claude-opus-4-5', retries: 1, rate_limits: 2 },
  'security-lane': { tool_calls: 0, turns: 1, effort: 'default', model: 'claude-opus-4-5', retries: 0, rate_limits: 0 },
};
const VERIFIERS = {
  'verifier-1': { tool_calls: 9, turns: 10, effort: 'hi', model: 'claude-opus-4-5', retries: 0, rate_limits: 0 },
  'verifier-2': { tool_calls: 12, turns: 13, effort: 'hi', model: 'claude-opus-4-5', retries: 0, rate_limits: 1 },
  'verifier-3': { tool_calls: 7, turns: 8, effort: 'hi', model: 'claude-opus-4-5', retries: 0, rate_limits: 0 },
};

/** prepare -> the review round answered -> collect (`first` extra payload keys) -> the verifiers vote -> collect (`second`). */
async function scenario({ frozenAt, first, second, policyJson } = {}) {
  const h = harness({ frozenAt, policyJson });
  const answers = [];
  const m1 = await h.prepare();
  answers.push(m1);
  answerReview(h, m1);
  const m2 = await h.collect(first);
  answers.push(m2);
  voteAll(m2);
  answers.push(await h.collect(second));
  return { h, answers };
}

/** The scenario's answers and spans as the golden holds them: every path under the scratch directory is `<ROOT>`. */
function canonical(h, answers) {
  const text = JSON.stringify({ answers, spans: h.spans }, null, 2);
  return `${text.split(h.root).join('<ROOT>')}\n`;
}

describe('agentStats: what the dispatcher supplied is on the span of the agent it names', () => {
  test('every figure is stamped as supplied, for the reviewers and the lane of the review round and for the verifiers', async () => {
    const { h, answers } = await scenario({ first: { agentStats: FULL }, second: { agentStats: VERIFIERS } });
    expect(answers[2]).toMatchObject({ ok: true, status: 'DONE' });
    for (const [name, figures] of Object.entries({ ...FULL, ...VERIFIERS })) {
      const end = h.endOf(name);
      expect(end).toBeDefined();
      // exactly what the runner always put there, plus exactly what was supplied: no figure dropped, none invented
      expect(end.attrs).toEqual({ state: 'arrived', reason: undefined, last_message_ts: expect.any(String), ...figures });
      expect(end.status).toBe('ok');
    }
  });

  test('a figure the harness cannot supply is null WITH its reason, and a zero is a figure: neither is turned into the other', async () => {
    const stats = {
      'reviewer-s1-a': { tool_calls: null, tool_calls_reason: 'the harness job result reports no tool-call count', turns: 0, effort: 'hi', model: null, model_reason: 'the harness resolves the default model and does not report it' },
      'reviewer-s1-b': { retries: 0, rate_limits: null, rate_limits_reason: 'the harness does not report 429s' },
    };
    const { h } = await scenario({ first: { agentStats: stats } });
    expect(h.endOf('reviewer-s1-a').attrs).toEqual({ state: 'arrived', reason: undefined, last_message_ts: expect.any(String), ...stats['reviewer-s1-a'] });
    expect(h.endOf('reviewer-s1-a').attrs.tool_calls).toBeNull();
    expect(h.endOf('reviewer-s1-a').attrs.turns).toBe(0);
    expect(h.endOf('reviewer-s1-b').attrs).toEqual({ state: 'arrived', reason: undefined, last_message_ts: expect.any(String), ...stats['reviewer-s1-b'] });
    // an agent the payload does not name has none of them
    expect(Object.keys(h.endOf('security-lane').attrs).sort()).toEqual(['last_message_ts', 'reason', 'state']);
  });

  test('figures reach an agent that did not arrive too (an expired agent made calls before it was stopped)', async () => {
    const h = harness();
    const m1 = await h.prepare();
    answerReview(h, m1, { skip: ['reviewer-s1-b'] });
    const after = m1.agents.find((a) => a.name === 'reviewer-s1-b').deadlineAt + 1000;
    const stats = { 'reviewer-s1-b': { tool_calls: 22, turns: 24, retries: 2 } };
    await h.collect({ now: after, agentStats: stats });
    const end = h.endOf('reviewer-s1-b');
    expect(end.status).not.toBe('ok');
    expect(end.attrs).toMatchObject({ tool_calls: 22, turns: 24, retries: 2 });
  });

  test('a stamped figure is redacted like everything else the runner writes: a credential-shaped reason does not reach the trace', async () => {
    const secret = `ghp_${'a1B2c3D4e5'.repeat(4)}`;
    const { h } = await scenario({ first: { agentStats: { 'reviewer-s1-a': { tool_calls: null, tool_calls_reason: `the harness said: auth failed with ${secret}` } } } });
    expect(JSON.stringify(h.spans)).not.toContain(secret);
    expect(h.endOf('reviewer-s1-a').attrs.tool_calls_reason).toContain('[REDACTED]');
  });
});

describe('agentStats: a collect that supplies none changes nothing', () => {
  test('every span ends with exactly state, reason and last_message_ts, with no payload key and with an empty agentStats', async () => {
    for (const extra of [undefined, { agentStats: {} }]) {
      const { h } = await scenario({ first: extra, second: extra });
      for (const name of ['reviewer-s1-a', 'reviewer-s1-b', 'security-lane', 'verifier-1', 'verifier-2', 'verifier-3']) {
        expect(Object.keys(h.endOf(name).attrs).sort()).toEqual(['last_message_ts', 'reason', 'state']);
      }
    }
  });

  test('the answers are the same with stats, with an empty agentStats and without: stats are a record, never an input to a verdict, a gate or a wall time', async () => {
    const at = FROZEN_AT;
    const plain = await scenario({ frozenAt: at });
    const empty = await scenario({ frozenAt: at, first: { agentStats: {} }, second: { agentStats: {} } });
    const full = await scenario({ frozenAt: at, first: { agentStats: FULL }, second: { agentStats: VERIFIERS } });
    const bytes = (run) => canonical(run.h, run.answers);
    const answersOf = (run) => JSON.stringify(run.answers).split(run.h.root).join('<ROOT>');
    expect(answersOf(empty)).toBe(answersOf(plain));
    expect(answersOf(full)).toBe(answersOf(plain));
    expect(plain.answers[2]).toMatchObject({ ok: true, status: 'DONE', metrics: { wallMs: 0 } });
    // the spans differ only by the figures the dispatcher supplied
    const strip = (run) => run.h.spans.map((s) => (s.type === 'end' ? { ...s, attrs: Object.fromEntries(Object.entries(s.attrs).filter(([key]) => !/^(tool_calls|turns|effort|model|retries|rate_limits)(_reason)?$/.test(key))) } : s));
    expect(JSON.stringify(strip(full))).toBe(JSON.stringify(strip(plain)));
    expect(bytes(empty)).toBe(bytes(plain));
  });

  test('BYTE IDENTITY: the answers and the spans of a collect that supplies no stats are the bytes the runner produced before agentStats existed', async () => {
    const { h, answers } = await scenario({ frozenAt: FROZEN_AT });
    const text = canonical(h, answers);
    if (process.env.UPDATE_GOLDEN === '1') {
      fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
      fs.writeFileSync(GOLDEN, text);
    }
    expect(text).toBe(fs.readFileSync(GOLDEN, 'utf8'));
  });
});

describe('agentStats: fail closed', () => {
  let h;
  let manifest;
  beforeAll(async () => {
    h = harness();
    manifest = await h.prepare();
    answerReview(h, manifest);
  });

  const name = 'reviewer-s1-a';
  const MALFORMED = [
    ['a negative count', { tool_calls: -1 }, 'tool_calls'],
    ['NaN', { turns: NaN }, 'turns'],
    ['Infinity', { turns: Infinity }, 'turns'],
    ['a fraction', { retries: 1.5 }, 'retries'],
    ['a count as a string', { tool_calls: '31' }, 'tool_calls'],
    ['a boolean for a count', { rate_limits: true }, 'rate_limits'],
    ['an array for a count', { tool_calls: [3] }, 'tool_calls'],
    ['an integer beyond the safe range', { tool_calls: 2 ** 53 }, 'tool_calls'],
    ['a number for effort', { effort: 5 }, 'effort'],
    ['an effort with a space in it', { effort: 'very high' }, 'effort'],
    ['an empty model', { model: '' }, 'model'],
    ['a model name over 100 characters', { model: 'm'.repeat(101) }, 'model'],
    ['a model with a line break', { model: 'opus\n4' }, 'model'],
    ['a null figure with no reason', { tool_calls: null }, 'tool_calls_reason'],
    ['a known figure with a reason', { tool_calls: 3, tool_calls_reason: 'why' }, 'tool_calls_reason'],
    ['a reason with no figure', { tool_calls_reason: 'why' }, 'tool_calls_reason'],
    ['an empty reason', { tool_calls: null, tool_calls_reason: '' }, 'tool_calls_reason'],
    ['a reason that is not text', { tool_calls: null, tool_calls_reason: 5 }, 'tool_calls_reason'],
    ['a reason over 300 characters', { tool_calls: null, tool_calls_reason: 'r'.repeat(301) }, 'tool_calls_reason'],
    ['a reason with a line break', { tool_calls: null, tool_calls_reason: 'a\nb' }, 'tool_calls_reason'],
    ['a reason with a NEL (U+0085), which many readers print as a line break', { tool_calls: null, tool_calls_reason: 'a\u0085b' }, 'tool_calls_reason'],
    ['a reason with a line separator (U+2028)', { tool_calls: null, tool_calls_reason: 'a\u2028b' }, 'tool_calls_reason'],
    ['a reason with a paragraph separator (U+2029)', { tool_calls: null, tool_calls_reason: 'a\u2029b' }, 'tool_calls_reason'],
    ['a reason with a C1 control character (U+009B)', { tool_calls: null, tool_calls_reason: 'a\u009bb' }, 'tool_calls_reason'],
    ['a figure nobody asked for', { tokens: 5 }, 'tokens'],
    ['a misspelt figure', { toolcalls: 3 }, 'toolcalls'],
  ];

  /** The refusal, and the proof that nothing happened: the run file is the same bytes and no span ended. */
  async function refused(payload, mention) {
    const file = fs.readFileSync(h.runFile);
    const ends = h.ends().length;
    const answer = await h.collect(payload);
    expect(answer).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: 'invalid-input' });
    expect(answer.error).toContain('agentStats');
    expect(answer.error).toContain(mention);
    expect(fs.readFileSync(h.runFile).equals(file)).toBe(true);
    expect(h.ends()).toHaveLength(ends);
    return answer;
  }

  test.each(MALFORMED)('%s is refused naming the agent and the figure, and nothing is recorded', async (_label, entry, key) => {
    const answer = await refused({ agentStats: { [name]: entry } }, key);
    expect(answer.error).toContain(name);
  });

  test.each([
    ['agentStats that is an array', []],
    ['agentStats that is a number', 5],
    ['agentStats that is a string', 'reviewer-s1-a'],
    ['agentStats that is null', null],
  ])('%s is refused', async (_label, value) => {
    await refused({ agentStats: value }, 'object');
  });

  test.each([
    ['an entry that is a number', 5],
    ['an entry that is an array', [{ tool_calls: 1 }]],
    ['an entry that is null', null],
    ['an entry that is a string', 'many'],
  ])('%s is refused', async (_label, entry) => {
    const answer = await refused({ agentStats: { [name]: entry } }, name);
    expect(answer.error).toMatch(/object/);
  });

  test('an agent the run does not have is refused by name (a mistyped name is never dropped in silence), and so is one that is not dispatched yet', async () => {
    const answer = await refused({ agentStats: { 'reviewer-s9-z': { tool_calls: 3 } } }, 'reviewer-s9-z');
    expect(answer.error).toMatch(/no agent of run run1/);
    // the verifiers do not exist until the review round is collected: their names are not known to the dispatcher yet
    await refused({ agentStats: { 'verifier-1': { tool_calls: 3 } } }, 'verifier-1');
    // a name that is no agent's is refused whatever else the payload carries, and `__proto__` is just such a name
    await refused({ agentStats: JSON.parse('{"__proto__": {"tool_calls": 3}}') }, '__proto__');
  });

  test('a stats key that is not the payload key is refused as an unknown key, as every other misspelt key is', async () => {
    const answer = await h.collect({ agentstats: {} });
    expect(answer).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: 'invalid-input' });
    expect(answer.error).toContain('unknown payload key "agentstats"');
  });

  test('the payload key is part of the documented collect keys, after the older ones', () => {
    expect(COLLECT_KEYS).toEqual(['repoRoot', 'runId', 'now', 'adjudications', 'triage', 'agentStats']);
  });

  test('after every refusal the same collect without stats still works: a refusal is not terminal and consumed nothing', async () => {
    const next = await h.collect();
    expect(next).toMatchObject({ ok: true, status: 'DISPATCH', round: 'verify' });
    expect(h.endOf(name).attrs).toEqual({ state: 'arrived', reason: undefined, last_message_ts: expect.any(String) });
  });
});

describe('agentStats: a figure for an agent this call does not record is not stamped, and the answer says so', () => {
  test('a wave that is still outstanding records nothing: the stats are named in the warnings, and sent again with the collect that records the wave they are stamped', async () => {
    const h = harness();
    const m1 = await h.prepare();
    answerReview(h, m1, { skip: ['reviewer-s1-b'] });
    const pending = await h.collect({ agentStats: { 'reviewer-s1-a': { tool_calls: 5 }, 'security-lane': { tool_calls: 6 } } });
    expect(pending).toMatchObject({ ok: true, status: 'PENDING', waitingOn: ['reviewer-s1-b'] });
    expect(h.endOf('reviewer-s1-a')).toBeUndefined();
    expect(h.notices).toHaveLength(1);
    expect(h.notices[0]).toMatch(/^agent-stats: .*reviewer-s1-a, security-lane/);
    expect(h.notices[0]).toMatch(/wave is still outstanding/);

    answerReview(h, m1);
    h.notices.length = 0;
    const next = await h.collect({ agentStats: { 'reviewer-s1-a': { tool_calls: 5 }, 'security-lane': { tool_calls: 6 }, 'reviewer-s1-b': { tool_calls: 7 } } });
    expect(next).toMatchObject({ ok: true, status: 'DISPATCH', round: 'verify' });
    expect(h.notices).toEqual([]);
    expect(h.endOf('reviewer-s1-a').attrs.tool_calls).toBe(5);
    expect(h.endOf('security-lane').attrs.tool_calls).toBe(6);
    expect(h.endOf('reviewer-s1-b').attrs.tool_calls).toBe(7);
  });

  test('an agent whose wave an earlier collect recorded keeps the span it had: a span cannot take attributes after it ended', async () => {
    const h = harness();
    const m1 = await h.prepare();
    answerReview(h, m1);
    const m2 = await h.collect();
    expect(m2).toMatchObject({ status: 'DISPATCH', round: 'verify' });
    const endsBefore = JSON.stringify(h.ends());
    const again = await h.collect({ agentStats: { 'reviewer-s1-a': { tool_calls: 9 } } });
    expect(again).toMatchObject({ ok: true, status: 'PENDING' });
    expect(JSON.stringify(h.ends())).toBe(endsBefore);
    expect(h.endOf('reviewer-s1-a').attrs.tool_calls).toBeUndefined();
    expect(h.notices.join('\n')).toMatch(/reviewer-s1-a[^]*recorded by an earlier collect/);
  });

  test('a finished run answers its stored answer, and says the stats it was given were not recorded', async () => {
    const { h } = await scenario({});
    const replay = await h.collect();
    expect(replay).toMatchObject({ ok: true, status: 'DONE' });
    const done = await h.collect({ agentStats: { 'verifier-1': { tool_calls: 9 } } });
    expect(done).toEqual(replay);
    expect(h.endOf('verifier-1').attrs.tool_calls).toBeUndefined();
    expect(h.notices.join('\n')).toMatch(/verifier-1/);
  });
});

describe('agentStats: read back through the real recorder and the real reader (pr-review-cli timing)', () => {
  test('timing prints the tool calls of every agent, or names each one without a figure, with its reason', async () => {
    const h = harness();
    h.deps.makeTracer = (runId) => createTracer({ runId, projectRoot: h.repoRoot });
    const m1 = await h.prepare();
    answerReview(h, m1);
    const stats = {
      'reviewer-s1-a': { tool_calls: 31, turns: 33, effort: 'hi', model: 'claude-opus-4-5', retries: 0, rate_limits: 0 },
      'reviewer-s1-b': { tool_calls: null, tool_calls_reason: 'the harness job result reports no tool-call count', effort: 'hi' },
      // the lane is not named at all
    };
    const m2 = await h.collect({ agentStats: stats });
    voteAll(m2);
    const verifierStats = { 'verifier-1': { tool_calls: 0, turns: 1 }, 'verifier-2': { tool_calls: 12 } };
    expect(await h.collect({ agentStats: verifierStats })).toMatchObject({ status: 'DONE' });

    const timing = loadReviewTiming({ runId: 'run1', projectRoot: h.repoRoot });
    expect(timing).toMatchObject({ ok: true, warnings: [] });
    const rows = Object.fromEntries(timing.agentStats.agents.map((row) => [row.name, row]));
    expect(Object.keys(rows).sort()).toEqual(['reviewer-s1-a', 'reviewer-s1-b', 'security-lane', 'verifier-1', 'verifier-2', 'verifier-3']);
    expect(rows['reviewer-s1-a']).toMatchObject({ role: 'reviewer', round: 1, wave: 1, toolCalls: 31, turns: 33, effort: 'hi', model: 'claude-opus-4-5', retries: 0, rateLimits: 0 });
    expect(rows['reviewer-s1-b']).toMatchObject({ toolCalls: null, effort: 'hi' });
    expect(timing.agentStats.byRole.reviewer.without).toContainEqual({ figure: 'toolCalls', reason: 'the harness job result reports no tool-call count', agents: ['reviewer-s1-b'] });
    expect(rows['security-lane'].toolCalls).toBeNull();
    expect(timing.agentStats.byRole['security-lane'].without).toContainEqual({ figure: 'toolCalls', reason: expect.stringContaining('no tool_calls'), agents: ['security-lane'] });
    expect(rows['verifier-1']).toMatchObject({ role: 'verifier', toolCalls: 0, turns: 1 });
    expect(rows['verifier-3'].toolCalls).toBeNull();
    expect(timing.agentStats.byRole.reviewer.toolCalls).toMatchObject({ known: 1, missing: 1, total: 31, max: 31, lowerBound: true });
    expect(timing.agentStats.byRole.verifier.toolCalls).toMatchObject({ known: 2, missing: 1, total: 12, min: 0, max: 12, lowerBound: true });

    const text = formatReviewTiming(timing);
    for (const row of timing.agentStats.agents) expect(text).toContain(row.name);
    expect(text).toMatch(/reviewer-s1-a[^\n]*tool calls 31/);
    expect(text).toMatch(/reviewer-s1-b[^\n]*tool calls MISSING/);
    expect(text).toContain('the harness job result reports no tool-call count');
  });
});

describe('agentStats: a refusal writes nothing, even on a run that is over whose root span is still open', () => {
  test('an agent the run does not have is refused before the call takes the run up: no root closed, no state saved; the same call without it does the bookkeeping', async () => {
    const h = harness();
    await h.prepare();
    // the head moves: the run is over (invalidated), and the call that found out closes its root span
    const moved = HEAD.slice(0, 39) + (HEAD.endsWith('0') ? '1' : '0');
    h.deps.readPr = async () => ({ ok: true, headSha: moved, baseRefName: 'main', state: 'OPEN', body: GOOD_BODY, author: 'alice', isCrossRepository: false });
    const over = await h.collect();
    expect(over).toMatchObject({ ok: false, status: 'RUN_INVALIDATED' });
    // a bookkeeping write that failed leaves the root span open ("a later collect tries the bookkeeping again"): put the run in that state
    const run = h.readRun();
    expect(run.rootEnded).toBe(true);
    run.rootEnded = false;
    fs.writeFileSync(h.runFile, JSON.stringify(run, null, 2));
    const file = fs.readFileSync(h.runFile);
    const ends = h.ends().length;

    const refused = await h.collect({ agentStats: { 'no-such-agent': { tool_calls: 3 } } });
    expect(refused).toMatchObject({ ok: false, status: 'RUN_FAILED', reason: 'invalid-input' });
    expect(refused.error).toContain('no-such-agent');
    expect(fs.readFileSync(h.runFile).equals(file)).toBe(true); // nothing saved
    expect(h.ends()).toHaveLength(ends); // no span ended

    // the control, so the checks above are not vacuous: without the refused payload the same call closes the root and saves the run
    expect(await h.collect()).toMatchObject({ ok: false, status: 'RUN_INVALIDATED' });
    expect(h.ends()).toHaveLength(ends + 1);
    expect(h.readRun().rootEnded).toBe(true);
  });
});
