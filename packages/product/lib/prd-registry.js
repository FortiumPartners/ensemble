#!/usr/bin/env node
'use strict';

/**
 * prd-registry.js — JSON registry operations for PRD/TRD documents.
 *
 * Mirrors the registry half of packages/development/lib/prd-cli.js (list,
 * status, migrate-frontmatter). The plugin bundle exposes a single
 * lib/prd-cli.js, so this package's prd-cli.js has to serve the registry
 * commands and the feature pipeline commands. The two packages publish
 * standalone and cannot import each other, so the implementation is mirrored
 * here instead of shared (same pattern as lib/config-path.js).
 *
 * Contract:
 *   - On success: returns a single JSON-serializable object.
 *   - On failure: throws Error; the caller prints `{"error":"<msg>"}`.
 *
 * Subcommands:
 *   list [--type prd|trd] [--dir <path>]
 *   status <slug> [--type prd|trd] [--dir <path>]
 *   migrate-frontmatter <dir>
 */

const fs = require('fs');
const path = require('path');

let yaml = null;
try { yaml = require('js-yaml'); } catch { yaml = null; }

// ---------------------------------------------------------------------------
// Frontmatter scanner — handles H1-then-frontmatter layout
// ---------------------------------------------------------------------------

function parseSimpleFrontmatter(raw) {
  const out = {};
  for (const line of String(raw || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    let key = m[1].trim();
    let value = m[2].trim();
    const commentIndex = value.search(/\s+#/);
    if (commentIndex !== -1) value = value.slice(0, commentIndex).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else if (/^-?\d+(?:\.\d+)?$/.test(value)) {
      value = Number(value);
    } else if (/^(true|false)$/i.test(value)) {
      value = /^true$/i.test(value);
    }
    out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

function scanFrontmatter(md) {
  const lines = md.split('\n');
  let start = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      if (start === -1) start = i;
      else if (start !== -1 && end === -1) { end = i; break; }
    }
  }
  if (start === -1 || end === -1) return { frontmatter: null, body: md, yamlFailed: false };
  const raw = lines.slice(start + 1, end).join('\n');
  let frontmatter = null;
  let yamlFailed = false;
  if (yaml) {
    try {
      const loaded = yaml.load(raw);
      if (loaded && typeof loaded === 'object') frontmatter = loaded;
    } catch {
      yamlFailed = true;
    }
  }
  if (!frontmatter) { frontmatter = parseSimpleFrontmatter(raw); yamlFailed = true; }
  const body = lines.slice(end + 1).join('\n');
  return { frontmatter, body, yamlFailed };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function slugify(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function deriveSlug(filePath) {
  const base = path.basename(String(filePath || ''));
  const noExt = base.replace(/\.[^.]+$/, '');
  return slugify(noExt);
}

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

const VALID_STATUSES = new Set(['Draft', 'In Progress', 'Approved', 'Completed', 'Deprecated']);

const SCORE_KEYS = [
  'design_readiness_score', 'Design Readiness Score', 'design readiness score',
  'Readiness Score', 'readiness_score', 'readiness score',
];

function extractReadinessScore(frontmatter) {
  if (!frontmatter) return null;
  for (const key of SCORE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(frontmatter, key)) {
      const v = frontmatter[key];
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

function inferStatus(frontmatter) {
  if (frontmatter && frontmatter.status) {
    const s = String(frontmatter.status).trim();
    if (VALID_STATUSES.has(s)) return s;
  }
  return 'Draft';
}

function stalenessDays(filePath) {
  try {
    const mtime = fs.statSync(filePath).mtime;
    return Math.floor((Date.now() - mtime.getTime()) / (1000 * 60 * 60 * 24));
  } catch {
    return 0;
  }
}

function findFileBySlug(scanDir, slug) {
  const files = fs.readdirSync(scanDir).filter((f) => f.endsWith('.md'));
  const mapped = files.map((f) => ({ name: f, path: path.join(scanDir, f), slug: deriveSlug(f) }));
  return (
    mapped.find(({ slug: s }) => s === slug) ||
    mapped.find(({ slug: s }) => s.endsWith('-' + slug)) ||
    mapped.find(({ slug: s }) => s === slug) ||
    mapped[0] // fallback to first file if slug is ambiguous
  );
}

// ---------------------------------------------------------------------------
// runList
// ---------------------------------------------------------------------------

function runList(argv) {
  const { flags } = parseArgs(argv, new Set(['type', 'dir']));
  const docType = flags.type || 'prd';
  const scanDir = flags.dir || path.join(process.cwd(), docType === 'prd' ? 'docs/PRD' : 'docs/TRD');

  let files;
  try {
    files = fs.readdirSync(scanDir).filter((f) => f.endsWith('.md'));
  } catch (err) {
    throw new Error(`Cannot read directory '${scanDir}': ${err.message}`);
  }

  const items = [];
  for (const file of files.sort()) {
    const filePath = path.join(scanDir, file);
    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const { frontmatter } = scanFrontmatter(raw);
    const slug = deriveSlug(filePath);
    const status = inferStatus(frontmatter);
    const readiness_score = extractReadinessScore(frontmatter);

    let lastModified;
    try {
      lastModified = fs.statSync(filePath).mtime.toISOString();
    } catch {
      lastModified = null;
    }

    const fmId = frontmatter && (
      frontmatter.document_id || frontmatter.id || frontmatter.documentId ||
      frontmatter.Document_ID || frontmatter.DocumentId
    ) ? (frontmatter.document_id || frontmatter.id || frontmatter.Document_ID || frontmatter.DocumentId) : null;

    items.push({
      id: fmId || slug,
      slug,
      status,
      design_readiness_score: readiness_score,
      version: frontmatter && frontmatter.version ? String(frontmatter.version) : null,
      last_modified: lastModified,
    });
  }

  return { ok: true, type: docType, items };
}

// ---------------------------------------------------------------------------
// runStatus
// ---------------------------------------------------------------------------

function runStatus(argv) {
  const { positionals, flags } = parseArgs(argv, new Set(['type', 'dir']));
  const slug = positionals[0];
  if (!slug) throw new Error('Missing required <slug> argument');

  const docType = flags.type || 'prd';
  const scanDir = flags.dir || path.join(process.cwd(), docType === 'prd' ? 'docs/PRD' : 'docs/TRD');

  let filePath;
  try {
    const files = fs.readdirSync(scanDir).filter((f) => f.endsWith('.md'));
    const mapped = files.map((f) => ({ name: f, path: path.join(scanDir, f), slug: deriveSlug(f) }));
    // exact
    const exact = mapped.find(({ slug: s }) => s === slug);
    // suffix: slug ends with the provided slug
    const suffix = exact || mapped.find(({ slug: s }) => s.endsWith('-' + slug));
    // prefix: slug starts with the provided slug
    const prefix = suffix || mapped.find(({ slug: s }) => s.startsWith(slug + '-'));
    filePath = prefix ? prefix.path : null;
  } catch (err) {
    throw new Error(`Cannot read directory '${scanDir}': ${err.message}`);
  }
  if (!filePath) throw new Error(`No ${docType.toUpperCase()} found with slug '${slug}'`);

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read '${filePath}': ${err.message}`);
  }

  const { frontmatter } = scanFrontmatter(raw);
  const status = inferStatus(frontmatter);
  const readiness_score = extractReadinessScore(frontmatter);
  const days = stalenessDays(filePath);

  return {
    ok: true,
    type: docType,
    slug,
    file: filePath,
    status,
    design_readiness_score: readiness_score,
    staleness_days: days,
    version: frontmatter && frontmatter.version ? String(frontmatter.version) : null,
    frontmatter: frontmatter || {},
  };
}

// ---------------------------------------------------------------------------
// runMigrateFrontmatter
// ---------------------------------------------------------------------------

function runMigrateFrontmatter(argv) {
  const { positionals } = parseArgs(argv, new Set([]));
  const dir = positionals[0];
  if (!dir) throw new Error('Missing required <dir> argument');

  const absDir = path.resolve(dir);
  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
    throw new Error(`'${absDir}' is not a directory`);
  }

  let files;
  try {
    files = fs.readdirSync(absDir).filter((f) => f.endsWith('.md'));
  } catch (err) {
    throw new Error(`Cannot read directory '${absDir}': ${err.message}`);
  }

  const migrated = [];
  const errors = [];

  for (const file of files) {
    const filePath = path.join(absDir, file);
    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      errors.push({ file, error: `read failed: ${err.message}` });
      continue;
    }

    const { frontmatter, body, yamlFailed } = scanFrontmatter(raw);
    const fm = Object.assign({}, frontmatter || {});

    const statusWasAbsent = !Object.prototype.hasOwnProperty.call(fm, 'status') || fm.status == null || fm.status === '';
    const scoreWasAbsent = !Object.prototype.hasOwnProperty.call(fm, 'design_readiness_score');

    let changed = false;
    if (statusWasAbsent) { fm.status = 'Draft'; changed = true; }
    if (!yamlFailed && scoreWasAbsent) { fm.design_readiness_score = null; changed = true; }

    if (!changed) {
      migrated.push({ file, action: 'unchanged' });
      continue;
    }

    if (!yamlFailed) {
      const fmLines = Object.entries(fm).map(([k, v]) => {
        const val = v === null ? 'null' : String(v);
        return `${k}: ${val}`;
      });
      const newContent = `---\n${fmLines.join('\n')}\n---\n${body}`;
      try {
        fs.writeFileSync(filePath, newContent, 'utf8');
        migrated.push({ file, action: 'migrated', changes: Object.keys(fm) });
      } catch (err) {
        errors.push({ file, error: `write failed: ${err.message}` });
      }
    } else {
      migrated.push({ file, action: 'skipped', reason: 'bold-keyed frontmatter (YAML parse failed)' });
    }
  }

  return { ok: true, migrated, errors };
}

module.exports = { runList, runStatus, runMigrateFrontmatter };
