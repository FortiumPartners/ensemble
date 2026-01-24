import { renderHook, act, waitFor } from '@testing-library/react';
import { useApi } from '../src/hooks/useApi';
import { useDragDrop } from '../src/hooks/useDragDrop';

// Mock fetch for useApi tests
const mockFetch = (response, ok = true, status = 200) => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok,
      status,
      json: () => Promise.resolve(response),
    })
  );
};

describe('useApi hook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should perform GET request', async () => {
    const mockData = [{ id: 1, name: 'Board 1' }];
    mockFetch(mockData);

    const { result } = renderHook(() => useApi());

    let data;
    await act(async () => {
      data = await result.current.get('/boards');
    });

    expect(data).toEqual(mockData);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/boards'),
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('should perform POST request with body', async () => {
    const mockResponse = { id: 1, name: 'New Board' };
    mockFetch(mockResponse);

    const { result } = renderHook(() => useApi());

    await act(async () => {
      await result.current.post('/boards', { name: 'New Board' });
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/boards'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'New Board' }),
      })
    );
  });

  it('should perform PUT request', async () => {
    mockFetch({ id: 1, name: 'Updated' });

    const { result } = renderHook(() => useApi());

    await act(async () => {
      await result.current.put('/boards/1', { name: 'Updated' });
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/boards/1'),
      expect.objectContaining({ method: 'PUT' })
    );
  });

  it('should perform PATCH request', async () => {
    mockFetch({ id: 1, position: 2048 });

    const { result } = renderHook(() => useApi());

    await act(async () => {
      await result.current.patch('/cards/1/move', { columnId: 2, position: 2048 });
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/cards/1/move'),
      expect.objectContaining({ method: 'PATCH' })
    );
  });

  it('should perform DELETE request', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 204,
      })
    );

    const { result } = renderHook(() => useApi());

    await act(async () => {
      await result.current.del('/boards/1');
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/boards/1'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('should set error on failed request', async () => {
    mockFetch({ error: { message: 'Not found' } }, false, 404);

    const { result } = renderHook(() => useApi());

    await act(async () => {
      try {
        await result.current.get('/boards/999');
      } catch (e) {
        // Expected to throw
      }
    });

    expect(result.current.error).toBe('Not found');
  });

  it('should set loading state', async () => {
    let resolvePromise;
    global.fetch = jest.fn(
      () =>
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
    );

    const { result } = renderHook(() => useApi());

    act(() => {
      result.current.get('/boards');
    });

    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolvePromise({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      });
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });
});

describe('useDragDrop hook', () => {
  const mockOnDrop = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useDragDrop({ onDrop: mockOnDrop }));

    expect(result.current.isDragging).toBe(false);
    expect(result.current.draggedItem).toBe(null);
    expect(result.current.dragOverColumn).toBe(null);
  });

  it('should handle drag start', () => {
    const { result } = renderHook(() => useDragDrop({ onDrop: mockOnDrop }));

    const mockEvent = {
      dataTransfer: {
        effectAllowed: null,
        setData: jest.fn(),
      },
    };

    const mockCard = { id: 1, title: 'Test' };

    act(() => {
      result.current.handlers.onDragStart(mockEvent, mockCard, 1);
    });

    expect(result.current.isDragging).toBe(true);
    expect(result.current.draggedItem).toEqual({
      card: mockCard,
      sourceColumnId: 1,
    });
  });

  it('should handle drag end', () => {
    const { result } = renderHook(() => useDragDrop({ onDrop: mockOnDrop }));

    // Start drag first
    act(() => {
      result.current.handlers.onDragStart(
        {
          dataTransfer: { effectAllowed: null, setData: jest.fn() },
        },
        { id: 1 },
        1
      );
    });

    expect(result.current.isDragging).toBe(true);

    // End drag
    act(() => {
      result.current.handlers.onDragEnd();
    });

    expect(result.current.isDragging).toBe(false);
    expect(result.current.draggedItem).toBe(null);
  });

  it('should handle drag over', () => {
    const { result } = renderHook(() => useDragDrop({ onDrop: mockOnDrop }));

    const mockEvent = {
      preventDefault: jest.fn(),
      dataTransfer: { dropEffect: null },
    };

    act(() => {
      result.current.handlers.onDragOver(mockEvent, 2);
    });

    expect(mockEvent.preventDefault).toHaveBeenCalled();
    expect(result.current.dragOverColumn).toBe(2);
  });

  it('should handle drop', () => {
    const { result } = renderHook(() => useDragDrop({ onDrop: mockOnDrop }));

    const mockCard = { id: 1, title: 'Test' };

    // Start drag
    act(() => {
      result.current.handlers.onDragStart(
        {
          dataTransfer: { effectAllowed: null, setData: jest.fn() },
        },
        mockCard,
        1
      );
    });

    // Drop
    act(() => {
      result.current.handlers.onDrop({ preventDefault: jest.fn() }, 2, 2048);
    });

    expect(mockOnDrop).toHaveBeenCalledWith(1, 2, 2048);
    expect(result.current.isDragging).toBe(false);
  });

  it('should handle drag leave', () => {
    const { result } = renderHook(() => useDragDrop({ onDrop: mockOnDrop }));

    // Set drag over first
    act(() => {
      result.current.handlers.onDragOver(
        { preventDefault: jest.fn(), dataTransfer: {} },
        2
      );
    });

    expect(result.current.dragOverColumn).toBe(2);

    // Leave (not leaving entirely)
    act(() => {
      result.current.handlers.onDragLeave({
        currentTarget: { contains: () => true },
        relatedTarget: {},
      });
    });

    // Should still be set because we're not leaving entirely
    expect(result.current.dragOverColumn).toBe(2);

    // Leave entirely
    act(() => {
      result.current.handlers.onDragLeave({
        currentTarget: { contains: () => false },
        relatedTarget: {},
      });
    });

    expect(result.current.dragOverColumn).toBe(null);
  });
});
