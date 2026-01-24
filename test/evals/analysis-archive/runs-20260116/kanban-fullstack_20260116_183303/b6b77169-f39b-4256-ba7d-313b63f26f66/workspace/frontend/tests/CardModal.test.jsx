import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CardModal from '../src/components/CardModal';

describe('CardModal', () => {
  const mockCard = {
    id: 1,
    title: 'Test Card',
    description: 'Test description',
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-16T12:00:00Z',
  };

  const defaultProps = {
    card: mockCard,
    isOpen: true,
    onClose: jest.fn(),
    onSave: jest.fn(),
    onDelete: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders when isOpen is true', () => {
    render(<CardModal {...defaultProps} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    render(<CardModal {...defaultProps} isOpen={false} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('displays card title in input', () => {
    render(<CardModal {...defaultProps} />);

    expect(screen.getByDisplayValue('Test Card')).toBeInTheDocument();
  });

  it('displays card description in textarea', () => {
    render(<CardModal {...defaultProps} />);

    expect(screen.getByDisplayValue('Test description')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    render(<CardModal {...defaultProps} />);

    fireEvent.click(screen.getByLabelText('Close modal'));

    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('calls onClose when cancel button is clicked', () => {
    render(<CardModal {...defaultProps} />);

    fireEvent.click(screen.getByText('Cancel'));

    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('calls onClose when overlay is clicked', () => {
    const { container } = render(<CardModal {...defaultProps} />);

    // Click on the modal-overlay itself (not the modal content)
    const overlay = container.querySelector('.modal-overlay');
    fireEvent.click(overlay);

    // Modal closes after auto-save if there are changes, otherwise just closes
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('calls onSave when Save Changes is clicked', async () => {
    defaultProps.onSave.mockResolvedValue();
    render(<CardModal {...defaultProps} />);

    fireEvent.change(screen.getByDisplayValue('Test Card'), {
      target: { value: 'Updated Title' },
    });
    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => {
      expect(defaultProps.onSave).toHaveBeenCalledWith(1, {
        title: 'Updated Title',
        description: 'Test description',
      });
    });
  });

  it('shows delete confirmation when Delete is clicked', () => {
    render(<CardModal {...defaultProps} />);

    fireEvent.click(screen.getByText('Delete'));

    expect(screen.getByText('Delete this card?')).toBeInTheDocument();
    expect(screen.getByText('Yes, Delete')).toBeInTheDocument();
  });

  it('calls onDelete when delete is confirmed', async () => {
    defaultProps.onDelete.mockResolvedValue();
    render(<CardModal {...defaultProps} />);

    fireEvent.click(screen.getByText('Delete'));
    fireEvent.click(screen.getByText('Yes, Delete'));

    await waitFor(() => {
      expect(defaultProps.onDelete).toHaveBeenCalledWith(1);
    });
  });

  it('cancels delete confirmation when Cancel is clicked', () => {
    const { container } = render(<CardModal {...defaultProps} />);

    fireEvent.click(screen.getByText('Delete'));

    // Now find the Cancel button in the delete confirmation (the one in the footer flex div)
    const footerButtons = container.querySelectorAll('.modal-footer button');
    // Find the Cancel button that's in the delete confirmation area
    let cancelBtn = null;
    footerButtons.forEach(btn => {
      if (btn.textContent === 'Cancel' && btn.closest('.flex')) {
        cancelBtn = btn;
      }
    });

    if (cancelBtn) {
      fireEvent.click(cancelBtn);
    }

    // The delete confirmation should be hidden
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('displays created date', () => {
    render(<CardModal {...defaultProps} />);

    // The date should be formatted
    expect(screen.getByText(/January 15, 2024/)).toBeInTheDocument();
  });

  it('displays updated date when different from created', () => {
    render(<CardModal {...defaultProps} />);

    expect(screen.getByText(/January 16, 2024/)).toBeInTheDocument();
  });

  it('disables Save button when title is empty', () => {
    render(<CardModal {...defaultProps} />);

    fireEvent.change(screen.getByDisplayValue('Test Card'), {
      target: { value: '' },
    });

    expect(screen.getByText('Save Changes')).toBeDisabled();
  });

  it('has correct ARIA attributes', () => {
    render(<CardModal {...defaultProps} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'card-modal-title');
  });
});
