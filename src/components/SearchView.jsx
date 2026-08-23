import { useEffect, useRef, useState } from 'react'
import { Search as SearchIcon } from 'lucide-react'
import * as mitra from '../lib/mitra'
import { formatRelativeTime } from '../lib/render.jsx'
import { Avatar } from './Media.jsx'
import { PostRow } from './Post.jsx'

// Debounced search across accounts, statuses and hashtags
// (Mitra's Mastodon-compatible /v2/search). Results render stacked:
// people first, then matching posts, then hashtag chips that open the
// tag's timeline.
export function SearchView({
  instanceUrl,
  token,
  onOpenThread,
  onComposeReply,
  onOpenLightbox,
  onOpenProfile,
  onUpdatePost,
  onQuote,
  currentAccountId,
  onDelete,
  onMute,
  onBlock,
  onEdit,
  onOpenHashtag,
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const debounceRef = useRef(null)
  const requestSeq = useRef(0)

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults(null)
      setError('')
      setLoading(false)
      return undefined
    }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      const seq = ++requestSeq.current
      try {
        const res = await mitra.search(instanceUrl, token, q)
        if (seq === requestSeq.current) setResults(res)
      } catch (err) {
        if (seq === requestSeq.current) {
          setError(err.message || 'Search failed.')
          setResults(null)
        }
      } finally {
        if (seq === requestSeq.current) setLoading(false)
      }
    }, 400)
    return () => clearTimeout(debounceRef.current)
  }, [query])

  const hasAny = results && (results.accounts?.length || results.statuses?.length || results.hashtags?.length)

  return (
    <div className="timeline-wrap">
      <div className="search-bar">
        <SearchIcon size={15} />
        <input
          type="text"
          className="search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search posts, people, hashtags…"
          autoFocus
        />
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      {!query.trim() ? (
        <div className="empty-state">Type something to search.</div>
      ) : loading && !results ? (
        <div className="empty-state">Searching…</div>
      ) : !hasAny ? (
        <div className="empty-state">No results.</div>
      ) : (
        <>
          {results.accounts?.length > 0 && (
            <>
              <div className="section-label">People</div>
              <div className="timeline-list">
                {results.accounts.map((account) => (
                  <button
                    type="button"
                    key={account.id}
                    className="search-account-row"
                    onClick={() => onOpenProfile(account)}
                  >
                    <Avatar name={account.display_name || account.username} src={account.avatar} />
                    <div className="search-account-names">
                      <span className="post-name">{account.display_name || account.username}</span>
                      <span className="post-handle">@{account.acct || account.username}</span>
                    </div>
                    {account.note && <span className="search-account-note">{account.note}</span>}
                  </button>
                ))}
              </div>
            </>
          )}
          {results.statuses?.length > 0 && (
            <>
              <div className="section-label">Posts</div>
              <div className="timeline-list">
                {results.statuses.map((post) => (
                  <PostRow
                    key={post.id}
                    post={post}
                    instanceUrl={instanceUrl}
                    token={token}
                    onUpdate={onUpdatePost}
                    onOpenThread={onOpenThread}
                    onComposeReply={onComposeReply}
                    onOpenLightbox={onOpenLightbox}
                    onOpenProfile={onOpenProfile}
                    onQuote={onQuote}
                    currentAccountId={currentAccountId}
                    onDelete={onDelete}
                    onMute={onMute}
                    onBlock={onBlock}
                    onEdit={onEdit}
                  />
                ))}
              </div>
            </>
          )}
          {results.hashtags?.length > 0 && (
            <>
              <div className="section-label">Hashtags</div>
              <div className="search-hashtags">
                {results.hashtags.map((tag) => (
                  <button
                    type="button"
                    key={tag.name}
                    className="pill-btn"
                    onClick={() => onOpenHashtag(tag.name)}
                  >
                    #{tag.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
