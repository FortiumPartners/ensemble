# Kanban Task Board - Full-Stack Application

## Overview

Build a full-stack Kanban task management application with a React frontend, Node.js Express backend, and PostgreSQL database. The application allows users to create boards, organize tasks into columns, and drag-and-drop cards between columns.

## Technology Stack

- **Frontend**: React 18 with functional components and hooks
- **Backend**: Node.js with Express
- **Database**: PostgreSQL
- **Data Grid**: AG Grid Community for reporting views
- **Testing**: Jest for both frontend and backend
- **Container**: Docker Compose for local development

## Features

### Core Features

1. **Boards** - Create, view, update, and delete boards
2. **Columns** - Add columns to boards (e.g., "To Do", "In Progress", "Done")
3. **Cards** - Create task cards with title and description
4. **Drag-and-Drop** - Move cards between columns and reorder within columns
5. **Persistence** - All data stored in PostgreSQL
6. **Reports** - Analytics dashboard with AG Grid for task reporting and metrics

### User Stories

As a user, I want to:
- Create a new board with a name
- Add columns to organize my tasks
- Create cards in any column
- Edit card details (title, description)
- Drag cards between columns to update status
- Reorder cards within a column by priority
- Delete cards I no longer need
- Delete columns (with all contained cards)
- Delete entire boards when projects are complete
- View a reports dashboard showing all tasks across boards
- Filter and sort tasks in a data grid by status, board, date
- Export task data to CSV from the reports view
- See summary metrics (total cards, cards per status, cards per board)

## Architecture

### File Structure

```
kanban-board/
├── docker-compose.yml
├── backend/
│   ├── package.json
│   ├── .env.example
│   ├── src/
│   │   ├── index.js              # Express app entry point
│   │   ├── routes/
│   │   │   ├── boards.js         # Board CRUD routes
│   │   │   ├── columns.js        # Column CRUD routes
│   │   │   └── cards.js          # Card CRUD + move routes
│   │   ├── models/
│   │   │   ├── Board.js          # Board model/queries
│   │   │   ├── Column.js         # Column model/queries
│   │   │   └── Card.js           # Card model/queries
│   │   ├── db/
│   │   │   ├── index.js          # Database connection pool
│   │   │   └── migrations/
│   │   │       └── 001_initial.sql
│   │   └── middleware/
│   │       └── errorHandler.js   # Centralized error handling
│   └── tests/
│       ├── boards.test.js
│       ├── columns.test.js
│       └── cards.test.js
└── frontend/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    ├── src/
    │   ├── main.jsx
    │   ├── App.jsx
    │   ├── components/
    │   │   ├── Board.jsx         # Main board container
    │   │   ├── Column.jsx        # Column with card list
    │   │   ├── Card.jsx          # Draggable card
    │   │   ├── CardModal.jsx     # Card edit modal
    │   │   ├── AddCardForm.jsx   # Quick add card form
    │   │   └── reports/
    │   │       ├── ReportsDashboard.jsx  # Reports main view
    │   │       ├── TasksGrid.jsx         # AG Grid task table
    │   │       └── MetricsSummary.jsx    # Summary cards
    │   ├── hooks/
    │   │   ├── useBoard.js       # Board state management
    │   │   ├── useApi.js         # API fetch wrapper
    │   │   ├── useDragDrop.js    # Drag-and-drop logic
    │   │   └── useReports.js     # Reports data fetching
    │   └── styles/
    │       ├── kanban.css
    │       └── reports.css
    └── tests/
        ├── Board.test.jsx
        └── Card.test.jsx
```

## Database Schema

### Tables

```sql
-- boards: Top-level organization unit
CREATE TABLE boards (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- columns: Belongs to a board, holds cards
CREATE TABLE columns (
    id SERIAL PRIMARY KEY,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    position FLOAT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- cards: Belongs to a column
CREATE TABLE cards (
    id SERIAL PRIMARY KEY,
    column_id INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    position FLOAT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_columns_board_id ON columns(board_id);
CREATE INDEX idx_columns_position ON columns(board_id, position);
CREATE INDEX idx_cards_column_id ON cards(column_id);
CREATE INDEX idx_cards_position ON cards(column_id, position);
```

### Position Management

Use fractional indexing for card/column ordering:

- **New item at end**: `position = last_position + 1024`
- **Insert between items**: `position = (prev_position + next_position) / 2`
- **First item**: `position = 1024`
- **Rebalance threshold**: When positions get too close (diff < 1), rebalance all positions in the container

## API Specification

### Base URL

`http://localhost:3001/api`

### Endpoints

#### Boards

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| GET | /boards | List all boards | - | `[{id, name, created_at}]` |
| POST | /boards | Create board | `{name}` | `{id, name, created_at}` |
| GET | /boards/:id | Get board with columns and cards | - | `{id, name, columns: [{..., cards: [...]}]}` |
| PUT | /boards/:id | Update board | `{name}` | `{id, name, updated_at}` |
| DELETE | /boards/:id | Delete board | - | `204 No Content` |

#### Columns

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| POST | /boards/:boardId/columns | Create column | `{name}` | `{id, name, position}` |
| PUT | /columns/:id | Update column | `{name?, position?}` | `{id, name, position}` |
| DELETE | /columns/:id | Delete column | - | `204 No Content` |

#### Cards

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| POST | /columns/:columnId/cards | Create card | `{title, description?}` | `{id, title, description, position}` |
| PUT | /cards/:id | Update card | `{title?, description?}` | `{id, title, description, updated_at}` |
| DELETE | /cards/:id | Delete card | - | `204 No Content` |
| PATCH | /cards/:id/move | Move card | `{columnId, position}` | `{id, column_id, position}` |

#### Reports

| Method | Endpoint | Description | Query Params | Response |
|--------|----------|-------------|--------------|----------|
| GET | /reports/tasks | All tasks with board/column info | `boardId?, status?, sortBy?, sortOrder?` | `[{id, title, board_name, column_name, created_at, updated_at}]` |
| GET | /reports/metrics | Aggregated metrics | `boardId?` | `{total_cards, by_status: {...}, by_board: {...}}` |
| GET | /reports/export | Export tasks as CSV | `boardId?, status?` | CSV file download |

### Error Responses

```json
{
    "error": {
        "code": "NOT_FOUND",
        "message": "Board with id 999 not found"
    }
}
```

| Status | Code | Description |
|--------|------|-------------|
| 400 | VALIDATION_ERROR | Invalid request body |
| 404 | NOT_FOUND | Resource doesn't exist |
| 409 | CONFLICT | Duplicate or constraint violation |
| 500 | INTERNAL_ERROR | Server error |

## Frontend Requirements

### Components

#### Board.jsx
- Fetches board data on mount using `useBoard` hook
- Renders columns in horizontal layout
- Provides drag-and-drop context for cards
- Handles column creation via "Add Column" button

#### Column.jsx
- Displays column name with edit capability
- Lists cards sorted by position
- Acts as drop zone for dragged cards
- Shows "Add Card" form at bottom
- Shows card count badge

#### Card.jsx
- Displays card title (truncated if long)
- Draggable element with drag handle
- Click opens CardModal for editing
- Shows visual feedback when dragging

#### CardModal.jsx
- Overlay modal for card editing
- Title input field
- Description textarea
- Delete button with confirmation
- Close on Escape key or outside click
- Save on blur or Enter

#### AddCardForm.jsx
- Inline form in column
- Title input with placeholder
- Submit on Enter key
- Cancel on Escape key
- Auto-focus when opened

### Reports Components (AG Grid)

#### ReportsDashboard.jsx
- Main reports view with navigation tabs
- Contains MetricsSummary and TasksGrid
- Board filter dropdown
- Export button triggering CSV download

#### TasksGrid.jsx
- Uses AG Grid Community Edition (`ag-grid-react`)
- Displays all tasks with columns:
  - Title (sortable, filterable)
  - Board Name (sortable, filterable)
  - Column/Status (sortable, filterable)
  - Created Date (sortable)
  - Updated Date (sortable)
- Features required:
  - Column sorting (click header)
  - Column filtering (filter row)
  - Pagination (50 rows per page)
  - Row selection (checkbox column)
  - CSV export via AG Grid API

AG Grid Configuration:
```javascript
const columnDefs = [
  { field: 'title', headerName: 'Task', filter: true, sortable: true },
  { field: 'board_name', headerName: 'Board', filter: true, sortable: true },
  { field: 'column_name', headerName: 'Status', filter: true, sortable: true },
  { field: 'created_at', headerName: 'Created', sortable: true,
    valueFormatter: params => new Date(params.value).toLocaleDateString() },
  { field: 'updated_at', headerName: 'Updated', sortable: true,
    valueFormatter: params => new Date(params.value).toLocaleDateString() },
];

const defaultColDef = {
  flex: 1,
  minWidth: 100,
  resizable: true,
};
```

#### MetricsSummary.jsx
- Summary cards showing:
  - Total tasks count
  - Tasks by status (To Do, In Progress, Done)
  - Tasks by board (top 5 boards)
- Simple card layout, no AG Grid

### Hooks

#### useBoard(boardId)
```javascript
const { board, loading, error, actions } = useBoard(boardId);

// actions:
// - createColumn(name)
// - updateColumn(columnId, updates)
// - deleteColumn(columnId)
// - createCard(columnId, title, description)
// - updateCard(cardId, updates)
// - deleteCard(cardId)
// - moveCard(cardId, targetColumnId, targetPosition)
```

#### useApi()
```javascript
const { get, post, put, patch, del } = useApi();

// All methods return Promise
// Handle errors consistently
// Include loading states
```

#### useDragDrop()
```javascript
const { isDragging, draggedItem, handlers } = useDragDrop({
    onDragStart,
    onDragEnd,
    onDrop
});
```

#### useReports()
```javascript
const { tasks, metrics, loading, error, refetch } = useReports({
    boardId,  // optional filter
    status,   // optional filter
});

// tasks: Array of task objects with board/column info
// metrics: { total_cards, by_status, by_board }
```

### Styling Requirements

- **Layout**: CSS Grid for board, Flexbox for columns
- **Colors**: Neutral background, card shadows, accent for actions
- **Responsive**: Columns scroll horizontally on narrow screens
- **States**: Hover effects on cards, drag preview, drop zone highlight
- **Typography**: Clear hierarchy for board/column/card titles

Example CSS structure:
```css
.board {
    display: flex;
    gap: 16px;
    padding: 16px;
    min-height: calc(100vh - 64px);
    overflow-x: auto;
}

.column {
    flex: 0 0 280px;
    background: #f4f5f7;
    border-radius: 8px;
    padding: 12px;
}

.card {
    background: white;
    border-radius: 4px;
    padding: 12px;
    margin-bottom: 8px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.12);
    cursor: grab;
}

.card.dragging {
    opacity: 0.5;
    transform: rotate(3deg);
}

.column.drop-target {
    background: #e3f2fd;
}
```

## Docker Configuration

### docker-compose.yml

```yaml
version: '3.8'

services:
  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: kanban
      POSTGRES_PASSWORD: kanban
      POSTGRES_DB: kanban
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./backend/src/db/migrations:/docker-entrypoint-initdb.d

  backend:
    build: ./backend
    ports:
      - "3001:3001"
    environment:
      DATABASE_URL: postgres://kanban:kanban@db:5432/kanban
      PORT: 3001
    depends_on:
      - db
    volumes:
      - ./backend/src:/app/src

  frontend:
    build: ./frontend
    ports:
      - "5173:5173"
    environment:
      VITE_API_URL: http://localhost:3001/api
    depends_on:
      - backend
    volumes:
      - ./frontend/src:/app/src

volumes:
  postgres_data:
```

## Testing Requirements

### Backend Tests

- Test all CRUD operations for boards, columns, cards
- Test card move operation with position updates
- Test cascade deletes (board -> columns -> cards)
- Test validation errors (missing required fields)
- Test not found errors (invalid IDs)
- Use test database or mocking
- Target: **80%+ coverage**

### Frontend Tests

- Test component rendering
- Test user interactions (click, type, drag)
- Test API integration with mocked responses
- Test error states
- Test loading states
- Use React Testing Library
- Target: **70%+ coverage**

## Success Criteria

1. **Functional**: All CRUD operations work end-to-end
2. **Drag-and-Drop**: Cards can be moved between columns smoothly
3. **Position Persistence**: Card order persists after page refresh
4. **Error Handling**: Graceful handling of API errors
5. **Tests**: Backend 80%+, Frontend 70%+ coverage
6. **Architecture**: Clean separation of concerns
7. **Code Quality**: Consistent patterns, no major code smells
8. **Reports**: AG Grid displays tasks with sorting, filtering, and export
9. **Metrics**: Summary dashboard shows accurate aggregated data

## Example Usage Flow

1. Start services: `docker-compose up`
2. Open browser: `http://localhost:5173`
3. Create a board: "Project Alpha"
4. Add columns: "Backlog", "In Progress", "Done"
5. Add cards to Backlog: "Design mockups", "Setup CI", "Write docs"
6. Drag "Setup CI" to "In Progress"
7. Edit card: Add description "Configure GitHub Actions"
8. Drag "Setup CI" to "Done" when complete
9. Delete completed cards or archive board

### Reports Usage Flow

1. Navigate to Reports tab
2. View metrics summary (total tasks, by status, by board)
3. Use AG Grid to filter tasks by board or status
4. Sort by created date to see oldest tasks
5. Select multiple rows and export to CSV
6. Use the grid's built-in column filters for quick searches
