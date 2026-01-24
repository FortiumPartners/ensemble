import React from 'react';

function Card({ card, columnId, onDragStart, onDragEnd, onClick, isDragging }) {
  const handleDragStart = (e) => {
    onDragStart(e, card, columnId);
  };

  return (
    <div
      className={`card ${isDragging ? 'dragging' : ''}`}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      onClick={() => onClick(card)}
      data-testid={`card-${card.id}`}
    >
      <div className="card-title">{card.title}</div>
      {card.description && (
        <div className="card-description">{card.description}</div>
      )}
    </div>
  );
}

export default Card;
