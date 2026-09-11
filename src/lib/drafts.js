import { storageGet, storageSet, storageRemove } from './storage.js'

const DRAFT_PREFIX = 'rvmf:draft:'
// storage.js prepends 'rvmf-' to every key, so the actual localStorage
// prefix is 'rvmf-rvmf:draft:'.
const LS_PREFIX = 'rvmf-' + DRAFT_PREFIX
const DRAFT_VERSION = 1

export function getDraftKey(context) {
  // context: { replyToStatusId?, quoteStatusId?, groupId? }
  if (context.replyToStatusId) return `${DRAFT_PREFIX}reply:${context.replyToStatusId}`
  if (context.quoteStatusId) return `${DRAFT_PREFIX}quote:${context.quoteStatusId}`
  if (context.groupId) return `${DRAFT_PREFIX}group:${context.groupId}`
  return `${DRAFT_PREFIX}new`
}

export function saveDraft(key, draft) {
  try {
    const payload = { version: DRAFT_VERSION, ...draft, updatedAt: Date.now() }
    storageSet(key, JSON.stringify(payload))
  } catch (err) {
    console.warn('Failed to save draft:', err)
  }
}

export function loadDraft(key) {
  try {
    const raw = storageGet(key)
    if (!raw) return null
    const stored = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!stored || stored.version !== DRAFT_VERSION) return null
    return stored
  } catch (err) {
    console.warn('Failed to load draft:', err)
    return null
  }
}

export function clearDraft(key) {
  try {
    storageRemove(key)
  } catch (err) {
    console.warn('Failed to clear draft:', err)
  }
}

export function getAllDraftKeys() {
  try {
    const keys = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(LS_PREFIX)) keys.push(key)
    }
    return keys
  } catch {
    return []
  }
}

export function getAllDrafts() {
  const keys = getAllDraftKeys()
  return keys.map((key) => ({ key, ...loadDraft(key) })).filter(Boolean)
}
