/**
 * Error Handler Module
 * Defines error types and error collection/reporting for the YAML-to-Markdown generator
 */

'use strict';

/**
 * Base error class for validation errors
 */
class ValidationError extends Error {
  constructor(filePath, field, message) {
    super(`${filePath}: [${field}] ${message}`);
    this.name = 'ValidationError';
    this.filePath = filePath;
    this.field = field;
    this.details = message;
  }
}

/**
 * Error class for generation/transformation errors
 */
class GenerationError extends Error {
  constructor(filePath, message) {
    super(`${filePath}: ${message}`);
    this.name = 'GenerationError';
    this.filePath = filePath;
    this.details = message;
  }
}

/**
 * Error class for file I/O errors
 */
class IOError extends Error {
  constructor(filePath, operation, message) {
    super(`${filePath}: [${operation}] ${message}`);
    this.name = 'IOError';
    this.filePath = filePath;
    this.operation = operation;
    this.details = message;
  }
}

/**
 * Error class for orphan cleanup errors
 */
class CleanupError extends Error {
  constructor(filePath, message) {
    super(`${filePath}: ${message}`);
    this.name = 'CleanupError';
    this.filePath = filePath;
    this.details = message;
  }
}

/**
 * Error collector for accumulating errors across multiple files
 */
class ErrorCollector {
  constructor(options = {}) {
    this.errors = [];
    this.warnings = [];
    this.failFast = options.failFast || false;
  }

  /**
   * Add an error to the collection
   * @param {Error} error - Error to add
   * @throws {Error} If failFast is enabled
   */
  addError(error) {
    this.errors.push(error);
    if (this.failFast) {
      throw error;
    }
  }

  /**
   * Add multiple errors to the collection
   * @param {Error[]} errors - Array of errors to add
   */
  addErrors(errors) {
    if (Array.isArray(errors)) {
      errors.forEach(err => this.addError(err));
    } else {
      this.addError(errors);
    }
  }

  /**
   * Add a warning (non-fatal)
   * @param {string} message - Warning message
   * @param {string} filePath - Related file path
   */
  addWarning(message, filePath = null) {
    this.warnings.push({ message, filePath });
  }

  /**
   * Check if there are any errors
   * @returns {boolean}
   */
  hasErrors() {
    return this.errors.length > 0;
  }

  /**
   * Check if there are any warnings
   * @returns {boolean}
   */
  hasWarnings() {
    return this.warnings.length > 0;
  }

  /**
   * Get error count
   * @returns {number}
   */
  errorCount() {
    return this.errors.length;
  }

  /**
   * Format errors for console output
   * @returns {string}
   */
  formatErrors() {
    if (this.errors.length === 0) {
      return '';
    }

    const lines = [
      '',
      `\x1b[31m✖ ${this.errors.length} error${this.errors.length > 1 ? 's' : ''} found:\x1b[0m`,
      ''
    ];

    this.errors.forEach((error, index) => {
      lines.push(`  ${index + 1}. \x1b[33m${error.filePath || 'unknown'}\x1b[0m`);
      if (error.field) {
        lines.push(`     Field: ${error.field}`);
      }
      lines.push(`     ${error.details || error.message}`);
      lines.push('');
    });

    return lines.join('\n');
  }

  /**
   * Format warnings for console output
   * @returns {string}
   */
  formatWarnings() {
    if (this.warnings.length === 0) {
      return '';
    }

    const lines = [
      '',
      `\x1b[33m⚠ ${this.warnings.length} warning${this.warnings.length > 1 ? 's' : ''}:\x1b[0m`,
      ''
    ];

    this.warnings.forEach((warning, index) => {
      const prefix = warning.filePath ? `${warning.filePath}: ` : '';
      lines.push(`  ${index + 1}. ${prefix}${warning.message}`);
    });

    lines.push('');
    return lines.join('\n');
  }

  /**
   * Print all errors and warnings to console
   */
  report() {
    if (this.hasWarnings()) {
      console.error(this.formatWarnings());
    }
    if (this.hasErrors()) {
      console.error(this.formatErrors());
    }
  }

  /**
   * Get exit code based on errors
   * @returns {number} 0 if no errors, 1 if errors
   */
  getExitCode() {
    return this.hasErrors() ? 1 : 0;
  }
}

module.exports = {
  ValidationError,
  GenerationError,
  IOError,
  CleanupError,
  ErrorCollector
};
