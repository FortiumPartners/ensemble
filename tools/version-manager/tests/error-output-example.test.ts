import { formatError } from '../src/error-formatter';
import { VersionError, ErrorCodes } from '../src/errors';

describe('Error Output Examples', () => {
  it('should generate example error output for documentation', () => {
    // Example 1: PARSE_ERROR
    console.log('\n=== EXAMPLE 1: PARSE_ERROR (E001) ===');
    const parseError = new VersionError(
      'Commit message does not match conventional commit format',
      ErrorCodes.PARSE_ERROR.code,
      ErrorCodes.PARSE_ERROR.recovery
    );
    console.log(formatError(parseError));

    // Example 2: EMPTY_COMMIT
    console.log('\n=== EXAMPLE 2: EMPTY_COMMIT (E010) ===');
    const emptyError = new VersionError(
      ErrorCodes.EMPTY_COMMIT.message,
      ErrorCodes.EMPTY_COMMIT.code,
      ErrorCodes.EMPTY_COMMIT.recovery
    );
    console.log(formatError(emptyError));

    // Example 3: FILE_READ_ERROR with details
    console.log('\n=== EXAMPLE 3: FILE_READ_ERROR (E003) with details ===');
    const fileError = new VersionError(
      ErrorCodes.FILE_READ_ERROR.message,
      ErrorCodes.FILE_READ_ERROR.code,
      ErrorCodes.FILE_READ_ERROR.recovery,
      1,
      {
        file: '/path/to/package.json',
        errno: 'EACCES',
        message: 'Permission denied'
      }
    );
    console.log(formatError(fileError));

    // Example 4: VERSION_CONFLICT
    console.log('\n=== EXAMPLE 4: VERSION_CONFLICT (E005) ===');
    const conflictError = new VersionError(
      'Merge conflict detected in version files',
      ErrorCodes.VERSION_CONFLICT.code,
      ErrorCodes.VERSION_CONFLICT.recovery,
      1,
      {
        files: ['packages/core/package.json', 'packages/core/.claude-plugin/plugin.json'],
        conflict: '<<<<<<< HEAD\n  "version": "5.1.0"\n=======\n  "version": "5.2.0"\n>>>>>>> feature-branch'
      }
    );
    console.log(formatError(conflictError));

    // Example 5: INVALID_VERSION
    console.log('\n=== EXAMPLE 5: INVALID_VERSION (E007) ===');
    const versionError = new VersionError(
      'Invalid semver version format detected',
      ErrorCodes.INVALID_VERSION.code,
      ErrorCodes.INVALID_VERSION.recovery,
      1,
      {
        package: 'ensemble-core',
        expected: 'X.Y.Z',
        received: '1.0'
      }
    );
    console.log(formatError(versionError));

    // Example 6: UNKNOWN_ERROR
    console.log('\n=== EXAMPLE 6: UNKNOWN_ERROR (E011) ===');
    const unknownError = new VersionError(
      'Unexpected error during version bump',
      ErrorCodes.UNKNOWN_ERROR.code,
      ErrorCodes.UNKNOWN_ERROR.recovery,
      1,
      {
        originalError: 'ENOENT: no such file or directory',
        operation: 'bump-version'
      }
    );
    console.log(formatError(unknownError));
  });
});
