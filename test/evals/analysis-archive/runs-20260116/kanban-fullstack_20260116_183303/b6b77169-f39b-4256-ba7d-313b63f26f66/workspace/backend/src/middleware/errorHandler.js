/**
 * Centralized error handling middleware.
 * Catches all errors and returns consistent JSON error responses.
 */

/**
 * Custom application error class for typed errors.
 */
class AppError extends Error {
  /**
   * Create an application error.
   * @param {string} code - Error code (e.g., 'NOT_FOUND', 'VALIDATION_ERROR')
   * @param {string} message - Human-readable error message
   * @param {number} statusCode - HTTP status code
   */
  constructor(code, message, statusCode = 500) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.name = 'AppError';

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Express error handling middleware.
 * Should be the last middleware in the chain.
 * @param {Error} err - Error object
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 * @param {import('express').NextFunction} next - Next middleware
 */
function errorHandler(err, req, res, next) {
  // Log error for debugging (in production, use proper logging)
  if (process.env.NODE_ENV !== 'test') {
    console.error('Error:', err);
  }

  // Handle known application errors
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
      },
    });
  }

  // Handle PostgreSQL errors
  if (err.code) {
    switch (err.code) {
      // Foreign key violation
      case '23503':
        return res.status(409).json({
          error: {
            code: 'CONFLICT',
            message: 'Referenced resource does not exist',
          },
        });

      // Unique violation
      case '23505':
        return res.status(409).json({
          error: {
            code: 'CONFLICT',
            message: 'Resource already exists',
          },
        });

      // Not null violation
      case '23502':
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Required field is missing',
          },
        });

      // Check constraint violation
      case '23514':
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Value does not meet constraints',
          },
        });

      // Connection errors
      case 'ECONNREFUSED':
      case 'ENOTFOUND':
        return res.status(503).json({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Database connection failed',
          },
        });
    }
  }

  // Handle JSON parse errors
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid JSON in request body',
      },
    });
  }

  // Default to internal server error
  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred'
        : err.message || 'An unexpected error occurred',
    },
  });
}

/**
 * Not found handler for unknown routes.
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
}

module.exports = {
  AppError,
  errorHandler,
  notFoundHandler,
};
