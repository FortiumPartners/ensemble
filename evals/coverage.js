#!/usr/bin/env node
'use strict';

/**
 * Skill coverage report: every shipped skill is evaluated, exempt (with a reason in evals/exemptions.json) or missing.
 * Usage: node evals/coverage.js [--json] [--strict]
 * Exit: 0 report produced (missing skills are reported, not gating, unless --strict); 1 --strict and at least one skill is
 *       missing; 2 usage error or the report cannot be trusted (stale/duplicate exemption, unreadable exemptions file,
 *       invalid skill directory). 2 outranks 1.
 */

const { computeCoverage, formatCoverage } = require('./lib/coverage');

function main(argv = process.argv.slice(2), opts = {}) {
  const flags = new Set();
  for (const a of argv) {
    if (a !== '--json' && a !== '--strict') { console.error(`unknown argument: ${a}`); return 2; }
    flags.add(a);
  }
  let cov;
  try { cov = computeCoverage(opts); } catch (e) { console.error(e.message); return 2; }
  console.log(flags.has('--json') ? JSON.stringify(cov, null, 2) : formatCoverage(cov));
  if (cov.errors.length) return 2;
  return flags.has('--strict') && cov.counts.missing > 0 ? 1 : 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { main };
