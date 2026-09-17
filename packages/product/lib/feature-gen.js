'use strict';

/**
 * Gherkin feature-file generator + traceability manifest builder.
 *
 * Turns a ParsedPRD (see prd-parser.js) into:
 *   - one `<REQ-NNN>.feature` file per requirement, with traceability tags and a
 *     content-hash stamp on every scenario, and
 *   - a `.prd-trace.json` manifest mapping every AC id to its requirement, hash,
 *     feature file, and clarification flag.
 *
 * The manifest + inline hash are the source of truth for drift detection
 * (drift.js / prd-cli.js check-drift). Output is deterministic: the same PRD
 * always produces byte-identical files (no timestamps), so regeneration is
 * idempotent and safe to run repeatedly.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { deriveLabel } = require('./prd-parser');

/** Effective display label: the authored one, else a derived fallback. */
function labelFor(prd) {
  return prd.label || deriveLabel(prd.documentId, prd.title);
}

// ---------------------------------------------------------------------------
// Hashing — the drift fingerprint
// ---------------------------------------------------------------------------

/**
 * Normalize an AC into the canonical string the fingerprint is computed over.
 * Structured ACs hash over their Given/When/Then clauses; free-form ACs hash
 * over their raw text. Lowercased + whitespace-collapsed so cosmetic edits
 * (reflowing, capitalization) do not register as drift.
 */
function normalizeAcText(ac) {
  const basis =
    ac.given !== null && ac.given !== undefined
      ? [ac.given, ac.when, ac.then, ...(ac.ands || [])]
          .filter((s) => s != null && s !== '')
          .join(' | ')
      : ac.raw || '';
  return String(basis).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** 12-hex-char sha256 prefix of the normalized AC text. */
function hashAc(ac) {
  return crypto
    .createHash('sha256')
    .update(normalizeAcText(ac))
    .digest('hex')
    .slice(0, 12);
}

// ---------------------------------------------------------------------------
// Gherkin rendering
// ---------------------------------------------------------------------------

function docIdTag(documentId) {
  return '@' + String(documentId || 'prd').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function renderScenario(ac) {
  const hash = hashAc(ac);
  const lines = [];
  const tags = [`@${ac.id}`, `@hash:${hash}`];
  if (ac.needsClarification) tags.push('@needs-clarification');
  lines.push('  ' + tags.join(' '));
  lines.push(`  Scenario: ${ac.id}`);

  if (!ac.needsClarification && ac.given !== null && ac.given !== undefined) {
    lines.push(`    Given ${ac.given}`);
    if (ac.when) lines.push(`    When ${ac.when}`);
    if (ac.then) lines.push(`    Then ${ac.then}`);
    for (const extra of ac.ands || []) lines.push(`    And ${extra}`);
  } else {
    // Free-form or flagged AC: preserve the prose so nothing is silently lost,
    // and keep it non-executable until a human clarifies the Gherkin contract.
    lines.push(`    # NEEDS CLARIFICATION: not ready for executable Given/When/Then steps`);
    lines.push(`    # ${ac.raw}`);
  }
  return lines.join('\n');
}

/**
 * Render a single requirement into a .feature document string.
 * @param {import('./prd-parser').ParsedPRD} prd
 * @param {import('./prd-parser').Requirement} req
 */
function renderFeature(prd, req) {
  const out = [];
  out.push(`${docIdTag(prd.documentId)} @${req.id}`);
  out.push(`Feature: ${req.title}`);
  // Human-readable label for reference in conversation/reports (display only;
  // the traceability manifest keys on document_id, never the label).
  out.push(`  # Label: ${labelFor(prd)}`);
  if (req.moscow || req.complexity) {
    const meta = [
      req.moscow ? `Priority: ${req.moscow}` : null,
      req.complexity ? `Complexity: ${req.complexity}` : null,
    ]
      .filter(Boolean)
      .join(' | ');
    out.push(`  # ${meta}`);
  }
  out.push('');
  const scenarios = req.acs.map(renderScenario);
  out.push(scenarios.join('\n\n'));
  return out.join('\n').replace(/\n+$/, '') + '\n';
}

// ---------------------------------------------------------------------------
// Artifact assembly (feature files + manifest), pure
// ---------------------------------------------------------------------------

/**
 * @param {import('./prd-parser').ParsedPRD} prd
 * @param {string} slug   stable output-dir name (PRD filename stem)
 * @param {Object} [opts]
 * @param {string} [opts.prdPath] original PRD path recorded in the manifest
 */
function buildArtifacts(prd, slug, opts = {}) {
  const files = [];
  const acs = {};
  for (const req of prd.reqs) {
    if (!req.acs.length) continue;
    const relPath = `${req.id}.feature`;
    files.push({ relPath, content: renderFeature(prd, req) });
    for (const ac of req.acs) {
      acs[ac.id] = {
        req: req.id,
        hash: hashAc(ac),
        feature_file: relPath,
        needs_clarification: !!ac.needsClarification,
      };
    }
  }
  const manifest = {
    prd: {
      document_id: prd.documentId || null,
      label: labelFor(prd),
      version: prd.version || null,
      path: opts.prdPath || null,
    },
    acs,
  };
  return { slug, files, manifest };
}

// ---------------------------------------------------------------------------
// Disk I/O — atomic, idempotent
// ---------------------------------------------------------------------------

function writeFileAtomic(filePath, content) {
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

const MANIFEST_NAME = '.prd-trace.json';

/**
 * Write feature files + manifest under `<outRoot>/<slug>/`.
 * @returns {{ outDir:string, written:string[], planned:string[] }}
 */
function writeArtifacts(prd, slug, outRoot, opts = {}) {
  const artifacts = buildArtifacts(prd, slug, opts);
  const outDir = path.join(outRoot, slug);
  // Stable 2-space JSON, trailing newline — keeps regeneration byte-identical.
  const manifestText = JSON.stringify(artifacts.manifest, null, 2) + '\n';
  const planned = artifacts.files
    .map((f) => path.join(outDir, f.relPath))
    .concat(path.join(outDir, MANIFEST_NAME));

  if (opts.dryRun) {
    return { outDir, written: [], planned };
  }

  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const f of artifacts.files) {
    const dest = path.join(outDir, f.relPath);
    writeFileAtomic(dest, f.content);
    written.push(dest);
  }
  const manifestPath = path.join(outDir, MANIFEST_NAME);
  writeFileAtomic(manifestPath, manifestText);
  written.push(manifestPath);
  return { outDir, written, planned };
}

module.exports = {
  normalizeAcText,
  hashAc,
  renderScenario,
  renderFeature,
  buildArtifacts,
  writeArtifacts,
  MANIFEST_NAME,
};
