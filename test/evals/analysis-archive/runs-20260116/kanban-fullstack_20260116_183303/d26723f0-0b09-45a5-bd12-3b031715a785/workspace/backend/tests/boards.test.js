const request = require('supertest');
const app = require('../src/index');
const db = require('../src/db');

// Mock the database module
jest.mock('../src/db', () => ({
  query: jest.fn(),
}));

describe('Boards API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/boards', () => {
    it('should return all boards', async () => {
      const mockBoards = [
        { id: 1, name: 'Project Alpha', created_at: '2024-01-01' },
        { id: 2, name: 'Project Beta', created_at: '2024-01-02' },
      ];
      db.query.mockResolvedValueOnce({ rows: mockBoards });

      const response = await request(app).get('/api/boards');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockBoards);
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
  });

  describe('POST /api/boards', () => {
    it('should create a new board', async () => {
      const newBoard = { id: 1, name: 'New Board', created_at: '2024-01-01' };
      db.query.mockResolvedValueOnce({ rows: [newBoard] });

      const response = await request(app)
        .post('/api/boards')
        .send({ name: 'New Board' });

      expect(response.status).toBe(201);
      expect(response.body).toEqual(newBoard);
      expect(db.query).toHaveBeenCalledWith(
        'INSERT INTO boards (name) VALUES ($1) RETURNING id, name, created_at',
        ['New Board']
      );
    });

    it('should return 400 when name is missing', async () => {
      const response = await request(app)
        .post('/api/boards')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when name is empty', async () => {
      const response = await request(app)
        .post('/api/boards')
        .send({ name: '   ' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should trim whitespace from board name', async () => {
      const newBoard = { id: 1, name: 'Trimmed Name', created_at: '2024-01-01' };
      db.query.mockResolvedValueOnce({ rows: [newBoard] });

      await request(app)
        .post('/api/boards')
        .send({ name: '  Trimmed Name  ' });

      expect(db.query).toHaveBeenCalledWith(
        'INSERT INTO boards (name) VALUES ($1) RETURNING id, name, created_at',
        ['Trimmed Name']
      );
    });
  });

  describe('GET /api/boards/:id', () => {
    it('should return a board with columns and cards', async () => {
      const mockBoard = { id: 1, name: 'Project Alpha', created_at: '2024-01-01', updated_at: '2024-01-01' };
      const mockColumns = [
        { id: 1, name: 'To Do', position: 1024, created_at: '2024-01-01', cards: [] },
        { id: 2, name: 'Done', position: 2048, created_at: '2024-01-01', cards: [{ id: 1, title: 'Task 1', description: null, position: 1024 }] },
      ];

      db.query
        .mockResolvedValueOnce({ rows: [mockBoard] })
        .mockResolvedValueOnce({ rows: mockColumns });

      const response = await request(app).get('/api/boards/1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ...mockBoard, columns: mockColumns });
    });

    it('should return 404 when board not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app).get('/api/boards/999');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 for invalid board ID', async () => {
      const response = await request(app).get('/api/boards/invalid');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PUT /api/boards/:id', () => {
    it('should update a board name', async () => {
      const updatedBoard = { id: 1, name: 'Updated Name', updated_at: '2024-01-02' };
      db.query.mockResolvedValueOnce({ rows: [updatedBoard] });

      const response = await request(app)
        .put('/api/boards/1')
        .send({ name: 'Updated Name' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(updatedBoard);
    });

    it('should return 404 when board not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .put('/api/boards/999')
        .send({ name: 'New Name' });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 when name is empty', async () => {
      const response = await request(app)
        .put('/api/boards/1')
        .send({ name: '' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('DELETE /api/boards/:id', () => {
    it('should delete a board', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const response = await request(app).delete('/api/boards/1');

      expect(response.status).toBe(204);
    });

    it('should return 404 when board not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

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
