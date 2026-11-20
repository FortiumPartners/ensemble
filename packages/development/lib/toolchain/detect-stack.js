'use strict';

/**
 * Project language detection for conditional adapter health checks.
 *
 * `preflight` used to run every `health:` entry of the resolved adapter, whatever
 * the project on disk was. The default test-runner adapter declares one health
 * check per supported language (`elixir-installed`, `python-installed`,
 * `rspec-installed`, ...), so a TypeScript repository that selects no other
 * test-runner adapter stopped with `MISSING_BINARY: elixir` before a single test
 * ran — the reported bug behind this module.
 *
 * This is deliberately a marker-file scan, NOT a copy of the `detect-stack`
 * skill: `lib/toolchain/**` is vendored byte-for-byte into the standalone
 * `packages/pi` and `packages/codex` bundles (scripts/lib/toolchain-vendor.js),
 * where neither `@sunstone-partners/ensemble-core` nor the skill's `glob`
 * optional dependency exists, and it is mirrored into `packages/full`, whose
 * bare-require closure is pinned by scripts/validate-all.js. So the only tools
 * allowed in here are `fs` and `path`, and every lookup is anchored at the
 * caller's project root — never at `__dirname`.
 *
 * The language ids and their aliases match the vocabulary of the shipped
 * `detect-stack` skill (packages/core/skills/detect-stack/patterns/*.json), so a
 * manifest written against either reads the same.
 *
 * Detection is deliberately conservative in one direction: when nothing can be
 * read or no marker matches, `languages` is EMPTY and the caller must run every
 * health check exactly as it does today. Skipping a check is the exceptional
 * path, so an unreadable project can never quietly drop a real gate.
 */

const fs = require('fs');
const path = require('path');

/**
 * Marker files per language, at the project root. A directory entry is ignored.
 * Ordered so the most specific markers are listed first for stable reporting.
 */
const LANGUAGE_MARKERS = [
  { language: 'elixir', files: ['mix.exs'] },
  { language: 'typescript', files: ['tsconfig.json', 'deno.json'] },
  { language: 'ruby', files: ['Gemfile', 'Rakefile', '.ruby-version'] },
  { language: 'python', files: ['pyproject.toml', 'setup.py', 'requirements.txt', 'Pipfile'] },
  { language: 'javascript', files: ['package.json'] },
  { language: 'csharp', files: ['global.json'] },
  { language: 'go', files: ['go.mod'] },
  { language: 'rust', files: ['Cargo.toml'] },
  { language: 'php', files: ['composer.json'] },
];

/**
 * Extensions counted in a shallow directory scan, used for ecosystems with no
 * single marker file (.NET, Java, Kotlin, Scala, plain C/C++). A language is
 * only reported from this scan when its marker file was not already found.
 */
const LANGUAGE_EXTENSIONS = [
  { language: 'csharp', extensions: ['.cs'] },
  { language: 'java', extensions: ['.java'] },
  { language: 'kotlin', extensions: ['.kt', '.kts'] },
  { language: 'scala', extensions: ['.scala'] },
  { language: 'cpp', extensions: ['.cc', '.cpp', '.cxx', '.c'] },
];

/** Directories a shallow scan never descends into. */
const SKIP_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'bower_components',
  'venv',
  '.venv',
  '__pycache__',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  '_build',
  'deps',
  'coverage',
  '.next',
  '.cache',
  '.terraform',
]);

/**
 * Spellings a manifest may use for the same language, mirroring the labels the
 * `detect-stack` skill reports (`JavaScript/TypeScript`, `C#/.NET`, ...).
 * Canonical ids are always accepted too.
 *
 * `javascript` and `typescript` normalize to each other because a Node project
 * with a `tsconfig.json` reports both, and a manifest that gates on either one
 * means "this is a Node project": node_modules, package.json and a tsconfig are
 * routinely present together, and treating the two as separate ecosystems would
 * make `when: { languages: [typescript] }` behave like a typo in plain JS repos.
 */
const LANGUAGE_ALIASES = {
  'javascript/typescript': 'javascript',
  'javascript & typescript': 'javascript',
  javascript: 'javascript',
  typescript: 'javascript',
  ts: 'javascript',
  node: 'javascript',
  'node.js': 'javascript',
  nodejs: 'javascript',
  python: 'python',
  python3: 'python',
  ruby: 'ruby',
  elixir: 'elixir',
  'c#': 'csharp',
  'c#/.net': 'csharp',
  csharp: 'csharp',
  cs: 'csharp',
  dotnet: 'csharp',
  '.net': 'csharp',
  go: 'go',
  golang: 'go',
  rust: 'rust',
  php: 'php',
  java: 'java',
  kotlin: 'kotlin',
  scala: 'scala',
  'c++': 'cpp',
  cpp: 'cpp',
  c: 'cpp',
};

/**
 * Normalise one manifest spelling to a canonical language id.
 *
 * @param {string} value raw spelling from a manifest `when.languages` entry
 * @returns {string} canonical id, lower-cased and trimmed
 */
function normalizeLanguage(value) {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  return LANGUAGE_ALIASES[raw] || raw;
}

/**
 * Read one directory entry without letting an unreadable tree stop detection.
 *
 * @param {string} dir directory to read
 * @returns {Array<{name: string, isDirectory: boolean}>} entries, empty on error
 */
function readDirSafe(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
  } catch {
    return [];
  }
}

/**
 * Detect the languages present in a project root.
 *
 * @param {string} projectRoot directory to inspect (a path that does not exist
 *   yields an empty result rather than an error, so callers fall back to running
 *   every check)
 * @returns {Promise<{languages: string[], error: string|null}>} detected
 *   canonical language ids in marker order, empty when nothing was detected
 */
async function detectStack(projectRoot) {
  const root = typeof projectRoot === 'string' && projectRoot.trim() ? projectRoot : null;
  if (!root) {
    return { languages: [], error: 'detect-stack: no project root was supplied' };
  }

  let rootEntries;
  try {
    if (!fs.statSync(root).isDirectory()) {
      return { languages: [], error: `detect-stack: ${root} is not a directory` };
    }
  } catch {
    return { languages: [], error: `detect-stack: cannot read project root ${root}` };
  }
  rootEntries = readDirSafe(root);

  const present = new Set(rootEntries.filter((entry) => !entry.isDirectory).map((entry) => entry.name));
  const found = [];
  const seen = new Set();

  function add(language) {
    const canonical = normalizeLanguage(language);
    if (!canonical || seen.has(canonical)) return;
    seen.add(canonical);
    found.push(canonical);
  }

  for (const { language, files } of LANGUAGE_MARKERS) {
    if (files.some((file) => present.has(file))) add(language);
  }

  // .NET, Java and friends have no single root marker, so count source files in
  // the root and its immediate children. Depth 2 is enough to see a `src/App/`
  // layout while keeping the scan bounded on a large checkout.
  const extensionCandidates = [];
  const directories = rootEntries.filter((entry) => entry.isDirectory && !SKIP_DIRECTORIES.has(entry.name));
  const scans = [{ entries: rootEntries }, ...directories.map((entry) => ({ entries: readDirSafe(path.join(root, entry.name)) }))];
  for (const { language, extensions } of LANGUAGE_EXTENSIONS) {
    if (seen.has(normalizeLanguage(language))) continue;
    const hit = scans.some(({ entries }) =>
      entries.some((entry) => !entry.isDirectory && extensions.includes(path.extname(entry.name).toLowerCase()))
    );
    if (hit) extensionCandidates.push(language);
  }
  for (const language of extensionCandidates) add(language);

  // A solution or project file is the .NET equivalent of a marker file, but it is
  // usually nested (src/Service/Service.csproj), so look for it in the same scan.
  if (!seen.has('csharp')) {
    const dotnetProject = scans.some(({ entries }) =>
      entries.some((entry) => !entry.isDirectory && /\.(csproj|fsproj|vbproj|sln)$/i.test(entry.name))
    );
    if (dotnetProject) add('csharp');
  }

  return { languages: found, error: null };
}

module.exports = {
  detectStack,
  normalizeLanguage,
  LANGUAGE_MARKERS,
  LANGUAGE_EXTENSIONS,
  LANGUAGE_ALIASES,
  SKIP_DIRECTORIES,
};
