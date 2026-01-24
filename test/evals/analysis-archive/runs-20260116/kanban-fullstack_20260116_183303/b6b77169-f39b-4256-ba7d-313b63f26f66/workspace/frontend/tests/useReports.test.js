import { renderHook, act, waitFor } from '@testing-library/react';
import { useReports } from '../src/hooks/useReports';

// Mock the api
jest.mock('../src/hooks/useApi', () => ({
  api: {
    get: jest.fn(),
  },
}));

import { api } from '../src/hooks/useApi';

describe('useReports', () => {
  const mockTasks = [
    {
      id: 1,
      title: 'Task 1',
      board_name: 'Board 1',
      column_name: 'To Do',
      created_at: '2024-01-15T10:00:00Z',
      updated_at: '2024-01-15T10:00:00Z',
    },
    {
      id: 2,
      title: 'Task 2',
      board_name: 'Board 1',
      column_name: 'Done',
      created_at: '2024-01-16T10:00:00Z',
      updated_at: '2024-01-17T10:00:00Z',
    },
    {
      id: 3,
      title: 'Task 3',
      board_name: 'Board 2',
      column_name: 'In Progress',
      created_at: '2024-01-17T10:00:00Z',
      updated_at: '2024-01-17T10:00:00Z',
    },
  ];

  const mockMetrics = {
    total_cards: 3,
    by_status: {
      'To Do': 1,
      'In Progress': 1,
      Done: 1,
    },
    by_board: {
      'Board 1': 2,
      'Board 2': 1,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    api.get.mockImplementation((endpoint) => {
      if (endpoint.includes('/reports/tasks')) {
        return Promise.resolve(mockTasks);
      }
      if (endpoint.includes('/reports/metrics')) {
        return Promise.resolve(mockMetrics);
      }
      return Promise.reject(new Error('Unknown endpoint'));
    });
  });

  it('fetches tasks and metrics on mount', async () => {
    renderHook(() => useReports());

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/reports/tasks');
      expect(api.get).toHaveBeenCalledWith('/reports/metrics');
    });
  });

  it('returns loading state initially', () => {
    api.get.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useReports());

    expect(result.current.loading).toBe(true);
  });

  it('returns tasks after loading', async () => {
    const { result } = renderHook(() => useReports());

    await waitFor(() => {
      expect(result.current.tasks).toEqual(mockTasks);
    });
  });

  it('returns metrics after loading', async () => {
    const { result } = renderHook(() => useReports());

    await waitFor(() => {
      expect(result.current.metrics).toEqual(mockMetrics);
    });
  });

  it('returns error when fetch fails', async () => {
    const error = new Error('Failed to fetch');
    api.get.mockRejectedValue(error);

    const { result } = renderHook(() => useReports());

    await waitFor(() => {
      expect(result.current.error).toEqual(error);
    });
  });

  it('applies boardId filter', async () => {
    renderHook(() => useReports({ boardId: 1 }));

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/reports/tasks?boardId=1');
      expect(api.get).toHaveBeenCalledWith('/reports/metrics?boardId=1');
    });
  });

  it('applies status filter', async () => {
    renderHook(() => useReports({ status: 'Done' }));

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/reports/tasks?status=Done');
    });
  });

  it('applies both filters', async () => {
    renderHook(() => useReports({ boardId: 1, status: 'Done' }));

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/reports/tasks?boardId=1&status=Done');
    });
  });

  describe('refetch', () => {
    it('refetches data', async () => {
      const { result } = renderHook(() => useReports());

      await waitFor(() => {
        expect(result.current.tasks).toEqual(mockTasks);
      });

      jest.clearAllMocks();

      await act(async () => {
        await result.current.refetch();
      });

      expect(api.get).toHaveBeenCalledWith('/reports/tasks');
      expect(api.get).toHaveBeenCalledWith('/reports/metrics');
    });
  });

  describe('getTasksByStatus', () => {
    it('groups tasks by status', async () => {
      const { result } = renderHook(() => useReports());

      await waitFor(() => {
        expect(result.current.tasks).toEqual(mockTasks);
      });

      const grouped = result.current.getTasksByStatus();

      expect(grouped['To Do']).toHaveLength(1);
      expect(grouped['In Progress']).toHaveLength(1);
      expect(grouped.Done).toHaveLength(1);
    });
  });

  describe('getTasksByBoard', () => {
    it('groups tasks by board', async () => {
      const { result } = renderHook(() => useReports());

      await waitFor(() => {
        expect(result.current.tasks).toEqual(mockTasks);
      });

      const grouped = result.current.getTasksByBoard();

      expect(grouped['Board 1']).toHaveLength(2);
      expect(grouped['Board 2']).toHaveLength(1);
    });
  });

  describe('exportCSV', () => {
    it('triggers CSV download', async () => {
      // Mock Blob and URL.createObjectURL
      const mockBlob = new Blob(['csv,data']);
      api.get.mockImplementation((endpoint) => {
        if (endpoint.includes('/reports/export')) {
          return Promise.resolve(mockBlob);
        }
        if (endpoint.includes('/reports/tasks')) {
          return Promise.resolve(mockTasks);
        }
        if (endpoint.includes('/reports/metrics')) {
          return Promise.resolve(mockMetrics);
        }
        return Promise.reject(new Error('Unknown endpoint'));
      });

      global.URL.createObjectURL = jest.fn(() => 'blob:url');
      global.URL.revokeObjectURL = jest.fn();

      // Save original methods
      const originalCreateElement = document.createElement.bind(document);
      const originalAppendChild = document.body.appendChild.bind(document.body);
      const originalRemoveChild = document.body.removeChild.bind(document.body);

      // Mock document methods for link creation
      const mockLink = {
        href: '',
        download: '',
        click: jest.fn(),
      };
      document.createElement = jest.fn((tag) => {
        if (tag === 'a') return mockLink;
        return originalCreateElement(tag);
      });
      document.body.appendChild = jest.fn((el) => {
        if (el === mockLink) return el;
        return originalAppendChild(el);
      });
      document.body.removeChild = jest.fn((el) => {
        if (el === mockLink) return el;
        return originalRemoveChild(el);
      });

      const { result } = renderHook(() => useReports());

      await waitFor(() => {
        expect(result.current.tasks).toEqual(mockTasks);
      });

      await act(async () => {
        await result.current.exportCSV();
      });

      expect(api.get).toHaveBeenCalledWith('/reports/export');
      expect(mockLink.click).toHaveBeenCalled();

      // Restore original methods
      document.createElement = originalCreateElement;
      document.body.appendChild = originalAppendChild;
      document.body.removeChild = originalRemoveChild;
    });
  });
});
