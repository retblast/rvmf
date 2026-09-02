import { useEffect, useMemo, useRef, useState } from 'react'
import { Search as SearchIcon } from 'lucide-react'
import * as mitra from '../lib/mitra'
import { htmlToPlainText } from '../lib/render.jsx'
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
  // 'all' hits every category in one request; the tabs just filter what's
  // displayed (the API call itself is always untyped).
  const [tab, setTab] = useState('all')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const searchStatusById = useMemo(() => {
    const m = new Map()
    for (const p of results?.statuses || []) { m.set(p.id, p); if (p.reblog) m.set(p.reblog.id, p.reblog) }
    return m
  }, [results])
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
      // Mitra's untyped search only finds posts for ">text", tags for
      // "#tag", and people for a single username-shaped token — plain
      // multi-word text is ignored entirely. Typed requests bypass that
      // parser (type=statuses goes straight to full-text search), so
      // each category gets the request shape it actually understands.
      const firstToken = q.split(/\s+/)[0]
      const tagQuery = `#${firstToken.replace(/^#/, '')}`
      const acctQuery = firstToken
      async function searchAccounts() {
        return mitra.search(instanceUrl, token, acctQuery, { type: 'accounts' })
      }
      async function searchPosts() {
        return mitra.search(instanceUrl, token, q.replace(/^>+/, '').trim(), { type: 'statuses' })
      }
      async function searchHashtags() {
        if (!/^\w+$/.test(tagQuery.slice(1))) return { accounts: [], statuses: [], hashtags: [] }
        return mitra.search(instanceUrl, token, tagQuery)
      }
      try {
        let res
        if (tab === 'accounts') {
          res = await searchAccounts()
        } else if (tab === 'statuses') {
          res = await searchPosts()
        } else if (tab === 'hashtags') {
          res = await searchHashtags()
        } else {
          const [accounts, statuses, hashtags] = await Promise.all([
            searchAccounts().catch(() => ({ accounts: [] })),
            searchPosts().catch(() => ({ statuses: [] })),
            searchHashtags(),
          ])
          res = {
            accounts: accounts.accounts || [],
            statuses: statuses.statuses || [],
            hashtags: hashtags.hashtags || [],
          }
        }
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
  }, [query, tab])

  const hasAny = results && (results.accounts?.length || results.statuses?.length || results.hashtags?.length)

  const showAccounts = tab === 'all' || tab === 'accounts'
  const showStatuses = tab === 'all' || tab === 'statuses'
  const showHashtags = tab === 'all' || tab === 'hashtags'
  const visibleAny = results && (
    (showAccounts && results.accounts?.length) ||
    (showStatuses && results.statuses?.length) ||
    (showHashtags && results.hashtags?.length)
  )

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
      {query.trim() && (
        <div className="feed-toggle search-tabs">
          {[['all', 'All'], ['accounts', 'People'], ['statuses', 'Posts'], ['hashtags', 'Hashtags']].map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`feed-toggle-btn${tab === key ? ' active' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {error && <div className="banner banner-error">{error}</div>}
      <div className="search-hint">
        Posts match full text; people need a single @handle or name token;
        hashtags take #tag. Prefixing with <code>&gt;</code> is no longer
        required.
      </div>
      {!query.trim() ? (
        <div className="empty-state">Type something to search.</div>
      ) : loading && !results ? (
        <div className="empty-state">Searching…</div>
      ) : !hasAny ? (
        <div className="empty-state">No results.</div>
      ) : !visibleAny ? (
        <div className="empty-state">No {tab === 'all' ? '' : `${tab} `}results.</div>
      ) : (
        <>
          {showAccounts && results.accounts?.length > 0 && (
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
                    {account.note && <span className="search-account-note">{htmlToPlainText(account.note)}</span>}
                  </button>
                ))}
              </div>
            </>
          )}
          {showStatuses && results.statuses?.length > 0 && (
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
                    statusById={searchStatusById}
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
          {showHashtags && results.hashtags?.length > 0 && (
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
