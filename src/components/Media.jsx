import { useCallback, useContext, useEffect, useState } from 'react'
import {
  X,
  Music,
  Paperclip,
  Eye,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import {
  AppSettingsContext,
  proxyUrl,
  safeProxyUrl,
  useCursorPreview,
  useClientMedia,
} from '../hooks'

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
  const initials = (name || '?')
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

export function ProxiedImg({ src, fallbackSrc, alt, className, style, onError, onLoad, fallbackText, ...rest }) {
  const { fetchClientMedia } = useContext(AppSettingsContext)
  const [directFailed, setDirectFailed] = useState(false)
  const { blobUrl, loading, error } = useClientMedia(
    fetchClientMedia && src ? src : null,
    fetchClientMedia && fallbackSrc ? fallbackSrc : null
  )
  useEffect(() => {
    if (error && onError) onError()
  }, [error, onError])
  useEffect(() => {
    setDirectFailed(false)
  }, [src])

  function handleDirectError(e) {
    setDirectFailed(true)
    onError?.(e)
  }

  const showPlaceholder = Boolean(fallbackText) && (
    !src ||
    (fetchClientMedia ? (error || (!blobUrl && loading)) : directFailed)
  )
  if (showPlaceholder) {
    return <ImgPlaceholder text={fallbackText} alt={alt} className={className} />
  }
  // Without fallbackText the old behavior stands: render nothing while
  // pending/failed (callers like Avatar layer their own placeholders).
  if (!src) return null
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

export function MediaGrid({ attachments, sensitive, spoilerText, onOpenLightbox, forceHidden }) {
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
