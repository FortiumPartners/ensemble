import { useState, useCallback } from 'react';
import { Board, BoardList, ReportsDashboard } from './components';
import './styles/variables.css';
import './styles/globals.css';
import './styles/kanban.css';
import './styles/reports.css';

/**
 * View types for navigation
 */
const VIEWS = {
  BOARDS: 'boards',
  BOARD: 'board',
  REPORTS: 'reports',
};

/**
 * Main application component
 *
 * Handles routing between views:
 * - Board list (home)
 * - Board detail view
 * - Reports dashboard
 */
function App() {
  const [currentView, setCurrentView] = useState(VIEWS.BOARDS);
  const [selectedBoardId, setSelectedBoardId] = useState(null);

  /**
   * Navigate to board list
   */
  const handleNavigateToBoards = useCallback(() => {
    setCurrentView(VIEWS.BOARDS);
    setSelectedBoardId(null);
  }, []);

  /**
   * Navigate to a specific board
   */
  const handleSelectBoard = useCallback((boardId) => {
    setSelectedBoardId(boardId);
    setCurrentView(VIEWS.BOARD);
  }, []);

  /**
   * Navigate to reports
   */
  const handleNavigateToReports = useCallback(() => {
    setCurrentView(VIEWS.REPORTS);
    setSelectedBoardId(null);
  }, []);

  /**
   * Render current view
   */
  const renderView = () => {
    switch (currentView) {
      case VIEWS.BOARD:
        return (
          <Board
            boardId={selectedBoardId}
            onBack={handleNavigateToBoards}
          />
        );
      case VIEWS.REPORTS:
        return (
          <ReportsDashboard
            onNavigate={handleNavigateToBoards}
          />
        );
      case VIEWS.BOARDS:
      default:
        return (
          <BoardList
            onSelectBoard={handleSelectBoard}
          />
        );
    }
  };

  return (
    <div className="app">
      {/* App Header */}
      <header className="app-header">
        <h1>
          <button
            type="button"
            onClick={handleNavigateToBoards}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: 'inherit',
              font: 'inherit',
            }}
          >
            Kanban Board
          </button>
        </h1>
        <nav className="app-nav" aria-label="Main navigation">
          <button
            type="button"
            className={`nav-link ${currentView === VIEWS.BOARDS || currentView === VIEWS.BOARD ? 'active' : ''}`}
            onClick={handleNavigateToBoards}
          >
            Boards
          </button>
          <button
            type="button"
            className={`nav-link ${currentView === VIEWS.REPORTS ? 'active' : ''}`}
            onClick={handleNavigateToReports}
          >
            Reports
          </button>
        </nav>
      </header>

      {/* Main Content */}
      <main>
        {renderView()}
      </main>
    </div>
  );
}

export default App;
