/**
 * Instruction-sequence extractor (TRD-2026-8d825f54 TRD-049, PRD REQ-024).
 *
 * Reduces a command/skill body to the ordered list of `[binary, subcommand]` tool steps it
 * instructs an agent to run, so a pre-refactor body (literal `br`/`gh`/`git ...` invocations)
 * and a post-refactor body (`toolchain-cli run <capability>` / `toolchain-cli preflight
 * --require <ids>` calls) can be compared step-for-step under the DEFAULT toolchain.
 *
 * - Literal invocations are recognised only when the binary is followed by a subcommand in the
 *   KNOWN_SUBCOMMANDS table below (so prose such as "bv is" or "git repo" is never a step).
 *   Both bodies use this same recogniser, so unchanged literal steps (e.g. `git log`) match.
 * - A capability call is resolved through the default adapter manifest's argv template (the
 *   adapter named by `packages/development/toolchain/toolchain.default.yaml`, `work-graph: auto`
 *   resolving to the shipped adapter declaring the work-graph category) and the template is
 *   reduced with the very same recogniser. `preflight --require a,b` expands to one step per
 *   listed id in order.
 * - The manifest set is injectable (`manifestOverrides`) so a test can substitute a mutated
 *   copy of one default adapter manifest.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const GENERATED_PACKAGE_DIRS = new Set(['pi', 'full', 'codex', 'opencode']);

const TOOL_BINARIES = ['git town', 'git-town', 'git', 'br', 'bv', 'gh', 'az', 'act', 'coderabbit', 'npm'];

/**
 * Subcommand grammar per binary. A string entry is a one-word subcommand; an object entry maps a
 * first word to the set of accepted second words (`dep add`, `pr create`, ...).
 */
const KNOWN_SUBCOMMANDS = {
  br: {
    words: ['show', 'list', 'create', 'update', 'close', 'sync', 'ready', 'search', 'stats', 'blocked', '--version'],
    nested: {
      comments: ['add', 'list'],
      dep: ['add', 'remove', 'tree', 'list'],
      label: ['add', 'remove', 'list']
    },
    // `br comment` is br's own documented alias of `br comments` (`br comment --help` prints
    // "Usage: br comments"); the only alias normalised anywhere in this module.
    aliases: { comment: 'comments' }
  },
  gh: {
    words: ['api'],
    nested: {
      pr: ['create', 'view', 'checks', 'merge', 'list', 'status', 'diff', 'ready', 'comment', 'review', 'edit', 'close'],
      auth: ['status', 'login'],
      repo: ['view', 'clone', 'create'],
      issue: ['view', 'list', 'create', 'comment', 'close'],
      run: ['view', 'list', 'watch']
    }
  },
  az: {
    words: [],
    nested: {},
    // az sub-command groups are three words deep (`az repos pr create`, `az devops project show`)
    deep: ['repos', 'devops', 'boards']
  },
  git: {
    words: [
      'add', 'archive', 'branch', 'checkout', 'cherry-pick', 'clone', 'commit', 'diff', 'fetch', 'init',
      'log', 'ls-files', 'merge', 'merge-base', 'mv', 'pull', 'push', 'rebase', 'remote', 'reset',
      'restore', 'rev-parse', 'rm', 'show', 'stash', 'status', 'switch', 'symbolic-ref', 'tag', 'worktree'
    ],
    nested: {}
  },
  'git-town': {
    words: ['hack', 'sync', 'propose', 'ship', 'append', 'prepend', 'compress', 'switch', 'kill', 'continue', 'undo', 'config'],
    nested: {}
  },
  act: { flagFirst: true },
  npm: { words: ['run', 'test', 'install', 'ci', 'exec', 'publish'], nested: {} },
  coderabbit: { words: ['pullrequest', 'review', 'auth'], nested: {} }
};

function cleanToken(raw) {
  return String(raw)
    .replace(/^[`'"([{<]+/, '')
    .replace(/[`'")\]}>,;:.!?]+$/, '');
}

/**
 * Reduce a binary plus its following tokens to the subcommand, or null when the tokens are not a
 * recognised subcommand of that binary.
 */
function subcommandOf(binary, tokens) {
  const grammar = KNOWN_SUBCOMMANDS[binary];
  if (!grammar) return null;
  const first = tokens[0];
  if (first === undefined) return null;
  if (binary === 'bv') return null;
  if (grammar.flagFirst) return /^-[A-Za-z]$/.test(first) ? first : null;
  if (grammar.deep) {
    if (!grammar.deep.includes(first)) return null;
    const words = [];
    for (const t of tokens) {
      if (!/^[a-z][a-z-]*$/.test(t) || words.length === 3) break;
      words.push(t);
    }
    return words.length >= 2 ? words.join(' ') : null;
  }
  const alias = grammar.aliases && grammar.aliases[first];
  const head = alias || first;
  if (grammar.nested && grammar.nested[head]) {
    return grammar.nested[head].includes(tokens[1]) ? `${head} ${tokens[1]}` : null;
  }
  if (grammar.words && grammar.words.includes(head)) return head;
  return null;
}

function parseInvocation(binaryRaw, tokens) {
  const binary = binaryRaw === 'git town' ? 'git-town' : binaryRaw;
  if (binary === 'bv') {
    const robot = tokens.find((t) => /^--robot-[a-z-]+$/.test(t));
    return robot ? ['bv', robot] : null;
  }
  const rest = binaryRaw === 'git town' ? tokens : tokens;
  const sub = subcommandOf(binary, rest);
  return sub ? [binary, sub] : null;
}

const LITERAL_RE = new RegExp(
  `(?<![\\w$./<-])(${TOOL_BINARIES.map((b) => b.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|')})((?:[ \\t]+[^\\s\`'"|;&()]+){1,4})`,
  'g'
);

const NEGATION_RE = /\b(never|no|not|nor|without|don't|forbidden|forbids)\b/i;

/**
 * A mention inside a prohibition ("NEVER `git add -A`", "No br update, br close, ...") is not a
 * step the body instructs: the clause (text since the previous sentence/clause boundary) around
 * the mention contains a negation word.
 */
function isProhibited(line, index) {
  const before = line.slice(0, index);
  const boundary = Math.max(before.lastIndexOf('. '), before.lastIndexOf('; '), before.lastIndexOf(': '), before.lastIndexOf('('));
  return NEGATION_RE.test(before.slice(boundary + 1));
}

const NODE_RUNNER_RE = /(?<![\w$./-])node[ \t]+["']?([\w./-]*skills\/[\w-]+\/run-test\.js)/g;
const CAPABILITY_RUN_RE = /(?:TOOLCHAIN_CLI|toolchain-cli(?:\.js)?)["'\\]*\s+run\s+([a-z][a-z-]*\.[a-z](?:[a-z.-]*[a-z])?)/g;
const CAPABILITY_PREFLIGHT_RE = /(?:TOOLCHAIN_CLI|toolchain-cli(?:\.js)?)["'\\]*\s+preflight\b([^]*?)(?=(?:TOOLCHAIN_CLI|toolchain-cli)|$)/g;
const REQUIRE_RE = /--require[ =]+([a-z][a-z-]*\.[a-z](?:[a-z.,-]*[a-z])?)/g;
const CAPABILITY_ID_RE = /(?<![\w.-])([a-z][a-z-]*\.[a-z][a-z-]*)(?![\w.-])/g;
// `run <capability>` with a placeholder instead of an id: the line's own capability ids are then
// the calls the placeholder stands for (e.g. "Run work-graph.plan and work-graph.graph-health
// via node "$TOOLCHAIN_CLI" run <capability> ...", or "Supported mutations include tracker.x, ...").
const CAPABILITY_PLACEHOLDER_RE = /(?:TOOLCHAIN_CLI|toolchain-cli(?:\.js)?)["'\\]*\s+run\s+<[a-z -]*>/;

/** Collect string leaves of a parsed YAML value in document order. */
function collectStrings(value, out) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, out));
}

/**
 * Body text units for a command YAML (its `workflow` block, then every other non-metadata block) or a SKILL.md (frontmatter
 * removed), in document order.
 */
function bodyUnits(text, kind) {
  if (kind === 'yaml') {
    const doc = yaml.load(text);
    const out = [];
    // The `workflow` block holds the executable steps, in order; every other non-metadata block
    // (mission, constraints, ...) follows it. Those define shared variables and rules (e.g. a
    // FULL_TEST_COMMAND the steps reference), so a step that appears only there is appended after
    // the workflow steps instead of reordering them (first-mention order in a summary says nothing
    // about execution order). `metadata` is descriptive text and is never scanned.
    const { workflow, metadata, ...rest } = doc || {};
    collectStrings(workflow, out);
    collectStrings(rest, out);
    return out.flatMap((s) => s.split('\n'));
  }
  const stripped = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  return stripped.split('\n');
}

/**
 * Extract the ordered step list of one body.
 *
 * @param {string} text file content
 * @param {{kind:'yaml'|'markdown', templates?:Map<string,string[]>|null}} opts `templates` is the
 *   capability -> argv map from `loadDefaultTemplates`; pass null for a pre-refactor body (a
 *   pre-refactor body has no capability calls, so they are not resolved).
 * @returns {{binary:string, sub:string, source:string, capability?:string, line:string}[]}
 */
function extractSteps(text, opts = {}) {
  const kind = opts.kind || 'yaml';
  const templates = opts.templates || null;
  const steps = [];
  for (const line of bodyUnits(text, kind)) {
    const found = [];
    for (const m of line.matchAll(LITERAL_RE)) {
      if (isProhibited(line, m.index)) continue;
      const tokens = m[2].trim().split(/\s+/).map(cleanToken);
      const inv = parseInvocation(m[1], tokens);
      if (inv) found.push({ index: m.index, binary: inv[0], sub: inv[1], source: 'literal', line });
    }
    for (const m of line.matchAll(NODE_RUNNER_RE)) {
      found.push({ index: m.index, binary: 'node', sub: m[1], source: 'literal', line });
    }
    if (templates) {
      for (const m of line.matchAll(CAPABILITY_RUN_RE)) {
        found.push(...resolveCapabilities([m[1]], templates, 'run', m.index, line));
      }
      if (CAPABILITY_PLACEHOLDER_RE.test(line)) {
        for (const m of line.matchAll(CAPABILITY_ID_RE)) {
          if (!templates.has(m[1]) || isProhibited(line, m.index)) continue;
          if (found.some((f) => f.source === 'run' && f.capability === m[1])) continue;
          found.push(...resolveCapabilities([m[1]], templates, 'run', m.index, line));
        }
      }
      for (const m of line.matchAll(CAPABILITY_PREFLIGHT_RE)) {
        const ids = [];
        for (const r of m[1].matchAll(REQUIRE_RE)) ids.push(...r[1].split(',').filter(Boolean));
        found.push(...resolveCapabilities(ids, templates, 'preflight', m.index, line));
      }
    }
    found.sort((a, b) => a.index - b.index);
    steps.push(...found);
  }
  return steps;
}

function resolveCapabilities(ids, templates, source, index, line) {
  return ids.map((id) => {
    const argv = templates.get(id);
    const inv = argv ? templateInvocation(argv) : null;
    return inv
      ? { index, binary: inv[0], sub: inv[1], source, capability: id, line }
      : { index, binary: '<unresolved>', sub: id, source, capability: id, line };
  });
}

/** Reduce a manifest argv template to `[binary, subcommand]` with the shared recogniser. */
function templateInvocation(argv) {
  const [bin, ...rest] = argv.map(String);
  if (bin === 'node' && rest[0] && /skills\/[\w-]+\/run-test\.js$/.test(rest[0])) return ['node', rest[0]];
  if (bin === 'bv') return parseInvocation('bv', rest);
  const tokens = [];
  for (const t of rest) {
    if (t.includes('${')) break;
    tokens.push(t);
  }
  const known = parseInvocation(bin, tokens);
  if (known) return known;
  // A subcommand outside KNOWN_SUBCOMMANDS (e.g. a mutated or newly added template): keep its
  // leading literal words so the step still differs from the golden instead of being masked.
  const words = [];
  for (const t of tokens) {
    if (t.startsWith('-') || words.length === 3) break;
    words.push(t);
  }
  return [bin, words.length > 0 ? words.join(' ') : tokens[0] || ''];
}

/** Sequence of `[binary, subcommand]` pairs. */
function extractSequence(text, opts = {}) {
  return extractSteps(text, opts).map((s) => [s.binary, s.sub]);
}

function packageDirs(root) {
  return fs
    .readdirSync(path.join(root, 'packages'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !GENERATED_PACKAGE_DIRS.has(e.name))
    .map((e) => path.join(root, 'packages', e.name));
}

/** Source (non-generated) adapter manifests, keyed by adapter directory basename. */
function discoverManifestPaths(root) {
  const found = new Map();
  for (const pkg of packageDirs(root)) {
    const skills = path.join(pkg, 'skills');
    if (!fs.existsSync(skills)) continue;
    for (const entry of fs.readdirSync(skills, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('adapter-')) continue;
      const manifest = path.join(skills, entry.name, 'adapter.yaml');
      if (fs.existsSync(manifest)) found.set(entry.name, manifest);
    }
  }
  return found;
}

/**
 * Build the capability id -> argv template map for the DEFAULT adapter of every category (the
 * shipped `toolchain.default.yaml`; no project/user config is consulted, i.e. an unconfigured
 * project). `manifestOverrides` maps an adapter directory name (e.g. `adapter-host-github`) to a
 * replacement manifest path, used to run the comparison against a mutated template.
 */
function loadDefaultTemplates(root, opts = {}) {
  const defaults = yaml.load(
    fs.readFileSync(path.join(root, 'packages/development/toolchain/toolchain.default.yaml'), 'utf8')
  );
  const manifests = discoverManifestPaths(root);
  const overrides = opts.manifestOverrides || {};
  const loaded = [];
  for (const [dirName, manifestPath] of manifests) {
    const file = overrides[dirName] || manifestPath;
    loaded.push({ dirName, doc: yaml.load(fs.readFileSync(file, 'utf8')) });
  }
  const templates = new Map();
  for (const [category, adapterName] of Object.entries(defaults)) {
    const candidates = loaded.filter(
      ({ doc }) => doc && Array.isArray(doc.categories) && doc.categories.includes(category)
    );
    // `auto` mirrors production `work-graph-resolve.js#resolveWorkGraphAdapter`: the provider is
    // the ALREADY-RESOLVED tracker adapter's own manifest, never "every adapter that declares
    // this category". Without that, shipping a second work-graph-declaring tracker
    // (adapter-tracker-kata) let readdir order decide whose `work-graph.*` templates won below.
    const chosen = candidates.filter(({ doc }) =>
      adapterName === 'auto' ? doc.adapter === defaults.tracker : doc.adapter === adapterName
    );
    if (chosen.length === 0) {
      if (adapterName === 'auto') continue; // production falls back to the builtin adapter, which ships no `run` templates
      throw new Error(`default adapter "${adapterName}" for category "${category}" has no source manifest`);
    }
    for (const { doc } of chosen) {
      for (const [capId, cap] of Object.entries(doc.capabilities || {})) {
        if (!capId.startsWith(`${category}.`) || !cap || !Array.isArray(cap.run)) continue;
        templates.set(capId, cap.run);
      }
    }
  }
  return templates;
}

module.exports = {
  KNOWN_SUBCOMMANDS,
  extractSteps,
  extractSequence,
  loadDefaultTemplates,
  discoverManifestPaths,
  templateInvocation,
  bodyUnits
};
