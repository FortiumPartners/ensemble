#!/usr/bin/env node
'use strict';

/**
 * Deterministic PRD → Gherkin CLI.
 *
 * Mirrors packages/development/lib/trd-cli.js: a thin argv layer over pure libs
 * (prd-parser, feature-gen, drift). Slash commands shell out to this; nothing is
 * hand-parsed in prose.
 *
 * Subcommands:
 *   parse             <prd-path> [--json]
 *   generate-features <prd-path> [--out <dir>] [--dry-run] [--force]
 *   check-drift       <prd-path> [--out <dir>] [--json]
 *
 * Exit codes:
 *   0  success / IN_SYNC
 *   1  usage or read error
 *   2  drift detected (check-drift only) — lets CI gate on it later
 */

const fs = require('fs');
const path = require('path');

const { parsePRD } = require('./prd-parser');
const { buildArtifacts, writeArtifacts, MANIFEST_NAME } = require('./feature-gen');
const { diffDrift } = require('./drift');

const DEFAULT_OUT = 'features';

// ---------------------------------------------------------------------------
// argv + IO helpers (same shape as trd-cli.js)
// ---------------------------------------------------------------------------

function parseArgs(argv, valueFlags) {
  const vf = valueFlags || new Set();
  const positionals = [];
  const flags = {};
  const list = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < list.length; i++) {
    const tok = list[i];
    if (typeof tok === 'string' && tok.startsWith('--')) {
      const name = tok.slice(2);
      const next = list[i + 1];
      const nextIsFlag = typeof next === 'string' && next.startsWith('--');
      if (vf.has(name)) {
        flags[name] = nextIsFlag || next === undefined ? '' : next;
        if (!nextIsFlag && next !== undefined) i += 1;
      } else {
        flags[name] = true;
      }
    } else {
      positionals.push(tok);
    }
  }
  return { positionals, flags };
}

function readPrd(prdPath) {
  if (!prdPath) throw new Error('Missing required <prd-path> argument');
  try {
    return fs.readFileSync(prdPath, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read PRD file '${prdPath}': ${err.message}`);
  }
}

/** Output directory name for a PRD = its filename stem (stable, unambiguous). */
function deriveSlug(prdPath) {
  return path.basename(prdPath, path.extname(prdPath));
}

function loadParsed(prdPath) {
  const markdown = readPrd(prdPath);
  return { slug: deriveSlug(prdPath), parsed: parsePRD(markdown) };
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

function runParse(argv) {
  const { positionals } = parseArgs(argv);
  const { slug, parsed } = loadParsed(positionals[0]);
  const acCount = parsed.reqs.reduce((n, r) => n + r.acs.length, 0);
  return {
    ok: true,
    slug,
    documentId: parsed.documentId,
    reqCount: parsed.reqs.length,
    acCount,
    warnings: parsed.warnings,
    prd: parsed,
  };
}

function runGenerate(argv) {
  const { positionals, flags } = parseArgs(argv, new Set(['out']));
  const prdPath = positionals[0];
  const { slug, parsed } = loadParsed(prdPath);
  const outRoot = flags.out || DEFAULT_OUT;
  const res = writeArtifacts(parsed, slug, outRoot, {
    dryRun: !!flags['dry-run'],
    prdPath,
  });
  const flagged = Object.values(buildArtifacts(parsed, slug).manifest.acs).filter(
    (a) => a.needs_clarification
  ).length;
  return {
    ok: true,
    slug,
    outDir: res.outDir,
    dryRun: !!flags['dry-run'],
    featureFiles: parsed.reqs.filter((r) => r.acs.length).length,
    acCount: parsed.reqs.reduce((n, r) => n + r.acs.length, 0),
    needsClarification: flagged,
    written: res.written,
    planned: res.planned,
    warnings: parsed.warnings,
  };
}

function runCheckDrift(argv) {
  const { positionals, flags } = parseArgs(argv, new Set(['out']));
  const prdPath = positionals[0];
  const { slug, parsed } = loadParsed(prdPath);
  const outRoot = flags.out || DEFAULT_OUT;
  const manifestPath = path.join(outRoot, slug, MANIFEST_NAME);

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    return {
      ok: false,
      slug,
      noManifest: true,
      manifestPath,
      message: `No manifest at ${manifestPath} — run generate-features first (${err.code || err.message}).`,
    };
  }

  const drift = diffDrift(parsed, manifest);
  return { ok: true, slug, manifestPath, drift };
}

// ---------------------------------------------------------------------------
// Reporting (human-readable)
// ---------------------------------------------------------------------------

function reportGenerate(r) {
  const verb = r.dryRun ? 'Would generate' : 'Generated';
  const lines = [
    `${verb} ${r.featureFiles} feature file(s) (${r.acCount} scenario(s)) → ${r.outDir}`,
  ];
  if (r.needsClarification) {
    lines.push(`⚠ ${r.needsClarification} AC(s) need clarification (tagged @needs-clarification).`);
  }
  for (const w of r.warnings) lines.push(`  warning: ${w}`);
  return lines.join('\n');
}

function reportDrift(r) {
  if (r.noManifest) return r.message;
  const d = r.drift;
  if (d.inSync) return `IN_SYNC — ${r.slug} feature files match the PRD.`;
  const lines = [`DRIFT DETECTED — ${r.slug}`];
  if (d.prdMismatch) lines.push('  ! manifest was generated from a different PRD document_id');
  if (d.added.length) lines.push(`  + ADDED   (${d.added.length}): ${d.added.join(', ')}`);
  if (d.removed.length) lines.push(`  - REMOVED (${d.removed.length}): ${d.removed.join(', ')}`);
  if (d.changed.length) lines.push(`  ~ CHANGED (${d.changed.length}): ${d.changed.join(', ')}`);
  lines.push('  Run generate-features to resync.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main(argv) {
  const [cmd, ...rest] = argv;
  const wantsJson = rest.includes('--json');

  try {
    if (cmd === 'parse') {
      const r = runParse(rest);
      if (wantsJson) console.log(JSON.stringify(r, null, 2));
      else console.log(`${r.documentId || '(no id)'}: ${r.reqCount} requirement(s), ${r.acCount} AC(s)`);
      return 0;
    }
    if (cmd === 'generate-features') {
      const r = runGenerate(rest);
      console.log(wantsJson ? JSON.stringify(r, null, 2) : reportGenerate(r));
      return 0;
    }
    if (cmd === 'check-drift') {
      const r = runCheckDrift(rest);
      console.log(wantsJson ? JSON.stringify(r, null, 2) : reportDrift(r));
      if (r.noManifest) return 1;
      return r.drift.inSync ? 0 : 2;
    }
    console.error(
      'Usage: prd-cli <parse|generate-features|check-drift> <prd-path> [--out dir] [--dry-run] [--force] [--json]'
    );
    return 1;
  } catch (err) {
    if (wantsJson) console.log(JSON.stringify({ ok: false, error: err.message }, null, 2));
    else console.error(`Error: ${err.message}`);
    return 1;
  }
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { main, runParse, runGenerate, runCheckDrift, parseArgs, deriveSlug };
