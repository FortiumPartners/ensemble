const request = require('supertest');
const app = require('../src/index');
const db = require('../src/db');

jest.mock('../src/db', () => ({
  query: jest.fn(),
}));

describe('Columns API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/boards/:boardId/columns', () => {
    it('should create a new column', async () => {
      const newColumn = { id: 1, board_id: 1, name: 'To Do', position: 1024, created_at: '2024-01-01' };

      db.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // board exists check
        .mockResolvedValueOnce({ rows: [{ next_pos: 1024 }] }) // position query
        .mockResolvedValueOnce({ rows: [newColumn] }); // insert

      const response = await request(app)
        .post('/api/boards/1/columns')
        .send({ name: 'To Do' });

      expect(response.status).toBe(201);
      expect(response.body).toEqual(newColumn);
    });

    it('should return 404 when board not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/api/boards/999/columns')
        .send({ name: 'To Do' });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 when name is missing', async () => {
      const response = await request(app)
        .post('/api/boards/1/columns')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid board ID', async () => {
      const response = await request(app)
        .post('/api/boards/invalid/columns')
        .send({ name: 'To Do' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PUT /api/columns/:id', () => {
    it('should update column name', async () => {
      const updatedColumn = { id: 1, board_id: 1, name: 'In Progress', position: 1024, created_at: '2024-01-01' };
      db.query.mockResolvedValueOnce({ rows: [updatedColumn] });

      const response = await request(app)
        .put('/api/columns/1')
        .send({ name: 'In Progress' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(updatedColumn);
    });

    it('should update column position', async () => {
      const updatedColumn = { id: 1, board_id: 1, name: 'To Do', position: 2048, created_at: '2024-01-01' };
      db.query.mockResolvedValueOnce({ rows: [updatedColumn] });

      const response = await request(app)
        .put('/api/columns/1')
        .send({ position: 2048 });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(updatedColumn);
    });

    it('should return 404 when column not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .put('/api/columns/999')
        .send({ name: 'New Name' });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
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
  });

  describe('DELETE /api/columns/:id', () => {
    it('should delete a column', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const response = await request(app).delete('/api/columns/1');

      expect(response.status).toBe(204);
    });

    it('should return 404 when column not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

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
