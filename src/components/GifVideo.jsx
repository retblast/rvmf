// Renders a GIF source as a converted AV1/VP9 <video> when the "Convert
// GIFs to AV1" setting is on, and as a plain image otherwise (or while
// conversion runs). The hover setting only decides how converted videos
// play: with hover-to-animate on they render paused with
// data-rvmf-animatable for the document-level hover animator, otherwise
// they autoplay. Every surface — media, emoji, headers — converts the
// same way.
import { useContext } from 'react'
import { AppSettingsContext, useGifVideo } from '../hooks'
import { ProxiedImg } from './Media.jsx'

export function GifVideo({
  src,
  staticSrc,
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
  const convert = gifConversionEnabled
  const { status, videoUrl } = useGifVideo(src, { active: convert, includeLarge: gifIncludeLarge })

  function renderStatic() {
    if (!src) return null
    // The static frame (when one exists) stays up while conversion runs
    // or skips; without one the source image itself is the placeholder.
    const displaySrc = staticSrc || src
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