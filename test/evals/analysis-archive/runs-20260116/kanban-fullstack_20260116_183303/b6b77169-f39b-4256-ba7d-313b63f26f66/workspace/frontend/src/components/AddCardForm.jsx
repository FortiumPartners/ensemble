import { useState, useRef, useEffect, useCallback, memo } from 'react';

/**
 * Inline form for adding new cards to a column
 *
 * @param {Object} props
 * @param {Function} props.onSubmit - Handler for form submission (receives title)
 * @param {Function} props.onCancel - Handler for cancel action
 * @param {boolean} props.isOpen - Whether the form is visible
 */
function AddCardForm({ onSubmit, onCancel, isOpen }) {
  const [title, setTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef(null);

  // Focus input when form opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Reset form when closed
  useEffect(() => {
    if (!isOpen) {
      setTitle('');
      setIsSubmitting(false);
    }
  }, [isOpen]);

  /**
   * Handle form submission
   */
  const handleSubmit = useCallback(async (event) => {
    event.preventDefault();

    const trimmedTitle = title.trim();
    if (!trimmedTitle || isSubmitting) return;

    setIsSubmitting(true);

    try {
      await onSubmit(trimmedTitle);
      setTitle('');
      // Keep form open for adding multiple cards
      inputRef.current?.focus();
    } catch (error) {
      // Error handling is done by parent
    } finally {
      setIsSubmitting(false);
    }
  }, [title, isSubmitting, onSubmit]);

  /**
   * Handle keyboard events
   * - Enter: Submit form
   * - Escape: Cancel and close form
   */
  const handleKeyDown = useCallback((event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  }, [onCancel]);

  /**
   * Handle input blur
   * Cancel if empty, otherwise keep open
   */
  const handleBlur = useCallback((event) => {
    // Don't close if clicking on a button in the form
    const relatedTarget = event.relatedTarget;
    if (relatedTarget && event.currentTarget.contains(relatedTarget)) {
      return;
    }

    // Close if empty
    if (!title.trim()) {
      onCancel();
    }
  }, [title, onCancel]);

  if (!isOpen) {
    return null;
  }

  return (
    <form
      className="add-card-form"
      onSubmit={handleSubmit}
      onBlur={handleBlur}
      role="form"
      aria-label="Add new card"
    >
      <input
        ref={inputRef}
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Enter card title..."
        aria-label="Card title"
        disabled={isSubmitting}
        maxLength={255}
        autoComplete="off"
      />
      <div className="add-card-form-actions">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!title.trim() || isSubmitting}
        >
          {isSubmitting ? 'Adding...' : 'Add Card'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export default memo(AddCardForm);
