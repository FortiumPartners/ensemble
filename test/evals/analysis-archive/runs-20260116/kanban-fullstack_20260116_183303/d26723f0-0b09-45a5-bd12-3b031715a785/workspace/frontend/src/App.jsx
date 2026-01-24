import React, { useState, useEffect } from 'react';
import Board from './components/Board';
import ReportsDashboard from './components/reports/ReportsDashboard';
import { useApi } from './hooks/useApi';

function App() {
  const [boards, setBoards] = useState([]);
  const [selectedBoardId, setSelectedBoardId] = useState(null);
  const [activeTab, setActiveTab] = useState('boards');
  const [isCreatingBoard, setIsCreatingBoard] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const { get, post, del } = useApi();

  useEffect(() => {
    fetchBoards();
  }, []);

  const fetchBoards = async () => {
    try {
      const data = await get('/boards');
      setBoards(data);
      if (data.length > 0 && !selectedBoardId) {
        setSelectedBoardId(data[0].id);
      }
    } catch (err) {
      console.error('Failed to fetch boards:', err);
    }
  };

  const handleCreateBoard = async (e) => {
    e.preventDefault();
    if (newBoardName.trim()) {
      try {
        const board = await post('/boards', { name: newBoardName.trim() });
        setBoards([board, ...boards]);
        setSelectedBoardId(board.id);
        setNewBoardName('');
        setIsCreatingBoard(false);
      } catch (err) {
        console.error('Failed to create board:', err);
      }
    }
  };

  const handleDeleteBoard = async (boardId) => {
    if (window.confirm('Delete this board and all its columns and cards?')) {
      try {
        await del(`/boards/${boardId}`);
        const newBoards = boards.filter(b => b.id !== boardId);
        setBoards(newBoards);
        if (selectedBoardId === boardId) {
          setSelectedBoardId(newBoards.length > 0 ? newBoards[0].id : null);
        }
      } catch (err) {
        console.error('Failed to delete board:', err);
      }
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Kanban Board</h1>
        <nav className="app-nav">
          <button
            className={`nav-tab ${activeTab === 'boards' ? 'active' : ''}`}
            onClick={() => setActiveTab('boards')}
          >
            Boards
          </button>
          <button
            className={`nav-tab ${activeTab === 'reports' ? 'active' : ''}`}
            onClick={() => setActiveTab('reports')}
          >
            Reports
          </button>
        </nav>
      </header>

      <main className="app-main">
        {activeTab === 'boards' && (
          <div className="boards-view">
            <aside className="boards-sidebar">
              <div className="sidebar-header">
                <h3>My Boards</h3>
                <button
                  className="btn btn-small"
                  onClick={() => setIsCreatingBoard(true)}
                >
                  +
                </button>
              </div>

              {isCreatingBoard && (
                <form onSubmit={handleCreateBoard} className="create-board-form">
                  <input
                    type="text"
                    value={newBoardName}
                    onChange={(e) => setNewBoardName(e.target.value)}
                    placeholder="Board name..."
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setIsCreatingBoard(false);
                        setNewBoardName('');
                      }
                    }}
                  />
                </form>
              )}

              <ul className="boards-list">
                {boards.map(board => (
                  <li
                    key={board.id}
                    className={`board-item ${selectedBoardId === board.id ? 'active' : ''}`}
                  >
                    <button
                      className="board-select"
                      onClick={() => setSelectedBoardId(board.id)}
                    >
                      {board.name}
                    </button>
                    <button
                      className="board-delete"
                      onClick={() => handleDeleteBoard(board.id)}
                      aria-label="Delete board"
                    >
                      &times;
                    </button>
                  </li>
                ))}
              </ul>
            </aside>

            <div className="board-container">
              {selectedBoardId ? (
                <Board boardId={selectedBoardId} />
              ) : (
                <div className="no-board-selected">
                  <p>Select a board or create a new one to get started.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'reports' && <ReportsDashboard />}
      </main>
    </div>
  );
}

export default App;
