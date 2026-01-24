/**
 * Column routes test suite.
 * Tests CRUD operations for columns API endpoints.
 */

const request = require('supertest');

// Mock the database module before requiring app
jest.mock('../src/db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const app = require('../src/index');
const db = require('../src/db');

describe('Column Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/boards/:boardId/columns', () => {
    it('should create a new column', async () => {
      const mockColumn = { id: 1, name: 'To Do', position: 1024, created_at: new Date() };

      // boardExists check
      db.query.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });
      // getMaxPosition
      db.query.mockResolvedValueOnce({ rows: [{ max_pos: 0 }] });
      // create
      db.query.mockResolvedValueOnce({ rows: [mockColumn] });

      const response = await request(app)
        .post('/api/boards/1/columns')
        .send({ name: 'To Do' });

      expect(response.status).toBe(201);
      expect(response.body.name).toBe('To Do');
      expect(response.body.position).toBe(1024);
    });

    it('should position new column after existing columns', async () => {
      const mockColumn = { id: 2, name: 'In Progress', position: 2048, created_at: new Date() };

      db.query.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });
      db.query.mockResolvedValueOnce({ rows: [{ max_pos: 1024 }] });
      db.query.mockResolvedValueOnce({ rows: [mockColumn] });

      const response = await request(app)
        .post('/api/boards/1/columns')
        .send({ name: 'In Progress' });

      expect(response.status).toBe(201);
      expect(response.body.position).toBe(2048);
    });

    it('should return 404 when board not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const response = await request(app)
        .post('/api/boards/999/columns')
        .send({ name: 'Test' });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
      expect(response.body.error.message).toContain('999');
    });

    it('should return 400 when name is missing', async () => {
      const response = await request(app)
        .post('/api/boards/1/columns')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when name is empty', async () => {
      const response = await request(app)
        .post('/api/boards/1/columns')
        .send({ name: '' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid board ID', async () => {
      const response = await request(app)
        .post('/api/boards/invalid/columns')
        .send({ name: 'Test' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should trim whitespace from column name', async () => {
      const mockColumn = { id: 1, name: 'Trimmed', position: 1024, created_at: new Date() };

      db.query.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });
      db.query.mockResolvedValueOnce({ rows: [{ max_pos: 0 }] });
      db.query.mockResolvedValueOnce({ rows: [mockColumn] });

      const response = await request(app)
        .post('/api/boards/1/columns')
        .send({ name: '  Trimmed  ' });

      expect(response.status).toBe(201);
      expect(db.query).toHaveBeenLastCalledWith(
        expect.any(String),
        [1, 'Trimmed', 1024]
      );
    });
  });

  describe('PUT /api/columns/:id', () => {
    it('should update column name', async () => {
      const existingColumn = { id: 1, board_id: 1, name: 'Old Name', position: 1024, created_at: new Date() };
      const updatedColumn = { id: 1, name: 'New Name', position: 1024 };

      db.query.mockResolvedValueOnce({ rows: [existingColumn] });
      db.query.mockResolvedValueOnce({ rows: [updatedColumn] });

      const response = await request(app)
        .put('/api/columns/1')
        .send({ name: 'New Name' });

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('New Name');
    });

    it('should update column position', async () => {
      const existingColumn = { id: 1, board_id: 1, name: 'Column', position: 1024, created_at: new Date() };
      const updatedColumn = { id: 1, name: 'Column', position: 512 };

      db.query.mockResolvedValueOnce({ rows: [existingColumn] });
      db.query.mockResolvedValueOnce({ rows: [updatedColumn] });

      const response = await request(app)
        .put('/api/columns/1')
        .send({ position: 512 });

      expect(response.status).toBe(200);
      expect(response.body.position).toBe(512);
    });

    it('should update both name and position', async () => {
      const existingColumn = { id: 1, board_id: 1, name: 'Old', position: 1024, created_at: new Date() };
      const updatedColumn = { id: 1, name: 'New', position: 2048 };

      db.query.mockResolvedValueOnce({ rows: [existingColumn] });
      db.query.mockResolvedValueOnce({ rows: [updatedColumn] });

      const response = await request(app)
        .put('/api/columns/1')
        .send({ name: 'New', position: 2048 });

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('New');
      expect(response.body.position).toBe(2048);
    });

    it('should return 404 when column not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .put('/api/columns/999')
        .send({ name: 'Test' });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 for invalid column ID', async () => {
      const response = await request(app)
        .put('/api/columns/invalid')
        .send({ name: 'Test' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when name is empty string', async () => {
      const response = await request(app)
        .put('/api/columns/1')
        .send({ name: '' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when position is not a number', async () => {
      const response = await request(app)
        .put('/api/columns/1')
        .send({ position: 'invalid' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return existing column when no updates provided', async () => {
      const existingColumn = { id: 1, board_id: 1, name: 'Column', position: 1024, created_at: new Date() };

      db.query.mockResolvedValueOnce({ rows: [existingColumn] });
      db.query.mockResolvedValueOnce({ rows: [existingColumn] });

      const response = await request(app)
        .put('/api/columns/1')
        .send({});

      expect(response.status).toBe(200);
    });
  });

  describe('DELETE /api/columns/:id', () => {
    it('should delete column and return 204', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });

      const response = await request(app).delete('/api/columns/1');

      expect(response.status).toBe(204);
      expect(response.body).toEqual({});
    });

    it('should return 404 when column not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const response = await request(app).delete('/api/columns/999');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 for invalid column ID', async () => {
      const response = await request(app).delete('/api/columns/invalid');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
