/**
 * Card routes test suite.
 * Tests CRUD and move operations for cards API endpoints.
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

describe('Card Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/columns/:columnId/cards', () => {
    it('should create a new card with title only', async () => {
      const mockCard = {
        id: 1,
        title: 'New Card',
        description: null,
        position: 1024,
        created_at: new Date(),
      };

      // columnExists check
      db.query.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });
      // getMaxPosition
      db.query.mockResolvedValueOnce({ rows: [{ max_pos: 0 }] });
      // create
      db.query.mockResolvedValueOnce({ rows: [mockCard] });

      const response = await request(app)
        .post('/api/columns/1/cards')
        .send({ title: 'New Card' });

      expect(response.status).toBe(201);
      expect(response.body.title).toBe('New Card');
      expect(response.body.position).toBe(1024);
    });

    it('should create a new card with title and description', async () => {
      const mockCard = {
        id: 1,
        title: 'New Card',
        description: 'Card description',
        position: 1024,
        created_at: new Date(),
      };

      db.query.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });
      db.query.mockResolvedValueOnce({ rows: [{ max_pos: 0 }] });
      db.query.mockResolvedValueOnce({ rows: [mockCard] });

      const response = await request(app)
        .post('/api/columns/1/cards')
        .send({ title: 'New Card', description: 'Card description' });

      expect(response.status).toBe(201);
      expect(response.body.description).toBe('Card description');
    });

    it('should position new card after existing cards', async () => {
      const mockCard = {
        id: 2,
        title: 'Second Card',
        description: null,
        position: 2048,
        created_at: new Date(),
      };

      db.query.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });
      db.query.mockResolvedValueOnce({ rows: [{ max_pos: 1024 }] });
      db.query.mockResolvedValueOnce({ rows: [mockCard] });

      const response = await request(app)
        .post('/api/columns/1/cards')
        .send({ title: 'Second Card' });

      expect(response.status).toBe(201);
      expect(response.body.position).toBe(2048);
    });

    it('should return 404 when column not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const response = await request(app)
        .post('/api/columns/999/cards')
        .send({ title: 'Test' });

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

    it('should return 400 when title is empty', async () => {
      const response = await request(app)
        .post('/api/columns/1/cards')
        .send({ title: '' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid column ID', async () => {
      const response = await request(app)
        .post('/api/columns/invalid/cards')
        .send({ title: 'Test' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when description is not a string', async () => {
      const response = await request(app)
        .post('/api/columns/1/cards')
        .send({ title: 'Test', description: 123 });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should trim whitespace from title and description', async () => {
      const mockCard = {
        id: 1,
        title: 'Trimmed',
        description: 'Trimmed desc',
        position: 1024,
        created_at: new Date(),
      };

      db.query.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });
      db.query.mockResolvedValueOnce({ rows: [{ max_pos: 0 }] });
      db.query.mockResolvedValueOnce({ rows: [mockCard] });

      const response = await request(app)
        .post('/api/columns/1/cards')
        .send({ title: '  Trimmed  ', description: '  Trimmed desc  ' });

      expect(response.status).toBe(201);
      expect(db.query).toHaveBeenLastCalledWith(
        expect.any(String),
        [1, 'Trimmed', 'Trimmed desc', 1024]
      );
    });
  });

  describe('PUT /api/cards/:id', () => {
    it('should update card title', async () => {
      const existingCard = {
        id: 1,
        column_id: 1,
        title: 'Old Title',
        description: 'Desc',
        position: 1024,
        created_at: new Date(),
        updated_at: new Date(),
      };
      const updatedCard = { id: 1, title: 'New Title', description: 'Desc', updated_at: new Date() };

      db.query.mockResolvedValueOnce({ rows: [existingCard] });
      db.query.mockResolvedValueOnce({ rows: [updatedCard] });

      const response = await request(app)
        .put('/api/cards/1')
        .send({ title: 'New Title' });

      expect(response.status).toBe(200);
      expect(response.body.title).toBe('New Title');
    });

    it('should update card description', async () => {
      const existingCard = {
        id: 1,
        column_id: 1,
        title: 'Title',
        description: 'Old Desc',
        position: 1024,
        created_at: new Date(),
        updated_at: new Date(),
      };
      const updatedCard = { id: 1, title: 'Title', description: 'New Desc', updated_at: new Date() };

      db.query.mockResolvedValueOnce({ rows: [existingCard] });
      db.query.mockResolvedValueOnce({ rows: [updatedCard] });

      const response = await request(app)
        .put('/api/cards/1')
        .send({ description: 'New Desc' });

      expect(response.status).toBe(200);
      expect(response.body.description).toBe('New Desc');
    });

    it('should allow setting description to null', async () => {
      const existingCard = {
        id: 1,
        column_id: 1,
        title: 'Title',
        description: 'Desc',
        position: 1024,
        created_at: new Date(),
        updated_at: new Date(),
      };
      const updatedCard = { id: 1, title: 'Title', description: null, updated_at: new Date() };

      db.query.mockResolvedValueOnce({ rows: [existingCard] });
      db.query.mockResolvedValueOnce({ rows: [updatedCard] });

      const response = await request(app)
        .put('/api/cards/1')
        .send({ description: null });

      expect(response.status).toBe(200);
      expect(response.body.description).toBeNull();
    });

    it('should return 404 when card not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .put('/api/cards/999')
        .send({ title: 'Test' });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 for invalid card ID', async () => {
      const response = await request(app)
        .put('/api/cards/invalid')
        .send({ title: 'Test' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when title is empty string', async () => {
      const response = await request(app)
        .put('/api/cards/1')
        .send({ title: '' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when description is invalid type', async () => {
      const response = await request(app)
        .put('/api/cards/1')
        .send({ description: 123 });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return existing card when no updates provided', async () => {
      const existingCard = {
        id: 1,
        column_id: 1,
        title: 'Title',
        description: 'Desc',
        position: 1024,
        created_at: new Date(),
        updated_at: new Date(),
      };

      // First query: route checks if card exists via Card.findById
      // Second query: Card.update calls findById when no updates provided
      db.query.mockResolvedValueOnce({ rows: [existingCard] });
      db.query.mockResolvedValueOnce({ rows: [existingCard] });

      const response = await request(app)
        .put('/api/cards/1')
        .send({});

      expect(response.status).toBe(200);
    });
  });

  describe('DELETE /api/cards/:id', () => {
    it('should delete card and return 204', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });

      const response = await request(app).delete('/api/cards/1');

      expect(response.status).toBe(204);
      expect(response.body).toEqual({});
    });

    it('should return 404 when card not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

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
    it('should move card to a new column and position', async () => {
      const existingCard = {
        id: 1,
        column_id: 1,
        title: 'Card',
        position: 1024,
        created_at: new Date(),
        updated_at: new Date(),
      };
      const movedCard = { id: 1, column_id: 2, position: 512 };

      // findById check
      db.query.mockResolvedValueOnce({ rows: [existingCard] });
      // columnExists check
      db.query.mockResolvedValueOnce({ rows: [{ id: 2 }], rowCount: 1 });
      // move
      db.query.mockResolvedValueOnce({ rows: [movedCard] });

      const response = await request(app)
        .patch('/api/cards/1/move')
        .send({ columnId: 2, position: 512 });

      expect(response.status).toBe(200);
      expect(response.body.column_id).toBe(2);
      expect(response.body.position).toBe(512);
    });

    it('should move card within same column', async () => {
      const existingCard = {
        id: 1,
        column_id: 1,
        title: 'Card',
        position: 1024,
        created_at: new Date(),
        updated_at: new Date(),
      };
      const movedCard = { id: 1, column_id: 1, position: 2048 };

      db.query.mockResolvedValueOnce({ rows: [existingCard] });
      db.query.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });
      db.query.mockResolvedValueOnce({ rows: [movedCard] });

      const response = await request(app)
        .patch('/api/cards/1/move')
        .send({ columnId: 1, position: 2048 });

      expect(response.status).toBe(200);
      expect(response.body.position).toBe(2048);
    });

    it('should return 404 when card not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .patch('/api/cards/999/move')
        .send({ columnId: 1, position: 1024 });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
      expect(response.body.error.message).toContain('Card');
    });

    it('should return 404 when target column not found', async () => {
      const existingCard = { id: 1, column_id: 1, title: 'Card', position: 1024 };

      db.query.mockResolvedValueOnce({ rows: [existingCard] });
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const response = await request(app)
        .patch('/api/cards/1/move')
        .send({ columnId: 999, position: 1024 });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
      expect(response.body.error.message).toContain('Column');
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

    it('should return 400 for invalid card ID', async () => {
      const response = await request(app)
        .patch('/api/cards/invalid/move')
        .send({ columnId: 1, position: 1024 });

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
