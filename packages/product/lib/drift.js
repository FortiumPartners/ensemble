'use strict';

/**
 * Drift detection between a PRD's current acceptance criteria and a previously
 * generated traceability manifest (`.prd-trace.json`).
 *
 * Pure comparison — no disk access. Identity is the AC id; the fingerprint is
 * feature-gen.hashAc (same normalization used at generation time), so cosmetic
 * edits don't register as drift but semantic edits do.
 */

const { hashAc } = require('./feature-gen');

/**
 * @param {import('./prd-parser').ParsedPRD} prd  freshly parsed PRD
 * @param {Object} manifest  parsed .prd-trace.json
 * @returns {{
 *   inSync: boolean,
 *   added: string[],     // AC ids in PRD but not manifest
 *   removed: string[],   // AC ids in manifest but not PRD
 *   changed: string[],   // AC ids in both whose hash differs
 *   prdMismatch: boolean // manifest was generated from a different PRD doc id
 * }}
 */
function diffDrift(prd, manifest) {
  const manifestAcs = (manifest && manifest.acs) || {};

  const currentById = {};
  for (const req of prd.reqs || []) {
    for (const ac of req.acs || []) currentById[ac.id] = ac;
  }

  const currentIds = Object.keys(currentById);
  const manifestIds = Object.keys(manifestAcs);

  const added = currentIds.filter((id) => !(id in manifestAcs)).sort();
  const removed = manifestIds.filter((id) => !(id in currentById)).sort();
  const changed = currentIds
    .filter((id) => id in manifestAcs)
    .filter((id) => hashAc(currentById[id]) !== manifestAcs[id].hash)
    .sort();

  const manifestDocId = manifest && manifest.prd && manifest.prd.document_id;
  const prdMismatch =
    !!manifestDocId && !!prd.documentId && manifestDocId !== prd.documentId;

  const inSync =
    !prdMismatch && added.length === 0 && removed.length === 0 && changed.length === 0;

  return {
    inSync,
    added,
    removed,
    changed,
    prdMismatch,
  };
}

module.exports = { diffDrift };
