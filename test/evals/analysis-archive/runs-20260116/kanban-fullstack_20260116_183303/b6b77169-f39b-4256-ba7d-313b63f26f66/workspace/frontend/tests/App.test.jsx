import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock the components to simplify testing
jest.mock('../src/components', () => ({
  Board: ({ boardId, onBack }) => (
    <div data-testid="board">
      Board {boardId}
      <button onClick={onBack}>Back</button>
    </div>
  ),
  BoardList: ({ onSelectBoard }) => (
    <div data-testid="board-list">
      <button onClick={() => onSelectBoard(1)}>Select Board</button>
    </div>
  ),
  ReportsDashboard: () => <div data-testid="reports-dashboard">Reports</div>,
}));

import App from '../src/App';

describe('App', () => {
  it('renders header with title', () => {
    render(<App />);

    expect(screen.getByText('Kanban Board')).toBeInTheDocument();
  });

  it('renders navigation with Boards and Reports links', () => {
    render(<App />);

    expect(screen.getByText('Boards')).toBeInTheDocument();
    expect(screen.getByText('Reports')).toBeInTheDocument();
  });

  it('shows BoardList by default', () => {
    render(<App />);

    expect(screen.getByTestId('board-list')).toBeInTheDocument();
  });

  it('navigates to Reports when Reports link is clicked', () => {
    render(<App />);

    fireEvent.click(screen.getByText('Reports'));

    expect(screen.getByTestId('reports-dashboard')).toBeInTheDocument();
  });

  it('navigates back to Boards when Boards link is clicked', () => {
    render(<App />);

    fireEvent.click(screen.getByText('Reports'));
    expect(screen.getByTestId('reports-dashboard')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Boards'));
    expect(screen.getByTestId('board-list')).toBeInTheDocument();
  });

  it('shows Board when a board is selected', () => {
    render(<App />);

    fireEvent.click(screen.getByText('Select Board'));

    expect(screen.getByTestId('board')).toBeInTheDocument();
    expect(screen.getByText('Board 1')).toBeInTheDocument();
  });

  it('returns to BoardList when back is clicked from Board', () => {
    render(<App />);

    fireEvent.click(screen.getByText('Select Board'));
    expect(screen.getByTestId('board')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByTestId('board-list')).toBeInTheDocument();
  });

  it('navigates to BoardList when header title is clicked', () => {
    render(<App />);

    fireEvent.click(screen.getByText('Reports'));
    expect(screen.getByTestId('reports-dashboard')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Kanban Board'));
    expect(screen.getByTestId('board-list')).toBeInTheDocument();
  });

  it('highlights active nav link', () => {
    render(<App />);

    const boardsLink = screen.getByText('Boards');
    const reportsLink = screen.getByText('Reports');

    expect(boardsLink).toHaveClass('active');
    expect(reportsLink).not.toHaveClass('active');

    fireEvent.click(reportsLink);

    expect(boardsLink).not.toHaveClass('active');
    expect(reportsLink).toHaveClass('active');
  });

  it('marks Boards as active when viewing a specific board', () => {
    render(<App />);

    fireEvent.click(screen.getByText('Select Board'));

    const boardsLink = screen.getByText('Boards');
    expect(boardsLink).toHaveClass('active');
  });
});
