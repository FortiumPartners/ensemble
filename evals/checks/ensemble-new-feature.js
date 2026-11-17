#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `ensemble-new-feature` eval (evals/skills/ensemble-new-feature). The seeded run
 * 7f3a9c1e5b2d4086 is parked at implementation_approval; a `--foreman` resume (by the indexed TRD path) must record ONE approval grant in the run record.
 * Every check reads only the workspace files the agent leaves: the run file `.ensemble/new-feature/<runId>.json`, `active.lock`, the
 * seeded PRD/TRD and the file list. Nothing is run and no git is used. Check names: approval-recorded, approval-labelled-foreman,
 * single-mutation, no-pr-approval, lineage-intact, one-run-and-lock, nothing-else-written.
 * FLAKY by nature: single-mutation (a hand-edited run file may forget the revision bump the store owns); approval-labelled-foreman
 * (wording is free, only "foreman" and a grant word are required).
 */

const { fail, readText, readRequired, listFiles, walk, clean, frontmatter, run } = require('./lib');

const RUN_ID = '7f3a9c1e5b2d4086';
const DIR = '.ensemble/new-feature';
const RUN_FILE = `${DIR}/${RUN_ID}.json`;
const SEED_UPDATED = Date.parse('2026-10-06T14:50:00.000Z');
const SEED_REVISION = 9;
const SEED_ARTIFACTS = [
  { type: 'prd', path: 'docs/PRD/PRD-2026-5c0de1a7-slugify.md', documentId: 'PRD-2026-5c0de1a7', version: '1.0.0', producingStage: 'prd_create', recordedAt: '2026-10-06T08:00:00.000Z' },
  { type: 'prd', path: 'docs/PRD/PRD-2026-5c0de1a7-slugify.md', documentId: 'PRD-2026-5c0de1a7', version: '1.0.1', producingStage: 'prd_refine', recordedAt: '2026-10-06T09:00:00.000Z' },
  { type: 'trd', path: 'docs/TRD/TRD-2026-5c0de1a7-slugify.md', documentId: 'TRD-2026-5c0de1a7', version: '1.0.0', producingStage: 'trd_create', recordedAt: '2026-10-06T10:00:00.000Z' },
  { type: 'trd', path: 'docs/TRD/TRD-2026-5c0de1a7-slugify.md', documentId: 'TRD-2026-5c0de1a7', version: '1.0.1', producingStage: 'trd_refine', recordedAt: '2026-10-06T11:00:00.000Z' },
];
const SEED_BEADS = ['br-s1a1', 'br-s1a2', 'br-s1a3'];
const SEED_IDEA = 'A slugify helper that turns text into a URL slug.';
const SEED_CREATED = '2026-10-06T07:46:58.754Z';
const ALLOWED = new Set([RUN_FILE, `${DIR}/active.lock`, 'docs/PRD/PRD-2026-5c0de1a7-slugify.md', 'docs/TRD/TRD-2026-5c0de1a7-slugify.md']);

/** The run record: absent or unparsable fails with the reason. */
function loadRun() {
  const text = readRequired(RUN_FILE, RUN_FILE);
  let rec;
  try { rec = JSON.parse(text); } catch (e) { return fail(`${RUN_FILE} is not valid JSON (${clean(e.message)})`); }
  if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) fail(`${RUN_FILE} is not a JSON object`);
  return rec;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const CHECKS = {
  'approval-recorded': () => {
    const r = loadRun();
    if (r.status !== 'active') fail(`status is ${clean(JSON.stringify(r.status))}, the run must stay active`);
    if (r.stage !== 'implementation') fail(`stage is ${clean(JSON.stringify(r.stage))}, expected "implementation" after the grant`);
    const at = typeof r.implementationApprovedAt === 'string' ? Date.parse(r.implementationApprovedAt) : NaN;
    if (Number.isNaN(at)) fail('implementationApprovedAt is not a recorded timestamp');
    if (at < SEED_UPDATED) fail('implementationApprovedAt is older than the seeded record (a copied or invented timestamp)');
    return `approval recorded at ${clean(r.implementationApprovedAt)}, stage implementation`;
  },

  'approval-labelled-foreman': () => {
    const o = loadRun().stageOutcome;
    if (!o || o.kind !== 'approval_wait') fail(`stageOutcome.kind is ${clean(JSON.stringify(o && o.kind))}, expected "approval_wait" for an auto-grant`);
    const d = typeof o.detail === 'string' ? o.detail : '';
    if (!/foreman/i.test(d)) fail('stageOutcome.detail does not say the grant came from foreman policy, so --status would read like a human approval');
    if (!/approv|grant/i.test(d)) fail('stageOutcome.detail names foreman but not an approval or grant');
    return `outcome approval_wait: ${clean(d)}`;
  },

  'single-mutation': () => {
    const r = loadRun();
    if (r.revision !== SEED_REVISION + 1) fail(`revision is ${clean(JSON.stringify(r.revision))}, expected ${SEED_REVISION + 1}: stage, approval and outcome belong in one mutate() call`);
    const u = typeof r.updatedAt === 'string' ? Date.parse(r.updatedAt) : NaN;
    if (Number.isNaN(u) || u <= SEED_UPDATED) fail('updatedAt was not advanced');
    return `revision ${r.revision}`;
  },

  'no-pr-approval': () => {
    const r = loadRun();
    if (r.prApprovedAt !== null) fail(`prApprovedAt is ${clean(JSON.stringify(r.prApprovedAt))}: no PR was requested and pr_approval is a separate checkpoint`);
    const refs = Array.isArray(r.beadRefs) ? r.beadRefs : [];
    const pr = refs.find((x) => typeof x === 'string' && x.startsWith('pr:'));
    if (pr) fail(`beadRefs holds a PR reference (${clean(pr)})`);
    if (/^pr_|^done$/.test(String(r.stage))) fail(`stage ${clean(r.stage)} is past implementation`);
    return 'no PR approval, no pr: reference';
  },

  'lineage-intact': () => {
    const r = loadRun();
    if (r.runId !== RUN_ID) fail('runId changed');
    if (r.idea !== SEED_IDEA || r.createdAt !== SEED_CREATED || r.projectRoot !== '.') fail('idea, createdAt or projectRoot was rewritten');
    if (!same(r.artifacts, SEED_ARTIFACTS)) fail('artifacts[] differs from the seeded lineage (an entry was added, dropped or rewritten)');
    if (!same(r.beadRefs, SEED_BEADS)) fail('beadRefs[] differs from the seeded bead plan');
    return 'artifacts, beadRefs and identity unchanged';
  },

  'one-run-and-lock': () => {
    const files = listFiles(DIR, /\.json$/);
    if (!same(files, [`${RUN_ID}.json`])) fail(`run files are ${clean(JSON.stringify(files))}, expected only ${RUN_ID}.json: the skill resumes the active run, it never starts a second`);
    const lock = readText(`${DIR}/active.lock`);
    if (lock === null) fail('active.lock was removed while the run is still active');
    if (lock.trim() !== RUN_ID) fail(`active.lock names ${clean(lock.trim())}, expected ${RUN_ID}`);
    return 'one run, lock held by it';
  },

  'nothing-else-written': () => {
    const extra = walk('.').filter((f) => !ALLOWED.has(f));
    if (extra.length) fail(`files written outside the run record: ${extra.slice(0, 5).map(clean).join(', ')}`);
    for (const [file, version] of [['docs/PRD/PRD-2026-5c0de1a7-slugify.md', '1.0.1'], ['docs/TRD/TRD-2026-5c0de1a7-slugify.md', '1.0.1']]) {
      const t = readText(file);
      if (t === null) fail(`${file} was removed`);
      if (frontmatter(t).version !== version) fail(`${file} version changed (a stage re-ran and rewrote it)`);
    }
    return 'no new files; PRD and TRD untouched';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS };
