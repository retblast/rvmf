import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Rss,
  Home,
  Bell,
  Compass,
  Plus,
  MessageCircle,
  Repeat2,
  Star,
  MoreHorizontal,
  RotateCw,
  LogOut,
  X,
  Music,
  Paperclip,
  Eye,
  EyeOff,
  UserPlus,
  AtSign,
  Globe,
  ImagePlus,
  ArrowLeft,
  Settings,
  ChevronLeft,
  ChevronRight,
  Smile,
  Link,
  User,
  Image as ImageIcon,
} from 'lucide-react'
import { useMitraSession } from './useMitraSession'
import * as mitra from './lib/mitra'
import LoginView from './LoginView'

const EASE = [0.32, 0.72, 0, 1]

// A handful of cross-cutting display preferences that MediaItem needs deep
// in the tree (timeline post, nested reply, notification preview, panel —
// four+ levels of prop drilling for something this minor isn't worth it).
// Persisted so it survives a reload.
const AppSettingsContext = createContext({ hoverPreviewsEnabled: true })
const PickerContext = createContext({ openPickerId: null, setOpenPickerId: () => {} })

// Panel-opening choreography: the focal post slides in from the direction
// of the timeline; ancestors stagger into place converging upward toward
// it (closest ancestor first, since it's nearest the anchor); replies
// stagger into place converging downward (closest reply first). Everything
// arranges itself around the post you actually clicked.
const focalVariants = {
  hidden: { opacity: 0, x: -18 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.32, ease: EASE } },
}
const ancestorItemVariants = {
  hidden: { opacity: 0, y: -14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
}
const descendantItemVariants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
}
const staggerUpVariants = {
  hidden: {},
  visible: { transition: { delayChildren: 0.1, staggerChildren: 0.05, staggerDirection: -1 } },
}
const staggerDownVariants = {
  hidden: {},
  visible: { transition: { delayChildren: 0.1, staggerChildren: 0.05 } },
}

function formatRelativeTime(iso) {
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diffSec < 60) return `${Math.max(diffSec, 0)}s`
  const min = Math.floor(diffSec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d`
  return new Date(iso).toLocaleDateString()
}

// .textContent alone collapses block-level structure entirely — Mastodon-
// API content is typically `<p>...</p><p>...</p>`, and .textContent runs
// those together with no space at all ("...outimage.jpg" instead of
// "...out\nimage.jpg"). Insert real line breaks at block boundaries first
// so paragraphs, explicit <br>s, and list items don't run into each other
// or into a following link.
function htmlToPlainText(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html')
  doc.querySelectorAll('p.quote-inline, .quote-inline').forEach((el) => el.remove())
  doc.querySelectorAll('img.custom-emoji').forEach((img) => {
    const alt = img.getAttribute('alt') || img.getAttribute('title') || ':emoji:'
    img.replaceWith(alt)
  })
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'))
  doc.querySelectorAll('p, div, li').forEach((el) => {
    el.insertAdjacentText('afterend', '\n')
  })
  const text = doc.body.textContent || ''
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

// `/context` returns every descendant of a status in one flat call — every
// depth, not just direct replies. Build that into an actual tree once, up
// front, so the whole thread can render fully expanded without any further
// per-node fetches: this is what "all known replies" actually means.
function buildReplyTree(descendants, rootId) {
  const byParent = new Map()
  descendants.forEach((s) => {
    const list = byParent.get(s.in_reply_to_id) || []
    list.push(s)
    byParent.set(s.in_reply_to_id, list)
  })
  function attach(parentId) {
    return (byParent.get(parentId) || []).map((child) => ({
      status: child,
      children: attach(child.id),
    }))
  }
  return attach(rootId)
}

// Find a node by status id anywhere in the tree
function findNode(nodes, statusId) {
  if (!nodes) return null
  for (const node of nodes) {
    if (node.status.id === statusId) return node
    const found = findNode(node.children, statusId)
    if (found) return found
  }
  return null
}

// Insert a reply as a child of the node with the given status id (immutably)
function insertIntoTree(nodes, parentId, newReply) {
  return nodes.map((node) => {
    if (node.status.id === parentId) {
      return { ...node, children: [...node.children, newReply] }
    }
    return { ...node, children: insertIntoTree(node.children, parentId, newReply) }
  })
}

// Replaces one status object at whatever depth it's found in an already-
// built reply tree, leaving everything else untouched — used after a
// favourite/boost so the UI reflects it without a refetch.
function updateTreeNode(nodes, updated) {
  return nodes.map((node) => {
    if (node.status.id === updated.id) {
      return { ...node, status: updated }
    }
    if (node.children.length > 0) {
      return { ...node, children: updateTreeNode(node.children, updated) }
    }
    return node
  })
}

// Turns "@handle" substrings AND bare URLs in plain text into real links,
// in a single pass. Mentions are matched against the status's `mentions`
// array; URLs are matched generically since Mastodon-API content often
// contains links that aren't attachments at all (someone just pasted a
// pixiv/booru/whatever URL). This was the actual bug behind links "not
// being detected" — only @mentions were ever linkified before; bare URLs
// were left as flat, unclickable text. Works on plain text (not the
// original HTML) on purpose — no dangerouslySetInnerHTML anywhere, just
// safe React nodes built from a regex split.
const URL_RE_SOURCE = 'https?://[^\\s<>"]+'

function shortenUrlForDisplay(url) {
  try {
    const u = new URL(url)
    let display = u.host + u.pathname + u.search
    if (display.length > 32) display = `${display.slice(0, 32)}…`
    return display
  } catch {
    return url.length > 32 ? `${url.slice(0, 32)}…` : url
  }
}

function renderRichText(text, mentions, emojis) {
  const needles = []
  ;(mentions || []).forEach((m) => {
    if (m.acct) needles.push(m.acct)
    if (m.username && m.username !== m.acct) needles.push(m.username)
  })

  const emojiMap = new Map()
  ;(emojis || []).forEach((e) => emojiMap.set(e.shortcode, e))

  const patternParts = []
  if (needles.length > 0) {
    const escaped = [...new Set(needles)]
      .sort((a, b) => b.length - a.length)
      .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    patternParts.push(`@(?:${escaped.join('|')})\\b`)
  }
  patternParts.push(':[a-zA-Z0-9_+-]+:')
  patternParts.push('#[\\w]+')
  patternParts.push(URL_RE_SOURCE)
  const pattern = new RegExp(`(${patternParts.join('|')})`, 'g')

  const parts = []
  let lastIndex = 0
  let match
  let key = 0
  while ((match = pattern.exec(text)) !== null) {
    const token = match[0]
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    if (token.startsWith('@')) {
      const handle = token.slice(1)
      const mention = mentions.find((m) => m.acct === handle || m.username === handle)
      parts.push(
        <a
          key={`m-${key++}`}
          className="mention-link"
          href={mention?.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          @{handle}
        </a>
      )
    } else if (token.startsWith(':') && token.endsWith(':')) {
      const shortcode = token.slice(1, -1)
      const emoji = emojiMap.get(shortcode)
      if (emoji) {
        parts.push(
          <ProxiedImg
            key={`e-${key++}`}
            className="custom-emoji"
            src={emoji.url}
            alt={token}
            title={token}
          />
        )
      } else {
        parts.push(token)
      }
    } else if (token.startsWith('#')) {
      parts.push(
        <button
          key={`h-${key++}`}
          className="hashtag-link"
          onClick={(e) => {
            e.stopPropagation()
            alert('not yet wired up :P')
          }}
        >
          {token}
        </button>
      )
    } else {
      parts.push(
        <a
          key={`u-${key++}`}
          className="mention-link"
          href={token}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          {shortenUrlForDisplay(token)}
        </a>
      )
    }
    lastIndex = pattern.lastIndex
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts
}

const IMAGE_URL_RE = /https?:\/\/[^\s<>"]+?\.(?:jpe?g|png|gif|webp|avif)(?:\?[^\s<>"]*)?/gi

function hostOf(url) {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

// Some instance admins disable inline embedding of remote media as a
// moderation measure (quarantining unruly remote instances) — the image
// just shows up as a bare link in the post text instead of an attachment.
// Pull those links out of the text and treat them as attachments again,
// client-side when:
//   1. The link points at the *same* instance we're logged into — there's
//      no moderation reason for it to be hidden from us specifically; or
//   2. The link's host matches the poster's domain — instance owners may
//      disable inline embedding for a whole remote instance, so the
//      poster's own images get suppressed; recovering them here lets the
//      user see what was posted.
// In both cases the recovered image is still marked sensitive so it goes
// through the normal CW/blur flow.
function extractQuarantinedImages(text, instanceUrl, posterAcct) {
  const instanceHost = hostOf(instanceUrl)
  if (!instanceHost) return { cleanedText: text, quarantinedUrls: [], posterRecoveryUrls: [] }

  // Only remote accts carry "@domain" — local ones have no poster domain,
  // so there's nothing to recover from.
  const posterDomain = posterAcct && posterAcct.includes('@') ? posterAcct.split('@')[1] : null
  const posterHost = posterDomain ? hostOf('https://' + posterDomain) : ''

  const quarantinedUrls = []
  const posterRecoveryUrls = []
  const cleanedText = text
    .replace(IMAGE_URL_RE, (match) => {
      const linkHost = hostOf(match)
      if (linkHost === instanceHost) {
        quarantinedUrls.push(match)
        return ''
      }
      if (posterHost && linkHost === posterHost) {
        posterRecoveryUrls.push(match)
        return ''
      }
      return match
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { cleanedText, quarantinedUrls, posterRecoveryUrls }
}

// Combines mention-linking and quarantined-image extraction into what a
// post/reply actually needs to render: text nodes plus a merged attachment
// list (real attachments + any quarantined images recovered from the text).
function processStatusContent(status, instanceUrl) {
  const { cleanedText, quarantinedUrls, posterRecoveryUrls } = extractQuarantinedImages(
    htmlToPlainText(status.content),
    instanceUrl,
    status.account?.acct
  )
  const textNodes = renderRichText(cleanedText, status.mentions, status.emojis)

  // Both local-instance and poster-domain recovered images are shown behind
  // the CW blur — the admin disabled inline embedding for a reason, and
  // we don't know why, so blur is the safe default.
  const allRecovered = [...quarantinedUrls, ...posterRecoveryUrls]
  const quarantinedAttachments = allRecovered.map((url, i) => ({
    id: `quarantined-${status.id}-${i}`,
    type: 'image',
    url,
    preview_url: url,
    description: '',
  }))

  // For remote posts, the instance proxies media through its own domain.
  // When that proxy breaks (404), we can try the original server directly
  // by swapping the domain in the URL with the poster's home domain.
  const instanceHost = hostOf(instanceUrl)
  const acct = status.account?.acct || ''
  const remoteHost = acct.includes('@') ? acct.split('@')[1] : ''

  const attachments = [
    ...(status.media_attachments || []),
    ...quarantinedAttachments,
  ].map((att) => {
    const enriched = { ...att, _status_uri: status.uri || null, _origin_host: remoteHost || null }
    if (!remoteHost || remoteHost === instanceHost) return enriched
    if (att.remote_url) return enriched
    try {
      const u = new URL(att.url)
      if (u.host === instanceHost) {
        u.host = remoteHost
        return { ...enriched, _remote_fallback: u.toString() }
      }
    } catch {}
    return enriched
  })

  const hasQuarantined = quarantinedAttachments.length > 0
  const sensitive = status.sensitive || hasQuarantined
  const spoilerText = status.sensitive
    ? status.spoiler_text
    : hasQuarantined
      ? "Image hidden by this instance's media settings"
      : status.spoiler_text

  return { textNodes, attachments, sensitive, spoilerText }
}

function Avatar({ name, src, large, size, onClick }) {
  const [imgFailed, setImgFailed] = useState(false)
  const style = size ? { width: size, height: size } : undefined
  const cls = `avatar${large ? ' lg' : ''}${onClick ? ' clickable' : ''}`
  if (src && !imgFailed) {
    return <ProxiedImg className={cls} style={style} src={src} onError={() => setImgFailed(true)} onClick={onClick} />
  }
  const initials = (name || '?')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return (
    <div className={cls} style={style} onClick={onClick}>
      {initials}
    </div>
  )
}

// A status as returned by the timeline can itself be a boost: in that case
// `post.account` is whoever boosted it, and the actual post — content,
// author, counts, your favourite/reblog state — lives in `post.reblog`.
// Everything that isn't the "so-and-so boosted" line should read from here.
function unwrapStatus(post) {
  return post.reblog || post
}

// Positions a floating preview near the cursor, clamped so it never runs
// off the edge of the viewport.
function useCursorPreview(previewWidth = 320, previewHeight = 320) {
  const [pos, setPos] = useState(null)

  function track(e) {
    const margin = 16
    let x = e.clientX + 18
    let y = e.clientY + 18
    if (x + previewWidth + margin > window.innerWidth) x = e.clientX - previewWidth - 18
    if (y + previewHeight + margin > window.innerHeight) y = e.clientY - previewHeight - 18
    setPos({ x, y })
  }
  function clear() {
    setPos(null)
  }

  return { pos, track, clear }
}

// Blob URLs fetched through the dev proxy are cached so scrolling back
// doesn't refetch them. Object URLs are never GC'd while alive, so the
// cache is bounded: oldest entries are evicted and their blob URLs
// revoked once the cap is exceeded.
const CLIENT_MEDIA_CACHE_MAX = 150
const clientMediaCache = new Map()

function getCachedClientMedia(url) {
  if (!clientMediaCache.has(url)) return undefined
  const blobUrl = clientMediaCache.get(url)
  clientMediaCache.delete(url)
  clientMediaCache.set(url, blobUrl) // refresh insertion order (recency)
  return blobUrl
}

function cacheClientMedia(url, blobUrl) {
  if (clientMediaCache.has(url)) clientMediaCache.delete(url)
  clientMediaCache.set(url, blobUrl)
  while (clientMediaCache.size > CLIENT_MEDIA_CACHE_MAX) {
    const oldestKey = clientMediaCache.keys().next().value
    URL.revokeObjectURL(clientMediaCache.get(oldestKey))
    clientMediaCache.delete(oldestKey)
  }
}

function proxyUrl(url) {
  return `/media-proxy?url=${encodeURIComponent(url)}`
}

function safeProxyUrl(url) {
  if (!url || url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('/')) return url
  return proxyUrl(url)
}

function useClientMedia(...args) {
  const resolveUrls = typeof args[args.length - 1] === 'function' ? args.pop() : null
  const urls = args
  const key = urls.filter(Boolean).join('\0')
  const [state, setState] = useState(() => {
    if (!key) return { blobUrl: null, loading: false, error: false }
    for (const u of urls) {
      if (u) {
        const cached = getCachedClientMedia(u)
        if (cached) return { blobUrl: cached, loading: false, error: false }
      }
    }
    return { blobUrl: null, loading: true, error: false }
  })

  useEffect(() => {
    if (!key) return
    for (const u of urls) {
      if (u) {
        const cached = getCachedClientMedia(u)
        if (cached) { setState({ blobUrl: cached, loading: false, error: false }); return }
      }
    }

    let cancelled = false
    async function load() {
      for (const u of urls) {
        if (!u) continue
        try {
          const res = await fetch(proxyUrl(u))
          if (!res.ok) continue
          const blob = await res.blob()
          const blobUrl = URL.createObjectURL(blob)
          cacheClientMedia(u, blobUrl)
          if (!cancelled) setState({ blobUrl, loading: false, error: false })
          return
        } catch {
          // try next URL
        }
      }
      if (resolveUrls && !cancelled) {
        try {
          const extra = await resolveUrls()
          for (const u of (extra || [])) {
            if (!u) continue
            const cached = getCachedClientMedia(u)
            if (cached) {
              if (!cancelled) setState({ blobUrl: cached, loading: false, error: false })
              return
            }
            try {
              const res = await fetch(proxyUrl(u))
              if (!res.ok) continue
              const blob = await res.blob()
              const blobUrl = URL.createObjectURL(blob)
              cacheClientMedia(u, blobUrl)
              if (!cancelled) setState({ blobUrl, loading: false, error: false })
              return
            } catch {}
          }
        } catch {}
      }
      if (!cancelled) setState({ blobUrl: null, loading: false, error: true })
    }
    load()
    return () => { cancelled = true }
  }, [key])

  return state
}

function ProxiedImg({ src, fallbackSrc, alt, className, style, onError, ...rest }) {
  const { fetchClientMedia } = useContext(AppSettingsContext)
  const { blobUrl, loading, error } = useClientMedia(
    fetchClientMedia && src ? src : null,
    fetchClientMedia && fallbackSrc ? fallbackSrc : null
  )
  useEffect(() => {
    if (error && onError) onError()
  }, [error, onError])
  if (!src) return null
  if (fetchClientMedia) {
    if (error) return null
    if (!blobUrl) return null
    return <img src={blobUrl} alt={alt || ''} className={className} style={style} {...rest} />
  }
  return <img src={safeProxyUrl(src)} alt={alt || ''} className={className} style={style} loading="lazy" {...rest} />
}

function MediaItem({ attachment, revealed, onOpenLightbox }) {
  const { type, url, preview_url: previewUrl, remote_url: remoteUrl, description } = attachment
  const remoteFallback = attachment._remote_fallback || null
  const { hoverPreviewsEnabled, fetchClientMedia, instanceUrl, token } = useContext(AppSettingsContext)
  const { pos, track, clear } = useCursorPreview()
  const hoverEnabled = revealed && hoverPreviewsEnabled

  const resolveAtt = useCallback(async () => {
    if (!instanceUrl || !attachment.id || typeof attachment.id === 'string' && attachment.id.startsWith('quarantined-')) return []
    try {
      const apiUrl = `${instanceUrl}/api/v1/media/${attachment.id}`
      const proxyRes = await fetch(proxyUrl(apiUrl), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (proxyRes.ok) {
        const fresh = await proxyRes.json()
        const urls = [fresh.remote_url, fresh.url, fresh.preview_url].filter(Boolean)
        if (urls.length > 0) return urls
      }
    } catch {}
    const statusUri = attachment._status_uri
    if (!statusUri) return []
    try {
      const apRes = await fetch(proxyUrl(statusUri), {
        headers: { 'Accept': 'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"' }
      })
      if (!apRes.ok) return []
      const ap = await apRes.json()
      const atts = ap.attachment || []
      return atts.flatMap((a) => [a.url, a.href].filter(Boolean))
    } catch { return [] }
  }, [instanceUrl, token, attachment.id, attachment._status_uri])

  const { blobUrl: imgBlob, loading: imgLoading, error: imgError } = useClientMedia(
    fetchClientMedia && type === 'image' ? (previewUrl || url) : null,
    fetchClientMedia && type === 'image' ? url : null,
    fetchClientMedia && type === 'image' ? remoteUrl : null,
    fetchClientMedia && type === 'image' ? remoteFallback : null,
    fetchClientMedia && type === 'image' ? resolveAtt : null
  )
  const { blobUrl: vidBlob, loading: vidLoading, error: vidError } = useClientMedia(
    fetchClientMedia && (type === 'video' || type === 'gifv') ? url : null,
    fetchClientMedia && (type === 'video' || type === 'gifv') ? remoteUrl : null,
    fetchClientMedia && (type === 'video' || type === 'gifv') ? remoteFallback : null,
    fetchClientMedia && (type === 'video' || type === 'gifv') ? resolveAtt : null
  )
  const { blobUrl: audBlob, loading: audLoading, error: audError } = useClientMedia(
    fetchClientMedia && type === 'audio' ? url : null,
    fetchClientMedia && type === 'audio' ? remoteUrl : null,
    fetchClientMedia && type === 'audio' ? remoteFallback : null,
    fetchClientMedia && type === 'audio' ? resolveAtt : null
  )

  if (type === 'image') {
    const showImg = fetchClientMedia ? (imgBlob || imgError) : true
    const imgSrc = imgBlob || safeProxyUrl(previewUrl || url)
    return (
      <>
        <button
          type="button"
          className={`media-item media-image${imgLoading ? ' media-loading' : ''}${imgError ? ' media-error' : ''}`}
          onClick={() => onOpenLightbox(attachment)}
          onMouseMove={hoverEnabled ? track : undefined}
          onMouseEnter={hoverEnabled ? track : undefined}
          onMouseLeave={hoverEnabled ? clear : undefined}
          aria-label={description || 'Open image'}
        >
          {showImg && <img src={imgSrc} alt={description || ''} />}
          {imgLoading && <div className="media-loading-overlay"><div className="media-spinner" /></div>}
          {imgError && <div className="media-error-overlay"><span>Failed to load</span></div>}
        </button>
        {hoverEnabled && pos && imgBlob && (
          <div className="media-hover-preview" style={{ left: pos.x, top: pos.y }}>
            <img src={imgBlob} alt={description || ''} />
          </div>
        )}
      </>
    )
  }

  if (type === 'video' || type === 'gifv') {
    const showVid = fetchClientMedia ? (vidBlob || vidError) : true
    const vidSrc = vidBlob || safeProxyUrl(url)
    return (
      <>
        <div
          className={`media-item media-video${vidLoading ? ' media-loading' : ''}${vidError ? ' media-error' : ''}`}
          onMouseMove={hoverEnabled ? track : undefined}
          onMouseEnter={hoverEnabled ? track : undefined}
          onMouseLeave={hoverEnabled ? clear : undefined}
        >
          {showVid && (type === 'video' ? (
            <video controls preload="metadata" poster={safeProxyUrl(previewUrl)} src={vidSrc}>
              Your browser can&apos;t play this video.
            </video>
          ) : (
            <video autoPlay loop muted playsInline preload="metadata" poster={safeProxyUrl(previewUrl)} src={vidSrc} />
          ))}
          {vidLoading && <div className="media-loading-overlay"><div className="media-spinner" /></div>}
          {vidError && <div className="media-error-overlay"><span>Failed to load</span></div>}
        </div>
        {hoverEnabled && pos && previewUrl && (
          <div className="media-hover-preview" style={{ left: pos.x, top: pos.y }}>
            <img src={safeProxyUrl(previewUrl)} alt={description || ''} />
          </div>
        )}
      </>
    )
  }

  if (type === 'audio') {
    const showAud = fetchClientMedia ? (audBlob || audError) : true
    const audSrc = audBlob || safeProxyUrl(url)
    return (
      <div className={`media-item media-audio${audLoading ? ' media-loading' : ''}${audError ? ' media-error' : ''}`}>
        <Music size={16} />
        {showAud && <audio controls preload="metadata" src={audSrc} />}
        {audLoading && <div className="media-loading-overlay"><div className="media-spinner" /></div>}
        {audError && <div className="media-error-overlay"><span>Failed to load</span></div>}
      </div>
    )
  }

  return (
    <a className="media-item media-unknown" href={url} target="_blank" rel="noreferrer">
      <Paperclip size={14} />
      {description || 'Attachment'}
    </a>
  )
}

function MediaGrid({ attachments, sensitive, spoilerText, onOpenLightbox, forceHidden }) {
  const [userRevealed, setUserRevealed] = useState(!sensitive)
  const revealed = !forceHidden && userRevealed

  if (!attachments || attachments.length === 0) return null

  const shown = attachments.slice(0, 4)

  return (
    <div className="media-wrap" onClick={(e) => e.stopPropagation()}>
      <div className={`media-grid count-${shown.length}${revealed ? '' : ' blurred'}`}>
        {shown.map((att, idx) => (
          <MediaItem
            key={att.id}
            attachment={att}
            revealed={revealed}
            onOpenLightbox={() => onOpenLightbox({ attachment: att, attachments: shown, index: idx })}
          />
        ))}
      </div>
      {!revealed && (
        <button type="button" className="media-cw-overlay" onClick={() => setUserRevealed(true)}>
          <Eye size={18} />
          <span>{spoilerText || 'Sensitive content'} — click to view</span>
        </button>
      )}
    </div>
  )
}

// The open state lives in the parent: when closed this renders nothing
// without ever changing hook counts. All hooks belong in LightboxContent,
// which only mounts while there's actually something to show.
function MediaLightbox({ lightboxState, onClose }) {
  if (!lightboxState?.attachment) return null
  return <LightboxContent {...lightboxState} onClose={onClose} />
}

function LightboxContent({ attachment, attachments, onNavigate, onClose }) {
  const { fetchClientMedia, instanceUrl, token } = useContext(AppSettingsContext)

  const resolveAtt = useCallback(async () => {
    if (!instanceUrl || !attachment.id || typeof attachment.id === 'string' && attachment.id.startsWith('quarantined-')) return []
    try {
      const apiUrl = `${instanceUrl}/api/v1/media/${attachment.id}`
      const proxyRes = await fetch(proxyUrl(apiUrl), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (proxyRes.ok) {
        const fresh = await proxyRes.json()
        const urls = [fresh.remote_url, fresh.url, fresh.preview_url].filter(Boolean)
        if (urls.length > 0) return urls
      }
    } catch {}
    const statusUri = attachment._status_uri
    if (!statusUri) return []
    try {
      const apRes = await fetch(proxyUrl(statusUri), {
        headers: { 'Accept': 'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"' }
      })
      if (!apRes.ok) return []
      const ap = await apRes.json()
      const atts = ap.attachment || []
      return atts.flatMap((a) => [a.url, a.href].filter(Boolean))
    } catch { return [] }
  }, [instanceUrl, token, attachment.id, attachment._status_uri])

  const imageAttachments = (attachments || []).filter((a) => a.type === 'image')
  const currentIdx = imageAttachments.findIndex((a) => a.id === attachment.id)
  const hasPrev = currentIdx > 0
  const hasNext = currentIdx < imageAttachments.length - 1

  const { blobUrl } = useClientMedia(
    fetchClientMedia ? attachment.url : null,
    fetchClientMedia ? attachment.remote_url : null,
    fetchClientMedia ? attachment._remote_fallback : null,
    fetchClientMedia ? resolveAtt : null
  )

  function goPrev() {
    if (hasPrev) onNavigate({ attachment: imageAttachments[currentIdx - 1], attachments, index: currentIdx - 1, onNavigate })
  }
  function goNext() {
    if (hasNext) onNavigate({ attachment: imageAttachments[currentIdx + 1], attachments, index: currentIdx + 1, onNavigate })
  }

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') goPrev()
      else if (e.key === 'ArrowRight') goNext()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  })

  return (
    <div className="dialog-overlay lightbox-overlay" onClick={onClose}>
      <button className="icon-btn lightbox-close" onClick={onClose} aria-label="Close">
        <X size={18} />
      </button>
      {hasPrev && (
        <button className="icon-btn lightbox-prev" onClick={(e) => { e.stopPropagation(); goPrev() }} aria-label="Previous">
          <ChevronLeft size={24} />
        </button>
      )}
      {hasNext && (
        <button className="icon-btn lightbox-next" onClick={(e) => { e.stopPropagation(); goNext() }} aria-label="Next">
          <ChevronRight size={24} />
        </button>
      )}
      {blobUrl ? (
        <img
          className="lightbox-image"
          src={blobUrl}
          alt={attachment.description || ''}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div className="lightbox-image media-loading" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="media-spinner" />
        </div>
      )}
    </div>
  )
}

// Manages a compose dialog's attached files: upload starts the moment a
// file is picked (not at submit time), each tracked independently so one
// slow/failed upload doesn't block the others. `mediaIds` only includes
// ones that finished successfully — submit should wait for `isUploading`
// to clear before posting.
function useMediaUploads(instanceUrl, token) {
  const [uploads, setUploads] = useState([])

  useEffect(() => {
    return () => {
      uploads.forEach((u) => URL.revokeObjectURL(u.previewUrl))
    }
  }, [])

  function addFiles(fileList) {
    const remaining = Math.max(0, 4 - uploads.length)
    Array.from(fileList)
      .slice(0, remaining)
      .forEach((file) => {
        const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const previewUrl = URL.createObjectURL(file)
        setUploads((prev) => [
          ...prev,
          { key, file, previewUrl, mediaId: null, uploading: true, error: '' },
        ])
        mitra
          .uploadMedia(instanceUrl, token, file)
          .then((attachment) => {
            setUploads((prev) =>
              prev.map((u) =>
                u.key === key ? { ...u, uploading: false, mediaId: attachment.id } : u
              )
            )
          })
          .catch((err) => {
            setUploads((prev) =>
              prev.map((u) =>
                u.key === key
                  ? { ...u, uploading: false, error: err.message || 'Upload failed.' }
                  : u
              )
            )
          })
      })
  }

  function removeUpload(key) {
    setUploads((prev) => {
      const target = prev.find((u) => u.key === key)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((u) => u.key !== key)
    })
  }

  const mediaIds = uploads.filter((u) => u.mediaId).map((u) => u.mediaId)
  const isUploading = uploads.some((u) => u.uploading)

  return { uploads, addFiles, removeUpload, mediaIds, isUploading }
}

function MediaUploadStrip({ uploads, onRemove }) {
  if (uploads.length === 0) return null
  return (
    <div className="upload-strip">
      {uploads.map((u) => (
        <div className="upload-thumb" key={u.key}>
          {u.file.type.startsWith('image/') ? (
            <img src={u.previewUrl} alt="" />
          ) : u.file.type.startsWith('video/') ? (
            <video src={u.previewUrl} muted />
          ) : (
            <div className="upload-thumb-generic">
              <Paperclip size={16} />
            </div>
          )}
          {u.uploading && <div className="upload-thumb-status">Uploading…</div>}
          {u.error && <div className="upload-thumb-status error">Failed</div>}
          <button
            type="button"
            className="upload-thumb-remove"
            onClick={() => onRemove(u.key)}
            aria-label="Remove attachment"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

// One reply, at any depth, with the exact same action row and interactivity
// as a normal post row (reply/boost/favourite/monero/more, all functional)
// — not a stripped-down version. Its own already-loaded children render
// directly beneath it — no per-node fetch or click-to-expand, since the
// whole subtree came from one /context call at the moment the thread was
// opened. Clicking a reply's body re-opens the panel focused on it
// specifically (fresh ancestors, in case there's more context above what's
// already showing), same handler as everywhere else in the app.
function ThreadReply({
  node,
  depth = 0,
  instanceUrl,
  token,
  onUpdate,
  onOpenThread,
  onComposeReply,
  onOpenLightbox,
  onOpenProfile,
  statusById,
  onQuote,
  compact = false,
  highlightedId,
  focusedReplyId,
  onHighlightParent,
  currentAccountId,
  onDelete,
  onMute,
  onBlock,
}) {
  const [busy, setBusy] = useState(false)
  const [mediaHidden, setMediaHidden] = useState(false)
  const { openPickerId, setOpenPickerId } = useContext(PickerContext)
  const showPicker = openPickerId === node.status.id
  const setShowPicker = (open) => setOpenPickerId(open ? node.status.id : null)
  const status = node.status
  const account = status.account || {}
  const name = account.display_name || account.username || 'Unknown'
  const content = processStatusContent(status, instanceUrl)
  const parentStatus = statusById?.get(status.in_reply_to_id) || null

  async function toggleReaction(statusId, emoji, alreadyReacted) {
    try {
      const updated = alreadyReacted
        ? await mitra.removeReaction(instanceUrl, token, statusId, emoji)
        : await mitra.addReaction(instanceUrl, token, statusId, emoji)
      onUpdate(updated)
    } catch (err) {
      console.error(err)
    }
  }

  async function toggleFavourite() {
    if (busy) return
    setBusy(true)
    try {
      const updated = await mitra.setFavourited(instanceUrl, token, status.id, status.favourited)
      onUpdate(updated)
    } catch (err) {
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  async function toggleReblog() {
    if (busy) return
    setBusy(true)
    try {
      const updated = await mitra.setReblogged(instanceUrl, token, status.id, status.reblogged)
      const inner = updated.reblog ? { ...updated.reblog, reblogged: updated.reblogged } : updated
      onUpdate(inner)
    } catch (err) {
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div
        className={`reply-row${highlightedId === status.id ? ' highlighted' : ''}${focusedReplyId === status.id ? ' focused-reply' : ''}`}
        style={{ '--reply-depth': depth }}
        data-status-id={status.id}
      >
        <Avatar name={name} src={account.avatar} onClick={() => onOpenProfile?.(account)} />
        <div
          className="reply-body"
          onClick={(e) => {
            e.stopPropagation()
            onOpenThread(status)
          }}
        >
          <div className="post-meta">
            <span className="post-name" onClick={(e) => { e.stopPropagation(); onOpenProfile?.(account) }}>{name}</span>
            <span className="post-handle" onClick={(e) => { e.stopPropagation(); onOpenProfile?.(account) }}>@{account.acct || account.username}</span>
            {parentStatus && (
              <button
                className="post-parent-link"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenThread(parentStatus)
                }}
                onMouseEnter={() => onHighlightParent?.(parentStatus.id)}
                onMouseLeave={() => onHighlightParent?.(null)}
              >
                parent
              </button>
            )}
            <span className="post-time">{formatRelativeTime(status.created_at)}</span>
          </div>
          <p className="post-text">{content.textNodes}</p>
          <QuoteCard status={status.pleroma?.quote || status.quote?.quoted_status || status.quote} instanceUrl={instanceUrl} onOpenThread={onOpenThread} />
          <MediaGrid
            attachments={content.attachments}
            sensitive={content.sensitive}
            spoilerText={content.spoilerText}
            onOpenLightbox={onOpenLightbox}
            forceHidden={mediaHidden}
          />
          <ReactionChips
            reactions={status.pleroma?.emoji_reactions}
            statusId={status.id}
            instanceUrl={instanceUrl}
            token={token}
            onReact={toggleReaction}
          />
          <div className="post-actions" onClick={(e) => e.stopPropagation()}>
            <button className="action-btn" aria-label="Reply" onClick={() => onComposeReply(status)}>
              <MessageCircle size={15} />
              {!compact && status.replies_count > 0 && <span>{status.replies_count}</span>}
            </button>
            <BoostDropdown
              reblogged={status.reblogged}
              reblogsCount={compact ? 0 : status.reblogs_count}
              busy={busy}
              onBoost={toggleReblog}
              onQuote={() => onQuote(status)}
            />
            <button
              className={`action-btn${status.favourited ? ' favorited' : ''}`}
              aria-label="Favorite"
              onClick={toggleFavourite}
              disabled={busy}
            >
              <Star size={15} fill={status.favourited ? 'currentColor' : 'none'} />
              {!compact && <span>{status.favourites_count}</span>}
            </button>
            {!compact && (
              <>
                <button
                  className="action-btn"
                  aria-label="React"
                  onClick={() => setShowPicker(!showPicker)}
                >
                  <Smile size={15} />
                </button>
                {showPicker && (
                  <ReactionPicker
                    status={status}
                    instanceUrl={instanceUrl}
                    token={token}
                    onReact={toggleReaction}
                    onClose={() => setShowPicker(false)}
                  />
                )}
              </>
            )}
            {content.attachments.length > 0 && (
              <button
                className="action-btn"
                aria-label={mediaHidden ? 'Show media' : 'Hide media'}
                onClick={() => setMediaHidden((v) => !v)}
              >
                {mediaHidden ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            )}
            <PostOptionsMenu
              status={status}
              instanceUrl={instanceUrl}
              token={token}
              isOwn={status.account?.id === currentAccountId}
              onDelete={onDelete}
              onMute={onMute}
              onBlock={onBlock}
            />
          </div>
        </div>
      </div>
      {node.children.length > 0 && (
        <div className="inline-replies-wrap">
          <div className="inline-replies-track" onClick={(e) => e.stopPropagation()}>
            {node.children.map((child) => (
              <ThreadReply
                key={child.status.id}
                node={child}
                depth={depth + 1}
                instanceUrl={instanceUrl}
                token={token}
                onUpdate={onUpdate}
                onOpenThread={onOpenThread}
                onComposeReply={onComposeReply}
                onOpenLightbox={onOpenLightbox}
                onOpenProfile={onOpenProfile}
                statusById={statusById}
                onQuote={onQuote}
                highlightedId={highlightedId}
                focusedReplyId={focusedReplyId}
                onHighlightParent={onHighlightParent}
                currentAccountId={currentAccountId}
                onDelete={onDelete}
                onMute={onMute}
                onBlock={onBlock}
              />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

const COMMON_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '😡', '🎉', '🔥', '💯', '🤔', '👏', '💀']

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

function filterEmoji(query, customEmojis) {
  const q = query.toLowerCase()
  const unicodeMatches = EMOJI_NAMES
    .filter(([name]) => name.includes(q))
    .map(([name, char]) => ({ name, char, type: 'unicode' }))
  const customMatches = (customEmojis || [])
    .filter((e) => e.shortcode.includes(q))
    .map((e) => ({ name: e.shortcode, url: e.static_url || e.url, type: 'custom' }))
  return [...unicodeMatches.slice(0, 15), ...customMatches.slice(0, 10)]
}

function insertAtCaret(text, setText, textareaRef, insert) {
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

function useEmojiAutocomplete(text, setText, textareaRef, customEmojis) {
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

function EmojiDropdown({ query, suggestions, selectedIndex, onSelect }) {
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
            ? <ProxiedImg className="custom-emoji" src={s.url} alt={s.name} width="18" height="18" />
            : <span className="emoji-char">{s.char}</span>
          }
          <span className="emoji-name">:{s.name}:</span>
        </button>
      ))}
    </div>
  )
}

function EmojiPicker({ customEmojis, onSelect, onClose }) {
  const ref = useRef(null)
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
          <ProxiedImg className="custom-emoji" src={e.static_url || e.url} alt={e.shortcode} width="18" height="18" />
        </button>
      ))}
    </div>
  )
}

function ReactionChips({ reactions, statusId, instanceUrl, token, onReact }) {
  if (!reactions || reactions.length === 0) return null
  return (
    <div className="reaction-chips">
      {reactions.map((r) => (
        <button
          key={r.name}
          className={`reaction-chip${r.me ? ' reacted' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            onReact(statusId, r.name, r.me)
          }}
        >
          {r.url ? (
            <ProxiedImg className="reaction-emoji-img" src={r.url} alt={r.name} />
          ) : (
            <span className="reaction-emoji-text">{r.name}</span>
          )}
          <span className="reaction-count">{r.count}</span>
        </button>
      ))}
    </div>
  )
}

function ReactionPicker({ status, instanceUrl, token, onReact, onClose }) {
  const [instanceEmoji, setInstanceEmoji] = useState([])
  useEffect(() => {
    let cancelled = false
    mitra.fetchCustomEmojis(instanceUrl).then((emojis) => {
      if (!cancelled) setInstanceEmoji(emojis || [])
    }).catch(() => {})
    return () => { cancelled = true }
  }, [instanceUrl])
  const seen = new Set()
  const customEmoji = []
  ;(status.emojis || []).forEach((e) => {
    if (!seen.has(e.shortcode)) { seen.add(e.shortcode); customEmoji.push(e) }
  })
  instanceEmoji.forEach((e) => {
    if (!seen.has(e.shortcode)) { seen.add(e.shortcode); customEmoji.push(e) }
  })
  return (
    <div className="reaction-picker" onClick={(e) => e.stopPropagation()}>
      <div className="reaction-picker-section">
        {COMMON_EMOJI.map((emoji) => (
          <button key={emoji} className="reaction-picker-item" onClick={() => { onReact(status.id, emoji, false); onClose() }}>
            {emoji}
          </button>
        ))}
      </div>
      {customEmoji.length > 0 && (
        <>
          <div className="reaction-picker-divider" />
          <div className="reaction-picker-section">
            {customEmoji.map((e) => (
              <button key={e.shortcode} className="reaction-picker-item" onClick={() => { onReact(status.id, `:${e.shortcode}:`, false); onClose() }}>
                <ProxiedImg src={e.url} alt={e.shortcode} className="reaction-picker-custom-emoji" />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function BoostDropdown({ reblogged, reblogsCount, busy, onBoost, onQuote }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div className="boost-dropdown-wrap" ref={ref}>
      <button
        className={`action-btn boost-trigger${reblogged ? ' boosted' : ''}`}
        aria-label="Boost or quote"
        onClick={() => setOpen(!open)}
        disabled={busy}
      >
        <Repeat2 size={15} />
        {reblogsCount > 0 && <span>{reblogsCount}</span>}
      </button>
      {open && (
        <>
          <div className="boost-dropdown-backdrop" onClick={() => setOpen(false)} />
          <div className="boost-dropdown">
            <button
              className={`boost-dropdown-item${reblogged ? ' boosted' : ''}`}
              onClick={() => { onBoost(); setOpen(false) }}
            >
              <Repeat2 size={15} />
              {reblogged ? 'Unboost' : 'Boost'}
            </button>
            <button
              className="boost-dropdown-item"
              onClick={() => { onQuote(); setOpen(false) }}
            >
              <MessageCircle size={15} />
              Quote
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function QuoteCard({ status, instanceUrl, onOpenThread }) {
  if (!status) return null
  const account = status.account || {}
  const name = account.display_name || account.username || 'Unknown'
  const content = processStatusContent(status, instanceUrl)
  return (
    <div className="quote-card" onClick={(e) => { e.stopPropagation(); onOpenThread(status) }}>
      <div className="quote-card-meta">
        <Avatar name={name} src={account.avatar} size={16} />
        <span className="quote-card-name">{name}</span>
        <span className="quote-card-handle">@{account.acct || account.username}</span>
      </div>
      <p className="quote-card-text">{content.textNodes}</p>
      {content.attachments.length > 0 && content.attachments[0].type === 'image' && (
        <ProxiedImg className="quote-card-image" src={content.attachments[0].preview_url || content.attachments[0].url} alt="" />
      )}
    </div>
  )
}

function PollCard({ poll, instanceUrl, token, onUpdated }) {
  const [selected, setSelected] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!poll) return null

  const { id, options, expired, multiple, votes_count, voters_count, voted, own_votes, expires_at } = poll
  const showResults = expired || voted

  function toggleOption(idx) {
    if (showResults || busy) return
    if (multiple) {
      setSelected((prev) =>
        prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
      )
    } else {
      setSelected([idx])
    }
  }

  async function submitVote() {
    if (selected.length === 0) return
    setBusy(true)
    setError('')
    try {
      const updated = await mitra.votePoll(instanceUrl, token, id, selected)
      onUpdated(updated)
    } catch (err) {
      setError(err.message || 'Vote failed.')
    } finally {
      setBusy(false)
    }
  }

  function timeLeft() {
    if (!expires_at || expired) return null
    const ms = new Date(expires_at) - Date.now()
    if (ms <= 0) return null
    const mins = Math.floor(ms / 60000)
    if (mins < 60) return `${mins}m left`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ${mins % 60}m left`
    const days = Math.floor(hrs / 24)
    return `${days}d left`
  }

  return (
    <div className="poll-card">
      {showResults ? (
        options.map((opt, i) => {
          const pct = votes_count > 0 ? Math.round((opt.votes_count / votes_count) * 100) : 0
          const chosen = own_votes?.includes(i)
          return (
            <div key={i} className={`poll-option${chosen ? ' chosen' : ''}`}>
              <div className="poll-option-header">
                <span className="poll-option-text">{htmlToPlainText(opt.title)}</span>
                <span className="poll-option-pct">{pct}%</span>
              </div>
              <div className="poll-option-bar">
                <div className="poll-option-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )
        })
      ) : (
        options.map((opt, i) => (
          <label key={i} className={`poll-option-pick${selected.includes(i) ? ' selected' : ''}`}>
            <span className={`poll-radio${multiple ? ' checkbox' : ''}`}>
              {selected.includes(i) && <span className="poll-radio-dot" />}
            </span>
            <span className="poll-option-text">{htmlToPlainText(opt.title)}</span>
          </label>
        ))
      )}
      {error && <div className="banner banner-error">{error}</div>}
      <div className="poll-footer">
        <span className="poll-meta">
          {votes_count} vote{votes_count !== 1 ? 's' : ''}
          {voters_count != null && voters_count !== votes_count && ` · ${voters_count} voter${voters_count !== 1 ? 's' : ''}`}
          {timeLeft() && <> · {timeLeft()}</>}
          {expired && <span className="poll-expired"> · Ended</span>}
        </span>
        {!showResults && (
          <button
            className="pill-btn suggested"
            onClick={submitVote}
            disabled={busy || selected.length === 0}
          >
            {busy ? 'Voting…' : 'Vote'}
          </button>
        )}
      </div>
    </div>
  )
}

function PostOptionsMenu({ status, instanceUrl, token, isOwn, onDelete, onMute, onBlock }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function copyLink() {
    const acct = status.account?.acct || status.account?.username || 'unknown'
    const url = status.url || `https://${instanceUrl}/@${acct}/${status.id}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => { setCopied(false); setOpen(false) }, 900)
    }).catch(() => {
      setOpen(false)
    })
  }

  function handleMute() {
    onMute?.(status.account?.id)
    setOpen(false)
  }

  function handleBlock() {
    onBlock?.(status.account?.id)
    setOpen(false)
  }

  function handleDelete() {
    onDelete?.(status.id)
    setOpen(false)
  }

  return (
    <div className="boost-dropdown-wrap" ref={ref}>
      <button className="action-btn" aria-label="More options" style={{ marginLeft: 'auto' }} onClick={() => setOpen(!open)}>
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <>
          <div className="boost-dropdown-backdrop" onClick={() => setOpen(false)} />
          <div className="boost-dropdown">
            <button className="boost-dropdown-item" onClick={copyLink}>
              <Link size={15} />
              {copied ? 'Copied!' : 'Copy link'}
            </button>
            {isOwn && (
              <button className="boost-dropdown-item destructive" onClick={handleDelete}>
                <X size={15} />
                Delete
              </button>
            )}
            {!isOwn && (
              <>
                <button className="boost-dropdown-item" onClick={handleMute}>
                  <Eye size={15} />
                  Mute
                </button>
                <button className="boost-dropdown-item" onClick={handleBlock}>
                  <UserPlus size={15} />
                  Block
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

const PostRow = memo(function PostRow({ post, instanceUrl, token, onUpdate, onOpenThread, onComposeReply, onOpenLightbox, onOpenProfile, onQuote, statusById, depth, highlightedId, onHighlightParent, currentAccountId, onDelete, onMute, onBlock }) {
  const [busy, setBusy] = useState(false)
  const [mediaHidden, setMediaHidden] = useState(false)
  const { openPickerId, setOpenPickerId } = useContext(PickerContext)
  const isBoost = Boolean(post.reblog)
  const status = unwrapStatus(post)
  const showPicker = openPickerId === status.id
  const setShowPicker = (open) => setOpenPickerId(open ? status.id : null)
  const account = status.account || {}
  const displayName = account.display_name || account.username || 'Unknown'
  const booster = isBoost ? post.account : null
  const content = processStatusContent(status, instanceUrl)
  const parentStatus = statusById?.get(status.in_reply_to_id) || null
  const replyToAccount = !parentStatus && status.in_reply_to_account_id
    ? (status.mentions || []).find((m) => m.id === status.in_reply_to_account_id)
    : null

  async function toggleReaction(statusId, emoji, alreadyReacted) {
    try {
      const updated = alreadyReacted
        ? await mitra.removeReaction(instanceUrl, token, statusId, emoji)
        : await mitra.addReaction(instanceUrl, token, statusId, emoji)
      onUpdate(isBoost ? { ...post, reblog: updated } : updated)
    } catch (err) {
      console.error(err)
    }
  }

  async function toggleFavourite() {
    if (busy) return
    setBusy(true)
    try {
      const updated = await mitra.setFavourited(instanceUrl, token, status.id, status.favourited)
      onUpdate(isBoost ? { ...post, reblog: updated } : updated)
    } catch (err) {
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  async function toggleReblog() {
    if (busy) return
    setBusy(true)
    try {
      const updated = await mitra.setReblogged(instanceUrl, token, status.id, status.reblogged)
      const inner = updated.reblog ? { ...updated.reblog, reblogged: updated.reblogged } : updated
      onUpdate(isBoost ? { ...post, reblog: inner } : inner)
    } catch (err) {
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`post-row${highlightedId === status.id ? ' highlighted' : ''}`} style={depth != null ? { '--reply-depth': depth } : undefined}>
      {booster && (
        <div className="repost-indicator">
          <Repeat2 size={13} />
          {booster.display_name || booster.username} boosted
        </div>
      )}
      <div className="post-row-main">
        <Avatar name={displayName} src={account.avatar} onClick={() => onOpenProfile?.(account)} />
        <div
          className="post-body"
          onClick={(e) => {
            e.stopPropagation()
            onOpenThread(status)
          }}
        >
          <div className="post-meta">
            <span className="post-name" onClick={(e) => { e.stopPropagation(); onOpenProfile?.(account) }}>{displayName}</span>
            <span className="post-handle" onClick={(e) => { e.stopPropagation(); onOpenProfile?.(account) }}>@{account.acct || account.username}</span>
            {parentStatus && (
              <button
                className="post-parent-link"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenThread(parentStatus)
                }}
                onMouseEnter={() => onHighlightParent?.(parentStatus.id)}
                onMouseLeave={() => onHighlightParent?.(null)}
              >
                parent
              </button>
            )}
            <span className="post-time">{formatRelativeTime(status.created_at)}</span>
          </div>
          {replyToAccount && (
            <div className="post-reply-context">
              In reply to{' '}
              <span className="post-reply-link" onClick={(e) => { e.stopPropagation(); onOpenProfile?.(replyToAccount) }}>
                @{replyToAccount.acct || replyToAccount.username}
              </span>
            </div>
          )}
          <p className="post-text">{content.textNodes}</p>
          <QuoteCard status={status.pleroma?.quote || status.quote?.quoted_status || status.quote} instanceUrl={instanceUrl} onOpenThread={onOpenThread} />
          <MediaGrid
            attachments={content.attachments}
            sensitive={content.sensitive}
            spoilerText={content.spoilerText}
            onOpenLightbox={onOpenLightbox}
            forceHidden={mediaHidden}
          />
          <ReactionChips
            reactions={status.pleroma?.emoji_reactions}
            statusId={status.id}
            instanceUrl={instanceUrl}
            token={token}
            onReact={toggleReaction}
          />
          <div className="post-actions" onClick={(e) => e.stopPropagation()}>
            <button className="action-btn" aria-label="Reply" onClick={() => onComposeReply(status)}>
              <MessageCircle size={15} />
              {status.replies_count > 0 && <span>{status.replies_count}</span>}
            </button>
            <BoostDropdown
              reblogged={status.reblogged}
              reblogsCount={status.reblogs_count}
              busy={busy}
              onBoost={toggleReblog}
              onQuote={() => onQuote(status)}
            />
            <button
              className={`action-btn${status.favourited ? ' favorited' : ''}`}
              aria-label="Favorite"
              onClick={toggleFavourite}
              disabled={busy}
            >
              <Star size={15} fill={status.favourited ? 'currentColor' : 'none'} />
              <span>{status.favourites_count}</span>
            </button>
            <button
              className="action-btn"
              aria-label="React"
              onClick={() => setShowPicker(!showPicker)}
            >
              <Smile size={15} />
            </button>
            {showPicker && (
              <ReactionPicker
                status={status}
                instanceUrl={instanceUrl}
                token={token}
                onReact={toggleReaction}
                onClose={() => setShowPicker(false)}
              />
            )}
            {content.attachments.length > 0 && (
              <button
                className="action-btn"
                aria-label={mediaHidden ? 'Show media' : 'Hide media'}
                onClick={() => setMediaHidden((v) => !v)}
              >
                {mediaHidden ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            )}
            <PostOptionsMenu
              status={status}
              instanceUrl={instanceUrl}
              token={token}
              isOwn={status.account?.id === currentAccountId}
              onDelete={onDelete}
              onMute={onMute}
              onBlock={onBlock}
            />
          </div>
        </div>
      </div>
    </div>
  )
})

function visibilityLabel(v) {
  switch (v) {
    case 'public':
      return 'Public'
    case 'unlisted':
      return 'Unlisted'
    case 'private':
      return 'Followers only'
    case 'direct':
      return 'Direct message'
    default:
      return v
  }
}

function ReplyComposerFields({ status, instanceUrl, token, onClose, onPosted, maxCharacters = 500 }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [spoilerText, setSpoilerText] = useState('')
  const [showCW, setShowCW] = useState(false)
  const fileInputRef = useRef(null)
  const textareaRef = useRef(null)
  const [customEmojis, setCustomEmojis] = useState([])
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const { uploads, addFiles, removeUpload, mediaIds, isUploading } = useMediaUploads(
    instanceUrl,
    token
  )
  const account = status?.account || {}
  const name = account.display_name || account.username || 'Unknown'
  const [visibility, setVisibility] = useState(status?.visibility || 'public')
  const { query: acQuery, suggestions: acSuggestions, selectedIndex: acIndex, handleKeyDown: acKeyDown } = useEmojiAutocomplete(text, setText, textareaRef, customEmojis)

  useEffect(() => {
    mitra.fetchCustomEmojis(instanceUrl).then((emojis) => setCustomEmojis(emojis || [])).catch(() => {})
  }, [instanceUrl])

  async function submit() {
    if (!text.trim() && mediaIds.length === 0) {
      setError('Write something or attach a file first.')
      return
    }
    if (text.length > maxCharacters) {
      setError(`Post is ${text.length - maxCharacters} character${text.length - maxCharacters !== 1 ? 's' : ''} over the limit.`)
      return
    }
    if (isUploading) {
      setError('Still uploading — hang on a sec.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const reply = await mitra.postStatus(instanceUrl, token, text.trim(), {
        inReplyToId: status.id,
        visibility,
        mediaIds,
        spoilerText: showCW ? spoilerText : undefined,
      })
      onPosted(status.id, reply)
    } catch (err) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="thread-panel-header">
        <span className="dialog-title">Reply</span>
        <button className="icon-btn" aria-label="Cancel" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {status && (
        <div className="thread-panel-preview">
          <div className="post-meta">
            <span className="post-name">{name}</span>
            <span className="post-handle">@{account.acct || account.username}</span>
          </div>
          <p className="post-text">{processStatusContent(status, instanceUrl).textNodes}</p>
        </div>
      )}
      {error && <div className="banner banner-error">{error}</div>}
      {showCW && (
        <input
          className="compose-cw-input"
          type="text"
          value={spoilerText}
          onChange={(e) => setSpoilerText(e.target.value)}
          placeholder="Content warning…"
          autoFocus
        />
      )}
      <div className="compose-textarea-wrap">
        <textarea
          ref={textareaRef}
          className="compose-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (acKeyDown(e)) return
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
          onPaste={(e) => {
            const items = Array.from(e.clipboardData?.items || [])
            const imageFiles = items
              .filter((item) => item.type.startsWith('image/'))
              .map((item) => item.getAsFile())
              .filter(Boolean)
            if (imageFiles.length > 0) {
              e.preventDefault()
              addFiles(imageFiles)
            }
          }}
          placeholder={`Reply to ${name}…`}
          rows={6}
          autoFocus
        />
        <EmojiDropdown query={acQuery} suggestions={acSuggestions} selectedIndex={acIndex} onSelect={(s) => {
          const insert = s.type === 'custom' ? `:${s.name}:` : s.char
          insertAtCaret(text, setText, textareaRef, insert)
        }} />
        <CharCounter current={text.length} max={maxCharacters} />
      </div>
      <MediaUploadStrip uploads={uploads} onRemove={removeUpload} />
      <div className="dialog-actions">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,audio/*"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <button
          className="icon-btn"
          type="button"
          aria-label="Attach media"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploads.length >= 4}
        >
          <ImagePlus size={16} />
        </button>
        <button
          className={`icon-btn${showCW ? ' active' : ''}`}
          type="button"
          aria-label="Content warning"
          onClick={() => setShowCW((v) => !v)}
        >
          <Eye size={16} />
        </button>
          <div style={{ position: 'relative', flex: '0 0 auto' }}>
            <button
              className={`icon-btn${showEmojiPicker ? ' active' : ''}`}
              type="button"
              aria-label="Emoji"
              onClick={() => setShowEmojiPicker((v) => !v)}
            >
              <Smile size={16} />
            </button>
            {showEmojiPicker && (
              <EmojiPicker
                customEmojis={customEmojis}
                onSelect={(ch) => { insertAtCaret(text, setText, textareaRef, ch); setShowEmojiPicker(false) }}
                onClose={() => setShowEmojiPicker(false)}
              />
            )}
          </div>
          <select
            className="compose-visibility-select"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
          >
          <option value="public">{visibilityLabel('public')}</option>
          <option value="unlisted">{visibilityLabel('unlisted')}</option>
          <option value="private">{visibilityLabel('private')}</option>
          <option value="direct">{visibilityLabel('direct')}</option>
        </select>
        <div style={{ flex: 1 }} />
        <button className="pill-btn" onClick={onClose} type="button">
          Cancel
        </button>
        <button
          className="pill-btn suggested"
          onClick={submit}
          disabled={busy || isUploading}
          type="button"
        >
          {busy ? 'Posting…' : 'Reply'}
        </button>
      </div>
    </>
  )
}

function ThreadPanelContent({
  panel,
  replyStates,
  onOpenThread,
  onComposeReply,
  onOpenLightbox,
  onOpenProfile,
  onUpdateReply,
  onClose,
  onCancelCompose,
  instanceUrl,
  token,
  onReplyPosted,
  backLabel,
  onQuote,
  currentAccountId,
  onDelete,
  onMute,
  onBlock,
  maxCharacters,
  focusedReplyId,
}) {
  const status = panel?.status
  const state = status ? replyStates[status.id] : null
  const composingStatusId = panel?.composingStatusId || null

  const statusById = useMemo(() => {
    const map = new Map()
    if (status) map.set(status.id, status)
    if (state?.ancestors) state.ancestors.forEach((a) => map.set(a.id, a))
    function collect(nodes) {
      for (const node of nodes) {
        map.set(node.status.id, node.status)
        if (node.children.length > 0) collect(node.children)
      }
    }
    if (state?.items) collect(state.items)
    return map
  }, [status, state])

  const composingStatus = composingStatusId ? (statusById.get(composingStatusId) || null) : null

  const [highlightedId, setHighlightedId] = useState(null)

  useEffect(() => {
    if (!focusedReplyId) return
    const el = document.querySelector(`[data-status-id="${focusedReplyId}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusedReplyId])

  if (panel?.mode === 'compose') {
    return (
      <ReplyComposerFields
        status={status}
        instanceUrl={instanceUrl}
        token={token}
        onClose={onClose}
        onPosted={(rootId, reply) => {
          onReplyPosted(rootId, reply)
          onClose()
        }}
        maxCharacters={maxCharacters}
      />
    )
  }

  return (
    <motion.div key={status?.id || 'empty'}>
      <div className="thread-panel-header">
        <span className="dialog-title">
          {composingStatus ? 'Reply' : (
            <>
              {backLabel && (
                <button className="icon-btn thread-back-btn" aria-label={backLabel} onClick={onClose}>
                  <ArrowLeft size={16} />
                </button>
              )}
              {state?.ancestors?.length > 0 ? 'Thread' : 'Replies'}
            </>
          )}
        </span>
        {composingStatus ? (
          <button className="icon-btn" aria-label="Cancel reply" onClick={onCancelCompose}>
            <X size={16} />
          </button>
        ) : (
          !backLabel && (
            <button className="icon-btn" aria-label="Close replies" onClick={onClose}>
              <X size={16} />
            </button>
          )
        )}
      </div>
      {state?.ancestors?.length > 0 && (
        <motion.div
          className="thread-ancestors"
          variants={staggerUpVariants}
          initial="hidden"
          animate="visible"
        >
          {state.ancestors.map((ancestor) => (
            <motion.div key={ancestor.id} variants={ancestorItemVariants}>
              <ThreadReply
                node={{ status: ancestor, children: [] }}
                depth={state.ancestors.indexOf(ancestor)}
                instanceUrl={instanceUrl}
                token={token}
                onUpdate={onUpdateReply}
                onOpenThread={onOpenThread}
                onComposeReply={onComposeReply}
                onOpenLightbox={onOpenLightbox}
                onOpenProfile={onOpenProfile}
                statusById={statusById}
                onQuote={onQuote}
                highlightedId={highlightedId}
                focusedReplyId={focusedReplyId}
                onHighlightParent={setHighlightedId}
                currentAccountId={currentAccountId}
                onDelete={onDelete}
                onMute={onMute}
                onBlock={onBlock}
              />
            </motion.div>
          ))}
        </motion.div>
      )}
      {status && (
        <motion.div
          className="thread-panel-focal"
          variants={focalVariants}
          initial="hidden"
          animate="visible"
        >
          <PostRow
            post={status}
            instanceUrl={instanceUrl}
            token={token}
            onUpdate={onUpdateReply}
            onOpenThread={onOpenThread}
            onComposeReply={onComposeReply}
            onOpenLightbox={onOpenLightbox}
            onOpenProfile={onOpenProfile}
            onQuote={onQuote}
            statusById={statusById}
            depth={state.ancestors?.length || 0}
            highlightedId={highlightedId}
            onHighlightParent={setHighlightedId}
            currentAccountId={currentAccountId}
            onDelete={onDelete}
            onMute={onMute}
            onBlock={onBlock}
          />
        </motion.div>
      )}
      {composingStatus && (
        <div className="inline-reply-composer">
          <ReplyComposerFields
            status={composingStatus}
            instanceUrl={instanceUrl}
            token={token}
            onClose={onCancelCompose}
            onPosted={onReplyPosted}
            maxCharacters={maxCharacters}
          />
        </div>
      )}
      <motion.div
        className="thread-panel-replies"
        variants={staggerDownVariants}
        initial="hidden"
        animate="visible"
      >
        {state?.loading && <div className="reply-loading">Loading replies…</div>}
        {state?.error && <div className="banner banner-error">{state.error}</div>}
        {state?.items?.map((node) => (
          <motion.div key={node.status.id} variants={descendantItemVariants} data-status-id={node.status.id} className={focusedReplyId === node.status.id ? 'focused-reply' : undefined}>
            <ThreadReply
              node={node}
              depth={state.ancestors.length + 1}
              instanceUrl={instanceUrl}
              token={token}
              onUpdate={onUpdateReply}
              onOpenThread={onOpenThread}
              onComposeReply={onComposeReply}
              onOpenLightbox={onOpenLightbox}
              onOpenProfile={onOpenProfile}
              statusById={statusById}
              onQuote={onQuote}
              highlightedId={highlightedId}
              focusedReplyId={focusedReplyId}
              onHighlightParent={setHighlightedId}
              currentAccountId={currentAccountId}
              onDelete={onDelete}
              onMute={onMute}
              onBlock={onBlock}
            />
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  )
}

// The sliding-panel presentation: used at the "medium" window-width tier,
// where there's room to push the timeline over but not enough for a
// permanent third column. Wide tier renders ThreadPanelContent directly in
// a permanent column instead; narrow tier renders it in place of the
// timeline. Same content, three different chromes.
function ThreadPanel(props) {
  const { panel, onClose } = props
  return (
    <>
      <div className="thread-panel-backdrop" onClick={onClose} />
      <aside className={`thread-panel${panel ? ' open' : ''}`}>
        <div className="thread-panel-inner scrollbar-thin">
          <ThreadPanelContent {...props} />
        </div>
      </aside>
    </>
  )
}

function notificationVerb(type, notification) {
  switch (type) {
    case 'follow':
      return 'followed you'
    case 'follow_request':
      return 'requested to follow you'
    case 'reblog':
      return 'boosted your post'
    case 'favourite':
      return 'favourited your post'
    case 'mention':
      return 'mentioned you'
    case 'poll':
      return "a poll you're in has ended"
    case 'status':
      return 'posted'
    case 'update':
      return 'edited a post'
    case 'quote':
      return 'quoted your post'
    case 'pleroma:emoji_reaction': {
      const emojiUrl = notification?.emoji_url
      const emojiName = notification?.emoji || notification?.reaction?.content || '🧩'
      const emoji = emojiUrl
        ? <ProxiedImg src={emojiUrl} alt={emojiName} className="inline-custom-emoji" />
        : emojiName
      return <>reacted with {emoji} to your post</>
    }
    default:
      return type.replace(/_/g, ' ')
  }
}

function notificationIcon(type) {
  switch (type) {
    case 'follow':
    case 'follow_request':
      return UserPlus
    case 'reblog':
      return Repeat2
    case 'favourite':
      return Star
    case 'mention':
      return AtSign
    case 'quote':
      return MessageCircle
    default:
      return Bell
  }
}

const NotificationRow = memo(function NotificationRow({
  notification,
  instanceUrl,
  token,
  onUpdateStatus,
  onOpenThread,
  onComposeReply,
  onOpenLightbox,
  onOpenProfile,
  onRespondFollowRequest,
  statusById,
  onQuote,
  currentAccountId,
  onDelete,
  onMute,
  onBlock,
}) {
  const account = notification.account || {}
  const name = account.display_name || account.username || 'Unknown'
  const Icon = notificationIcon(notification.type)
  const [responding, setResponding] = useState(false)
  const [responded, setResponded] = useState(null)

  async function respond(action) {
    if (responding) return
    setResponding(true)
    try {
      await onRespondFollowRequest(account.id, action)
      setResponded(action)
    } catch (err) {
      console.error(err)
    } finally {
      setResponding(false)
    }
  }

  return (
    <div className="notif-row">
      <div className="notif-icon">
        <Icon size={14} />
      </div>
      <div className="notif-body">
        <div className="notif-header">
          <Avatar name={name} src={account.avatar} size={22} onClick={() => onOpenProfile?.(account)} />
          <span className="notif-text">
            <span className="post-name clickable" onClick={(e) => { e.stopPropagation(); onOpenProfile?.(account) }}>{name}</span> {notificationVerb(notification.type, notification)}
          </span>
          <span className="post-time">{formatRelativeTime(notification.created_at)}</span>
        </div>

        {notification.type === 'follow_request' && !responded && (
          <div className="notif-actions">
            <button
              className="pill-btn suggested"
              disabled={responding}
              onClick={() => respond('authorize')}
              type="button"
            >
              Accept
            </button>
            <button
              className="pill-btn"
              disabled={responding}
              onClick={() => respond('reject')}
              type="button"
            >
              Reject
            </button>
          </div>
        )}
        {responded && (
          <div className="notif-responded">
            {responded === 'authorize' ? 'Accepted.' : 'Rejected.'}
          </div>
        )}

        {notification.status && (
          <div className="notif-status-preview">
            <ThreadReply
              node={{ status: notification.status, children: [] }}
              instanceUrl={instanceUrl}
              token={token}
              onUpdate={onUpdateStatus}
              onOpenThread={onOpenThread}
              onComposeReply={onComposeReply}
              onOpenLightbox={onOpenLightbox}
              onOpenProfile={onOpenProfile}
              statusById={statusById}
              onQuote={onQuote}
              compact
              currentAccountId={currentAccountId}
              onDelete={onDelete}
              onMute={onMute}
              onBlock={onBlock}
            />
          </div>
        )}
      </div>
    </div>
  )
})

function CharCounter({ current, max }) {
  const remaining = max - current
  if (current === 0) return null
  const cls = remaining < 0 ? 'over' : remaining < 50 ? 'low' : ''
  return <span className={`char-counter ${cls}`}>{remaining}</span>
}

function ComposeDialog({ instanceUrl, token, onClose, onPosted, quoteStatus, maxCharacters = 500 }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [visibility, setVisibility] = useState('public')
  const [spoilerText, setSpoilerText] = useState('')
  const [showCW, setShowCW] = useState(false)
  const fileInputRef = useRef(null)
  const textareaRef = useRef(null)
  const [customEmojis, setCustomEmojis] = useState([])
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const { uploads, addFiles, removeUpload, mediaIds, isUploading } = useMediaUploads(
    instanceUrl,
    token
  )
  const { query: acQuery, suggestions: acSuggestions, selectedIndex: acIndex, handleKeyDown: acKeyDown } = useEmojiAutocomplete(text, setText, textareaRef, customEmojis)

  useEffect(() => {
    mitra.fetchCustomEmojis(instanceUrl).then((emojis) => setCustomEmojis(emojis || [])).catch(() => {})
  }, [instanceUrl])

  async function submit() {
    if (!text.trim() && mediaIds.length === 0 && !quoteStatus) {
      setError('Write something or attach a file first.')
      return
    }
    if (text.length > maxCharacters) {
      setError(`Post is ${text.length - maxCharacters} character${text.length - maxCharacters !== 1 ? 's' : ''} over the limit.`)
      return
    }
    if (isUploading) {
      setError('Still uploading — hang on a sec.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const status = await mitra.postStatus(instanceUrl, token, text.trim(), {
        mediaIds,
        visibility,
        quoteId: quoteStatus?.id,
        spoilerText: showCW ? spoilerText : undefined,
      })
      onPosted(status)
      onClose()
    } catch (err) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">New post</span>
          <button className="icon-btn" onClick={onClose} aria-label="Cancel">
            <X size={16} />
          </button>
        </div>
        {error && <div className="banner banner-error">{error}</div>}
        {showCW && (
          <input
            className="compose-cw-input"
            type="text"
            value={spoilerText}
            onChange={(e) => setSpoilerText(e.target.value)}
            placeholder="Content warning…"
            autoFocus
          />
        )}
        <div className="compose-textarea-wrap">
          <textarea
            ref={textareaRef}
            className="compose-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (acKeyDown(e)) return
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault()
                submit()
              }
            }}
            onPaste={(e) => {
              const items = Array.from(e.clipboardData?.items || [])
              const imageFiles = items
                .filter((item) => item.type.startsWith('image/'))
                .map((item) => item.getAsFile())
                .filter(Boolean)
              if (imageFiles.length > 0) {
                e.preventDefault()
                addFiles(imageFiles)
              }
            }}
            placeholder="What's on your mind?"
            rows={5}
            autoFocus
          />
          <EmojiDropdown query={acQuery} suggestions={acSuggestions} selectedIndex={acIndex} onSelect={(s) => {
            const insert = s.type === 'custom' ? `:${s.name}:` : s.char
            insertAtCaret(text, setText, textareaRef, insert)
          }} />
          <CharCounter current={text.length} max={maxCharacters} />
        </div>
        {quoteStatus && (
          <div className="compose-quote-preview">
            <QuoteCard status={quoteStatus} instanceUrl={instanceUrl} onOpenThread={() => {}} />
          </div>
        )}
        <MediaUploadStrip uploads={uploads} onRemove={removeUpload} />
        <div className="dialog-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,audio/*"
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <button
            className="icon-btn"
            type="button"
            aria-label="Attach media"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploads.length >= 4}
          >
            <ImagePlus size={16} />
          </button>
          <button
            className={`icon-btn${showCW ? ' active' : ''}`}
            type="button"
            aria-label="Content warning"
            onClick={() => setShowCW((v) => !v)}
          >
            <Eye size={16} />
          </button>
          <div style={{ position: 'relative', flex: '0 0 auto' }}>
            <button
              className={`icon-btn${showEmojiPicker ? ' active' : ''}`}
              type="button"
              aria-label="Emoji"
              onClick={() => setShowEmojiPicker((v) => !v)}
            >
              <Smile size={16} />
            </button>
            {showEmojiPicker && (
              <EmojiPicker
                customEmojis={customEmojis}
                onSelect={(ch) => { insertAtCaret(text, setText, textareaRef, ch); setShowEmojiPicker(false) }}
                onClose={() => setShowEmojiPicker(false)}
              />
            )}
          </div>
          <select
            className="compose-visibility-select"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
          >
            <option value="public">{visibilityLabel('public')}</option>
            <option value="unlisted">{visibilityLabel('unlisted')}</option>
            <option value="private">{visibilityLabel('private')}</option>
            <option value="direct">{visibilityLabel('direct')}</option>
          </select>
          <div style={{ flex: 1, minWidth: 0 }} />
          <button className="pill-btn" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="pill-btn suggested"
            onClick={submit}
            disabled={busy || isUploading}
            type="button"
          >
            {busy ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ProfileView({ accountId, instanceUrl, token, onOpenThread, onComposeReply, onOpenLightbox, onOpenProfile, onUpdate, onQuote, currentAccountId, onDelete, onMute, onBlock, onClose }) {
  const [account, setAccount] = useState(null)
  const [statuses, setStatuses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('posts')
  const [relationship, setRelationship] = useState(null)
  const [followBusy, setFollowBusy] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  function tabParams(t) {
    switch (t) {
      case 'posts': return { excludeReplies: true }
      case 'posts_and_replies': return {}
      case 'pinned': return { pinned: true }
      case 'media': return { onlyMedia: true }
      default: return {}
    }
  }

  useEffect(() => {
    setAccount(null)
    setStatuses([])
    setLoading(true)
    setError('')
    setTab('posts')
    setRelationship(null)
    setHasMore(true)

    mitra.fetchAccount(instanceUrl, accountId)
      .then((acct) => {
        setAccount(acct)
        return mitra.fetchAccountStatuses(instanceUrl, token, acct.id, tabParams('posts'))
      })
      .then((list) => {
        setStatuses(list)
        if (list.length < 20) setHasMore(false)
      })
      .catch((err) => setError(err.message || 'Failed to load profile.'))
      .finally(() => setLoading(false))
  }, [accountId, instanceUrl, token])

  useEffect(() => {
    if (!account || account.id === currentAccountId) return
    mitra.fetchRelationships(instanceUrl, token, [account.id])
      .then((rels) => setRelationship(rels?.[0] || null))
      .catch(() => {})
  }, [account, instanceUrl, token, currentAccountId])

  const isOwn = account?.id === currentAccountId

  async function toggleFollow() {
    if (!account || followBusy) return
    setFollowBusy(true)
    try {
      const result = relationship?.following
        ? await mitra.unfollowAccount(instanceUrl, token, account.id)
        : await mitra.followAccount(instanceUrl, token, account.id)
      setRelationship(result)
    } catch (err) {
      console.error(err)
    } finally {
      setFollowBusy(false)
    }
  }

  async function loadMore() {
    if (!account || loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const lastId = statuses[statuses.length - 1]?.id
      if (!lastId) return
      const more = await mitra.fetchAccountStatuses(instanceUrl, token, account.id, { ...tabParams(tab), max_id: lastId })
      setStatuses((prev) => [...prev, ...more])
      if (more.length < 20) setHasMore(false)
    } catch {
      // silent
    } finally {
      setLoadingMore(false)
    }
  }

  function switchTab(newTab) {
    if (newTab === tab) return
    setTab(newTab)
    setStatuses([])
    setHasMore(true)
    setLoading(true)
    mitra.fetchAccountStatuses(instanceUrl, token, accountId, tabParams(newTab))
      .then((list) => { setStatuses(list); if (list.length < 20) setHasMore(false) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  const sentinelRef = useRef(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) loadMore() }, { rootMargin: '200px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [account, tab, statuses.length, loadingMore, hasMore])

  if (loading && !account) {
    return (
      <div className="timeline-wrap">
        <div className="empty-state">Loading…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="timeline-wrap">
        <button className="icon-btn profile-back" onClick={onClose}><ArrowLeft size={16} /></button>
        <div className="banner banner-error">{error}</div>
      </div>
    )
  }

  if (!account) return null

  const displayName = account.display_name || account.username || 'Unknown'
  const bio = account.note ? processStatusContent({ content: account.note }, instanceUrl).textNodes : null

  return (
    <div className="timeline-wrap">
      <div className="profile-view">
        <div className="profile-header-wrap">
          {account.header && account.header !== '' && (
            <ProxiedImg className="profile-header-img" src={account.header} alt="" />
          )}
          <button className="icon-btn profile-back-btn" onClick={onClose}><ArrowLeft size={16} /></button>
        </div>
        <div className="profile-info">
          <Avatar name={displayName} src={account.avatar} large />
          <div className="profile-names">
            <span className="profile-display-name">{displayName}</span>
            <span className="profile-handle">@{account.acct || account.username}</span>
            {!isOwn && relationship?.following && relationship?.followed_by && (
              <span className="profile-badge mutual">Mutual</span>
            )}
            {!isOwn && !relationship?.following && relationship?.followed_by && (
              <span className="profile-badge follows-you">Follows you</span>
            )}
          </div>
          {!isOwn && (
            <button
              className={`pill-btn ${relationship?.following ? '' : 'suggested'}`}
              onClick={toggleFollow}
              disabled={followBusy}
            >
              {followBusy ? '…' : relationship?.following ? 'Following' : 'Follow'}
            </button>
          )}
        </div>
        {bio && <div className="profile-bio">{bio}</div>}
        <div className="profile-stats">
          <span><strong>{account.statuses_count}</strong> posts</span>
          <span><strong>{account.following_count}</strong> following</span>
          <span><strong>{account.followers_count}</strong> followers</span>
        </div>
        <div className="profile-tabs">
          <button className={`profile-tab${tab === 'posts' ? ' active' : ''}`} onClick={() => switchTab('posts')}>Posts</button>
          <button className={`profile-tab${tab === 'posts_and_replies' ? ' active' : ''}`} onClick={() => switchTab('posts_and_replies')}>Posts & Replies</button>
          <button className={`profile-tab${tab === 'pinned' ? ' active' : ''}`} onClick={() => switchTab('pinned')}>Pinned</button>
          <button className={`profile-tab${tab === 'media' ? ' active' : ''}`} onClick={() => switchTab('media')}>Media</button>
        </div>
        {loading && statuses.length === 0 ? (
          <div className="empty-state">Loading…</div>
        ) : statuses.length === 0 ? (
          <div className="empty-state">No posts yet.</div>
        ) : (
          <div className="timeline-list">
            {statuses.map((post) => (
              <PostRow
                key={post.id}
                post={post}
                instanceUrl={instanceUrl}
                token={token}
                onUpdate={onUpdate}
                onOpenThread={onOpenThread}
                onComposeReply={onComposeReply}
                onOpenLightbox={onOpenLightbox}
                onOpenProfile={onOpenProfile}
                onQuote={onQuote}
                currentAccountId={currentAccountId}
                onDelete={onDelete}
                onMute={onMute}
                onBlock={onBlock}
              />
            ))}
          </div>
        )}
        {hasMore && statuses.length > 0 && <div ref={sentinelRef} className="scroll-sentinel" />}
        {loadingMore && <div className="empty-state">Loading…</div>}
      </div>
    </div>
  )
}

// Three layout tiers based on window width. Wide: notifications get a
// permanent left column and the thread panel gets a permanent right
// column — a real 3-pane layout, nothing slides. Medium: today's
// behavior — notifications is a header tab, thread panel slides in from
// the right over/beside the timeline. Narrow: no room for a third column
// at all, so an opened thread replaces the timeline in the same content
// area instead, with a back button to return.
const WIDE_BREAKPOINT = 1400
const NARROW_BREAKPOINT = 900

function useLayoutTier() {
  const [width, setWidth] = useState(() => window.innerWidth)

  useEffect(() => {
    let raf = null
    function onResize() {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setWidth(window.innerWidth))
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  if (width >= WIDE_BREAKPOINT) return 'wide'
  if (width >= NARROW_BREAKPOINT) return 'medium'
  return 'narrow'
}

export default function App() {
  const { session, beginLogin, logout, authError, completingLogin } = useMitraSession()
  const tier = useLayoutTier()
  const [view, setView] = useState('home')
  const [timeline, setTimeline] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [composing, setComposing] = useState(false)
  const [quoteStatus, setQuoteStatus] = useState(null)
  const [openPickerId, setOpenPickerId] = useState(null)
  const [replyStates, setReplyStates] = useState({})
  const replyStatesRef = useRef(replyStates)
  replyStatesRef.current = replyStates
  const sidePanelRef = useRef(sidePanel)
  sidePanelRef.current = sidePanel
  const [sidePanel, setSidePanel] = useState(null)
  const [profileAccountId, setProfileAccountId] = useState(null)
  const [focusedReplyId, setFocusedReplyId] = useState(null)
  const [lightboxAttachment, setLightboxAttachment] = useState(null)
  const [notifications, setNotifications] = useState([])
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [notificationsError, setNotificationsError] = useState('')
  const [exploreFeed, setExploreFeed] = useState('federated') // 'federated' | 'local'
  const [exploreTimelines, setExploreTimelines] = useState({ federated: null, local: null })
  const [exploreLoading, setExploreLoading] = useState(false)
  const [exploreError, setExploreError] = useState('')
  const [exploreHasMore, setExploreHasMore] = useState({ federated: true, local: true })
  const [exploreLoadingMore, setExploreLoadingMore] = useState(false)
  const exploreSentinelRef = useRef(null)
  const [hoverPreviewsEnabled, setHoverPreviewsEnabled] = useState(() => {
    try {
      return localStorage.getItem('mitra-hover-previews') !== 'false'
    } catch {
      return true
    }
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [clientName, setClientNameState] = useState(() => mitra.getClientName())
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  function toggleHoverPreviews() {
    setHoverPreviewsEnabled((prev) => {
      const next = !prev
      try {
        localStorage.setItem('mitra-hover-previews', String(next))
      } catch {
        // localStorage unavailable — setting just won't persist across reloads
      }
      return next
    })
  }

  const [fetchClientMedia, setFetchClientMedia] = useState(() => {
    try {
      return localStorage.getItem('mitra-fetch-client-media') !== 'false'
    } catch {
      return true
    }
  })

  function toggleFetchClientMedia() {
    setFetchClientMedia((prev) => {
      const next = !prev
      try {
        localStorage.setItem('mitra-fetch-client-media', String(next))
      } catch {}
      return next
    })
  }

  function handleClientNameChange(name) {
    setClientNameState(name)
    mitra.setClientName(name)
    if (session) {
      mitra.clearAppCredentials(session.instanceUrl)
      logout()
    }
  }

  const [themeMode, setThemeMode] = useState(() => {
    try {
      return localStorage.getItem('mitra-theme-mode') || 'system'
    } catch {
      return 'system'
    }
  })

  useEffect(() => {
    const root = document.documentElement
    if (themeMode === 'system') {
      delete root.dataset.theme
    } else {
      root.dataset.theme = themeMode
    }
    try {
      localStorage.setItem('mitra-theme-mode', themeMode)
    } catch {}
  }, [themeMode])

  const loadTimeline = useCallback(async () => {
    if (!session) return
    setLoading(true)
    setError('')
    setHasMore(true)
    try {
      const statuses = await mitra.fetchHomeTimeline(session.instanceUrl, session.token)
      setTimeline(statuses)
    } catch (err) {
      setError(err.message || 'Failed to load timeline.')
    } finally {
      setLoading(false)
    }
  }, [session])

  const loadMoreTimeline = useCallback(async () => {
    if (!session || loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const lastId = timeline[timeline.length - 1]?.id
      if (!lastId) return
      const statuses = await mitra.fetchHomeTimeline(session.instanceUrl, session.token, { max_id: lastId })
      setTimeline((prev) => [...prev, ...statuses])
      if (statuses.length < 10) setHasMore(false)
    } catch {
      // silently fail — user can scroll again to retry
    } finally {
      setLoadingMore(false)
    }
  }, [session, loadingMore, hasMore, timeline])

  useEffect(() => {
    loadTimeline()
  }, [loadTimeline])

  useEffect(() => {
    if (view !== 'home') return
    const sentinel = document.querySelector('.scroll-sentinel')
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMoreTimeline()
      },
      { rootMargin: '200px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [view, loadMoreTimeline, timeline.length])

  const loadNotifications = useCallback(async () => {
    if (!session) return
    setNotificationsLoading(true)
    setNotificationsError('')
    try {
      const items = await mitra.fetchNotifications(session.instanceUrl, session.token)
      setNotifications(items)
    } catch (err) {
      setNotificationsError(err.message || 'Failed to load notifications.')
    } finally {
      setNotificationsLoading(false)
    }
  }, [session])

  useEffect(() => {
    if (view === 'notifications' || tier === 'wide') {
      loadNotifications()
    }
  }, [view, tier, loadNotifications])

  // Wide tier shows notifications as a permanent column, not a tab — if
  // the window shrinks below wide while "Notifications" is the active
  // tab-view, there'd be nothing in the main content area. Fall back to
  // Home.
  useEffect(() => {
    if (tier === 'wide' && view === 'notifications') {
      setView('home')
    }
  }, [tier, view])

  const loadExplore = useCallback(
    async (feed) => {
      if (!session) return
      setExploreLoading(true)
      setExploreError('')
      setExploreHasMore((prev) => ({ ...prev, [feed]: true }))
      try {
        const items = await mitra.fetchPublicTimeline(
          session.instanceUrl,
          session.token,
          feed === 'local'
        )
        setExploreTimelines((prev) => ({ ...prev, [feed]: items }))
      } catch (err) {
        setExploreError(err.message || 'Failed to load timeline.')
      } finally {
        setExploreLoading(false)
      }
    },
    [session]
  )

  const loadMoreExplore = useCallback(async () => {
    if (!session || exploreLoadingMore || !exploreHasMore[exploreFeed]) return
    const items = exploreTimelines[exploreFeed]
    if (!items || items.length === 0) return
    setExploreLoadingMore(true)
    try {
      const lastId = items[items.length - 1]?.id
      if (!lastId) return
      const more = await mitra.fetchPublicTimeline(
        session.instanceUrl,
        session.token,
        exploreFeed === 'local',
        { max_id: lastId }
      )
      setExploreTimelines((prev) => ({
        ...prev,
        [exploreFeed]: [...(prev[exploreFeed] || []), ...more],
      }))
      if (more.length < 30) setExploreHasMore((prev) => ({ ...prev, [exploreFeed]: false }))
    } catch {
      // silently fail
    } finally {
      setExploreLoadingMore(false)
    }
  }, [session, exploreLoadingMore, exploreHasMore, exploreFeed, exploreTimelines])

  useEffect(() => {
    if (view === 'explore' && exploreTimelines[exploreFeed] === null) {
      loadExplore(exploreFeed)
    }
  }, [view, exploreFeed, exploreTimelines, loadExplore])

  // Explore infinite scroll observer
  useEffect(() => {
    if (view !== 'explore') return
    const sentinel = exploreSentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMoreExplore()
      },
      { rootMargin: '200px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [view, loadMoreExplore, exploreTimelines[exploreFeed]?.length])

  function updateExplorePost(updated) {
    setExploreTimelines((prev) => ({
      ...prev,
      [exploreFeed]: prev[exploreFeed]?.map((p) => (p.id === updated.id ? updated : p)) ?? null,
    }))
  }

  async function respondFollowRequest(accountId, action) {
    await mitra.respondFollowRequest(session.instanceUrl, session.token, accountId, action)
  }

  async function handleDeleteStatus(statusId) {
    try {
      await mitra.deleteStatus(session.instanceUrl, session.token, statusId)
      setTimeline((prev) => prev.filter((p) => p.id !== statusId))
      if (sidePanel?.status?.id === statusId) setSidePanel(null)
    } catch (err) {
      console.error(err)
    }
  }

  async function handleMuteAccount(accountId) {
    try {
      await mitra.muteAccount(session.instanceUrl, session.token, accountId)
    } catch (err) {
      console.error(err)
    }
  }

  async function handleBlockAccount(accountId) {
    try {
      await mitra.blockAccount(session.instanceUrl, session.token, accountId)
    } catch (err) {
      console.error(err)
    }
  }

  function handleRefresh() {
    if (view === 'notifications') {
      loadNotifications()
    } else if (view === 'explore') {
      setExploreHasMore((prev) => ({ ...prev, [exploreFeed]: true }))
      loadExplore(exploreFeed)
    } else {
      loadTimeline()
    }
  }

  function updatePost(updated) {
    setTimeline((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
  }

  function prependPost(post) {
    setTimeline((prev) => [post, ...prev])
  }

  // Fetches the ENTIRE descendant tree for `status` (not just its direct
  // children — /context returns every depth in one call) plus its
  // ancestors, and always refetches on open rather than relying on a
  // stale cache, so what's shown is actually current. Every thread opens
  // through this, unconditionally — the OP, a notification's status, a
  // reply, a reply to a reply, all the same path, all the same panel.
  const ensureRepliesLoaded = useCallback(
    (status) => {
      setReplyStates((prev) => {
        if (prev[status.id]?.items) return prev
        return { ...prev, [status.id]: { ...(prev[status.id] || {}), loading: true, error: '' } }
      })

      if (replyStatesRef.current[status.id]?.items) return

      mitra
        .fetchContext(session.instanceUrl, session.token, status.id)
        .then((context) => {
          const tree = buildReplyTree(context.descendants, status.id)
          setReplyStates((prev) => ({
            ...prev,
            [status.id]: { loading: false, error: '', items: tree, ancestors: context.ancestors },
          }))
        })
        .catch((err) => {
          setReplyStates((prev) => ({
            ...prev,
            [status.id]: {
              ...(prev[status.id] || {}),
              loading: false,
              error: err.message || 'Failed to load replies.',
            },
          }))
        })
    },
    [session]
  )

  // Opens the side panel for `status` — ancestors and the full reply tree —
  // or closes it if that same status is already showing. This is the only
  // way threads open anywhere in the app now: always the slide-out panel,
  // never inline in the timeline.
  function handleOpenThread(status) {
    setSidePanel((prev) =>
      prev?.mode === 'thread' && prev.status.id === status.id ? prev : { mode: 'thread', status }
    )
    ensureRepliesLoaded(status)
  }

  // Opens the reply-compose slide-out for `status`.
  function handleComposeReply(status) {
    setSidePanel((prev) => {
      if (prev?.mode === 'thread') {
        return { ...prev, composingStatusId: status.id }
      }
      return { mode: 'compose', status, threadRoot: null }
    })
  }

  function handleCancelCompose() {
    setSidePanel((prev) => {
      if (!prev || !prev.composingStatusId) return prev
      const { composingStatusId, ...rest } = prev
      return rest
    })
  }

  // Opens the profile view for an account.
  function handleOpenProfile(account) {
    if (!account?.id) return
    setSidePanel(null)
    setProfileAccountId(account.id)
    setView('home')
  }

  function handleQuote(status) {
    setQuoteStatus(status)
    setComposing(true)
  }

  // Auto-refresh the thread panel every 5 seconds (silent, no loading flash)
  useEffect(() => {
    if (sidePanel?.mode !== 'thread' || !sidePanel.status) return
    const statusId = sidePanel.status.id
    const interval = setInterval(() => {
      mitra
        .fetchContext(session.instanceUrl, session.token, statusId)
        .then((context) => {
          const tree = buildReplyTree(context.descendants, statusId)
          setReplyStates((prev) => ({
            ...prev,
            [statusId]: { loading: false, error: '', items: tree, ancestors: context.ancestors },
          }))
        })
        .catch(() => {})
    }, 5000)
    return () => clearInterval(interval)
  }, [sidePanel, session])

  // Auto-refresh notifications every 5 seconds (silent)
  useEffect(() => {
    if (view !== 'notifications' && tier !== 'wide') return
    if (!session) return
    const interval = setInterval(() => {
      mitra
        .fetchNotifications(session.instanceUrl, session.token)
        .then((items) => setNotifications(items))
        .catch(() => {})
    }, 5000)
    return () => clearInterval(interval)
  }, [view, tier, session])

  // After a reply posts successfully, insert it into the correct position in
  // the already-loaded tree so it shows up immediately, then swap the panel
  // back to thread view and trigger an immediate refresh.
  function handleReplyPosted(parentId, reply) {
    const newReply = { status: reply, children: [] }
    setReplyStates((prev) => {
      // Find which root key contains parentId in its tree
      let rootKey = prev[parentId] ? parentId : null
      if (!rootKey) {
        for (const key of Object.keys(prev)) {
          if (findNode(prev[key].items, parentId)) { rootKey = key; break }
        }
      }
      if (!rootKey || !prev[rootKey]?.items) return prev
      const updated = insertIntoTree(prev[rootKey].items, parentId, newReply)
      return { ...prev, [rootKey]: { ...prev[rootKey], items: updated } }
    })
    setSidePanel((prev) => {
      if (prev?.mode === 'thread' && prev.status) {
        return { mode: 'thread', status: prev.status }
      }
      return null
    })
    setFocusedReplyId(reply.id)
    setTimeout(() => setFocusedReplyId(null), 2000)
    // Trigger an immediate context refresh so nested replies appear quickly.
    // Read the panel through the ref — the closure above captured a stale
    // `sidePanel` by the time this fires.
    setTimeout(() => {
      const panel = sidePanelRef.current
      const rootId = panel?.threadRoot?.id || panel?.status?.id
      if (rootId && session) {
        mitra.fetchContext(session.instanceUrl, session.token, rootId)
          .then((context) => {
            const tree = buildReplyTree(context.descendants, rootId)
            setReplyStates((prev2) => ({
              ...prev2,
              [rootId]: { loading: false, error: '', items: tree, ancestors: context.ancestors },
            }))
          })
          .catch(() => {})
      }
    }, 1500)
  }

  function closeSidePanel() {
    setSidePanel(null)
  }

  // Favouriting/boosting a reply needs to update that exact node wherever
  // it lives — inside the tree of whichever thread is currently open in
  // the panel, or (for a notification's own status) the notifications
  // list directly. Two different data shapes, so two small helpers rather
  // than one that tries to cover both.
  function updateReplyInPanel(updated) {
    if (!sidePanel?.status) return
    const rootId = sidePanel.status.id
    if (updated.id === rootId) {
      setSidePanel((prev) => (prev ? { ...prev, status: updated } : prev))
    }
    setReplyStates((prev) => {
      const current = prev[rootId]
      if (!current) return prev
      const items = current.items ? updateTreeNode(current.items, updated) : current.items
      const ancestors = current.ancestors
        ? current.ancestors.map((a) => (a.id === updated.id ? updated : a))
        : current.ancestors
      return { ...prev, [rootId]: { ...current, items, ancestors } }
    })
  }

  function updateNotificationStatus(updated) {
    setNotifications((prev) =>
      prev.map((n) => (n.status && n.status.id === updated.id ? { ...n, status: updated } : n))
    )
  }

  if (!session) {
    return (
      <LoginView onBeginLogin={beginLogin} error={authError} completingLogin={completingLogin} />
    )
  }

  const notificationsBody = (
    <>
      {notificationsError && <div className="banner banner-error">{notificationsError}</div>}
      {notificationsLoading && notifications.length === 0 ? (
        <div className="empty-state">Loading…</div>
      ) : notifications.length === 0 ? (
        <div className="empty-state">Nothing here yet.</div>
      ) : (
        <div className="timeline-list">
          {notifications.map((n) => (
            <NotificationRow
              key={n.id}
              notification={n}
              instanceUrl={session.instanceUrl}
              token={session.token}
              onUpdateStatus={updateNotificationStatus}
              onOpenThread={handleOpenThread}
              onComposeReply={handleComposeReply}
              onOpenLightbox={setLightboxAttachment}
              onOpenProfile={handleOpenProfile}
              onRespondFollowRequest={respondFollowRequest}
              currentAccountId={session.account?.id}
              onDelete={handleDeleteStatus}
              onMute={handleMuteAccount}
              onBlock={handleBlockAccount}
            />
          ))}
        </div>
      )}
    </>
  )

  const timelineContent = profileAccountId ? (
    <ProfileView
      accountId={profileAccountId}
      instanceUrl={session.instanceUrl}
      token={session.token}
      onOpenThread={handleOpenThread}
      onComposeReply={handleComposeReply}
      onOpenLightbox={setLightboxAttachment}
      onOpenProfile={handleOpenProfile}
      onUpdate={updatePost}
      onQuote={handleQuote}
      currentAccountId={session.account?.id}
      onDelete={handleDeleteStatus}
      onMute={handleMuteAccount}
      onBlock={handleBlockAccount}
      onClose={() => setProfileAccountId(null)}
    />
  ) : (
    <div className="timeline-wrap">
      {view === 'home' && (
        <>
          {error && <div className="banner banner-error">{error}</div>}
          <div className="section-label">Home timeline</div>
          {loading && timeline.length === 0 ? (
            <div className="empty-state">Loading…</div>
          ) : timeline.length === 0 ? (
            <div className="empty-state">
              No posts yet. Follow someone to see their posts here.
            </div>
          ) : (
            <div className="timeline-list">
              {timeline.map((post) => (
                <PostRow
                  key={post.id}
                  post={post}
                  instanceUrl={session.instanceUrl}
                  token={session.token}
                  onUpdate={updatePost}
                  onOpenThread={handleOpenThread}
                  onComposeReply={handleComposeReply}
                  onOpenLightbox={setLightboxAttachment}
                  onOpenProfile={handleOpenProfile}
                  onQuote={handleQuote}
                  currentAccountId={session.account?.id}
                  onDelete={handleDeleteStatus}
                  onMute={handleMuteAccount}
                  onBlock={handleBlockAccount}
                />
              ))}
            </div>
          )}
          {loadingMore && <div className="empty-state">Loading…</div>}
          {hasMore && !loadingMore && timeline.length > 0 && (
            <div className="scroll-sentinel" />
          )}
        </>
      )}

      {view === 'explore' && (
        <>
          {exploreError && <div className="banner banner-error">{exploreError}</div>}
          <div className="explore-header">
            <div className="section-label" style={{ paddingBottom: 0 }}>
              Explore
            </div>
            <div className="feed-toggle">
              <button
                className={`feed-toggle-btn${exploreFeed === 'federated' ? ' active' : ''}`}
                onClick={() => setExploreFeed('federated')}
                type="button"
              >
                <Globe size={13} />
                Federated
              </button>
              <button
                className={`feed-toggle-btn${exploreFeed === 'local' ? ' active' : ''}`}
                onClick={() => setExploreFeed('local')}
                type="button"
              >
                <Home size={13} />
                Local
              </button>
            </div>
          </div>
          {exploreLoading && !exploreTimelines[exploreFeed] ? (
            <div className="empty-state">Loading…</div>
          ) : !exploreTimelines[exploreFeed] || exploreTimelines[exploreFeed].length === 0 ? (
            <div className="empty-state">Nothing here yet.</div>
          ) : (
            <div className="timeline-list">
              {exploreTimelines[exploreFeed].map((post) => (
                <PostRow
                  key={post.id}
                  post={post}
                  instanceUrl={session.instanceUrl}
                  token={session.token}
                  onUpdate={updateExplorePost}
                  onOpenThread={handleOpenThread}
                  onComposeReply={handleComposeReply}
                  onOpenLightbox={setLightboxAttachment}
                  onOpenProfile={handleOpenProfile}
                  onQuote={handleQuote}
                  currentAccountId={session.account?.id}
                  onDelete={handleDeleteStatus}
                  onMute={handleMuteAccount}
                  onBlock={handleBlockAccount}
                />
              ))}
            </div>
          )}
          {exploreLoadingMore && <div className="empty-state">Loading…</div>}
          {exploreHasMore[exploreFeed] && !exploreLoadingMore && exploreTimelines[exploreFeed]?.length > 0 && (
            <div ref={exploreSentinelRef} className="scroll-sentinel" />
          )}
        </>
      )}

      {tier !== 'wide' && view === 'notifications' && (
        <>
          <div className="section-label">Notifications</div>
          {notificationsBody}
        </>
      )}
    </div>
  )

  const threadPanelProps = {
    panel: sidePanel,
    replyStates,
    onOpenThread: handleOpenThread,
    onComposeReply: handleComposeReply,
    onOpenLightbox: setLightboxAttachment,
    onOpenProfile: handleOpenProfile,
    onUpdateReply: updateReplyInPanel,
    onClose: closeSidePanel,
    instanceUrl: session.instanceUrl,
    token: session.token,
    onReplyPosted: handleReplyPosted,
    onCancelCompose: handleCancelCompose,
    onQuote: handleQuote,
    currentAccountId: session.account?.id,
    onDelete: handleDeleteStatus,
    onMute: handleMuteAccount,
    onBlock: handleBlockAccount,
    maxCharacters: session.maxCharacters || 500,
    focusedReplyId,
  }

  return (
    <AppSettingsContext.Provider value={{ hoverPreviewsEnabled, fetchClientMedia, instanceUrl: session.instanceUrl, token: session.token }}>
    <PickerContext.Provider value={{ openPickerId, setOpenPickerId }}>
      <header className="headerbar">
        <div className="headerbar-brand">
          <Rss size={18} />
          <div>
            Mitra
            <div className="headerbar-subtitle">
              {session.instanceUrl.replace(/^https?:\/\//, '')}
            </div>
          </div>
        </div>

        <div className="view-switcher">
          <button
            className={`view-switcher-btn${view === 'home' ? ' active' : ''}`}
            onClick={() => setView('home')}
          >
            <Home size={14} />
            Home
          </button>
          {tier !== 'wide' && (
            <button
              className={`view-switcher-btn${view === 'notifications' ? ' active' : ''}`}
              onClick={() => setView('notifications')}
            >
              <Bell size={14} />
              Notifications
            </button>
          )}
          <button
            className={`view-switcher-btn${view === 'explore' ? ' active' : ''}`}
            onClick={() => setView('explore')}
          >
            <Compass size={14} />
            Explore
          </button>
        </div>

        <div className="headerbar-actions">
          <button className="icon-btn" aria-label="Refresh" onClick={handleRefresh}>
            <RotateCw size={16} />
          </button>
          <div className="settings-menu-wrap">
            <button
              className="icon-btn"
              aria-label="Settings"
              onClick={() => setSettingsOpen((v) => !v)}
            >
              <Settings size={16} />
            </button>
            {settingsOpen && (
              <>
                <div className="settings-menu-backdrop" onClick={() => setSettingsOpen(false)} />
                <div className="settings-menu">
                  <label className="settings-menu-row">
                    <span>Media hover previews</span>
                    <input
                      type="checkbox"
                      checked={hoverPreviewsEnabled}
                      onChange={toggleHoverPreviews}
                    />
                  </label>
                  <label className="settings-menu-row">
                    <span>Fetch media directly</span>
                    <input
                      type="checkbox"
                      checked={fetchClientMedia}
                      onChange={toggleFetchClientMedia}
                    />
                  </label>
                  <div className="settings-menu-row">
                    <span>Theme</span>
                    <div className="theme-toggle">
                      <button
                        className={`theme-toggle-btn${themeMode === 'system' ? ' active' : ''}`}
                        onClick={() => setThemeMode('system')}
                      >
                        System
                      </button>
                      <button
                        className={`theme-toggle-btn${themeMode === 'light' ? ' active' : ''}`}
                        onClick={() => setThemeMode('light')}
                      >
                        Light
                      </button>
                      <button
                        className={`theme-toggle-btn${themeMode === 'dark' ? ' active' : ''}`}
                        onClick={() => setThemeMode('dark')}
                      >
                        Dark
                      </button>
                    </div>
                  </div>
                  <div className="settings-menu-row">
                    <span>Sent from</span>
                    <input
                      type="text"
                      className="settings-text-input"
                      value={clientName}
                      onChange={(e) => handleClientNameChange(e.target.value)}
                      maxLength={32}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
          <button className="suggested-btn" onClick={() => setComposing(true)}>
            <Plus size={15} />
            New post
          </button>
          <button className="icon-btn" aria-label="Log out" onClick={logout}>
            <LogOut size={16} />
          </button>
          <Avatar
            name={session.account.display_name || session.account.username}
            src={session.account.avatar}
          />
        </div>
      </header>

      {tier === 'wide' ? (
        <div className="app-shell">
          <aside className="notif-column scrollbar-thin">
            <div className="section-label">Notifications</div>
            {notificationsBody}
          </aside>
          <div className="content-scroll scrollbar-thin">{timelineContent}</div>
          <aside className="thread-column scrollbar-thin">
            {sidePanel ? (
              <ThreadPanelContent {...threadPanelProps} />
            ) : (
              <div className="thread-column-empty">Select a post to view its replies.</div>
            )}
          </aside>
        </div>
      ) : tier === 'medium' ? (
        <div className={`main-layout${sidePanel ? ' panel-open' : ''}`}>
          <div className="content-scroll scrollbar-thin">{timelineContent}</div>
          <ThreadPanel {...threadPanelProps} />
        </div>
      ) : (
        <div className="main-layout">
          <div className="content-scroll scrollbar-thin">
            {sidePanel ? (
              <div className="timeline-wrap">
                <ThreadPanelContent {...threadPanelProps} backLabel="Back to timeline" />
              </div>
            ) : (
              timelineContent
            )}
          </div>
        </div>
      )}

      <MediaLightbox
        lightboxState={lightboxAttachment ? { ...lightboxAttachment, onNavigate: setLightboxAttachment } : null}
        onClose={() => setLightboxAttachment(null)}
      />

      {composing && (
        <ComposeDialog
          instanceUrl={session.instanceUrl}
          token={session.token}
          onClose={() => { setComposing(false); setQuoteStatus(null) }}
          onPosted={prependPost}
          quoteStatus={quoteStatus}
          maxCharacters={session.maxCharacters || 500}
        />
      )}
    </PickerContext.Provider>
    </AppSettingsContext.Provider>
  )
}
