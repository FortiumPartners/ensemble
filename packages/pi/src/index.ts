#!/usr/bin/env node
/**
 * Ensemble Plugin for Pi — Generator CLI Entry Point
 *
 * Parses CLI flags (--dry-run, --verbose, --validate), invokes the generator
 * orchestrator, and maps exit codes to success/failure.
 *
 * Usage:
 *   node dist/index.js [--dry-run] [--verbose] [--validate]
 *
 * Exit codes:
 *   0 — success
 *   1 — error (missing required fields, YAML parse error, I/O error)
 *
 * @module ensemble-pi
 * @see {@link https://github.com/FortiumPartners/ensemble}
 */

import { GeneratorOptions } from './types';
import { generate } from './generator';
import * as path from 'path';

const args = process.argv.slice(2);

const options: GeneratorOptions = {
  dryRun: args.includes('--dry-run'),
  verbose: args.includes('--verbose'),
  validate: args.includes('--validate'),
  sourceRoot: process.cwd(),
  outputRoot: path.join(__dirname, '..'),
};

generate(options)
  .then(() => {
    process.exit(0);
  })
  .catch((err: Error) => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  });
