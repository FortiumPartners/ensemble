/**
 * Board routes test suite.
 * Tests CRUD operations for boards API endpoints.
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

describe('Board Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/boards', () => {
    it('should return all boards', async () => {
      const mockBoards = [
        { id: 1, name: 'Board 1', created_at: new Date() },
        { id: 2, name: 'Board 2', created_at: new Date() },
      ];

      db.query.mockResolvedValueOnce({ rows: mockBoards });

      const response = await request(app).get('/api/boards');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].name).toBe('Board 1');
      expect(db.query).toHaveBeenCalledWith(
        'SELECT id, name, created_at FROM boards ORDER BY created_at DESC'
      );
    });

    it('should return empty array when no boards exist', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app).get('/api/boards');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should handle database errors', async () => {
      db.query.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app).get('/api/boards');

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /api/boards', () => {
    it('should create a new board', async () => {
      const mockBoard = { id: 1, name: 'New Board', created_at: new Date() };
      db.query.mockResolvedValueOnce({ rows: [mockBoard] });

      const response = await request(app)
        .post('/api/boards')
        .send({ name: 'New Board' });

      expect(response.status).toBe(201);
      expect(response.body.name).toBe('New Board');
      expect(db.query).toHaveBeenCalledWith(
        'INSERT INTO boards (name) VALUES ($1) RETURNING id, name, created_at',
        ['New Board']
      );
    });

    it('should trim whitespace from board name', async () => {
      const mockBoard = { id: 1, name: 'Trimmed Board', created_at: new Date() };
      db.query.mockResolvedValueOnce({ rows: [mockBoard] });

      const response = await request(app)
        .post('/api/boards')
        .send({ name: '  Trimmed Board  ' });

      expect(response.status).toBe(201);
      expect(db.query).toHaveBeenCalledWith(
        expect.any(String),
        ['Trimmed Board']
      );
    });

    it('should return 400 when name is missing', async () => {
      const response = await request(app)
        .post('/api/boards')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('name is required');
    });

    it('should return 400 when name is empty string', async () => {
      const response = await request(app)
        .post('/api/boards')
        .send({ name: '' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when name is only whitespace', async () => {
      const response = await request(app)
        .post('/api/boards')
        .send({ name: '   ' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when name is not a string', async () => {
      const response = await request(app)
        .post('/api/boards')
        .send({ name: 123 });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/boards/:id', () => {
    it('should return board with columns and cards', async () => {
      const mockBoard = {
        id: 1,
        name: 'Test Board',
        created_at: new Date(),
        updated_at: new Date(),
      };
      const mockColumns = [
        { id: 1, name: 'To Do', position: 1024, created_at: new Date() },
        { id: 2, name: 'Done', position: 2048, created_at: new Date() },
      ];
      const mockCards = [
        {
          id: 1,
          column_id: 1,
          title: 'Card 1',
          description: 'Desc',
          position: 1024,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      db.query
        .mockResolvedValueOnce({ rows: [mockBoard] })
        .mockResolvedValueOnce({ rows: mockColumns })
        .mockResolvedValueOnce({ rows: mockCards });

      const response = await request(app).get('/api/boards/1');

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('Test Board');
      expect(response.body.columns).toHaveLength(2);
      expect(response.body.columns[0].cards).toHaveLength(1);
    });

    it('should return board with empty columns array when no columns', async () => {
      const mockBoard = { id: 1, name: 'Empty Board', created_at: new Date(), updated_at: new Date() };

      db.query
        .mockResolvedValueOnce({ rows: [mockBoard] })
        .mockResolvedValueOnce({ rows: [] });

      const response = await request(app).get('/api/boards/1');

      expect(response.status).toBe(200);
      expect(response.body.columns).toHaveLength(0);
    });

    it('should return 404 when board not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app).get('/api/boards/999');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
      expect(response.body.error.message).toContain('999');
    });

    it('should return 400 for invalid board ID', async () => {
      const response = await request(app).get('/api/boards/invalid');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PUT /api/boards/:id', () => {
    it('should update board name', async () => {
      const mockBoard = { id: 1, name: 'Updated Board', updated_at: new Date() };
      db.query.mockResolvedValueOnce({ rows: [mockBoard] });

      const response = await request(app)
        .put('/api/boards/1')
        .send({ name: 'Updated Board' });

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('Updated Board');
    });

    it('should return 404 when board not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .put('/api/boards/999')
        .send({ name: 'New Name' });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 when name is missing', async () => {
      const response = await request(app)
        .put('/api/boards/1')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid board ID', async () => {
      const response = await request(app)
        .put('/api/boards/invalid')
        .send({ name: 'Test' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('DELETE /api/boards/:id', () => {
    it('should delete board and return 204', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });

      const response = await request(app).delete('/api/boards/1');

      expect(response.status).toBe(204);
      expect(response.body).toEqual({});
    });

    it('should return 404 when board not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const response = await request(app).delete('/api/boards/999');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 for invalid board ID', async () => {
      const response = await request(app).delete('/api/boards/invalid');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
