import React from 'react';

function MetricsSummary({ metrics }) {
  const statusEntries = Object.entries(metrics.by_status || {});
  const boardEntries = Object.entries(metrics.by_board || {});

  return (
    <div className="metrics-summary" data-testid="metrics-summary">
      <div className="metric-card metric-total">
        <div className="metric-value">{metrics.total_cards}</div>
        <div className="metric-label">Total Tasks</div>
      </div>

      {statusEntries.length > 0 && (
        <div className="metrics-section">
          <h4>By Status</h4>
          <div className="metric-cards">
            {statusEntries.map(([status, count]) => (
              <div key={status} className="metric-card">
                <div className="metric-value">{count}</div>
                <div className="metric-label">{status}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {boardEntries.length > 0 && (
        <div className="metrics-section">
          <h4>By Board (Top 5)</h4>
          <div className="metric-cards">
            {boardEntries.map(([board, count]) => (
              <div key={board} className="metric-card">
                <div className="metric-value">{count}</div>
                <div className="metric-label">{board}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default MetricsSummary;
