/**
 * Models test suite.
 * Tests database query functions for Board, Column, and Card models.
 */

// Mock the database module before requiring models
jest.mock('../src/db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const db = require('../src/db');
const Board = require('../src/models/Board');
const Column = require('../src/models/Column');
const Card = require('../src/models/Card');

describe('Board Model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return all boards', async () => {
      const mockBoards = [{ id: 1, name: 'Board 1', created_at: new Date() }];
      db.query.mockResolvedValueOnce({ rows: mockBoards });

      const result = await Board.findAll();

      expect(result).toEqual(mockBoards);
      expect(db.query).toHaveBeenCalledWith(
        'SELECT id, name, created_at FROM boards ORDER BY created_at DESC'
      );
    });
  });

  describe('findById', () => {
    it('should return board when found', async () => {
      const mockBoard = { id: 1, name: 'Board 1', created_at: new Date(), updated_at: new Date() };
      db.query.mockResolvedValueOnce({ rows: [mockBoard] });

      const result = await Board.findById(1);

      expect(result).toEqual(mockBoard);
    });

    it('should return null when not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await Board.findById(999);

      expect(result).toBeNull();
    });
  });

  describe('findByIdWithColumnsAndCards', () => {
    it('should return board with columns and cards', async () => {
      const mockBoard = { id: 1, name: 'Board', created_at: new Date(), updated_at: new Date() };
      const mockColumns = [
        { id: 1, name: 'Col 1', position: 1024, created_at: new Date() },
        { id: 2, name: 'Col 2', position: 2048, created_at: new Date() },
      ];
      const mockCards = [
        { id: 1, column_id: 1, title: 'Card', description: null, position: 1024, created_at: new Date(), updated_at: new Date() },
      ];

      db.query
        .mockResolvedValueOnce({ rows: [mockBoard] })
        .mockResolvedValueOnce({ rows: mockColumns })
        .mockResolvedValueOnce({ rows: mockCards });

      const result = await Board.findByIdWithColumnsAndCards(1);

      expect(result.name).toBe('Board');
      expect(result.columns).toHaveLength(2);
      expect(result.columns[0].cards).toHaveLength(1);
      expect(result.columns[1].cards).toHaveLength(0);
    });

    it('should return null when board not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await Board.findByIdWithColumnsAndCards(999);

      expect(result).toBeNull();
    });

    it('should handle board with no columns', async () => {
      const mockBoard = { id: 1, name: 'Board', created_at: new Date(), updated_at: new Date() };

      db.query
        .mockResolvedValueOnce({ rows: [mockBoard] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await Board.findByIdWithColumnsAndCards(1);

      expect(result.columns).toHaveLength(0);
    });
  });

  describe('create', () => {
    it('should create and return new board', async () => {
      const mockBoard = { id: 1, name: 'New Board', created_at: new Date() };
      db.query.mockResolvedValueOnce({ rows: [mockBoard] });

      const result = await Board.create('New Board');

      expect(result).toEqual(mockBoard);
      expect(db.query).toHaveBeenCalledWith(
        'INSERT INTO boards (name) VALUES ($1) RETURNING id, name, created_at',
        ['New Board']
      );
    });
  });

  describe('update', () => {
    it('should update and return board', async () => {
      const mockBoard = { id: 1, name: 'Updated', updated_at: new Date() };
      db.query.mockResolvedValueOnce({ rows: [mockBoard] });

      const result = await Board.update(1, 'Updated');

      expect(result).toEqual(mockBoard);
    });

    it('should return null when board not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await Board.update(999, 'Test');

      expect(result).toBeNull();
    });
  });

  describe('remove', () => {
    it('should return true when board deleted', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });

      const result = await Board.remove(1);

      expect(result).toBe(true);
    });

    it('should return false when board not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await Board.remove(999);

      expect(result).toBe(false);
    });
  });
});

describe('Column Model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findByBoardId', () => {
    it('should return columns for board', async () => {
      const mockColumns = [{ id: 1, name: 'Col', position: 1024, created_at: new Date() }];
      db.query.mockResolvedValueOnce({ rows: mockColumns });

      const result = await Column.findByBoardId(1);

      expect(result).toEqual(mockColumns);
    });
  });

  describe('findById', () => {
    it('should return column when found', async () => {
      const mockColumn = { id: 1, board_id: 1, name: 'Col', position: 1024, created_at: new Date() };
      db.query.mockResolvedValueOnce({ rows: [mockColumn] });

      const result = await Column.findById(1);

      expect(result).toEqual(mockColumn);
    });

    it('should return null when not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await Column.findById(999);

      expect(result).toBeNull();
    });
  });

  describe('getMaxPosition', () => {
    it('should return max position', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ max_pos: 2048 }] });

      const result = await Column.getMaxPosition(1);

      expect(result).toBe(2048);
    });

    it('should return 0 when no columns', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ max_pos: 0 }] });

      const result = await Column.getMaxPosition(1);

      expect(result).toBe(0);
    });
  });

  describe('create', () => {
    it('should create column at end of board', async () => {
      const mockColumn = { id: 1, name: 'New Col', position: 2048, created_at: new Date() };

      db.query
        .mockResolvedValueOnce({ rows: [{ max_pos: 1024 }] })
        .mockResolvedValueOnce({ rows: [mockColumn] });

      const result = await Column.create(1, 'New Col');

      expect(result.position).toBe(2048);
    });
  });

  describe('update', () => {
    it('should update column name', async () => {
      const mockColumn = { id: 1, name: 'Updated', position: 1024 };
      db.query.mockResolvedValueOnce({ rows: [mockColumn] });

      const result = await Column.update(1, { name: 'Updated' });

      expect(result.name).toBe('Updated');
    });

    it('should update column position', async () => {
      const mockColumn = { id: 1, name: 'Col', position: 512 };
      db.query.mockResolvedValueOnce({ rows: [mockColumn] });

      const result = await Column.update(1, { position: 512 });

      expect(result.position).toBe(512);
    });

    it('should return existing column when no updates', async () => {
      const mockColumn = { id: 1, board_id: 1, name: 'Col', position: 1024, created_at: new Date() };
      db.query.mockResolvedValueOnce({ rows: [mockColumn] });

      const result = await Column.update(1, {});

      expect(result).toEqual(mockColumn);
    });

    it('should return null when column not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await Column.update(999, { name: 'Test' });

      expect(result).toBeNull();
    });
  });

  describe('remove', () => {
    it('should return true when deleted', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });

      const result = await Column.remove(1);

      expect(result).toBe(true);
    });

    it('should return false when not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await Column.remove(999);

      expect(result).toBe(false);
    });
  });

  describe('rebalancePositions', () => {
    it('should rebalance all column positions', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] }) // SELECT
          .mockResolvedValueOnce({}) // UPDATE 1
          .mockResolvedValueOnce({}) // UPDATE 2
          .mockResolvedValueOnce({}), // COMMIT
        release: jest.fn(),
      };
      db.getClient.mockResolvedValueOnce(mockClient);

      await Column.rebalancePositions(1);

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should rollback on error', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockRejectedValueOnce(new Error('DB error')), // SELECT fails
        release: jest.fn(),
      };
      db.getClient.mockResolvedValueOnce(mockClient);

      await expect(Column.rebalancePositions(1)).rejects.toThrow('DB error');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('boardExists', () => {
    it('should return true when board exists', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });

      const result = await Column.boardExists(1);

      expect(result).toBe(true);
    });

    it('should return false when board does not exist', async () => {
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await Column.boardExists(999);

      expect(result).toBe(false);
    });
  });
});

describe('Card Model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findByColumnId', () => {
    it('should return cards for column', async () => {
      const mockCards = [{ id: 1, column_id: 1, title: 'Card', position: 1024 }];
      db.query.mockResolvedValueOnce({ rows: mockCards });

      const result = await Card.findByColumnId(1);

      expect(result).toEqual(mockCards);
    });
  });

  describe('findById', () => {
    it('should return card when found', async () => {
      const mockCard = { id: 1, column_id: 1, title: 'Card', position: 1024 };
      db.query.mockResolvedValueOnce({ rows: [mockCard] });

      const result = await Card.findById(1);

      expect(result).toEqual(mockCard);
    });

    it('should return null when not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await Card.findById(999);

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create card with title and description', async () => {
      const mockCard = { id: 1, title: 'Card', description: 'Desc', position: 1024, created_at: new Date() };

      db.query
        .mockResolvedValueOnce({ rows: [{ max_pos: 0 }] })
        .mockResolvedValueOnce({ rows: [mockCard] });

      const result = await Card.create(1, 'Card', 'Desc');

      expect(result.title).toBe('Card');
      expect(result.description).toBe('Desc');
    });

    it('should create card with title only', async () => {
      const mockCard = { id: 1, title: 'Card', description: null, position: 1024, created_at: new Date() };

      db.query
        .mockResolvedValueOnce({ rows: [{ max_pos: 0 }] })
        .mockResolvedValueOnce({ rows: [mockCard] });

      const result = await Card.create(1, 'Card');

      expect(result.description).toBeNull();
    });
  });

  describe('update', () => {
    it('should update card title', async () => {
      const mockCard = { id: 1, title: 'Updated', description: 'Desc', updated_at: new Date() };
      db.query.mockResolvedValueOnce({ rows: [mockCard] });

      const result = await Card.update(1, { title: 'Updated' });

      expect(result.title).toBe('Updated');
    });

    it('should update card description', async () => {
      const mockCard = { id: 1, title: 'Card', description: 'New Desc', updated_at: new Date() };
      db.query.mockResolvedValueOnce({ rows: [mockCard] });

      const result = await Card.update(1, { description: 'New Desc' });

      expect(result.description).toBe('New Desc');
    });

    it('should return existing card when no updates', async () => {
      const mockCard = { id: 1, column_id: 1, title: 'Card', description: 'Desc', position: 1024, updated_at: new Date() };
      db.query.mockResolvedValueOnce({ rows: [mockCard] });

      const result = await Card.update(1, {});

      expect(result.id).toBe(1);
    });

    it('should return null when no updates and card not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await Card.update(999, {});

      expect(result).toBeNull();
    });

    it('should return null when card not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await Card.update(999, { title: 'Test' });

      expect(result).toBeNull();
    });
  });

  describe('move', () => {
    it('should move card to new column and position', async () => {
      const mockCard = { id: 1, column_id: 2, position: 512 };
      db.query.mockResolvedValueOnce({ rows: [mockCard] });

      const result = await Card.move(1, 2, 512);

      expect(result.column_id).toBe(2);
      expect(result.position).toBe(512);
    });

    it('should return null when card not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await Card.move(999, 1, 1024);

      expect(result).toBeNull();
    });
  });

  describe('remove', () => {
    it('should return true when deleted', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });

      const result = await Card.remove(1);

      expect(result).toBe(true);
    });

    it('should return false when not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await Card.remove(999);

      expect(result).toBe(false);
    });
  });

  describe('rebalancePositions', () => {
    it('should rebalance all card positions in column', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] }) // SELECT
          .mockResolvedValueOnce({}) // UPDATE 1
          .mockResolvedValueOnce({}) // UPDATE 2
          .mockResolvedValueOnce({}), // COMMIT
        release: jest.fn(),
      };
      db.getClient.mockResolvedValueOnce(mockClient);

      await Card.rebalancePositions(1);

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should rollback on error', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockRejectedValueOnce(new Error('DB error')), // SELECT fails
        release: jest.fn(),
      };
      db.getClient.mockResolvedValueOnce(mockClient);

      await expect(Card.rebalancePositions(1)).rejects.toThrow('DB error');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('columnExists', () => {
    it('should return true when column exists', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });

      const result = await Card.columnExists(1);

      expect(result).toBe(true);
    });

    it('should return false when column does not exist', async () => {
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await Card.columnExists(999);

      expect(result).toBe(false);
    });
  });

  describe('findAllWithDetails', () => {
    it('should return all tasks with details', async () => {
      const mockTasks = [
        { id: 1, title: 'Task', board_name: 'Board', column_name: 'Col' },
      ];
      db.query.mockResolvedValueOnce({ rows: mockTasks });

      const result = await Card.findAllWithDetails();

      expect(result).toEqual(mockTasks);
    });

    it('should filter by boardId', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await Card.findAllWithDetails({ boardId: 1 });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('b.id = $1'),
        [1]
      );
    });

    it('should filter by status', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await Card.findAllWithDetails({ status: 'Done' });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('col.name = $1'),
        ['Done']
      );
    });

    it('should sort by valid column', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await Card.findAllWithDetails({ sortBy: 'title', sortOrder: 'asc' });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY title ASC'),
        []
      );
    });

    it('should default to created_at DESC for invalid sortBy', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await Card.findAllWithDetails({ sortBy: 'invalid' });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        []
      );
    });
  });

  describe('getMetrics', () => {
    it('should return aggregated metrics', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ total: '10' }] })
        .mockResolvedValueOnce({ rows: [{ status: 'Done', count: '5' }] })
        .mockResolvedValueOnce({ rows: [{ board_name: 'Board', count: '10' }] });

      const result = await Card.getMetrics();

      expect(result.total_cards).toBe(10);
      expect(result.by_status['Done']).toBe(5);
      expect(result.by_board['Board']).toBe(10);
    });

    it('should filter by boardId', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ total: '5' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await Card.getMetrics(1);

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE b.id = $1'),
        [1]
      );
    });

    it('should return empty objects when no cards', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await Card.getMetrics();

      expect(result.total_cards).toBe(0);
      expect(result.by_status).toEqual({});
      expect(result.by_board).toEqual({});
    });
  });
});

describe('Model Constants', () => {
  it('should export POSITION_INCREMENT from Board', () => {
    expect(Board.POSITION_INCREMENT).toBe(1024);
  });

  it('should export POSITION_INCREMENT from Column', () => {
    expect(Column.POSITION_INCREMENT).toBe(1024);
  });

  it('should export REBALANCE_THRESHOLD from Column', () => {
    expect(Column.REBALANCE_THRESHOLD).toBe(1);
  });

  it('should export POSITION_INCREMENT from Card', () => {
    expect(Card.POSITION_INCREMENT).toBe(1024);
  });

  it('should export REBALANCE_THRESHOLD from Card', () => {
    expect(Card.REBALANCE_THRESHOLD).toBe(1);
  });
});
