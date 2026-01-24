import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import Board from '../src/components/Board';

// Mock the hooks
jest.mock('../src/hooks/useBoard', () => ({
  useBoard: jest.fn(),
}));

jest.mock('../src/hooks/useDragDrop', () => ({
  useDragDrop: jest.fn(),
}));

import { useBoard } from '../src/hooks/useBoard';
import { useDragDrop } from '../src/hooks/useDragDrop';

describe('Board Component', () => {
  const mockActions = {
    createColumn: jest.fn(),
    updateColumn: jest.fn(),
    deleteColumn: jest.fn(),
    createCard: jest.fn(),
    updateCard: jest.fn(),
    deleteCard: jest.fn(),
    moveCard: jest.fn(),
  };

  const mockDragHandlers = {
    onDragStart: jest.fn(),
    onDragEnd: jest.fn(),
    onDragOver: jest.fn(),
    onDragLeave: jest.fn(),
    onDrop: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useDragDrop.mockReturnValue({
      isDragging: false,
      draggedItem: null,
      dragOverColumn: null,
      handlers: mockDragHandlers,
    });
  });

  it('should show loading state', () => {
    useBoard.mockReturnValue({
      board: null,
      loading: true,
      error: null,
      actions: mockActions,
    });

    render(<Board boardId={1} />);

    expect(screen.getByText('Loading board...')).toBeInTheDocument();
  });

  it('should show error state', () => {
    useBoard.mockReturnValue({
      board: null,
      loading: false,
      error: 'Failed to load board',
      actions: mockActions,
    });

    render(<Board boardId={1} />);

    expect(screen.getByText('Error: Failed to load board')).toBeInTheDocument();
  });

  it('should show empty state when board not found', () => {
    useBoard.mockReturnValue({
      board: null,
      loading: false,
      error: null,
      actions: mockActions,
    });

    render(<Board boardId={1} />);

    expect(screen.getByText('Board not found')).toBeInTheDocument();
  });

  it('should render board with columns', () => {
    useBoard.mockReturnValue({
      board: {
        id: 1,
        name: 'Test Board',
        columns: [
          { id: 1, name: 'To Do', position: 1024, cards: [] },
          { id: 2, name: 'Done', position: 2048, cards: [] },
        ],
      },
      loading: false,
      error: null,
      actions: mockActions,
    });

    render(<Board boardId={1} />);

    expect(screen.getByText('Test Board')).toBeInTheDocument();
    expect(screen.getByText('To Do')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('should render cards in columns', () => {
    useBoard.mockReturnValue({
      board: {
        id: 1,
        name: 'Test Board',
        columns: [
          {
            id: 1,
            name: 'To Do',
            position: 1024,
            cards: [
              { id: 1, title: 'Task 1', description: 'Description 1', position: 1024 },
              { id: 2, title: 'Task 2', description: null, position: 2048 },
            ],
          },
        ],
      },
      loading: false,
      error: null,
      actions: mockActions,
    });

    render(<Board boardId={1} />);

    expect(screen.getByText('Task 1')).toBeInTheDocument();
    expect(screen.getByText('Task 2')).toBeInTheDocument();
    expect(screen.getByText('Description 1')).toBeInTheDocument();
  });

  it('should show add column form when button clicked', async () => {
    useBoard.mockReturnValue({
      board: {
        id: 1,
        name: 'Test Board',
        columns: [],
      },
      loading: false,
      error: null,
      actions: mockActions,
    });

    render(<Board boardId={1} />);

    const addButton = screen.getByText('+ Add Column');
    fireEvent.click(addButton);

    expect(screen.getByPlaceholderText('Column name...')).toBeInTheDocument();
  });

  it('should create column when form submitted', async () => {
    mockActions.createColumn.mockResolvedValue({ id: 1, name: 'New Column' });

    useBoard.mockReturnValue({
      board: {
        id: 1,
        name: 'Test Board',
        columns: [],
      },
      loading: false,
      error: null,
      actions: mockActions,
    });

    render(<Board boardId={1} />);

    fireEvent.click(screen.getByText('+ Add Column'));

    const input = screen.getByPlaceholderText('Column name...');
    fireEvent.change(input, { target: { value: 'New Column' } });

    const form = input.closest('form');
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockActions.createColumn).toHaveBeenCalledWith('New Column');
    });
  });

  it('should open card modal when card clicked', async () => {
    useBoard.mockReturnValue({
      board: {
        id: 1,
        name: 'Test Board',
        columns: [
          {
            id: 1,
            name: 'To Do',
            position: 1024,
            cards: [{ id: 1, title: 'Task 1', description: 'Desc', position: 1024 }],
          },
        ],
      },
      loading: false,
      error: null,
      actions: mockActions,
    });

    render(<Board boardId={1} />);

    const card = screen.getByTestId('card-1');
    fireEvent.click(card);

    expect(screen.getByTestId('card-modal')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Task 1')).toBeInTheDocument();
  });
});
