const request = require('supertest');
const app = require('../src/index');
const db = require('../src/db');

jest.mock('../src/db', () => ({
  query: jest.fn(),
}));

describe('Reports API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/reports/tasks', () => {
    it('should return all tasks with board/column info', async () => {
      const mockTasks = [
        {
          id: 1,
          title: 'Task 1',
          description: 'Desc 1',
          board_id: 1,
          board_name: 'Board 1',
          column_id: 1,
          column_name: 'To Do',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];
      db.query.mockResolvedValueOnce({ rows: mockTasks });

      const response = await request(app).get('/api/reports/tasks');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockTasks);
    });

    it('should filter by boardId', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await request(app).get('/api/reports/tasks?boardId=1');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('boards.id = $1'),
        [1]
      );
    });

    it('should filter by status', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await request(app).get('/api/reports/tasks?status=Done');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('columns.name = $1'),
        ['Done']
      );
    });

    it('should filter by both boardId and status', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await request(app).get('/api/reports/tasks?boardId=1&status=Done');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('boards.id = $1'),
        expect.arrayContaining([1, 'Done'])
      );
    });

    it('should sort by specified column', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await request(app).get('/api/reports/tasks?sortBy=title&sortOrder=asc');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY title ASC'),
        []
      );
    });

    it('should return 400 for invalid sortBy', async () => {
      const response = await request(app).get('/api/reports/tasks?sortBy=invalid');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid sortOrder', async () => {
      const response = await request(app).get('/api/reports/tasks?sortOrder=invalid');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid boardId', async () => {
      const response = await request(app).get('/api/reports/tasks?boardId=invalid');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/reports/metrics', () => {
    it('should return aggregated metrics', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ total: '10' }] })
        .mockResolvedValueOnce({
          rows: [
            { status: 'To Do', count: '5' },
            { status: 'Done', count: '5' },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { id: 1, name: 'Board 1', count: '7' },
            { id: 2, name: 'Board 2', count: '3' },
          ],
        });

      const response = await request(app).get('/api/reports/metrics');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        total_cards: 10,
        by_status: { 'To Do': 5, Done: 5 },
        by_board: { 'Board 1': 7, 'Board 2': 3 },
      });
    });

    it('should filter by boardId', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ total: '5' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app).get('/api/reports/metrics?boardId=1');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE boards.id = $1'),
        [1]
      );
    });

    it('should return 400 for invalid boardId', async () => {
      const response = await request(app).get('/api/reports/metrics?boardId=invalid');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return empty metrics when no data', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const response = await request(app).get('/api/reports/metrics');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        total_cards: 0,
        by_status: {},
        by_board: {},
      });
    });
  });

  describe('GET /api/reports/export', () => {
    it('should return CSV file', async () => {
      const mockData = [
        {
          id: 1,
          title: 'Task 1',
          description: 'Description',
          board_name: 'Board 1',
          column_name: 'To Do',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];
      db.query.mockResolvedValueOnce({ rows: mockData });

      const response = await request(app).get('/api/reports/export');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toBe('attachment; filename="tasks.csv"');
      expect(response.text).toContain('ID,Title,Description,Board,Status,Created At,Updated At');
      expect(response.text).toContain('1,Task 1,Description,Board 1,To Do');
    });

    it('should escape CSV special characters', async () => {
      const mockData = [
        {
          id: 1,
          title: 'Task with, comma',
          description: 'Description with "quotes"',
          board_name: 'Board 1',
          column_name: 'To Do',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];
      db.query.mockResolvedValueOnce({ rows: mockData });

      const response = await request(app).get('/api/reports/export');

      expect(response.status).toBe(200);
      expect(response.text).toContain('"Task with, comma"');
      expect(response.text).toContain('"Description with ""quotes"""');
    });

    it('should filter by boardId', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await request(app).get('/api/reports/export?boardId=1');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('boards.id = $1'),
        [1]
      );
    });

    it('should filter by status', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await request(app).get('/api/reports/export?status=Done');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('columns.name = $1'),
        ['Done']
      );
    });

    it('should return 400 for invalid boardId', async () => {
      const response = await request(app).get('/api/reports/export?boardId=invalid');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle null description', async () => {
      const mockData = [
        {
          id: 1,
          title: 'Task',
          description: null,
          board_name: 'Board',
          column_name: 'To Do',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];
      db.query.mockResolvedValueOnce({ rows: mockData });

      const response = await request(app).get('/api/reports/export');

      expect(response.status).toBe(200);
      expect(response.text).toContain('1,Task,,Board,To Do');
    });
  });
});
