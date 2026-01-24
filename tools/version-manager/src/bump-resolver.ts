import { CommitMessage } from './parser';

/**
 * Semantic version bump types
 */
export type BumpType = 'major' | 'minor' | 'patch' | 'none';

/**
 * Determine the semantic version bump type based on conventional commit messages
 *
 * Rules:
 * - Breaking change (! suffix or BREAKING CHANGE footer) → major
 * - feat → minor
 * - fix → patch
 * - other types (docs, chore, style, refactor, test, perf) → none
 *
 * @param commits - Array of parsed commit messages
 * @returns The highest precedence bump type
 */
export function determineBumpType(commits: CommitMessage[]): BumpType {
  if (commits.length === 0) {
    return 'none';
  }

  const bumpTypes: BumpType[] = commits.map(commit => {
    // Breaking change always results in major bump
    if (commit.breaking) {
      return 'major';
    }

    // Feature results in minor bump
    if (commit.type === 'feat') {
      return 'minor';
    }

    // Fix results in patch bump
    if (commit.type === 'fix') {
      return 'patch';
    }

    // All other types don't trigger version bump
    return 'none';
  });

  return applyPrecedence(bumpTypes);
}

/**
 * Apply precedence rules to determine the highest priority bump type
 *
 * Precedence order (highest to lowest):
 * 1. major (breaking changes)
 * 2. minor (new features)
 * 3. patch (bug fixes)
 * 4. none (non-versioning changes)
 *
 * @param bumpTypes - Array of bump types to evaluate
 * @returns The highest precedence bump type
 */
export function applyPrecedence(bumpTypes: BumpType[]): BumpType {
  if (bumpTypes.includes('major')) {
    return 'major';
  }

  if (bumpTypes.includes('minor')) {
    return 'minor';
  }

  if (bumpTypes.includes('patch')) {
    return 'patch';
  }

  return 'none';
}
