import { renderHook, act } from '@testing-library/react';
import { useApi, api, ApiError } from '../src/hooks/useApi';

// Mock fetch
global.fetch = jest.fn();

describe('useApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('useApi hook', () => {
    it('starts with loading false', () => {
      const { result } = renderHook(() => useApi());

      expect(result.current.loading).toBe(false);
    });

    it('starts with error null', () => {
      const { result } = renderHook(() => useApi());

      expect(result.current.error).toBe(null);
    });

    it('sets loading during request', async () => {
      let resolveRequest;
      global.fetch.mockImplementation(() => new Promise((resolve) => {
        resolveRequest = () => resolve({
          ok: true,
          status: 200,
          headers: new Map([['content-type', 'application/json']]),
          json: () => Promise.resolve({ data: 'test' }),
        });
      }));

      const { result } = renderHook(() => useApi());

      let promise;
      act(() => {
        promise = result.current.get('/test');
      });

      expect(result.current.loading).toBe(true);

      await act(async () => {
        resolveRequest();
        await promise;
      });

      expect(result.current.loading).toBe(false);
    });

    it('handles successful GET request', async () => {
      const mockData = { id: 1, name: 'Test' };
      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        json: () => Promise.resolve(mockData),
      });

      const { result } = renderHook(() => useApi());

      let data;
      await act(async () => {
        data = await result.current.get('/test');
      });

      expect(data).toEqual(mockData);
      expect(result.current.error).toBe(null);
    });

    it('handles API errors', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Map([['content-type', 'application/json']]),
        json: () => Promise.resolve({ error: { message: 'Not found', code: 'NOT_FOUND' } }),
      });

      const { result } = renderHook(() => useApi());

      await act(async () => {
        try {
          await result.current.get('/test');
        } catch {
          // Expected error
        }
      });

      expect(result.current.error).toBeInstanceOf(ApiError);
      expect(result.current.error.message).toBe('Not found');
      expect(result.current.error.status).toBe(404);
    });

    it('handles network errors', async () => {
      global.fetch.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useApi());

      await act(async () => {
        try {
          await result.current.get('/test');
        } catch {
          // Expected error
        }
      });

      expect(result.current.error).toBeInstanceOf(ApiError);
      expect(result.current.error.code).toBe('NETWORK_ERROR');
    });

    it('clears error with clearError', async () => {
      global.fetch.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useApi());

      await act(async () => {
        try {
          await result.current.get('/test');
        } catch {
          // Expected
        }
      });

      expect(result.current.error).not.toBe(null);

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBe(null);
    });

    it('handles 204 No Content', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        status: 204,
        headers: new Map(),
      });

      const { result } = renderHook(() => useApi());

      let data;
      await act(async () => {
        data = await result.current.del('/test');
      });

      expect(data).toBe(null);
    });
  });

  describe('api object', () => {
    it('makes GET requests', async () => {
      const mockData = { id: 1 };
      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        json: () => Promise.resolve(mockData),
      });

      const data = await api.get('/test');

      expect(fetch).toHaveBeenCalledWith(
        '/api/test',
        expect.objectContaining({ method: 'GET' })
      );
      expect(data).toEqual(mockData);
    });

    it('makes POST requests with body', async () => {
      const mockData = { id: 1 };
      global.fetch.mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Map([['content-type', 'application/json']]),
        json: () => Promise.resolve(mockData),
      });

      await api.post('/test', { name: 'Test' });

      expect(fetch).toHaveBeenCalledWith(
        '/api/test',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'Test' }),
        })
      );
    });

    it('makes PUT requests', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        json: () => Promise.resolve({ id: 1 }),
      });

      await api.put('/test/1', { name: 'Updated' });

      expect(fetch).toHaveBeenCalledWith(
        '/api/test/1',
        expect.objectContaining({ method: 'PUT' })
      );
    });

    it('makes PATCH requests', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        json: () => Promise.resolve({ id: 1 }),
      });

      await api.patch('/test/1', { name: 'Patched' });

      expect(fetch).toHaveBeenCalledWith(
        '/api/test/1',
        expect.objectContaining({ method: 'PATCH' })
      );
    });

    it('makes DELETE requests', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        status: 204,
        headers: new Map(),
      });

      await api.del('/test/1');

      expect(fetch).toHaveBeenCalledWith(
        '/api/test/1',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });
});
