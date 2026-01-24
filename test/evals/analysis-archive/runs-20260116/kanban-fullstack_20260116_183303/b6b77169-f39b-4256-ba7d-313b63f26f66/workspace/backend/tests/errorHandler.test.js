/**
 * Error handler middleware test suite.
 * Tests centralized error handling and custom errors.
 */

const request = require('supertest');

// Mock the database module
jest.mock('../src/db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const app = require('../src/index');
const db = require('../src/db');
const { AppError, errorHandler, notFoundHandler } = require('../src/middleware/errorHandler');

describe('Error Handler Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('AppError', () => {
    it('should create an error with code, message, and status', () => {
      const error = new AppError('TEST_ERROR', 'Test message', 400);

      expect(error.code).toBe('TEST_ERROR');
      expect(error.message).toBe('Test message');
      expect(error.statusCode).toBe(400);
      expect(error.name).toBe('AppError');
    });

    it('should default to 500 status code', () => {
      const error = new AppError('TEST_ERROR', 'Test message');

      expect(error.statusCode).toBe(500);
    });

    it('should maintain stack trace', () => {
      const error = new AppError('TEST_ERROR', 'Test message', 400);

      expect(error.stack).toBeDefined();
    });
  });

  describe('notFoundHandler', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await request(app).get('/api/unknown/route');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
      expect(response.body.error.message).toContain('/api/unknown/route');
    });

    it('should include HTTP method in message', async () => {
      const response = await request(app).post('/api/unknown');

      expect(response.status).toBe(404);
      expect(response.body.error.message).toContain('POST');
    });
  });

  describe('PostgreSQL error handling', () => {
    it('should handle foreign key violation (23503)', async () => {
      const pgError = new Error('Foreign key violation');
      pgError.code = '23503';
      db.query.mockRejectedValueOnce(pgError);

      const response = await request(app).get('/api/boards');

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('should handle unique violation (23505)', async () => {
      const pgError = new Error('Unique violation');
      pgError.code = '23505';
      db.query.mockRejectedValueOnce(pgError);

      const response = await request(app).get('/api/boards');

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('should handle not null violation (23502)', async () => {
      const pgError = new Error('Not null violation');
      pgError.code = '23502';
      db.query.mockRejectedValueOnce(pgError);

      const response = await request(app).get('/api/boards');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle check constraint violation (23514)', async () => {
      const pgError = new Error('Check constraint violation');
      pgError.code = '23514';
      db.query.mockRejectedValueOnce(pgError);

      const response = await request(app).get('/api/boards');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle connection refused error', async () => {
      const connError = new Error('Connection refused');
      connError.code = 'ECONNREFUSED';
      db.query.mockRejectedValueOnce(connError);

      const response = await request(app).get('/api/boards');

      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('should handle ENOTFOUND error', async () => {
      const connError = new Error('Host not found');
      connError.code = 'ENOTFOUND';
      db.query.mockRejectedValueOnce(connError);

      const response = await request(app).get('/api/boards');

      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
    });
  });

  describe('JSON parse error handling', () => {
    it('should handle invalid JSON in request body', async () => {
      const response = await request(app)
        .post('/api/boards')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('Invalid JSON');
    });
  });

  describe('Generic error handling', () => {
    it('should handle unknown errors as 500', async () => {
      db.query.mockRejectedValueOnce(new Error('Unknown error'));

      const response = await request(app).get('/api/boards');

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('Health check', () => {
    it('should return OK status', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.timestamp).toBeDefined();
    });
  });
});

describe('errorHandler function directly', () => {
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    mockReq = {};
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  it('should handle AppError correctly', () => {
    const error = new AppError('CUSTOM_ERROR', 'Custom message', 422);

    errorHandler(error, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(422);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: {
        code: 'CUSTOM_ERROR',
        message: 'Custom message',
      },
    });
  });

  it('should handle generic Error objects', () => {
    const error = new Error('Generic error');

    errorHandler(error, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Generic error',
      },
    });
  });
});

describe('notFoundHandler function directly', () => {
  it('should return 404 with route info', () => {
    const mockReq = { method: 'GET', path: '/test' };
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    notFoundHandler(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: {
        code: 'NOT_FOUND',
        message: 'Route GET /test not found',
      },
    });
  });
});
