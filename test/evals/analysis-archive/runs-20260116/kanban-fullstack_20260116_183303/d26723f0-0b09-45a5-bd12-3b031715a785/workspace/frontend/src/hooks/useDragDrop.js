import { useState, useCallback } from 'react';

export function useDragDrop({ onDrop }) {
  const [isDragging, setIsDragging] = useState(false);
  const [draggedItem, setDraggedItem] = useState(null);
  const [dragOverColumn, setDragOverColumn] = useState(null);

  const handleDragStart = useCallback((e, card, columnId) => {
    setIsDragging(true);
    setDraggedItem({ card, sourceColumnId: columnId });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify({ cardId: card.id, columnId }));
  }, []);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    setDraggedItem(null);
    setDragOverColumn(null);
  }, []);

  const handleDragOver = useCallback((e, columnId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(columnId);
  }, []);

  const handleDragLeave = useCallback((e) => {
    // Only clear if we're leaving the column entirely
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOverColumn(null);
    }
  }, []);

  const handleDrop = useCallback((e, targetColumnId, targetPosition) => {
    e.preventDefault();
    setDragOverColumn(null);

    if (!draggedItem) return;

    const { card, sourceColumnId } = draggedItem;

    // Calculate new position
    if (onDrop) {
      onDrop(card.id, targetColumnId, targetPosition);
    }

    setIsDragging(false);
    setDraggedItem(null);
  }, [draggedItem, onDrop]);

  return {
    isDragging,
    draggedItem,
    dragOverColumn,
    handlers: {
      onDragStart: handleDragStart,
      onDragEnd: handleDragEnd,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  };
}

export default useDragDrop;
