'use strict';

/**
 * Per-adapter status vocabulary extension.
 *
 * An adapter manifest declares its provider's default status vocabulary twice: in
 * `parse.statusMap` (provider status name -> normalized status, the READ direction) and in its
 * run templates/variants (the provider status name written for a normalized status, the WRITE
 * direction). A repository whose provider workflow uses other status names extends that
 * vocabulary from its own `.ensemble/toolchain.yaml` instead of duplicating the adapter:
 *
 *   adapters:
 *     jira:
 *       statusMap:            # read: provider status name -> normalized status
 *         "Code Review": in_progress
 *       statusNames:          # write: normalized status -> provider status name
 *         open: Backlog
 *
 * The override is applied in the runner, so every caller (CLI, work-graph dispatch) honours it
 * and an adapter whose vocabulary is not overridden behaves exactly as before: the effective
 * status map, the spawned argv and the mapped output are unchanged.
 */

/**
 * The provider status name -> normalized status vocabulary an adapter itself declares, merged
 * across all of its capabilities (a manifest may repeat the same map per capability).
 *
 * @param {{capabilities?: Record<string, {parse?: {statusMap?: Record<string,string>}}>}} adapter
 *   a parsed adapter manifest
 * @returns {Record<string,string>} provider status name -> normalized status
 */
function declaredStatusMap(adapter) {
  const merged = {};
  const capabilities = (adapter && adapter.capabilities) || {};
  for (const capability of Object.values(capabilities)) {
    const statusMap = capability && capability.parse && capability.parse.statusMap;
    if (statusMap && typeof statusMap === 'object') {
      Object.assign(merged, statusMap);
    }
  }
  return merged;
}

/**
 * The provider status name -> normalized status index used to resolve WHICH normalized status a
 * command writes: the adapter's own vocabulary, then the repository's read-side overrides (a
 * repository may name a status only in `statusMap`).
 *
 * @param {Record<string,string>} declared the adapter's own vocabulary
 * @param {Record<string,string>} statusMap the repository's read-side overrides
 * @returns {Record<string,string>}
 */
function providerStatusIndex(declared, statusMap) {
  return { ...declared, ...statusMap };
}

/**
 * Rewrite the `--status` argument of one command line to the provider status name the
 * repository configured for that normalized status. Both spellings are handled: the separate
 * token form the adapter manifests use (`--status Done`) and the inline form
 * (`--status=Done`). Only the value of that one flag is ever touched. Returns the argv
 * unchanged when the command writes no status, when the written name is not part of any known
 * vocabulary, or when the repository configured no write-side name for it.
 *
 * @param {string[]} argv the already-substituted argv
 * @param {Record<string,string>} index provider status name -> normalized status
 * @param {Record<string,string>} statusNames normalized status -> provider status name
 * @returns {string[]}
 */
function rewriteStatusArg(argv, index, statusNames) {
  if (!Array.isArray(argv)) return argv;
  const separate = argv.indexOf('--status');
  const inline = argv.findIndex(
    (arg) => typeof arg === 'string' && arg.startsWith('--status=')
  );
  const isInline = separate === -1 && inline !== -1;
  const flag = isInline ? inline : separate;
  if (flag === -1) return argv;
  const valueIndex = isInline ? flag : flag + 1;
  if (valueIndex >= argv.length) return argv;
  const current = isInline ? argv[flag].slice('--status='.length) : argv[valueIndex];
  if (typeof current !== 'string' || current.length === 0) return argv;
  const normalized = index[current];
  if (!normalized) return argv;
  const replacement = statusNames[normalized];
  if (!replacement || replacement === current) return argv;
  const rewritten = argv.slice();
  if (isInline) rewritten[flag] = `--status=${replacement}`;
  else rewritten[valueIndex] = replacement;
  return rewritten;
}

/**
 * Apply a repository's status-vocabulary overrides to one capability call.
 *
 * Read direction: the capability's own `parse.statusMap` is EXTENDED with the repository's
 * `statusMap` entries and with the reverse of its `statusNames` entries (a name a repository
 * only writes is also readable), with the repository's explicit `statusMap` winning. A
 * capability that declares no `statusMap` keeps declaring none: the override extends a
 * vocabulary, it never invents one for a command that does not translate statuses.
 *
 * Write direction: the provider status name written for a normalized status is replaced by the
 * repository's `statusNames` entry.
 *
 * @param {{adapter?: object, cap?: {parse?: object}, argv?: string[], overrides?: {statusMap?: object, statusNames?: object}}} input
 * @returns {{argv: string[], parse: object|undefined}} the effective argv and parse block
 */
function applyStatusOverrides(input) {
  const { adapter, cap, argv = [], overrides } = input;
  const statusMap = (overrides && overrides.statusMap) || {};
  const statusNames = (overrides && overrides.statusNames) || {};
  const declared = declaredStatusMap(adapter);
  if (Object.keys(statusMap).length === 0 && Object.keys(statusNames).length === 0) {
    return { argv, parse: cap && cap.parse };
  }

  let parse = cap && cap.parse;
  if (parse && parse.statusMap) {
    const readMap = { ...parse.statusMap };
    for (const [normalized, providerName] of Object.entries(statusNames)) {
      if (typeof providerName === 'string' && providerName.length > 0) {
        readMap[providerName] = normalized;
      }
    }
    Object.assign(readMap, statusMap);
    parse = { ...parse, statusMap: readMap };
  }

  const rewritten = rewriteStatusArg(argv, providerStatusIndex(declared, statusMap), statusNames);
  return { argv: rewritten, parse };
}

module.exports = { applyStatusOverrides, declaredStatusMap, rewriteStatusArg };
