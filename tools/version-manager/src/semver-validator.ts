import { VersionError, ErrorCodes } from './errors';

/**
 * Validates semver version format (MAJOR.MINOR.PATCH)
 * Follows semantic versioning 2.0.0 specification
 *
 * @param version - Version string to validate
 * @throws VersionError if version is invalid
 */
export function validateSemver(version: string): void {
  // Semver pattern: MAJOR.MINOR.PATCH with optional pre-release and build metadata
  // Examples: 1.0.0, 1.2.3-alpha.1, 1.0.0+build.123
  const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

  if (!semverPattern.test(version)) {
    throw new VersionError(
      `${ErrorCodes.INVALID_VERSION.message}: "${version}" does not match semver format (MAJOR.MINOR.PATCH)`,
      ErrorCodes.INVALID_VERSION.code,
      ErrorCodes.INVALID_VERSION.recovery,
      1,
      { invalidVersion: version, expectedFormat: 'MAJOR.MINOR.PATCH (e.g., 1.0.0, 2.1.3-alpha.1)' }
    );
  }
}

/**
 * Parses semver version string into components
 *
 * @param version - Valid semver version string
 * @returns Parsed version components
 */
export function parseSemver(version: string): {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  build?: string;
} {
  validateSemver(version);

  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+(.+))?$/);
  if (!match) {
    throw new Error('Unexpected: version passed validation but failed to parse');
  }

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4],
    build: match[5]
  };
}
