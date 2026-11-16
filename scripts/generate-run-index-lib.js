#!/usr/bin/env node
'use strict';

/**
 * Generate packages/development/lib/run-index/ from the agent-core run-index stores.
 *
 * `ensemble-fix-issue` and `ensemble-new-feature` checkpoint through TypeScript stores in
 * packages/agent-core, which no plugin install ships. This compiles the stores (and the
 * modules they import) to CommonJS with the repo's own `typescript`, so the two hand-written
 * CLIs beside the output (lib/issue-run-index-cli.js, lib/run-index-cli.js) run them as they
 * are: one source of truth, no port to drift. The output is committed; `--check` (wired into
 * `npm run generate:validate`) fails when it no longer matches a fresh build.
 *
 * The program is built and emitted in memory, so generating and checking share one code path
 * and `--check` never writes. Output is a function of the sources and the installed
 * TypeScript version.
 *
 * Usage: node scripts/generate-run-index-lib.js [--check]
 *   --check  report missing, extra or changed files and exit 1, writing nothing
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const REPO_ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(REPO_ROOT, 'packages', 'agent-core', 'src');
const OUT_DIR = path.join(REPO_ROOT, 'packages', 'development', 'lib', 'run-index');

/** Roots of the compile; everything they import (run-index-core, both types.ts) comes along. */
const ENTRY_SOURCES = ['fix-issue/issue-run-index.ts', 'new-feature/run-index.ts'];

/** First line of every generated file, before "use strict" so the directive stays first. */
const header = relSource =>
  `// DO NOT EDIT - generated from packages/agent-core/src/${relSource} by scripts/generate-run-index-lib.js (npm run generate)\n`;

/**
 * Compile the stores in memory.
 *
 * @param {object} [options]
 * @param {string} [options.srcDir] agent-core source root
 * @returns {Map<string, string>} output path relative to the output dir -> file text
 * @throws {Error} on any TypeScript diagnostic
 */
function build({ srcDir = SRC_DIR } = {}) {
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    lib: ['lib.es2024.d.ts'],
    rootDir: srcDir,
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    forceConsistentCasingInFileNames: true,
    // No tslib at runtime: the compiled files must load with nothing but node.
    importHelpers: false,
    declaration: false,
    sourceMap: false,
    removeComments: false,
    // Resolve @types/node from the repo's node_modules, not from the source dir's ancestors.
    typeRoots: [path.join(REPO_ROOT, 'node_modules', '@types')],
    types: ['node'],
  };
  const program = ts.createProgram(ENTRY_SOURCES.map(rel => path.join(srcDir, rel)), options);

  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length > 0) {
    const host = { getCanonicalFileName: f => f, getCurrentDirectory: () => REPO_ROOT, getNewLine: () => '\n' };
    throw new Error(`TypeScript errors compiling the run-index stores:\n${ts.formatDiagnostics(diagnostics, host)}`);
  }

  const files = new Map();
  const emitResult = program.emit(undefined, (fileName, text) => {
    // rootDir has no outDir here, so the emit path sits beside its source.
    const sourceRel = path.relative(srcDir, fileName).split(path.sep).join('/');
    files.set(sourceRel, header(sourceRel.replace(/\.js$/, '.ts')) + text);
  });
  if (emitResult.emitSkipped) throw new Error('TypeScript skipped emitting the run-index stores');
  return files;
}

/** Every regular file under `dir` as a posix path relative to it (empty if `dir` is absent). */
function listFiles(dir, prefix = '') {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

/**
 * Compare the committed output against a fresh build.
 *
 * @param {object} [options]
 * @param {string} [options.outDir] directory holding the committed output
 * @param {string} [options.srcDir] agent-core source root
 * @returns {string[]} one message per problem; empty means no drift
 */
function check({ outDir = OUT_DIR, srcDir = SRC_DIR } = {}) {
  const expected = build({ srcDir });
  const problems = [];
  const present = new Set(listFiles(outDir));
  for (const [rel, text] of expected) {
    if (!present.has(rel)) {
      problems.push(`${rel}: missing - run \`npm run generate\``);
      continue;
    }
    present.delete(rel);
    if (fs.readFileSync(path.join(outDir, rel), 'utf8') !== text) {
      problems.push(`${rel}: differs from a fresh build of packages/agent-core/src - run \`npm run generate\` (never edit it by hand)`);
    }
  }
  for (const rel of present) problems.push(`${rel}: not produced by the build - run \`npm run generate\` to remove it`);
  return problems;
}

/** Write the fresh build and drop files it no longer produces. */
function generate({ outDir = OUT_DIR, srcDir = SRC_DIR } = {}) {
  const expected = build({ srcDir });
  for (const [rel, text] of expected) {
    const dest = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text);
  }
  for (const rel of listFiles(outDir)) {
    if (!expected.has(rel)) fs.rmSync(path.join(outDir, rel), { force: true });
  }
  return [...expected.keys()].sort();
}

function main() {
  if (process.argv.includes('--check')) {
    const problems = check();
    if (problems.length > 0) {
      problems.forEach(p => console.error(`✗ packages/development/lib/run-index/${p}`));
      process.exitCode = 1;
      return;
    }
    console.log('✓ packages/development/lib/run-index/ matches a fresh build of the agent-core run-index stores');
    return;
  }
  const written = generate();
  console.log(`✓ generated ${written.length} file(s) into packages/development/lib/run-index/`);
}

if (require.main === module) main();

module.exports = { ENTRY_SOURCES, OUT_DIR, build, check, generate };
