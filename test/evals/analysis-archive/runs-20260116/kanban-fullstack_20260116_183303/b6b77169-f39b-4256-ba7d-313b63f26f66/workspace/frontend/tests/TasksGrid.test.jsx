import { render, screen, fireEvent } from '@testing-library/react';
import TasksGrid from '../src/components/reports/TasksGrid';

// Mock AG Grid
jest.mock('ag-grid-react', () => ({
  AgGridReact: jest.fn(({ rowData, onGridReady, overlayNoRowsTemplate }) => {
    // Simulate calling onGridReady
    if (onGridReady) {
      setTimeout(() => {
        onGridReady({
          api: {
            sizeColumnsToFit: jest.fn(),
            exportDataAsCsv: jest.fn(),
          },
        });
      }, 0);
    }

    return (
      <div data-testid="ag-grid-mock">
        {rowData?.length === 0 && (
          <span dangerouslySetInnerHTML={{ __html: overlayNoRowsTemplate }} />
        )}
        {rowData?.map((row, i) => (
          <div key={row.id || i} data-testid={`grid-row-${i}`}>
            {row.title}
          </div>
        ))}
      </div>
    );
  }),
}));

describe('TasksGrid', () => {
  const mockTasks = [
    {
      id: 1,
      title: 'Task 1',
      board_name: 'Board 1',
      column_name: 'To Do',
      created_at: '2024-01-15T10:00:00Z',
      updated_at: '2024-01-15T10:00:00Z',
    },
    {
      id: 2,
      title: 'Task 2',
      board_name: 'Board 1',
      column_name: 'Done',
      created_at: '2024-01-16T10:00:00Z',
      updated_at: '2024-01-17T10:00:00Z',
    },
    {
      id: 3,
      title: 'Task 3',
      board_name: 'Board 2',
      column_name: 'In Progress',
      created_at: '2024-01-17T10:00:00Z',
      updated_at: '2024-01-17T10:00:00Z',
    },
  ];

  const defaultProps = {
    tasks: mockTasks,
    loading: false,
    onExport: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the grid header', () => {
    render(<TasksGrid {...defaultProps} />);

    expect(screen.getByText('All Tasks')).toBeInTheDocument();
  });

  it('displays task count', () => {
    render(<TasksGrid {...defaultProps} />);

    expect(screen.getByText('3 tasks')).toBeInTheDocument();
  });

  it('displays singular task when count is 1', () => {
    render(<TasksGrid {...defaultProps} tasks={[mockTasks[0]]} />);

    expect(screen.getByText('1 task')).toBeInTheDocument();
  });

  it('displays 0 tasks when tasks is empty', () => {
    render(<TasksGrid {...defaultProps} tasks={[]} />);

    expect(screen.getByText('0 tasks')).toBeInTheDocument();
  });

  it('displays 0 tasks when tasks is null', () => {
    render(<TasksGrid {...defaultProps} tasks={null} />);

    expect(screen.getByText('0 tasks')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(<TasksGrid {...defaultProps} loading={true} />);

    expect(screen.getByText('Loading tasks...')).toBeInTheDocument();
  });

  it('renders export button', () => {
    render(<TasksGrid {...defaultProps} />);

    expect(screen.getByLabelText('Export to CSV')).toBeInTheDocument();
  });

  it('calls onExport when export button is clicked', () => {
    render(<TasksGrid {...defaultProps} />);

    fireEvent.click(screen.getByLabelText('Export to CSV'));

    expect(defaultProps.onExport).toHaveBeenCalled();
  });

  it('disables export button when no tasks', () => {
    render(<TasksGrid {...defaultProps} tasks={[]} />);

    expect(screen.getByLabelText('Export to CSV')).toBeDisabled();
  });

  it('has proper ARIA label for grid container', () => {
    render(<TasksGrid {...defaultProps} />);

    expect(screen.getByRole('grid', { name: 'Tasks table' })).toBeInTheDocument();
  });

  it('renders AG Grid component', () => {
    render(<TasksGrid {...defaultProps} />);

    expect(screen.getByTestId('ag-grid-mock')).toBeInTheDocument();
  });

  it('renders task data in grid', () => {
    render(<TasksGrid {...defaultProps} />);

    expect(screen.getByTestId('grid-row-0')).toHaveTextContent('Task 1');
    expect(screen.getByTestId('grid-row-1')).toHaveTextContent('Task 2');
    expect(screen.getByTestId('grid-row-2')).toHaveTextContent('Task 3');
  });
});

// Test the cell renderers separately
describe('StatusCellRenderer', () => {
  // Import the actual module to test cell renderers
  const TasksGridModule = jest.requireActual('../src/components/reports/TasksGrid');

  // Since cell renderers are internal, we test through the component
  // The StatusCellRenderer determines class based on column_name value

  it('handles status values in grid display', () => {
    const tasks = [
      { id: 1, title: 'Done Task', column_name: 'Done' },
      { id: 2, title: 'In Progress Task', column_name: 'In Progress' },
      { id: 3, title: 'To Do Task', column_name: 'To Do' },
      { id: 4, title: 'Backlog Task', column_name: 'Backlog' },
      { id: 5, title: 'Other Task', column_name: 'Custom Status' },
    ];

    render(<TasksGrid tasks={tasks} loading={false} />);

    // Grid should render without crashing
    expect(screen.getByTestId('ag-grid-mock')).toBeInTheDocument();
  });
});

describe('DateCellRenderer', () => {
  it('handles date values in grid display', () => {
    const tasks = [
      { id: 1, title: 'Task with date', created_at: '2024-01-15T10:00:00Z' },
      { id: 2, title: 'Task without date', created_at: null },
    ];

    render(<TasksGrid tasks={tasks} loading={false} />);

    // Grid should render without crashing
    expect(screen.getByTestId('ag-grid-mock')).toBeInTheDocument();
  });
});
