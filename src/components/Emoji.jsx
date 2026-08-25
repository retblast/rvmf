import { useCallback, useEffect, useRef, useState } from 'react'
import { ProxiedImg } from './Media.jsx'
import { useEscapeKey } from '../hooks'

export const COMMON_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '😡', '🎉', '🔥', '💯', '🤔', '👏', '💀']

const EMOJI_NAMES = [
  ['thumbsup', '👍'], ['+1', '👍'], ['heart', '❤️'], ['red_heart', '❤️'],
  ['joy', '😂'], ['rofl', '😂'], ['laughing', '😂'],
  ['open_mouth', '😮'], ['surprised', '😮'], ['oh_no', '😮'],
  ['sob', '😢'], ['cry', '😢'], ['disappointed', '😢'],
  ['rage', '😡'], ['angry', '😡'],
  ['tada', '🎉'], ['confetti', '🎉'], ['party', '🎉'],
  ['fire', '🔥'], ['hot', '🔥'],
  ['100', '💯'], ['hundred', '💯'],
  ['thinking', '🤔'], ['thinking_face', '🤔'],
  ['clap', '👏'], ['applause', '👏'],
  ['skull', '💀'], ['dead', '💀'],
  ['heart_eyes', '😍'], ['sunglasses', '😎'], ['wink', '😉'],
  ['blush', '😊'], ['smile', '😊'], ['smiley', '😃'],
  ['neutral', '😐'], ['confused', '😕'], ['innocent', '😇'],
  ['cowboy', '🤠'], ['partying', '🥳'], ['cold', '🥶'],
  ['scream', '😱'], ['sleeping', '😴'], ['drool', '🤤'],
  ['vomit', '呕吐'], ['poop', '💩'], ['ghost', '👻'], ['alien', '👽'],
  ['rocket', '🚀'], ['star', '⭐'], ['zap', '⚡'], ['rainbow', '🌈'],
  ['sun', '☀️'], ['moon', '🌙'], ['cloud', '☁️'], ['umbrella', '☔'],
  ['coffee', '☕'], ['beer', '🍺'], ['wine', '🍷'], ['pizza', '🍕'],
  ['heart_on_fire', '❤️‍🔥'], ['broken_heart', '💔'], ['sparkles', '✨'],
  ['sparkling_heart', '💖'], ['raised_hands', '🙌'], ['pray', '🙏'],
  ['wave', '👋'], ['muscle', '💪'], ['thumbsdown', '👎'],
  ['eyes', '👀'], ['brain', '🧠'], ['love', '💕'],
  ['check', '✅'], ['x', '❌'], ['warning', '⚠️'],
  ['bulb', '💡'], ['link', '🔗'], ['mag', '🔍'],
  ['earth', '🌐'], ['globe', '🌐'], ['pin', '📌'],
  ['bell', '🔔'], ['lock', '🔒'], ['key', '🔑'],
  ['heavy_check_mark', '✅'], ['ballot_box_with_check', '☑️'],
]

export function filterEmoji(query, customEmojis) {
  const q = query.toLowerCase()
  const unicodeMatches = EMOJI_NAMES
    .filter(([name]) => name.includes(q))
    .map(([name, char]) => ({ name, char, type: 'unicode' }))
  const customMatches = (customEmojis || [])
    .filter((e) => e.shortcode.includes(q))
    .map((e) => ({ name: e.shortcode, url: e.static_url || e.url, type: 'custom' }))
  return [...unicodeMatches.slice(0, 15), ...customMatches.slice(0, 10)]
}

export function insertAtCaret(text, setText, textareaRef, insert) {
  const el = textareaRef.current
  if (!el) { setText(text + insert); return }
  const start = el.selectionStart
  const end = el.selectionEnd
  const next = text.slice(0, start) + insert + text.slice(end)
  setText(next)
  requestAnimationFrame(() => {
    el.focus()
    el.selectionStart = el.selectionEnd = start + insert.length
  })
}

export function useEmojiAutocomplete(text, setText, textareaRef, customEmojis) {
  const [query, setQuery] = useState(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [suggestions, setSuggestions] = useState([])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    const pos = el.selectionStart
    const before = text.slice(0, pos)
    const match = before.match(/:([a-zA-Z0-9_]{1,30})$/)
    if (match) {
      const q = match[1]
      const results = filterEmoji(q, customEmojis)
      if (results.length > 0) {
        setQuery({ text: q, start: pos - match[0].length, end: pos })
        setSuggestions(results)
        setSelectedIndex(0)
        return
      }
    }
    setQuery(null)
    setSuggestions([])
  }, [text, textareaRef, customEmojis])

  const acceptSelection = useCallback(() => {
    if (!query || suggestions.length === 0) return false
    const pick = suggestions[selectedIndex]
    if (!pick) return false
    const insert = pick.type === 'custom' ? `:${pick.name}:` : pick.char
    const el = textareaRef.current
    const before = text.slice(0, query.start)
    const after = text.slice(query.end)
    const next = before + insert + after
    setText(next)
    setQuery(null)
    setSuggestions([])
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

export function EmojiDropdown({ query, suggestions, selectedIndex, onSelect }) {
  if (!query || suggestions.length === 0) return null
  return (
    <div className="emoji-dropdown">
      {suggestions.map((s, i) => (
        <button
          key={s.name}
          className={`emoji-dropdown-item${i === selectedIndex ? ' selected' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); onSelect(s) }}
        >
          {s.type === 'custom'
            ? <ProxiedImg direct className="custom-emoji" src={s.url} alt={s.name} width="18" height="18" />
            : <span className="emoji-char">{s.char}</span>
          }
          <span className="emoji-name">:{s.name}:</span>
        </button>
      ))}
    </div>
  )
}

export function EmojiPicker({ customEmojis, onSelect, onClose }) {
  const ref = useRef(null)
  useEscapeKey(onClose)
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])
  return (
    <div className="emoji-picker" ref={ref}>
      {COMMON_EMOJI.map((ch) => (
        <button key={ch} className="emoji-pick-btn" onMouseDown={(e) => { e.preventDefault(); onSelect(ch) }}>
          {ch}
        </button>
      ))}
      {customEmojis.length > 0 && (
        <div className="emoji-picker-divider" />
      )}
      {customEmojis.slice(0, 20).map((e) => (
        <button key={e.shortcode} className="emoji-pick-btn" onMouseDown={(e2) => { e2.preventDefault(); onSelect(`:${e.shortcode}:`) }}>
          <ProxiedImg direct className="custom-emoji" src={e.static_url || e.url} alt={e.shortcode} width="18" height="18" />
        </button>
      ))}
    </div>
  )
}
