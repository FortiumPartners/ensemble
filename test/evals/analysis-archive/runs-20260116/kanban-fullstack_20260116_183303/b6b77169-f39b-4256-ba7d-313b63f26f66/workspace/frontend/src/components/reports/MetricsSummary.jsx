import { memo, useMemo } from 'react';

/**
 * Metrics summary component displaying key statistics
 *
 * Shows aggregated metrics in card format with visual indicators.
 *
 * @param {Object} props
 * @param {Object} props.metrics - Metrics data from API
 * @param {number} props.metrics.total_cards - Total card count
 * @param {Object} props.metrics.by_status - Cards grouped by status
 * @param {Object} props.metrics.by_board - Cards grouped by board
 * @param {boolean} props.loading - Whether data is loading
 */
function MetricsSummary({ metrics, loading }) {
  /**
   * Calculate status distribution percentages
   */
  const statusDistribution = useMemo(() => {
    if (!metrics?.by_status || !metrics?.total_cards) {
      return [];
    }

    const colors = {
      'To Do': 'var(--color-warning)',
      'In Progress': 'var(--color-info)',
      'Done': 'var(--color-success)',
    };

    return Object.entries(metrics.by_status).map(([status, count]) => ({
      status,
      count,
      percentage: Math.round((count / metrics.total_cards) * 100),
      color: colors[status] || 'var(--color-text-muted)',
    }));
  }, [metrics]);

  /**
   * Get top boards by card count
   */
  const topBoards = useMemo(() => {
    if (!metrics?.by_board) return [];

    return Object.entries(metrics.by_board)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));
  }, [metrics]);

  if (loading) {
    return (
      <div className="metrics-summary">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="metric-card animate-pulse">
            <div className="metric-label" style={{ width: '60%', height: '12px', background: 'var(--color-surface)' }}></div>
            <div className="metric-value" style={{ width: '40%', height: '36px', background: 'var(--color-surface)', marginTop: 'var(--space-2)' }}></div>
          </div>
        ))}
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="metrics-summary">
        <div className="metric-card">
          <p className="text-muted">No metrics available</p>
        </div>
      </div>
    );
  }

  return (
    <section className="metrics-summary" aria-label="Task Metrics Summary">
      {/* Total Cards */}
      <article className="metric-card accent">
        <div className="metric-label">Total Tasks</div>
        <div className="metric-value">{metrics.total_cards || 0}</div>
        <div className="metric-detail">
          Across all boards
        </div>
      </article>

      {/* Status Breakdown */}
      <article className="metric-card">
        <div className="metric-label">By Status</div>
        <div className="status-breakdown">
          {statusDistribution.map(({ status, count, percentage }) => (
            <div key={status} className="status-item">
              <span
                className={`status-dot ${
                  status === 'To Do' ? 'todo' :
                  status === 'In Progress' ? 'progress' :
                  status === 'Done' ? 'done' : ''
                }`}
              />
              <span>{status}: <strong>{count}</strong> ({percentage}%)</span>
            </div>
          ))}
        </div>
        {statusDistribution.length === 0 && (
          <p className="text-muted">No status data</p>
        )}
      </article>

      {/* Tasks Done */}
      <article className="metric-card success">
        <div className="metric-label">Completed</div>
        <div className="metric-value">
          {metrics.by_status?.Done || metrics.by_status?.done || 0}
        </div>
        <div className="metric-detail">
          Tasks marked as done
        </div>
      </article>

      {/* In Progress */}
      <article className="metric-card warning">
        <div className="metric-label">In Progress</div>
        <div className="metric-value">
          {metrics.by_status?.['In Progress'] || metrics.by_status?.in_progress || 0}
        </div>
        <div className="metric-detail">
          Tasks being worked on
        </div>
      </article>

      {/* Top Boards */}
      {topBoards.length > 0 && (
        <article className="metric-card" style={{ gridColumn: 'span 2' }}>
          <div className="metric-label">Top Boards</div>
          <div className="board-distribution">
            <div className="distribution-bar">
              {topBoards.map((board, index) => {
                const percentage = metrics.total_cards
                  ? (board.count / metrics.total_cards) * 100
                  : 0;
                const hue = (index * 60 + 200) % 360;
                return (
                  <div
                    key={board.name}
                    className="distribution-segment"
                    style={{
                      width: `${percentage}%`,
                      background: `hsl(${hue}, 70%, 50%)`,
                    }}
                    title={`${board.name}: ${board.count} tasks`}
                  />
                );
              })}
            </div>
            <div className="distribution-legend">
              {topBoards.map((board, index) => {
                const hue = (index * 60 + 200) % 360;
                return (
                  <div key={board.name} className="legend-item">
                    <span
                      className="legend-color"
                      style={{ background: `hsl(${hue}, 70%, 50%)` }}
                    />
                    <span>{board.name}: {board.count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </article>
      )}
    </section>
  );
}

export default memo(MetricsSummary);
