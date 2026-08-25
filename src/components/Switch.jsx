// Adwaita-style toggle switch (HIG: preferred over checkboxes for
// binary on/off controls). Keyboard-operable via role="switch".
export function Switch({ checked, onChange, disabled = false, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`adw-switch${checked ? ' checked' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="adw-switch-knob" />
    </button>
  )
}
