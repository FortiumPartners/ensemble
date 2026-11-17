'use strict';

/**
 * Output mapping engine (TRD-2026-8d825f54 TRD-012, PRD REQ-002, REQ-022).
 *
 * `mapOutput(stdout, parse)` is the second half of the runner's output pipeline described in
 * the TRD's System Architecture ("Interfaces and Formats": `capabilities{<id>: {run[],
 * parse{format, root, map{}, statusMap{}}}}`): it turns one tool invocation's raw `stdout`
 * string into a plain JavaScript value using only the information already declared in an
 * adapter manifest's `parse` block, with no new runtime dependency (TRD interpretation I6).
 * It never spawns a process, never reads an adapter manifest itself and never validates the
 * mapped value against a normalized JSON schema — schema validation against
 * `packages/development/toolchain/schemas/normalized/*.json` is wired into `runCapability`
 * (TRD-011, a sibling task in `./runner.js`) via Ajv, using this module's return value as its
 * input. Do not add process-spawning or schema-validation code here.
 *
 * `parse` shape (as declared on one adapter manifest capability):
 * ```
 * parse = {
 *   format: 'json' | 'lines' | 'text',
 *   root?: string,                    // dotted path, json format only; default '$'
 *   emptyWhen?: string,               // dotted path to an optional list, json format only (below)
 *   map?: { <outKey>: <dottedPath> | <fieldSpec> }, // field projection against the (root-projected) value
 *   trimPrefix?: { <outKey>: <prefix> }, // TRD-040: strip a literal prefix off a map-built field
 *   statusMap?: { <rawValue>: <normalizedValue> }, // translates result.status, else result.state
 *   arrayMap?: {                      // TRD-033: per-item array filter + reshape (see below)
 *     <outKey>: {
 *       source: <dottedPath>,                      // resolved against the root-projected value
 *       filter?: { path: <dottedPath>, equals: <scalar> }, // relative to EACH source item
 *       item: { <itemOutKey>: <dottedPath> }        // relative to EACH (kept) source item
 *     }
 *   }
 * }
 * ```
 *
 * `emptyWhen` (json only) declares that `<path>` names a LIST that a tool legitimately leaves
 * empty, null or absent (bv's `plan.tracks` is `[]` for an epic with nothing actionable). When
 * its final named property is an empty array, `null` or missing from its parent object, the
 * root-projected value is `[]` and `root` is not resolved, so a `map` of `"$"` yields `[]`. The
 * parent must still resolve to a plain object and a present non-empty value still goes through
 * `root`, so a malformed document stays `BAD_OUTPUT`.
 *
 * ## Format handling
 *
 * - `'json'`: `stdout` is parsed with `JSON.parse`. A parse failure is never a raw
 *   `SyntaxError`; it is wrapped into a `BAD_OUTPUT`-coded error naming that the JSON was
 *   malformed. The parsed value is then projected through `root` (default `'$'`, meaning "the
 *   whole parsed value") using the dotted-path resolver below; `map`, when present, is applied
 *   against that root-projected value, so a `map` path's own leading `$` refers to the
 *   root-projected value, not necessarily the raw parsed document (this matches the TRD's
 *   Implementation AC example, which supplies no `root` and expects `map` paths such as
 *   `$.issues[0].key` to resolve against the whole parsed document).
 * - `'lines'`: `stdout` is split on `\n`; a single trailing empty element produced by a final
 *   newline is trimmed, then every remaining empty line is dropped, leaving an array of
 *   non-empty line strings, one per record. `root` is not applicable to this format (there is
 *   no JSON document to project a sub-root from) and is ignored if supplied. `map`, when
 *   present, is applied against this array of lines (for example `$[0]` for the first line);
 *   when `map` is omitted, the array of lines is returned directly, unwrapped.
 * - `'text'`: the whole trimmed `stdout` string is the single value; no JSON parsing happens.
 *   `root` is ignored, as for `'lines'`. `map`, when present, is applied against the trimmed
 *   string (for example `$` to copy it verbatim into an output key); when `map` is omitted,
 *   the trimmed string is returned directly.
 *
 * ## `map` field projection
 *
 * For each `<outKey>: <dottedPath>` entry in `map`, `result[outKey]` is set to the dotted path
 * resolved against the format-appropriate base value described above. Every path must resolve
 * to a present value or `mapOutput` throws a `BAD_OUTPUT`-coded error naming the path and the
 * first segment that could not be found — there is no "resolve to undefined and move on"
 * behavior, matching this module's fail-closed requirement.
 *
 * ## `map` field specs (TRD-2026-6995dc96 TRD-007)
 *
 * A `map` value may be an object instead of a bare path, for sources whose raw value is not
 * already in the normalized shape. `{path, default?, optional?, asString?}`:
 * - `path` (required, dotted path) is resolved like a bare-path entry. When it does NOT resolve
 *   (a missing property, or a `null` value) and `default` is supplied, the default is used;
 *   when it does not resolve and `optional: true` is set, `outKey` is OMITTED from the result;
 *   with neither, the usual `BAD_OUTPUT` fail-closed error applies.
 * - `asString: true` stringifies a resolved number (the normalized `priority` is a string while
 *   kata reports an integer). Any other resolved type is `BAD_OUTPUT`, never silently coerced.
 * A bare-path entry behaves exactly as before.
 *
 * ## `arrayMap` per-item array filter + reshape (TRD-2026-8d825f54 TRD-033)
 *
 * This module's base dotted-path grammar deliberately has no filter/projection operator (see
 * "Deliberately NOT supported" below) -- by design, `map` can only pick ONE value's own
 * top-level properties, never iterate an array and reshape each item into a differently-keyed
 * object. `arrayMap` is a narrowly-scoped, separate mechanism added specifically because the
 * obvious alternative -- letting an adapter's `run[]` template do this reshaping itself via its
 * own tool's native query language (for example `az`'s `--query`, which is real JMESPath and
 * DOES support `[?filter].{rename: expr}`-style projections) -- is a dead end for ANY construct
 * that needs JMESPath's `{...}` multi-select-hash syntax: `packages/development/lib/toolchain/
 * runner.js#buildArgv`'s placeholder substitution (`PLACEHOLDER_REPLACE_PATTERN =
 * /\{([^{}]+)\}/g`) scans every `run[]` argv element for BARE `{...}` text and unconditionally
 * treats ANY match as an unresolved `{name}` placeholder needing substitution via
 * `resolveArg(name, ...)` -- it does not distinguish "this came from an adapter's own
 * `${name}` placeholder" from "this is a literal brace the tool's own query syntax needs", so
 * it throws `INVALID_ARG` naming the JMESPath hash's own text as an unknown argument name,
 * for EVERY `run[]` element containing literal `{`/`}` characters, whether or not the content
 * was ever meant as a placeholder (confirmed empirically while building
 * `adapter-tracker-azure-boards`, TRD-033: even the simplest single-field `--query
 * "{id: to_string(id)}"` throws `INVALID_ARG: 'id: to_string(id)': no value supplied...`).
 * Square-bracket JMESPath constructs (multi-select LIST `[...]`, filter expressions `[?...]`,
 * index access) are unaffected -- only `{`/`}` trips this unrelated, unmodifiable regex -- so
 * an adapter's `run[]` template MAY still use `--query "[expr1, expr2, ...]"` to pre-flatten
 * SCALAR fields (including ones with literal-dot REST field names, via JMESPath's own quoted-
 * identifier syntax, e.g. `fields."System.Title"`) into a plain JSON array `mapOutput`'s
 * ordinary `map: {outKey: "$[N]"}` entries then trivially index into. It is ONLY an array of
 * per-item RENAMED objects (Azure Boards relations -> `dependencies[] = [{id, type}, ...]`
 * being the motivating case) that has nowhere left to be built except here, in `mapOutput`
 * itself, against the tool's RAW (unrenamed) array value.
 *
 * For each `<outKey>: {source, filter?, item}` entry in `arrayMap`:
 * - `source` (a dotted path, same grammar as `map`) is resolved against the SAME
 *   root-projected base value `map` paths resolve against; it must resolve to an array, or
 *   `mapOutput` throws `BAD_OUTPUT` naming the non-array shape found.
 * - For each item in that array, when `filter` is supplied: `filter.path` is resolved AGAINST
 *   THAT ITEM (its own `$` refers to the item, not the outer base value); if resolution throws
 *   (the path does not exist on this particular item -- real Azure relation items legitimately
 *   vary in shape, e.g. a hyperlink relation has no `attributes.name`) OR the resolved value is
 *   not strictly `===` `filter.equals`, the item is EXCLUDED, never a thrown error -- a
 *   missing/non-matching field on one array item is an ordinary "does not match", not a
 *   manifest defect. When `filter` is omitted, every item is kept.
 * - For each KEPT item, `item` (an object of `<itemOutKey>: <spec>`) builds one output object;
 *   each `<spec>` is either a plain dotted-path string (resolved against the item, `$` again
 *   referring to the item, matching `map`'s own "every path must resolve" fail-closed rule --
 *   a path that fails to resolve DOES throw `BAD_OUTPUT`, unlike `filter` above), or an object
 *   `{path, statusMap}` (TRD-2026-8d825f54 PR 9 fix round, item 1: per-item value translation,
 *   the same mechanism as the top-level `statusMap` below but reachable INSIDE an `arrayMap`-
 *   built array, for example normalizing each Azure DevOps PR reviewer's raw numeric `vote`
 *   into a named review state): `path` is resolved against the item exactly like the plain-
 *   string form, then the resolved raw value is looked up in `statusMap` (the same
 *   `Object.prototype.hasOwnProperty` lookup the top-level `statusMap` uses, so a raw number
 *   like Azure's `vote` works via JS's own numeric-key-to-string object-property coercion) and
 *   replaced with the mapped value; an unmapped raw value throws `BAD_OUTPUT` naming the value,
 *   the unmapped `itemOutKey`, and the `arrayMap` key -- the same fail-closed guarantee the
 *   top-level `statusMap` documents below, never a silent passthrough of an unrecognized raw
 *   value.
 * - `result[outKey]` is set to the array of built item-objects (possibly empty, never
 *   undefined/null) -- `mapOutput` requires `map` to already be present (the plain-object
 *   `result` `arrayMap` entries are added onto) and throws `BAD_OUTPUT` if `arrayMap` is
 *   supplied without `map` or if the `map`-built result is not a plain object, so an `arrayMap`
 *   entry can never silently attach itself to an array/primitive base result.
 *
 * ## `trimPrefix` literal prefix stripping (TRD-2026-8d825f54 TRD-040)
 *
 * Some tools report a field using the raw tool's own prefixed vocabulary where the normalized
 * schema wants the bare suffix -- the motivating case is Azure DevOps's `az repos pr show`,
 * whose `sourceRefName`/`targetRefName` are full ref paths like `refs/heads/feature/x`, while
 * the normalized change-request schema's `headBranch`/`baseBranch` are meant to be bare branch
 * names with no `refs/heads/` prefix. Azure's own `--query` (JMESPath) has no substring/
 * prefix-removal function, and the base dotted-path grammar below has no string-transform
 * operator either, so this is a second small, narrowly-scoped mechanism (like `arrayMap`)
 * layered on top of the `map`-built `result`, not a new path-grammar operator.
 *
 * For each `<outKey>: <prefix>` entry in `trimPrefix` (applied AFTER `map`/`arrayMap` build
 * `result`, BEFORE `statusMap` runs -- the two never target the same field in practice, so the
 * relative order of `trimPrefix` and `statusMap` does not matter, but `trimPrefix` always runs
 * first): when `result[outKey]` is a string that starts with the declared `prefix`, it is
 * replaced with the suffix after that prefix. Every other case is a SAFE NO-OP, never an
 * error -- `result[outKey]` is missing, is not a string, or is a string that does not start
 * with `prefix` -- so the same generic `trimPrefix` declaration can be reused across adapters
 * whose raw tool output sometimes does and sometimes does not carry the prefix (for example, a
 * GitHub adapter's branch names never carry `refs/heads/`, so declaring `trimPrefix` there,
 * were it ever needed, would simply never fire).
 *
 * ## `statusMap` value translation
 *
 * After `map`/`arrayMap` (or the bare parsed value, when `map` is omitted) produce a plain
 * object `result`, and `statusMap` is supplied: if `result` has an own `status` property, the
 * raw value at `result.status` is looked up in `statusMap` and `result.status` is replaced with
 * the mapped value (TRD-012's original "tracker"/"work item" behavior, unchanged); ELSE IF
 * `result` has an own `state` property instead (TRD-2026-8d825f54 TRD-040: the normalized
 * "host"/"change request" schema names its lifecycle field `state`, not `status`), the raw
 * value at `result.state` is looked up in the SAME `statusMap` and `result.state` is replaced
 * the same way. A result is never checked against both fields -- `status` wins when both happen
 * to be present, matching every real normalized schema, which declares exactly one of the two.
 * Either way, an unmapped raw value throws a `BAD_OUTPUT`-coded error naming the unmapped value
 * and which of the two fields it came from (TRD-012 Implementation AC 2: "an unmapped value
 * yields BAD_OUTPUT naming the value"). When the result has NEITHER a `status` NOR a `state`
 * property, `statusMap` (if supplied) is simply unused -- this is not an error, since not every
 * capability's normalized shape has a lifecycle field at all.
 *
 * When `statusMap` is supplied but the result is an ARRAY (e.g. `format:'lines'` with no `map`,
 * or a `root`/`map` that resolves to an array), there is no top-level `status`/`state` field for
 * `statusMap` to ever examine -- the manifest author's own declared `statusMap` could never be
 * satisfied by this shape. This is fail-closed, not silently unused (TRD review Finding 7,
 * TRD-012 AC 2 intent): `mapOutput` throws `BAD_OUTPUT` naming the array shape, rather than
 * quietly returning the raw array as if the declared `statusMap` had been honored. A manifest
 * that needs status translation against a `'lines'`/array-shaped tool output must supply a
 * `map` that projects a `status` or `state` field first.
 *
 * ## Dotted-path grammar (`resolvePath`)
 *
 * Supported, exactly:
 * - `$` alone resolves to the whole base value.
 * - `$.<segment>(.<segment>)*` walks one or more `.`-separated segments into the base value.
 * - `$[<N>](.[<N>])*`-style direct index chains immediately after `$` (no name), e.g. `$[0]`,
 *   index into the base value itself when it is an array, before any named segment.
 * - A segment is `<name>` optionally followed by one or more `[<N>]` array-index suffixes
 *   (e.g. `issues[0]`, `a[0][1]`): `<name>` looks up an own, enumerable property of a plain
 *   object (never an array, never a `null`/primitive value — walking into one of those with a
 *   named segment is a `BAD_OUTPUT` error), then each `[<N>]` indexes into the resulting array
 *   in turn (indexing a non-array, or an out-of-range index, is also `BAD_OUTPUT`).
 * - A segment may instead be an alternation `<nameA>|<nameB>` (TRD interpretation I6, "array or
 *   object"): each alternative (itself optionally carrying its own `[<N>]` suffixes, e.g.
 *   `issues[0]|issue[0]`) is tried left-to-right against the current value; the first
 *   alternative whose `<name>` is present wins. This is exactly the two-alternative example the
 *   TRD gives (`$.issues|issue`, "try `.issues` then fall back to `.issue`"); nothing prevents
 *   more than two `|`-separated alternatives, but only two are ever exercised by this repo's
 *   fixtures or tests.
 *
 * Deliberately NOT supported BY THE BASE DOTTED-PATH GRAMMAR (`resolvePath`/`resolveSegment`;
 * document rather than silently misinterpret): wildcards (`*`), recursive descent (`..`),
 * slice expressions, filter/script expressions (`[?(...)]`), negative array indices, indexing a
 * plain object by a numeric-looking key (only arrays accept `[N]`), and property names that
 * themselves contain `.`, `|`, `[` or `]` (there is no quoting or escaping syntax). This is
 * intentionally a small path language, not a JSONPath implementation (TRD interpretation I6: no
 * new runtime dependency). `arrayMap` (above) is a separate, narrowly-scoped mechanism layered
 * on top of this same base grammar for per-item array filter+reshape -- it does not add a
 * filter/wildcard operator to `resolvePath` itself; a `source`/`filter.path`/`item.*` path is
 * still just an ordinary dotted path, resolved once per array item.
 *
 * ## Known limits
 *
 * `mapOutput` never mutates its `stdout` argument; for `'json'` with `map` it always builds a
 * fresh `result` object, and for the no-`map` case it returns a shallow clone of a plain-object
 * parsed value (so a subsequent `statusMap`/`trimPrefix` translation never mutates data the
 * caller might still hold a reference to) but returns arrays and primitive values (from
 * `'lines'`/`'text'`, or a `'json'` value whose root/map resolves to a non-object) as-is, since
 * there is nothing to safely clone-and-translate for those shapes and no documented
 * `status`/`state`/`trimPrefix` translation applies to them.
 *
 * `statusMap` lookup is a plain `Object.prototype.hasOwnProperty` check on the raw string value
 * found at `result.status` (or, when `status` is absent, `result.state`); it does not coerce
 * types (a numeric or boolean raw value is looked up by its own type, not stringified first)
 * and does not fall back to a default when the key is merely absent from `statusMap` — that is
 * always `BAD_OUTPUT`, per the TRD's explicit "an unmapped value yields BAD_OUTPUT" requirement.
 * `trimPrefix`, in contrast, is always a safe no-op when its declared field is missing, not a
 * string, or does not start with the declared prefix — it never throws, by design (TRD-040: it
 * must serve adapters whose raw output sometimes carries the prefix and sometimes does not).
 */

const SEGMENT_PATTERN = /^([^[\]|]+)((?:\[\d+\])*)$/;
const INDEX_PATTERN = /\[(\d+)\]/g;
const LEADING_INDEX_PATTERN = /^\[(\d+)\]/;

/**
 * Build a `BAD_OUTPUT`-coded error. Every error thrown by this module goes through here so no
 * raw `SyntaxError`/`TypeError` from `JSON.parse` or a failed property/index lookup ever
 * escapes this module uncoded.
 *
 * @param {string} message human-readable message naming what was expected and what was found
 * @returns {Error} an `Error` with `.code = 'BAD_OUTPUT'`
 */
function badOutputError(message) {
  const err = new Error(message);
  err.code = 'BAD_OUTPUT';
  return err;
}

/**
 * Describe a value's "shape" for an error message (`null` reported distinctly from `object`).
 * @param {unknown} value
 * @returns {string}
 */
function describeType(value) {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
}

/**
 * Index into an array value with a non-negative integer, per the dotted-path grammar's `[N]`
 * suffix. Indexing a non-array, or an out-of-range index, is `BAD_OUTPUT`.
 *
 * @param {unknown} current the value a `[N]` suffix is being applied to
 * @param {number} idx the parsed index
 * @param {string} path the full original path, for error messages
 * @returns {unknown}
 */
function indexInto(current, idx, path) {
  if (!Array.isArray(current)) {
    throw badOutputError(
      `mapOutput: path '${path}' indexes '[${idx}]' into a non-array value (found ${describeType(current)})`
    );
  }
  if (idx < 0 || idx >= current.length || current[idx] === undefined) {
    throw badOutputError(
      `mapOutput: path '${path}' index '[${idx}]' is out of bounds (array length ${current.length})`
    );
  }
  return current[idx];
}

/**
 * Resolve one `.`-separated segment (optionally a `|`-alternation of candidates, each
 * optionally carrying its own `[N]` index suffixes) against the current value.
 *
 * @param {unknown} current
 * @param {string} segment raw segment text, e.g. `'issues[0]'` or `'issues|issue'`
 * @param {string} path the full original path, for error messages
 * @returns {unknown}
 */
function resolveSegment(current, segment, path) {
  const candidates = segment.split('|');
  for (const candidate of candidates) {
    const match = SEGMENT_PATTERN.exec(candidate);
    if (!match) {
      throw badOutputError(`mapOutput: malformed path segment '${candidate}' in path '${path}'`);
    }
    const [, name, indexChain] = match;
    if (current === null || typeof current !== 'object' || Array.isArray(current)) {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(current, name)) {
      continue;
    }
    let value = current[name];
    let match2;
    INDEX_PATTERN.lastIndex = 0;
    // eslint-disable-next-line no-cond-assign
    while ((match2 = INDEX_PATTERN.exec(indexChain)) !== null) {
      value = indexInto(value, Number(match2[1]), path);
    }
    return value;
  }
  throw badOutputError(`mapOutput: path '${path}' has no property matching '${segment}' on the resolved value`);
}

/**
 * Resolve a dotted path (see the module header's "Dotted-path grammar" section) against a base
 * value. Exported separately from `mapOutput` so the path grammar can be unit-tested in
 * isolation.
 *
 * @param {unknown} value the base value the path is resolved against
 * @param {string} path a dotted path such as `'$'`, `'$.a.b[0]'` or `'$.issues|issue'`
 * @returns {unknown}
 */
function resolvePath(value, path) {
  if (typeof path !== 'string' || path.length === 0 || path[0] !== '$') {
    throw badOutputError(`mapOutput: dotted path must be a string starting with '$', got ${JSON.stringify(path)}`);
  }

  let rest = path.slice(1);
  let current = value;

  let leadingMatch;
  // eslint-disable-next-line no-cond-assign
  while ((leadingMatch = LEADING_INDEX_PATTERN.exec(rest)) !== null) {
    current = indexInto(current, Number(leadingMatch[1]), path);
    rest = rest.slice(leadingMatch[0].length);
  }

  if (rest === '') {
    return current;
  }
  if (rest[0] !== '.') {
    throw badOutputError(`mapOutput: malformed path '${path}': expected '.' after '$' or an index chain`);
  }

  const segments = rest.slice(1).split('.');
  for (const segment of segments) {
    if (segment === '') {
      throw badOutputError(`mapOutput: malformed path '${path}': empty segment (recursive descent '..' is not supported)`);
    }
    current = resolveSegment(current, segment, path);
  }
  return current;
}

/**
 * Apply one `parse.arrayMap` entry: resolve `spec.source` (against `baseValue`) to an array,
 * optionally filter each item by `spec.filter`, then reshape each kept item via `spec.item`.
 * See this module's header, "`arrayMap` per-item array filter + reshape", for the full
 * filter/throw semantics this implements.
 *
 * @param {unknown} baseValue the same root-projected base value `map` paths resolve against
 * @param {string} outKey the `arrayMap` key, used only for error messages
 * @param {{source: string, filter?: {path: string, equals: unknown},
 *   item: Record<string, string|{path: string, statusMap?: Record<string, unknown>}>}} spec
 * @returns {object[]}
 */
function applyArrayMapEntry(baseValue, outKey, spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw badOutputError(`mapOutput: parse.arrayMap['${outKey}'] must be an object, got ${describeType(spec)}`);
  }
  if (typeof spec.source !== 'string') {
    throw badOutputError(`mapOutput: parse.arrayMap['${outKey}'].source must be a dotted-path string, got ${describeType(spec.source)}`);
  }
  if (!spec.item || typeof spec.item !== 'object' || Array.isArray(spec.item)) {
    throw badOutputError(`mapOutput: parse.arrayMap['${outKey}'].item must be an object, got ${describeType(spec.item)}`);
  }
  if (
    spec.filter !== undefined &&
    (typeof spec.filter !== 'object' || spec.filter === null || typeof spec.filter.path !== 'string')
  ) {
    throw badOutputError(
      `mapOutput: parse.arrayMap['${outKey}'].filter must be an object with a string 'path', got ${describeType(spec.filter)}`
    );
  }

  const sourceArray = resolvePath(baseValue, spec.source);
  if (!Array.isArray(sourceArray)) {
    throw badOutputError(
      `mapOutput: parse.arrayMap['${outKey}'].source '${spec.source}' must resolve to an array, found ${describeType(sourceArray)}`
    );
  }

  const mappedItems = [];
  for (const item of sourceArray) {
    if (spec.filter) {
      let actual;
      try {
        actual = resolvePath(item, spec.filter.path);
      } catch {
        continue; // This item simply does not have the filtered field -- not a manifest defect.
      }
      if (actual !== spec.filter.equals) {
        continue;
      }
    }
    const mappedItem = {};
    for (const [itemOutKey, itemSpec] of Object.entries(spec.item)) {
      if (typeof itemSpec === 'string') {
        mappedItem[itemOutKey] = resolvePath(item, itemSpec);
        continue;
      }
      if (
        !itemSpec ||
        typeof itemSpec !== 'object' ||
        Array.isArray(itemSpec) ||
        typeof itemSpec.path !== 'string'
      ) {
        throw badOutputError(
          `mapOutput: parse.arrayMap['${outKey}'].item['${itemOutKey}'] must be a dotted-path ` +
            `string or an object with a string 'path', got ${describeType(itemSpec)}`
        );
      }
      const rawValue = resolvePath(item, itemSpec.path);
      if (itemSpec.statusMap === undefined) {
        mappedItem[itemOutKey] = rawValue;
        continue;
      }
      if (
        typeof itemSpec.statusMap !== 'object' ||
        itemSpec.statusMap === null ||
        Array.isArray(itemSpec.statusMap)
      ) {
        throw badOutputError(
          `mapOutput: parse.arrayMap['${outKey}'].item['${itemOutKey}'].statusMap must be an ` +
            `object when present, got ${describeType(itemSpec.statusMap)}`
        );
      }
      if (!Object.prototype.hasOwnProperty.call(itemSpec.statusMap, rawValue)) {
        throw badOutputError(
          `mapOutput: parse.arrayMap['${outKey}'].item['${itemOutKey}']: value ` +
            `${JSON.stringify(rawValue)} has no entry in its statusMap`
        );
      }
      mappedItem[itemOutKey] = itemSpec.statusMap[rawValue];
    }
    mappedItems.push(mappedItem);
  }
  return mappedItems;
}

/**
 * Resolve one object-form `parse.map` entry (see "`map` field specs" in the module header).
 *
 * @param {unknown} baseValue the root-projected base value
 * @param {string} outKey the `map` key, for error messages
 * @param {unknown} spec the entry value
 * @returns {{present: boolean, value?: unknown}}
 */
function resolveFieldSpec(baseValue, outKey, spec) {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec) || typeof spec.path !== 'string') {
    throw badOutputError(
      `mapOutput: parse.map['${outKey}'] must be a dotted-path string or an object with a string 'path', got ${describeType(spec)}`
    );
  }
  let value;
  let found = true;
  try {
    value = resolvePath(baseValue, spec.path);
    if (value === null) {
      found = false;
    }
  } catch (err) {
    if (spec.default === undefined && spec.optional !== true) {
      throw err;
    }
    found = false;
  }
  if (!found) {
    if (spec.default !== undefined) {
      return { present: true, value: JSON.parse(JSON.stringify(spec.default)) };
    }
    if (spec.optional === true) {
      return { present: false };
    }
    throw badOutputError(`mapOutput: parse.map['${outKey}'] path '${spec.path}' resolved to null`);
  }
  if (spec.asString === true) {
    if (typeof value !== 'number' && typeof value !== 'string') {
      throw badOutputError(
        `mapOutput: parse.map['${outKey}'] asString expects a number or string at '${spec.path}', found ${describeType(value)}`
      );
    }
    value = String(value);
  }
  return { present: true, value };
}

/**
 * Whether the optional list at `listPath` (`$.<parent...>.<name>`) is empty, null or absent.
 * The parent must resolve to a plain object (else `BAD_OUTPUT` via `resolvePath`/here).
 *
 * @param {unknown} parsed the parsed JSON document
 * @param {string} listPath validated `emptyWhen` path
 * @returns {boolean}
 */
function isEmptyList(parsed, listPath) {
  const cut = listPath.lastIndexOf('.');
  const parentPath = listPath.slice(0, cut);
  const name = listPath.slice(cut + 1);
  const parent = resolvePath(parsed, parentPath);
  if (parent === null || typeof parent !== 'object' || Array.isArray(parent)) {
    throw badOutputError(`mapOutput: '${parentPath}' is ${describeType(parent)}, not an object holding '${name}'`);
  }
  const value = Object.prototype.hasOwnProperty.call(parent, name) ? parent[name] : undefined;
  return value === undefined || value === null || (Array.isArray(value) && value.length === 0);
}

/**
 * Map one tool invocation's raw stdout into a plain value, per `parse` (see module header).
 *
 * @param {string} stdout raw stdout captured from the executed tool
 * @param {{format: 'json'|'lines'|'text', root?: string, map?: Record<string,string>,
 *   trimPrefix?: Record<string,string>, statusMap?: Record<string,string>,
 *   arrayMap?: Record<string, {source: string, filter?: {path: string, equals: unknown},
 *   item: Record<string,string>}>}} parse
 * @returns {unknown} the mapped value (an object when `map` is supplied, otherwise the
 *   format-appropriate parsed value)
 */
function mapOutput(stdout, parse) {
  if (!parse || typeof parse !== 'object') {
    throw badOutputError(`mapOutput: 'parse' must be an object, got ${describeType(parse)}`);
  }
  const { format, root, emptyWhen, map, statusMap, arrayMap, trimPrefix } = parse;
  if (format !== 'json' && format !== 'lines' && format !== 'text') {
    throw badOutputError(`mapOutput: parse.format must be one of 'json'|'lines'|'text', got ${JSON.stringify(format)}`);
  }
  if (root !== undefined && typeof root !== 'string') {
    throw badOutputError(`mapOutput: parse.root must be a string when present, got ${describeType(root)}`);
  }
  if (emptyWhen !== undefined && (typeof emptyWhen !== 'string' || !/^\$\.(?:[^.[\]|]+\.)*[^.[\]|]+$/.test(emptyWhen))) {
    throw badOutputError(`mapOutput: parse.emptyWhen must be a dotted path to a named property ('$.a.b'), got ${JSON.stringify(emptyWhen)}`);
  }
  if (map !== undefined && (typeof map !== 'object' || map === null || Array.isArray(map))) {
    throw badOutputError(`mapOutput: parse.map must be an object when present, got ${describeType(map)}`);
  }
  if (statusMap !== undefined && (typeof statusMap !== 'object' || statusMap === null || Array.isArray(statusMap))) {
    throw badOutputError(`mapOutput: parse.statusMap must be an object when present, got ${describeType(statusMap)}`);
  }
  if (arrayMap !== undefined && (typeof arrayMap !== 'object' || arrayMap === null || Array.isArray(arrayMap))) {
    throw badOutputError(`mapOutput: parse.arrayMap must be an object when present, got ${describeType(arrayMap)}`);
  }
  if (trimPrefix !== undefined && (typeof trimPrefix !== 'object' || trimPrefix === null || Array.isArray(trimPrefix))) {
    throw badOutputError(`mapOutput: parse.trimPrefix must be an object when present, got ${describeType(trimPrefix)}`);
  }
  if (arrayMap !== undefined && !map) {
    throw badOutputError(`mapOutput: parse.arrayMap requires 'parse.map' to also be declared (arrayMap entries are added onto the map-built result)`);
  }

  let baseValue;
  if (format === 'json') {
    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch (err) {
      throw badOutputError(`mapOutput: malformed JSON stdout (${err.message})`);
    }
    baseValue = emptyWhen !== undefined && isEmptyList(parsed, emptyWhen)
      ? []
      : resolvePath(parsed, root === undefined ? '$' : root);
  } else if (format === 'lines') {
    const rawLines = String(stdout).split('\n');
    if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
      rawLines.pop();
    }
    baseValue = rawLines.filter((line) => line.length > 0);
  } else {
    baseValue = String(stdout).trim();
  }

  let result;
  if (map) {
    result = {};
    for (const [outKey, spec] of Object.entries(map)) {
      if (typeof spec === 'string') {
        result[outKey] = resolvePath(baseValue, spec);
        continue;
      }
      const resolved = resolveFieldSpec(baseValue, outKey, spec);
      if (resolved.present) {
        result[outKey] = resolved.value;
      }
    }
  } else if (baseValue !== null && typeof baseValue === 'object' && !Array.isArray(baseValue)) {
    result = { ...baseValue };
  } else {
    result = baseValue;
  }

  if (arrayMap) {
    for (const [outKey, spec] of Object.entries(arrayMap)) {
      result[outKey] = applyArrayMapEntry(baseValue, outKey, spec);
    }
  }

  if (trimPrefix) {
    for (const [outKey, prefix] of Object.entries(trimPrefix)) {
      if (typeof prefix !== 'string') {
        throw badOutputError(`mapOutput: parse.trimPrefix['${outKey}'] must be a string, got ${describeType(prefix)}`);
      }
      if (
        result !== null &&
        typeof result === 'object' &&
        !Array.isArray(result) &&
        Object.prototype.hasOwnProperty.call(result, outKey) &&
        typeof result[outKey] === 'string' &&
        result[outKey].startsWith(prefix)
      ) {
        result[outKey] = result[outKey].slice(prefix.length);
      }
    }
  }

  if (statusMap) {
    if (Array.isArray(result)) {
      throw badOutputError(
        `mapOutput: parse.statusMap is declared but the mapped result is an array of length ` +
          `${result.length} (no top-level 'status' or 'state' field to translate); supply 'map' ` +
          `to project a 'status' or 'state' field, or drop 'statusMap'`
      );
    }
    if (
      result !== null &&
      typeof result === 'object' &&
      Object.prototype.hasOwnProperty.call(result, 'status')
    ) {
      const rawStatus = result.status;
      if (!Object.prototype.hasOwnProperty.call(statusMap, rawStatus)) {
        throw badOutputError(`mapOutput: status value ${JSON.stringify(rawStatus)} has no entry in parse.statusMap`);
      }
      result.status = statusMap[rawStatus];
    } else if (
      result !== null &&
      typeof result === 'object' &&
      Object.prototype.hasOwnProperty.call(result, 'state')
    ) {
      const rawState = result.state;
      if (!Object.prototype.hasOwnProperty.call(statusMap, rawState)) {
        throw badOutputError(`mapOutput: state value ${JSON.stringify(rawState)} has no entry in parse.statusMap`);
      }
      result.state = statusMap[rawState];
    }
  }

  return result;
}

module.exports = {
  mapOutput,
  resolvePath
};
