import { useEffect, useState } from 'react'

// Global toast stack. Anything in the app emits a toast with
// window.dispatchEvent(new CustomEvent('rvmf-toast', { detail: message }))
// so deeply nested code doesn't need a context; this component owns the
// stack and the auto-dismiss timers.
export function ToastStack() {
  const [toasts, setToasts] = useState([])

  useEffect(() => {
    function onToast(e) {
      const id = `${Date.now()}-${Math.random()}`
      setToasts((prev) => [...prev, { id, message: e.detail }])
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000)
    }
    window.addEventListener('rvmf-toast', onToast)
    return () => window.removeEventListener('rvmf-toast', onToast)
  }, [])

  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast" data-testid="toast">{t.message}</div>
      ))}
    </div>
  )
}
