#!/usr/bin/env node
'use strict';

/**
 * Reqnroll (xUnit) BDD codegen + drift + run CLI.
 *
 * Mirrors prd-cli.js: a thin argv layer over pure libs (prd-parser, reqnroll-gen,
 * reqnroll-run). Slash commands shell out to this; nothing is hand-parsed.
 *
 * Subcommands:
 *   generate-bindings   <prd-path> [--out <dir>] [--sut <csproj>] [--dry-run] [--force]
 *   check-binding-drift <prd-path> [--out <dir> | --steps-dir <dir>] [--json]
 *   migrate-bindings    <prd-path> [--out <dir> | --steps-dir <dir>] [--dry-run] [--json]
 *   run                 [--project <dir>] [--filter <expr>] [--json]
 *
 * Exit codes:
 *   0  success / IN_SYNC / green
 *   1  usage or read error
 *   2  drift detected / red (lets CI + the test-first gate branch on it)
 */

const fs = require('fs');
const path = require('path');

const { parsePRD } = require('./prd-parser');
const { parseArgs, deriveSlug } = require('./prd-cli');
const {
  writeBindingArtifacts,
  buildBindingArtifacts,
  diffBindingDrift,
  rewriteBindingExpressions,
  writeFileAtomic,
} = require('./reqnroll-gen');
const { runTests, isGreen } = require('./reqnroll-run');

const DEFAULT_OUT = 'tests';

function readPrd(prdPath) {
  if (!prdPath) throw new Error('Missing required <prd-path> argument');
  try {
    return fs.readFileSync(prdPath, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read PRD file '${prdPath}': ${err.message}`, { cause: err });
  }
}

function loadParsed(prdPath) {
  return { slug: deriveSlug(prdPath), parsed: parsePRD(readPrd(prdPath)) };
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

function runGenerate(argv) {
  const { positionals, flags } = parseArgs(argv, new Set(['out', 'sut']));
  const prdPath = positionals[0];
  const { slug, parsed } = loadParsed(prdPath);
  const outRoot = flags.out || DEFAULT_OUT;
  const res = writeBindingArtifacts(parsed, slug, outRoot, {
    dryRun: !!flags['dry-run'],
    force: !!flags.force,
    sutCsproj: flags.sut || null,
    prdPath,
  });
  const built = buildBindingArtifacts(parsed, slug, { sutCsproj: flags.sut || null });
  return {
    ok: true,
    slug,
    outDir: res.outDir,
    dryRun: !!flags['dry-run'],
    features: parsed.reqs.filter((r) => r.acs.length).length,
    steps: built.manifest.steps.length,
    written: res.written,
    skipped: res.skipped,
    planned: res.planned,
    sut: flags.sut || null,
    warnings: parsed.warnings,
  };
}

function listStepFiles(stepsDir) {
  if (!fs.existsSync(stepsDir)) return [];
  if (fs.realpathSync(stepsDir) !== path.resolve(stepsDir))
    throw new Error(`Refusing a symlink in the binding directory path: ${stepsDir}`);
  const files = [];
  for (const entry of fs.readdirSync(stepsDir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(stepsDir, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Refusing a symlink in the binding directory: ${file}`);
    if (entry.isDirectory()) files.push(...listStepFiles(file));
    else if (entry.isFile() && entry.name.endsWith('.cs')) files.push(file);
  }
  return files;
}

function stepDirectory(slug, flags) {
  if (flags.out && flags['steps-dir'])
    throw new Error('Use either --out or --steps-dir, not both');
  return flags['steps-dir'] || path.join(flags.out || DEFAULT_OUT, slug, 'Steps');
}

function runMigrate(argv) {
  const { positionals, flags } = parseArgs(argv, new Set(['out', 'steps-dir']));
  const { slug, parsed } = loadParsed(positionals[0]);
  const stepsDir = stepDirectory(slug, flags);
  const files = listStepFiles(stepsDir);
  if (!files.length) throw new Error(`No step files under ${stepsDir}`);
  // Parse every file before writing any: malformed/ambiguous C# must not cause
  // a partially planned migration. Existing method bodies remain byte-identical.
  const planned = files.map((file) => {
    const source = fs.readFileSync(file);
    return { file, source, mode: fs.statSync(file).mode, ...rewriteBindingExpressions(parsed, source) };
  });
  const changed = planned.filter((file) => file.changes.length);
  if (!flags['dry-run']) {
    for (const file of planned) {
      if (!fs.lstatSync(file.file).isFile() || !fs.readFileSync(file.file).equals(file.source))
        throw new Error(`Binding source changed during migration: ${file.file}`);
    }
    for (const file of changed)
      writeFileAtomic(file.file, file.content, file.mode & 0o777, file.source);
  }
  return {
    ok: true, slug, stepsDir, dryRun: !!flags['dry-run'],
    changed: changed.map(({ file, changes }) => ({ file, steps: changes.length })),
    unchanged: planned.filter((file) => !file.changes.length).map(({ file }) => file),
  };
}

function runCheckDrift(argv) {
  const { positionals, flags } = parseArgs(argv, new Set(['out', 'steps-dir']));
  const prdPath = positionals[0];
  const { slug, parsed } = loadParsed(prdPath);
  const stepsDir = stepDirectory(slug, flags);
  const files = listStepFiles(stepsDir);

  if (files.length === 0) {
    return {
      ok: false,
      slug,
      noBindings: true,
      stepsDir,
      message: `No step files under ${stepsDir} — run generate-bindings first.`,
    };
  }

  const sources = files.map((f) => fs.readFileSync(f, 'utf8'));
  const drift = diffBindingDrift(parsed, sources);
  return { ok: true, slug, stepsDir, drift };
}

function runRun(argv) {
  const { flags } = parseArgs(argv, new Set(['project', 'filter']));
  const projectDir = flags.project || '.';
  const { result, exitCode, raw } = runTests(projectDir, { filter: flags.filter });
  return { ok: true, projectDir, result, green: exitCode === 0 && isGreen(result), dotnetExit: exitCode, raw };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function reportGenerate(r) {
  const verb = r.dryRun ? 'Would generate' : 'Generated';
  const lines = [
    `${verb} Reqnroll/xUnit project → ${r.outDir}`,
    `  ${r.features} feature(s), ${r.steps} distinct step binding(s)${r.sut ? `, SUT: ${r.sut}` : ''}`,
  ];
  if (r.skipped && r.skipped.length) {
    lines.push(`  ${r.skipped.length} step file(s) preserved (write-once; use --force to reset):`);
    for (const s of r.skipped) lines.push(`    - ${s}`);
  }
  for (const w of r.warnings) lines.push(`  warning: ${w}`);
  if (!r.dryRun) lines.push('  Fill the Pending() bodies test-first, then run.');
  return lines.join('\n');
}

function reportDrift(r) {
  if (r.noBindings) return r.message;
  const d = r.drift;
  if (d.inSync) return `IN_SYNC — ${r.slug} bindings cover the PRD's steps.`;
  const lines = [`BINDING DRIFT — ${r.slug}`];
  if (d.unbound.length) {
    lines.push(`  + UNBOUND  (${d.unbound.length}) — PRD step with no binding:`);
    for (const s of d.unbound) lines.push(`      ${s.keyword} ${s.text}`);
  }
  if (d.orphaned.length) {
    lines.push(`  - ORPHANED (${d.orphaned.length}) — binding with no PRD step:`);
    for (const s of d.orphaned) lines.push(`      ${s.keyword} ${s.text}`);
  }
  lines.push('  Re-run generate-bindings (adds new step stubs); update or remove orphaned bindings.');
  return lines.join('\n');
}

function reportRun(r) {
  const x = r.result;
  const head = r.green ? 'GREEN' : 'RED';
  const lines = [
    `${head} — passed ${x.passed}, failed ${x.failed}, pending ${x.pending}, total ${x.total}`,
  ];
  if (x.undefinedSteps.length) lines.push(`  undefined steps: ${x.undefinedSteps.join(', ')}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main(argv) {
  const [cmd, ...rest] = argv;
  const wantsJson = rest.includes('--json');
  try {
    if (cmd === 'generate-bindings') {
      const r = runGenerate(rest);
      console.log(wantsJson ? JSON.stringify(r, null, 2) : reportGenerate(r));
      return 0;
    }
    if (cmd === 'migrate-bindings') {
      const r = runMigrate(rest);
      console.log(wantsJson ? JSON.stringify(r, null, 2)
        : `${r.dryRun ? 'Would migrate' : 'Migrated'} ${r.changed.length} binding file(s); method bodies preserved.`);
      return 0;
    }
    if (cmd === 'check-binding-drift') {
      const r = runCheckDrift(rest);
      console.log(wantsJson ? JSON.stringify(r, null, 2) : reportDrift(r));
      if (r.noBindings) return 1;
      return r.drift.inSync ? 0 : 2;
    }
    if (cmd === 'run') {
      const r = runRun(rest);
      console.log(wantsJson ? JSON.stringify({ ...r, raw: undefined }, null, 2) : reportRun(r));
      return r.green ? 0 : 2;
    }
    console.error(
      'Usage: reqnroll-cli <generate-bindings|migrate-bindings|check-binding-drift|run> [...] (see header)'
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

module.exports = { main, runGenerate, runMigrate, runCheckDrift, runRun };
