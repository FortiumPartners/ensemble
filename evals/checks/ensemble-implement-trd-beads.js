#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `ensemble-implement-trd-beads-plan` eval (PLAN-ONLY scope: Phase 1 preflight and Phase 2 scaffold of
 * `/ensemble-development:ensemble:implement-trd-beads <trd> --plan --foreman`; execution, quality gates and completion are NOT evaluated).
 * Built on ./lib (fs and path only for everything read from the workspace). Run from the agent's workspace; the sandbox root above it holds
 * `origin.git` and `gh-calls.log` (written by the fixture's stub gh).
 *
 * WHERE THE EXPECTATIONS COME FROM. Never hard-coded: `expected()` runs the repo's own trd-cli (`runScaffoldPlan`, `runPrPlan`, called
 * in-process; repo code, not workspace code; its one `git` spawn is disabled, see expected()) on the PRISTINE fixture TRD under evals/skills/ensemble-implement-trd-beads/fixture/, not on the workspace
 * copy the agent could have edited. The skill itself says the scaffold-plan is authoritative and never re-derived, so the plan is the
 * ground truth for bead titles, types and edges.
 *
 * HOW THE BEADS ARE READ. `br` is NOT run (a check never runs workspace-reachable programs, and the check environment has a throwaway
 * HOME). `br` auto-flushes `.beads/issues.jsonl` after each mutation and the skill ends step 2.1 with `tracker.sync` (`br sync --flush-only`),
 * so the JSONL export is read: one issue per line, `labels` array, `dependencies: [{issue_id, depends_on_id, type}]` where
 * `issue_id` is the DEPENDENT bead (`br dep add <id> <depends-on-id>`; the skill's `tracker.dep-add --arg id=<blocked> --arg dependsOnId=<blocker>`).
 * Probed with br 0.6.0. If a future br stops auto-flushing, every bead check fails with "no beads exported", which is a harness problem
 * not a skill failure (flaky-by-environment, listed below).
 *
 * ROBUST (deterministic given the agent followed the skill): bead-hierarchy, bead-types, beads-untouched, no-product-code, gh-readonly,
 * nothing-pushed (plus the harness's own noProtectedBranchCommit / remoteBranchUnchanged on main).
 * ROBUST BUT DEPENDS ON THE SKILL REALLY SCAFFOLDING THROUGH THE ADAPTER: bead-edges (a skipped `tracker.dep-add` after an `unavailable`
 * warning would fail it, and that is a real outcome worth failing), preflight-artifact (the toolchain-cli `preflight` call writes
 * `.ensemble/state/toolchain/preflight-<runId>.json`; probed, but a skill that preflighted differently would fail it).
 * FLAKIER (LLM-dependent or depends on skill details): foreman-tags (task tagging after work-graph.plan succeeds; an unavailable
 * work-graph skips it), feature-branch (exact HEAD and the "only main and PR1 branches" rule: the skill creates only the first stacked
 * branch, the later ones at the phase gate; a model that switched back to main after scaffolding would fail the HEAD half).
 */

const fs = require('fs');
const path = require('path');
const { fail, readText, walk, run } = require('./lib');

const REPO = path.resolve(__dirname, '../..');
const FIXTURE = path.join(REPO, 'evals', 'skills', 'ensemble-implement-trd-beads', 'fixture');
const TRD_REL = 'docs/TRD/TRD-2026-b1c2d3e4-slugify.md';
const SOURCE_DIRS = ['bin', 'scripts', 'src']; // must be byte-identical to the fixture
const SOURCE_FILES = ['package.json', 'README.md', '.gitignore'];
const ALLOWED_TOP = new Set(['docs', '.beads', '.ensemble']); // the only places a plan run may add or change files
const DOC_EXT = /\.(md|json|jsonl|ya?ml|txt)$/i;

/** The ground truth from the repo's trd-cli on the pristine fixture TRD. */
function expected() {
  const cli = require(path.join(REPO, 'packages', 'development', 'lib', 'trd-cli.js'));
  const trd = path.join(FIXTURE, TRD_REL);
  // trd-cli resolves the repo root with `git rev-parse --show-toplevel` in the cwd (and falls back to the cwd). A check must never run git in
  // the agent's workspace, so the in-process call runs from the pristine fixture directory with PATH emptied: that spawn then cannot start
  // (ENOENT, handled by trd-cli) and nothing but the fixture TRD is read. Titles, types and edges do not depend on the root.
  const cwd = process.cwd();
  const pathEnv = process.env.PATH;
  let sp;
  let pp;
  try {
    process.chdir(FIXTURE);
    process.env.PATH = '';
    sp = cli.runScaffoldPlan([trd]);
    pp = cli.runPrPlan([trd, '--stacked']);
  } finally {
    process.env.PATH = pathEnv;
    process.chdir(cwd);
  }
  if (!sp || sp.ok !== true) fail('trd-cli scaffold-plan failed on the fixture TRD (eval fixture broken)');
  if (!pp || pp.ok !== true) fail('trd-cli pr-plan failed on the fixture TRD (eval fixture broken)');
  const plan = sp.plan;
  const beads = [
    { ...plan.epic, kind: 'epic' },
    ...plan.stories.map((s) => ({ ...s, kind: 'story' })),
    ...plan.tasks.map((t) => ({ ...t, kind: 'task' })),
    ...(plan.synthesizedTests || []).map((t) => ({ ...t, kind: 'task' })),
  ];
  return { slug: sp.slug, plan, beads, firstBranch: pp.branchFirst, parent: pp.actions[0].parentBranch };
}

/** Exported issues of the workspace's br database: [{id, title, status, issue_type, labels, dependencies}]. */
function issues() {
  const text = readText('.beads/issues.jsonl');
  if (text === null || text.trim() === '') return fail('no beads exported (.beads/issues.jsonl is missing or empty): no bead was created, or the tracker was not flushed');
  const out = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let o;
    try { o = JSON.parse(line); } catch { return fail('.beads/issues.jsonl has a line that is not JSON'); }
    if (o && typeof o === 'object' && typeof o.id === 'string' && typeof o.title === 'string') out.push(o);
  }
  return out;
}

/** The single exported issue whose title starts with the plan entry's titlePrefix; fails on none or several. */
function findBead(all, entry) {
  const hits = all.filter((i) => i.title.startsWith(entry.titlePrefix));
  if (hits.length === 0) return fail(`no bead with title prefix ${entry.titlePrefix}`);
  if (hits.length > 1) return fail(`${hits.length} beads share title prefix ${entry.titlePrefix} (duplicates)`);
  return hits[0];
}

/** SHA of a ref (`refs/heads/x`) in a git dir: loose file first, then packed-refs; null when absent. */
function refSha(gitDir, ref) {
  const loose = readText(path.join(gitDir, ref));
  if (loose !== null && /^[0-9a-f]{40}/.test(loose.trim())) return loose.trim().slice(0, 40);
  const packed = readText(path.join(gitDir, 'packed-refs'));
  if (packed === null) return null;
  for (const line of packed.split('\n')) {
    const m = /^([0-9a-f]{40}) (\S+)$/.exec(line.trim());
    if (m && m[2] === ref) return m[1];
  }
  return null;
}

/** Branch names under refs/heads of a git dir (loose and packed), sorted. */
function branchNames(gitDir) {
  const names = new Set();
  const root = path.join(gitDir, 'refs', 'heads');
  if (fs.existsSync(root)) for (const f of walk(root)) names.add(f);
  const packed = readText(path.join(gitDir, 'packed-refs'));
  if (packed !== null) {
    for (const line of packed.split('\n')) {
      const m = /^[0-9a-f]{40} refs\/heads\/(\S+)$/.exec(line.trim());
      if (m) names.add(m[1]);
    }
  }
  return [...names].sort();
}

const CHECKS = {
  // ROBUST-ish. Phase 1.2 runs `toolchain-cli preflight`, which writes a preflight record the skill's later calls reference by run id.
  'preflight-artifact': () => {
    const dir = '.ensemble/state/toolchain';
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => /^preflight-[\w-]+\.json$/.test(n)); } catch { /* absent */ }
    if (names.length === 0) fail('no .ensemble/state/toolchain/preflight-*.json: the toolchain preflight (step 1.2) did not run');
    for (const n of names) {
      let j;
      try { j = JSON.parse(readText(`${dir}/${n}`) || ''); } catch { continue; }
      if (j && j.ok === true && Array.isArray(j.categories) && j.categories.includes('tracker')) return `preflight ok (${n})`;
    }
    return fail('a preflight record exists but none is ok:true covering the tracker category');
  },

  // ROBUST. Exactly the beads of the scaffold plan: one epic, one story per PR, one task bead per TRD task, no duplicates, no extras.
  'bead-hierarchy': () => {
    const exp = expected();
    const all = issues();
    for (const entry of exp.beads) findBead(all, entry);
    if (all.length !== exp.beads.length) {
      const known = new Set(exp.beads.map((e) => findBead(all, e).id));
      const extra = all.find((i) => !known.has(i.id));
      fail(`${all.length} beads, the plan has ${exp.beads.length}${extra ? `; unexpected bead "${extra.title}"` : ''}`);
    }
    const n = (k) => exp.beads.filter((b) => b.kind === k).length;
    return `${n('epic')} epic, ${n('story')} stories, ${n('task')} tasks (${exp.beads.length} beads) match the scaffold plan`;
  },

  // ROBUST. Epic -> epic, story -> feature, task -> task, as the plan says.
  'bead-types': () => {
    const exp = expected();
    const all = issues();
    for (const entry of exp.beads) {
      const b = findBead(all, entry);
      if (b.issue_type !== entry.type) fail(`${entry.titlePrefix} has type ${b.issue_type}, the plan says ${entry.type}`);
    }
    return 'every bead has the planned type';
  },

  // ROBUST given tracker.dep-add worked. Every planned edge exists with the planned direction (dependent = blockedId, depends_on = blockerId):
  // story-blocks-epic, task-blocks-story (task -> its story) and task-depends (task -> task) edges.
  'bead-edges': () => {
    const exp = expected();
    const all = issues();
    const byPrefix = new Map(exp.beads.map((e) => [e.titlePrefix, findBead(all, e)]));
    let n = 0;
    for (const d of exp.plan.deps) {
      const blocked = byPrefix.get(d.blockedId);
      const blocker = byPrefix.get(d.blockerId);
      if (!blocked || !blocker) fail(`plan edge names an unknown bead (${d.blockerId} -> ${d.blockedId}); eval fixture inconsistent`);
      const deps = Array.isArray(blocked.dependencies) ? blocked.dependencies : [];
      if (!deps.some((x) => x && x.depends_on_id === blocker.id && x.type === 'blocks')) fail(`missing edge: ${d.blockedId} must depend on ${d.blockerId} (${d.type})`);
      n += 1;
    }
    return `${n} planned dependency edges present`;
  },

  // ROBUST. Plan scope never starts work: every bead is still open (none claimed, closed or commented into a state).
  'beads-untouched': () => {
    const bad = issues().find((i) => i.status !== 'open');
    if (bad) fail(`bead "${bad.title.slice(0, 80)}" is ${bad.status}; a plan-only run starts no work`);
    return 'every bead is open';
  },

  // FLAKIER. `--foreman` tags TASK beads `foreman-exec` after work-graph.plan succeeds; never epic or stories. All tasks or none (a partial tag
  // set is the skill's own "tagging incomplete" HALT).
  'foreman-tags': () => {
    const exp = expected();
    const all = issues();
    const has = (b) => Array.isArray(b.labels) && b.labels.includes('foreman-exec');
    const tasks = exp.beads.filter((e) => e.kind === 'task').map((e) => findBead(all, e));
    const others = exp.beads.filter((e) => e.kind !== 'task').map((e) => findBead(all, e));
    const wrong = others.find(has);
    if (wrong) fail(`foreman-exec was put on a non-task bead: ${wrong.title.slice(0, 80)}`);
    const tagged = tasks.filter(has).length;
    if (tagged !== 0 && tagged !== tasks.length) fail(`foreman-exec on ${tagged} of ${tasks.length} task beads (tagging incomplete)`);
    return tagged === 0 ? 'no task tagged (work-graph unavailable is tolerated)' : `all ${tagged} task beads tagged foreman-exec, no other bead`;
  },

  // ROBUST for existence and base; HEAD half and the exact branch set are FLAKIER (see header). Read from .git without running git.
  'feature-branch': () => {
    const exp = expected();
    const gitDir = '.git';
    const sha = refSha(gitDir, `refs/heads/${exp.firstBranch}`);
    if (sha === null) fail(`branch ${exp.firstBranch} was not created`);
    const main = refSha(gitDir, `refs/heads/${exp.parent}`);
    if (main === null) fail(`${exp.parent} is missing`);
    // At plan scope nothing is committed on the branch, so a branch created from the right base points at main's own commit.
    if (sha !== main) fail(`${exp.firstBranch} (${sha.slice(0, 8)}) is not at ${exp.parent} (${main.slice(0, 8)}): wrong base, or a commit was made at plan scope`);
    const head = (readText(`${gitDir}/HEAD`) || '').trim();
    if (head !== `ref: refs/heads/${exp.firstBranch}`) fail(`HEAD is "${head.slice(0, 80)}", not on ${exp.firstBranch}`);
    const names = branchNames(gitDir);
    const extra = names.filter((b) => b !== exp.parent && b !== exp.firstBranch);
    if (extra.length > 0) fail(`unexpected branch(es) at plan scope: ${extra.join(', ').slice(0, 120)}`);
    return `${exp.firstBranch} created from ${exp.parent} and checked out`;
  },

  // ROBUST. No product code: outside docs/, .beads/ and .ensemble/ the workspace is byte-identical to the fixture (nothing added, changed
  // or removed); under docs/ only documentation-type files.
  'no-product-code': () => {
    const files = walk('.');
    for (const f of files) {
      const top = f.split('/')[0];
      if (ALLOWED_TOP.has(top)) {
        if (top === 'docs' && !DOC_EXT.test(f)) fail(`non-documentation file written under docs/: ${f}`);
        continue;
      }
      const inFixture = SOURCE_DIRS.includes(top) || SOURCE_FILES.includes(f);
      if (!inFixture) fail(`file outside docs/.beads/.ensemble written by a plan run: ${f}`);
      const want = readText(path.join(FIXTURE, f));
      if (want === null) fail(`new file in a source directory: ${f}`);
      if (readText(f) !== want) fail(`source file changed: ${f}`);
    }
    for (const f of [...SOURCE_FILES, ...walk(FIXTURE).filter((x) => SOURCE_DIRS.includes(x.split('/')[0]))]) {
      if (readText(f) === null) fail(`fixture file removed: ${f}`);
    }
    return 'only docs/.beads/.ensemble differ from the fixture';
  },

  // ROBUST. The stub gh logs every call; at plan scope nothing is published, so only reads are allowed: --version, auth status, repo view,
  // pr list/view/checks. `pr create` (and merge/comment/edit/api) is a mutation or out of scope. No log means no gh call: fine.
  'gh-readonly': () => {
    const log = readText('../gh-calls.log');
    if (log === null) return 'gh was never called';
    const lines = log.split('\n').filter((l) => l.trim() !== '');
    for (const l of lines) {
      const t = l.trim();
      if (/^(--version|auth status|repo view|pr list|pr view|pr checks)(\s|$)/.test(t) && !/-X\s*(POST|PATCH|PUT|DELETE)|--method/i.test(t)) continue;
      return fail(`gh call outside the plan-scope reads: gh ${t.slice(0, 120)}`);
    }
    return `${lines.length} gh call(s), all reads`;
  },

  // ROBUST. Nothing was pushed: the bare origin holds only main (the first branch is pushed at the phase gate, outside this scope).
  'nothing-pushed': () => {
    const names = branchNames('../origin.git');
    if (names.length === 0) fail('origin.git has no branches (sandbox not as expected)');
    const extra = names.filter((b) => b !== 'main');
    if (extra.length > 0) fail(`branch(es) pushed at plan scope: ${extra.join(', ').slice(0, 120)}`);
    return 'origin holds only main';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS, expected };
