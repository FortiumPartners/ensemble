import { useState, useEffect, useCallback } from 'react';
import { api } from './useApi';

/**
 * Hook for fetching and managing reports data
 *
 * Provides task list and metrics data for the reports dashboard,
 * with filtering support by board and status.
 *
 * @param {Object} options - Filter options
 * @param {number} options.boardId - Filter by board ID (optional)
 * @param {string} options.status - Filter by status/column name (optional)
 *
 * @returns {Object} Reports state and actions
 *
 * @example
 * const { tasks, metrics, loading, error, refetch, exportCSV } = useReports({
 *   boardId: 1,
 * });
 */
export function useReports({ boardId, status } = {}) {
  const [tasks, setTasks] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /**
   * Build query string from filter parameters
   */
  const buildQueryString = useCallback((params) => {
    const searchParams = new URLSearchParams();

    if (params.boardId) {
      searchParams.append('boardId', params.boardId);
    }
    if (params.status) {
      searchParams.append('status', params.status);
    }

    const queryString = searchParams.toString();
    return queryString ? `?${queryString}` : '';
  }, []);

  /**
   * Fetch tasks data from the API
   */
  const fetchTasks = useCallback(async () => {
    const query = buildQueryString({ boardId, status });

    try {
      const data = await api.get(`/reports/tasks${query}`);
      setTasks(data || []);
      return data;
    } catch (err) {
      throw err;
    }
  }, [boardId, status, buildQueryString]);

  /**
   * Fetch metrics data from the API
   */
  const fetchMetrics = useCallback(async () => {
    const query = buildQueryString({ boardId });

    try {
      const data = await api.get(`/reports/metrics${query}`);
      setMetrics(data);
      return data;
    } catch (err) {
      throw err;
    }
  }, [boardId, buildQueryString]);

  /**
   * Fetch all reports data
   */
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      await Promise.all([fetchTasks(), fetchMetrics()]);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [fetchTasks, fetchMetrics]);

  // Fetch data on mount and when filters change
  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  /**
   * Refresh all reports data
   */
  const refetch = useCallback(() => {
    return fetchAll();
  }, [fetchAll]);

  /**
   * Export tasks as CSV file
   * Uses the API export endpoint
   */
  const exportCSV = useCallback(async () => {
    const query = buildQueryString({ boardId, status });

    try {
      const blob = await api.get(`/reports/export${query}`);

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `kanban-tasks-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      return true;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [boardId, status, buildQueryString]);

  /**
   * Get tasks grouped by status (column name)
   * @returns {Object} Tasks grouped by status
   */
  const getTasksByStatus = useCallback(() => {
    return tasks.reduce((groups, task) => {
      const status = task.column_name || 'Unknown';
      if (!groups[status]) {
        groups[status] = [];
      }
      groups[status].push(task);
      return groups;
    }, {});
  }, [tasks]);

  /**
   * Get tasks grouped by board
   * @returns {Object} Tasks grouped by board name
   */
  const getTasksByBoard = useCallback(() => {
    return tasks.reduce((groups, task) => {
      const board = task.board_name || 'Unknown';
      if (!groups[board]) {
        groups[board] = [];
      }
      groups[board].push(task);
      return groups;
    }, {});
  }, [tasks]);

  return {
    tasks,
    metrics,
    loading,
    error,
    refetch,
    exportCSV,
    getTasksByStatus,
    getTasksByBoard,
  };
}

export default useReports;
