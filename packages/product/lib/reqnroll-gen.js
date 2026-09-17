'use strict';

/**
 * Deterministic Reqnroll (xUnit) project generator.
 *
 * Turns a ParsedPRD (see prd-parser.js) into a runnable Reqnroll + xUnit test
 * project skeleton:
 *   - Features/<REQ-NNN>.feature   (reused verbatim from feature-gen.js)
 *   - Steps/<REQ-NNN>.Steps.cs     ([Binding] class: literal attrs + Pending bodies)
 *   - <Name>.Tests.csproj + reqnroll.json
 *   - .reqnroll-trace.json         (step fingerprint manifest — binding drift identity)
 *
 * The step-matching layer (the `[Given(@"…")]` attributes) is generated here and
 * is authoritative — it must never be hand/agent-authored, or scenarios go
 * "undefined". Step BODIES are left as `PendingStepException` for the
 * reqnroll-binding-specialist agent / a human to fill test-first.
 *
 * Idempotency: feature files, project files and the manifest are always
 * regenerated (deterministic, no timestamps). Step `.cs` files are WRITE-ONCE —
 * a filled body is never clobbered unless `--force` is passed.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { renderFeature } = require('./feature-gen');

const MANIFEST_NAME = '.reqnroll-trace.json';
const DEFAULT_NAMESPACE = 'Acceptance.Tests';

// ---------------------------------------------------------------------------
// Identifiers + fingerprint
// ---------------------------------------------------------------------------

function normalizeStepText(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function hashStep(keyword, text) {
  return crypto
    .createHash('sha256')
    .update(`${keyword.toLowerCase()}::${normalizeStepText(text)}`)
    .digest('hex')
    .slice(0, 12);
}

/** PascalCase C# method name from a Gherkin keyword + step text. */
function methodNameFor(keyword, text) {
  const words = String(text || '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  const name = keyword.charAt(0).toUpperCase() + keyword.slice(1) + words.join('');
  // Guarantee a valid identifier even for all-punctuation text.
  return /^[A-Za-z]/.test(name) ? name : `Step${name}`;
}

function className(reqId) {
  return `${String(reqId).replace(/-/g, '')}Steps`;
}

// ---------------------------------------------------------------------------
// Step inventory
// ---------------------------------------------------------------------------

/**
 * Collect the distinct binding steps across every structured AC in the PRD.
 * Deduped globally by (keyword, normalized text) — Reqnroll matches steps
 * globally, so one binding method per distinct step is correct. Each step is
 * tagged with the first requirement it appears in (for class grouping).
 *
 * Free-form / needs-clarification ACs contribute no steps (their scenarios stay
 * step-less and @needs-clarification in the .feature).
 *
 * @returns {Array<{keyword,text,reqId,method,hash}>}
 */
function collectSteps(prd) {
  const out = [];
  const seen = new Set();
  for (const req of prd.reqs || []) {
    for (const ac of req.acs || []) {
      if (ac.needsClarification || ac.given == null) continue;
      const clauses = [
        ['Given', ac.given],
        ['When', ac.when],
        ['Then', ac.then],
        ...(ac.ands || []).map((a) => ['And', a]),
      ];
      for (const [keyword, text] of clauses) {
        if (!text) continue;
        const key = `${keyword}::${normalizeStepText(text)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          keyword,
          text,
          reqId: req.id,
          method: methodNameFor(keyword, text),
          hash: hashStep(keyword, text),
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// C# rendering
// ---------------------------------------------------------------------------

// Reqnroll has no `And` attribute — an "And" step binds to the keyword above it.
// We emit the contextually-correct attribute by tracking the last primary
// keyword, but since collectSteps already separates clauses, an `And` here is
// rare; map it to [Given] as the safe default (matched by text regardless).
function attributeFor(keyword) {
  const k = keyword === 'And' ? 'Given' : keyword;
  return k;
}

function renderStepClass(req, steps, opts = {}) {
  const ns = opts.namespace || DEFAULT_NAMESPACE;
  const cls = className(req.id);
  const lines = [];
  lines.push('using Reqnroll;');
  lines.push('using FluentAssertions;');
  lines.push('');
  lines.push(`namespace ${ns};`);
  lines.push('');
  lines.push(`// Auto-generated step bindings for ${req.id}: ${req.title}`);
  lines.push('// Attributes are GENERATED and authoritative — do not edit them.');
  lines.push('// Fill the method bodies (replace PendingStepException) test-first.');
  lines.push('[Binding]');
  lines.push(`public partial class ${cls}`);
  lines.push('{');
  lines.push('    private readonly ScenarioContext _ctx;');
  lines.push(`    public ${cls}(ScenarioContext ctx) => _ctx = ctx;`);
  for (const s of steps) {
    const attr = attributeFor(s.keyword);
    lines.push('');
    lines.push(`    [${attr}(@"${s.text.replace(/"/g, '""')}")]`);
    lines.push(`    public void ${s.method}() => throw new PendingStepException();`);
  }
  lines.push('}');
  return lines.join('\n') + '\n';
}

function renderProject(opts = {}) {
  const ref = opts.sutCsproj
    ? `\n    <ProjectReference Include="${opts.sutCsproj}" />`
    : '';
  const csproj = `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <IsPackable>false</IsPackable>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.11.1" />
    <PackageReference Include="Reqnroll.xUnit" Version="2.1.0" />
    <PackageReference Include="xunit" Version="2.9.2" />
    <PackageReference Include="xunit.runner.visualstudio" Version="2.8.2" />
    <PackageReference Include="FluentAssertions" Version="6.12.1" />
  </ItemGroup>

  <ItemGroup>${ref}
  </ItemGroup>

</Project>
`;
  const reqnrollJson =
    JSON.stringify(
      {
        $schema: 'https://schemas.reqnroll.net/reqnroll-config-latest.json',
        language: { feature: 'en' },
      },
      null,
      2
    ) + '\n';
  return { csproj, reqnrollJson };
}

// ---------------------------------------------------------------------------
// Artifact assembly (pure)
// ---------------------------------------------------------------------------

function sanitizeAssembly(slug) {
  const parts = String(slug)
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  const name = parts.join('');
  return /^[A-Za-z]/.test(name) ? name : `Prd${name}`;
}

function buildBindingArtifacts(prd, slug, opts = {}) {
  const ns = opts.namespace || DEFAULT_NAMESPACE;
  const allSteps = collectSteps(prd);
  const stepsByReq = new Map();
  for (const s of allSteps) {
    if (!stepsByReq.has(s.reqId)) stepsByReq.set(s.reqId, []);
    stepsByReq.get(s.reqId).push(s);
  }

  const files = [];
  const manifestSteps = [];

  for (const req of prd.reqs) {
    if (!req.acs.length) continue;
    // Feature file (reuse the shipped renderer), nested under Features/.
    files.push({
      relPath: `Features/${req.id}.feature`,
      content: renderFeature(prd, req),
    });
    const reqSteps = stepsByReq.get(req.id) || [];
    if (reqSteps.length) {
      const file = `Steps/${req.id}.Steps.cs`;
      files.push({ relPath: file, content: renderStepClass(req, reqSteps, { namespace: ns }) });
      for (const s of reqSteps) {
        manifestSteps.push({
          keyword: s.keyword,
          text: s.text,
          method: s.method,
          file,
          hash: s.hash,
        });
      }
    }
  }

  const { csproj, reqnrollJson } = renderProject(opts);
  const assembly = sanitizeAssembly(slug);
  files.push({ relPath: `${assembly}.Tests.csproj`, content: csproj });
  files.push({ relPath: 'reqnroll.json', content: reqnrollJson });

  const manifest = {
    prd: {
      document_id: prd.documentId || null,
      version: prd.version || null,
      path: opts.prdPath || null,
    },
    sut_csproj: opts.sutCsproj || null,
    steps: manifestSteps,
  };

  return { slug, files, manifest, assembly };
}

// ---------------------------------------------------------------------------
// Disk I/O — atomic; write-once for step bindings
// ---------------------------------------------------------------------------

function writeFileAtomic(filePath, content) {
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

function isStepFile(relPath) {
  return relPath.startsWith('Steps/') && relPath.endsWith('.cs');
}

/**
 * @returns {{ outDir, written:string[], skipped:string[], planned:string[] }}
 */
function writeBindingArtifacts(prd, slug, outRoot, opts = {}) {
  const artifacts = buildBindingArtifacts(prd, slug, opts);
  const outDir = path.join(outRoot, slug);
  const manifestText = JSON.stringify(artifacts.manifest, null, 2) + '\n';

  const planned = artifacts.files
    .map((f) => path.join(outDir, f.relPath))
    .concat(path.join(outDir, MANIFEST_NAME));

  if (opts.dryRun) return { outDir, written: [], skipped: [], planned };

  const written = [];
  const skipped = [];
  for (const f of artifacts.files) {
    const dest = path.join(outDir, f.relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // WRITE-ONCE: never clobber a (possibly filled) step binding unless --force.
    if (isStepFile(f.relPath) && fs.existsSync(dest) && !opts.force) {
      skipped.push(dest);
      continue;
    }
    writeFileAtomic(dest, f.content);
    written.push(dest);
  }
  const manifestPath = path.join(outDir, MANIFEST_NAME);
  writeFileAtomic(manifestPath, manifestText);
  written.push(manifestPath);

  return { outDir, written, skipped, planned };
}

// ---------------------------------------------------------------------------
// Binding drift — .feature/PRD step inventory vs. the [Given(@"…")] attributes
// actually present in the step .cs files.
// ---------------------------------------------------------------------------

const ATTR_RE = /\[(Given|When|Then|And)\(@"((?:[^"]|"")*)"\)\]/g;

/** Extract { keyword, text } from every step attribute in a .cs source string. */
function scanBindingAttributes(csText) {
  const out = [];
  const text = String(csText || '');
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(text)) !== null) {
    out.push({ keyword: m[1], text: m[2].replace(/""/g, '"') });
  }
  return out;
}

/**
 * Compare the PRD's current step inventory against the bindings found in the
 * provided .cs sources. Identity is the normalized step text (keyword-agnostic
 * for matching, since "And" rebinds to a primary keyword).
 *
 * @param {import('./prd-parser').ParsedPRD} prd
 * @param {string[]} csSources  contents of the Steps/*.cs files
 * @returns {{inSync, unbound:Array, orphaned:Array}}
 */
function diffBindingDrift(prd, csSources) {
  const expected = collectSteps(prd);
  const expectedByText = new Map(expected.map((s) => [normalizeStepText(s.text), s]));

  const actual = [];
  for (const src of csSources || []) actual.push(...scanBindingAttributes(src));
  const actualByText = new Map(actual.map((s) => [normalizeStepText(s.text), s]));

  const unbound = expected.filter((s) => !actualByText.has(normalizeStepText(s.text)));
  const orphaned = actual.filter((s) => !expectedByText.has(normalizeStepText(s.text)));

  return { inSync: unbound.length === 0 && orphaned.length === 0, unbound, orphaned };
}

module.exports = {
  MANIFEST_NAME,
  normalizeStepText,
  hashStep,
  methodNameFor,
  className,
  collectSteps,
  renderStepClass,
  renderProject,
  buildBindingArtifacts,
  writeBindingArtifacts,
  scanBindingAttributes,
  diffBindingDrift,
};
