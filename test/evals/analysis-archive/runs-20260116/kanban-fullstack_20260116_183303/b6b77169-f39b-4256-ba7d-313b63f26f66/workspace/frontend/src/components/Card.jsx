import { memo } from 'react';

/**
 * Draggable card component displaying task information
 *
 * @param {Object} props
 * @param {Object} props.card - Card data object
 * @param {number} props.card.id - Unique card identifier
 * @param {string} props.card.title - Card title
 * @param {string} props.card.description - Card description (optional)
 * @param {string} props.card.created_at - Creation timestamp
 * @param {Function} props.onClick - Handler for card click (opens modal)
 * @param {Function} props.onDragStart - Handler for drag start event
 * @param {Function} props.onDragEnd - Handler for drag end event
 * @param {boolean} props.isDragging - Whether this card is currently being dragged
 */
function Card({
  card,
  onClick,
  onDragStart,
  onDragEnd,
  isDragging = false,
}) {
  /**
   * Format date for display
   * @param {string} dateString - ISO date string
   * @returns {string} Formatted date
   */
  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  /**
   * Handle card click
   * Prevents triggering when dragging
   */
  const handleClick = (event) => {
    // Don't open modal if we were dragging
    if (event.defaultPrevented) return;
    onClick?.(card);
  };

  /**
   * Handle keyboard activation
   * Opens card modal on Enter or Space
   */
  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick?.(card);
    }
  };

  /**
   * Handle drag start
   */
  const handleDragStart = (event) => {
    onDragStart?.(event, card);
  };

  return (
    <article
      className={`card ${isDragging ? 'dragging' : ''}`}
      data-card-id={card.id}
      draggable="true"
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Card: ${card.title}. Click to edit.`}
    >
      {/* Drag Handle Indicator */}
      <span className="card-drag-handle" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="5" cy="4" r="1.5" />
          <circle cx="11" cy="4" r="1.5" />
          <circle cx="5" cy="8" r="1.5" />
          <circle cx="11" cy="8" r="1.5" />
          <circle cx="5" cy="12" r="1.5" />
          <circle cx="11" cy="12" r="1.5" />
        </svg>
      </span>

      {/* Card Title */}
      <h4 className="card-title">{card.title}</h4>

      {/* Card Description Preview */}
      {card.description && (
        <p className="card-description">{card.description}</p>
      )}

      {/* Card Metadata */}
      <div className="card-meta">
        <span className="card-date">{formatDate(card.created_at)}</span>
      </div>
    </article>
  );
}

// Memoize to prevent unnecessary re-renders when parent state changes
export default memo(Card);
