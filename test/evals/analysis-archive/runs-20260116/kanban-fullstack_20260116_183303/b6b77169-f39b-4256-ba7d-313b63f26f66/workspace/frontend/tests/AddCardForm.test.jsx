import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AddCardForm from '../src/components/AddCardForm';

describe('AddCardForm', () => {
  const defaultProps = {
    onSubmit: jest.fn(),
    onCancel: jest.fn(),
    isOpen: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders when isOpen is true', () => {
    render(<AddCardForm {...defaultProps} />);

    expect(screen.getByRole('form')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    render(<AddCardForm {...defaultProps} isOpen={false} />);

    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });

  it('focuses input when opened', () => {
    render(<AddCardForm {...defaultProps} />);

    expect(screen.getByPlaceholderText('Enter card title...')).toHaveFocus();
  });

  it('calls onSubmit with title when form is submitted', async () => {
    defaultProps.onSubmit.mockResolvedValue();
    render(<AddCardForm {...defaultProps} />);

    fireEvent.change(screen.getByPlaceholderText('Enter card title...'), {
      target: { value: 'New Card' },
    });
    fireEvent.click(screen.getByText('Add Card'));

    await waitFor(() => {
      expect(defaultProps.onSubmit).toHaveBeenCalledWith('New Card');
    });
  });

  it('trims whitespace from title', async () => {
    defaultProps.onSubmit.mockResolvedValue();
    render(<AddCardForm {...defaultProps} />);

    fireEvent.change(screen.getByPlaceholderText('Enter card title...'), {
      target: { value: '  Trimmed Title  ' },
    });
    fireEvent.click(screen.getByText('Add Card'));

    await waitFor(() => {
      expect(defaultProps.onSubmit).toHaveBeenCalledWith('Trimmed Title');
    });
  });

  it('does not submit empty title', async () => {
    render(<AddCardForm {...defaultProps} />);

    fireEvent.click(screen.getByText('Add Card'));

    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
  });

  it('calls onCancel when Cancel is clicked', () => {
    render(<AddCardForm {...defaultProps} />);

    fireEvent.click(screen.getByText('Cancel'));

    expect(defaultProps.onCancel).toHaveBeenCalled();
  });

  it('calls onCancel when Escape is pressed', () => {
    render(<AddCardForm {...defaultProps} />);

    fireEvent.keyDown(screen.getByPlaceholderText('Enter card title...'), {
      key: 'Escape',
    });

    expect(defaultProps.onCancel).toHaveBeenCalled();
  });

  it('disables Add Card button when title is empty', () => {
    render(<AddCardForm {...defaultProps} />);

    expect(screen.getByText('Add Card')).toBeDisabled();
  });

  it('enables Add Card button when title is entered', () => {
    render(<AddCardForm {...defaultProps} />);

    fireEvent.change(screen.getByPlaceholderText('Enter card title...'), {
      target: { value: 'New Card' },
    });

    expect(screen.getByText('Add Card')).not.toBeDisabled();
  });

  it('clears input after successful submission', async () => {
    defaultProps.onSubmit.mockResolvedValue();
    render(<AddCardForm {...defaultProps} />);

    const input = screen.getByPlaceholderText('Enter card title...');
    fireEvent.change(input, { target: { value: 'New Card' } });
    fireEvent.click(screen.getByText('Add Card'));

    await waitFor(() => {
      expect(input.value).toBe('');
    });
  });

  it('shows adding state during submission', async () => {
    let resolveSubmit;
    defaultProps.onSubmit.mockImplementation(
      () => new Promise((resolve) => { resolveSubmit = resolve; })
    );
    render(<AddCardForm {...defaultProps} />);

    fireEvent.change(screen.getByPlaceholderText('Enter card title...'), {
      target: { value: 'New Card' },
    });
    fireEvent.click(screen.getByText('Add Card'));

    expect(screen.getByText('Adding...')).toBeInTheDocument();

    resolveSubmit();
    await waitFor(() => {
      expect(screen.getByText('Add Card')).toBeInTheDocument();
    });
  });

  it('has correct aria-label', () => {
    render(<AddCardForm {...defaultProps} />);

    expect(screen.getByRole('form')).toHaveAttribute('aria-label', 'Add new card');
  });
});
