'use strict';

/**
 * TRD-002 (TRD-2026-d571763f): the verb registry.
 *
 * A verb is only usable once it has declared everything `--describe` must publish: its group,
 * name, summary, side-effect class, input schema, output schema, policy keys, exit codes and a
 * handler. `register` throws instead of accepting a partial spec, so an under-declared verb can
 * never reach the dispatcher and silently behave as if it had no side effects
 * (Constitution Rule 7 -- a check must be able to fail).
 */

const { assertNativeInputSchema } = require('./input');

/** The two side-effect classes a verb may declare. */
const SIDE_EFFECTS = Object.freeze(['read', 'write']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {object} spec
 * @throws {Error} naming the verb when a required field is missing or malformed
 */
function assertSpec(spec) {
  if (!isPlainObject(spec)) throw new Error('verb spec must be an object');
  const label = `${spec.group || '<no group>'} ${spec.name || '<no name>'}`;

  for (const field of ['group', 'name', 'summary']) {
    if (typeof spec[field] !== 'string' || spec[field].length === 0) {
      throw new Error(`verb '${label}' has no non-empty ${field}`);
    }
  }
  if (!SIDE_EFFECTS.includes(spec.sideEffect)) {
    throw new Error(
      `verb '${label}' has no declared side-effect class; expected one of ${SIDE_EFFECTS.join(', ')}`
    );
  }
  for (const field of ['inputSchema', 'outputSchema']) {
    if (!isPlainObject(spec[field])) {
      throw new Error(`verb '${label}' has no ${field}`);
    }
  }
  for (const field of ['policyKeys', 'exitCodes']) {
    if (!Array.isArray(spec[field])) {
      throw new Error(`verb '${label}' has no ${field} array`);
    }
  }
  if (typeof spec.handler !== 'function') {
    throw new Error(`verb '${label}' has no handler function`);
  }
}

/**
 * @returns {{register: Function, get: Function, groups: Function, verbs: Function}}
 */
function createRegistry() {
  /** @type {Map<string, object>} */
  const entries = new Map();

  /**
   * @param {object} spec
   * @returns {object} the registered spec
   */
  function register(spec) {
    assertSpec(spec);
    // A mounted legacy verb takes whatever the caller typed, so only a native verb's schema has
    // to be drivable from argv. Checking it here means an undrivable verb never reaches the
    // dispatcher at all (Constitution Rule 7).
    if (!spec.passthrough) assertNativeInputSchema(`${spec.group} ${spec.name}`, spec.inputSchema);
    const key = `${spec.group}:${spec.name}`;
    if (entries.has(key)) {
      throw new Error(`verb '${spec.group} ${spec.name}' is already registered`);
    }
    entries.set(key, spec);
    return spec;
  }

  /**
   * @param {string} group
   * @param {string} name
   * @returns {object|null}
   */
  function get(group, name) {
    return entries.get(`${group}:${name}`) || null;
  }

  /** @returns {string[]} every registered group, sorted */
  function groups() {
    return [...new Set([...entries.values()].map(spec => spec.group))].sort();
  }

  /**
   * @param {string} [group] when given, only that group's verbs
   * @returns {object[]} specs sorted by group then name
   */
  function verbs(group) {
    return [...entries.values()]
      .filter(spec => group === undefined || spec.group === group)
      .sort((a, b) => (a.group === b.group ? (a.name < b.name ? -1 : 1) : a.group < b.group ? -1 : 1));
  }

  return { get, groups, register, verbs };
}

module.exports = { SIDE_EFFECTS, createRegistry };
