import { useCallback, useEffect, useRef, useState } from 'react'
import * as mitra from '../lib/mitra'
import { Avatar } from './Media.jsx'

// Session-level cache of username-prefix searches so retyping the same
// prefix doesn't re-hit the API. Keyed by instance + query.
const searchCache = new Map()

function searchAccountsCached(instanceUrl, token, q) {
  const key = `${instanceUrl}|${q}`
  if (!searchCache.has(key)) {
    const promise = mitra.searchAccounts(instanceUrl, token, q).catch(() => {
      searchCache.delete(key)
      return []
    })
    searchCache.set(key, promise)
    if (searchCache.size > 200) {
      searchCache.delete(searchCache.keys().next().value)
    }
  }
  return searchCache.get(key)
}

// "@" at a word boundary followed by handle characters (letters, digits,
// underscores, domain dots). The lookbehind keeps email addresses and
// mid-word "@" from triggering suggestions.
const MENTION_RE = /(?<![a-zA-Z0-9])@([a-zA-Z0-9_.]{1,60})$/

export function useMentionAutocomplete(text, setText, textareaRef, instanceUrl, token) {
  const [query, setQuery] = useState(null) // { start, end } caret range of the @token
  const [suggestions, setSuggestions] = useState([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const lastPrefixRef = useRef('')

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return undefined
    const pos = el.selectionStart
    const before = text.slice(0, pos)
    const match = before.match(MENTION_RE)

    if (!match || !match[1]) {
      setQuery(null)
      setSuggestions([])
      setSelectedIndex(0)
      lastPrefixRef.current = ''
      return undefined
    }

    setQuery({ start: pos - match[0].length, end: pos })

    // New prefix invalidates the old result list immediately — stale
    // suggestions for "jo" must not flash under a query for "joh".
    if (match[1] !== lastPrefixRef.current) {
      lastPrefixRef.current = match[1]
      setSuggestions([])
      setSelectedIndex(0)
    }

    let cancelled = false
    const timer = setTimeout(() => {
      searchAccountsCached(instanceUrl, token, match[1]).then((accounts) => {
        if (!cancelled) setSuggestions(accounts || [])
      })
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [text, textareaRef, instanceUrl, token])

  const acceptSelection = useCallback((index = selectedIndex) => {
    if (!query || suggestions.length === 0) return false
    const pick = suggestions[index]
    if (!pick) return false
    // Trailing space ends the token — keeps typing from extending the
    // mention into the next word.
    const insert = `@${pick.acct || pick.username} `
    const el = textareaRef.current
    const next = text.slice(0, query.start) + insert + text.slice(query.end)
    setText(next)
    setQuery(null)
    setSuggestions([])
    setSelectedIndex(0)
    lastPrefixRef.current = ''
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      const pos = query.start + insert.length
      el.selectionStart = el.selectionEnd = pos
    })
    return true
  }, [query, suggestions, selectedIndex, text, setText, textareaRef])

  const handleKeyDown = useCallback((e) => {
    if (!query || suggestions.length === 0) return false
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => (i + 1) % suggestions.length)
      return true
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => (i - 1 + suggestions.length) % suggestions.length)
      return true
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      acceptSelection()
      return true
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setQuery(null)
      setSuggestions([])
      return true
    }
    return false
  }, [query, suggestions, acceptSelection])

  return { query, suggestions, selectedIndex, handleKeyDown, acceptSelection }
}

export function MentionDropdown({ query, suggestions, selectedIndex, onSelect }) {
  if (!query || suggestions.length === 0) return null
  return (
    <div className="emoji-dropdown mention-dropdown">
      {suggestions.map((account, i) => (
        <button
          key={account.id}
          className={`emoji-dropdown-item mention-dropdown-item${i === selectedIndex ? ' selected' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); onSelect(i) }}
        >
          <Avatar name={account.display_name || account.username} src={account.avatar} size={20} />
          <span className="mention-names">
            <span className="post-name">{account.display_name || account.username}</span>
            <span className="post-handle">@{account.acct || account.username}</span>
          </span>
        </button>
      ))}
    </div>
  )
}
