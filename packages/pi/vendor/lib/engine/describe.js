'use strict';

/**
 * TRD-002 (TRD-2026-d571763f): discovery -- `--describe` and `--help`.
 *
 * `describe` is how a planning model learns what the engine can do without reading prose, so it
 * publishes exactly the declared registry fields and refuses, naming the verb, when one of them
 * is missing or empty. A describe that quietly omitted a half-declared verb would be a check
 * that cannot fail (Constitution Rule 7).
 *
 * Help text is built from the same registry fields -- there are no hand-written help strings to
 * drift out of date.
 */

const { BOOLEAN_GLOBALS, VALUE_GLOBALS } = require('./argv');

/** The fields `--describe` publishes for each verb, in the order it emits them. */
const DESCRIBE_FIELDS = Object.freeze(
  [
    'exitCodes',
    'group',
    'inputSchema',
    'name',
    'outputSchema',
    'policyKeys',
    'sideEffect',
    'summary',
  ].sort()
);

function isEmptySchema(schema) {
  return (
    !schema ||
    typeof schema !== 'object' ||
    Array.isArray(schema) ||
    Object.keys(schema).length === 0
  );
}

/**
 * @param {{verbs: Function}} registry
 * @returns {{verbs: object[]}} every registered verb, sorted by group then name
 * @throws {Error} naming the verb when its input or output schema is missing or empty
 */
function describe(registry) {
  const verbs = registry.verbs().map(spec => {
    for (const field of ['inputSchema', 'outputSchema']) {
      if (isEmptySchema(spec[field])) {
        const err = new Error(`verb '${spec.group} ${spec.name}' has no ${field}; cannot describe it`);
        err.code = 'INCOMPLETE_VERB';
        err.status = 'REFUSED';
        throw err;
      }
    }
    const entry = {};
    for (const field of DESCRIBE_FIELDS) entry[field] = spec[field];
    return entry;
  });
  return { verbs };
}

/** @returns {string[]} one usage line per global flag, from the parser's own tables */
function globalFlagLines() {
  return [
    ...Object.keys(BOOLEAN_GLOBALS).map(flag => `  ${flag}`),
    ...Object.keys(VALUE_GLOBALS).map(flag => `  ${flag} <value>`),
  ].sort();
}

/**
 * @param {{verbs: Function}} registry
 * @param {string} group
 * @returns {string} help text listing the group's verbs
 */
function renderGroupHelp(registry, group) {
  const lines = [`ensemble ${group} <verb> [flags]`, '', 'Verbs:'];
  for (const spec of registry.verbs(group)) {
    lines.push(`  ${spec.group} ${spec.name} (${spec.sideEffect}) -- ${spec.summary}`);
  }
  lines.push('', 'Global flags:', ...globalFlagLines());
  return `${lines.join('\n')}\n`;
}

/**
 * @param {{get: Function}} registry
 * @param {string} group
 * @param {string} verb
 * @returns {string} help text for one verb
 */
function renderVerbHelp(registry, group, verb) {
  const spec = registry.get(group, verb);
  const lines = [
    `ensemble ${group} ${verb} [flags]`,
    '',
    spec.summary,
    '',
    `Side effect: ${spec.sideEffect}`,
    `Policy keys: ${spec.policyKeys.length === 0 ? '(none)' : spec.policyKeys.join(', ')}`,
    `Exit codes: ${spec.exitCodes.join(', ')}`,
    '',
    'Input schema:',
    JSON.stringify(spec.inputSchema, null, 2),
    '',
    'Global flags:',
    ...globalFlagLines(),
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * Levenshtein distance between two strings.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function distance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, index) => index);
  for (let i = 1; i < rows; i += 1) {
    const current = [i];
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[cols - 1];
}

/**
 * @param {{verbs: Function}} registry
 * @param {string|null} group
 * @param {string|null} verb
 * @returns {string[]} up to three `"group verb"` strings closest to what was typed
 */
function nearestVerbs(registry, group, verb) {
  const typed = [group, verb].filter(Boolean).join(' ');
  return registry
    .verbs()
    .map(spec => `${spec.group} ${spec.name}`)
    .map(name => ({ name, score: distance(typed, name) }))
    .sort((a, b) => (a.score === b.score ? (a.name < b.name ? -1 : 1) : a.score - b.score))
    .slice(0, 3)
    .map(entry => entry.name);
}

module.exports = {
  DESCRIBE_FIELDS,
  describe,
  nearestVerbs,
  renderGroupHelp,
  renderVerbHelp,
};
