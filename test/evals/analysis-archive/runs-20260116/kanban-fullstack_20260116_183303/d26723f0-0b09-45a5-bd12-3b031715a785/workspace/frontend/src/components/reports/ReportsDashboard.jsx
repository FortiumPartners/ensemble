import React, { useState, useEffect } from 'react';
import MetricsSummary from './MetricsSummary';
import TasksGrid from './TasksGrid';
import { useReports } from '../../hooks/useReports';
import { useApi } from '../../hooks/useApi';

function ReportsDashboard() {
  const [boards, setBoards] = useState([]);
  const [selectedBoardId, setSelectedBoardId] = useState('');
  const { get } = useApi();

  const { tasks, metrics, loading, error, refetch } = useReports({
    boardId: selectedBoardId || undefined,
  });

  useEffect(() => {
    const fetchBoards = async () => {
      try {
        const data = await get('/boards');
        setBoards(data);
      } catch (err) {
        console.error('Failed to fetch boards:', err);
      }
    };
    fetchBoards();
  }, [get]);

  const handleBoardChange = (e) => {
    setSelectedBoardId(e.target.value);
  };

  if (loading) {
    return <div className="reports-loading">Loading reports...</div>;
  }

  if (error) {
    return <div className="reports-error">Error: {error}</div>;
  }

  return (
    <div className="reports-dashboard" data-testid="reports-dashboard">
      <div className="reports-header">
        <h2>Reports</h2>
        <div className="reports-filters">
          <select
            value={selectedBoardId}
            onChange={handleBoardChange}
            className="board-filter"
          >
            <option value="">All Boards</option>
            {boards.map((board) => (
              <option key={board.id} value={board.id}>
                {board.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <MetricsSummary metrics={metrics} />
      <TasksGrid tasks={tasks} />
    </div>
  );
}

export default ReportsDashboard;
