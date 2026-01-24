import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock the api
jest.mock('../src/hooks/useApi', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    del: jest.fn(),
  },
}));

import BoardList from '../src/components/BoardList';
import { api } from '../src/hooks/useApi';

describe('BoardList', () => {
  const mockBoards = [
    { id: 1, name: 'Board 1', created_at: '2024-01-15T10:00:00Z' },
    { id: 2, name: 'Board 2', created_at: '2024-01-16T10:00:00Z' },
  ];

  const defaultProps = {
    onSelectBoard: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    api.get.mockResolvedValue(mockBoards);
  });

  it('shows loading state initially', () => {
    api.get.mockImplementation(() => new Promise(() => {}));
    render(<BoardList {...defaultProps} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders boards after loading', async () => {
    render(<BoardList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Board 1')).toBeInTheDocument();
      expect(screen.getByText('Board 2')).toBeInTheDocument();
    });
  });

  it('shows error state when fetch fails', async () => {
    api.get.mockRejectedValue({ message: 'Network error' });
    render(<BoardList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load boards')).toBeInTheDocument();
    });
  });

  it('calls onSelectBoard when board is clicked', async () => {
    render(<BoardList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Board 1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Board 1'));

    expect(defaultProps.onSelectBoard).toHaveBeenCalledWith(1);
  });

  it('shows create new board card', async () => {
    render(<BoardList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Create new board')).toBeInTheDocument();
    });
  });

  it('opens create form when create card is clicked', async () => {
    render(<BoardList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Create new board')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Create new board'));

    expect(screen.getByPlaceholderText('Enter board name...')).toBeInTheDocument();
  });

  it('creates board when form is submitted', async () => {
    const newBoard = { id: 3, name: 'New Board', created_at: '2024-01-17T10:00:00Z' };
    api.post.mockResolvedValue(newBoard);

    render(<BoardList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Create new board')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Create new board'));
    fireEvent.change(screen.getByPlaceholderText('Enter board name...'), {
      target: { value: 'New Board' },
    });
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/boards', { name: 'New Board' });
      expect(defaultProps.onSelectBoard).toHaveBeenCalledWith(3);
    });
  });

  it('shows empty state when no boards', async () => {
    api.get.mockResolvedValue([]);
    render(<BoardList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('No boards yet')).toBeInTheDocument();
    });
  });

  it('cancels create form when Cancel is clicked', async () => {
    render(<BoardList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Create new board')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Create new board'));
    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.queryByPlaceholderText('Enter board name...')).not.toBeInTheDocument();
  });

  it('disables Create button when name is empty', async () => {
    render(<BoardList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Create new board')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Create new board'));

    expect(screen.getByText('Create')).toBeDisabled();
  });

  it('formats dates correctly', async () => {
    render(<BoardList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Created Jan 15, 2024')).toBeInTheDocument();
    });
  });
});
