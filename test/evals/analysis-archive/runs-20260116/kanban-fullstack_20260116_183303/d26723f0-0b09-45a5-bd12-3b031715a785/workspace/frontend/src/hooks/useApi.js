import { useState, useCallback } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export function useApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const request = useCallback(async (method, endpoint, body = null) => {
    setLoading(true);
    setError(null);

    try {
      const options = {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
      };

      if (body) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(`${API_URL}${endpoint}`, options);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Request failed with status ${response.status}`);
      }

      if (response.status === 204) {
        return null;
      }

      const data = await response.json();
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const get = useCallback((endpoint) => request('GET', endpoint), [request]);
  const post = useCallback((endpoint, body) => request('POST', endpoint, body), [request]);
  const put = useCallback((endpoint, body) => request('PUT', endpoint, body), [request]);
  const patch = useCallback((endpoint, body) => request('PATCH', endpoint, body), [request]);
  const del = useCallback((endpoint) => request('DELETE', endpoint), [request]);

  return { get, post, put, patch, del, loading, error };
}

export default useApi;
