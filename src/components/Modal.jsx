import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export default function Modal({ open, title, onClose, maxWidth = 540, children }) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title || 'Dialog'}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose?.();
        }
      }}
    >
      <div
        className="modal-card"
        style={{ maxWidth }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="card-title" style={{ fontSize: 17 }}>
            {title}
          </h2>
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={onClose}
            aria-label="Close modal"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
