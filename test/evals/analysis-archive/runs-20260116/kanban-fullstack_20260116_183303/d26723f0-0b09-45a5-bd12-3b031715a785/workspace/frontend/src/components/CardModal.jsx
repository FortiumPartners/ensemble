import React, { useState, useEffect, useRef } from 'react';

function CardModal({ card, onSave, onDelete, onClose }) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description || '');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const modalRef = useRef(null);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleSave = () => {
    if (title.trim()) {
      onSave(card.id, { title: title.trim(), description });
      onClose();
    }
  };

  const handleDelete = () => {
    if (showDeleteConfirm) {
      onDelete(card.id);
      onClose();
    } else {
      setShowDeleteConfirm(true);
    }
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick} data-testid="card-modal">
      <div className="modal" ref={modalRef}>
        <div className="modal-header">
          <h3>Edit Card</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="card-title">Title</label>
            <input
              id="card-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="form-input"
              data-testid="card-title-input"
            />
          </div>
          <div className="form-group">
            <label htmlFor="card-description">Description</label>
            <textarea
              id="card-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="form-textarea"
              rows={4}
              data-testid="card-description-input"
            />
          </div>
        </div>
        <div className="modal-footer">
          <button
            className={`btn ${showDeleteConfirm ? 'btn-danger-confirm' : 'btn-danger'}`}
            onClick={handleDelete}
          >
            {showDeleteConfirm ? 'Click again to confirm' : 'Delete'}
          </button>
          <div className="modal-footer-right">
            <button className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={!title.trim()}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CardModal;
