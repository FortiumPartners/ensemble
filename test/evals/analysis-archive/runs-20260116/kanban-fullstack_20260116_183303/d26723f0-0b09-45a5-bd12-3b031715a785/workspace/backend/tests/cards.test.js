const request = require('supertest');
const app = require('../src/index');
const db = require('../src/db');

jest.mock('../src/db', () => ({
  query: jest.fn(),
}));

describe('Cards API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/columns/:columnId/cards', () => {
    it('should create a new card', async () => {
      const newCard = {
        id: 1,
        column_id: 1,
        title: 'New Task',
        description: null,
        position: 1024,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };

      db.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // column exists
        .mockResolvedValueOnce({ rows: [{ next_pos: 1024 }] }) // position
        .mockResolvedValueOnce({ rows: [newCard] }); // insert

      const response = await request(app)
        .post('/api/columns/1/cards')
        .send({ title: 'New Task' });

      expect(response.status).toBe(201);
      expect(response.body).toEqual(newCard);
    });

    it('should create a card with description', async () => {
      const newCard = {
        id: 1,
        column_id: 1,
        title: 'New Task',
        description: 'Task description',
        position: 1024,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };

      db.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ next_pos: 1024 }] })
        .mockResolvedValueOnce({ rows: [newCard] });

      const response = await request(app)
        .post('/api/columns/1/cards')
        .send({ title: 'New Task', description: 'Task description' });

      expect(response.status).toBe(201);
      expect(response.body.description).toBe('Task description');
    });

    it('should return 404 when column not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/api/columns/999/cards')
        .send({ title: 'New Task' });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 when title is missing', async () => {
      const response = await request(app)
        .post('/api/columns/1/cards')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid column ID', async () => {
      const response = await request(app)
        .post('/api/columns/invalid/cards')
        .send({ title: 'New Task' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PUT /api/cards/:id', () => {
    it('should update card title', async () => {
      const updatedCard = {
        id: 1,
        column_id: 1,
        title: 'Updated Title',
        description: null,
        position: 1024,
        created_at: '2024-01-01',
        updated_at: '2024-01-02',
      };
      db.query.mockResolvedValueOnce({ rows: [updatedCard] });

      const response = await request(app)
        .put('/api/cards/1')
        .send({ title: 'Updated Title' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(updatedCard);
    });

    it('should update card description', async () => {
      const updatedCard = {
        id: 1,
        column_id: 1,
        title: 'Task',
        description: 'Updated description',
        position: 1024,
        created_at: '2024-01-01',
        updated_at: '2024-01-02',
      };
      db.query.mockResolvedValueOnce({ rows: [updatedCard] });

      const response = await request(app)
        .put('/api/cards/1')
        .send({ description: 'Updated description' });

      expect(response.status).toBe(200);
      expect(response.body.description).toBe('Updated description');
    });

    it('should return 404 when card not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .put('/api/cards/999')
        .send({ title: 'New Title' });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 when title is empty', async () => {
      const response = await request(app)
        .put('/api/cards/1')
        .send({ title: '' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('DELETE /api/cards/:id', () => {
    it('should delete a card', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const response = await request(app).delete('/api/cards/1');

      expect(response.status).toBe(204);
    });

    it('should return 404 when card not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app).delete('/api/cards/999');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 for invalid card ID', async () => {
      const response = await request(app).delete('/api/cards/invalid');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PATCH /api/cards/:id/move', () => {
    it('should move a card to a different column', async () => {
      const movedCard = { id: 1, column_id: 2, position: 2048 };

      db.query
        .mockResolvedValueOnce({ rows: [{ id: 2 }] }) // column exists
        .mockResolvedValueOnce({ rows: [{ id: 1, column_id: 1, title: 'Task', description: null, position: 1024 }] }) // card exists
        .mockResolvedValueOnce({ rows: [movedCard] }); // move

      const response = await request(app)
        .patch('/api/cards/1/move')
        .send({ columnId: 2, position: 2048 });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(movedCard);
    });

    it('should return 404 when target column not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .patch('/api/cards/1/move')
        .send({ columnId: 999, position: 1024 });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 404 when card not found', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // column exists
        .mockResolvedValueOnce({ rows: [] }); // card not found

      const response = await request(app)
        .patch('/api/cards/999/move')
        .send({ columnId: 1, position: 1024 });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 when columnId is missing', async () => {
      const response = await request(app)
        .patch('/api/cards/1/move')
        .send({ position: 1024 });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when position is missing', async () => {
      const response = await request(app)
        .patch('/api/cards/1/move')
        .send({ columnId: 1 });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when columnId is not a number', async () => {
      const response = await request(app)
        .patch('/api/cards/1/move')
        .send({ columnId: 'invalid', position: 1024 });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when position is not a number', async () => {
      const response = await request(app)
        .patch('/api/cards/1/move')
        .send({ columnId: 1, position: 'invalid' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
