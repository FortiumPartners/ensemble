#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `ensemble-generate-feature-tests` eval (evals/skills/ensemble-generate-feature-tests/).
 * Every check reads the workspace the agent worked in (cwd) and the shipped fixture PRD; none runs workspace code or git.
 * Common arguments: --out <dir> (where the artifacts go, e.g. features/<prd-stem>), --reqs REQ-001,..., --acs AC-001-1,...,
 * --flagged <the ACs that are free-form or carry [NEEDS CLARIFICATION]>, --prd <the PRD path in the workspace>.
 * The expected hash is recomputed with the shipped generator's own fingerprint function (packages/product/lib), so the checks
 * and the product cannot drift apart silently. Gherkin is read line by line with anchored regexes (no nested quantifiers).
 */

const path = require('path');
const { fail, readText, listFiles, walk, need, list, clean, run } = require('./lib');
const { parsePRD } = require('../../packages/product/lib/prd-parser');
const { hashAc } = require('../../packages/product/lib/feature-gen');

const FIXTURE_PRD = path.join(__dirname, '..', 'skills', 'ensemble-generate-feature-tests', 'fixture', 'docs', 'PRD', 'PRD-2026-a1b2c3d4-csv2json.md');
const STEP = /^\s*(Given|When|Then|And|But)\s+\S/;

/** Feature file text by name for `reqs` in `out`; a missing file fails naming it. */
function readFeatures(o) {
  const out = need(o, 'out');
  const files = {};
  for (const req of list(need(o, 'reqs'))) {
    const text = readText(`${out}/${req}.feature`);
    if (text === null) fail(`${clean(out)}/${clean(req)}.feature was not written`);
    files[req] = text;
  }
  return files;
}

/** { tags: [feature-level tags], scenarios: [{ tags, name, lines }] } of a Gherkin document. */
function parseFeature(text) {
  const res = { tags: [], scenarios: [] };
  let pending = [];
  let cur = null;
  let seenFeature = false;
  for (const line of text.split('\n')) {
    if (/^\s*@\S/.test(line)) {
      pending = pending.concat(line.trim().split(/\s+/).filter((t) => t.startsWith('@')));
      cur = null;
    } else if (/^\s*Feature:/.test(line)) {
      res.tags = pending; pending = []; seenFeature = true; cur = null;
    } else if (/^\s*Scenario(?: Outline)?:/.test(line) && seenFeature) {
      cur = { tags: pending, name: line.replace(/^\s*Scenario(?: Outline)?:\s*/, '').trim(), lines: [] };
      pending = [];
      res.scenarios.push(cur);
    } else if (cur) cur.lines.push(line);
  }
  return res;
}

/** Every scenario across the requirement files: [{ req, tags, steps, lines, acId }]; acId is the @AC-... tag (null when absent). */
function scenarios(o) {
  const all = [];
  for (const [req, text] of Object.entries(readFeatures(o))) {
    for (const s of parseFeature(text).scenarios) {
      const ac = s.tags.find((t) => /^@AC-\d+/i.test(t));
      all.push({ req, tags: s.tags, steps: s.lines.filter((l) => STEP.test(l)), lines: s.lines, acId: ac ? ac.slice(1).toUpperCase() : null });
    }
  }
  return all;
}

const manifestOf = (o) => {
  const text = readText(`${need(o, 'out')}/.prd-trace.json`);
  if (text === null) fail(`${clean(o.out)}/.prd-trace.json was not written`);
  let m;
  try { m = JSON.parse(text); } catch (e) { return fail(`.prd-trace.json is not valid JSON (${clean(e.message)})`); }
  if (!m || typeof m !== 'object' || !m.acs || typeof m.acs !== 'object' || Array.isArray(m.acs)) fail('.prd-trace.json has no "acs" object');
  return m;
};

const CHECKS = {
  // One .feature per requirement under --out, none empty.
  'features-saved': (o) => {
    const files = readFeatures(o);
    for (const [req, text] of Object.entries(files)) {
      if (!/^\s*Feature:\s*\S/m.test(text)) fail(`${req}.feature has no "Feature:" line`);
    }
    const extra = listFiles(need(o, 'out'), /\.feature$/).filter((f) => !list(o.reqs).includes(f.replace(/\.feature$/, '')));
    if (extra.length) fail(`unexpected feature files: ${extra.slice(0, 5).map(clean).join(', ')} (one file per requirement REQ-NNN)`);
    return `${Object.keys(files).length} feature files, one per requirement`;
  },

  // Every AC is exactly one Scenario carrying its @AC-NNN-M tag, in its own requirement's file; nothing dropped, nothing invented.
  'scenario-per-ac': (o) => {
    const all = scenarios(o);
    const acs = list(need(o, 'acs'));
    for (const id of acs) {
      const hits = all.filter((s) => s.acId === id);
      if (hits.length === 0) fail(`no Scenario tagged @${id}: the acceptance criterion was dropped`);
      if (hits.length > 1) fail(`${hits.length} Scenarios tagged @${id}: expected exactly one`);
      const wantReq = `REQ-${id.split('-')[1]}`;
      if (hits[0].req !== wantReq) fail(`@${id} is in ${hits[0].req}.feature, expected ${wantReq}.feature`);
    }
    if (all.length !== acs.length) fail(`${all.length} Scenarios for ${acs.length} acceptance criteria (one Scenario per AC, none extra)`);
    return `${acs.length} acceptance criteria, ${acs.length} Scenarios, each in its requirement's file`;
  },

  // Structured ACs become executable Given/When/Then steps, in that order; they are not marked @needs-clarification.
  'gwt-steps': (o) => {
    const flagged = new Set(list(o.flagged || ''));
    const structured = list(need(o, 'acs')).filter((id) => !flagged.has(id));
    const all = scenarios(o);
    for (const id of structured) {
      const s = all.find((x) => x.acId === id);
      if (!s) fail(`no Scenario tagged @${id}`);
      if (s.tags.some((t) => t.toLowerCase() === '@needs-clarification')) fail(`@${id} is tagged @needs-clarification but it is already Given/When/Then`);
      const kinds = s.steps.map((l) => STEP.exec(l)[1]);
      const g = kinds.indexOf('Given');
      const w = kinds.indexOf('When', g + 1);
      if (g < 0 || w < 0 || kinds.indexOf('Then', w + 1) < 0) fail(`@${id} lacks Given, When, Then steps in order (steps: ${clean(kinds.join(' ') || 'none')})`);
    }
    return `${structured.length} structured acceptance criteria have Given/When/Then steps`;
  },

  // Free-form or [NEEDS CLARIFICATION] ACs are kept, tagged @needs-clarification, and have no invented executable steps.
  'needs-clarification': (o) => {
    const all = scenarios(o);
    const flagged = list(need(o, 'flagged'));
    for (const id of flagged) {
      const s = all.find((x) => x.acId === id);
      if (!s) fail(`no Scenario tagged @${id}: a free-form acceptance criterion must be kept, not skipped`);
      if (!s.tags.some((t) => t.toLowerCase() === '@needs-clarification')) fail(`@${id} is free-form or flagged but not tagged @needs-clarification`);
      if (s.steps.length) fail(`@${id} is @needs-clarification but has executable steps (${clean(s.steps[0].trim())}); keep the prose as a comment`);
    }
    return `${flagged.length} acceptance criteria tagged @needs-clarification without invented steps`;
  },

  // Traceability tags: each feature carries the lower-cased PRD document id tag and its @REQ tag; each scenario a @hash:<12 hex>.
  'trace-tags': (o) => {
    const docTag = `@${need(o, 'doc-id').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    for (const [req, text] of Object.entries(readFeatures(o))) {
      const f = parseFeature(text);
      if (!f.tags.map((t) => t.toLowerCase()).includes(docTag)) fail(`${req}.feature lacks the document tag ${clean(docTag)}`);
      if (!f.tags.some((t) => t.toUpperCase() === `@${req}`)) fail(`${req}.feature lacks the @${req} tag`);
    }
    for (const s of scenarios(o)) {
      if (!s.tags.some((t) => /^@hash:[0-9a-f]{12}$/.test(t))) fail(`Scenario ${clean(s.acId)} lacks a @hash:<12 hex characters> tag`);
    }
    return 'document, requirement and hash tags present';
  },

  // The manifest: valid JSON, PRD identity, and for every AC the requirement, feature file, clarification flag and a hash equal to the scenario's tag.
  manifest: (o) => {
    const m = manifestOf(o);
    if (!m.prd || m.prd.document_id !== need(o, 'doc-id')) fail(`manifest prd.document_id is ${JSON.stringify(clean(m.prd && m.prd.document_id))}, expected ${JSON.stringify(o['doc-id'])}`);
    const flagged = new Set(list(o.flagged || ''));
    const tagOf = new Map(scenarios(o).map((s) => [s.acId, (s.tags.find((t) => t.startsWith('@hash:')) || '').slice(6)]));
    const acs = list(need(o, 'acs'));
    for (const id of acs) {
      const e = m.acs[id];
      if (!e || typeof e !== 'object') fail(`manifest has no entry for ${id}`);
      if (e.req !== `REQ-${id.split('-')[1]}`) fail(`manifest ${id}.req is ${JSON.stringify(clean(e.req))}`);
      if (e.feature_file !== `${e.req}.feature`) fail(`manifest ${id}.feature_file is ${JSON.stringify(clean(e.feature_file))}, expected ${e.req}.feature`);
      if (typeof e.hash !== 'string' || !/^[0-9a-f]{12}$/.test(e.hash)) fail(`manifest ${id}.hash is not 12 hex characters`);
      if (e.hash !== tagOf.get(id)) fail(`manifest ${id}.hash ${e.hash} differs from the scenario's @hash tag ${clean(tagOf.get(id))}`);
      if (e.needs_clarification !== flagged.has(id)) fail(`manifest ${id}.needs_clarification is ${JSON.stringify(e.needs_clarification)}, expected ${flagged.has(id)}`);
    }
    const extra = Object.keys(m.acs).filter((k) => !acs.includes(k));
    if (extra.length) fail(`manifest lists acceptance criteria that are not in the PRD: ${extra.slice(0, 5).map(clean).join(', ')}`);
    return `manifest maps ${acs.length} acceptance criteria to requirement, file, hash and flag`;
  },

  // The fingerprint is the real one: each AC's hash equals the generator's hash of that AC parsed from the PRD (a copied or invented hash fails).
  'hashes-match': (o) => {
    const prd = parsePRD(readText(need(o, 'prd')) || '');
    const expected = new Map();
    for (const r of prd.reqs) for (const ac of r.acs) expected.set(ac.id, hashAc(ac));
    if (expected.size === 0) fail(`${clean(o.prd)} has no acceptance criteria to hash`);
    const m = manifestOf(o);
    for (const [id, hash] of expected) {
      if (!m.acs[id] || m.acs[id].hash !== hash) fail(`manifest ${id}.hash is ${JSON.stringify(clean(m.acs[id] && m.acs[id].hash))}, the fingerprint of the AC is ${hash}`);
    }
    return `${expected.size} hashes equal the generator's fingerprint of the PRD text`;
  },

  // The PRD is the input: byte-identical to the shipped fixture (generation must not edit it to fit).
  'prd-unchanged': (o) => {
    const now = readText(need(o, 'prd'));
    if (now === null) fail(`${clean(o.prd)} is missing`);
    if (now !== readText(FIXTURE_PRD)) fail(`${clean(o.prd)} was modified; the skill only reads the PRD`);
    return 'PRD untouched';
  },

  // Nothing outside the PRD, the output directory and tool state: no step definitions, no implementation.
  'no-impl-files': (o) => {
    const out = need(o, 'out').replace(/\/+$/, '');
    const extra = walk('.').filter((f) => !f.startsWith('docs/') && !f.startsWith(`${out}/`) && !/^\.(ensemble|beads)\//.test(f));
    if (extra.length) fail(`files outside docs/ and ${clean(out)}/: ${extra.slice(0, 5).map(clean).join(', ')} (no step definitions or implementation)`);
    return `only docs/ and ${out}/ written`;
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS };
