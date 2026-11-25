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
 * A native verb declares its own flags, so the parser has to be told them -- but only after the
 * group and the verb are known, which is why the table is supplied as a callback rather than
 * up front. Before the verb is known a `--flag` is still `UNKNOWN_FLAG`: a verb's flag written
 * ahead of its verb is a mistake, not a different spelling.
 *
 * @param {string[]} argv
 * @param {{verbFlags?: (group: string, verb: string) => object|null}} [options] when
 *   `verbFlags` is absent the result is exactly what it was before native verbs existed, which
 *   is what keeps mounted legacy groups byte-identical (TRD-003)
 * @returns {{group: string|null, verb: string|null, help: boolean, describe: boolean, globals: object, rest: string[], operands: string[], verbFlags: object, error: {code: string, message: string}|null}}
 */
function parseArgv(argv, options = {}) {
  const result = {
    describe: false,
    error: null,
    globals: { json: false, nonInteractive: false, projectRoot: null, runId: null },
    group: null,
    help: false,
    operands: [],
    rest: [],
    verb: null,
    verbFlags: {},
  };

  const positionals = [];
  let restStart = -1;
  /** The verb's own flag table, looked up once the second positional is in hand. */
  let flagTable = null;

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

    // Only an own property of the flag table is a declared flag: an inherited name (`constructor`
    // and friends) is not a flag of this verb and must read as unknown.
    const flagName = flag.startsWith('--') ? flag.slice(2) : null;
    const declared =
      flagTable && flagName !== null && Object.prototype.hasOwnProperty.call(flagTable, flagName)
        ? flagTable[flagName]
        : null;
    if (declared) {
      const name = flagName;
      if (declared.type === 'boolean') {
        if (inlineValue !== null) {
          result.error = parseError('INVALID_FLAG_VALUE', `flag '${flag}' takes no value`);
          break;
        }
        if (Object.prototype.hasOwnProperty.call(result.verbFlags, declared.key)) {
          result.error = parseError('DUPLICATE_FLAG', `flag '${flag}' given more than once`);
          break;
        }
        result.verbFlags[declared.key] = true;
        continue;
      }

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
      if (declared.repeatable) {
        const existing = result.verbFlags[declared.key];
        result.verbFlags[declared.key] = Array.isArray(existing) ? [...existing, value] : [value];
      } else {
        if (Object.prototype.hasOwnProperty.call(result.verbFlags, declared.key)) {
          result.error = parseError('DUPLICATE_FLAG', `flag '--${name}' given more than once`);
          break;
        }
        result.verbFlags[declared.key] = value;
      }
      continue;
    }

    if (token.startsWith('-') && token !== '-') {
      result.error = parseError('UNKNOWN_FLAG', `unknown flag '${flag}'`);
      break;
    }

    if (positionals.length < 2) {
      positionals.push(token);
      if (positionals.length === 2) {
        restStart = index + 1;
        if (typeof options.verbFlags === 'function') {
          flagTable = options.verbFlags(positionals[0], positionals[1]) || null;
        }
      }
      continue;
    }

    // A non-flag token after the verb is an operand of a native verb; mounted groups read the
    // same token out of `rest`, which is untouched.
    result.operands.push(token);
  }

  result.group = positionals[0] === undefined ? null : positionals[0];
  result.verb = positionals[1] === undefined ? null : positionals[1];
  result.rest = restStart === -1 ? [] : argv.slice(restStart);
  return result;
}

module.exports = { BOOLEAN_GLOBALS, VALUE_GLOBALS, parseArgv };
