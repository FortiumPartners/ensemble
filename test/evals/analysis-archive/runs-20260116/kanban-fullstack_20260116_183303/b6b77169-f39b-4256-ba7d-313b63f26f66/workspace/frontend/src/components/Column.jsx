import { useState, useCallback, memo } from 'react';
import Card from './Card';
import AddCardForm from './AddCardForm';

/**
 * Column component displaying a list of cards
 *
 * Acts as a drop zone for drag-and-drop operations
 * and provides card management functionality.
 *
 * @param {Object} props
 * @param {Object} props.column - Column data
 * @param {number} props.column.id - Column ID
 * @param {string} props.column.name - Column name
 * @param {Array} props.column.cards - Array of cards in column
 * @param {Function} props.onUpdateName - Handler for column name update
 * @param {Function} props.onDelete - Handler for column deletion
 * @param {Function} props.onCreateCard - Handler for creating new cards
 * @param {Function} props.onCardClick - Handler for card click (opens modal)
 * @param {Object} props.dragHandlers - Drag-and-drop event handlers
 * @param {Function} props.isCardDragging - Check if card is being dragged
 * @param {boolean} props.isDropTarget - Whether column is current drop target
 */
function Column({
  column,
  onUpdateName,
  onDelete,
  onCreateCard,
  onCardClick,
  dragHandlers,
  isCardDragging,
  isDropTarget = false,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(column.name);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const cards = column.cards || [];

  /**
   * Handle column name edit
   */
  const handleNameEdit = useCallback(() => {
    setEditName(column.name);
    setIsEditing(true);
  }, [column.name]);

  /**
   * Handle name input blur - save changes
   */
  const handleNameBlur = useCallback(async () => {
    setIsEditing(false);
    const trimmedName = editName.trim();

    if (trimmedName && trimmedName !== column.name) {
      try {
        await onUpdateName(column.id, { name: trimmedName });
      } catch {
        // Revert on error
        setEditName(column.name);
      }
    } else {
      setEditName(column.name);
    }
  }, [editName, column.id, column.name, onUpdateName]);

  /**
   * Handle name input key events
   */
  const handleNameKeyDown = useCallback((event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.target.blur();
    } else if (event.key === 'Escape') {
      setEditName(column.name);
      setIsEditing(false);
    }
  }, [column.name]);

  /**
   * Handle column deletion
   */
  const handleDelete = useCallback(async () => {
    try {
      await onDelete(column.id);
    } catch {
      // Error is handled by parent
    }
    setShowDeleteConfirm(false);
  }, [column.id, onDelete]);

  /**
   * Handle new card creation
   */
  const handleCreateCard = useCallback(async (title) => {
    await onCreateCard(column.id, title);
  }, [column.id, onCreateCard]);

  /**
   * Handle drag start from a card
   */
  const handleCardDragStart = useCallback((event, card) => {
    dragHandlers?.handleDragStart(event, card, column.id);
  }, [column.id, dragHandlers]);

  /**
   * Handle drag over column
   */
  const handleDragOver = useCallback((event) => {
    dragHandlers?.handleDragOver(event, column.id);
  }, [column.id, dragHandlers]);

  /**
   * Handle drag enter
   */
  const handleDragEnter = useCallback((event) => {
    dragHandlers?.handleDragEnter(event, column.id);
  }, [column.id, dragHandlers]);

  /**
   * Handle drop on column
   */
  const handleDrop = useCallback((event) => {
    dragHandlers?.handleDrop(event, column.id);
  }, [column.id, dragHandlers]);

  return (
    <section
      className="column"
      data-column-id={column.id}
      aria-label={`Column: ${column.name}`}
    >
      {/* Column Header */}
      <header className="column-header">
        <div className="column-title">
          {isEditing ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleNameBlur}
              onKeyDown={handleNameKeyDown}
              aria-label="Edit column name"
              autoFocus
              maxLength={255}
            />
          ) : (
            <input
              type="text"
              value={column.name}
              onFocus={handleNameEdit}
              readOnly
              aria-label={`Column name: ${column.name}`}
            />
          )}
          <span className="column-count" aria-label={`${cards.length} cards`}>
            {cards.length}
          </span>
        </div>

        <div className="column-actions">
          {showDeleteConfirm ? (
            <>
              <button
                type="button"
                className="btn btn-danger btn-icon"
                onClick={handleDelete}
                aria-label="Confirm delete column"
                title="Confirm delete"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                </svg>
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setShowDeleteConfirm(false)}
                aria-label="Cancel delete"
                title="Cancel"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
                </svg>
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              onClick={() => setShowDeleteConfirm(true)}
              aria-label="Delete column"
              title="Delete column"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M6.5 1.75a.25.25 0 01.25-.25h2.5a.25.25 0 01.25.25V3h-3V1.75zm4.5 0V3h2.25a.75.75 0 010 1.5H2.75a.75.75 0 010-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75zM4.496 6.675a.75.75 0 10-1.492.15l.66 6.6A1.75 1.75 0 005.405 15h5.19c.9 0 1.652-.681 1.741-1.576l.66-6.6a.75.75 0 00-1.492-.149l-.66 6.6a.25.25 0 01-.249.225h-5.19a.25.25 0 01-.249-.225l-.66-6.6z" />
              </svg>
            </button>
          )}
        </div>
      </header>

      {/* Column Content (Card List + Drop Zone) */}
      <div
        className={`column-content ${isDropTarget ? 'drop-target' : ''}`}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={dragHandlers?.handleDragLeave}
        onDrop={handleDrop}
        role="list"
        aria-label={`Cards in ${column.name}`}
      >
        {cards.length === 0 && !isDropTarget && (
          <p className="text-muted text-center" style={{ padding: 'var(--space-4)' }}>
            No cards yet
          </p>
        )}

        {cards.map((card) => (
          <Card
            key={card.id}
            card={card}
            onClick={onCardClick}
            onDragStart={handleCardDragStart}
            onDragEnd={dragHandlers?.handleDragEnd}
            isDragging={isCardDragging?.(card.id)}
          />
        ))}
      </div>

      {/* Column Footer (Add Card) */}
      <footer className="column-footer">
        {showAddForm ? (
          <AddCardForm
            isOpen={showAddForm}
            onSubmit={handleCreateCard}
            onCancel={() => setShowAddForm(false)}
          />
        ) : (
          <button
            type="button"
            className="add-card-button"
            onClick={() => setShowAddForm(true)}
            aria-label="Add a card"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 2.75a.75.75 0 01.75.75v3.75h3.75a.75.75 0 010 1.5H8.75v3.75a.75.75 0 01-1.5 0V8.75H3.5a.75.75 0 010-1.5h3.75V3.5A.75.75 0 018 2.75z" />
            </svg>
            Add a card
          </button>
        )}
      </footer>
    </section>
  );
}

export default memo(Column);
