'use strict';

const path = require('path');

/**
 * Package directories that MIRROR other packages' content rather than owning any.
 *
 * `pi` is the Pi generator's own output. `full` is the Claude Code bundle: a tree of
 * symlinks into every other package, which `claude plugin install` copies dereferenced.
 * Neither is a source, and reading one as a source translates a single source file twice.
 *
 * Every generator's adapter-skill discovery has always skipped both. Their command and
 * agent discovery did not, because those read one level inside each package's `commands/`
 * and `agents/` directory and packages/full held only subdirectories there -- until it
 * began mirroring `commands/configure-team.yaml` and `agents/documentation-specialist.yaml`,
 * which `lib/team-defaults.js` and `lib/index.js` read by path, so the bundle has to carry
 * them. One identity for every JS generator rather than a copy each, because a copy per
 * generator drifting apart is how the gap stayed open in the first place. The Pi generator
 * is TypeScript and keeps its own copy in `packages/pi/src/self-contained-packages.ts`.
 */
const MIRROR_PACKAGES = new Set(['pi', 'full']);

/**
 * The package a file under `packages/` belongs to.
 *
 * By the first path segment rather than by counting `path.dirname` hops: the hop count
 * differs per glob, and a wrong count silently returns a directory name that matches no
 * exclusion, which reads exactly like a working filter.
 *
 * @param {string} file Path to a file under `packagesDir`
 * @param {string} packagesDir The packages directory it sits under
 * @returns {string} The owning package's directory name
 */
function owningPackage(file, packagesDir) {
  return path.relative(packagesDir, file).split(path.sep)[0];
}

module.exports = { MIRROR_PACKAGES, owningPackage };
