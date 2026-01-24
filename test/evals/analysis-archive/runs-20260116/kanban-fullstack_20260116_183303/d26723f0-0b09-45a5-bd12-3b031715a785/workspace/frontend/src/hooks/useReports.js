import { useState, useEffect, useCallback } from 'react';
import { useApi } from './useApi';

export function useReports({ boardId, status } = {}) {
  const [tasks, setTasks] = useState([]);
  const [metrics, setMetrics] = useState({ total_cards: 0, by_status: {}, by_board: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { get } = useApi();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (boardId) params.append('boardId', boardId);
      if (status) params.append('status', status);

      const queryString = params.toString();
      const [tasksData, metricsData] = await Promise.all([
        get(`/reports/tasks${queryString ? `?${queryString}` : ''}`),
        get(`/reports/metrics${queryString ? `?${queryString}` : ''}`),
      ]);

      setTasks(tasksData);
      setMetrics(metricsData);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [boardId, status, get]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    tasks,
    metrics,
    loading,
    error,
    refetch: fetchData,
  };
}

export default useReports;
