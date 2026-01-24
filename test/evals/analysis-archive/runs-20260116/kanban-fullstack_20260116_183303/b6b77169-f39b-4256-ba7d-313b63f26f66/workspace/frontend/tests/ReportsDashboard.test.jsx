import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock TasksGrid to avoid ag-grid import issues
jest.mock('../src/components/reports/TasksGrid', () => {
  return function MockTasksGrid({ tasks, loading, onExport }) {
    return (
      <div data-testid="tasks-grid">
        <span>{tasks?.length || 0} tasks</span>
        <button onClick={onExport} aria-label="Export to CSV">Export</button>
        {loading && <span>Loading...</span>}
      </div>
    );
  };
});

// Mock the hooks
jest.mock('../src/hooks', () => ({
  useReports: jest.fn(),
}));

jest.mock('../src/hooks/useApi', () => ({
  api: {
    get: jest.fn(),
  },
}));

import ReportsDashboard from '../src/components/reports/ReportsDashboard';

import { useReports } from '../src/hooks';
import { api } from '../src/hooks/useApi';

describe('ReportsDashboard', () => {
  const mockTasks = [
    { id: 1, title: 'Task 1', board_name: 'Board 1', column_name: 'To Do' },
    { id: 2, title: 'Task 2', board_name: 'Board 1', column_name: 'Done' },
  ];

  const mockMetrics = {
    total_cards: 2,
    by_status: { 'To Do': 1, Done: 1 },
    by_board: { 'Board 1': 2 },
  };

  const mockBoards = [
    { id: 1, name: 'Board 1' },
    { id: 2, name: 'Board 2' },
  ];

  const defaultMockReports = {
    tasks: mockTasks,
    metrics: mockMetrics,
    loading: false,
    error: null,
    refetch: jest.fn(),
    exportCSV: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useReports.mockReturnValue(defaultMockReports);
    api.get.mockResolvedValue(mockBoards);
  });

  it('renders the dashboard header', async () => {
    render(<ReportsDashboard />);

    expect(screen.getByText('Reports Dashboard')).toBeInTheDocument();
  });

  it('loads and displays boards in filter dropdown', async () => {
    render(<ReportsDashboard />);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/boards');
    });

    await waitFor(() => {
      expect(screen.getByText('Board 1')).toBeInTheDocument();
      expect(screen.getByText('Board 2')).toBeInTheDocument();
    });
  });

  it('shows All Boards option in filter', async () => {
    render(<ReportsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('All Boards')).toBeInTheDocument();
    });
  });

  it('handles board filter change', async () => {
    render(<ReportsDashboard />);

    await waitFor(() => {
      expect(screen.getByLabelText('Board:')).toBeInTheDocument();
    });

    const select = screen.getByLabelText('Board:');
    fireEvent.change(select, { target: { value: '1' } });

    expect(select.value).toBe('1');
  });

  it('shows refresh button and handles click', async () => {
    render(<ReportsDashboard />);

    const refreshButton = screen.getByLabelText('Refresh data');
    expect(refreshButton).toBeInTheDocument();

    fireEvent.click(refreshButton);

    expect(defaultMockReports.refetch).toHaveBeenCalled();
  });

  it('disables refresh button when loading', () => {
    useReports.mockReturnValue({
      ...defaultMockReports,
      loading: true,
    });

    render(<ReportsDashboard />);

    expect(screen.getByLabelText('Refresh data')).toBeDisabled();
  });

  it('displays error state with try again button', async () => {
    const error = new Error('Failed to fetch');
    useReports.mockReturnValue({
      ...defaultMockReports,
      error,
    });

    render(<ReportsDashboard />);

    expect(screen.getByText('Failed to load reports')).toBeInTheDocument();
    expect(screen.getByText('Failed to fetch')).toBeInTheDocument();

    const tryAgainButton = screen.getByText('Try Again');
    fireEvent.click(tryAgainButton);

    expect(defaultMockReports.refetch).toHaveBeenCalled();
  });

  it('renders MetricsSummary component', () => {
    render(<ReportsDashboard />);

    // MetricsSummary should be rendered with metrics
    expect(screen.getByRole('region', { name: 'Task Metrics Summary' })).toBeInTheDocument();
  });

  it('handles failed board fetch gracefully', async () => {
    api.get.mockRejectedValue(new Error('Network error'));

    render(<ReportsDashboard />);

    // Should still render without crashing
    await waitFor(() => {
      expect(screen.getByText('Reports Dashboard')).toBeInTheDocument();
    });
  });

  it('handles export button click', async () => {
    render(<ReportsDashboard />);

    // Find export button in TasksGrid
    const exportButton = screen.getByLabelText('Export to CSV');
    fireEvent.click(exportButton);

    await waitFor(() => {
      expect(defaultMockReports.exportCSV).toHaveBeenCalled();
    });
  });

  it('handles export error gracefully', async () => {
    defaultMockReports.exportCSV.mockRejectedValue(new Error('Export failed'));

    render(<ReportsDashboard />);

    const exportButton = screen.getByLabelText('Export to CSV');
    fireEvent.click(exportButton);

    // Should not crash
    await waitFor(() => {
      expect(defaultMockReports.exportCSV).toHaveBeenCalled();
    });
  });
});
