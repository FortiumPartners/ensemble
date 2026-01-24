import React, { useState } from 'react';
import Column from './Column';
import CardModal from './CardModal';
import { useBoard } from '../hooks/useBoard';
import { useDragDrop } from '../hooks/useDragDrop';

function Board({ boardId }) {
  const { board, loading, error, actions } = useBoard(boardId);
  const [editingCard, setEditingCard] = useState(null);
  const [isAddingColumn, setIsAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');

  const { isDragging, draggedItem, dragOverColumn, handlers } = useDragDrop({
    onDrop: (cardId, columnId, position) => {
      actions.moveCard(cardId, columnId, position);
    },
  });

  if (loading) {
    return <div className="board-loading">Loading board...</div>;
  }

  if (error) {
    return <div className="board-error">Error: {error}</div>;
  }

  if (!board) {
    return <div className="board-empty">Board not found</div>;
  }

  const handleAddColumn = (e) => {
    e.preventDefault();
    if (newColumnName.trim()) {
      actions.createColumn(newColumnName.trim());
      setNewColumnName('');
      setIsAddingColumn(false);
    }
  };

  const handleAddCard = (columnId, title) => {
    actions.createCard(columnId, title);
  };

  const handleSaveCard = (cardId, updates) => {
    actions.updateCard(cardId, updates);
  };

  const handleDeleteCard = (cardId) => {
    actions.deleteCard(cardId);
  };

  const handleDeleteColumn = (columnId) => {
    if (window.confirm('Delete this column and all its cards?')) {
      actions.deleteColumn(columnId);
    }
  };

  const handleUpdateColumn = (columnId, updates) => {
    actions.updateColumn(columnId, updates);
  };

  return (
    <div className="board" data-testid="board">
      <div className="board-header">
        <h2>{board.name}</h2>
      </div>

      <div className="board-columns">
        {(board.columns || []).map(column => (
          <Column
            key={column.id}
            column={column}
            onDragStart={handlers.onDragStart}
            onDragEnd={handlers.onDragEnd}
            onDragOver={handlers.onDragOver}
            onDragLeave={handlers.onDragLeave}
            onDrop={handlers.onDrop}
            onCardClick={setEditingCard}
            onAddCard={handleAddCard}
            onDeleteColumn={handleDeleteColumn}
            onUpdateColumn={handleUpdateColumn}
            isDropTarget={dragOverColumn === column.id}
            draggedItem={draggedItem}
          />
        ))}

        {isAddingColumn ? (
          <form className="add-column-form" onSubmit={handleAddColumn}>
            <input
              type="text"
              value={newColumnName}
              onChange={(e) => setNewColumnName(e.target.value)}
              placeholder="Column name..."
              className="add-column-input"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setIsAddingColumn(false);
                  setNewColumnName('');
                }
              }}
            />
            <div className="add-column-actions">
              <button type="submit" className="btn btn-primary" disabled={!newColumnName.trim()}>
                Add
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setIsAddingColumn(false);
                  setNewColumnName('');
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            className="add-column-button"
            onClick={() => setIsAddingColumn(true)}
          >
            + Add Column
          </button>
        )}
      </div>

      {editingCard && (
        <CardModal
          card={editingCard}
          onSave={handleSaveCard}
          onDelete={handleDeleteCard}
          onClose={() => setEditingCard(null)}
        />
      )}
    </div>
  );
}

export default Board;
