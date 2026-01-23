import { renderHook, act, waitFor } from '@testing-library/react';
import { useBoard, calculatePosition } from '../src/hooks/useBoard';

// Mock the api
jest.mock('../src/hooks/useApi', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    del: jest.fn(),
  },
}));

import { api } from '../src/hooks/useApi';

describe('useBoard', () => {
  const mockBoard = {
    id: 1,
    name: 'Test Board',
    columns: [
      {
        id: 1,
        name: 'To Do',
        position: 1024,
        cards: [
          { id: 1, title: 'Card 1', position: 1024 },
          { id: 2, title: 'Card 2', position: 2048 },
        ],
      },
      {
        id: 2,
        name: 'Done',
        position: 2048,
        cards: [],
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    api.get.mockResolvedValue(mockBoard);
  });

  it('fetches board on mount', async () => {
    renderHook(() => useBoard(1));

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/boards/1');
    });
  });

  it('returns loading state initially', () => {
    api.get.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useBoard(1));

    expect(result.current.loading).toBe(true);
  });

  it('returns board after loading', async () => {
    const { result } = renderHook(() => useBoard(1));

    await waitFor(() => {
      expect(result.current.board).toEqual(mockBoard);
    });
  });

  it('returns error when fetch fails', async () => {
    const error = new Error('Failed to fetch');
    api.get.mockRejectedValue(error);

    const { result } = renderHook(() => useBoard(1));

    await waitFor(() => {
      expect(result.current.error).toEqual(error);
    });
  });

  describe('actions', () => {
    it('creates a column', async () => {
      const newColumn = { id: 3, name: 'New Column', position: 3072 };
      api.post.mockResolvedValue(newColumn);

      const { result } = renderHook(() => useBoard(1));

      await waitFor(() => {
        expect(result.current.board).not.toBeNull();
      });

      await act(async () => {
        await result.current.actions.createColumn('New Column');
      });

      expect(api.post).toHaveBeenCalledWith('/boards/1/columns', { name: 'New Column' });
    });

    it('updates a column', async () => {
      api.put.mockResolvedValue({ id: 1, name: 'Updated Column' });

      const { result } = renderHook(() => useBoard(1));

      await waitFor(() => {
        expect(result.current.board).not.toBeNull();
      });

      await act(async () => {
        await result.current.actions.updateColumn(1, { name: 'Updated Column' });
      });

      expect(api.put).toHaveBeenCalledWith('/columns/1', { name: 'Updated Column' });
    });

    it('deletes a column', async () => {
      api.del.mockResolvedValue(null);

      const { result } = renderHook(() => useBoard(1));

      await waitFor(() => {
        expect(result.current.board).not.toBeNull();
      });

      await act(async () => {
        await result.current.actions.deleteColumn(1);
      });

      expect(api.del).toHaveBeenCalledWith('/columns/1');
    });

    it('creates a card', async () => {
      const newCard = { id: 3, title: 'New Card', position: 3072 };
      api.post.mockResolvedValue(newCard);

      const { result } = renderHook(() => useBoard(1));

      await waitFor(() => {
        expect(result.current.board).not.toBeNull();
      });

      await act(async () => {
        await result.current.actions.createCard(1, 'New Card', 'Description');
      });

      expect(api.post).toHaveBeenCalledWith('/columns/1/cards', {
        title: 'New Card',
        description: 'Description',
      });
    });

    it('updates a card', async () => {
      api.put.mockResolvedValue({ id: 1, title: 'Updated Card' });

      const { result } = renderHook(() => useBoard(1));

      await waitFor(() => {
        expect(result.current.board).not.toBeNull();
      });

      await act(async () => {
        await result.current.actions.updateCard(1, { title: 'Updated Card' });
      });

      expect(api.put).toHaveBeenCalledWith('/cards/1', { title: 'Updated Card' });
    });

    it('deletes a card', async () => {
      api.del.mockResolvedValue(null);

      const { result } = renderHook(() => useBoard(1));

      await waitFor(() => {
        expect(result.current.board).not.toBeNull();
      });

      await act(async () => {
        await result.current.actions.deleteCard(1);
      });

      expect(api.del).toHaveBeenCalledWith('/cards/1');
    });

    it('moves a card to a different column', async () => {
      api.patch.mockResolvedValue({ id: 1, column_id: 2, position: 1024 });

      const { result } = renderHook(() => useBoard(1));

      await waitFor(() => {
        expect(result.current.board).not.toBeNull();
      });

      await act(async () => {
        await result.current.actions.moveCard(1, 1, 2, 0);
      });

      expect(api.patch).toHaveBeenCalledWith('/cards/1/move', {
        columnId: 2,
        position: expect.any(Number),
      });
    });
  });
});

describe('calculatePosition', () => {
  it('returns 1024 for empty array', () => {
    expect(calculatePosition([], 0)).toBe(1024);
  });

  it('returns half of first position for insert at beginning', () => {
    const items = [{ position: 1024 }];
    expect(calculatePosition(items, 0)).toBe(512);
  });

  it('returns last position + 1024 for insert at end', () => {
    const items = [{ position: 1024 }, { position: 2048 }];
    expect(calculatePosition(items, 2)).toBe(3072);
  });

  it('returns midpoint for insert between items', () => {
    const items = [{ position: 1024 }, { position: 2048 }];
    expect(calculatePosition(items, 1)).toBe(1536);
  });

  it('handles unsorted items', () => {
    const items = [{ position: 2048 }, { position: 1024 }];
    expect(calculatePosition(items, 1)).toBe(1536);
  });
});
