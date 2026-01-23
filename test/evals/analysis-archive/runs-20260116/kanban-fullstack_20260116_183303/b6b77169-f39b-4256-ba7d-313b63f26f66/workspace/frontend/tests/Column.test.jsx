import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Column from '../src/components/Column';

describe('Column', () => {
  const mockColumn = {
    id: 1,
    name: 'To Do',
    cards: [
      { id: 1, title: 'Card 1', description: '', created_at: '2024-01-15T10:00:00Z' },
      { id: 2, title: 'Card 2', description: 'Description', created_at: '2024-01-16T10:00:00Z' },
    ],
  };

  const mockDragHandlers = {
    handleDragStart: jest.fn(),
    handleDragOver: jest.fn(),
    handleDragEnter: jest.fn(),
    handleDragLeave: jest.fn(),
    handleDrop: jest.fn(),
    handleDragEnd: jest.fn(),
  };

  const defaultProps = {
    column: mockColumn,
    onUpdateName: jest.fn(),
    onDelete: jest.fn(),
    onCreateCard: jest.fn(),
    onCardClick: jest.fn(),
    dragHandlers: mockDragHandlers,
    isCardDragging: jest.fn(() => false),
    isDropTarget: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders column name', () => {
    render(<Column {...defaultProps} />);

    expect(screen.getByDisplayValue('To Do')).toBeInTheDocument();
  });

  it('renders card count', () => {
    render(<Column {...defaultProps} />);

    expect(screen.getByLabelText('2 cards')).toBeInTheDocument();
  });

  it('renders all cards', () => {
    render(<Column {...defaultProps} />);

    expect(screen.getByText('Card 1')).toBeInTheDocument();
    expect(screen.getByText('Card 2')).toBeInTheDocument();
  });

  it('shows empty message when no cards', () => {
    const emptyColumn = { ...mockColumn, cards: [] };
    render(<Column {...defaultProps} column={emptyColumn} />);

    expect(screen.getByText('No cards yet')).toBeInTheDocument();
  });

  it('shows add card button', () => {
    render(<Column {...defaultProps} />);

    expect(screen.getByLabelText('Add a card')).toBeInTheDocument();
  });

  it('opens add card form when button is clicked', () => {
    render(<Column {...defaultProps} />);

    fireEvent.click(screen.getByLabelText('Add a card'));

    expect(screen.getByPlaceholderText('Enter card title...')).toBeInTheDocument();
  });

  it('creates card when form is submitted', async () => {
    defaultProps.onCreateCard.mockResolvedValue({ id: 3, title: 'New Card' });
    render(<Column {...defaultProps} />);

    fireEvent.click(screen.getByLabelText('Add a card'));
    fireEvent.change(screen.getByPlaceholderText('Enter card title...'), {
      target: { value: 'New Card' },
    });
    fireEvent.click(screen.getByText('Add Card'));

    await waitFor(() => {
      expect(defaultProps.onCreateCard).toHaveBeenCalledWith(1, 'New Card');
    });
  });

  it('shows delete button', () => {
    render(<Column {...defaultProps} />);

    expect(screen.getByLabelText('Delete column')).toBeInTheDocument();
  });

  it('shows delete confirmation when delete is clicked', () => {
    render(<Column {...defaultProps} />);

    fireEvent.click(screen.getByLabelText('Delete column'));

    expect(screen.getByLabelText('Confirm delete column')).toBeInTheDocument();
    expect(screen.getByLabelText('Cancel delete')).toBeInTheDocument();
  });

  it('deletes column when confirmed', async () => {
    defaultProps.onDelete.mockResolvedValue();
    render(<Column {...defaultProps} />);

    fireEvent.click(screen.getByLabelText('Delete column'));
    fireEvent.click(screen.getByLabelText('Confirm delete column'));

    await waitFor(() => {
      expect(defaultProps.onDelete).toHaveBeenCalledWith(1);
    });
  });

  it('cancels delete when cancel is clicked', () => {
    render(<Column {...defaultProps} />);

    fireEvent.click(screen.getByLabelText('Delete column'));
    fireEvent.click(screen.getByLabelText('Cancel delete'));

    expect(screen.getByLabelText('Delete column')).toBeInTheDocument();
  });

  it('calls onCardClick when a card is clicked', () => {
    render(<Column {...defaultProps} />);

    fireEvent.click(screen.getByText('Card 1'));

    expect(defaultProps.onCardClick).toHaveBeenCalledWith(mockColumn.cards[0]);
  });

  it('applies drop-target class when isDropTarget is true', () => {
    render(<Column {...defaultProps} isDropTarget={true} />);

    const columnContent = screen.getByRole('list');
    expect(columnContent).toHaveClass('drop-target');
  });

  it('has correct ARIA labels', () => {
    render(<Column {...defaultProps} />);

    expect(screen.getByRole('list', { name: 'Cards in To Do' })).toBeInTheDocument();
  });

  it('updates column name on blur', async () => {
    render(<Column {...defaultProps} />);

    const nameInput = screen.getByDisplayValue('To Do');
    fireEvent.focus(nameInput);
    fireEvent.change(nameInput, { target: { value: 'Updated Name' } });
    fireEvent.blur(nameInput);

    await waitFor(() => {
      expect(defaultProps.onUpdateName).toHaveBeenCalledWith(1, { name: 'Updated Name' });
    });
  });
});
