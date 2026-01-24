import { useState, useCallback, useRef } from 'react';

/**
 * Drag-and-drop state and handlers hook
 *
 * Implements HTML5 Drag and Drop API for moving cards between columns.
 * Provides visual feedback during drag operations and calculates
 * drop positions based on mouse location.
 *
 * @param {Object} options - Configuration options
 * @param {Function} options.onDragStart - Called when drag starts
 * @param {Function} options.onDragEnd - Called when drag ends (success or cancel)
 * @param {Function} options.onDrop - Called when item is dropped on valid target
 *
 * @returns {Object} Drag state and handler functions
 *
 * @example
 * const { isDragging, draggedItem, handlers } = useDragDrop({
 *   onDrop: (cardId, sourceColumnId, targetColumnId, targetIndex) => {
 *     moveCard(cardId, sourceColumnId, targetColumnId, targetIndex);
 *   }
 * });
 */
export function useDragDrop({ onDragStart, onDragEnd, onDrop }) {
  const [isDragging, setIsDragging] = useState(false);
  const [draggedItem, setDraggedItem] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  // Track the drop target element for position calculation
  const dropIndicatorRef = useRef(null);

  /**
   * Calculate drop index based on cursor position relative to existing cards
   * @param {HTMLElement} columnElement - The column container element
   * @param {number} clientY - Mouse Y position
   * @returns {number} Target index for insertion
   */
  const calculateDropIndex = useCallback((columnElement, clientY) => {
    const cards = Array.from(columnElement.querySelectorAll('[data-card-id]'));

    if (cards.length === 0) {
      return 0;
    }

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const rect = card.getBoundingClientRect();
      const cardMiddle = rect.top + rect.height / 2;

      if (clientY < cardMiddle) {
        return i;
      }
    }

    return cards.length;
  }, []);

  /**
   * Handle drag start on a card
   * Sets up drag data and visual state
   */
  const handleDragStart = useCallback((event, card, columnId) => {
    // Set drag data for HTML5 DnD
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/json', JSON.stringify({
      cardId: card.id,
      sourceColumnId: columnId,
    }));

    // Add a slight delay for visual feedback to work properly
    requestAnimationFrame(() => {
      setIsDragging(true);
      setDraggedItem({ card, columnId });
    });

    onDragStart?.(card, columnId);
  }, [onDragStart]);

  /**
   * Handle drag over a column (potential drop target)
   * Updates drop target state for visual feedback
   */
  const handleDragOver = useCallback((event, columnId) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    const columnElement = event.currentTarget;
    const dropIndex = calculateDropIndex(columnElement, event.clientY);

    setDropTarget({ columnId, dropIndex });
  }, [calculateDropIndex]);

  /**
   * Handle drag enter on a column
   * Used for visual feedback on the drop zone
   */
  const handleDragEnter = useCallback((event, columnId) => {
    event.preventDefault();

    // Only update if entering a new column
    if (!dropTarget || dropTarget.columnId !== columnId) {
      setDropTarget({ columnId, dropIndex: 0 });
    }
  }, [dropTarget]);

  /**
   * Handle drag leave from a column
   * Clears drop target state when leaving
   */
  const handleDragLeave = useCallback((event) => {
    // Only clear if actually leaving the column (not entering a child)
    const relatedTarget = event.relatedTarget;
    if (!event.currentTarget.contains(relatedTarget)) {
      setDropTarget(null);
    }
  }, []);

  /**
   * Handle drop on a column
   * Executes the move operation
   */
  const handleDrop = useCallback((event, targetColumnId) => {
    event.preventDefault();

    try {
      const data = JSON.parse(event.dataTransfer.getData('application/json'));
      const { cardId, sourceColumnId } = data;

      const columnElement = event.currentTarget;
      const dropIndex = calculateDropIndex(columnElement, event.clientY);

      onDrop?.(cardId, sourceColumnId, targetColumnId, dropIndex);
    } catch (err) {
      // Invalid drag data, ignore
    }

    // Clean up state
    setIsDragging(false);
    setDraggedItem(null);
    setDropTarget(null);
  }, [calculateDropIndex, onDrop]);

  /**
   * Handle drag end (fires on the source element)
   * Cleans up drag state
   */
  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    setDraggedItem(null);
    setDropTarget(null);

    onDragEnd?.();
  }, [onDragEnd]);

  /**
   * Check if a column is the current drop target
   * @param {number} columnId - Column ID to check
   * @returns {boolean} True if column is drop target
   */
  const isDropTarget = useCallback((columnId) => {
    return dropTarget?.columnId === columnId;
  }, [dropTarget]);

  /**
   * Check if a specific position is the drop indicator location
   * @param {number} columnId - Column ID
   * @param {number} index - Position index
   * @returns {boolean} True if indicator should show here
   */
  const isDropIndicator = useCallback((columnId, index) => {
    return dropTarget?.columnId === columnId && dropTarget?.dropIndex === index;
  }, [dropTarget]);

  /**
   * Check if a card is currently being dragged
   * @param {number} cardId - Card ID to check
   * @returns {boolean} True if card is being dragged
   */
  const isCardDragging = useCallback((cardId) => {
    return draggedItem?.card?.id === cardId;
  }, [draggedItem]);

  return {
    isDragging,
    draggedItem,
    dropTarget,
    dropIndicatorRef,
    handlers: {
      handleDragStart,
      handleDragOver,
      handleDragEnter,
      handleDragLeave,
      handleDrop,
      handleDragEnd,
    },
    isDropTarget,
    isDropIndicator,
    isCardDragging,
  };
}

export default useDragDrop;
