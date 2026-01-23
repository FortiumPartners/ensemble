import { useRef, useCallback, useMemo, memo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';

/**
 * Status badge cell renderer for AG Grid
 */
const StatusCellRenderer = ({ value }) => {
  if (!value) return null;

  // Determine status class based on column name
  const statusClass = (() => {
    const lowerValue = value.toLowerCase();
    if (lowerValue.includes('done') || lowerValue.includes('complete')) return 'done';
    if (lowerValue.includes('progress') || lowerValue.includes('doing')) return 'progress';
    if (lowerValue.includes('todo') || lowerValue.includes('backlog')) return 'todo';
    return '';
  })();

  return (
    <span className={`grid-status-badge ${statusClass}`}>
      {value}
    </span>
  );
};

/**
 * Date cell renderer for AG Grid
 */
const DateCellRenderer = ({ value }) => {
  if (!value) return '-';

  const date = new Date(value);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

/**
 * AG Grid component for displaying task list
 *
 * Features:
 * - Sortable columns
 * - Filterable columns
 * - Pagination
 * - Row selection
 * - CSV export
 *
 * @param {Object} props
 * @param {Array} props.tasks - Array of task objects
 * @param {boolean} props.loading - Whether data is loading
 * @param {Function} props.onExport - Handler for CSV export
 */
function TasksGrid({ tasks, loading, onExport }) {
  const gridRef = useRef(null);

  /**
   * Column definitions for AG Grid
   */
  const columnDefs = useMemo(() => [
    {
      field: 'title',
      headerName: 'Task',
      filter: 'agTextColumnFilter',
      sortable: true,
      flex: 2,
      minWidth: 200,
      cellStyle: { fontWeight: 500 },
    },
    {
      field: 'board_name',
      headerName: 'Board',
      filter: 'agTextColumnFilter',
      sortable: true,
      flex: 1,
      minWidth: 120,
    },
    {
      field: 'column_name',
      headerName: 'Status',
      filter: 'agTextColumnFilter',
      sortable: true,
      flex: 1,
      minWidth: 120,
      cellRenderer: StatusCellRenderer,
    },
    {
      field: 'created_at',
      headerName: 'Created',
      sortable: true,
      flex: 1,
      minWidth: 120,
      cellRenderer: DateCellRenderer,
      comparator: (valueA, valueB) => {
        const dateA = valueA ? new Date(valueA).getTime() : 0;
        const dateB = valueB ? new Date(valueB).getTime() : 0;
        return dateA - dateB;
      },
    },
    {
      field: 'updated_at',
      headerName: 'Updated',
      sortable: true,
      flex: 1,
      minWidth: 120,
      cellRenderer: DateCellRenderer,
      comparator: (valueA, valueB) => {
        const dateA = valueA ? new Date(valueA).getTime() : 0;
        const dateB = valueB ? new Date(valueB).getTime() : 0;
        return dateA - dateB;
      },
    },
  ], []);

  /**
   * Default column configuration
   */
  const defaultColDef = useMemo(() => ({
    flex: 1,
    minWidth: 100,
    resizable: true,
    filter: true,
    floatingFilter: true,
  }), []);

  /**
   * Handle CSV export via AG Grid API
   */
  const handleExport = useCallback(() => {
    if (gridRef.current?.api) {
      gridRef.current.api.exportDataAsCsv({
        fileName: `kanban-tasks-${new Date().toISOString().split('T')[0]}.csv`,
        columnKeys: ['title', 'board_name', 'column_name', 'created_at', 'updated_at'],
      });
    }
  }, []);

  /**
   * Handle grid ready event
   */
  const onGridReady = useCallback((params) => {
    // Auto-size columns on first load
    params.api.sizeColumnsToFit();
  }, []);

  /**
   * Pagination settings
   */
  const paginationPageSize = 50;
  const paginationPageSizeSelector = [25, 50, 100];

  return (
    <div className="tasks-grid-container">
      {/* Grid Header */}
      <header className="tasks-grid-header">
        <h3>All Tasks</h3>
        <div className="tasks-grid-actions">
          <span className="text-muted" style={{ marginRight: 'var(--space-2)' }}>
            {tasks?.length || 0} task{tasks?.length !== 1 ? 's' : ''}
          </span>
          <button
            type="button"
            className="btn btn-secondary export-button"
            onClick={onExport || handleExport}
            disabled={!tasks?.length}
            aria-label="Export to CSV"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2.75 14A1.75 1.75 0 011 12.25v-2.5a.75.75 0 011.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 00.25-.25v-2.5a.75.75 0 011.5 0v2.5A1.75 1.75 0 0113.25 14H2.75z" />
              <path d="M7.25 7.689V2a.75.75 0 011.5 0v5.689l1.97-1.969a.749.749 0 111.06 1.06l-3.25 3.25a.749.749 0 01-1.06 0L4.22 6.78a.749.749 0 111.06-1.06l1.97 1.969z" />
            </svg>
            Export CSV
          </button>
        </div>
      </header>

      {/* AG Grid */}
      <div
        className="ag-theme-alpine-dark"
        style={{ height: '500px', width: '100%' }}
        role="grid"
        aria-label="Tasks table"
      >
        {loading ? (
          <div className="loading" style={{ height: '100%' }}>
            <div className="loading-spinner" aria-hidden="true"></div>
            <span className="sr-only">Loading tasks...</span>
          </div>
        ) : (
          <AgGridReact
            ref={gridRef}
            rowData={tasks || []}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            onGridReady={onGridReady}
            pagination={true}
            paginationPageSize={paginationPageSize}
            paginationPageSizeSelector={paginationPageSizeSelector}
            rowSelection="multiple"
            suppressRowClickSelection={true}
            animateRows={true}
            enableCellTextSelection={true}
            ensureDomOrder={true}
            domLayout="normal"
            overlayNoRowsTemplate='<span class="text-muted">No tasks found</span>'
          />
        )}
      </div>
    </div>
  );
}

export default memo(TasksGrid);
