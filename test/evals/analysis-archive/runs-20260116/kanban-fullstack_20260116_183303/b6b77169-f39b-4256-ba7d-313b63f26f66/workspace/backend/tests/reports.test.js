/**
 * Reports routes test suite.
 * Tests task analytics and export endpoints.
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

describe('Reports Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/reports/tasks', () => {
    it('should return all tasks with board and column info', async () => {
      const mockTasks = [
        {
          id: 1,
          title: 'Task 1',
          description: 'Desc 1',
          position: 1024,
          created_at: new Date(),
          updated_at: new Date(),
          column_name: 'To Do',
          column_id: 1,
          board_name: 'Board 1',
          board_id: 1,
        },
        {
          id: 2,
          title: 'Task 2',
          description: null,
          position: 2048,
          created_at: new Date(),
          updated_at: new Date(),
          column_name: 'Done',
          column_id: 2,
          board_name: 'Board 1',
          board_id: 1,
        },
      ];

      db.query.mockResolvedValueOnce({ rows: mockTasks });

      const response = await request(app).get('/api/reports/tasks');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].board_name).toBe('Board 1');
      expect(response.body[0].column_name).toBe('To Do');
    });

    it('should filter tasks by boardId', async () => {
      const mockTasks = [
        {
          id: 1,
          title: 'Task 1',
          description: null,
          position: 1024,
          created_at: new Date(),
          updated_at: new Date(),
          column_name: 'To Do',
          column_id: 1,
          board_name: 'Board 1',
          board_id: 1,
        },
      ];

      db.query.mockResolvedValueOnce({ rows: mockTasks });

      const response = await request(app).get('/api/reports/tasks?boardId=1');

      expect(response.status).toBe(200);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE'),
        [1]
      );
    });

    it('should filter tasks by status', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app).get('/api/reports/tasks?status=Done');

      expect(response.status).toBe(200);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('col.name = $'),
        ['Done']
      );
    });

    it('should filter tasks by both boardId and status', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app).get('/api/reports/tasks?boardId=1&status=Done');

      expect(response.status).toBe(200);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('AND'),
        [1, 'Done']
      );
    });

    it('should sort tasks by specified field', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app).get('/api/reports/tasks?sortBy=title&sortOrder=asc');

      expect(response.status).toBe(200);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY title ASC'),
        []
      );
    });

    it('should default to created_at DESC for sorting', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app).get('/api/reports/tasks');

      expect(response.status).toBe(200);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        []
      );
    });

    it('should ignore invalid sortBy values', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app).get('/api/reports/tasks?sortBy=invalid');

      expect(response.status).toBe(200);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at'),
        []
      );
    });

    it('should return 400 for invalid boardId', async () => {
      const response = await request(app).get('/api/reports/tasks?boardId=invalid');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return empty array when no tasks exist', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app).get('/api/reports/tasks');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });
  });

  describe('GET /api/reports/metrics', () => {
    it('should return aggregated metrics', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ total: '10' }] })
        .mockResolvedValueOnce({ rows: [
          { status: 'To Do', count: '5' },
          { status: 'Done', count: '5' },
        ]})
        .mockResolvedValueOnce({ rows: [
          { board_name: 'Board 1', count: '7' },
          { board_name: 'Board 2', count: '3' },
        ]});

      const response = await request(app).get('/api/reports/metrics');

      expect(response.status).toBe(200);
      expect(response.body.total_cards).toBe(10);
      expect(response.body.by_status['To Do']).toBe(5);
      expect(response.body.by_status['Done']).toBe(5);
      expect(response.body.by_board['Board 1']).toBe(7);
    });

    it('should filter metrics by boardId', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ total: '5' }] })
        .mockResolvedValueOnce({ rows: [{ status: 'To Do', count: '5' }] })
        .mockResolvedValueOnce({ rows: [{ board_name: 'Board 1', count: '5' }] });

      const response = await request(app).get('/api/reports/metrics?boardId=1');

      expect(response.status).toBe(200);
      expect(response.body.total_cards).toBe(5);
    });

    it('should return 400 for invalid boardId', async () => {
      const response = await request(app).get('/api/reports/metrics?boardId=invalid');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return zero metrics when no cards exist', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const response = await request(app).get('/api/reports/metrics');

      expect(response.status).toBe(200);
      expect(response.body.total_cards).toBe(0);
      expect(response.body.by_status).toEqual({});
      expect(response.body.by_board).toEqual({});
    });
  });

  describe('GET /api/reports/export', () => {
    it('should export tasks as CSV', async () => {
      const mockTasks = [
        {
          id: 1,
          title: 'Task 1',
          description: 'Desc 1',
          board_name: 'Board 1',
          column_name: 'To Do',
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-02'),
        },
      ];

      db.query.mockResolvedValueOnce({ rows: mockTasks });

      const response = await request(app).get('/api/reports/export');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.text).toContain('ID,Title,Description,Board,Status,Created At,Updated At');
      expect(response.text).toContain('Task 1');
    });

    it('should escape CSV fields with commas', async () => {
      const mockTasks = [
        {
          id: 1,
          title: 'Task, with comma',
          description: 'Desc',
          board_name: 'Board',
          column_name: 'To Do',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      db.query.mockResolvedValueOnce({ rows: mockTasks });

      const response = await request(app).get('/api/reports/export');

      expect(response.status).toBe(200);
      expect(response.text).toContain('"Task, with comma"');
    });

    it('should escape CSV fields with quotes', async () => {
      const mockTasks = [
        {
          id: 1,
          title: 'Task "quoted"',
          description: 'Desc',
          board_name: 'Board',
          column_name: 'To Do',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      db.query.mockResolvedValueOnce({ rows: mockTasks });

      const response = await request(app).get('/api/reports/export');

      expect(response.status).toBe(200);
      expect(response.text).toContain('"Task ""quoted"""');
    });

    it('should escape CSV fields with newlines', async () => {
      const mockTasks = [
        {
          id: 1,
          title: 'Task\nwith\nnewlines',
          description: 'Desc',
          board_name: 'Board',
          column_name: 'To Do',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      db.query.mockResolvedValueOnce({ rows: mockTasks });

      const response = await request(app).get('/api/reports/export');

      expect(response.status).toBe(200);
      expect(response.text).toContain('"Task\nwith\nnewlines"');
    });

    it('should handle null description', async () => {
      const mockTasks = [
        {
          id: 1,
          title: 'Task 1',
          description: null,
          board_name: 'Board',
          column_name: 'To Do',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      db.query.mockResolvedValueOnce({ rows: mockTasks });

      const response = await request(app).get('/api/reports/export');

      expect(response.status).toBe(200);
      // Description should be empty string
      expect(response.text).toMatch(/Task 1,,Board/);
    });

    it('should filter export by boardId', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app).get('/api/reports/export?boardId=1');

      expect(response.status).toBe(200);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE'),
        expect.arrayContaining([1])
      );
    });

    it('should filter export by status', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app).get('/api/reports/export?status=Done');

      expect(response.status).toBe(200);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('col.name'),
        expect.arrayContaining(['Done'])
      );
    });

    it('should return 400 for invalid boardId', async () => {
      const response = await request(app).get('/api/reports/export?boardId=invalid');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should export empty CSV with only headers when no tasks', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app).get('/api/reports/export');

      expect(response.status).toBe(200);
      expect(response.text).toBe('ID,Title,Description,Board,Status,Created At,Updated At');
    });
  });
});
