import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Return type for use{{HookName}} hook
 */
interface Use{{HookName}}Return {
  /**
   * The current data value
   */
  data: {{DataType}} | null;

  /**
   * Loading state
   */
  loading: boolean;

  /**
   * Error state
   */
  error: Error | null;

  /**
   * Refetch the data
   */
  refetch: () => void;

  /**
   * Reset to initial state
   */
  reset: () => void;
}

/**
 * Options for use{{HookName}} hook
 */
interface Use{{HookName}}Options {
  /**
   * Whether to fetch immediately on mount
   * @default true
   */
  immediate?: boolean;

  /**
   * Callback when data is successfully fetched
   */
  onSuccess?: (data: {{DataType}}) => void;

  /**
   * Callback when an error occurs
   */
  onError?: (error: Error) => void;
}

// Replace with your actual data type
type {{DataType}} = any;

/**
 * Custom hook for {{hook-description}}
 *
 * @example
 * ```tsx
 * const { data, loading, error, refetch } = use{{HookName}}({
 *   immediate: true,
 *   onSuccess: (data) => console.log('Success:', data)
 * });
 * ```
 *
 * @param options - Configuration options
 * @returns Hook state and methods
 */
export function use{{HookName}}(options: Use{{HookName}}Options = {}): Use{{HookName}}Return {
  const { immediate = true, onSuccess, onError } = options;

  // State
  const [data, setData] = useState<{{DataType}} | null>(null);
  const [loading, setLoading] = useState(immediate);
  const [error, setError] = useState<Error | null>(null);

  // Refs
  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Fetch data function
  const fetchData = useCallback(async () => {
    // Cancel previous request if exists
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller
    abortControllerRef.current = new AbortController();

    setLoading(true);
    setError(null);

    try {
      // TODO: Replace with your actual data fetching logic
      const response = await fetch('/api/{{endpoint}}', {
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      // Only update state if component is still mounted
      if (isMountedRef.current) {
        setData(result);
        onSuccess?.(result);
      }
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }

      const error = err instanceof Error ? err : new Error('Unknown error');

      if (isMountedRef.current) {
        setError(error);
        onError?.(error);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [onSuccess, onError]);

  // Refetch function
  const refetch = useCallback(() => {
    fetchData();
  }, [fetchData]);

  // Reset function
  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  // Effect: Fetch on mount if immediate
  useEffect(() => {
    if (immediate) {
      fetchData();
    }

    // Cleanup
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
    };
  }, [immediate, fetchData]);

  return {
    data,
    loading,
    error,
    refetch,
    reset
  };
}
