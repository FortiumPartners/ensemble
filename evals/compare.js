#!/usr/bin/env node
'use strict';

/**
 * Compare a finished suite log with the committed baselines, like for like (same runtime, model, eval version and repeats).
 * Usage: node evals/compare.js [--results FILE] [--baselines DIR] [--skill NAME] [--json]
 *   --results   a suite log (default: the newest *.json in evals/results, or EVALS_RESULTS_DIR)
 *   --baselines the committed summaries (default: evals/baselines, or EVALS_BASELINES_DIR)
 * Read-only: writes nothing. Exit: 0 every eval comparable with no regression, or not comparable (a notice is printed, no regression claimed);
 *   1 a regression (a committed reliable eval is no longer reliable; names skill and eval); 2 the log or a baseline cannot be read or is
 *   malformed (outranks 1); 4 an incomplete result, or nothing was compared (never a silent pass). Precedence 2 > 1 > 4.
 */

const path = require('path');
const results = require('./lib/results');
const cmp = require('./lib/compare');

const RESULTS_DIR = process.env.EVALS_RESULTS_DIR || path.join(__dirname, 'results');
const BASELINES_DIR = process.env.EVALS_BASELINES_DIR || (process.env.EVALS_RESULTS_DIR ? path.join(path.dirname(process.env.EVALS_RESULTS_DIR), 'baselines') : results.BASELINES_DIR);

function parse(argv) {
  const o = { results: null, baselines: null, skill: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--results' || a === '--baselines' || a === '--skill') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`${a} needs a value`);
      o[a.slice(2)] = v;
    } else throw new Error(`unknown argument: ${a}`);
  }
  return o;
}

function main(argv = process.argv.slice(2), env = {}) {
  const resultsDir = env.resultsDir || RESULTS_DIR;
  const baselinesDir = env.baselinesDir || BASELINES_DIR;
  let opts;
  try { opts = parse(argv); } catch (e) { console.error(results.stripControl(e.message)); return 2; }
  let doc;
  let file;
  try {
    file = opts.results ? path.resolve(opts.results) : cmp.latestLog(resultsDir);
    doc = cmp.loadLog(file);
  } catch (e) {
    if (!(e instanceof cmp.CompareError || e instanceof results.ResultError)) throw e;
    console.error(results.stripControl(e.message));
    return 2;
  }
  const result = cmp.compareLog(doc, { baselinesDir: opts.baselines ? path.resolve(opts.baselines) : baselinesDir, skill: opts.skill });
  console.log(opts.json ? JSON.stringify({ log: path.basename(file), ...result, exit: cmp.exitCode(result) }, null, 2) : `comparing ${path.basename(file)} with the committed baselines\n${cmp.formatComparison(result)}`);
  const code = cmp.exitCode(result);
  if (code === 1) console.error(results.stripControl(`${result.entries.filter((e) => e.status === 'regression').length} regression(s): ${result.entries.filter((e) => e.status === 'regression').map((e) => `${e.skill}/${e.evalId}`).join(', ')}`));
  if (code === 4 && !result.entries.length) console.error('nothing was compared: the log has no skill eval (or --skill matched none)');
  return code;
}

if (require.main === module) {
  try { process.exitCode = main(); } catch (e) { console.error(results.stripControl(e.message)); process.exitCode = 2; }
}

module.exports = { main, parse };
