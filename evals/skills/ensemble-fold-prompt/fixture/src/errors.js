'use strict';

class AppError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'AppError';
    this.status = status;
  }
}

class NotFoundError extends AppError {
  constructor(what) { super(`${what} not found`, 404); }
}

module.exports = { AppError, NotFoundError };
