// Centralized Escape-key dispatch. Every closable surface registers a
// handler with an explicit priority; a single window listener forwards
// each Escape press to the highest-priority active handler only. This
// replaces the old scheme where popup components attached their own
// window listeners and fought over `stopImmediatePropagation`, so the
// close order now follows intent (media > confirms > menus > dialogs >
// panels) instead of React effect timing.

// Higher number = closed first by Escape. Ties break toward the most
// recently registered entry, so nested surfaces of the same kind (a
// picker opened over another menu) unwind top-first like a stack.
export const ESCAPE_PRIORITY = {
  media: 400,
  confirm: 300,
  menu: 200,
  dialog: 100,
  panel: 50,
}

const entries = []
let seq = 0
let listening = false

function onKey(e) {
  // Something earlier in the event path (e.g. the emoji autocomplete
  // inside a textarea) already consumed this press.
  if (e.key !== 'Escape' || e.defaultPrevented) return
  if (entries.length === 0) return
  let best = null
  for (const entry of entries) {
    if (!best || entry.priority > best.priority || (entry.priority === best.priority && entry.seq > best.seq)) {
      best = entry
    }
  }
  e.preventDefault()
  best.handler(e)
}

function ensureListening() {
  if (listening) return
  listening = true
  window.addEventListener('keydown', onKey)
}

export function registerEscapeHandler(priority, handler) {
  const entry = { priority, seq: ++seq, handler }
  entries.push(entry)
  ensureListening()
  let done = false
  return function unregister() {
    if (done) return
    done = true
    const idx = entries.indexOf(entry)
    if (idx !== -1) entries.splice(idx, 1)
  }
}
