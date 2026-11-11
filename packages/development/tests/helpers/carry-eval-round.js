'use strict';

/**
 * Simulates one carry round over the committed review-eval baseline (kata qw98, AC4).
 *
 * The baseline findings are what a full re-review reports. Here they are prior verdicts settled at `priorHead`, a fix push
 * changes `deltaPaths`, and `planCarry` decides what is carried and what is verified again. Verifiers are simulated: every
 * finding that goes to `reverify` is re-confirmed (the defect is still in the code), so a round's output is the carried
 * findings as they were plus the re-verified ones. A finding that is in neither list is DROPPED, which is what the quality
 * guard must never see.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { planCarry } = require('../../lib/pr-review-carry');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const EVAL_DIR = path.join(REPO_ROOT, 'docs', 'review-eval');

const PRIOR_HEAD = '1'.repeat(40);
const NEW_HEAD = '2'.repeat(40);
const BASE = '3'.repeat(40);
const PR = '268';

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const fileOf = (finding) => finding.locationOrLink.split(':')[0];
const lineOf = (finding) => finding.locationOrLink.split(':')[1];

function loadBaseline() {
  return JSON.parse(fs.readFileSync(path.join(EVAL_DIR, 'baselines', 'deep-review-reconstructed.json'), 'utf8'));
}

function loadCases() {
  const dir = path.join(EVAL_DIR, 'cases');
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
}

const hunkHashOf = (finding, changedHunkFiles) =>
  sha(`${changedHunkFiles.includes(fileOf(finding)) ? 'changed:' : ''}${fileOf(finding)}:${lineOf(finding)}:${finding.claim}`);

/**
 * @param {{findingsByCase:Object<string,Object[]>, deltaPaths:string[], highPaths?:string[], changedHunkFiles?:string[], deltaPlan?:Object}} scenario
 * @returns {{plan:Object, findingsByCase:Object<string,Object[]>, dropped:string[], flat:Object[]}}
 */
function simulateCarryRound(scenario) {
  const { findingsByCase, deltaPaths, highPaths = [], changedHunkFiles = [] } = scenario;
  const deltaPlan = scenario.deltaPlan || { mode: 'delta', readSet: deltaPaths.map((path) => ({ path, reasons: ['changed'] })) };
  const flat = Object.values(findingsByCase).flat();
  const votes = [
    { verifier: 'verifier-1', verdict: 'real' },
    { verifier: 'verifier-2', verdict: 'real' },
    { verifier: 'verifier-3', verdict: 'not-real' },
  ];
  const lineAt = (finding) => [Number(lineOf(finding)), Number(lineOf(finding))];
  const priorVerdicts = flat.map((finding) => ({
    id: finding.id,
    file: fileOf(finding),
    claim: finding.claim,
    lines: lineAt(finding),
    hunkHash: hunkHashOf(finding, []),
    depHashes: {},
    head: PRIOR_HEAD,
    outcome: 'present',
    votes,
    prId: PR,
    baseSha: BASE,
    depth: 'standard',
    expectedVerifiers: 3,
  }));
  const priorLedger = flat.map((finding) => ({ id: finding.id, locationOrLink: finding.locationOrLink, failureMode: finding.claim }));
  const candidates = flat.map((finding) => ({
    id: finding.id,
    file: fileOf(finding),
    claim: finding.claim,
    lines: lineAt(finding),
    hunkHash: hunkHashOf(finding, changedHunkFiles),
    depHashes: {},
    dependents: [],
    headSha: NEW_HEAD,
  }));
  const plan = planCarry({
    prId: PR, baseSha: BASE, headSha: NEW_HEAD, lastReviewedSha: PRIOR_HEAD, depth: 'standard', deltaPlan, deltaPaths,
    deltaRange: { headSha: NEW_HEAD, lastReviewedSha: PRIOR_HEAD }, highPaths, priorVerdicts, priorLedger, candidates,
  });

  const carriedIds = new Set(plan.carried.map((record) => record.id));
  const reverifyIds = new Set(plan.reverify.map((entry) => entry.id));
  const dropped = [];
  const out = {};
  for (const [caseId, findings] of Object.entries(findingsByCase)) {
    out[caseId] = [];
    for (const finding of findings) {
      // carried: kept as it was recorded; reverify: the simulated verifiers re-confirm it.
      if (carriedIds.has(finding.id) || reverifyIds.has(finding.id)) out[caseId].push(finding);
      else dropped.push(finding.id);
    }
  }
  return { plan, findingsByCase: out, dropped, flat };
}

module.exports = { simulateCarryRound, loadBaseline, loadCases, fileOf, PRIOR_HEAD, NEW_HEAD, sha };
