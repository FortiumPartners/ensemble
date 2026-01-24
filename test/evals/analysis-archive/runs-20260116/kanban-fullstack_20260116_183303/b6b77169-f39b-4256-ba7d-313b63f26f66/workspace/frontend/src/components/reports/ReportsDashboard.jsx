import { useState, useEffect, useCallback, memo } from 'react';
import MetricsSummary from './MetricsSummary';
import TasksGrid from './TasksGrid';
import { useReports } from '../../hooks';
import { api } from '../../hooks/useApi';

/**
 * Reports dashboard component
 *
 * Main view for analytics and reporting with:
 * - Metrics summary cards
 * - Filterable task grid
 * - CSV export functionality
 *
 * @param {Object} props
 * @param {Function} props.onNavigate - Navigation handler for back button
 */
function ReportsDashboard({ onNavigate }) {
  const [boards, setBoards] = useState([]);
  const [selectedBoardId, setSelectedBoardId] = useState('');
  const [boardsLoading, setBoardsLoading] = useState(true);

  const { tasks, metrics, loading, error, refetch, exportCSV } = useReports({
    boardId: selectedBoardId || undefined,
  });

  /**
   * Fetch boards for filter dropdown
   */
  const fetchBoards = useCallback(async () => {
    setBoardsLoading(true);
    try {
      const data = await api.get('/boards');
      setBoards(data || []);
    } catch {
      // Non-critical error, filter just won't have options
    } finally {
      setBoardsLoading(false);
    }
  }, []);

  // Fetch boards on mount
  useEffect(() => {
    fetchBoards();
  }, [fetchBoards]);

  /**
   * Handle board filter change
   */
  const handleBoardFilterChange = useCallback((event) => {
    setSelectedBoardId(event.target.value);
  }, []);

  /**
   * Handle CSV export
   */
  const handleExport = useCallback(async () => {
    try {
      await exportCSV();
    } catch {
      // Error shown via hook
    }
  }, [exportCSV]);

  /**
   * Handle refresh
   */
  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  return (
    <div className="reports-container">
      {/* Reports Header */}
      <header className="reports-header">
        <h2>Reports Dashboard</h2>

        <div className="reports-actions">
          {/* Board Filter */}
          <div className="reports-filter">
            <label htmlFor="board-filter">Board:</label>
            <select
              id="board-filter"
              value={selectedBoardId}
              onChange={handleBoardFilterChange}
              disabled={boardsLoading}
            >
              <option value="">All Boards</option>
              {boards.map((board) => (
                <option key={board.id} value={board.id}>
                  {board.name}
                </option>
              ))}
            </select>
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleRefresh}
            disabled={loading}
            aria-label="Refresh data"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="currentColor"
              style={{ marginRight: 'var(--space-2)' }}
            >
              <path d="M8 3a5 5 0 104.546 2.914.75.75 0 011.374-.612A6.5 6.5 0 118 1.5v1.5z" />
              <path d="M8 1.5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 018 1.5z" />
              <path d="M4.5 4.75a.75.75 0 01.75-.75h3.5a.75.75 0 010 1.5h-3.5a.75.75 0 01-.75-.75z" />
            </svg>
            Refresh
          </button>
        </div>
      </header>

      {/* Error State */}
      {error && (
        <div className="error-message" role="alert">
          <h3>Failed to load reports</h3>
          <p>{error.message}</p>
          <button type="button" className="btn btn-primary" onClick={handleRefresh}>
            Try Again
          </button>
        </div>
      )}

      {/* Metrics Summary */}
      <MetricsSummary metrics={metrics} loading={loading} />

      {/* Tasks Grid */}
      <TasksGrid
        tasks={tasks}
        loading={loading}
        onExport={handleExport}
      />
    </div>
  );
}

export default memo(ReportsDashboard);
