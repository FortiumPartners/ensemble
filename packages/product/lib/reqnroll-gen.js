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
 * regenerated (deterministic, no timestamps). Existing step bodies are preserved
 * unless --force is passed; recognized legacy literal attributes are upgraded.
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
  return disambiguateMethodNames(out);
}

/**
 * Make every method name unique within its requirement.
 *
 * `methodNameFor` collapses each run of non-alphanumerics to a word break, so two
 * steps differing only in punctuation — `a paused/canceled plan` and `a paused
 * canceled plan` — yield one identifier. Both survive the dedup above, because
 * `normalizeStepText` only lowercases and collapses whitespace, and a requirement
 * renders to a single partial class, so the generated project fails to compile
 * with CS0111.
 *
 * The suffix is the step's own `hash`, which is already this module's per-step
 * identity and already written to the manifest, so a disambiguated method traces
 * straight to its manifest entry. Taking it from the step's own text rather than
 * its position means the name does not move when the PRD is reordered, and a name
 * that does not collide is left alone.
 *
 * Uniqueness is scoped per requirement because that is the scope of the class:
 * two requirements emitting one method name are two different classes, which
 * compiles. A suffixed name cannot collide with a clean one either, since
 * `methodNameFor` strips `_` along with every other non-alphanumeric.
 */
function disambiguateMethodNames(steps) {
  const counts = new Map();
  for (const s of steps) {
    const key = `${s.reqId}::${s.method}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const s of steps) {
    if (counts.get(`${s.reqId}::${s.method}`) > 1) s.method = `${s.method}_${s.hash}`;
  }
  return steps;
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

/** Explicit regex markers avoid Reqnroll's Cucumber-expression heuristics. */
function literalStepExpression(text) {
  return `^${String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
}

function decodeLiteralStepExpression(expression) {
  if (!expression.startsWith('^') || !expression.endsWith('$')) return null;
  const text = expression.slice(1, -1).replace(/\\(.)/gs, '$1');
  return literalStepExpression(text) === expression ? text : null;
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
    lines.push(`    [${attr}(@"${literalStepExpression(s.text).replace(/"/g, '""')}")]`);
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

function writeFileAtomic(filePath, content, mode, expected) {
  const tmp = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  const descriptor = fs.openSync(tmp, 'wx', mode ?? 0o666);
  try {
    try {
      fs.writeFileSync(descriptor, content);
      if (mode !== undefined) fs.fchmodSync(descriptor, mode);
    } finally {
      fs.closeSync(descriptor);
    }
    if (expected !== undefined && (!fs.lstatSync(filePath).isFile()
      || !fs.readFileSync(filePath).equals(expected)))
      throw new Error(`Binding source changed during migration: ${filePath}`);
    fs.renameSync(tmp, filePath);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
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
    // Preserve implementations while upgrading generator-owned expressions.
    if (isStepFile(f.relPath) && fs.existsSync(dest) && !opts.force) {
      const stat = fs.lstatSync(dest);
      if (!stat.isFile()) throw new Error(`Expected a regular binding file: ${dest}`);
      const existing = fs.readFileSync(dest);
      const upgraded = rewriteBindingExpressions(prd, existing);
      if (upgraded.changes.length) {
        writeFileAtomic(dest, upgraded.content, stat.mode & 0o777, existing);
        written.push(dest);
      } else skipped.push(dest);
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

const ATTR_RE = /\[\s*(Given|When|Then|And)\s*\(\s*@"((?:[^"]|"")*)"\s*\)\s*\]/y;

function skipComment(source, start) {
  if (source[start] === '#' && /^[ \t]*$/.test(source.slice(source.lastIndexOf('\n', start - 1) + 1, start))) {
    // Preprocessor directive (`#region Don't`): a lone apostrophe is not a literal.
    const end = source.indexOf('\n', start);
    return end < 0 ? source.length : end + 1;
  }
  if (source.startsWith('//', start)) {
    const end = source.indexOf('\n', start + 2);
    return end < 0 ? source.length : end + 1;
  }
  if (source.startsWith('/*', start)) {
    const end = source.indexOf('*/', start + 2);
    if (end < 0) throw new Error('Unterminated C# block comment');
    return end + 2;
  }
  return start;
}

// Skip literals rather than searching their contents for attribute-shaped text.
// Interpolation expressions can themselves contain strings and comments.
function skipInterpolation(source, start, closingCount) {
  let depth = 0;
  for (let i = start; i < source.length;) {
    const commentEnd = skipComment(source, i);
    if (commentEnd !== i) { i = commentEnd; continue; }
    const literalEnd = skipLiteral(source, i);
    if (literalEnd !== i) { i = literalEnd; continue; }
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      if (depth === 0 && source.startsWith('}'.repeat(closingCount), i))
        return i + closingCount;
      if (depth > 0) depth--;
    }
    i++;
  }
  throw new Error('Unterminated C# interpolation');
}

function skipLiteral(source, start) {
  let i = start;
  let dollars = 0;
  let verbatim = false;
  if (source[i] === '@') {
    verbatim = true;
    i++;
    if (source[i] === '$') { dollars++; i++; }
  } else {
    while (source[i] === '$') { dollars++; i++; }
    if (source[i] === '@') { verbatim = true; i++; }
  }
  const quote = source[i];
  if (quote !== '"' && !(quote === "'" && i === start)) return start;
  let quoteCount = 1;
  if (quote === '"' && !verbatim) {
    while (source[i + quoteCount] === '"') quoteCount++;
  }
  const raw = quoteCount >= 3;
  const delimiter = raw ? '"'.repeat(quoteCount) : quote;
  i += raw ? quoteCount : 1;
  while (i < source.length) {
    if (!raw && !verbatim && source[i] === '\\') { i += 2; continue; }
    if (source.startsWith(delimiter, i)) {
      if (verbatim && source[i + 1] === '"') { i += 2; continue; }
      return i + delimiter.length;
    }
    if (dollars && source[i] === '{') {
      let count = 1;
      while (source[i + count] === '{') count++;
      if (!raw && count >= 2) { i += 2; continue; }
      if (!raw || count >= dollars) {
        i = skipInterpolation(source, i + (raw ? count : 1), raw ? dollars : 1);
        continue;
      }
    }
    i++;
  }
  throw new Error('Unterminated C# literal');
}

const IDENTIFIER_RE = /@?[\p{L}_][\p{L}\p{N}_]*/uy;
const RANK_SPECIFIER_RE = /\[[\s,]*\]/y;

function skipTrivia(source, start) {
  let i = start;
  while (i < source.length) {
    if (/\s/.test(source[i])) { i++; continue; }
    const end = skipComment(source, i);
    if (end === i) break;
    i = end;
  }
  return i;
}

// Balanced scan of `open`...`close` (generic arguments, tuple types). Returns
// the index after the closer, or -1 when it never balances before a statement
// or block boundary (so a stray `<` cannot swallow the rest of the file).
function skipBalanced(source, start, open, close) {
  let depth = 0;
  for (let i = start; i < source.length;) {
    const trivia = skipTrivia(source, i);
    if (trivia !== i) { i = trivia; continue; }
    const literalEnd = skipLiteral(source, i);
    if (literalEnd !== i) { i = literalEnd; continue; }
    if (source[i] === open) depth++;
    else if (source[i] === close) { if (--depth === 0) return i + 1; }
    else if (source[i] === ';' || source[i] === '{' || source[i] === '}') return -1;
    i++;
  }
  return -1;
}

function matchIdentifier(source, start) {
  IDENTIFIER_RE.lastIndex = start;
  const match = IDENTIFIER_RE.exec(source);
  return match ? start + match[0].length : -1;
}

// One modifier, or one (qualified, generic, nullable, array/pointer) type or
// name. Returns the index after the item, or -1 if none starts at `start`.
function skipTypeLike(source, start) {
  let i = matchIdentifier(source, start);
  if (i < 0) return -1;
  for (;;) {
    if (source[i] === '<') {
      i = skipBalanced(source, i, '<', '>');
      if (i < 0) return -1;
    }
    if (source.startsWith('::', i)) i += 2;
    else if (source[i] === '.') i++;
    else break;
    const next = matchIdentifier(source, i);
    if (next < 0) return -1;
    i = next;
  }
  for (;;) {
    const next = skipTrivia(source, i);
    if (source[next] === '?' || source[next] === '*') { i = next + 1; continue; }
    RANK_SPECIFIER_RE.lastIndex = next;
    const rank = RANK_SPECIFIER_RE.exec(source);
    if (!rank) return i;
    i = next + rank[0].length;
  }
}

// After the attribute lists: is this `[modifiers] ReturnType Name[<T>](`, i.e.
// a method (or constructor) declaration with any return type, with or without
// modifiers? Anything else (`;`, `,`, `)`, a lambda, a statement) is not a
// declaration, so collection expressions like `return [Given(@"x")];` stay out.
function startsMethodDeclaration(source, start) {
  let i = skipTrivia(source, start);
  let items = 0;
  for (;;) {
    if (source[i] === '(') {
      // Either a tuple type or the parameter list. Only a parameter list can
      // be followed by something other than another identifier (`where`
      // constraints aside), so a following identifier means a tuple type.
      const end = skipBalanced(source, i, '(', ')');
      if (end < 0) return false;
      const after = skipTrivia(source, end);
      const wordEnd = matchIdentifier(source, after);
      if (wordEnd < 0 || source.slice(after, wordEnd) === 'where') return items >= 2;
      items++;
      i = after;
      continue;
    }
    const end = skipTypeLike(source, i);
    if (end < 0) return false;
    items++;
    i = skipTrivia(source, end);
    if (source[i] !== '(' && matchIdentifier(source, i) < 0) return false;
  }
}

function hasBindingDeclaration(source, start) {
  let i = start;
  while (i < source.length) {
    if (/\s/.test(source[i])) { i++; continue; }
    const commentEnd = skipComment(source, i);
    if (commentEnd !== i) { i = commentEnd; continue; }
    if (source[i] !== '[') break;
    // Other method attributes can intervene. Balance their argument brackets
    // while ignoring strings, rather than mistaking a collection expression
    // such as `return [Given(@"text")];` for a binding declaration.
    let depth = 1;
    i++;
    while (i < source.length && depth) {
      const end = skipComment(source, i);
      if (end !== i) { i = end; continue; }
      const literalEnd = skipLiteral(source, i);
      if (literalEnd !== i) { i = literalEnd; continue; }
      if (source[i] === '[') depth++;
      if (source[i] === ']') depth--;
      i++;
    }
    if (depth) throw new Error('Unterminated C# attribute list');
  }
  return i === source.length || startsMethodDeclaration(source, i);
}

function bindingAttributeSpans(csText) {
  const source = String(csText || '');
  const out = [];
  for (let i = 0; i < source.length;) {
    const commentEnd = skipComment(source, i);
    if (commentEnd !== i) { i = commentEnd; continue; }
    if (source[i] === '[') {
      ATTR_RE.lastIndex = i;
      const match = ATTR_RE.exec(source);
      if (match) {
        if (!hasBindingDeclaration(source, i + match[0].length)) {
          i += match[0].length;
          continue;
        }
        const start = i + match[0].indexOf('@"') + 2;
        out.push({
          keyword: match[1],
          expression: match[2].replace(/""/g, '"'),
          start,
          end: start + match[2].length,
        });
        i += match[0].length;
        continue;
      }
    }
    const literalEnd = skipLiteral(source, i);
    i = literalEnd === i ? i + 1 : literalEnd;
  }
  return out;
}

/** Return logical text for generated literal regexes, not their encoding. */
function scanBindingAttributes(csText) {
  return bindingAttributeSpans(csText).map(({ keyword, expression }) => ({
    keyword,
    text: decodeLiteralStepExpression(expression) ?? expression,
  }));
}

/** Upgrade only recognized generated attributes; every other byte survives. */
function rewriteBindingExpressions(prd, csText) {
  const source = Buffer.isBuffer(csText)
    ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(csText)
    : String(csText);
  const steps = collectSteps(prd);
  const legacy = new Map(steps.map((step) => [step.text, step]));
  const current = new Map(steps.map((step) => [literalStepExpression(step.text), step]));
  const changes = [];
  const chunks = [];
  let cursor = 0;
  for (const attribute of bindingAttributeSpans(source)) {
    const oldStep = legacy.get(attribute.expression);
    const newStep = current.get(attribute.expression);
    if (oldStep && newStep && oldStep.text !== newStep.text)
      throw new Error('Ambiguous legacy/current binding expression; migration left the source unchanged');
    if (!oldStep || newStep) continue;
    chunks.push(source.slice(cursor, attribute.start));
    chunks.push(literalStepExpression(oldStep.text).replace(/"/g, '""'));
    cursor = attribute.end;
    changes.push({ keyword: attribute.keyword, text: oldStep.text });
  }
  chunks.push(source.slice(cursor));
  return { content: chunks.join(''), changes };
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
  literalStepExpression,
  renderStepClass,
  renderProject,
  buildBindingArtifacts,
  writeBindingArtifacts,
  writeFileAtomic,
  scanBindingAttributes,
  rewriteBindingExpressions,
  diffBindingDrift,
};
