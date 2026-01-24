import { render, screen, fireEvent } from '@testing-library/react';
import Card from '../src/components/Card';

describe('Card', () => {
  const mockCard = {
    id: 1,
    title: 'Test Card',
    description: 'Test description',
    created_at: '2024-01-15T10:00:00Z',
  };

  const defaultProps = {
    card: mockCard,
    onClick: jest.fn(),
    onDragStart: jest.fn(),
    onDragEnd: jest.fn(),
    isDragging: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders card title', () => {
    render(<Card {...defaultProps} />);

    expect(screen.getByText('Test Card')).toBeInTheDocument();
  });

  it('renders card description when provided', () => {
    render(<Card {...defaultProps} />);

    expect(screen.getByText('Test description')).toBeInTheDocument();
  });

  it('does not render description when empty', () => {
    const cardWithoutDescription = { ...mockCard, description: '' };
    render(<Card {...defaultProps} card={cardWithoutDescription} />);

    expect(screen.queryByText('Test description')).not.toBeInTheDocument();
  });

  it('calls onClick when card is clicked', () => {
    render(<Card {...defaultProps} />);

    fireEvent.click(screen.getByRole('button'));

    expect(defaultProps.onClick).toHaveBeenCalledWith(mockCard);
  });

  it('calls onClick when Enter key is pressed', () => {
    render(<Card {...defaultProps} />);

    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });

    expect(defaultProps.onClick).toHaveBeenCalledWith(mockCard);
  });

  it('calls onClick when Space key is pressed', () => {
    render(<Card {...defaultProps} />);

    fireEvent.keyDown(screen.getByRole('button'), { key: ' ' });

    expect(defaultProps.onClick).toHaveBeenCalledWith(mockCard);
  });

  it('calls onDragStart when dragging begins', () => {
    render(<Card {...defaultProps} />);

    fireEvent.dragStart(screen.getByRole('button'));

    expect(defaultProps.onDragStart).toHaveBeenCalled();
  });

  it('calls onDragEnd when dragging ends', () => {
    render(<Card {...defaultProps} />);

    fireEvent.dragEnd(screen.getByRole('button'));

    expect(defaultProps.onDragEnd).toHaveBeenCalled();
  });

  it('applies dragging class when isDragging is true', () => {
    render(<Card {...defaultProps} isDragging={true} />);

    expect(screen.getByRole('button')).toHaveClass('dragging');
  });

  it('does not apply dragging class when isDragging is false', () => {
    render(<Card {...defaultProps} isDragging={false} />);

    expect(screen.getByRole('button')).not.toHaveClass('dragging');
  });

  it('has correct aria-label', () => {
    render(<Card {...defaultProps} />);

    expect(screen.getByRole('button')).toHaveAttribute(
      'aria-label',
      'Card: Test Card. Click to edit.'
    );
  });

  it('is draggable', () => {
    render(<Card {...defaultProps} />);

    expect(screen.getByRole('button')).toHaveAttribute('draggable', 'true');
  });

  it('has correct data-card-id attribute', () => {
    render(<Card {...defaultProps} />);

    expect(screen.getByRole('button')).toHaveAttribute('data-card-id', '1');
  });

  it('formats date correctly', () => {
    render(<Card {...defaultProps} />);

    expect(screen.getByText('Jan 15')).toBeInTheDocument();
  });

  it('handles missing created_at', () => {
    const cardWithoutDate = { ...mockCard, created_at: null };
    render(<Card {...defaultProps} card={cardWithoutDate} />);

    // Should not throw and should render without date
    expect(screen.getByText('Test Card')).toBeInTheDocument();
  });
});
