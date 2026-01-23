function errorHandler(err, req, res, next) {
  console.error('Error:', err);

  if (err.code === 'VALIDATION_ERROR') {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: err.message,
      },
    });
  }

  if (err.code === 'NOT_FOUND') {
    return res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: err.message,
      },
    });
  }

  if (err.code === '23505') {
    return res.status(409).json({
      error: {
        code: 'CONFLICT',
        message: 'Resource already exists',
      },
    });
  }

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}

function notFoundError(message) {
  const error = new Error(message);
  error.code = 'NOT_FOUND';
  return error;
}

function validationError(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  return error;
}

module.exports = { errorHandler, notFoundError, validationError };
