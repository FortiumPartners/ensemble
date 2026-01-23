import React, { useCallback, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';

const columnDefs = [
  {
    field: 'title',
    headerName: 'Task',
    filter: true,
    sortable: true,
    checkboxSelection: true,
    headerCheckboxSelection: true,
  },
  {
    field: 'board_name',
    headerName: 'Board',
    filter: true,
    sortable: true,
  },
  {
    field: 'column_name',
    headerName: 'Status',
    filter: true,
    sortable: true,
  },
  {
    field: 'created_at',
    headerName: 'Created',
    sortable: true,
    valueFormatter: (params) =>
      params.value ? new Date(params.value).toLocaleDateString() : '',
  },
  {
    field: 'updated_at',
    headerName: 'Updated',
    sortable: true,
    valueFormatter: (params) =>
      params.value ? new Date(params.value).toLocaleDateString() : '',
  },
];

const defaultColDef = {
  flex: 1,
  minWidth: 100,
  resizable: true,
};

function TasksGrid({ tasks, onExport }) {
  const gridRef = useRef(null);

  const handleExport = useCallback(() => {
    if (gridRef.current?.api) {
      gridRef.current.api.exportDataAsCsv({
        fileName: 'tasks.csv',
      });
    }
  }, []);

  return (
    <div className="tasks-grid" data-testid="tasks-grid">
      <div className="tasks-grid-header">
        <h3>All Tasks</h3>
        <button className="btn btn-secondary" onClick={handleExport}>
          Export CSV
        </button>
      </div>
      <div className="ag-theme-alpine tasks-grid-container">
        <AgGridReact
          ref={gridRef}
          rowData={tasks}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          pagination={true}
          paginationPageSize={50}
          rowSelection="multiple"
          suppressRowClickSelection={true}
          animateRows={true}
        />
      </div>
    </div>
  );
}

export default TasksGrid;
