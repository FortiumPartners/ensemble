import { useState, useCallback, memo } from 'react';
import Column from './Column';
import CardModal from './CardModal';
import { useBoard, useDragDrop } from '../hooks';

/**
 * Main board component containing columns and cards
 *
 * Provides the primary Kanban board interface with:
 * - Column management (create, update, delete)
 * - Card management (create, update, delete, move)
 * - Drag-and-drop for card reordering
 *
 * @param {Object} props
 * @param {string|number} props.boardId - ID of the board to display
 * @param {Function} props.onBack - Handler to navigate back to board list
 */
function Board({ boardId, onBack }) {
  const { board, loading, error, actions } = useBoard(boardId);
  const [selectedCard, setSelectedCard] = useState(null);
  const [isAddingColumn, setIsAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');

  /**
   * Handle card drop for drag-and-drop
   */
  const handleDrop = useCallback((cardId, sourceColumnId, targetColumnId, targetIndex) => {
    actions.moveCard(cardId, sourceColumnId, targetColumnId, targetIndex);
  }, [actions]);

  const {
    isDragging,
    handlers: dragHandlers,
    isCardDragging,
    isDropTarget,
  } = useDragDrop({
    onDrop: handleDrop,
  });

  /**
   * Handle board name update
   */
  const handleBoardNameChange = useCallback((event) => {
    const newName = event.target.value;
    if (event.target.value !== board?.name) {
      actions.updateBoardName(newName);
    }
  }, [actions, board?.name]);

  /**
   * Handle new column creation
   */
  const handleAddColumn = useCallback(async () => {
    const trimmedName = newColumnName.trim();
    if (!trimmedName) return;

    try {
      await actions.createColumn(trimmedName);
      setNewColumnName('');
      setIsAddingColumn(false);
    } catch {
      // Error handled by hook
    }
  }, [newColumnName, actions]);

  /**
   * Handle add column key events
   */
  const handleAddColumnKeyDown = useCallback((event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleAddColumn();
    } else if (event.key === 'Escape') {
      setIsAddingColumn(false);
      setNewColumnName('');
    }
  }, [handleAddColumn]);

  /**
   * Handle card click to open edit modal
   */
  const handleCardClick = useCallback((card) => {
    setSelectedCard(card);
  }, []);

  /**
   * Handle card save from modal
   */
  const handleCardSave = useCallback(async (cardId, updates) => {
    await actions.updateCard(cardId, updates);
  }, [actions]);

  /**
   * Handle card delete from modal
   */
  const handleCardDelete = useCallback(async (cardId) => {
    await actions.deleteCard(cardId);
    setSelectedCard(null);
  }, [actions]);

  /**
   * Close card modal
   */
  const handleCloseModal = useCallback(() => {
    setSelectedCard(null);
  }, []);

  // Loading state
  if (loading) {
    return (
      <div className="board-container">
        <div className="loading" role="status" aria-live="polite">
          <div className="loading-spinner" aria-hidden="true"></div>
          <span className="sr-only">Loading board...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="board-container">
        <div className="error-message" role="alert">
          <h3>Failed to load board</h3>
          <p>{error.message}</p>
          <button type="button" className="btn btn-primary" onClick={onBack}>
            Go Back
          </button>
        </div>
      </div>
    );
  }

  // No board found
  if (!board) {
    return (
      <div className="board-container">
        <div className="empty-state">
          <h3>Board not found</h3>
          <p>The board you are looking for does not exist.</p>
          <button type="button" className="btn btn-primary" onClick={onBack}>
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const columns = board.columns || [];

  return (
    <div className="board-container">
      {/* Board Header */}
      <header className="board-header">
        <div className="board-title">
          <button
            type="button"
            className="back-button"
            onClick={onBack}
            aria-label="Back to boards"
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
              <path d="M7.78 12.53a.75.75 0 01-1.06 0L2.47 8.28a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 1.06L4.81 7h8.44a.75.75 0 010 1.5H4.81l2.97 2.97a.75.75 0 010 1.06z" />
            </svg>
            Boards
          </button>
          <input
            type="text"
            defaultValue={board.name}
            onBlur={handleBoardNameChange}
            aria-label="Board name"
            className="board-name-input"
          />
        </div>

        <div className="flex gap-2">
          <span className="text-muted">
            {columns.length} column{columns.length !== 1 ? 's' : ''} |{' '}
            {columns.reduce((sum, col) => sum + (col.cards?.length || 0), 0)} card
            {columns.reduce((sum, col) => sum + (col.cards?.length || 0), 0) !== 1 ? 's' : ''}
          </span>
        </div>
      </header>

      {/* Board Content */}
      <main
        className={`board ${isDragging ? 'is-dragging' : ''}`}
        role="region"
        aria-label="Kanban board"
      >
        {/* Columns */}
        {columns.map((column) => (
          <Column
            key={column.id}
            column={column}
            onUpdateName={actions.updateColumn}
            onDelete={actions.deleteColumn}
            onCreateCard={actions.createCard}
            onCardClick={handleCardClick}
            dragHandlers={dragHandlers}
            isCardDragging={isCardDragging}
            isDropTarget={isDropTarget(column.id)}
          />
        ))}

        {/* Add Column */}
        {isAddingColumn ? (
          <div className="column" style={{ background: 'var(--color-bg-elevated)' }}>
            <div className="column-header">
              <input
                type="text"
                value={newColumnName}
                onChange={(e) => setNewColumnName(e.target.value)}
                onKeyDown={handleAddColumnKeyDown}
                onBlur={() => {
                  if (!newColumnName.trim()) {
                    setIsAddingColumn(false);
                  }
                }}
                placeholder="Enter column name..."
                aria-label="New column name"
                autoFocus
                maxLength={255}
              />
            </div>
            <div className="column-footer">
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleAddColumn}
                  disabled={!newColumnName.trim()}
                >
                  Add Column
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setIsAddingColumn(false);
                    setNewColumnName('');
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="add-column"
            onClick={() => setIsAddingColumn(true)}
            aria-label="Add a column"
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 2.75a.75.75 0 01.75.75v3.75h3.75a.75.75 0 010 1.5H8.75v3.75a.75.75 0 01-1.5 0V8.75H3.5a.75.75 0 010-1.5h3.75V3.5A.75.75 0 018 2.75z" />
            </svg>
            Add Column
          </button>
        )}
      </main>

      {/* Card Edit Modal */}
      <CardModal
        card={selectedCard}
        isOpen={!!selectedCard}
        onClose={handleCloseModal}
        onSave={handleCardSave}
        onDelete={handleCardDelete}
      />
    </div>
  );
}

export default memo(Board);
