import { useState, useEffect, useCallback, memo } from 'react';
import { api } from '../hooks/useApi';

/**
 * Board list component showing all available boards
 *
 * Displays a grid of board cards with create functionality.
 *
 * @param {Object} props
 * @param {Function} props.onSelectBoard - Handler when a board is selected
 */
function BoardList({ onSelectBoard }) {
  const [boards, setBoards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const [createError, setCreateError] = useState(null);

  /**
   * Fetch boards from API
   */
  const fetchBoards = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await api.get('/boards');
      setBoards(data || []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch boards on mount
  useEffect(() => {
    fetchBoards();
  }, [fetchBoards]);

  /**
   * Handle board creation
   */
  const handleCreateBoard = useCallback(async () => {
    const trimmedName = newBoardName.trim();
    if (!trimmedName) return;

    setCreateError(null);

    try {
      const newBoard = await api.post('/boards', { name: trimmedName });
      setBoards((prev) => [...prev, newBoard]);
      setNewBoardName('');
      setIsCreating(false);
      // Optionally navigate to new board
      onSelectBoard(newBoard.id);
    } catch (err) {
      setCreateError(err.message);
    }
  }, [newBoardName, onSelectBoard]);

  /**
   * Handle key events for create form
   */
  const handleKeyDown = useCallback((event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleCreateBoard();
    } else if (event.key === 'Escape') {
      setIsCreating(false);
      setNewBoardName('');
      setCreateError(null);
    }
  }, [handleCreateBoard]);

  /**
   * Handle board deletion
   */
  const handleDeleteBoard = useCallback(async (boardId, event) => {
    event.stopPropagation();

    if (!window.confirm('Are you sure you want to delete this board? All columns and cards will be permanently deleted.')) {
      return;
    }

    try {
      await api.del(`/boards/${boardId}`);
      setBoards((prev) => prev.filter((b) => b.id !== boardId));
    } catch (err) {
      setError(err);
    }
  }, []);

  /**
   * Format date for display
   */
  const formatDate = (dateString) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // Loading state
  if (loading) {
    return (
      <div className="board-list">
        <div className="loading" role="status" aria-live="polite">
          <div className="loading-spinner" aria-hidden="true"></div>
          <span className="sr-only">Loading boards...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="board-list">
        <div className="error-message" role="alert">
          <h3>Failed to load boards</h3>
          <p>{error.message}</p>
          <button type="button" className="btn btn-primary" onClick={fetchBoards}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="board-list">
      <h2>Your Boards</h2>

      <div className="board-grid" role="list">
        {/* Existing Boards */}
        {boards.map((board) => (
          <article
            key={board.id}
            className="board-card"
            onClick={() => onSelectBoard(board.id)}
            onKeyDown={(e) => e.key === 'Enter' && onSelectBoard(board.id)}
            role="listitem"
            tabIndex={0}
            aria-label={`Board: ${board.name}`}
          >
            <h3>{board.name}</h3>
            <div className="board-card-meta">
              <span>Created {formatDate(board.created_at)}</span>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              onClick={(e) => handleDeleteBoard(board.id, e)}
              aria-label={`Delete board ${board.name}`}
              style={{
                position: 'absolute',
                top: 'var(--space-3)',
                right: 'var(--space-3)',
                opacity: 0,
                transition: 'opacity var(--transition-fast)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = 1; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = 0; }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M6.5 1.75a.25.25 0 01.25-.25h2.5a.25.25 0 01.25.25V3h-3V1.75zm4.5 0V3h2.25a.75.75 0 010 1.5H2.75a.75.75 0 010-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75zM4.496 6.675a.75.75 0 10-1.492.15l.66 6.6A1.75 1.75 0 005.405 15h5.19c.9 0 1.652-.681 1.741-1.576l.66-6.6a.75.75 0 00-1.492-.149l-.66 6.6a.25.25 0 01-.249.225h-5.19a.25.25 0 01-.249-.225l-.66-6.6z" />
              </svg>
            </button>
          </article>
        ))}

        {/* Create New Board Card */}
        {isCreating ? (
          <div className="board-card" style={{ padding: 'var(--space-4)' }}>
            <input
              type="text"
              value={newBoardName}
              onChange={(e) => setNewBoardName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter board name..."
              aria-label="New board name"
              autoFocus
              maxLength={255}
              style={{ width: '100%', marginBottom: 'var(--space-3)' }}
            />
            {createError && (
              <p className="text-accent" style={{ marginBottom: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>
                {createError}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleCreateBoard}
                disabled={!newBoardName.trim()}
              >
                Create
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setIsCreating(false);
                  setNewBoardName('');
                  setCreateError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <article
            className="board-card board-card-new"
            onClick={() => setIsCreating(true)}
            onKeyDown={(e) => e.key === 'Enter' && setIsCreating(true)}
            role="button"
            tabIndex={0}
            aria-label="Create new board"
          >
            <svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 2.75a.75.75 0 01.75.75v3.75h3.75a.75.75 0 010 1.5H8.75v3.75a.75.75 0 01-1.5 0V8.75H3.5a.75.75 0 010-1.5h3.75V3.5A.75.75 0 018 2.75z" />
            </svg>
            <span>Create new board</span>
          </article>
        )}
      </div>

      {/* Empty State */}
      {boards.length === 0 && !isCreating && (
        <div className="empty-state" style={{ marginTop: 'var(--space-8)' }}>
          <h3>No boards yet</h3>
          <p>Create your first board to get started.</p>
        </div>
      )}
    </div>
  );
}

export default memo(BoardList);
