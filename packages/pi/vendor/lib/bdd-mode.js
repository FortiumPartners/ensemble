'use strict';

/**
 * bdd-mode.js — decide whether a TRD run uses the Reqnroll/BDD test path.
 *
 * BDD stays ON by default, exactly as before this was configurable; this only gives a repo a way to
 * opt out (a Playwright + xUnit repo, a Node or Rails repo). `create-trd` and `implement-trd-beads`
 * both call `trd-cli resolve-bdd`, which wraps `resolveBdd` below, so the two commands always agree.
 * First match wins:
 *
 *   1. `flag`     — `--bdd` / `--no-bdd` (create-trd only; the CLI maps them to 'bdd' | 'no-bdd')
 *   2. `env`      — ENSEMBLE_BDD = 1|true|on|yes (on) or 0|false|off|no (off)
 *   3. `trd`      — the TRD's `test_approach` frontmatter (`bdd-reqnroll` | `standard`), which
 *                   create-trd writes when the choice was explicit (flag or env) so the TRD stays
 *                   self-describing and implement-trd-beads honours an opt-out without the env var
 *   4. `default`  — on
 *
 * Whichever source decides, nothing found on the way is dropped: an unrecognised ENSEMBLE_BDD or
 * `test_approach` value (ignored) and a TRD that cannot be read (its stamp was not consulted) are each
 * reported as a warning. `trd-cli resolve-bdd` goes further for an explicit `--trd` that cannot be read
 * and makes it an error.
 *
 * Pure and injectable (`env`) so tests never touch process state.
 */

const fs = require('fs');
const path = require('path');
const { scanFrontmatter, normalizeLineEndings, getFrontmatterField } = require('./trd-parser');

const ENV_VAR = 'ENSEMBLE_BDD';
const STAMP_KEY = 'test_approach';
const STAMP_BDD = 'bdd-reqnroll';
const STAMP_STANDARD = 'standard';

const ENV_ON = new Set(['1', 'true', 'on', 'yes']);
const ENV_OFF = new Set(['0', 'false', 'off', 'no']);

const toPosix = (p) => p.split(path.sep).join('/');

/** @returns {boolean|null} true/false for a recognised value, null when unset or unrecognised */
function parseEnv(value) {
  if (value == null) return null;
  const v = String(value).trim().toLowerCase();
  if (ENV_ON.has(v)) return true;
  if (ENV_OFF.has(v)) return false;
  return null;
}

/**
 * Read the TRD's `test_approach` frontmatter. The frontmatter may sit under an H1 or an HTML comment, as
 * several TRDs under docs/TRD/ do, so it is found with scanFrontmatter rather than by requiring `---` on line 1.
 * @returns {{value:boolean|null, raw:string|null, unreadable?:string}} `unreadable` is why the file could not be read
 */
function readStamp(trdPath) {
  let text;
  try {
    text = fs.readFileSync(trdPath, 'utf8');
  } catch (err) {
    return { value: null, raw: null, unreadable: err.code || err.message };
  }
  const { frontmatter } = scanFrontmatter(normalizeLineEndings(text));
  const raw = getFrontmatterField(frontmatter, STAMP_KEY);
  if (raw == null || String(raw).trim() === '') return { value: null, raw: null };
  const v = String(raw).trim().toLowerCase();
  if (v === STAMP_BDD) return { value: true, raw: v };
  if (v === STAMP_STANDARD) return { value: false, raw: v };
  return { value: null, raw: String(raw) };
}

/**
 * Build the result. `message` is the text the commands print (a `Warning:` line for each warning, then the
 * approach), so the wording lives here rather than in two command prompts. The default says how to opt out.
 * @param {string[]} warnings
 */
function decide(enabled, source, evidence, warnings) {
  const out = { enabled, source };
  if (evidence) out.evidence = evidence;
  if (warnings.length) out.warning = warnings.join('\n');
  // implement-trd-beads has no --no-bdd flag, so the hint names the one opt-out both commands share.
  const where = source === 'default' ? 'default; opt out with ENSEMBLE_BDD=0, or --no-bdd on create-trd' : source;
  out.message = `${warnings.map((w) => `Warning: ${w}\n`).join('')}Test approach: ${enabled ? 'BDD (Reqnroll)' : 'standard'} [${where}]`;
  return out;
}

/**
 * @param {object} [opts]
 * @param {'bdd'|'no-bdd'} [opts.flag]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {string} [opts.trdPath]   consult this TRD's `test_approach`
 * @returns {{enabled:boolean, source:'flag'|'env'|'trd'|'default', evidence?:string, warning?:string, message:string}}
 *   `warning` holds one line per warning
 */
function resolveBdd(opts = {}) {
  const { flag, env = process.env, trdPath } = opts;
  const warnings = [];

  // Every input is checked and every problem reported before precedence picks the winner, so a warning is
  // never lost because a higher-precedence source decided.
  const envRaw = env[ENV_VAR];
  const envValue = parseEnv(envRaw);
  if (envValue === null && envRaw != null && String(envRaw).trim() !== '') {
    warnings.push(`${ENV_VAR}='${envRaw}' is not one of 1/true/on/yes or 0/false/off/no; ignored`);
  }

  const where = trdPath ? toPosix(trdPath) : undefined;
  let stamp = { value: null, raw: null };
  if (trdPath) {
    stamp = readStamp(trdPath);
    if (stamp.unreadable) {
      warnings.push(`cannot read ${where} (${stamp.unreadable}); its ${STAMP_KEY} was not consulted`);
    } else if (stamp.value === null && stamp.raw !== null) {
      warnings.push(`${STAMP_KEY} '${stamp.raw}' in ${where} is not '${STAMP_BDD}' or '${STAMP_STANDARD}'; ignored`);
    }
  }

  if (flag === 'bdd' || flag === 'no-bdd') return decide(flag === 'bdd', 'flag', undefined, warnings);
  if (envValue !== null) return decide(envValue, 'env', undefined, warnings);
  if (stamp.value !== null) return decide(stamp.value, 'trd', where, warnings);
  return decide(true, 'default', undefined, warnings);
}

module.exports = { resolveBdd, ENV_VAR, STAMP_KEY, STAMP_BDD, STAMP_STANDARD };
