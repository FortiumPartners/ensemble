import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Card from '../src/components/Card';
import CardModal from '../src/components/CardModal';
import AddCardForm from '../src/components/AddCardForm';

describe('Card Component', () => {
  const mockCard = {
    id: 1,
    title: 'Test Task',
    description: 'Test description',
    position: 1024,
  };

  const mockHandlers = {
    onDragStart: jest.fn(),
    onDragEnd: jest.fn(),
    onClick: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render card with title', () => {
    render(
      <Card
        card={mockCard}
        columnId={1}
        onDragStart={mockHandlers.onDragStart}
        onDragEnd={mockHandlers.onDragEnd}
        onClick={mockHandlers.onClick}
        isDragging={false}
      />
    );

    expect(screen.getByText('Test Task')).toBeInTheDocument();
  });

  it('should render card with description', () => {
    render(
      <Card
        card={mockCard}
        columnId={1}
        onDragStart={mockHandlers.onDragStart}
        onDragEnd={mockHandlers.onDragEnd}
        onClick={mockHandlers.onClick}
        isDragging={false}
      />
    );

    expect(screen.getByText('Test description')).toBeInTheDocument();
  });

  it('should not render description if not provided', () => {
    const cardWithoutDesc = { ...mockCard, description: null };

    render(
      <Card
        card={cardWithoutDesc}
        columnId={1}
        onDragStart={mockHandlers.onDragStart}
        onDragEnd={mockHandlers.onDragEnd}
        onClick={mockHandlers.onClick}
        isDragging={false}
      />
    );

    expect(screen.queryByText('Test description')).not.toBeInTheDocument();
  });

  it('should call onClick when clicked', () => {
    render(
      <Card
        card={mockCard}
        columnId={1}
        onDragStart={mockHandlers.onDragStart}
        onDragEnd={mockHandlers.onDragEnd}
        onClick={mockHandlers.onClick}
        isDragging={false}
      />
    );

    fireEvent.click(screen.getByTestId('card-1'));
    expect(mockHandlers.onClick).toHaveBeenCalledWith(mockCard);
  });

  it('should have dragging class when isDragging is true', () => {
    render(
      <Card
        card={mockCard}
        columnId={1}
        onDragStart={mockHandlers.onDragStart}
        onDragEnd={mockHandlers.onDragEnd}
        onClick={mockHandlers.onClick}
        isDragging={true}
      />
    );

    const card = screen.getByTestId('card-1');
    expect(card).toHaveClass('dragging');
  });

  it('should be draggable', () => {
    render(
      <Card
        card={mockCard}
        columnId={1}
        onDragStart={mockHandlers.onDragStart}
        onDragEnd={mockHandlers.onDragEnd}
        onClick={mockHandlers.onClick}
        isDragging={false}
      />
    );

    const card = screen.getByTestId('card-1');
    expect(card).toHaveAttribute('draggable', 'true');
  });
});

describe('CardModal Component', () => {
  const mockCard = {
    id: 1,
    title: 'Test Task',
    description: 'Test description',
  };

  const mockHandlers = {
    onSave: jest.fn(),
    onDelete: jest.fn(),
    onClose: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render modal with card data', () => {
    render(
      <CardModal
        card={mockCard}
        onSave={mockHandlers.onSave}
        onDelete={mockHandlers.onDelete}
        onClose={mockHandlers.onClose}
      />
    );

    expect(screen.getByDisplayValue('Test Task')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Test description')).toBeInTheDocument();
  });

  it('should call onClose when overlay clicked', () => {
    render(
      <CardModal
        card={mockCard}
        onSave={mockHandlers.onSave}
        onDelete={mockHandlers.onDelete}
        onClose={mockHandlers.onClose}
      />
    );

    fireEvent.click(screen.getByTestId('card-modal'));
    expect(mockHandlers.onClose).toHaveBeenCalled();
  });

  it('should call onClose when close button clicked', () => {
    render(
      <CardModal
        card={mockCard}
        onSave={mockHandlers.onSave}
        onDelete={mockHandlers.onDelete}
        onClose={mockHandlers.onClose}
      />
    );

    fireEvent.click(screen.getByLabelText('Close'));
    expect(mockHandlers.onClose).toHaveBeenCalled();
  });

  it('should update title input', () => {
    render(
      <CardModal
        card={mockCard}
        onSave={mockHandlers.onSave}
        onDelete={mockHandlers.onDelete}
        onClose={mockHandlers.onClose}
      />
    );

    const input = screen.getByTestId('card-title-input');
    fireEvent.change(input, { target: { value: 'Updated Title' } });
    expect(input).toHaveValue('Updated Title');
  });

  it('should save card when Save button clicked', () => {
    render(
      <CardModal
        card={mockCard}
        onSave={mockHandlers.onSave}
        onDelete={mockHandlers.onDelete}
        onClose={mockHandlers.onClose}
      />
    );

    const titleInput = screen.getByTestId('card-title-input');
    fireEvent.change(titleInput, { target: { value: 'New Title' } });

    fireEvent.click(screen.getByText('Save'));

    expect(mockHandlers.onSave).toHaveBeenCalledWith(1, {
      title: 'New Title',
      description: 'Test description',
    });
  });

  it('should require double click to delete', () => {
    render(
      <CardModal
        card={mockCard}
        onSave={mockHandlers.onSave}
        onDelete={mockHandlers.onDelete}
        onClose={mockHandlers.onClose}
      />
    );

    // First click shows confirmation
    fireEvent.click(screen.getByText('Delete'));
    expect(screen.getByText('Click again to confirm')).toBeInTheDocument();
    expect(mockHandlers.onDelete).not.toHaveBeenCalled();

    // Second click confirms
    fireEvent.click(screen.getByText('Click again to confirm'));
    expect(mockHandlers.onDelete).toHaveBeenCalledWith(1);
  });
});

describe('AddCardForm Component', () => {
  const mockHandlers = {
    onSubmit: jest.fn(),
    onCancel: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render input field', () => {
    render(
      <AddCardForm
        columnId={1}
        onSubmit={mockHandlers.onSubmit}
        onCancel={mockHandlers.onCancel}
      />
    );

    expect(screen.getByTestId('add-card-input')).toBeInTheDocument();
  });

  it('should submit form when enter pressed', () => {
    render(
      <AddCardForm
        columnId={1}
        onSubmit={mockHandlers.onSubmit}
        onCancel={mockHandlers.onCancel}
      />
    );

    const input = screen.getByTestId('add-card-input');
    fireEvent.change(input, { target: { value: 'New Card' } });
    fireEvent.submit(input.closest('form'));

    expect(mockHandlers.onSubmit).toHaveBeenCalledWith(1, 'New Card');
  });

  it('should call onCancel when escape pressed', () => {
    render(
      <AddCardForm
        columnId={1}
        onSubmit={mockHandlers.onSubmit}
        onCancel={mockHandlers.onCancel}
      />
    );

    const input = screen.getByTestId('add-card-input');
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(mockHandlers.onCancel).toHaveBeenCalled();
  });

  it('should not submit when title is empty', () => {
    render(
      <AddCardForm
        columnId={1}
        onSubmit={mockHandlers.onSubmit}
        onCancel={mockHandlers.onCancel}
      />
    );

    const input = screen.getByTestId('add-card-input');
    fireEvent.submit(input.closest('form'));

    expect(mockHandlers.onSubmit).not.toHaveBeenCalled();
  });
});
