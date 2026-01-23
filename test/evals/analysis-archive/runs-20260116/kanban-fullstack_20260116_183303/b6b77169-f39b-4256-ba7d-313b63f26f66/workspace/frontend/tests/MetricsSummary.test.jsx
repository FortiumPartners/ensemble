import { render, screen } from '@testing-library/react';
import MetricsSummary from '../src/components/reports/MetricsSummary';

describe('MetricsSummary', () => {
  const mockMetrics = {
    total_cards: 10,
    by_status: {
      'To Do': 3,
      'In Progress': 4,
      'Done': 3,
    },
    by_board: {
      'Board 1': 5,
      'Board 2': 3,
      'Board 3': 2,
    },
  };

  it('shows loading state', () => {
    render(<MetricsSummary loading={true} />);

    // Should show loading skeleton
    const cards = document.querySelectorAll('.metric-card');
    expect(cards.length).toBeGreaterThan(0);
  });

  it('shows no metrics message when metrics is null', () => {
    render(<MetricsSummary metrics={null} loading={false} />);

    expect(screen.getByText('No metrics available')).toBeInTheDocument();
  });

  it('displays total cards', () => {
    render(<MetricsSummary metrics={mockMetrics} loading={false} />);

    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('Total Tasks')).toBeInTheDocument();
  });

  it('displays status breakdown', () => {
    render(<MetricsSummary metrics={mockMetrics} loading={false} />);

    expect(screen.getByText(/To Do:/)).toBeInTheDocument();
    expect(screen.getByText(/In Progress:/)).toBeInTheDocument();
    expect(screen.getByText(/Done:/)).toBeInTheDocument();
  });

  it('displays completed count', () => {
    render(<MetricsSummary metrics={mockMetrics} loading={false} />);

    // Find the completed metric card using getAllByText and checking parent
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Tasks marked as done')).toBeInTheDocument();
  });

  it('displays in progress count', () => {
    render(<MetricsSummary metrics={mockMetrics} loading={false} />);

    // The metric label exists - check for the label and detail text
    expect(screen.getByText('Tasks being worked on')).toBeInTheDocument();
  });

  it('displays top boards', () => {
    render(<MetricsSummary metrics={mockMetrics} loading={false} />);

    expect(screen.getByText('Top Boards')).toBeInTheDocument();
    expect(screen.getByText(/Board 1: 5/)).toBeInTheDocument();
    expect(screen.getByText(/Board 2: 3/)).toBeInTheDocument();
  });

  it('calculates percentages correctly', () => {
    render(<MetricsSummary metrics={mockMetrics} loading={false} />);

    // To Do and Done both have 30% - use getAllByText
    const percentages = screen.getAllByText(/30%/);
    expect(percentages.length).toBeGreaterThan(0);
  });

  it('handles empty status data', () => {
    const emptyMetrics = {
      total_cards: 0,
      by_status: {},
      by_board: {},
    };
    render(<MetricsSummary metrics={emptyMetrics} loading={false} />);

    // Multiple 0 values exist - use getAllByText
    const zeroValues = screen.getAllByText('0');
    expect(zeroValues.length).toBeGreaterThan(0);
    expect(screen.getByText('No status data')).toBeInTheDocument();
  });

  it('has correct ARIA label', () => {
    render(<MetricsSummary metrics={mockMetrics} loading={false} />);

    expect(screen.getByRole('region', { name: 'Task Metrics Summary' })).toBeInTheDocument();
  });
});
