import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { decodeBlurhash } from '../lib/blurhash'
import {
  X,
  Music,
  Paperclip,
  Eye,
  ChevronLeft,
  ChevronRight,
  Download,
} from 'lucide-react'
import {
  AppSettingsContext,
  proxyUrl,
  safeProxyUrl,
  useCursorPreview,
  useClientMedia,
  isUrlKnownFailed,
  markUrlFailed,
  downloadAttachment,
} from '../hooks'
import { lookupEmojiUrl } from '../lib/emojiRegistry.js'

// The initials circle is always the base layer; the photo overlays it once
// loaded. That way initials double as both the loading placeholder and the
// permanent fallback when the avatar can't be fetched. State resets when
// `src` changes so a reused Avatar doesn't show one user's fallback under
// another user's photo.
export function Avatar({ name, src, large, size, onClick }) {
  const [imgState, setImgState] = useState('loading')
  useEffect(() => {
    setImgState('loading')
  }, [src])
  const style = size ? { width: size, height: size } : undefined
  const cls = `avatar${large ? ' lg' : ''}${onClick ? ' clickable' : ''}`
  const initials = (typeof name === 'string' ? name : '?')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return (
    <div className={cls} style={style} onClick={onClick}>
      {initials}
      {src && imgState !== 'error' && (
        <ProxiedImg
          className="avatar-img"
          style={style}
          src={src}
          onLoad={() => setImgState('ok')}
          onError={() => setImgState('error')}
        />
      )}
    </div>
  )
}

// Renders a lightweight text stand-in while loading or when loading
// fails — used for custom emojis so a broken image doesn't just vanish.
function ImgPlaceholder({ text, alt, className }) {
  return (
    <span className={`img-placeholder${className ? ` ${className}` : ''}`} title={alt}>
      :{text}:
    </span>
  )
}

// Direct-mode escalation ladder for images with a fallbackText shortcode
// (i.e. custom emojis): origin URL -> dev proxy -> instance emoji
// registry -> ':name:' placeholder. Each candidate is remembered in the
// shared negative cache so remounts don't re-request known-dead URLs.
function useDirectEmojiSrc(src, fallbackText) {
  const { instanceUrl } = useContext(AppSettingsContext)
  // step: 0 origin | 1 proxy | 2 resolving registry | 3 override origin |
  //       4 override proxy | 5 dead
  const [step, setStep] = useState(0)
  const [overrideSrc, setOverrideSrc] = useState(null)

  useEffect(() => {
    setStep(0)
    setOverrideSrc(null)
  }, [src])

  useEffect(() => {
    if (step !== 2) return undefined
    let cancelled = false
    if (!fallbackText || !instanceUrl) {
      setStep(5)
      return undefined
    }
    lookupEmojiUrl(instanceUrl, fallbackText)
      .then((url) => {
        if (cancelled) return
        if (url && url !== src) {
          setOverrideSrc(url)
          setStep(3)
        } else {
          setStep(5)
        }
      })
      .catch(() => { if (!cancelled) setStep(5) })
    return () => { cancelled = true }
  }, [step, src, fallbackText, instanceUrl])

  function advance() {
    if (!src) { setStep(5); return }
    if (step === 0) {
      markUrlFailed(src)
      if (isUrlKnownFailed(safeProxyUrl(src))) {
        setStep(fallbackText ? 2 : 5)
      } else {
        setStep(1)
      }
    } else if (step === 1 || step === 3 || step === 4) {
      const current = step === 1 ? safeProxyUrl(src)
        : step === 3 ? overrideSrc
        : safeProxyUrl(overrideSrc)
      markUrlFailed(current)
      if (step === 1 && fallbackText) {
        setStep(2)
      } else if (step === 3) {
        setStep(isUrlKnownFailed(safeProxyUrl(overrideSrc)) ? 5 : 4)
      } else {
        setStep(5)
      }
    } else {
      setStep(5)
    }
  }

  let url = null
  let dead = false
  switch (step) {
    case 0: url = src; break
    case 1: url = safeProxyUrl(src); break
    case 3: url = overrideSrc; break
    case 4: url = safeProxyUrl(overrideSrc); break
    default: dead = true
  }

  return { url, dead, advance }
}

export function ProxiedImg({ src, fallbackSrc, alt, className, style, onError, onLoad, fallbackText, direct, ...rest }) {
  const { fetchClientMedia } = useContext(AppSettingsContext)
  const [viaProxy, setViaProxy] = useState(false)
  const [directFailed, setDirectFailed] = useState(false)
  const { blobUrl, loading, error } = useClientMedia(
    !direct && fetchClientMedia && src ? src : null,
    !direct && fetchClientMedia && fallbackSrc ? fallbackSrc : null
  )
  const emoji = useDirectEmojiSrc(
    direct && fallbackText ? src : null,
    direct ? fallbackText : null
  )
  useEffect(() => {
    if (error && onError) onError()
  }, [error, onError])
  useEffect(() => {
    setViaProxy(false)
    setDirectFailed(false)
  }, [src])

  function handleDirectError(e) {
    if (direct && emoji.url) {
      emoji.advance()
      return
    }
    if (direct && !viaProxy) {
      setViaProxy(true)
      return
    }
    setDirectFailed(true)
    console.warn(`[media] failed to load image: ${src}`)
    onError?.(e)
  }

  const showPlaceholder = Boolean(fallbackText) && (
    !src ||
    (direct ? emoji.dead : (fetchClientMedia ? (error || (!blobUrl && loading)) : directFailed))
  )
  if (showPlaceholder) {
    return <ImgPlaceholder text={fallbackText} alt={alt} className={className} />
  }
  // Without fallbackText the old behavior stands: render nothing while
  // pending/failed (callers like Avatar layer their own placeholders).
  if (!src) return null
  if (direct && fallbackText) {
    if (emoji.dead || !emoji.url) return null
    return (
      <img
        src={emoji.url}
        alt={alt || ''}
        className={className}
        style={style}
        loading="lazy"
        onLoad={onLoad}
        onError={handleDirectError}
        {...rest}
      />
    )
  }
  if (direct) {
    if (directFailed) return null
    return (
      <img
        src={viaProxy ? safeProxyUrl(src) : src}
        alt={alt || ''}
        className={className}
        style={style}
        loading="lazy"
        onLoad={onLoad}
        onError={handleDirectError}
        {...rest}
      />
    )
  }
  if (fetchClientMedia) {
    if (error) return null
    if (!blobUrl) return null
    return <img src={blobUrl} alt={alt || ''} className={className} style={style} onLoad={onLoad} {...rest} />
  }
  if (directFailed) return null
  return (
    <img
      src={safeProxyUrl(src)}
      alt={alt || ''}
      className={className}
      style={style}
      loading="lazy"
      onLoad={onLoad}
      onError={handleDirectError}
      {...rest}
    />
  )
}

// Blurred color-field preview shown while the real image loads.
// Decodes once per hash at a small fixed resolution; CSS scales it up
// smoothly over the media slot.
function BlurhashPlaceholder({ hash, aspectRatio }) {
  const canvasRef = useRef(null)
  const w = 32
  const h = Math.max(8, Math.min(64, aspectRatio ? Math.round(32 / aspectRatio) : 32))
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const decoded = decodeBlurhash(hash, w, h)
    if (!decoded) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.putImageData(new ImageData(decoded.rgba, decoded.width, decoded.height), 0, 0)
  }, [hash, h])
  return (
    <canvas
      ref={canvasRef}
      className="media-blurhash"
      width={w}
      height={h}
      aria-hidden="true"
    />
  )
}

function attachmentAspect(attachment) {
  const meta = attachment.meta || {}
  const dims = meta.small?.width ? meta.small : meta.original
  if (dims?.width && dims?.height) return dims.width / dims.height
  return null
}

// Image slot with a blurhash underlay. The placeholder stays visible
// until the browser has actually painted the image — in direct mode
// the <img> starts loading immediately, so the hook's loading flag
// alone can't drive this.
function ImageMedia({ attachment, description, showImg, imgSrc, imgLoading, imgError, clientMode, onOpenLightbox }) {
  const [imgReady, setImgReady] = useState(false)
  const aspectRatio = attachmentAspect(attachment)
  const showPlaceholder = Boolean(attachment.blurhash) && !(clientMode ? !imgLoading : imgReady)
  return (
    <button
      type="button"
      className={`media-item media-image${showPlaceholder ? ' media-loading' : ''}${imgError ? ' media-error' : ''}`}
      onClick={() => onOpenLightbox(attachment)}
      aria-label={description || 'Open image'}
      title={description || undefined}
    >
      {attachment.blurhash && !imgError && (
        <div className="media-blurhash-wrap" style={aspectRatio ? { aspectRatio: `${aspectRatio}` } : undefined}>
          <BlurhashPlaceholder hash={attachment.blurhash} aspectRatio={aspectRatio} />
        </div>
      )}
      {showImg && (
        <img
          src={imgSrc}
          alt={description || ''}
          onLoad={() => setImgReady(true)}
        />
      )}
      {!attachment.blurhash && imgLoading && <div className="media-loading-overlay"><div className="media-spinner" /></div>}
      {imgError && <div className="media-error-overlay"><span>Failed to load</span></div>}
    </button>
  )
}

function MediaItem({ attachment, onOpenLightbox }) {
  const { type, url, preview_url: previewUrl, remote_url: remoteUrl, description } = attachment
  const remoteFallback = attachment._remote_fallback || null
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
    } catch { /* ignore */ }
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
      <ImageMedia
        attachment={attachment}
        description={description}
        showImg={showImg}
        imgSrc={imgSrc}
        imgLoading={imgLoading}
        imgError={imgError}
        clientMode={Boolean(fetchClientMedia)}
        onOpenLightbox={onOpenLightbox}
      />
    )
  }

  if (type === 'video' || type === 'gifv') {
    const showVid = fetchClientMedia ? (vidBlob || vidError) : true
    const vidSrc = vidBlob || safeProxyUrl(url)
    return (
      <>
        <div
          className={`media-item media-video${vidLoading ? ' media-loading' : ''}${vidError ? ' media-error' : ''}`}
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

export function MediaGrid({ attachments, sensitive, spoilerText, onOpenLightbox, forceHidden }) {
  const { alwaysSensitive, peekSpoilerMedia } = useContext(AppSettingsContext)
  const { pos, track, clear } = useCursorPreview()
  const effectiveSensitive = Boolean(sensitive) || Boolean(alwaysSensitive)
  const [userRevealed, setUserRevealed] = useState(!effectiveSensitive)
  const revealed = !forceHidden && userRevealed

  // Re-blur everything when the global setting flips on mid-session;
  // flipping it off only un-hides media that wasn't sensitive to begin
  // with.
  useEffect(() => {
    setUserRevealed(!effectiveSensitive)
  }, [effectiveSensitive])

  if (!attachments || attachments.length === 0) return null

  const shown = attachments.slice(0, 4)

  // Hover preview exists solely as the spoiler peek: while a CW overlay
  // covers the grid (its button swallows all pointer events), hovering
  // the overlay floats a muted preview of the first image/video. Only
  // meaningful in strict 'mark all media as sensitive' mode with its
  // sub-toggle enabled — outside it, media is one click away anyway.
  const peekEnabled = alwaysSensitive && peekSpoilerMedia && !revealed
  const isPeekVideo = (att) => att.type === 'video' || att.type === 'gifv'
  const peekSource = shown.find((att) => att.type === 'image' || isPeekVideo(att))

  return (
    <div className="media-wrap" onClick={(e) => e.stopPropagation()}>
      <div className={`media-grid count-${shown.length}${revealed ? '' : ' blurred'}`}>
        {shown.map((att, idx) => (
          <MediaItem
            key={att.id}
            attachment={att}
            onOpenLightbox={() => onOpenLightbox({ attachment: att, attachments: shown, index: idx })}
          />
        ))}
      </div>
      {!revealed && (
        <button
          type="button"
          className="media-cw-overlay"
          onClick={() => setUserRevealed(true)}
          onMouseEnter={peekEnabled ? track : undefined}
          onMouseMove={peekEnabled ? track : undefined}
          onMouseLeave={peekEnabled ? clear : undefined}
        >
          <Eye size={18} />
          <span>{spoilerText || 'Sensitive content'} — click to view</span>
        </button>
      )}
      {peekEnabled && pos && peekSource && (
        <div className="media-hover-preview peek-sensitive" style={{ left: pos.x, top: pos.y }}>
          {isPeekVideo(peekSource) ? (
            <video
              src={safeProxyUrl(peekSource.url)}
              autoPlay
              muted
              playsInline
              loop={peekSource.type === 'gifv'}
            />
          ) : (
            <ProxiedImg src={peekSource.preview_url || peekSource.url} alt="" />
          )}
        </div>
      )}
    </div>
  )
}

// The open state lives in the parent: when closed this renders nothing
// without ever changing hook counts. All hooks belong in LightboxContent,
// which only mounts while there's actually something to show.
export function MediaLightbox({ lightboxState, onClose }) {
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
    } catch { /* ignore */ }
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

  const { blobUrl, loading, error } = useClientMedia(
    fetchClientMedia ? attachment.url : null,
    fetchClientMedia ? attachment.remote_url : null,
    fetchClientMedia ? attachment._remote_fallback : null,
    fetchClientMedia ? resolveAtt : null
  )

  // With 'fetch media directly' disabled the blob pipeline is bypassed
  // entirely — fall back to the same proxied URL the thumbnails use.
  let displaySrc = blobUrl || safeProxyUrl(attachment.preview_url || attachment.url)
  if (fetchClientMedia && loading) displaySrc = null

  function goPrev() {
    if (hasPrev) onNavigate({ attachment: imageAttachments[currentIdx - 1], attachments, index: currentIdx - 1, onNavigate })
  }
  function goNext() {
    if (hasNext) onNavigate({ attachment: imageAttachments[currentIdx + 1], attachments, index: currentIdx + 1, onNavigate })
  }

  const [dlState, setDlState] = useState('idle') // 'idle' | 'busy' | 'done'
  async function handleDownload() {
    if (dlState === 'busy') return
    setDlState('busy')
    const ok = await downloadAttachment(attachment, { instanceUrl, token })
    setDlState(ok ? 'done' : 'idle')
    setTimeout(() => setDlState('idle'), 1200)
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
      <button className="icon-btn lightbox-download" onClick={(e) => { e.stopPropagation(); handleDownload() }} disabled={dlState === 'busy'} aria-label="Download">
        <Download size={18} />
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
      {displaySrc ? (
        <>
          <img
            className="lightbox-image"
            src={displaySrc}
            alt={attachment.description || ''}
            onClick={(e) => e.stopPropagation()}
          />
          {attachment.description && (
            <div className="lightbox-caption" onClick={(e) => e.stopPropagation()}>
              {attachment.description}
            </div>
          )}
        </>
      ) : error ? (
        <div className="lightbox-image media-error" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span>Failed to load</span>
        </div>
      ) : (
        <div className="lightbox-image media-loading" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="media-spinner" />
        </div>
      )}
    </div>
  )
}
