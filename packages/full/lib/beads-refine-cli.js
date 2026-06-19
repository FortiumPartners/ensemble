#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { normalizeGraph, resolveScope, subtreeIds } = require('./beads-scope');
const { detectFindings, summarizeFindings } = require('./beads-findings');
const { buildRepairPlan, renderSummary } = require('./beads-repair-plan');
const { verifyRepair } = require('./beads-repair-verify');

function readJson(file) {
  if (!file || file === '-') return JSON.parse(fs.readFileSync(0, 'utf8'));
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith('--')) {
      const key = tok.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(tok);
    }
  }
  return { positionals, flags };
}

function runAnalyze(argv) {
  const { flags } = parseArgs(argv);
  const input = readJson(flags['issues-json'] || flags.input || '-');
  const graph = normalizeGraph(input);
  let scopeIds = new Set(graph.beads.map((b) => b.id));
  let scope = null;
  if (flags.scope || flags.query) {
    scope = resolveScope(input, flags.query || flags.scope, { scope: flags.scope === 'project' ? 'project' : undefined });
    if (!scope.ok) return { ok: false, error: scope.error, candidates: scope.candidates };
    if (scope.root) {
      scopeIds = subtreeIds(graph, scope.root.id);
      const slugMatch = String(scope.root.titlePrefix || '').match(/^\[trd:([^:\]]+)\]$/);
      if (slugMatch) {
        for (const bead of graph.beads) {
          if (String(bead.titlePrefix || '').startsWith(`[trd:${slugMatch[1]}:`)) scopeIds.add(bead.id);
        }
      }
    }
  }
  const bvData = flags['bv-json'] ? readJson(flags['bv-json']) : null;
  const findings = detectFindings(graph, { rootId: scope && scope.root && scope.root.id, scopeIds, bvData });
  const repairPlan = buildRepairPlan(findings);
  return { ok: true, scope: scope && { mode: scope.mode, root: scope.root && scope.root.id, warning: scope.warning }, findings, findingsSummary: summarizeFindings(findings), repairPlan };
}

function runVerify(argv) {
  const { flags } = parseArgs(argv);
  const input = readJson(flags['issues-json'] || flags.input || '-');
  const verify = flags.verify ? JSON.parse(flags.verify) : readJson(flags['verify-json']);
  return verifyRepair(input, verify);
}

function runPlan(argv) {
  const { flags } = parseArgs(argv);
  const findings = readJson(flags.findings || flags.input || '-');
  return buildRepairPlan(Array.isArray(findings) ? findings : findings.findings || []);
}

function runSummary(argv) {
  const { flags } = parseArgs(argv);
  return { ok: true, summary: renderSummary(readJson(flags.input || '-')) };
}

const HANDLERS = { analyze: runAnalyze, plan: runPlan, verify: runVerify, summary: runSummary };

function main(argv) {
  const sub = argv[0];
  const handler = HANDLERS[sub];
  if (!handler) {
    process.stdout.write(JSON.stringify({ error: `Unknown subcommand '${sub || ''}'` }) + '\n');
    return 1;
  }
  try {
    process.stdout.write(JSON.stringify(handler(argv.slice(1))) + '\n');
    return 0;
  } catch (err) {
    process.stdout.write(JSON.stringify({ error: err.message || String(err) }) + '\n');
    return 1;
  }
}

module.exports = { runAnalyze, runPlan, runVerify, runSummary, main, parseArgs };

if (require.main === module) process.exit(main(process.argv.slice(2)));
