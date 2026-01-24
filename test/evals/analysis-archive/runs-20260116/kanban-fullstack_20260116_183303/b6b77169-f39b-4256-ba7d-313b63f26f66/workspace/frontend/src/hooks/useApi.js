import { useState, useCallback } from 'react';

/**
 * Get API base URL from environment
 * Works in both Vite and Jest environments
 */
function getApiBase() {
  // Check for test environment first
  if (typeof process !== 'undefined' && process.env?.JEST_WORKER_ID) {
    return '/api';
  }
  // Check for Vite environment
  if (typeof window !== 'undefined' && window.__VITE_API_URL__) {
    return window.__VITE_API_URL__;
  }
  // Default
  return '/api';
}

const API_BASE = getApiBase();

/**
 * Custom error class for API errors with structured information
 */
export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Parse API response and handle errors consistently
 * @param {Response} response - Fetch response object
 * @returns {Promise<any>} Parsed response data
 * @throws {ApiError} When response is not ok
 */
async function parseResponse(response) {
  // Handle 204 No Content responses
  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get('content-type');

  // Handle CSV export responses
  if (contentType && contentType.includes('text/csv')) {
    return response.blob();
  }

  let data;
  try {
    data = await response.json();
  } catch {
    // If JSON parsing fails and response is ok, return null
    if (response.ok) {
      return null;
    }
    throw new ApiError('Invalid response format', response.status, 'PARSE_ERROR');
  }

  if (!response.ok) {
    const errorMessage = data?.error?.message || data?.message || 'Request failed';
    const errorCode = data?.error?.code || 'UNKNOWN_ERROR';
    throw new ApiError(errorMessage, response.status, errorCode);
  }

  return data;
}

/**
 * Make an API request with consistent error handling
 * @param {string} endpoint - API endpoint (relative to base URL)
 * @param {Object} options - Fetch options
 * @returns {Promise<any>} Response data
 */
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;

  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  };

  // Only stringify body if it's an object (not a Blob or FormData)
  if (config.body && typeof config.body === 'object' && !(config.body instanceof Blob) && !(config.body instanceof FormData)) {
    config.body = JSON.stringify(config.body);
  }

  const response = await fetch(url, config);
  return parseResponse(response);
}

/**
 * Hook for making API requests with loading and error states
 *
 * @example
 * const { get, post, put, patch, del, loading, error } = useApi();
 *
 * // Fetch boards
 * const boards = await get('/boards');
 *
 * // Create a new board
 * const newBoard = await post('/boards', { name: 'My Board' });
 *
 * @returns {Object} API methods and state
 */
export function useApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Execute an API request with loading state management
   * @param {Function} requestFn - Function that returns a promise
   * @returns {Promise<any>} Request result
   */
  const executeRequest = useCallback(async (requestFn) => {
    setLoading(true);
    setError(null);

    try {
      const result = await requestFn();
      return result;
    } catch (err) {
      const apiError = err instanceof ApiError
        ? err
        : new ApiError(err.message || 'Network error', 0, 'NETWORK_ERROR');
      setError(apiError);
      throw apiError;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Make a GET request
   * @param {string} endpoint - API endpoint
   * @returns {Promise<any>} Response data
   */
  const get = useCallback((endpoint) => {
    return executeRequest(() => apiRequest(endpoint, { method: 'GET' }));
  }, [executeRequest]);

  /**
   * Make a POST request
   * @param {string} endpoint - API endpoint
   * @param {Object} body - Request body
   * @returns {Promise<any>} Response data
   */
  const post = useCallback((endpoint, body) => {
    return executeRequest(() => apiRequest(endpoint, { method: 'POST', body }));
  }, [executeRequest]);

  /**
   * Make a PUT request
   * @param {string} endpoint - API endpoint
   * @param {Object} body - Request body
   * @returns {Promise<any>} Response data
   */
  const put = useCallback((endpoint, body) => {
    return executeRequest(() => apiRequest(endpoint, { method: 'PUT', body }));
  }, [executeRequest]);

  /**
   * Make a PATCH request
   * @param {string} endpoint - API endpoint
   * @param {Object} body - Request body
   * @returns {Promise<any>} Response data
   */
  const patch = useCallback((endpoint, body) => {
    return executeRequest(() => apiRequest(endpoint, { method: 'PATCH', body }));
  }, [executeRequest]);

  /**
   * Make a DELETE request
   * @param {string} endpoint - API endpoint
   * @returns {Promise<any>} Response data
   */
  const del = useCallback((endpoint) => {
    return executeRequest(() => apiRequest(endpoint, { method: 'DELETE' }));
  }, [executeRequest]);

  /**
   * Clear the current error state
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    get,
    post,
    put,
    patch,
    del,
    loading,
    error,
    clearError,
  };
}

/**
 * Direct API functions for use outside of React components
 * (e.g., in action handlers that don't need loading states)
 */
export const api = {
  get: (endpoint) => apiRequest(endpoint, { method: 'GET' }),
  post: (endpoint, body) => apiRequest(endpoint, { method: 'POST', body }),
  put: (endpoint, body) => apiRequest(endpoint, { method: 'PUT', body }),
  patch: (endpoint, body) => apiRequest(endpoint, { method: 'PATCH', body }),
  del: (endpoint) => apiRequest(endpoint, { method: 'DELETE' }),
};

export default useApi;
