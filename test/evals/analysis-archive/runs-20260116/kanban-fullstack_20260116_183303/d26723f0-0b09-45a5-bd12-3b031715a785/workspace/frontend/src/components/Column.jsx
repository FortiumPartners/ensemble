import React, { useState } from 'react';
import Card from './Card';
import AddCardForm from './AddCardForm';

function Column({
  column,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onCardClick,
  onAddCard,
  onDeleteColumn,
  onUpdateColumn,
  isDropTarget,
  draggedItem,
}) {
  const [isAddingCard, setIsAddingCard] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(column.name);

  const handleDrop = (e) => {
    e.preventDefault();
    if (!draggedItem) return;

    // Calculate position - at the end of the list
    const cards = column.cards || [];
    const lastPosition = cards.length > 0 ? Math.max(...cards.map(c => c.position)) : 0;
    const newPosition = lastPosition + 1024;

    onDrop(e, column.id, newPosition);
  };

  const handleAddCard = (columnId, title) => {
    onAddCard(columnId, title);
    setIsAddingCard(false);
  };

  const handleUpdateName = () => {
    if (editName.trim() && editName !== column.name) {
      onUpdateColumn(column.id, { name: editName.trim() });
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleUpdateName();
    } else if (e.key === 'Escape') {
      setEditName(column.name);
      setIsEditing(false);
    }
  };

  const cards = column.cards || [];

  return (
    <div
      className={`column ${isDropTarget ? 'drop-target' : ''}`}
      onDragOver={(e) => onDragOver(e, column.id)}
      onDragLeave={onDragLeave}
      onDrop={handleDrop}
      data-testid={`column-${column.id}`}
    >
      <div className="column-header">
        {isEditing ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleUpdateName}
            onKeyDown={handleKeyDown}
            className="column-name-input"
            autoFocus
          />
        ) : (
          <h3 className="column-name" onClick={() => setIsEditing(true)}>
            {column.name}
          </h3>
        )}
        <span className="column-count">{cards.length}</span>
        <button
          className="column-delete"
          onClick={() => onDeleteColumn(column.id)}
          aria-label="Delete column"
        >
          &times;
        </button>
      </div>

      <div className="column-cards">
        {cards.map(card => (
          <Card
            key={card.id}
            card={card}
            columnId={column.id}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onClick={onCardClick}
            isDragging={draggedItem?.card?.id === card.id}
          />
        ))}
      </div>

      {isAddingCard ? (
        <AddCardForm
          columnId={column.id}
          onSubmit={handleAddCard}
          onCancel={() => setIsAddingCard(false)}
        />
      ) : (
        <button
          className="add-card-button"
          onClick={() => setIsAddingCard(true)}
        >
          + Add Card
        </button>
      )}
    </div>
  );
}

export default Column;
