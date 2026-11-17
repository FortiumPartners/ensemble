#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `ensemble-generate-reqnroll-bindings` eval. The skill scaffolds a Reqnroll + xUnit project from the
 * seeded PRD with `packages/product/lib/reqnroll-cli.js generate-bindings`. What is expected is derived from the SEEDED PRD in this
 * repository (`evals/skills/<skill>/fixture/docs/PRD/...`), never from the workspace copy, so an agent that edits the PRD cannot
 * move the target. The scaffold directory is found by its `.reqnroll-trace.json`, so `--out` may be anything.
 *
 * Usage (from the agent's workspace): node evals/checks/ensemble-generate-reqnroll-bindings.js <check> [--sut <csproj>]
 *
 * Checks read files without following symlinks (lib.js), bounded; the generator is repository code (packages/product/lib), pure
 * functions only: nothing from the workspace is executed, no git, no dotnet, no network.
 */

const fs = require('fs');
const path = require('path');
const { clean, fail, readText, listFiles, walk, run } = require('./lib');
const { parsePRD } = require('../../packages/product/lib/prd-parser');
const { collectSteps, buildBindingArtifacts, literalStepExpression, MANIFEST_NAME } = require('../../packages/product/lib/reqnroll-gen');

const SKILL = 'ensemble-generate-reqnroll-bindings';
const PRD_REL = 'docs/PRD/PRD-2026-0a1b2c3d-csv2json.md';
const FIXTURE = path.join(__dirname, '..', 'skills', SKILL, 'fixture');
const SLUG = path.basename(PRD_REL, '.md');
const SEEDED = new Set([PRD_REL, 'src/Csv2Json/Csv2Json.csproj']);

const seededPrd = fs.readFileSync(path.join(FIXTURE, PRD_REL), 'utf8');
const parsed = parsePRD(seededPrd);
const STEPS = collectSteps(parsed);
const REQS = parsed.reqs.filter((r) => r.acs.length);

/** The scaffold directory (the one holding `.reqnroll-trace.json`), as a workspace-relative path; exactly one must exist. */
function scaffoldDir() {
  const dirs = walk('.').filter((f) => f === MANIFEST_NAME || f.endsWith(`/${MANIFEST_NAME}`)).map((f) => f.slice(0, -MANIFEST_NAME.length).replace(/\/$/, '') || '.');
  if (dirs.length === 0) fail(`no ${MANIFEST_NAME} anywhere in the workspace: no scaffold was written`);
  if (dirs.length > 1) fail(`expected one scaffold, found ${dirs.length}: ${dirs.map(clean).join(', ')}`);
  return dirs[0];
}
const at = (dir, rel) => (dir === '.' ? rel : `${dir}/${rel}`);
const required = (dir, rel) => { const t = readText(at(dir, rel)); return t === null ? fail(`${clean(at(dir, rel))} is missing`) : t; };

/** The `[Given|When|Then|And|But(@"...")]` attribute expressions of a C# step file, in order (line scan, anchored, no nested quantifiers). */
function attributes(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = /^\s*\[(Given|When|Then)\(@?"([^"\n]{0,500})"\)\]\s*$/.exec(line);
    if (m) out.push({ keyword: m[1], expr: m[2].replace(/""/g, '"') });
  }
  return out;
}

const CHECKS = {
  // The project's files exist: a feature and a step class per requirement with ACs, a Tests.csproj, reqnroll.json, the trace manifest.
  'scaffold-files': () => {
    const dir = scaffoldDir();
    for (const r of REQS) {
      required(dir, `Features/${r.id}.feature`);
      required(dir, `Steps/${r.id}.Steps.cs`);
    }
    const proj = listFiles(dir, /\.Tests\.csproj$/);
    if (proj.length !== 1) fail(`expected one *.Tests.csproj in ${clean(dir)}, found ${proj.length}`);
    required(dir, 'reqnroll.json');
    return `${clean(dir)}: ${REQS.length} features and step classes, ${proj[0]}, reqnroll.json, ${MANIFEST_NAME}`;
  },

  // Every acceptance criterion is a tagged scenario whose Given/When/Then lines carry the PRD's wording verbatim, in order.
  'feature-scenarios': () => {
    const dir = scaffoldDir();
    let n = 0;
    for (const r of REQS) {
      const lines = required(dir, `Features/${r.id}.feature`).split('\n').map((l) => l.trim());
      if (!lines.some((l) => /^Feature:/.test(l))) fail(`${r.id}.feature has no Feature: line`);
      for (const ac of r.acs) {
        const tag = lines.findIndex((l) => new RegExp(`(^|\\s)@${ac.id}(\\s|$)`).test(l));
        if (tag < 0) fail(`${r.id}.feature has no scenario tagged @${clean(ac.id)}`);
        const sc = lines.findIndex((l, i) => i > tag && /^Scenario/.test(l));
        const body = [];
        for (let i = sc + 1; sc >= 0 && i < lines.length && !/^(Scenario|@)/.test(lines[i]); i += 1) if (lines[i]) body.push(lines[i]);
        const want = [`Given ${ac.given}`, `When ${ac.when}`, `Then ${ac.then}`];
        for (const w of want) if (!body.includes(w)) fail(`${clean(ac.id)}: scenario lacks the verbatim step "${clean(w)}"`);
        n += 1;
      }
    }
    return `${n} scenarios with verbatim Given/When/Then steps`;
  },

  // One literal attribute per distinct PRD step, every body Pending, nothing hand-written in a body.
  'step-bindings': () => {
    const dir = scaffoldDir();
    let n = 0;
    for (const r of REQS) {
      const text = required(dir, `Steps/${r.id}.Steps.cs`);
      if (!/^\s*\[Binding\]\s*$/m.test(text)) fail(`${r.id}.Steps.cs has no [Binding] class`);
      const attrs = attributes(text);
      const want = STEPS.filter((s) => s.reqId === r.id);
      for (const s of want) {
        if (!attrs.some((a) => a.keyword === s.keyword && a.expr === literalStepExpression(s.text))) fail(`${r.id}.Steps.cs has no [${s.keyword}(@"${clean(literalStepExpression(s.text))}")] binding`);
      }
      if (attrs.length !== want.length) fail(`${r.id}.Steps.cs has ${attrs.length} step attributes, the PRD has ${want.length} distinct steps`);
      const lines = text.split('\n');
      lines.forEach((l, i) => {
        if (!/^\s*\[(Given|When|Then)\(/.test(l)) return;
        const body = lines.slice(i + 1, i + 4).join('\n');
        if (!/Pending/.test(body)) fail(`${r.id}.Steps.cs: the body after ${clean(l.trim())} is not a Pending stub`);
      });
      n += want.length;
    }
    return `${n} bindings, every body Pending`;
  },

  // The test project is wired for Reqnroll.xUnit and references the SUT given with --sut.
  'csproj-wired': (o) => {
    const dir = scaffoldDir();
    const files = listFiles(dir, /\.Tests\.csproj$/);
    if (files.length !== 1) fail(`expected one *.Tests.csproj in ${clean(dir)}, found ${files.length}`);
    const text = required(dir, files[0]);
    if (!/<Project\b[^>]{0,200}Sdk="Microsoft\.NET\.Sdk"/.test(text)) fail('the project does not use Microsoft.NET.Sdk');
    if (!/<TargetFramework>net\d[^<]{0,20}<\/TargetFramework>/.test(text)) fail('the project has no TargetFramework');
    for (const pkg of ['Reqnroll.xUnit', 'xunit', 'Microsoft.NET.Test.Sdk']) {
      if (!new RegExp(`<PackageReference\\s+Include="${pkg.replace(/\./g, '\\.')}"`).test(text)) fail(`the project has no PackageReference to ${pkg}`);
    }
    const sut = o.sut;
    if (sut) {
      const m = /<ProjectReference\s+Include="([^"\n]{1,300})"/.exec(text);
      if (!m) fail('the project has no ProjectReference to the system under test');
      if (!m[1].replace(/\\/g, '/').endsWith(sut)) fail(`the ProjectReference is ${clean(m[1])}, expected ${clean(sut)}`);
    }
    const cfg = required(dir, 'reqnroll.json');
    let json;
    try { json = JSON.parse(cfg); } catch { fail('reqnroll.json is not valid JSON'); }
    if (!json || typeof json !== 'object' || Array.isArray(json)) fail('reqnroll.json is not a JSON object');
    return `${files[0]} wired for Reqnroll.xUnit${sut ? ` and referencing ${clean(sut)}` : ''}; reqnroll.json parses`;
  },

  // The drift manifest names the PRD and fingerprints every distinct step (keyword, text, method, file, 12-hex hash) as the generator does.
  'trace-manifest': (o) => {
    const dir = scaffoldDir();
    let m;
    try { m = JSON.parse(required(dir, MANIFEST_NAME)); } catch (e) { if (e instanceof SyntaxError) fail(`${MANIFEST_NAME} is not valid JSON`); throw e; }
    if (!m || !m.prd || m.prd.document_id !== 'PRD-2026-0a1b2c3d') fail(`${MANIFEST_NAME} does not name the PRD document_id`);
    if (m.prd.version !== '1.0.0') fail(`${MANIFEST_NAME} prd.version is ${JSON.stringify(clean(m.prd.version))}, expected "1.0.0"`);
    if (o.sut && m.sut_csproj !== o.sut) fail(`${MANIFEST_NAME} sut_csproj is ${JSON.stringify(clean(m.sut_csproj))}, expected ${JSON.stringify(clean(o.sut))}`);
    if (!Array.isArray(m.steps)) fail(`${MANIFEST_NAME} has no steps array`);
    if (m.steps.length !== STEPS.length) fail(`${MANIFEST_NAME} lists ${m.steps.length} steps, the PRD has ${STEPS.length} distinct steps`);
    for (const s of STEPS) {
      const e = m.steps.find((x) => x && x.keyword === s.keyword && x.text === s.text);
      if (!e) fail(`${MANIFEST_NAME} has no entry for ${s.keyword} "${clean(s.text)}"`);
      if (e.file !== `Steps/${s.reqId}.Steps.cs`) fail(`${MANIFEST_NAME}: "${clean(s.text)}" points at ${clean(e.file)}`);
      if (e.method !== s.method) fail(`${MANIFEST_NAME}: "${clean(s.text)}" has method ${clean(e.method)}, expected ${s.method}`);
      if (e.hash !== s.hash) fail(`${MANIFEST_NAME}: "${clean(s.text)}" has hash ${clean(e.hash)}, not the generator's fingerprint`);
    }
    return `${STEPS.length} steps fingerprinted`;
  },

  // Byte-for-byte what the deterministic generator emits for the seeded PRD (so nothing was hand-authored). Repository code, pure.
  'matches-generator': (o) => {
    const dir = scaffoldDir();
    const built = buildBindingArtifacts(parsed, SLUG, { sutCsproj: o.sut || null, prdPath: PRD_REL });
    const files = built.files.map((f) => ({ rel: f.relPath, content: f.content }));
    files.push({ rel: MANIFEST_NAME, content: `${JSON.stringify(built.manifest, null, 2)}\n` });
    for (const f of files) {
      const got = required(dir, f.rel);
      if (got !== f.content) fail(`${clean(f.rel)} differs from the generator's output`);
    }
    return `${files.length} files identical to the generator's output`;
  },

  // The PRD is as seeded, and nothing was written outside the scaffold (tool state and docs/ aside).
  // Possibly flaky: an agent that leaves a notes file outside tests/ fails it; the skill itself writes none.
  'no-stray-writes': () => {
    const dir = scaffoldDir();
    const prd = readText(PRD_REL);
    if (prd === null) fail(`${PRD_REL} was deleted`);
    if (prd !== seededPrd) fail(`${PRD_REL} was modified`);
    const stray = walk('.').filter((f) => !SEEDED.has(f) && !f.startsWith(`${dir}/`) && !/^\.(ensemble|beads)\//.test(f));
    if (stray.length) fail(`files written outside the scaffold: ${stray.slice(0, 5).map(clean).join(', ')}`);
    return 'PRD untouched, no files outside the scaffold';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS };
