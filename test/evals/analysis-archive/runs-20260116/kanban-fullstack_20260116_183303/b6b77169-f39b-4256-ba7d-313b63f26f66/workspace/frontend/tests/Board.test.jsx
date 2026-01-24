import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock the hooks
jest.mock('../src/hooks', () => ({
  useBoard: jest.fn(),
  useDragDrop: jest.fn(() => ({
    isDragging: false,
    handlers: {
      handleDragStart: jest.fn(),
      handleDragOver: jest.fn(),
      handleDragEnter: jest.fn(),
      handleDragLeave: jest.fn(),
      handleDrop: jest.fn(),
      handleDragEnd: jest.fn(),
    },
    isCardDragging: jest.fn(() => false),
    isDropTarget: jest.fn(() => false),
  })),
}));

import Board from '../src/components/Board';
import { useBoard, useDragDrop } from '../src/hooks';

describe('Board', () => {
  const mockBoard = {
    id: 1,
    name: 'Test Board',
    columns: [
      {
        id: 1,
        name: 'To Do',
        cards: [
          { id: 1, title: 'Card 1', description: '', created_at: '2024-01-15T10:00:00Z' },
        ],
      },
      {
        id: 2,
        name: 'Done',
        cards: [],
      },
    ],
  };

  const mockActions = {
    updateBoardName: jest.fn(),
    createColumn: jest.fn(),
    updateColumn: jest.fn(),
    deleteColumn: jest.fn(),
    createCard: jest.fn(),
    updateCard: jest.fn(),
    deleteCard: jest.fn(),
    moveCard: jest.fn(),
    refresh: jest.fn(),
  };

  const defaultProps = {
    boardId: 1,
    onBack: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useBoard.mockReturnValue({
      board: mockBoard,
      loading: false,
      error: null,
      actions: mockActions,
    });
  });

  it('renders board name', () => {
    render(<Board {...defaultProps} />);

    expect(screen.getByDisplayValue('Test Board')).toBeInTheDocument();
  });

  it('renders columns', () => {
    render(<Board {...defaultProps} />);

    // Check column names exist (they are input values)
    expect(screen.getByDisplayValue('To Do')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Done')).toBeInTheDocument();
  });

  it('renders cards in columns', () => {
    render(<Board {...defaultProps} />);

    expect(screen.getByText('Card 1')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    useBoard.mockReturnValue({
      board: null,
      loading: true,
      error: null,
      actions: mockActions,
    });

    render(<Board {...defaultProps} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows error state', () => {
    useBoard.mockReturnValue({
      board: null,
      loading: false,
      error: { message: 'Failed to load' },
      actions: mockActions,
    });

    render(<Board {...defaultProps} />);

    expect(screen.getByText('Failed to load board')).toBeInTheDocument();
    expect(screen.getByText('Failed to load')).toBeInTheDocument();
  });

  it('calls onBack when back button is clicked', () => {
    render(<Board {...defaultProps} />);

    fireEvent.click(screen.getByLabelText('Back to boards'));

    expect(defaultProps.onBack).toHaveBeenCalled();
  });

  it('shows add column button', () => {
    render(<Board {...defaultProps} />);

    expect(screen.getByLabelText('Add a column')).toBeInTheDocument();
  });

  it('opens add column form when clicked', () => {
    render(<Board {...defaultProps} />);

    fireEvent.click(screen.getByLabelText('Add a column'));

    expect(screen.getByPlaceholderText('Enter column name...')).toBeInTheDocument();
  });

  it('creates column when form is submitted', async () => {
    mockActions.createColumn.mockResolvedValue({ id: 3, name: 'New Column' });
    render(<Board {...defaultProps} />);

    fireEvent.click(screen.getByLabelText('Add a column'));
    fireEvent.change(screen.getByPlaceholderText('Enter column name...'), {
      target: { value: 'New Column' },
    });
    fireEvent.click(screen.getByText('Add Column'));

    await waitFor(() => {
      expect(mockActions.createColumn).toHaveBeenCalledWith('New Column');
    });
  });

  it('displays column and card counts', () => {
    render(<Board {...defaultProps} />);

    expect(screen.getByText(/2 columns/)).toBeInTheDocument();
    expect(screen.getByText(/1 card/)).toBeInTheDocument();
  });

  it('shows not found state when board is null', () => {
    useBoard.mockReturnValue({
      board: null,
      loading: false,
      error: null,
      actions: mockActions,
    });

    render(<Board {...defaultProps} />);

    expect(screen.getByText('Board not found')).toBeInTheDocument();
  });

  it('has correct ARIA labels', () => {
    render(<Board {...defaultProps} />);

    expect(screen.getByRole('region', { name: 'Kanban board' })).toBeInTheDocument();
  });

  it('cancels add column when Escape is pressed', () => {
    render(<Board {...defaultProps} />);

    fireEvent.click(screen.getByLabelText('Add a column'));
    expect(screen.getByPlaceholderText('Enter column name...')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByPlaceholderText('Enter column name...'), { key: 'Escape' });

    expect(screen.queryByPlaceholderText('Enter column name...')).not.toBeInTheDocument();
  });

  it('submits add column when Enter is pressed', async () => {
    mockActions.createColumn.mockResolvedValue({ id: 3, name: 'Test Column' });
    render(<Board {...defaultProps} />);

    fireEvent.click(screen.getByLabelText('Add a column'));
    fireEvent.change(screen.getByPlaceholderText('Enter column name...'), {
      target: { value: 'Test Column' },
    });
    fireEvent.keyDown(screen.getByPlaceholderText('Enter column name...'), { key: 'Enter' });

    await waitFor(() => {
      expect(mockActions.createColumn).toHaveBeenCalledWith('Test Column');
    });
  });

  it('cancels add column form when clicking Cancel button', () => {
    render(<Board {...defaultProps} />);

    fireEvent.click(screen.getByLabelText('Add a column'));
    fireEvent.change(screen.getByPlaceholderText('Enter column name...'), {
      target: { value: 'Some Column' },
    });

    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.queryByPlaceholderText('Enter column name...')).not.toBeInTheDocument();
  });

  it('closes add column form on blur when empty', () => {
    render(<Board {...defaultProps} />);

    fireEvent.click(screen.getByLabelText('Add a column'));
    const input = screen.getByPlaceholderText('Enter column name...');
    fireEvent.blur(input);

    expect(screen.queryByPlaceholderText('Enter column name...')).not.toBeInTheDocument();
  });

  it('does not close add column form on blur when has value', () => {
    render(<Board {...defaultProps} />);

    fireEvent.click(screen.getByLabelText('Add a column'));
    const input = screen.getByPlaceholderText('Enter column name...');
    fireEvent.change(input, { target: { value: 'Test' } });
    fireEvent.blur(input);

    expect(screen.getByPlaceholderText('Enter column name...')).toBeInTheDocument();
  });

  it('does not submit add column when name is empty', async () => {
    render(<Board {...defaultProps} />);

    fireEvent.click(screen.getByLabelText('Add a column'));
    fireEvent.click(screen.getByText('Add Column'));

    expect(mockActions.createColumn).not.toHaveBeenCalled();
  });

  it('handles createColumn error gracefully', async () => {
    mockActions.createColumn.mockRejectedValue(new Error('Failed to create'));
    render(<Board {...defaultProps} />);

    fireEvent.click(screen.getByLabelText('Add a column'));
    fireEvent.change(screen.getByPlaceholderText('Enter column name...'), {
      target: { value: 'New Column' },
    });
    fireEvent.click(screen.getByText('Add Column'));

    await waitFor(() => {
      expect(mockActions.createColumn).toHaveBeenCalled();
    });
  });

  it('updates board name on blur when changed', () => {
    render(<Board {...defaultProps} />);

    const nameInput = screen.getByDisplayValue('Test Board');
    fireEvent.change(nameInput, { target: { value: 'New Name' } });
    fireEvent.blur(nameInput);

    expect(mockActions.updateBoardName).toHaveBeenCalledWith('New Name');
  });

  it('does not update board name when unchanged', () => {
    render(<Board {...defaultProps} />);

    const nameInput = screen.getByDisplayValue('Test Board');
    fireEvent.blur(nameInput);

    expect(mockActions.updateBoardName).not.toHaveBeenCalled();
  });

  it('opens card modal when card is clicked', () => {
    render(<Board {...defaultProps} />);

    // The card in the column should be clickable
    fireEvent.click(screen.getByText('Card 1'));

    // Modal should be open
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes card modal', async () => {
    render(<Board {...defaultProps} />);

    fireEvent.click(screen.getByText('Card 1'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Close modal'));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('displays correct plural for single column', () => {
    useBoard.mockReturnValue({
      board: { ...mockBoard, columns: [mockBoard.columns[0]] },
      loading: false,
      error: null,
      actions: mockActions,
    });

    render(<Board {...defaultProps} />);

    expect(screen.getByText(/1 column/)).toBeInTheDocument();
  });

  it('shows is-dragging class when dragging', () => {
    const mockDragDrop = require('../src/hooks').useDragDrop;
    mockDragDrop.mockReturnValue({
      isDragging: true,
      handlers: {
        handleDragStart: jest.fn(),
        handleDragOver: jest.fn(),
        handleDragEnter: jest.fn(),
        handleDragLeave: jest.fn(),
        handleDrop: jest.fn(),
        handleDragEnd: jest.fn(),
      },
      isCardDragging: jest.fn(() => false),
      isDropTarget: jest.fn(() => false),
    });

    render(<Board {...defaultProps} />);

    expect(screen.getByRole('region', { name: 'Kanban board' })).toHaveClass('is-dragging');
  });
});
