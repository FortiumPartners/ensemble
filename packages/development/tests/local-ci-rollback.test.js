'use strict';

/**
 * Rollout / rollback (TRD-010-TEST). Real local-ci-* modules. GitHub is a
 * fake in-memory protection store and a fake status publisher; no network, no login,
 * no real branch protection is read or changed.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const rollout = require('../lib/local-ci-rollout');
const cli = require('../lib/local-ci-cli');
const { validateConfig } = require('../lib/local-ci-config');

const { makeBaseRepo, cleanupBaseRepos, prInfoFor, fakePostStatus, PR, REPO } = require('./helpers/local-ci-base-repo');
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REPO_CONFIG = path.join(REPO_ROOT, '.ensemble', 'local-ci.yaml');
const CONFIG = validateConfig(fs.readFileSync(REPO_CONFIG, 'utf8'));
const CONTEXT = CONFIG.approvalSet.statusContext;
const NOW = '2026-10-21T12:00:00.000Z';
// The hosted required checks the local gate covers, taken from the real approval set: the job name, plus
// "<job> (<node>)" for each matrix entry (how GitHub names them).
const COVERED = CONFIG.approvalSet.checks.map((c) => (c.matrix && c.matrix['node-version'] ? `${c.job} (${c.matrix['node-version']})` : c.job));

/** Recorded shape of GET /repos/{o}/{r}/branches/dev/protection (values anonymised). */
function recordedProtection() {
  const url = 'https://api.github.com/repos/o/r/branches/dev/protection';
  return {
    url,
    required_status_checks: {
      url: `${url}/required_status_checks`,
      strict: false,
      contexts: ['validate', 'test (22)', 'test (24)'],
      contexts_url: `${url}/required_status_checks/contexts`,
      checks: [
        { context: 'validate', app_id: 15368 },
        { context: 'test (22)', app_id: 15368 },
        { context: 'test (24)', app_id: 15368 },
      ],
    },
    enforce_admins: { url: `${url}/enforce_admins`, enabled: true },
    required_pull_request_reviews: null,
    restrictions: null,
  };
}

/** Fake GitHub protection endpoint: applies plan steps the way the API documents them. */
function fakeGithub(initial) {
  const store = JSON.parse(JSON.stringify(initial));
  const log = [];
  const apply = (s) => {
    log.push(`${s.method} ${s.path}`);
    if (s.method === 'GET') return JSON.parse(JSON.stringify(store));
    if (s.method === 'PATCH' && s.path.endsWith('/protection/required_status_checks')) {
      store.required_status_checks.strict = s.body.strict;
      store.required_status_checks.checks = s.body.checks.map((c) => ({ context: c.context, app_id: c.app_id === -1 ? null : c.app_id }));
      store.required_status_checks.contexts = s.body.checks.map((c) => c.context);
      return null;
    }
    throw new Error(`fake github: unsupported call ${s.method} ${s.path}`);
  };
  return { store, log, apply, applyPlan: (plan) => plan.steps.forEach(apply) };
}

/** A PR may merge only if every required check has a success status from its pinned app. */
function canMerge(protection, statuses) {
  return protection.required_status_checks.checks.every((req) =>
    statuses.some((s) => s.context === req.context && s.state === 'success' && (req.app_id === null || s.app_id === req.app_id))
  );
}

const snap = (response = recordedProtection()) => {
  const r = rollout.snapshotProtection(response, { repo: 'o/r', branch: 'dev', now: NOW });
  if (!r.ok) throw new Error(r.problems.join('; '));
  return r.snapshot;
};
const reasonsOf = (r) => r.reasons.join('\n');

describe('snapshotProtection', () => {
  test('captures all four parts, app ids, timestamp and repo/branch', () => {
    const s = snap();
    expect(s).toMatchObject({
      repo: 'o/r',
      branch: 'dev',
      takenAt: NOW,
      required_status_checks: { strict: false, checks: [{ context: 'validate', app_id: 15368 }, { context: 'test (22)', app_id: 15368 }, { context: 'test (24)', app_id: 15368 }] },
      enforce_admins: { enabled: true },
      required_pull_request_reviews: null,
      restrictions: null,
    });
    expect(JSON.stringify(s)).not.toMatch(/api\.github\.com/);
  });

  test.each([
    ['not an object', null],
    ['no required_status_checks', (r) => delete r.required_status_checks],
    ['no checks array (no app ids)', (r) => delete r.required_status_checks.checks],
    ['check without app_id', (r) => delete r.required_status_checks.checks[0].app_id],
    ['strict missing', (r) => delete r.required_status_checks.strict],
    ['enforce_admins missing', (r) => delete r.enforce_admins],
    ['restrictions wrong type', (r) => { r.restrictions = [1]; }],
    ['reviews wrong type', (r) => { r.required_pull_request_reviews = 'x'; }],
  ])('rejects a malformed response: %s', (_name, mutate) => {
    const r = mutate === null ? null : recordedProtection();
    if (typeof mutate === 'function') mutate(r);
    const out = rollout.snapshotProtection(r, { repo: 'o/r', branch: 'dev', now: NOW });
    expect(out.ok).toBe(false);
    expect(out.snapshot).toBeUndefined();
    expect(out.problems.length).toBeGreaterThan(0);
  });

  test('rejects a bad repo, branch or timestamp', () => {
    expect(rollout.snapshotProtection(recordedProtection(), { repo: 'nope', branch: 'dev', now: NOW }).ok).toBe(false);
    expect(rollout.snapshotProtection(recordedProtection(), { repo: 'o/r', branch: '', now: NOW }).ok).toBe(false);
    expect(rollout.snapshotProtection(recordedProtection(), { repo: 'o/r', branch: 'dev', now: 'yesterday' }).ok).toBe(false);
  });
});

describe('planEnable / planRollback', () => {
  test('enable plan requires exactly the local status BY NAME (unpinned, written as -1) and drops hosted checks, preserving the rest', () => {
    const s = snap({ ...recordedProtection(), enforce_admins: { enabled: true }, required_pull_request_reviews: { required_approving_review_count: 2, url: 'u' }, restrictions: { users: [], teams: [{ slug: 'core' }], apps: [] } });
    const plan = rollout.planEnable({ snapshot: s, statusContext: CONTEXT, replaces: COVERED });
    expect(plan.ok).toBe(true);
    const change = plan.steps.filter((x) => x.changesProtection);
    expect(change).toHaveLength(1);
    expect(change[0]).toMatchObject({ method: 'PATCH', path: '/repos/o/r/branches/dev/protection/required_status_checks' });
    expect(change[0].body).toEqual({ strict: false, checks: [{ context: CONTEXT, app_id: -1 }] });
    expect(change[0].removes).toEqual(['validate', 'test (22)', 'test (24)']);
    // Only the checks endpoint is touched, so reviews/restrictions/enforce_admins stay as they were.
    expect(plan.steps.every((x) => !/enforce_admins|required_pull_request_reviews|restrictions/.test(x.path))).toBe(true);

    const fake = fakeGithub({ ...recordedProtection(), required_pull_request_reviews: { required_approving_review_count: 2 }, restrictions: { teams: [{ slug: 'core' }] } });
    fake.applyPlan(plan);
    expect(fake.store.required_pull_request_reviews).toEqual({ required_approving_review_count: 2 });
    expect(fake.store.restrictions).toEqual({ teams: [{ slug: 'core' }] });
    expect(fake.store.enforce_admins.enabled).toBe(true);
  });

  test('strict is preserved when true', () => {
    const r = recordedProtection();
    r.required_status_checks.strict = true;
    const plan = rollout.planEnable({ snapshot: snap(r), statusContext: CONTEXT, replaces: COVERED });
    expect(plan.steps[0].body.strict).toBe(true);
  });

  test('the local check is added UNPINNED: app_id null on read, written as -1 (any app); appId is neither required nor accepted', () => {
    const plan = rollout.planEnable({ snapshot: snap(), statusContext: CONTEXT, replaces: COVERED });
    expect(plan.ok).toBe(true);
    const body = plan.steps.find((x) => x.changesProtection).body;
    expect(body.checks).toEqual([{ context: CONTEXT, app_id: -1 }]);
    expect(JSON.stringify(plan)).not.toMatch(/"app_id":null/);
    // A leftover appId (a number, a placeholder, junk) cannot pin the check: it is ignored, never written.
    for (const appId of [15368, 424242, 'REPLACE_WITH_GITHUB_APP_ID', -1, 0, undefined]) {
      const again = rollout.planEnable({ snapshot: snap(), statusContext: CONTEXT, appId, replaces: COVERED });
      expect(again.ok).toBe(true);
      expect(again.steps.find((x) => x.changesProtection).body.checks).toEqual([{ context: CONTEXT, app_id: -1 }]);
    }
    // After GitHub stores it, the read side sees null again (so a later rollback snapshot is lossless).
    const fake = fakeGithub(recordedProtection());
    fake.applyPlan(plan);
    expect(fake.store.required_status_checks.checks).toEqual([{ context: CONTEXT, app_id: null }]);
  });

  test('refuses a missing status context or an invalid snapshot', () => {
    expect(rollout.planEnable({ snapshot: snap(), statusContext: '', replaces: COVERED }).ok).toBe(false);
    expect(rollout.planEnable({ snapshot: { repo: 'o/r' }, statusContext: CONTEXT }).ok).toBe(false);
    expect(rollout.planRollback({ snapshot: null }).ok).toBe(false);
  });

  test('the repo config carries no app_id key, so there is nothing to pin', () => {
    const raw = fs.readFileSync(REPO_CONFIG, 'utf8');
    expect(raw).not.toMatch(/^\s*app_id\s*:/m);
    expect(CONFIG.ok).toBe(true);
  });

  test('rollback plan restores the original checks with their original app ids', () => {
    const plan = rollout.planRollback({ snapshot: snap() });
    expect(plan.steps[0].body).toEqual({
      strict: false,
      checks: [{ context: 'validate', app_id: 15368 }, { context: 'test (22)', app_id: 15368 }, { context: 'test (24)', app_id: 15368 }],
    });
  });

  test('an any-app check (app_id null) is written back as -1 and round-trips', () => {
    const r = recordedProtection();
    r.required_status_checks.checks[0].app_id = null;
    const s = snap(r);
    expect(rollout.planRollback({ snapshot: s }).steps[0].body.checks[0]).toEqual({ context: 'validate', app_id: -1 });
    const fake = fakeGithub(r);
    fake.applyPlan(rollout.planEnable({ snapshot: s, statusContext: CONTEXT, replaces: COVERED }));
    fake.applyPlan(rollout.planRollback({ snapshot: s }));
    expect(snap(fake.store)).toEqual(s);
  });
});

describe('scenario: enable then rollback is lossless', () => {
  test.each([
    ['plain', (r) => r],
    ['strict, reviews and restrictions', (r) => {
      r.required_status_checks.strict = true;
      r.required_pull_request_reviews = { required_approving_review_count: 1, dismiss_stale_reviews: true, require_code_owner_reviews: false };
      r.restrictions = { users: [{ login: 'octo' }], teams: [], apps: [] };
      r.enforce_admins.enabled = false;
      return r;
    }],
  ])('%s', (_n, shape) => {
    const original = shape(recordedProtection());
    const s = snap(original);
    const fake = fakeGithub(original);

    fake.applyPlan(rollout.planEnable({ snapshot: s, statusContext: CONTEXT, replaces: COVERED }));
    // The enabled state really differs: otherwise the round trip would prove nothing.
    expect(snap(fake.store)).not.toEqual(s);
    expect(fake.store.required_status_checks.checks).toEqual([{ context: CONTEXT, app_id: null }]);

    fake.applyPlan(rollout.planRollback({ snapshot: s }));
    expect(snap(fake.store)).toEqual(s);
    expect(fake.store.required_status_checks.contexts).toEqual(original.required_status_checks.contexts);
  });
});

describe('scenario: hosted checks required again', () => {
  test('a rolled-back repository refuses a PR with no hosted CI success; the enabled one merges on the local status alone, whoever posted it', () => {
    const s = snap();
    const fake = fakeGithub(recordedProtection());
    const localOnly = [{ context: CONTEXT, state: 'success', app_id: 424242 }];

    fake.applyPlan(rollout.planEnable({ snapshot: s, statusContext: CONTEXT, replaces: COVERED }));
    expect(canMerge(fake.store, localOnly)).toBe(true);
    // The check is required by name, unpinned (honest-actor trust): a status from any poster satisfies it, and a
    // status with a different context does not.
    expect(canMerge(fake.store, [{ context: CONTEXT, state: 'success', app_id: 1 }])).toBe(true);
    expect(canMerge(fake.store, [{ context: 'some/other-check', state: 'success', app_id: 1 }])).toBe(false);

    fake.applyPlan(rollout.planRollback({ snapshot: s }));
    expect(canMerge(fake.store, localOnly)).toBe(false);
    const hosted = ['validate', 'test (22)', 'test (24)'].map((context) => ({ context, state: 'success', app_id: 15368 }));
    expect(canMerge(fake.store, hosted)).toBe(true);
    expect(canMerge(fake.store, hosted.slice(1))).toBe(false);
  });
});

describe('scenario: PR born approved (optional pre-PR gate step)', () => {
  afterAll(() => cleanupBaseRepos());

  function repoWithHead() {
    // trusted config committed at base; PR head is a descendant left checked out
    return makeBaseRepo({ config: fs.readFileSync(REPO_CONFIG, 'utf8') });
  }

  function fakeGithubStatuses() {
    const poster = fakePostStatus();
    const listed = (sha) => poster.calls.filter((c) => c.sha === sha).map((c) => ({ context: c.context, state: c.state, description: c.description, sha: c.sha }));
    const bySha = new Proxy({}, { get: (_t, sha) => listed(sha) });
    // what GitHub lists for a head: every post it accepted, NEWEST FIRST, with ids and without a per-status sha
    const ghApi = (apiPath) => {
      const m = /^repos\/[^/]+\/[^/]+\/commits\/([0-9a-f]{40})\/statuses\?per_page=100$/.exec(apiPath);
      if (!m) return { ok: false, error: `unexpected lookup: ${apiPath}` };
      const all = listed(m[1]);
      return { ok: true, json: all.map(({ sha: _sha, ...rest }, i) => ({ id: i + 1, ...rest })).reverse() };
    };
    return { postStatus: poster, bySha, ghApi };
  }

  async function gateThenOpenPr(repo, gh) {
    const deps = {
      ...cli.defaultDeps(),
      postStatus: gh.postStatus,
      ghApi: gh.ghApi,
      runGate: (o) => ({ ok: true, sha: o.headSha, failures: [], unmirrored: [], nodes: [{ node: 22, ok: true, steps: [] }] }),
      env: {},
      prInfo: prInfoFor(repo),
    };
    const run = await cli.runGateFlow(
      { repoRoot: repo.dir, baseRef: repo.baseRef, headSha: repo.headSha, repo: REPO, pr: PR },
      deps
    );
    return { run, deps };
  }

  test('the PR head already carries a verified status at open time, so the gate is merge-ready with no hosted CI', async () => {
    const repo = repoWithHead();
    const gh = fakeGithubStatuses();
    const { run, deps } = await gateThenOpenPr(repo, gh);
    expect(run).toMatchObject({ ok: true, posted: true });
    const prHead = repo.headSha; // the PR is opened for this exact head after the gate ran
    const ready = cli.runMerge({ headSha: prHead, repoRoot: repo.dir, baseRef: repo.baseRef, statuses: gh.bySha[prHead] || [], repo: REPO, pr: PR }, deps);
    expect(ready).toMatchObject({ mergeReady: true, hostedCiWaitRequired: false });
  });

  test('a PR whose head moved after the gate is not born approved', async () => {
    const repo = repoWithHead();
    const gh = fakeGithubStatuses();
    const { deps } = await gateThenOpenPr(repo, gh);
    repo.git('commit', '-q', '--allow-empty', '-m', 'moved head');
    const newHead = repo.git('rev-parse', 'HEAD');
    expect(newHead).not.toBe(repo.headSha);
    const ready = cli.runMerge({ headSha: newHead, repoRoot: repo.dir, baseRef: repo.baseRef, statuses: gh.bySha[newHead] || [], repo: REPO, pr: PR }, { ...deps, prInfo: prInfoFor({ headSha: newHead }) });
    expect(ready.mergeReady).toBe(false);
  });

  test('a failing gate does not leave a success status for the head', async () => {
    const repo = repoWithHead();
    const gh = fakeGithubStatuses();
    const deps = {
      ...cli.defaultDeps(),
      postStatus: gh.postStatus,
      ghApi: gh.ghApi,
      runGate: (o) => ({ ok: false, sha: o.headSha, failures: [{ workflow: 'ci.yml', job: 'test', step: 'x', node: 22, message: 'boom' }], unmirrored: [], nodes: [] }),
      env: {},
      prInfo: prInfoFor(repo),
    };
    await cli.runGateFlow({ repoRoot: repo.dir, baseRef: repo.baseRef, headSha: repo.headSha, repo: REPO, pr: PR }, deps);
    expect((gh.bySha[repo.headSha] || []).some((s) => s.state === 'success')).toBe(false);
    expect(cli.runMerge({ headSha: repo.headSha, repoRoot: repo.dir, baseRef: repo.baseRef, statuses: gh.bySha[repo.headSha] || [], repo: REPO, pr: PR }, deps).mergeReady).toBe(false);
  });
});

describe('scenario: enablement preconditions', () => {
  const dirs = [];
  afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

  const GOOD_MEASUREMENT = 'Verdict: faster\n';

  function fixture({ measurement = GOOD_MEASUREMENT, baseline = '# baseline\n' } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ci-precond-'));
    dirs.push(dir);
    const paths = { measurementNote: path.join(dir, 'm.md'), baselineNote: path.join(dir, 'b.md') };
    if (measurement !== null) fs.writeFileSync(paths.measurementNote, measurement);
    if (baseline !== null) fs.writeFileSync(paths.baselineNote, baseline);
    return paths;
  }
  const check = (paths, hasReportedSuccess = true) => rollout.checkEnablementPreconditions({ paths, hasReportedSuccess });

  test('no proof note exists or is mentioned: the App-pin proof is gone from the preconditions', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'docs', 'proofs', 'local-ci-app-pin-proof.md'))).toBe(false);
    for (const r of [
      rollout.checkEnablementPreconditions({ repoRoot: REPO_ROOT, hasReportedSuccess: true }),
      check(fixture(), false),
      check(fixture({ measurement: null, baseline: null }), false),
      rollout.checkEnablementPreconditions({}),
    ]) expect(reasonsOf(r)).not.toMatch(/proof|App-pin|\bApp\b/i);
  });

  test('a proofNote path is neither read nor required', () => {
    const paths = { ...fixture(), proofNote: '/nonexistent/proof.md' };
    expect(check(paths)).toEqual({ ok: true, reasons: [] });
  });

  test('against the real repository paths the measurement and baseline preconditions pass; only the success status remains', () => {
    const without = rollout.checkEnablementPreconditions({ repoRoot: REPO_ROOT, hasReportedSuccess: false });
    expect(without.ok).toBe(false);
    expect(reasonsOf(without)).toMatch(/seven days/);
    expect(reasonsOf(without)).not.toMatch(/measurement note|baseline note/);
    expect(rollout.checkEnablementPreconditions({ repoRoot: REPO_ROOT, hasReportedSuccess: true })).toEqual({ ok: true, reasons: [] });
  });

  test('measurement filled, baseline present and a reported success is the only way to ok', () => {
    expect(check(fixture())).toEqual({ ok: true, reasons: [] });
  });

  test('refuses when the measurement note is missing, unfilled or unmeasured', () => {
    for (const measurement of [null, 'TEMPLATE-UNFILLED\nVerdict: faster\n', 'Verdict: unmeasured\n']) {
      const r = check(fixture({ measurement }));
      expect(r.ok).toBe(false);
      expect(reasonsOf(r)).toMatch(/measurement note/);
    }
  });

  test('refuses until the local status has reported success, naming the seven-day rule', () => {
    for (const fact of [false, undefined, 'yes']) {
      const r = rollout.checkEnablementPreconditions({ paths: fixture(), hasReportedSuccess: fact });
      expect(r.ok).toBe(false);
      expect(reasonsOf(r)).toMatch(/seven days/);
    }
  });

  test('refuses when the baseline note is missing', () => {
    const r = check(fixture({ baseline: null }));
    expect(r.ok).toBe(false);
    expect(reasonsOf(r)).toMatch(/baseline note missing/);
  });

  test('collects every reason, not just the first', () => {
    const r = check(fixture({ measurement: null, baseline: null }), false);
    expect(r.reasons.length).toBeGreaterThanOrEqual(3);
  });

  test('nothing to resolve paths from refuses', () => {
    expect(rollout.checkEnablementPreconditions({}).ok).toBe(false);
  });
});

describe('owner approval', () => {
  test('every protection-changing step in the plans is marked as needing owner approval and is named in the approval list', () => {
    const s = snap();
    const steps = [
      ...rollout.planEnable({ snapshot: s, statusContext: CONTEXT, replaces: COVERED }).steps,
      ...rollout.planRollback({ snapshot: s }).steps,
    ];
    const changing = steps.filter((x) => x.changesProtection);
    expect(changing.length).toBe(2);
    for (const x of changing) {
      expect(x.requiresOwnerApproval).toBe(true);
      const entry = rollout.OWNER_APPROVALS.find((a) => a.step === x.id);
      expect(entry).toBeDefined();
      expect(entry.needed).toBe(true);
      expect(entry.approver).toMatch(/admin|owner/);
    }
    // read-only steps do not claim to need approval
    for (const x of steps.filter((y) => !y.changesProtection)) expect(x.method).toBe('GET');
  });
});

describe('the runbook names every owner-approved step', () => {
  test('RUNBOOK.md names each step the plans mark as needing owner approval', () => {
    const runbook = fs.readFileSync(path.join(__dirname, '..', 'skills', 'local-ci-gate', 'RUNBOOK.md'), 'utf8');
    for (const a of rollout.OWNER_APPROVALS) expect(runbook).toContain(a.step);
  });
});

describe('against a RECORDED real GitHub response (not a hand-written fixture)', () => {
  // GET /repos/Sunstone-Partners/ensemble/branches/dev/protection, recorded 2026-10-21. GitHub omits
  // required_pull_request_reviews and restrictions when they are not configured; a hand-written fixture
  // that sets them to null hid a bug where the real response was refused as malformed.
  const real = () =>
    JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'github-branch-protection-dev.recorded.json'), 'utf8'));

  test('the real response has no reviews or restrictions keys, and still snapshots', () => {
    const r = real();
    expect('required_pull_request_reviews' in r).toBe(false);
    expect('restrictions' in r).toBe(false);
    const out = rollout.snapshotProtection(r, { repo: 'Sunstone-Partners/ensemble', branch: 'dev', now: NOW });
    expect(out.problems).toBeUndefined();
    expect(out.ok).toBe(true);
    expect(out.snapshot.required_pull_request_reviews).toBeNull();
    expect(out.snapshot.restrictions).toBeNull();
    expect(out.snapshot.enforce_admins.enabled).toBe(true);
    expect(out.snapshot.required_status_checks.checks.map((c) => [c.context, c.app_id])).toEqual([
      ['validate', 15368],
      ['test (22)', 15368],
      ['test (24)', 15368],
    ]);
  });

  test('enable then rollback restores the real protection exactly', () => {
    const snap = rollout.snapshotProtection(real(), { repo: 'Sunstone-Partners/ensemble', branch: 'dev', now: NOW }).snapshot;
    const enable = rollout.planEnable({ snapshot: snap, statusContext: CONTEXT, replaces: COVERED });
    expect(enable.ok).toBe(true);
    const required = (steps) => steps.find((s) => s.method === 'PATCH').body.checks.map((c) => [c.context, c.app_id]);
    expect(required(enable.steps)).toEqual([[CONTEXT, -1]]);
    const rollback = rollout.planRollback({ snapshot: snap });
    expect(rollback.ok).toBe(true);
    expect(required(rollback.steps)).toEqual([
      ['validate', 15368],
      ['test (22)', 15368],
      ['test (24)', 15368],
    ]);
  });
});

describe('enable replaces only the checks the gate covers', () => {
  const real = () =>
    JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'github-branch-protection-dev.recorded.json'), 'utf8'));
  // The real protection plus two required checks the local gate does NOT run.
  const withExtras = () => {
    const r = real();
    r.required_status_checks.checks.push({ context: 'security/gitleaks', app_id: 15368 }, { context: 'deploy-preview', app_id: 99 });
    r.required_status_checks.contexts.push('security/gitleaks', 'deploy-preview');
    return rollout.snapshotProtection(r, { repo: 'o/r', branch: 'dev', now: NOW }).snapshot;
  };
  const patchChecks = (plan) => plan.steps.find((s) => s.method === 'PATCH').body.checks.map((c) => [c.context, c.app_id]);

  test('a required check the gate does not run stays required', () => {
    const plan = rollout.planEnable({ snapshot: withExtras(), statusContext: CONTEXT, replaces: COVERED });
    expect(plan.ok).toBe(true);
    expect(patchChecks(plan)).toEqual([
      ['security/gitleaks', 15368],
      ['deploy-preview', 99],
      [CONTEXT, -1],
    ]);
    expect(plan.keeps).toEqual(['security/gitleaks', 'deploy-preview']);
  });

  test('the covered hosted checks are the ones removed, and the plan says so', () => {
    const plan = rollout.planEnable({ snapshot: withExtras(), statusContext: CONTEXT, replaces: COVERED });
    expect(plan.steps.find((s) => s.method === 'PATCH').removes).toEqual(COVERED);
  });

  test('a name in replaces that is not currently required is refused, not ignored', () => {
    const plan = rollout.planEnable({ snapshot: withExtras(), statusContext: CONTEXT, replaces: ['validate', 'tset (22)'] });
    expect(plan.ok).toBe(false);
    expect(plan.problems.join(' ')).toMatch(/tset \(22\)/);
    expect(plan.steps).toBeUndefined();
  });

  test.each([
    ['missing', undefined],
    ['empty', []],
    ['not a list', 'validate'],
    ['blank entry', ['validate', '  ']],
  ])('replaces %s is refused', (_n, replaces) => {
    const plan = rollout.planEnable({ snapshot: withExtras(), statusContext: CONTEXT, replaces });
    expect(plan.ok).toBe(false);
    expect(plan.steps).toBeUndefined();
  });

  test('rollback restores the unrelated checks too (enable then rollback is lossless with extras)', () => {
    const snap = withExtras();
    const rollback = rollout.planRollback({ snapshot: snap });
    expect(patchChecks(rollback)).toEqual([
      ['validate', 15368],
      ['test (22)', 15368],
      ['test (24)', 15368],
      ['security/gitleaks', 15368],
      ['deploy-preview', 99],
    ]);
  });
});

describe('the rollout subcommand of the gate CLI (how an installed copy reaches the library)', () => {
  const { spawnSync } = require('child_process');
  const CLI = path.join(__dirname, '..', 'lib', 'local-ci-cli.js');
  const call = (payload) => {
    const r = spawnSync(process.execPath, [CLI, 'rollout'], { input: JSON.stringify(payload), encoding: 'utf8' });
    return { code: r.status, out: JSON.parse(r.stdout) };
  };
  const realResponse = () =>
    JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'github-branch-protection-dev.recorded.json'), 'utf8'));

  test('snapshot, plan-enable and plan-rollback round-trip the real protection through the CLI', () => {
    const snap = call({ action: 'snapshot', input: { response: realResponse(), repo: 'Sunstone-Partners/ensemble', branch: 'dev', now: NOW } });
    expect(snap.code).toBe(0);
    expect(snap.out.ok).toBe(true);
    const enable = call({ action: 'plan-enable', input: { snapshot: snap.out.snapshot, statusContext: CONTEXT, replaces: COVERED } });
    expect(enable.code).toBe(0);
    expect(enable.out.steps.find((s) => s.method === 'PATCH').body.checks).toEqual([{ context: CONTEXT, app_id: -1 }]);
    const back = call({ action: 'plan-rollback', input: { snapshot: snap.out.snapshot } });
    expect(back.out.steps.find((s) => s.method === 'PATCH').body.checks.map((c) => c.context)).toEqual(COVERED);
  });

  test('preconditions through the CLI: exit 1 with the seven-day reason until a success is reported, exit 0 once it is', () => {
    const refused = call({ action: 'preconditions', input: { repoRoot: REPO_ROOT, hasReportedSuccess: false } });
    expect(refused.code).toBe(1);
    expect(refused.out.ok).toBe(false);
    expect(refused.out.reasons.join(' ')).toMatch(/seven days/i);
    expect(refused.out.reasons.join(' ')).not.toMatch(/proof|measurement|baseline/i); // the real notes are filled
    const ok = call({ action: 'preconditions', input: { repoRoot: REPO_ROOT, hasReportedSuccess: true } });
    expect(ok.code).toBe(0);
    expect(ok.out).toEqual({ ok: true, reasons: [] });
  });

  test('an inherited or unknown action is rejected, and a missing input is rejected', () => {
    expect(call({ action: 'constructor', input: {} }).code).toBe(1);
    expect(call({ action: 'snapshot' }).code).toBe(1);
  });

  test('plan-enable through the CLI needs no app id and writes the check unpinned (-1)', () => {
    const snap = call({ action: 'snapshot', input: { response: realResponse(), repo: 'o/r', branch: 'dev', now: NOW } }).out.snapshot;
    const r = call({ action: 'plan-enable', input: { snapshot: snap, statusContext: CONTEXT, appId: 'REPLACE_WITH_GITHUB_APP_ID', replaces: COVERED } });
    expect(r.code).toBe(0);
    expect(r.out.steps.find((x) => x.method === 'PATCH').body.checks).toEqual([{ context: CONTEXT, app_id: -1 }]);
  });
});
