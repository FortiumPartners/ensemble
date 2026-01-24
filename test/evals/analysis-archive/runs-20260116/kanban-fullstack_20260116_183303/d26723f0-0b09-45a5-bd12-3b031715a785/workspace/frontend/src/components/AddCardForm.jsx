import React, { useState, useRef, useEffect } from 'react';

function AddCardForm({ columnId, onSubmit, onCancel }) {
  const [title, setTitle] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (title.trim()) {
      onSubmit(columnId, title.trim());
      setTitle('');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <form className="add-card-form" onSubmit={handleSubmit}>
      <input
        ref={inputRef}
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Enter card title..."
        className="add-card-input"
        data-testid="add-card-input"
      />
      <div className="add-card-actions">
        <button type="submit" className="btn btn-primary" disabled={!title.trim()}>
          Add
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default AddCardForm;
