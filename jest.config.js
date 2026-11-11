/**
 * Root jest config: what `npx jest scripts/tests` and `npx jest evals` (CI, ci:local, the local-ci gate) use.
 * The workspace packages keep their own config; jest takes the nearest one, so this file is not seen from them.
 *
 * `.ensemble/` holds runtime state, including `pr-review-prepare`'s read-only copies of whole PR heads
 * (`.ensemble/pr-review/prepare/<run>/<head>/<fingerprint>/snapshot/`). jest's default crawl descends into them, so a
 * path filter like `scripts/tests` ran every snapshot's copy of each test too (11 tests became 44, 33 of them failing:
 * a snapshot has no node_modules) and the haste map reported every snapshot's package.json as a naming collision.
 * `modulePathIgnorePatterns` removes the directory from the crawl itself, which covers both; a `testPathIgnorePatterns`
 * entry would only hide the test files and leave the collisions.
 *
 * Anchored on `<rootDir>`, not a bare `/\.ensemble/`: jest run with a snapshot as its own root (its path contains
 * `/.ensemble/`) must still find its tests.
 */
module.exports = {
  modulePathIgnorePatterns: ['<rootDir>/\\.ensemble/'],
};
