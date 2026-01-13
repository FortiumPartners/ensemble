import * as fs from 'fs';
import * as path from 'path';
import { VersionError, ErrorCodes } from './errors';

interface FileUpdate {
  path: string;
  newContent: string;
  originalContent: string | null; // null for new files
}

/**
 * Manages atomic file transactions with rollback capability
 * All file updates succeed or all are rolled back
 */
export class AtomicTransaction {
  private updates: FileUpdate[] = [];
  private inProgress: boolean = false;

  /**
   * Begins a new transaction
   * @throws Error if transaction already in progress
   */
  async begin(): Promise<void> {
    if (this.inProgress) {
      throw new Error('Transaction already in progress');
    }
    this.inProgress = true;
    this.updates = [];
  }

  /**
   * Stages a file update in the current transaction
   * Backs up the original content if file exists
   *
   * @param filePath - Path to the file to update
   * @param newContent - New content for the file
   * @throws Error if no transaction in progress
   */
  async addFileUpdate(filePath: string, newContent: string): Promise<void> {
    if (!this.inProgress) {
      throw new Error('No transaction in progress');
    }

    // Read original content if file exists
    let originalContent: string | null = null;
    if (fs.existsSync(filePath)) {
      try {
        originalContent = fs.readFileSync(filePath, 'utf-8');
      } catch (error) {
        throw new Error(`Failed to read file ${filePath}: ${error}`);
      }
    }

    this.updates.push({
      path: filePath,
      newContent,
      originalContent
    });
  }

  /**
   * Commits all staged changes atomically
   * If any write fails, rolls back all changes
   *
   * @throws Error if no transaction in progress or if writes fail
   */
  async commit(): Promise<void> {
    if (!this.inProgress) {
      throw new Error('No transaction in progress');
    }

    try {
      // Apply all updates
      for (const update of this.updates) {
        try {
          // Check that parent directory exists (don't create it)
          const dir = path.dirname(update.path);
          if (!fs.existsSync(dir)) {
            throw new Error(`Directory does not exist: ${dir}`);
          }

          // Write new content
          fs.writeFileSync(update.path, update.newContent, 'utf-8');
        } catch (writeError) {
          // Attempt rollback on write failure
          try {
            await this.performRollback();
            // Rollback succeeded - clean up and re-throw write error
            this.updates = [];
            this.inProgress = false;
            throw new Error(`Failed to write file ${update.path}: ${writeError}`);
          } catch (rollbackError) {
            // Rollback failed - keep transaction in progress
            throw new VersionError(
              `${ErrorCodes.ROLLBACK_FAILED.message}: ${rollbackError}`,
              ErrorCodes.ROLLBACK_FAILED.code,
              ErrorCodes.ROLLBACK_FAILED.recovery,
              1,
              { originalError: String(writeError), rollbackError: String(rollbackError) }
            );
          }
        }
      }

      // Success - clean up
      this.updates = [];
      this.inProgress = false;
    } catch (error) {
      // Re-throw error (already handled above)
      throw error;
    }
  }

  /**
   * Rolls back all staged changes
   * Restores original content for existing files
   * Removes new files that were added
   *
   * @throws Error if no transaction in progress
   */
  async rollback(): Promise<void> {
    if (!this.inProgress) {
      throw new Error('No transaction in progress');
    }

    await this.performRollback();

    // Clean up
    this.updates = [];
    this.inProgress = false;
  }

  /**
   * Internal method to perform the actual rollback
   * Restores all backed up content
   */
  private async performRollback(): Promise<void> {
    const errors: string[] = [];

    // Restore in reverse order
    for (let i = this.updates.length - 1; i >= 0; i--) {
      const update = this.updates[i];

      try {
        if (update.originalContent !== null) {
          // Restore original content
          fs.writeFileSync(update.path, update.originalContent, 'utf-8');
        } else {
          // Remove new file if it was created
          if (fs.existsSync(update.path)) {
            fs.unlinkSync(update.path);
          }
        }
      } catch (error) {
        errors.push(`Failed to rollback ${update.path}: ${error}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Rollback failed:\n${errors.join('\n')}`);
    }
  }
}
