// Renders a GIF source as a converted AV1/VP9 <video> when the "Convert
// GIFs to AV1" setting is on, and as a plain image otherwise (or while
// conversion runs). With hover-to-animate on, converted videos render
// paused with data-rvmf-animatable and the document-level hover animator
// plays them; `staticFirst` surfaces (avatars, display-name emoji) only
// convert at all when hover mode is enabled — they're decorative, so a
// static image is cheaper unless the user opted into hover.
import { useContext } from 'react'
import { AppSettingsContext, useGifVideo } from '../hooks'
import { ProxiedImg } from './Media.jsx'

export function GifVideo({
  src,
  staticSrc,
  staticFirst = false,
  className,
  alt,
  title,
  style,
  onLoad,
  onError,
  fallbackText,
  direct = false,
  ...rest
}) {
  const { gifConversionEnabled, gifIncludeLarge, gifHoverAnimate } = useContext(AppSettingsContext)
  const hoverMode = gifHoverAnimate
  const convert = gifConversionEnabled && (hoverMode || !staticFirst)
  const { status, videoUrl } = useGifVideo(src, { active: convert, includeLarge: gifIncludeLarge })

  function renderStatic() {
    if (!src) return null
    // staticFirst without a static image (e.g. an animated avatar with no
    // avatar_static) renders nothing while awaiting conversion — callers
    // like Avatar layer their own placeholder underneath.
    const displaySrc = convert && hoverMode && staticFirst && !staticSrc ? null : (staticSrc || src)
    if (displaySrc === null) return null
    return (
      <ProxiedImg
        src={displaySrc}
        alt={alt || ''}
        title={title}
        className={className}
        style={style}
        fallbackText={fallbackText}
        direct={direct}
        onLoad={onLoad}
        onError={onError}
        {...rest}
      />
    )
  }

  if (convert && status === 'ready' && videoUrl) {
    return (
      <video
        className={className}
        style={style}
        src={videoUrl}
        poster={staticSrc || undefined}
        muted
        loop
        playsInline
        preload="auto"
        autoPlay={!hoverMode}
        data-rvmf-animatable={hoverMode ? 'true' : undefined}
        onLoadedData={onLoad}
        onError={onError}
        {...rest}
      />
    )
  }
  return renderStatic()
}