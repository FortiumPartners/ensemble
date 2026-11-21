'use strict';

/**
 * Dependency-free glob for detect-stack.
 *
 * The full bundle (packages/full) is installed with `claude plugin install`,
 * which copies the tree with symlinks dereferenced and never runs
 * `npm install`. Only what scripts/vendor-bundle-deps.js vendors under
 * packages/full/lib/node_modules exists at runtime, so detect-stack cannot
 * depend on the `glob` package: requiring it throws MODULE_NOT_FOUND inside
 * the installed plugin, and every wildcard lookup would answer "no match".
 *
 * This module implements the subset of glob(10) semantics detect-stack uses:
 *
 * - brace alternatives: recursive prefix plus `*.{ts,tsx}`
 * - `**` matching zero or more directory segments
 * - `*` and `?` inside one segment, never crossing a slash
 * - dot rule: a wildcard segment does not match a name that starts with a dot
 *   unless the pattern segment itself starts with a dot, and `**` does not
 *   descend into a dot directory
 * - `ignore` patterns, where a pattern ending in the recursive suffix also
 *   covers the directory it names
 * - the `nodir`, `absolute` and `maxDepth` options
 *
 * Symbolic links are followed like glob(10) follows them without its `follow`
 * option: a pattern segment that is not `**` enters a link to a directory, and
 * `**` enters none when it is the first item of the pattern, or one link
 * otherwise. A broken link is skipped, and no walk can loop on a cycle.
 *
 * Matches are returned sorted. glob(10) returns them in directory-walk
 * order, so a tree with many matches yields the same set of paths in a
 * different order; the skill samples the first few matches, and sorting
 * makes that sample reproducible instead of filesystem dependent.
 *
 * The scope is the patterns detect-stack passes today. Extend
 * packages/core/tests/detect-stack-glob-equivalence.test.js before adding a
 * pattern this module does not cover.
 */

const fsp = require('fs').promises;
const path = require('path');

// glob(10) matches case-insensitively on macOS and Windows, the platforms
// whose file systems are case-insensitive, and case-sensitively elsewhere.
const CASE_INSENSITIVE = process.platform === 'darwin' || process.platform === 'win32';

// Directory reads run concurrently; the limit keeps the walk below the
// process file-descriptor budget on wide trees. The scheduler is shared by
// every call in the process, so axes that scan in parallel cannot add up to
// one budget each.
const READ_CONCURRENCY = 32;
const READ_SCHEDULER = createLimiter(READ_CONCURRENCY);

/**
 * Expand brace alternatives into separate patterns.
 *
 * `{a,b}` becomes two patterns, nested groups included. A group without a
 * top-level comma is literal text, so `a{b` stays `a{b` and `*{.cs}` matches
 * nothing, exactly as glob(10) does. Alternatives are not trimmed: glob(10)
 * treats the space in `{ .cs }` as part of the name.
 *
 * @param {string} pattern Glob pattern
 * @returns {string[]} Patterns to match, one per brace alternative
 */
function expandBraces(pattern) {
  const group = findBraceGroup(pattern);
  if (!group) return [pattern];
  const expanded = [];
  for (const alternative of group.alternatives) {
    const candidate = pattern.slice(0, group.start) + alternative + pattern.slice(group.end + 1);
    expanded.push(...expandBraces(candidate));
  }
  return expanded;
}

/**
 * Find the first brace group that holds more than one alternative.
 *
 * @param {string} pattern Glob pattern
 * @returns {{start: number, end: number, alternatives: string[]}|null} Group bounds and alternatives
 */
function findBraceGroup(pattern) {
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] !== '{') continue;
    const alternatives = [];
    let depth = 0;
    let current = '';
    for (let j = i; j < pattern.length; j++) {
      const ch = pattern[j];
      if (ch === '{') {
        depth++;
        if (depth === 1) continue;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          alternatives.push(current);
          if (alternatives.length > 1) {
            return { start: i, end: j, alternatives };
          }
          break;
        }
      } else if (ch === ',' && depth === 1) {
        alternatives.push(current);
        current = '';
        continue;
      }
      current += ch;
    }
  }
  return null;
}

/**
 * Regex matching one path segment.
 *
 * The dot rule is applied to the whole segment: a segment that does not start
 * with a literal dot never matches a name starting with a dot, so `*` skips
 * `.env` while `.env*` matches it.
 *
 * @param {string} segment One path segment pattern
 * @returns {RegExp} Matcher for a single segment
 */
function segmentMatcher(segment) {
  let source = '';
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (ch === '*') {
      source += '[^/]*';
    } else if (ch === '?') {
      source += '[^/]';
    } else if (ch === '[') {
      const close = segment.indexOf(']', i + 1);
      if (close === -1) {
        source += '\\[';
        continue;
      }
      let body = segment.slice(i + 1, close);
      if (body.startsWith('!')) body = '^' + body.slice(1);
      source += `[${body}]`;
      i = close;
    } else {
      source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  const dotGuard = segment.startsWith('.') ? '' : '(?!\\.)';
  return new RegExp(`^${dotGuard}${source}$`, CASE_INSENSITIVE ? 'i' : undefined);
}

/**
 * Compile a pattern into its segments.
 *
 * @param {string} pattern Glob pattern without braces
 * @returns {Array<{kind: string, test?: RegExp}>} Compiled segments
 */
function compileSegments(pattern) {
  return pattern
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      if (segment === '**') return { kind: 'starstar' };
      return { kind: 'segment', test: segmentMatcher(segment) };
    });
}

/**
 * Match a path against compiled pattern segments.
 *
 * `**` matches zero or more segments, so a pattern ending in it covers the
 * path it names as well as everything under it, the way glob(10) treats an
 * ignore pattern.
 *
 * @param {Array<{kind: string, test?: RegExp}>} compiled Compiled pattern
 * @param {string[]} pathSegments Path split on slash
 * @returns {boolean} True when the path matches
 */
function matchesSegments(compiled, pathSegments) {
  const from = (patternIndex, pathIndex) => {
    if (patternIndex === compiled.length) return pathIndex === pathSegments.length;
    const segment = compiled[patternIndex];
    if (segment.kind === 'starstar') {
      for (let end = pathIndex; end <= pathSegments.length; end++) {
        if (end > pathIndex && pathSegments.slice(pathIndex, end).some((name) => name.startsWith('.'))) continue;
        if (from(patternIndex + 1, end)) return true;
      }
      return false;
    }
    if (pathIndex >= pathSegments.length) return false;
    if (!segment.test.test(pathSegments[pathIndex])) return false;
    return from(patternIndex + 1, pathIndex + 1);
  };
  return from(0, 0);
}

/**
 * Compile the `ignore` option into matchers.
 *
 * A pattern ending in the recursive suffix also covers the directory it
 * names, so it gets a second matcher that prunes the directory instead of
 * only filtering results.
 *
 * @param {string[]} patterns Ignore patterns
 * @returns {Array<{segments: Array<Object>, prune: Array<Object>|null}>} Compiled ignore patterns
 */
function compileIgnores(patterns) {
  return patterns.map((pattern) => {
    const recursive = pattern.endsWith('/**');
    const prunePattern = recursive ? pattern.slice(0, -3) : null;
    return {
      segments: compileSegments(pattern),
      prune: prunePattern === null ? null : compileSegments(prunePattern),
    };
  });
}

/**
 * Whether a relative path is excluded by the `ignore` option.
 *
 * @param {Array<{segments: Array<Object>}>} ignores Compiled ignore patterns
 * @param {string} relativePath Relative path
 * @returns {boolean} True when the path is ignored
 */
function isIgnored(ignores, relativePath) {
  if (ignores.length === 0) return false;
  const pathSegments = relativePath.split('/');
  return ignores.some((ignore) => matchesSegments(ignore.segments, pathSegments));
}

/**
 * Whether a relative path names a directory the walk must not descend into.
 *
 * @param {Array<{segments: Array<Object>}>} ignores Compiled ignore patterns
 * @param {string} relativePath Relative path
 * @returns {boolean} True when the directory is pruned
 */
function isPruned(ignores, relativePath) {
  if (ignores.length === 0) return false;
  const pathSegments = relativePath.split('/');
  return ignores.some((ignore) => ignore.prune !== null && matchesSegments(ignore.prune, pathSegments));
}

/**
 * Limit how many directory reads run at once.
 *
 * @param {number} limit Maximum concurrent operations
 * @returns {function(function): Promise<*>} Scheduler for a task
 */
function createLimiter(limit) {
  let active = 0;
  const queue = [];
  const drain = () => {
    while (active < limit && queue.length > 0) {
      const task = queue.shift();
      active++;
      task.run().then(task.resolve, task.reject).finally(() => {
        active--;
        drain();
      });
    }
  };
  return (run) => new Promise((resolve, reject) => {
    queue.push({ run, resolve, reject });
    drain();
  });
}

/**
 * List the entries of a directory, ignoring unreadable ones.
 *
 * The listing is cached per directory for the whole call, so a pattern with
 * several brace alternatives reads every directory once.
 *
 * @param {string} dir Absolute directory path
 * @param {Map<string, Promise<*>>} cache Listing cache
 * @param {function(function): Promise<*>} limit Read scheduler
 * @returns {Promise<Array<{name: string, isDirectory: boolean, isSymlink: boolean}>>} Directory entries
 */
function readEntries(dir, cache, limit) {
  const cached = cache.get(dir);
  if (cached) return cached;
  const pending = limit(() => fsp.readdir(dir, { withFileTypes: true }))
    .then((entries) => entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isSymlink: entry.isSymbolicLink(),
    })))
    .catch(() => []);
  cache.set(dir, pending);
  return pending;
}

/**
 * Whether a symbolic link resolves to a directory. A broken link, or one that
 * cannot be read, is not one.
 *
 * @param {string} file Absolute path of the link
 * @param {Map<string, Promise<boolean>>} cache Answers per link for the whole call
 * @param {function(function): Promise<*>} limit Read scheduler
 * @returns {Promise<boolean>} True when the link points at a directory
 */
function linkIsDirectory(file, cache, limit) {
  const key = `stat:${file}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const pending = limit(() => fsp.stat(file)).then((stat) => stat.isDirectory(), () => false);
  cache.set(key, pending);
  return pending;
}

/**
 * Match one brace-free pattern against the tree below `cwd`.
 *
 * @param {string} pattern Pattern with braces already expanded
 * @param {string} cwd Absolute root directory
 * @param {Object} options Options
 * @param {Array<Object>} options.ignores Compiled ignore patterns
 * @param {boolean} options.nodir Skip directories
 * @param {boolean} options.absolute Return absolute paths
 * @param {number|null} options.maxDepth Maximum number of path segments in a match
 * @param {Set<string>} out Collects matched paths
 * @param {Map<string, Promise<*>>} cache Listing and link-resolution cache
 * @param {function(function): Promise<*>} limit Read scheduler
 * @returns {Promise<void>} Resolves once the tree below `cwd` was walked
 */
async function walkPattern(pattern, cwd, options, out, cache, limit) {
  const compiled = compileSegments(pattern);
  if (compiled.length === 0) return;

  const addMatch = (relativePath, isDirectory, depth) => {
    if (relativePath === '') return;
    if (options.maxDepth !== null && options.maxDepth !== undefined) {
      if (depth > options.maxDepth) return;
    }
    if (isIgnored(options.ignores, relativePath)) return;
    if (options.nodir && isDirectory) return;
    out.add(options.absolute ? path.resolve(cwd, relativePath) : relativePath);
  };

  const childPath = (relativeDir, name) => (relativeDir === '' ? name : `${relativeDir}/${name}`);

  // Whether a walk may enter an entry: a directory, or a symbolic link that resolves to one.
  const isEnterable = async (entry, child) => {
    if (entry.isDirectory) return true;
    return entry.isSymlink && (await linkIsDirectory(child, cache, limit));
  };

  const walkEverythingBelow = async (dir, relativeDir, depth) => {
    const entries = await readEntries(dir, cache, limit);
    const waits = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const childRelative = childPath(relativeDir, entry.name);
      if (isPruned(options.ignores, childRelative)) continue;
      addMatch(childRelative, entry.isDirectory, depth + 1);
      if (entry.isDirectory) {
        waits.push(walkEverythingBelow(`${dir}/${entry.name}`, childRelative, depth + 1));
      }
    }
    await Promise.all(waits);
  };

  const walk = async (dir, relativeDir, patternIndex, depth, viaLink = false) => {
    const segment = compiled[patternIndex];
    if (segment.kind === 'starstar' && patternIndex === compiled.length - 1) {
      // A trailing recursive segment covers the directory itself and
      // everything under it.
      addMatch(relativeDir === '' ? '.' : relativeDir, !viaLink, relativeDir === '' ? 1 : depth);
      await walkEverythingBelow(dir, relativeDir, depth);
      return;
    }
    const entries = await readEntries(dir, cache, limit);
    if (segment.kind === 'starstar') {
      // A recursive segment matches no directory at all ...
      const waits = [walk(dir, relativeDir, patternIndex + 1, depth, viaLink)];
      // ... or any number of them. It does not follow a symbolic link, except that
      // when it is not the first item of the pattern it lets the rest of the
      // pattern match inside one link to a directory, like glob(10) without its
      // `follow` option.
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const childRelative = childPath(relativeDir, entry.name);
        if (isPruned(options.ignores, childRelative)) continue;
        const child = `${dir}/${entry.name}`;
        if (entry.isDirectory) {
          waits.push(walk(child, childRelative, patternIndex, depth + 1));
        } else if (patternIndex > 0 && entry.isSymlink) {
          waits.push((async () => {
            if (await isEnterable(entry, child)) {
              await walk(child, childRelative, patternIndex + 1, depth + 1, true);
            }
          })());
        }
      }
      await Promise.all(waits);
      return;
    }
    // A segment that is not `**` is resolved and descended even when the entry is a
    // symbolic link to a directory, like glob(10).
    const waits = [];
    for (const entry of entries) {
      const childRelative = childPath(relativeDir, entry.name);
      if (!segment.test.test(entry.name)) continue;
      if (patternIndex === compiled.length - 1) {
        addMatch(childRelative, entry.isDirectory, depth + 1);
        continue;
      }
      if (!entry.isDirectory && !entry.isSymlink) continue;
      if (isPruned(options.ignores, childRelative)) continue;
      const child = `${dir}/${entry.name}`;
      waits.push((async () => {
        if (!(await isEnterable(entry, child))) return;
        await walk(child, childRelative, patternIndex + 1, depth + 1, !entry.isDirectory);
      })());
    }
    await Promise.all(waits);
  };

  await walk(cwd, '', 0, 0);
}

/**
 * Match files under a directory.
 *
 * @param {string} pattern Glob pattern
 * @param {Object} [options] Options
 * @param {string} [options.cwd] Directory the pattern is relative to (default: process.cwd())
 * @param {string|string[]} [options.ignore] Patterns whose matches are excluded
 * @param {boolean} [options.nodir] Skip directories
 * @param {boolean} [options.absolute] Return absolute paths
 * @param {number} [options.maxDepth] Maximum number of path segments in a match
 * @returns {Promise<string[]>} Matching paths, sorted
 */
async function glob(pattern, options = {}) {
  if (typeof pattern !== 'string' || pattern.length === 0) return [];
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
  const ignores = compileIgnores([].concat(options.ignore || []));
  const out = new Set();
  const cache = new Map();
  const limit = READ_SCHEDULER;
  for (const expanded of expandBraces(pattern)) {
    await walkPattern(
      expanded,
      cwd,
      {
        ignores,
        nodir: Boolean(options.nodir),
        absolute: Boolean(options.absolute),
        maxDepth: typeof options.maxDepth === 'number' ? options.maxDepth : null,
      },
      out,
      cache,
      limit
    );
  }
  return [...out].sort();
}

module.exports = { glob, expandBraces, segmentMatcher, compileSegments, matchesSegments };