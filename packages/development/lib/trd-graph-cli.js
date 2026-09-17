#!/usr/bin/env node
'use strict';

/**
 * TRD dependency-graph + overlap CLI.
 *
 * Thin argv layer over lib/trd-graph.js. Accepts a directory (scans *.md) or an
 * explicit list of TRD paths. Slash commands shell out to this; nothing is
 * hand-parsed.
 *
 * Subcommands:
 *   graph        <dir|paths...> [--format json|mermaid|dot]   (default json)
 *   overlap      <dir|paths...> [--json]
 *   capabilities <dir|paths...> [--json]   (foundational-TRD capability index)
 *
 * Exit codes:
 *   0  success (graph emitted / no overlaps)
 *   1  usage or read error
 *   2  graph: a dependency cycle was detected; overlap: overlaps found
 *      (both are gate-able signals)
 */

const fs = require('fs');
const path = require('path');

const {
  buildRegistry,
  buildGraph,
  findOverlaps,
  findCapabilityProviders,
  emitJson,
  emitMermaid,
  emitDot,
} = require('./trd-graph');

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

/** Expand positionals (dirs -> *.md, files -> themselves) into {path, markdown}. */
function collectEntries(positionals) {
  const targets = positionals && positionals.length ? positionals : ['docs/TRD'];
  const files = [];
  for (const t of targets) {
    let stat;
    try {
      stat = fs.statSync(t);
    } catch (err) {
      if (err && err.code === 'ENOENT' && t === 'docs/TRD') continue;
      throw new Error(`Cannot access '${t}': ${err.message}`);
    }
    if (stat.isDirectory()) {
      for (const f of fs.readdirSync(t)) {
        if (f.endsWith('.md')) files.push(path.join(t, f));
      }
    } else {
      files.push(t);
    }
  }
  // Deterministic order.
  files.sort();
  return files.map((p) => ({ path: p, markdown: fs.readFileSync(p, 'utf8') }));
}

function runGraph(argv) {
  const { positionals, flags } = parseArgs(argv, new Set(['format']));
  const entries = collectEntries(positionals);
  const graph = buildGraph(buildRegistry(entries));
  const format = (flags.format || 'json').toLowerCase();
  let out;
  if (format === 'mermaid') out = emitMermaid(graph);
  else if (format === 'dot') out = emitDot(graph);
  else out = emitJson(graph);
  return { output: out, cycles: graph.cycles, warnings: graph.warnings };
}

function runCapabilities(argv) {
  const { positionals, flags } = parseArgs(argv, new Set());
  const entries = collectEntries(positionals);
  const caps = findCapabilityProviders(buildRegistry(entries));
  if (flags.json) return { output: JSON.stringify({ capabilities: caps }, null, 2) + '\n', caps };
  const lines = caps.length
    ? caps.map(
        (c) => `${c.capability}: ${c.providers.map((p) => `${p.label} (${p.kind})`).join(', ')}`
      )
    : ['No capabilities declared across TRDs.'];
  return { output: lines.join('\n') + '\n', caps };
}

function runOverlap(argv) {
  const { positionals, flags } = parseArgs(argv, new Set());
  const entries = collectEntries(positionals);
  const overlaps = findOverlaps(buildRegistry(entries));
  if (flags.json) return { output: JSON.stringify({ overlaps }, null, 2) + '\n', overlaps };
  const lines = overlaps.length
    ? overlaps.map(
        (o) =>
          `~ ${o.a.label} <-> ${o.b.label} (${o.sharedCount} shared): ${o.sharedFiles.join(', ')}`
      )
    : ['No overlapping target files across TRDs.'];
  return { output: lines.join('\n') + '\n', overlaps };
}

function main(argv) {
  const [cmd, ...rest] = argv;
  try {
    if (cmd === 'graph') {
      const r = runGraph(rest);
      process.stdout.write(r.output);
      for (const w of r.warnings) process.stderr.write(`warning: ${w}\n`);
      return r.cycles.length ? 2 : 0;
    }
    if (cmd === 'overlap') {
      const r = runOverlap(rest);
      process.stdout.write(r.output);
      return r.overlaps.length ? 2 : 0;
    }
    if (cmd === 'capabilities') {
      const r = runCapabilities(rest);
      process.stdout.write(r.output);
      return 0;
    }
    process.stderr.write('Usage: trd-graph-cli <graph|overlap|capabilities> <dir|paths...> [--format json|mermaid|dot] [--json]\n');
    return 1;
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    return 1;
  }
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { main, collectEntries, runGraph, runOverlap, runCapabilities };
