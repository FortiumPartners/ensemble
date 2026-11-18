'use strict';

/**
 * Adapter manifest validation (TRD-2026-8d825f54 TRD-005/TRD-007/TRD-008, PRD REQ-005,
 * REQ-003, REQ-008, REQ-022, REQ-023).
 *
 * `validateManifest(dir)` structurally validates one adapter directory's `adapter.yaml`
 * against `packages/development/toolchain/schemas/adapter-manifest-schema.json`, requires a
 * `## Vocabulary` block in the adapter's `SKILL.md` (AC-005-2: an adapter is a provider skill,
 * so its vocabulary must be visible in prose, not only in the manifest), and checks that every
 * capability's `variants` selector argument is declared as an input of that capability in its
 * category contract (`packages/development/toolchain/categories/<category>.yaml`, loaded via
 * `./contracts`). This is purely structural/self-consistency validation of one manifest; it
 * does not check conformance against a category contract's full capability set (that is
 * `validateConformance`, TRD-007).
 *
 * `validateConformance(adapter, contracts)` checks one already-parsed adapter manifest against
 * the category contracts it declares (TRD-007, PRD REQ-008, REQ-003, AC-008-1, AC-008-2): every
 * `required` capability of each declared category must be implemented, contract compatibility
 * uses `checkCompat` from `./contracts` (capabilities `addedInMinor` a later minor than the
 * adapter targets are exempt from the "required" check, not a conformance failure), and every
 * `${name}` placeholder in a shared capability's `run` template (including any `variants` run
 * template) and every `parse.map` output key, when present) must match that capability's
 * declared contract inputs/outputs.
 *
 * `validateAllowlist(manifest)` checks that every capability and health check's `run` argv
 * (including variant run templates) calls a binary declared in the manifest's `binaries` and
 * a subcommand declared in that binary's `allowlist[].sub` (TRD-008, PRD REQ-023 AC-023-1,
 * AC-023-3; a `sub` entry may be a single word or a space-separated multi-word subcommand such
 * as `boards work-item show`, TRD-033, matched positionally against the run argv -- see
 * `matchesSubcommandWords` below).
 * `scanCredentials(files)` rejects literal credentials in adapter manifests,
 * `SKILL.md` and toolchain config files: well-known secret token prefixes anywhere in the
 * file, and credential-shaped keys (`password`, `secret`, `token`, `api_key`, `apikey`,
 * `access_key`, `private_key`, `client_secret`, `auth`, `bearer`) set to literal values;
 * environment variable names (`env: [NAME]`, `${NAME}` interpolation, a bare uppercase
 * identifier) are permitted (TRD-008, PRD REQ-022 AC-022-1).
 *
 * `validateAdapterDir(adapterDir, opts)` is the single composed static gate: it runs all four
 * checks above (`validateManifest`, `validateAllowlist`, `validateConformance`, with
 * `scanCredentials` run over `adapter.yaml`, `SKILL.md` and every other regular file in the
 * adapter directory, found by `collectAdapterTextFiles`) and returns the union of their errors
 * as one `{ok, errors}` envelope, each error naming the adapter, the file and the offending
 * item (TRD-009, PRD REQ-008/REQ-022/REQ-023, AC-008-1..3, AC-022-1, AC-023-1, AC-023-3).
 * `toolchain-cli validate <adapter-dir>` calls this one function and does not duplicate any of
 * the four checks' wiring itself (TRD-009 review finding: a validator with no production
 * caller enforces nothing). This function is the static gate only: it never executes a binary
 * and never substitutes a real argument value. The runtime runner (TRD-010, TRD-011)
 * re-validates every substituted argument against the capability's declared contract input
 * types before every call, independently of this gate.
 *
 * `collectAdapterTextFiles`'s walk of the adapter directory never follows symlinks and is
 * bounded by `MAX_SCAN_DEPTH`, `MAX_SCAN_FILES` and `MAX_SCAN_FILE_BYTES` so one adapter
 * directory can never make validation scan an unbounded amount of the filesystem. Hitting any
 * of those caps is fail-closed, not a silent skip: it is reported as a distinct error naming
 * the cap and what was not scanned, folded into `validateAdapterDir`'s errors, so a planted
 * credential sitting beyond a cap cannot make this gate return `{ok: true}` (PR review
 * finding: the caps must fail loudly, not pass silently). Only a binary file extension or a
 * symlink is skipped silently -- those are legitimately not text to scan, not an incomplete
 * scan.
 *
 * ## Known limits
 *
 * `validateAllowlist` enforces the allowlist at binary-plus-subcommand level by design: it
 * checks `run[0]` (the binary) and the subcommand words that immediately follow it against
 * each `allowlist[].sub` entry via `matchesSubcommandWords`. A `sub` entry may be a single word
 * (`show`) or a space-separated multi-word subcommand (`boards work-item show`); every word of
 * the entry must equal the run argv element at the same position, never a substring or prefix
 * match on a single token. Argv elements beyond the matched subcommand words -- flags, option
 * values, substituted template arguments, script names -- are not constrained by this static
 * check; the runtime runner (TRD-010) validates substituted arguments against each
 * capability's declared contract input types before every call. Do not add argument-level
 * constraints to the static validator.
 *
 * `validateConformance` checks only the manifest's declared shape: the capability ids it
 * claims to implement and the placeholder/output names referenced in its `run` templates and
 * `parse.map`. It does not substitute real argument values, does not execute any binary and
 * does not check the actual shape of a capability's runtime stdout against its contract
 * outputs — that is the runner's job (TRD-010, a later task).
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const Ajv = require('ajv');

const { loadContracts, checkCompat } = require('./contracts');
const { checkRemoteUrlMatchPatternStatic } = require('./detect');

const ADAPTER_MANIFEST_SCHEMA_PATH = path.join(
  __dirname,
  '..',
  '..',
  'toolchain',
  'schemas',
  'adapter-manifest-schema.json'
);

const VOCABULARY_HEADING = /^##\s+Vocabulary\b/m;

let compiledValidator = null;

/**
 * Lazily compile and cache the ajv validator for the adapter manifest schema.
 * @returns {import('ajv').ValidateFunction}
 */
function getValidator() {
  if (!compiledValidator) {
    const schema = JSON.parse(fs.readFileSync(ADAPTER_MANIFEST_SCHEMA_PATH, 'utf8'));
    const ajv = new Ajv({ allErrors: true });
    compiledValidator = ajv.compile(schema);
  }
  return compiledValidator;
}

/**
 * Describe one ajv validation error as a short human-readable fragment that names the
 * offending property (contracts.js / config.js convention).
 *
 * @param {import('ajv').ErrorObject} error
 * @returns {string}
 */
function describeAjvError(error) {
  if (error.keyword === 'required' && error.params && error.params.missingProperty) {
    return `missing required property '${error.params.missingProperty}'`;
  }
  if (error.keyword === 'additionalProperties' && error.params && error.params.additionalProperty) {
    return `unexpected property '${error.params.additionalProperty}'`;
  }
  const atPath = error.instancePath ? error.instancePath.replace(/^\//, '') : '(root)';
  return `${atPath}: ${error.message || 'invalid'}`;
}

/**
 * Require a `## Vocabulary` heading in an adapter's `SKILL.md` (PRD AC-005-2).
 *
 * @param {string} skillMdPath absolute path to the adapter's `SKILL.md`
 * @returns {{ok: true} | {ok: false, error: string}}
 */
function checkVocabularyBlock(skillMdPath) {
  let content;
  try {
    content = fs.readFileSync(skillMdPath, 'utf8');
  } catch (error) {
    return {
      ok: false,
      error: `${skillMdPath}: missing or unreadable (${error.code || error.message}); a '## Vocabulary' block is required`
    };
  }
  if (!VOCABULARY_HEADING.test(content)) {
    return { ok: false, error: `${skillMdPath}: missing required '## Vocabulary' heading` };
  }
  return { ok: true };
}

/**
 * Structurally validate one adapter directory: its `adapter.yaml` against
 * `adapter-manifest-schema.json`, its `SKILL.md` for a `## Vocabulary` block, declared
 * categories against the manifest's own `contract` map, and every capability's `variants`
 * selector argument against the declared inputs of that capability in its category contract.
 *
 * @param {string} dir adapter directory containing `adapter.yaml` and `SKILL.md`
 * @returns {{valid: true, errors: []} | {valid: false, errors: string[]}}
 */
function validateManifest(dir) {
  const manifestPath = path.join(dir, 'adapter.yaml');
  const skillMdPath = path.join(dir, 'SKILL.md');
  const errors = [];

  if (!fs.existsSync(manifestPath)) {
    return { valid: false, errors: [`${manifestPath}: missing (no adapter.yaml)`] };
  }

  let manifest;
  try {
    manifest = yaml.load(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return { valid: false, errors: [`${manifestPath}: invalid YAML (${error.message})`] };
  }
  const validate = getValidator();
  if (!validate(manifest)) {
    for (const error of validate.errors) {
      errors.push(`${manifestPath}: ${describeAjvError(error)}`);
    }
  }

  const vocabularyResult = checkVocabularyBlock(skillMdPath);
  if (!vocabularyResult.ok) {
    errors.push(vocabularyResult.error);
  }

  if (manifest && typeof manifest === 'object') {
    if (Array.isArray(manifest.categories) && manifest.contract && typeof manifest.contract === 'object') {
      const categorySet = new Set(manifest.categories);
      for (const category of manifest.categories) {
        if (manifest.contract[category] == null) {
          errors.push(`${manifestPath}: declared category '${category}' has no matching 'contract' entry`);
        }
      }
      for (const contractCategory of Object.keys(manifest.contract)) {
        if (!categorySet.has(contractCategory)) {
          errors.push(
            `${manifestPath}: 'contract' entry for category '${contractCategory}' is not declared in 'categories'`
          );
        }
      }
    }

    if (manifest.capabilities && typeof manifest.capabilities === 'object') {
      const contracts = loadContracts();
      for (const [capabilityId, capability] of Object.entries(manifest.capabilities)) {
        if (!capability || typeof capability !== 'object' || !capability.variants) {
          continue;
        }
        const category = capabilityId.split('.')[0];
        const contract = contracts[`${category}.yaml`];
        const declaredCapability = contract && contract.capabilities && contract.capabilities[capabilityId];
        if (!declaredCapability) {
          errors.push(
            `${manifestPath}: capability '${capabilityId}' declares 'variants' but is not declared in the '${category}' category contract`
          );
          continue;
        }
        const declaredInputs = declaredCapability.inputs || [];
        for (const selectorArg of Object.keys(capability.variants)) {
          if (!declaredInputs.includes(selectorArg)) {
            errors.push(
              `${manifestPath}: capability '${capabilityId}' variants selector '${selectorArg}' is not declared as a contract input`
            );
          }
        }
      }
    }

    if (Array.isArray(manifest.detect)) {
      // PR 4 review round 2, Finding 1 (validation half): catch a bad `remote_url_matches`
      // pattern at author time, naming the adapter, the file and the pattern, reusing the
      // exact limits `./detect.js#testRemoteUrlPattern` enforces at runtime (exported from
      // that one place; never redeclared here).
      for (const signal of manifest.detect) {
        if (signal && signal.signal === 'remote_url_matches') {
          const check = checkRemoteUrlMatchPatternStatic(signal.pattern);
          if (!check.ok) {
            errors.push(
              `${manifestPath}: adapter '${manifest.adapter}' detect[] remote_url_matches ` +
                `pattern ${JSON.stringify(signal.pattern)} ${check.error}`
            );
          }
        }
      }
    }
  }

  return errors.length === 0 ? { valid: true, errors: [] } : { valid: false, errors };
}

const CREDENTIAL_PREFIX_PATTERNS = [
  /ghp_[A-Za-z0-9]{36,}/,
  /gho_[A-Za-z0-9]{36,}/,
  /ghu_[A-Za-z0-9]{36,}/,
  /ghs_[A-Za-z0-9]{36,}/,
  /ghr_[A-Za-z0-9]{36,}/,
  /glpat-[A-Za-z0-9_-]{20,}/,
  /sk-[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /ASIA[0-9A-Z]{16}/,
  /AIza[0-9A-Za-z-_]{35}/,
  /xox[baprs]-[0-9A-Za-z-]{10,}/
];

/**
 * Credential-shaped key names: a literal (non-env-reference) value on one of these keys is
 * rejected by `scanCredentials` (TRD-008, PRD REQ-022 AC-022-1).
 */
const CREDENTIAL_KEY_NAMES = [
  'password',
  'secret',
  'token',
  'api_key',
  'apikey',
  'access_key',
  'private_key',
  'client_secret',
  'auth',
  'bearer'
];

const CREDENTIAL_KEY_LINE = new RegExp(`^\\s*(?:-\\s*)?(${CREDENTIAL_KEY_NAMES.join('|')})\\s*:\\s*(.+?)\\s*$`, 'i');

/**
 * Decide whether a credential-shaped key's value names an environment variable rather than
 * holding a literal credential: `${NAME}` interpolation or a bare uppercase identifier (PRD
 * REQ-022: "permitting env var names").
 *
 * @param {string} rawValue the value half of a `key: value` line, already trimmed
 * @returns {boolean}
 */
function isEnvReference(rawValue) {
  const unquoted = rawValue.replace(/^['"]|['"]$/g, '');
  return /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(unquoted) || /^[A-Z][A-Z0-9_]*$/.test(unquoted);
}

const YAML_FILE_PATTERN = /\.ya?ml$/i;
const FENCE_LINE = /^\s*```/;

/**
 * Extract the lines inside fenced code blocks (opening/closing `` ``` `` markers) of a
 * Markdown file. Used to scope the credential-shaped key/value heuristic to code examples in
 * `SKILL.md`, not prose, which otherwise produces false positives on sentences or
 * documentation labels that happen to look like `key: value` (TRD-008 review finding; PRD
 * REQ-022).
 *
 * @param {string} content full Markdown file content
 * @returns {string[]} lines found strictly between fence markers
 */
function extractFencedCodeBlockLines(content) {
  const lines = [];
  let inFence = false;
  for (const line of content.split(/\r?\n/)) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      lines.push(line);
    }
  }
  return lines;
}

/**
 * Compare a declared allowlist subcommand (a single word like `show`, or a space-separated
 * multi-word subcommand like `boards work-item show`, TRD-033) against the argv elements that
 * follow the binary, matching each word positionally. Every word of `allowedSub` must equal
 * the argv element at the same index -- this is never a substring or prefix match on a single
 * token, so `showall` never matches a run of `show`, and `boards` alone never matches a
 * declared `boards work-item show` entry.
 *
 * @param {string} allowedSub one `allowlist[].sub` entry, e.g. 'show' or 'boards work-item show'
 * @param {string[]} argvAfterBin the run/argv elements after the binary (run[1], run[2], ...)
 * @returns {boolean} true only when every word of `allowedSub` equals the argv element at the
 *   same position
 */
function matchesSubcommandWords(allowedSub, argvAfterBin) {
  if (typeof allowedSub !== 'string' || allowedSub.length === 0) {
    return false;
  }
  const words = allowedSub.split(' ');
  if (words.length > argvAfterBin.length) {
    return false;
  }
  return words.every((word, i) => argvAfterBin[i] === word);
}

/**
 * Validate that every capability and health check's `run` argv (including per-capability
 * `variants` run templates) starts with a binary declared in `manifest.binaries` and that the
 * subcommand words following it match a subcommand declared in that binary's `allowlist[].sub`
 * entry (TRD-008, PRD REQ-023 AC-023-1, AC-023-3; TRD-033 multi-word subcommand support). See
 * `## Known limits` in the module doc above: argv elements beyond the matched subcommand words
 * are not constrained here.
 *
 * @param {object} manifest a parsed adapter manifest (see adapter-manifest-schema.json)
 * @returns {{valid: true, errors: []} | {valid: false, errors: string[]}}
 */
function validateAllowlist(manifest) {
  const adapterId = (manifest && manifest.adapter) || '(unknown adapter)';
  const binaries = (manifest && Array.isArray(manifest.binaries) && manifest.binaries) || [];
  const allowlist = (manifest && Array.isArray(manifest.allowlist) && manifest.allowlist) || [];
  const errors = [];

  function checkRun(label, run) {
    if (!Array.isArray(run) || run.length === 0) {
      return;
    }
    const bin = run[0];
    if (!binaries.includes(bin)) {
      errors.push(`${adapterId}: ${label} calls binary '${bin}' which is not declared in 'binaries'`);
      return;
    }
    const entry = allowlist.find((candidate) => candidate && candidate.bin === bin);
    if (!entry) {
      errors.push(`${adapterId}: ${label} calls '${bin}' but '${bin}' has no 'allowlist' entry at all`);
      return;
    }
    const sub = run.length > 1 ? run[1] : undefined;
    if (sub === undefined) {
      errors.push(`${adapterId}: ${label} calls '${bin}' with no subcommand to validate against its allowlist`);
      return;
    }
    const allowedSubs = (Array.isArray(entry.sub) && entry.sub) || [];
    const argvAfterBin = run.slice(1);
    const matched = allowedSubs.some((candidateSub) => matchesSubcommandWords(candidateSub, argvAfterBin));
    if (!matched) {
      errors.push(
        `${adapterId}: ${label} calls '${bin} ${sub}' but subcommand '${sub}' is not in the allowlist for '${bin}'`
      );
    }
  }

  for (const check of (manifest && manifest.health) || []) {
    if (check && check.id) {
      checkRun(`health check '${check.id}'`, check.run);
    }
  }

  for (const [capabilityId, capability] of Object.entries((manifest && manifest.capabilities) || {})) {
    if (!capability || typeof capability !== 'object') {
      continue;
    }
    checkRun(`capability '${capabilityId}'`, capability.run);
    if (capability.variants && typeof capability.variants === 'object') {
      for (const [selectorArg, valueMap] of Object.entries(capability.variants)) {
        if (!valueMap || typeof valueMap !== 'object') {
          continue;
        }
        for (const [value, variantRun] of Object.entries(valueMap)) {
          checkRun(`capability '${capabilityId}' variant '${selectorArg}=${value}'`, variantRun);
        }
      }
    }
  }

  return errors.length === 0 ? { valid: true, errors: [] } : { valid: false, errors };
}

/**
 * Reject files containing literal credentials: a well-known secret token prefix anywhere in
 * the file, or a credential-shaped key (`password`, `secret`, `token`, `api_key`, `apikey`,
 * `access_key`, `private_key`, `client_secret`, `auth`, `bearer`) set to a literal
 * (non-env-reference) value (TRD-008, PRD REQ-022 AC-022-1). Environment variable names are
 * permitted: `env: [NAME]` entries are never scanned as key/value pairs, and `${NAME}`
 * interpolation or a bare uppercase identifier value is not treated as a literal.
 *
 * The well-known-prefix scan always runs on the whole file. The credential-shaped key/value
 * heuristic is scoped to reduce false positives: on YAML files (`adapter.yaml`, toolchain
 * config) it runs on every line; on `SKILL.md` and other Markdown files it runs only on lines
 * inside fenced code blocks, so prose or documentation labels that happen to look like
 * `key: value` (for example "Auth: handled by the CLI's credential helper") are not flagged.
 *
 * @param {string[]} files absolute paths to adapter.yaml, SKILL.md or toolchain config files
 * @returns {{valid: true, errors: []} | {valid: false, errors: string[]}}
 */
function scanCredentials(files) {
  const errors = [];
  for (const filePath of files) {
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      errors.push(`${filePath}: unreadable (${error.code || error.message})`);
      continue;
    }

    if (CREDENTIAL_PREFIX_PATTERNS.some((pattern) => pattern.test(content))) {
      errors.push(`${filePath}: contains a literal credential matching a well-known secret token pattern`);
      continue;
    }

    const linesToScan = YAML_FILE_PATTERN.test(filePath)
      ? content.split(/\r?\n/)
      : extractFencedCodeBlockLines(content);
    const offendingLine = linesToScan
      .map((line) => CREDENTIAL_KEY_LINE.exec(line))
      .find((match) => match && !isEnvReference(match[2]));
    if (offendingLine) {
      errors.push(
        `${filePath}: '${offendingLine[1]}' is set to a literal value; use an environment variable name instead`
      );
    }
  }
  return errors.length === 0 ? { valid: true, errors: [] } : { valid: false, errors };
}

/**
 * Extract every `${name}` placeholder referenced in a capability's `run` argv template.
 *
 * @param {unknown} run a capability's `run` array (template argv)
 * @returns {string[]} placeholder names, in order of appearance, duplicates included
 */
function extractRunPlaceholders(run) {
  const names = [];
  if (!Array.isArray(run)) {
    return names;
  }
  for (const arg of run) {
    if (typeof arg !== 'string') {
      continue;
    }
    for (const match of arg.matchAll(/\$\{([^}]+)\}/g)) {
      names.push(match[1]);
    }
  }
  return names;
}

/**
 * Prefix of a deliberate refusal placeholder (TRD-2026-6995dc96 TRD-011). A required capability
 * whose contract inputs cannot carry what the tool demands (kata's `tracker.close`: contract
 * inputs `[id]`, the tool needs a reason and evidence) puts one mandatory `${refuse.<hint>}`
 * placeholder in its template; no caller supplies it, so `runner.js#resolveArg` refuses the call
 * with `INVALID_ARG` (the name embeds the capability to use) before any process starts. Such a
 * placeholder is intentionally NOT a contract input, so `validateConformance` exempts exactly this
 * prefix from the declared-input rule. Every other undeclared placeholder is still an error.
 */
const REFUSAL_PLACEHOLDER_PREFIX = 'refuse.';

function isRefusalPlaceholder(name) {
  return typeof name === 'string' && name.startsWith(REFUSAL_PLACEHOLDER_PREFIX);
}

/**
 * Check one already-parsed adapter manifest's conformance against the category contracts it
 * declares (TRD-007, PRD REQ-008, REQ-003, AC-008-1, AC-008-2, AC-008-3).
 *
 * For every category in `adapter.categories`:
 *  - resolves that category's contract as `contracts[`${category}.yaml`]` — the exact shape
 *    returned by `loadContracts()` in `./contracts`, keyed by file name (the same lookup
 *    convention `validateManifest` already uses above for its per-capability `variants`
 *    check). Callers that already hold a `loadContracts()` result should pass it through
 *    directly rather than re-reading the category directory per adapter;
 *  - checks `adapter.contract[category]` against that contract via `checkCompat()`
 *    (`./contracts`) and surfaces its `errors` verbatim on a major-version mismatch — do not
 *    reconstruct `checkCompat`'s message (AC-008-3);
 *  - for every capability the contract marks `required: true` that `checkCompat` does not
 *    report in `unavailableCapabilities` (i.e. it is required at the adapter's targeted
 *    minor), fails naming that capability id if it is not a key of `adapter.capabilities`
 *    (AC-008-1);
 *  - for every capability id declared in both the manifest and that category's contract,
 *    every `${name}` placeholder in the manifest capability's `run` template must be one of
 *    the contract capability's declared `inputs` (or a `refuse.`-prefixed refusal placeholder, see
 *    `REFUSAL_PLACEHOLDER_PREFIX`), and every key of `capability.parse.map`
 *    (when present) must be one of the contract capability's declared `outputs` — errors name
 *    the adapter id, the capability id and the offending input/output name.
 *
 * @param {object} adapter a parsed adapter manifest (see adapter-manifest-schema.json),
 *   typically `yaml.load(fs.readFileSync(path.join(dir, 'adapter.yaml')))`
 * @param {Record<string, unknown>} contracts the category-contract map as returned by
 *   `loadContracts()` in `./contracts`, keyed by file name (e.g. `'tracker.yaml'`)
 * @returns {{ok: true, errors: []} | {ok: false, errors: string[]}}
 */
function validateConformance(adapter, contracts) {
  const adapterId = (adapter && adapter.adapter) || '(unknown adapter)';
  const errors = [];

  if (!adapter || typeof adapter !== 'object') {
    return { ok: false, errors: [`${adapterId}: manifest is missing or is not an object`] };
  }

  const categories = Array.isArray(adapter.categories) ? adapter.categories : [];
  const adapterCapabilities =
    adapter.capabilities && typeof adapter.capabilities === 'object' ? adapter.capabilities : {};
  const adapterTargets = adapter.contract && typeof adapter.contract === 'object' ? adapter.contract : {};
  const contractsMap = contracts && typeof contracts === 'object' ? contracts : {};

  for (const category of categories) {
    const contractFileName = `${category}.yaml`;
    const categoryContract = contractsMap[contractFileName];
    if (!categoryContract || typeof categoryContract !== 'object') {
      errors.push(`${adapterId}: no category contract loaded for '${category}' (expected '${contractFileName}')`);
      continue;
    }

    let compatResult;
    try {
      compatResult = checkCompat(adapterTargets[category], categoryContract);
    } catch (error) {
      errors.push(`${adapterId}: cannot check contract compatibility for category '${category}' (${error.message})`);
      continue;
    }

    if (!compatResult.ok) {
      errors.push(...compatResult.errors);
      continue;
    }

    const unavailable = new Set(compatResult.unavailableCapabilities);
    const contractCapabilities =
      categoryContract.capabilities && typeof categoryContract.capabilities === 'object'
        ? categoryContract.capabilities
        : {};

    for (const [capabilityId, declaredCapability] of Object.entries(contractCapabilities)) {
      if (!declaredCapability || !declaredCapability.required || unavailable.has(capabilityId)) {
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(adapterCapabilities, capabilityId)) {
        errors.push(`${adapterId}: missing required capability '${capabilityId}' for category '${category}'`);
      }
    }

    for (const [capabilityId, capability] of Object.entries(adapterCapabilities)) {
      const declaredCapability = contractCapabilities[capabilityId];
      if (!capability || typeof capability !== 'object' || !declaredCapability) {
        continue;
      }

      const declaredInputs = Array.isArray(declaredCapability.inputs) ? declaredCapability.inputs : [];
      for (const placeholder of extractRunPlaceholders(capability.run)) {
        if (!declaredInputs.includes(placeholder) && !isRefusalPlaceholder(placeholder)) {
          errors.push(
            `${adapterId}: capability '${capabilityId}' run template references '\${${placeholder}}' which is ` +
              `not a declared input of category '${category}'`
          );
        }
      }

      if (capability.parse && typeof capability.parse === 'object' && capability.parse.map && typeof capability.parse.map === 'object') {
        const declaredOutputs = Array.isArray(declaredCapability.outputs) ? declaredCapability.outputs : [];
        for (const outputField of Object.keys(capability.parse.map)) {
          if (!declaredOutputs.includes(outputField)) {
            errors.push(
              `${adapterId}: capability '${capabilityId}' parse.map references output '${outputField}' which is ` +
                `not a declared output of category '${category}'`
            );
          }
        }
      }

      if (capability.variants && typeof capability.variants === 'object') {
        for (const [selectorArg, valueMap] of Object.entries(capability.variants)) {
          if (!valueMap || typeof valueMap !== 'object') {
            continue;
          }
          for (const [variantValue, variantRun] of Object.entries(valueMap)) {
            for (const placeholder of extractRunPlaceholders(variantRun)) {
              if (!declaredInputs.includes(placeholder) && !isRefusalPlaceholder(placeholder)) {
                errors.push(
                  `${adapterId}: capability '${capabilityId}' variants.${selectorArg}.${variantValue} run template ` +
                    `references '\${${placeholder}}' which is not a declared input of category '${category}'`
                );
              }
            }
          }
        }
      }
    }
  }

  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

const MAX_SCAN_DEPTH = 6;
const MAX_SCAN_FILES = 500;
const MAX_SCAN_FILE_BYTES = 1024 * 1024;
const BINARY_FILE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.tar', '.gz', '.tgz',
  '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.mov', '.wasm', '.so', '.dylib', '.exe'
]);

/**
 * Collect every regular file under an adapter directory to scan for literal credentials: at
 * minimum `adapter.yaml` and `SKILL.md` (always included, even if missing, so
 * `scanCredentials` can report them unreadable), plus every other regular text file found by a
 * bounded walk of the directory tree.
 *
 * The walk never follows symlinks (a symlinked file or directory could point outside the
 * adapter directory -- a symlink escape): `fs.readdirSync(dir, { withFileTypes: true })`
 * yields `Dirent` entries whose `isDirectory()`/`isFile()` describe the directory entry itself
 * (an `lstat`, not a `stat`), so a symlink -- to a file or to a directory -- is neither a
 * `Dirent` directory nor a `Dirent` file and falls out of both branches below without ever
 * resolving the link target; `Dirent#isSymbolicLink()` is deliberately not also checked, since
 * it would be redundant with that fact. Do not reclassify entries with `fs.statSync` (which
 * follows symlinks) or this silent, load-bearing protection is lost; the CLI-level symlink
 * test below exists specifically to catch that regression.
 *
 * Caps bound the walk so one adapter directory can never make validation scan an unbounded
 * amount of the filesystem: recursion stops past `MAX_SCAN_DEPTH`, collection stops past
 * `MAX_SCAN_FILES`, and a file over `MAX_SCAN_FILE_BYTES` is not read. Hitting any of these
 * caps is fail-closed, not a silent skip: a distinct entry in the returned `errors` names the
 * adapter directory (or, for an oversized file, the file itself) and the cap that was hit, so
 * a credential planted beyond a cap cannot make `validateAdapterDir` return `{ok: true}`
 * (PR review finding: the previous bare `return`/`continue` on every cap dropped files with no
 * record, so a planted credential past a cap silently passed). A binary-extension file is the
 * only skip that stays silent: it is legitimately not text to scan, not an incomplete scan.
 *
 * @param {string} adapterDir
 * @returns {{files: string[], errors: string[]}} absolute file paths to scan, plus any
 *   fail-closed cap errors naming what was not scanned
 */
function collectAdapterTextFiles(adapterDir) {
  const files = [path.join(adapterDir, 'adapter.yaml'), path.join(adapterDir, 'SKILL.md')];
  const seen = new Set(files);
  const errors = [];
  let depthCapped = false;
  let uncheckedFileCount = 0;

  function walk(dir, depth) {
    if (depth > MAX_SCAN_DEPTH) {
      depthCapped = true;
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_error) {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath, depth + 1);
        continue;
      }
      if (
        !entry.isFile() ||
        seen.has(entryPath) ||
        BINARY_FILE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        continue;
      }
      if (files.length >= MAX_SCAN_FILES) {
        uncheckedFileCount += 1;
        continue;
      }
      let stat;
      try {
        stat = fs.statSync(entryPath);
      } catch (_error) {
        continue;
      }
      if (stat.size > MAX_SCAN_FILE_BYTES) {
        errors.push(
          `${entryPath}: credential scan incomplete: file exceeds MAX_SCAN_FILE_BYTES ` +
            `(${MAX_SCAN_FILE_BYTES}); not scanned`
        );
        continue;
      }
      seen.add(entryPath);
      files.push(entryPath);
    }
  }

  walk(adapterDir, 0);

  if (depthCapped) {
    errors.push(
      `${adapterDir}: credential scan incomplete: MAX_SCAN_DEPTH (${MAX_SCAN_DEPTH}) reached; ` +
        'some subdirectories were not scanned'
    );
  }
  if (uncheckedFileCount > 0) {
    errors.push(
      `${adapterDir}: credential scan incomplete: MAX_SCAN_FILES (${MAX_SCAN_FILES}) reached; ` +
        `${uncheckedFileCount} file(s) unchecked`
    );
  }

  return { files, errors };
}

/**
 * The single composed static validation gate for one adapter directory (TRD-009, PRD REQ-008,
 * REQ-022, REQ-023, AC-008-1..3, AC-022-1, AC-023-1, AC-023-3): runs `validateManifest`,
 * `validateAllowlist`, `validateConformance` and `scanCredentials` and returns the union of
 * their errors as one `{ok, errors}` envelope. This is the only function
 * `toolchain-cli validate <adapter-dir>` calls; it must not be bypassed or re-wired per check
 * in the CLI (TRD-009 review finding: a validator with no production caller enforces nothing).
 *
 * `validateAllowlist` and `validateConformance` need an already-parsed manifest object; if
 * `adapter.yaml` is missing or fails to parse as YAML, `validateManifest`'s own error already
 * names that and those two checks are skipped (there is nothing for them to check against).
 * They still run whenever a manifest object was parsed, even if it fails ajv schema
 * validation, so allowlist and conformance defects are surfaced alongside schema defects in
 * one pass. `scanCredentials` always runs, independently of whether the manifest parsed, over
 * `adapter.yaml`, `SKILL.md` and every other file `collectAdapterTextFiles` finds; any cap
 * error `collectAdapterTextFiles` itself reports (a file or directory it had to skip to stay
 * bounded) is folded into these errors too, so a credential planted beyond a cap fails this
 * gate instead of passing silently (PR review finding).
 *
 * @param {string} adapterDir adapter directory containing `adapter.yaml` and `SKILL.md`
 * @param {{contracts?: Record<string, unknown>}} [opts] `opts.contracts`, when supplied,
 *   replaces the default `loadContracts()` call (callers that already hold a `loadContracts()`
 *   result for many adapters should pass it through rather than re-reading the category
 *   directory per adapter, matching `validateConformance`'s own documented convention above).
 * @returns {{ok: true, errors: []} | {ok: false, errors: string[]}}
 */
function validateAdapterDir(adapterDir, opts = {}) {
  const manifestPath = path.join(adapterDir, 'adapter.yaml');
  const errors = [];

  const manifestResult = validateManifest(adapterDir);
  errors.push(...manifestResult.errors);

  let manifest = null;
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = yaml.load(fs.readFileSync(manifestPath, 'utf8'));
    } catch (_error) {
      manifest = null;
    }
  }

  if (manifest && typeof manifest === 'object') {
    errors.push(...validateAllowlist(manifest).errors);
    const contracts = (opts && opts.contracts) || loadContracts();
    errors.push(...validateConformance(manifest, contracts).errors);
  }

  const scanResult = collectAdapterTextFiles(adapterDir);
  errors.push(...scanResult.errors, ...scanCredentials(scanResult.files).errors);

  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

/**
 * Coverage assertion (TRD-015, PRD AC-001-4 / AC-015-2). Stricter than `validateConformance`:
 * for each category the adapter declares, every contract capability that is `required: true` OR
 * names a `fallback`, and that `checkCompat` leaves available at the adapter's targeted contract
 * version, must be a key of `adapter.capabilities`. Used for adapters (kata) that promise full
 * coverage; NOT applied to adapters that legitimately omit fallback-bearing capabilities.
 *
 * @param {object} adapter parsed adapter manifest
 * @param {Record<string, unknown>} contracts map returned by `loadContracts()`
 * @returns {{ok: boolean, errors: string[]}}
 */
function validateCoverage(adapter, contracts) {
  const adapterId = (adapter && adapter.adapter) || '(unknown adapter)';
  if (!adapter || typeof adapter !== 'object') {
    return { ok: false, errors: [`${adapterId}: manifest is missing or is not an object`] };
  }
  const errors = [];
  const categories = Array.isArray(adapter.categories) ? adapter.categories : [];
  const declared =
    adapter.capabilities && typeof adapter.capabilities === 'object' ? adapter.capabilities : {};
  const targets = adapter.contract && typeof adapter.contract === 'object' ? adapter.contract : {};
  const contractsMap = contracts && typeof contracts === 'object' ? contracts : {};

  for (const category of categories) {
    const contract = contractsMap[`${category}.yaml`];
    if (!contract || typeof contract !== 'object') {
      errors.push(`${adapterId}: no category contract loaded for '${category}' (expected '${category}.yaml')`);
      continue;
    }
    let compat;
    try {
      compat = checkCompat(targets[category], contract);
    } catch (error) {
      errors.push(`${adapterId}: cannot check contract compatibility for category '${category}' (${error.message})`);
      continue;
    }
    if (!compat.ok) {
      errors.push(...compat.errors);
      continue;
    }
    const unavailable = new Set(compat.unavailableCapabilities);
    const capabilities = contract.capabilities && typeof contract.capabilities === 'object' ? contract.capabilities : {};
    for (const [id, cap] of Object.entries(capabilities)) {
      if (!cap || unavailable.has(id) || Object.prototype.hasOwnProperty.call(declared, id)) continue;
      if (cap.required) {
        errors.push(`${adapterId}: missing required capability '${id}' for category '${category}'`);
      } else if (cap.fallback) {
        errors.push(`${adapterId}: missing fallback-bearing capability '${id}' for category '${category}'`);
      }
    }
  }
  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

module.exports = {
  validateManifest,
  checkVocabularyBlock,
  validateAllowlist,
  scanCredentials,
  validateConformance,
  validateCoverage,
  validateAdapterDir,
  ADAPTER_MANIFEST_SCHEMA_PATH
};
