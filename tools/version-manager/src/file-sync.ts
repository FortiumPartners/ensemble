import * as fs from 'fs';
import { PackageInfo } from './package-scanner';
import { detectFormat, formatJson } from './json-formatter';
import { AtomicTransaction } from './atomic-transaction';
import { VersionError, ErrorCodes } from './errors';

/**
 * Version update operation for packages
 */
export interface VersionUpdate {
  newVersion: string;
  packages: PackageInfo[];
}

/**
 * Updates version field in all package files atomically
 * Preserves JSON formatting and uses atomic transactions
 *
 * @param update - Version update specification
 * @throws VersionError with appropriate error code on failure
 */
export async function updateVersions(update: VersionUpdate): Promise<void> {
  const { newVersion, packages } = update;

  // Nothing to do if no packages
  if (packages.length === 0) {
    return;
  }

  const transaction = new AtomicTransaction();

  try {
    await transaction.begin();

    // Process all files in parallel for reading
    const fileUpdates = await Promise.all(
      packages.flatMap(pkg => [
        processFile(pkg.pluginJsonPath, newVersion),
        processFile(pkg.packageJsonPath, newVersion)
      ])
    );

    // Stage all updates in the transaction
    for (const fileUpdate of fileUpdates) {
      await transaction.addFileUpdate(fileUpdate.path, fileUpdate.content);
    }

    // Commit all changes atomically
    await transaction.commit();
  } catch (error) {
    // Attempt rollback on any error
    try {
      await transaction.rollback();
    } catch (rollbackError) {
      throw new VersionError(
        `${ErrorCodes.ROLLBACK_FAILED.message}: ${rollbackError}`,
        ErrorCodes.ROLLBACK_FAILED.code,
        ErrorCodes.ROLLBACK_FAILED.recovery
      );
    }

    // Determine error type and throw appropriate VersionError
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('Failed to read') || errorMessage.includes('ENOENT')) {
      throw new VersionError(
        `${ErrorCodes.FILE_READ_ERROR.message}: ${errorMessage}`,
        ErrorCodes.FILE_READ_ERROR.code,
        ErrorCodes.FILE_READ_ERROR.recovery
      );
    } else if (errorMessage.includes('Failed to write') || errorMessage.includes('EACCES')) {
      throw new VersionError(
        `${ErrorCodes.FILE_WRITE_ERROR.message}: ${errorMessage}`,
        ErrorCodes.FILE_WRITE_ERROR.code,
        ErrorCodes.FILE_WRITE_ERROR.recovery
      );
    } else {
      throw error;
    }
  }
}

/**
 * Reads a JSON file, updates version, and formats with original style
 *
 * @param filePath - Path to JSON file
 * @param newVersion - New version to set
 * @returns Updated file content with preserved formatting
 */
async function processFile(
  filePath: string,
  newVersion: string
): Promise<{ path: string; content: string }> {
  try {
    // Read original content
    const originalContent = fs.readFileSync(filePath, 'utf-8');

    // Detect formatting style
    const format = detectFormat(originalContent);

    // Parse JSON
    const json = JSON.parse(originalContent);

    // Update version
    json.version = newVersion;

    // Format with original style
    const updatedContent = formatJson(json, format);

    return {
      path: filePath,
      content: updatedContent
    };
  } catch (error) {
    throw new Error(`Failed to process ${filePath}: ${error}`);
  }
}
