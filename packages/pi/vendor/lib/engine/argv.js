'use strict';

/**
 * TRD-002 (TRD-2026-d571763f): the argv parser.
 *
 * Four global flags are recognised in any position, before or after the verb, in both
 * `--flag value` and `--flag=value` spellings, so the same call parses identically whichever
 * way a caller writes it. The first two non-flag tokens are the group and the verb; everything
 * after them is `rest`, handed to mounted groups untouched.
 *
 * An unrecognised flag is an error, never a shrug: `parseArgv` returns `error` and the caller
 * refuses with `INVALID_INPUT` before any handler runs (Constitution Rule 7).
 *
 * `rest` is the argv slice that follows `<group> <verb>` verbatim -- including any global flag
 * written there -- because mounted legacy groups must receive what the caller typed, byte for
 * byte, for their output to stay identical to the legacy CLI's. A parse error therefore stops
 * the scan but still finalises `group`, `verb` and `rest`, so the caller can tell an engine
 * verb's bad flag (refused) from a mounted legacy verb's own flag (passed through, TRD-003).
 */

/** Global flags that take no value. */
const BOOLEAN_GLOBALS = Object.freeze({
  '--json': 'json',
  '--non-interactive': 'nonInteractive',
});

/** Global flags that take a value. */
const VALUE_GLOBALS = Object.freeze({
  '--project-root': 'projectRoot',
  '--run-id': 'runId',
});

function parseError(code, message) {
  return { code, message };
}

/**
 * @param {string[]} argv
 * @returns {{group: string|null, verb: string|null, help: boolean, describe: boolean, globals: object, rest: string[], error: {code: string, message: string}|null}}
 */
function parseArgv(argv) {
  const result = {
    describe: false,
    error: null,
    globals: { json: false, nonInteractive: false, projectRoot: null, runId: null },
    group: null,
    help: false,
    rest: [],
    verb: null,
  };

  const positionals = [];
  let restStart = -1;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--describe') {
      result.describe = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      result.help = true;
      continue;
    }

    let flag = token;
    let inlineValue = null;
    if (token.startsWith('--') && token.includes('=')) {
      const split = token.indexOf('=');
      flag = token.slice(0, split);
      inlineValue = token.slice(split + 1);
    }

    if (Object.prototype.hasOwnProperty.call(BOOLEAN_GLOBALS, flag)) {
      if (inlineValue !== null) {
        result.error = parseError('INVALID_FLAG_VALUE', `flag '${flag}' takes no value`);
        break;
      }
      result.globals[BOOLEAN_GLOBALS[flag]] = true;
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(VALUE_GLOBALS, flag)) {
      let value = inlineValue;
      if (value === null) {
        index += 1;
        value = index < argv.length ? argv[index] : undefined;
      }
      if (value === undefined || value.length === 0 || value.startsWith('-')) {
        result.error = parseError(
          'MISSING_FLAG_VALUE',
          `flag '${flag}' expects a value, got '${value === undefined ? '' : value}'`
        );
        break;
      }
      result.globals[VALUE_GLOBALS[flag]] = value;
      continue;
    }

    if (token.startsWith('-') && token !== '-') {
      result.error = parseError('UNKNOWN_FLAG', `unknown flag '${flag}'`);
      break;
    }

    if (positionals.length < 2) {
      positionals.push(token);
      if (positionals.length === 2) restStart = index + 1;
    }
  }

  result.group = positionals[0] === undefined ? null : positionals[0];
  result.verb = positionals[1] === undefined ? null : positionals[1];
  result.rest = restStart === -1 ? [] : argv.slice(restStart);
  return result;
}

module.exports = { BOOLEAN_GLOBALS, VALUE_GLOBALS, parseArgv };
