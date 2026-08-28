import { X } from 'lucide-react'
import { useEscapeKey } from '../hooks'

// A small, reusable confirmation modal that reuses the existing dialog
// chrome (overlay + card + pill buttons). Used for irreversible/heavy
// actions where a bare native confirm isn't enough to set expectations —
// e.g. turning on on-device translation, which downloads a multi-GB model.
export function ConfirmDialog({ title, confirmLabel, cancelLabel = 'Cancel', onConfirm, onCancel, children }) {
  // Escape cancels; clicking the backdrop cancels too. The card stops
  // propagation so an inner click never closes it.
  useEscapeKey(onCancel, true)
  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div
        className="dialog-card confirm-card"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <span className="dialog-title">{title}</span>
          <button className="icon-btn" onClick={onCancel} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="confirm-message">{children}</div>
        <div className="dialog-actions">
          <button className="pill-btn" type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className="pill-btn suggested" type="button" onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
