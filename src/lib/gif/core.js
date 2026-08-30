// GIF -> AV1/VP9 conversion pipeline. Pure browser APIs plus two small
// deps (gifuct-js for parsing, webm-muxer for container writing), with
// the encoder pieces injected so vitest can run the loop without real
// codecs. Runs inside a Web Worker (see convert.worker.js); the main
// thread only touches the cheap gate helpers (isGifUrl, detectGifBytes,
// videoEncodingAvailable) and the constants.
import { parseGIF, decompressFrames } from 'gifuct-js'
import { Muxer, ArrayBufferTarget } from 'webm-muxer'

// Below this size animated GIFs are cheaper to decode than they are to
// encode; above this size a conversion is too slow to bother with unless
// the user opts into large files.
export const GIF_MIN_BYTES = 4 * 1024
export const GIF_LARGE_BYTES = 5 * 1024 * 1024

// Safety valve: total composed pixels across all frames. Guards against
// multi-hundred-frame monsters pinning the worker's memory.
export const GIF_MAX_PIXEL_WORK = 300 * 1000 * 1000

// Keyframe every N frames so scrubbing/seeking stays cheap.
export const GIF_KEYFRAME_INTERVAL = 30

// Codec ladder: AV1 (level 4.0 for up to 4K) -> AV1 (level 2.0) -> VP9.
// Tried in order through VideoEncoder.isConfigSupported, since older
// decoders may reject a config that the browser's API otherwise knows.
export const GIF_CODEC_AV1_LEVEL4 = 'av01.0.08M.08'
export const GIF_CODEC_AV1_LEVEL2 = 'av01.0.04M.08'
export const GIF_CODEC_VP9 = 'vp09.00.31.08'
const CODEC_LADDER = [GIF_CODEC_AV1_LEVEL4, GIF_CODEC_AV1_LEVEL2, GIF_CODEC_VP9]

export class GifConversionError extends Error {
  constructor(code, message) {
    super(message || code)
    this.name = 'GifConversionError'
    this.code = code
  }
}

export function isGifUrl(url) {
  if (!url) return false
  try {
    return /\.gif$/i.test(new URL(url, 'http://x').pathname)
  } catch {
    return false
  }
}

export function detectGifBytes(bytes) {
  if (!bytes || bytes.byteLength < 6) return false
  const b = new Uint8Array(bytes, 0, 6)
  return b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 &&
    b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61
}

export function videoEncodingAvailable() {
  return typeof globalThis !== 'undefined' && typeof globalThis.VideoEncoder === 'function'
}

// ---- Frame composition --------------------------------------------------
// gifuct's `patch` is frame-local: each frame only carries the pixels of
// its own rectangle. Real GIFs rely on disposal methods to clear or
// restore regions between frames, so the full composite has to be rebuilt
// here. The composer streams: every next() call advances one frame and
// rewrites the shared `data` buffer, so memory stays O(w*h) instead of
// O(w*h*frames).
function clampRect(dims, width, height) {
  const left = Math.max(0, dims.left)
  const top = Math.max(0, dims.top)
  const right = Math.min(width, dims.left + dims.width)
  const bottom = Math.min(height, dims.top + dims.height)
  if (right <= left || bottom <= top) return null
  return { left, top, width: right - left, height: bottom - top }
}

export function createGifFrameSource(parsedGif) {
  const frames = decompressFrames(parsedGif, true)
  const width = parsedGif.lsd?.width || 0
  const height = parsedGif.lsd?.height || 0
  // VideoEncoder requires even dimensions; padding happens in the output
  // canvas so the encoded frames always satisfy that constraint.
  const paddedWidth = width + (width % 2)
  const paddedHeight = height + (height % 2)
  const data = new Uint8ClampedArray(paddedWidth * paddedHeight * 4)
  const delayMs = frames.map((f) => f.delay)

  let index = -1
  let prevDisposal = 0
  let prevDims = null
  let prevSnapshot = null
  let hasAlpha = false

  // Transparency is a conversion blocker, and the caller checks it before
  // configuring an encoder. Run one dry composition pass at creation so
  // `hasAlpha` is authoritative: disposal-2 clears and any patch pixel
  // with alpha < 255 make the composed output transparent. The cursor and
  // buffer are rewound afterward; the real pass replays identically.
  for (let i = 0; i < frames.length; i++) composeNext()
  index = -1
  prevDisposal = 0
  prevDims = null
  prevSnapshot = null

  function clearRegion(rect) {
    for (let y = 0; y < rect.height; y++) {
      const start = ((rect.top + y) * paddedWidth + rect.left) * 4
      data.fill(0, start, start + rect.width * 4)
    }
    hasAlpha = true
  }

  function drawPatch(patch, rect) {
    const srcStride = rect.width
    for (let y = 0; y < rect.height; y++) {
      const srcStart = y * srcStride * 4
      const dstStart = ((rect.top + y) * paddedWidth + rect.left) * 4
      data.set(patch.subarray(srcStart, srcStart + rect.width * 4), dstStart)
    }
  }

  function saveRegion(rect) {
    const snapshot = new Uint8ClampedArray(rect.width * rect.height * 4)
    for (let y = 0; y < rect.height; y++) {
      const srcStart = ((rect.top + y) * paddedWidth + rect.left) * 4
      snapshot.set(data.subarray(srcStart, srcStart + rect.width * 4), y * rect.width * 4)
    }
    return snapshot
  }

  function restoreRegion(snapshot, rect) {
    for (let y = 0; y < rect.height; y++) {
      const srcStart = y * rect.width * 4
      const dstStart = ((rect.top + y) * paddedWidth + rect.left) * 4
      data.set(snapshot.subarray(srcStart, srcStart + rect.width * 4), dstStart)
    }
  }

  function composeNext() {
    if (index + 1 >= frames.length) return null
    index += 1
    const frame = frames[index]

    // Apply the previous frame's disposal before drawing this one.
    if (prevDisposal === 2 && prevDims) {
      const rect = clampRect(prevDims, paddedWidth, paddedHeight)
      if (rect) clearRegion(rect)
    } else if (prevDisposal === 3 && prevDims && prevSnapshot) {
      const rect = clampRect(prevDims, paddedWidth, paddedHeight)
      if (rect) restoreRegion(prevSnapshot, rect)
    }

    // Disposal 3 needs the pre-draw state of this frame's region.
    if (frame.disposalType === 3) {
      const rect = clampRect(frame.dims, paddedWidth, paddedHeight)
      prevSnapshot = rect ? saveRegion(rect) : null
    }
    prevDims = frame.dims
    prevDisposal = frame.disposalType

    const rect = clampRect(frame.dims, paddedWidth, paddedHeight)
    if (rect) {
      // Any patch pixel with alpha < 255 means real transparency; the
      // conversion is skipped upstream because alpha layers would show
      // as black boxes in many decoders.
      for (let p = 3; p < frame.patch.length; p += 4) {
        if (frame.patch[p] !== 255) { hasAlpha = true; break }
      }
      drawPatch(frame.patch, rect)
    }

    return { index, delay: frame.delay }
  }

  return {
    width,
    height,
    paddedWidth,
    paddedHeight,
    // The live composition buffer; rewritten by every next() call. Exposed
    // so the encoder can copy it into an ImageData without re-parsing.
    data,
    frameCount: frames.length,
    delayMs,
    get hasAlpha() {
      return hasAlpha
    },
    // Composes the next frame into `data`; returns { index, delay } or
    // null at the end. `data` aliases a reusable buffer — encode it before
    // calling next() again.
    next() {
      return composeNext()
    },
  }
}

// ---- Encoding -----------------------------------------------------------
// Rough bit budget: ~0.12 bits per pixel per frame, floored at a
// watchable minimum and capped so huge frames don't explode the bitrate.
export function bitrateFor(width, height, frameCount, durationMs) {
  const fps = durationMs > 0 ? (frameCount * 1000) / durationMs : 10
  const bitsPerSec = width * height * fps * 0.12
  return Math.round(Math.min(8_000_000, Math.max(100_000, bitsPerSec)))
}

async function pickCodec(encoderCtor, config) {
  for (const codec of CODEC_LADDER) {
    try {
      const support = await encoderCtor.isConfigSupported({ ...config, codec })
      if (support?.supported) return codec
    } catch { /* try the next rung */ }
  }
  return null
}

// Encodes a composed frame source (as produced by createGifFrameSource)
// into a WebM blob. `deps` defaults to the browser globals; tests inject
// fakes for VideoEncoder/VideoFrame/ImageData and the muxer.
export async function encodeFramesToWebm(source, deps) {
  const D = deps || {
    ImageDataCtor: ImageData,
    // OffscreenCanvas is worker-safe; a document canvas is the main-thread
    // fallback when something ever runs the pipeline outside a worker.
    CanvasCtor: typeof OffscreenCanvas !== 'undefined'
      ? OffscreenCanvas
      : typeof document !== 'undefined'
        ? (() => document.createElement('canvas'))
        : undefined,
    VideoEncoder: typeof globalThis !== 'undefined' ? globalThis.VideoEncoder : undefined,
    VideoFrame: typeof globalThis !== 'undefined' ? globalThis.VideoFrame : undefined,
    MuxerCtor: Muxer,
    ArrayBufferTarget,
  }
  if (source.frameCount === 0) throw new GifConversionError('empty', 'GIF has no drawable frames')
  if (source.hasAlpha) throw new GifConversionError('transparent', 'GIF uses transparency; skipping conversion')

  const totalPixelWork = source.width * source.height * source.frameCount
  if (totalPixelWork > GIF_MAX_PIXEL_WORK) {
    throw new GifConversionError('too-large', 'GIF animation is too large to convert')
  }

  const width = source.paddedWidth
  const height = source.paddedHeight
  const totalDelayMs = source.delayMs.reduce((a, b) => a + b, 0)
  const bitrate = bitrateFor(width, height, source.frameCount, totalDelayMs)

  const codec = await pickCodec(D.VideoEncoder, { width, height, bitrate, framerate: 24 })
  if (!codec) throw new GifConversionError('unsupported', 'No AV1/VP9 encoding support')

  const muxer = new D.MuxerCtor({
    target: new D.ArrayBufferTarget(),
    video: {
      // Matroska/WebM CodecID (V_AV1 / V_VP9), not the RFC codec string.
      codec: codec === GIF_CODEC_VP9 ? 'V_VP9' : 'V_AV1',
      width,
      height,
      frameRate: source.frameCount > 0 && totalDelayMs > 0 ? (source.frameCount * 1000) / totalDelayMs : undefined,
    },
  })

  let encoderError = null
  const encoder = new D.VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => { encoderError = err },
  })
  encoder.configure({ codec, width, height, bitrate, latencyMode: 'quality' })

  // Wait for the encode queue to drain instead of buffering every frame
  // in memory; the encoder output is pumped into the muxer on dequeue.
  const waitForDequeue = () => new Promise((resolve) => {
    encoder.addEventListener('dequeue', resolve, { once: true })
  })
  const imageData = new D.ImageDataCtor(source.paddedWidth, source.paddedHeight)
  // VideoFrame's accepted sources are canvas/ImageBitmap/VideoFrame — an
  // ImageData alone throws "overload resolution failed" in Chromium. Draw
  // each composed frame into a reusable canvas so the VideoFrame gets a
  // source every browser accepts.
  let frameSource = imageData
  let canvasCtx = null
  if (D.CanvasCtor) {
    const canvas = new D.CanvasCtor(source.paddedWidth, source.paddedHeight)
    canvasCtx = canvas.getContext('2d')
    frameSource = canvas
  }
  let timestampUs = 0

  for (let i = 0; i < source.frameCount; i++) {
    const step = source.next()
    const durationUs = Math.round(step.delay * 1000)
    imageData.data.set(source.data)
    if (canvasCtx) canvasCtx.putImageData(imageData, 0, 0)
    const frame = new D.VideoFrame(frameSource, {
      timestamp: timestampUs,
      duration: durationUs,
    })
    encoder.encode(frame, { keyFrame: i % GIF_KEYFRAME_INTERVAL === 0 })
    frame.close()
    timestampUs += durationUs
    if (encoder.encodeQueueSize > 2) await waitForDequeue()
  }

  await encoder.flush()
  if (encoderError) throw new GifConversionError('encode', encoderError?.message || 'video encoder failed')
  encoder.close()

  muxer.finalize()
  const buffer = muxer.target.buffer
  if (!buffer || buffer.byteLength === 0) {
    throw new GifConversionError('encode', 'muxer produced no output')
  }
  return {
    blob: new Blob([buffer], { type: 'video/webm' }),
    codec,
    width: source.width,
    height: source.height,
    frameCount: source.frameCount,
    durationMs: totalDelayMs,
  }
}

// Full pipeline: GIF bytes -> parsed frames -> composed source -> WebM.
export function gifBytesToWebm(arrayBuffer, deps) {
  const source = gifBytesToFrameSource(arrayBuffer)
  return encodeFramesToWebm(source, deps)
}

// Parse + compose without encoding. Exported for tests and for any caller
// that needs frame metadata (dimensions, delays, transparency) up front.
export function gifBytesToFrameSource(arrayBuffer) {
  const parsed = parseGIF(arrayBuffer)
  if (!parsed?.lsd) throw new GifConversionError('invalid', 'not a GIF')
  return createGifFrameSource(parsed)
}