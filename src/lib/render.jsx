import { ProxiedImg } from '../components/Media.jsx'

export function formatRelativeTime(iso) {
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
  // Server renders posts (markdown or HTML source) into HTML with real
  // <a> links. Preserve them as [label](href) tokens so renderRichText
  // can rebuild clickable labeled anchors instead of flattening the
  // label into dead text. Mention/hashtag anchors are skipped — their
  // bare text feeds those dedicated branches.
  doc.querySelectorAll('a[href]').forEach((el) => {
    if (/mention|hashtag/i.test(el.className)) return
    const label = (el.textContent || el.getAttribute('href') || '').replace(/[[\]]/g, '').trim()
    const href = el.getAttribute('href') || ''
    if (!label) return
    el.replaceWith(`[${label}](${href})`)
  })
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

export { htmlToPlainText }

// Renders a display name that contains :custom_emoji: shortcodes as
// text + inline images. Falls back to plain text when the account has
// no emojis.
export function renderEmojiText(text, emojis) {
  if (!text) return null
  const emojiList = Array.isArray(emojis) ? emojis : []
  if (emojiList.length === 0) return text
  const byShortcode = new Map(emojiList.map((e) => [e.shortcode, e]))
  const re = /:([a-zA-Z0-9_+-]+):/g
  const parts = []
  let lastIndex = 0
  let match
  let key = 0
  while ((match = re.exec(text)) !== null) {
    const emoji = byShortcode.get(match[1])
    if (!emoji) continue
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    parts.push(
      <ProxiedImg
        key={`de-${key++}`}
        direct
        className="custom-emoji"
        src={emoji.static_url || emoji.url}
        alt={match[0]}
        title={match[0]}
        fallbackText={match[1]}
      />
    )
    lastIndex = match.index + match[0].length
  }
  if (!parts.length) return text
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

// `/context` returns every descendant of a status in one flat call — every
// depth, not just direct replies. Build that into an actual tree once, up
// front, so the whole thread can render fully expanded without any further
// per-node fetches: this is what "all known replies" actually means.
export function buildReplyTree(descendants, rootId) {
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
export function findNode(nodes, statusId) {
  if (!nodes) return null
  for (const node of nodes) {
    if (node.status.id === statusId) return node
    const found = findNode(node.children, statusId)
    if (found) return found
  }
  return null
}

// Insert a reply as a child of the node with the given status id (immutably)
export function insertIntoTree(nodes, parentId, newReply) {
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
export function updateTreeNode(nodes, updated) {
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

// A status can appear in a list more than once — as its own row, and
// again inside other people's boost wrappers. Merging by inner id keeps
// every copy's favourite/boost/bookmark state in lockstep the moment an
// action returns. Returns the same reference when nothing matches, so
// callers can skip writes.
export function mergeStatusIntoRow(row, updated) {
  if (!row.reblog) return row.id === updated.id ? updated : row
  if (row.reblog.id === updated.id) return { ...row, reblog: updated }
  return row
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
// Markdown-style labeled links, e.g. [label](https://…) — emitted by
// htmlToPlainText when preserving <a> elements, or present verbatim in
// posts whose source was markdown that the server didn't render.
const MD_LINK_RE_SOURCE = '\\[[^\\]\\n]+\\]\\(https?://[^\\s)]+\\)'
const MD_LINK_PARSE_RE = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/

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
  patternParts.push(MD_LINK_RE_SOURCE) // before the bare-URL pattern, so the label wins over the inner URL
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
      // Navigation is delegated at the document level in App: with a
      // mention id the profile opens directly, otherwise the acct is
      // resolved via /accounts/lookup. Falls back to an external link
      // only when there's nothing to route by.
      if (mention?.id) {
        parts.push(
          <button
            key={`m-${key++}`}
            className="mention-link"
            data-account-id={mention.id}
            data-acct={mention.acct || mention.username}
            onClick={(e) => e.stopPropagation()}
          >
            @{handle}
          </button>
        )
      } else {
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
      }
    } else if (token.startsWith('[')) {
      const md = token.match(MD_LINK_PARSE_RE)
      if (md) {
        parts.push(
          <a
            key={`l-${key++}`}
            className="mention-link"
            href={md[2]}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            {md[1]}
          </a>
        )
      } else {
        parts.push(token)
      }
    } else if (token.startsWith(':') && token.endsWith(':')) {
      const shortcode = token.slice(1, -1)
      const emoji = emojiMap.get(shortcode)
      if (emoji) {
        parts.push(
          <ProxiedImg
            key={`e-${key++}`}
            direct
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
      // Click handling is delegated at the document level in App (a native
      // listener), so this only stops the post body's own React handler —
      // the tag name travels via data-hashtag.
      parts.push(
        <button
          key={`h-${key++}`}
          className="hashtag-link"
          data-hashtag={token.slice(1)}
          onClick={(e) => e.stopPropagation()}
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

// Mitra rewrites every federated attachment URL into its own signed
// media-proxy form: `{instance}/api/media_proxy/{encodeURIComponent(
// original)}?signature={hex}`. The signature only authenticates the URL,
// so when the proxy fails (origin pruned the file, instance rotated its
// Ed25519 key -> 403/404), the original URL can still be recovered
// client-side by decoding the path segment back out. Returns null for
// anything that isn't a Mitra-style proxy URL.
export function decodeMediaProxyUrl(url) {
  const match = String(url || '').match(/\/api\/media_proxy\/([^?]*)/)
  if (!match) return null
  try {
    const decoded = decodeURIComponent(match[1])
    return /^https?:\/\//i.test(decoded) ? decoded : null
  } catch {
    return null
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

  // Shared host-classification: '' means "strip this URL and collect it",
  // null means "leave the token alone". Used by both passes below so the
  // rules can't drift between markdown-wrapped and bare URLs.
  const classifyUrl = (url) => {
    const linkHost = hostOf(url)
    if (linkHost === instanceHost) {
      quarantinedUrls.push(url)
      return ''
    }
    if (posterHost && linkHost === posterHost) {
      posterRecoveryUrls.push(url)
      return ''
    }
    return null
  }

  // htmlToPlainText preserves <a> elements as [label](href) tokens, so a
  // quarantined image usually arrives wrapped — strip the whole token and
  // keep only the inner URL, or an empty-label residue ("[]()") would
  // survive as visible text. Bare image URLs (never anchor-wrapped) are
  // handled by the original pass.
  const cleanedText = text
    .replace(/!?\[[^\]\n]*\]\((https?:\/\/[^\s)]+?\.(?:jpe?g|png|gif|webp|avif)(?:\?[^\s)]*)?)\)/gi, (token, url) => {
      return classifyUrl(url) ?? token
    })
    .replace(IMAGE_URL_RE, (match) => {
      return classifyUrl(match) ?? match
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { cleanedText, quarantinedUrls, posterRecoveryUrls }
}

// Combines mention-linking and quarantined-image extraction into what a
// post/reply actually needs to render: text nodes plus a merged attachment
// list (real attachments + any quarantined images recovered from the text).
export function processStatusContent(status, instanceUrl) {
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
    // Mastodon/Pleroma expose the origin URL directly — prefer it.
    if (att.remote_url) return enriched
    // Mitra hides the origin URL inside its signed proxy link; decode it
    // out so we can fetch from the poster's server if the proxy breaks.
    // (Swapping the host on a /api/media_proxy/... path leads nowhere.)
    const proxied = decodeMediaProxyUrl(att.url)
    if (proxied) return { ...enriched, _remote_fallback: proxied }
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

// Renders a block of plain text — e.g. a machine-translated post, which has
// no orig HTML to process — through the same linkify/mention/emoji pass the
// normal post text goes through, so URLs stay clickable and line breaks are
// preserved. Mentions and emoji come from the source status so user/@names
// and :shortcodes: that survive translation still render consistently.
export function renderPlainText(text, mentions, emojis) {
  return renderRichText(String(text || ''), mentions, emojis)
}
