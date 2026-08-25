// HIG placeholder-page pattern: symbolic icon, heading, description,
// optional suggested action. For genuine empty states — not loading
// or error text.
export function StatusPage({ icon: Icon, heading, description, actionLabel, onAction }) {
  return (
    <div className="status-page">
      {Icon && <Icon size={40} className="status-page-icon" />}
      <div className="status-page-heading">{heading}</div>
      {description && <div className="status-page-description">{description}</div>}
      {actionLabel && onAction && (
        <button type="button" className="pill-btn suggested" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  )
}
