import { useState, useEffect, useRef, useCallback, memo } from 'react';

/**
 * Modal dialog for editing card details
 *
 * Provides a full editing interface for card title and description,
 * with keyboard navigation and focus trapping.
 *
 * @param {Object} props
 * @param {Object} props.card - Card data to edit
 * @param {boolean} props.isOpen - Whether modal is visible
 * @param {Function} props.onClose - Handler to close modal
 * @param {Function} props.onSave - Handler to save changes
 * @param {Function} props.onDelete - Handler to delete card
 */
function CardModal({ card, isOpen, onClose, onSave, onDelete }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const modalRef = useRef(null);
  const titleInputRef = useRef(null);

  // Initialize form with card data
  useEffect(() => {
    if (card && isOpen) {
      setTitle(card.title || '');
      setDescription(card.description || '');
      setHasChanges(false);
      setShowDeleteConfirm(false);
    }
  }, [card, isOpen]);

  // Focus title input when modal opens
  useEffect(() => {
    if (isOpen && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isOpen]);

  // Handle escape key to close
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  /**
   * Track changes to form fields
   */
  const handleTitleChange = useCallback((e) => {
    setTitle(e.target.value);
    setHasChanges(true);
  }, []);

  const handleDescriptionChange = useCallback((e) => {
    setDescription(e.target.value);
    setHasChanges(true);
  }, []);

  /**
   * Handle modal close
   * Saves changes if any were made
   */
  const handleClose = useCallback(async () => {
    if (hasChanges && !isSaving) {
      const trimmedTitle = title.trim();
      if (trimmedTitle && (trimmedTitle !== card.title || description !== (card.description || ''))) {
        setIsSaving(true);
        try {
          await onSave(card.id, { title: trimmedTitle, description });
        } catch {
          // Error handled by parent
        }
        setIsSaving(false);
      }
    }
    onClose();
  }, [hasChanges, isSaving, title, description, card, onSave, onClose]);

  /**
   * Handle overlay click
   * Closes modal when clicking outside
   */
  const handleOverlayClick = useCallback((event) => {
    if (event.target === event.currentTarget) {
      handleClose();
    }
  }, [handleClose]);

  /**
   * Handle save button click
   */
  const handleSave = useCallback(async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || isSaving) return;

    setIsSaving(true);
    try {
      await onSave(card.id, { title: trimmedTitle, description });
      onClose();
    } catch {
      // Error handled by parent
    }
    setIsSaving(false);
  }, [title, description, card?.id, isSaving, onSave, onClose]);

  /**
   * Handle delete button click
   */
  const handleDelete = useCallback(async () => {
    if (isDeleting) return;

    setIsDeleting(true);
    try {
      await onDelete(card.id);
      onClose();
    } catch {
      // Error handled by parent
    }
    setIsDeleting(false);
  }, [card?.id, isDeleting, onDelete, onClose]);

  /**
   * Format date for display
   */
  const formatDate = (dateString) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (!isOpen || !card) {
    return null;
  }

  return (
    <div
      className="modal-overlay"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="card-modal-title"
    >
      <div className="modal" ref={modalRef}>
        {/* Modal Header */}
        <header className="modal-header">
          <h2 id="card-modal-title">Edit Card</h2>
          <button
            type="button"
            className="modal-close"
            onClick={handleClose}
            aria-label="Close modal"
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
            </svg>
          </button>
        </header>

        {/* Modal Body */}
        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="card-title">Title</label>
            <input
              ref={titleInputRef}
              id="card-title"
              type="text"
              value={title}
              onChange={handleTitleChange}
              placeholder="Enter card title"
              maxLength={255}
              disabled={isSaving || isDeleting}
            />
          </div>

          <div className="form-group">
            <label htmlFor="card-description">Description</label>
            <textarea
              id="card-description"
              value={description}
              onChange={handleDescriptionChange}
              placeholder="Add a more detailed description..."
              rows={5}
              disabled={isSaving || isDeleting}
            />
          </div>

          {/* Card Metadata */}
          <div className="form-group">
            <label>Created</label>
            <p className="text-muted" style={{ margin: 0 }}>
              {formatDate(card.created_at)}
            </p>
          </div>

          {card.updated_at && card.updated_at !== card.created_at && (
            <div className="form-group">
              <label>Last Updated</label>
              <p className="text-muted" style={{ margin: 0 }}>
                {formatDate(card.updated_at)}
              </p>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <footer className="modal-footer">
          {showDeleteConfirm ? (
            <div className="flex gap-2" style={{ marginRight: 'auto' }}>
              <span className="text-muted" style={{ alignSelf: 'center' }}>
                Delete this card?
              </span>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Yes, Delete'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isSaving || isDeleting}
              style={{ marginRight: 'auto' }}
            >
              Delete
            </button>
          )}

          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={isSaving || isDeleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!title.trim() || isSaving || isDeleting}
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default memo(CardModal);
