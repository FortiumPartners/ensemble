'use strict';

/**
 * complete-beads-cli.js
 *
 * Strict JSON adapter for the complete-beads planner.
 * Reads BV JSON output from files, validates structure, and calls the planner.
 *
 * Usage:
 *   node complete-beads-cli.js \
 *     --triage /path/to/triage.json \
 *     --plan   /path/to/plan.json \
 *     --ready  /path/to/ready.json \
 *     --open   /path/to/open.json \
 *     --inprogress /path/to/inprogress.json \
 *     --slots  3 \
 *     --phase-task-ids /path/to/phase-task-ids.json \
 *     --pr-format \
 *     --scope-prefix "trd:my-trd"
 *
 * Exits 0 with JSON plan on success.
 * Exits 1 with error message on failure.
 */

const fs = require('fs');
const path = require('path');
const { planDispatch } = require('./complete-beads-planner');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    triage: null,
    plan: null,
    ready: null,
    open: null,
    inprogress: null,
    closed: null,
    slots: 1,
    phaseTaskIds: null,
    prFormat: false,
    scopePrefix: '',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--triage' || arg === '-t') args.triage = argv[++i];
    else if (arg === '--plan' || arg === '-p') args.plan = argv[++i];
    else if (arg === '--ready' || arg === '-r') args.ready = argv[++i];
    else if (arg === '--open' || arg === '-o') args.open = argv[++i];
    else if (arg === '--inprogress' || arg === '-i') args.inprogress = argv[++i];
    else if (arg === '--closed' || arg === '-c') args.closed = argv[++i];
    else if (arg === '--slots' || arg === '-s') args.slots = parseInt(argv[++i], 10);
    else if (arg === '--phase-task-ids') args.phaseTaskIds = argv[++i];
    else if (arg === '--pr-format') args.prFormat = true;
    else if (arg === '--scope-prefix') args.scopePrefix = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(fs.readFileSync(__filename, 'utf-8').split('\n').slice(0, 20).join('\n'));
      process.exit(0);
    }
  }

  return args;
}

// ---------------------------------------------------------------------------
// File reading with strict validation
// ---------------------------------------------------------------------------

/**
 * Read and parse a JSON file. Returns null if file does not exist (not an error).
 * Throws if file exists but is malformed JSON.
 */
function readJsonFile(filePath) {
  if (!filePath) return null;
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  try {
    return JSON.parse(content);
  } catch (err) {
    throw new Error(`complete-beads-cli: failed to parse JSON file ${filePath}: ${err.message}`);
  }
}

/**
 * Validate that a value is an array of bead-like objects.
 * Returns [] if null/undefined, throws on malformed data.
 */
function validateBeadArray(data, fieldName) {
  if (data == null) return [];
  if (!Array.isArray(data)) {
    throw new Error(`complete-beads-cli: ${fieldName} must be an Array`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Main
function main(argv) {
  const args = parseArgs(argv);
  const { slots, prFormat } = args;

  // Read all input files
  const triageJson = readJsonFile(args.triage);
  const planJson = readJsonFile(args.plan);
  const readyJson = readJsonFile(args.ready);
  const openJson = readJsonFile(args.open);
  const inProgressJson = readJsonFile(args.inprogress);
  const closedJson = readJsonFile(args.closed);
  const phaseTaskIdsJson = readJsonFile(args.phaseTaskIds);

  // Validate required inputs when ready work exists
  const readyBeads = validateBeadArray(readyJson, '--ready');
  const openBeads = validateBeadArray(openJson, '--open');
  const inProgressBeads = validateBeadArray(inProgressJson, '--inprogress');
  const closedBeads = validateBeadArray(closedJson, '--closed');

  // Fail closed: if ready work exists but triage or plan is missing/malformed
  if (readyBeads.length > 0) {
    if (!triageJson || typeof triageJson !== 'object') {
      const err = new Error('complete-beads-cli: bv --robot-triage JSON required when ready work exists');
      process.stderr.write(`ERROR: ${err.message}\n`);
      process.exit(1);
    }
    if (!planJson || typeof planJson !== 'object') {
      const err = new Error('complete-beads-cli: bv --robot-plan JSON required when ready work exists');
      process.stderr.write(`ERROR: ${err.message}\n`);
      process.exit(1);
    }
  }

  const phaseTaskIds = phaseTaskIdsJson || {};
  const opts = { prFormat };

  try {
    const result = planDispatch(
      triageJson,
      planJson,
      readyBeads,
      openBeads,
      inProgressBeads,
      closedBeads,
      slots,
      phaseTaskIds,
      opts
    );

    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(0);
  } catch (err) {
    process.stderr.write(`ERROR: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { planDispatch, readJsonFile, validateBeadArray };
