// GIF -> AV1/VP9 conversion pipeline. Pure browser APIs plus two small
// deps (gifuct-js for parsing, webm-muxer for container writing), with
// the encoder pieces injected so vitest can run the loop without real
// codecs. Runs inside a Web Worker (see convert.worker.js); the main
// thread only touches the cheap gate helpers (isGifUrl, detectGifBytes,
// videoEncodingAvailable) and the constants.
import { parseGIF, decompressFrames } from 'gifuct-js'
import { Muxer, ArrayBufferTarget, FileSystemWritableFileStreamTarget } from 'webm-muxer'

// Below this size animated GIFs are cheaper to decode than they are to
// encode (custom emoji sit just above this, so keep it low); above this
// size a conversion is too slow to bother with unless the user opts into
// large files.
export const GIF_MIN_BYTES = 1024
export const GIF_LARGE_BYTES = 5 * 1024 * 1024

// Absolute ceiling on the *input* GIF, applied even when the user widened
// the "large" gate. Bounds main-thread transient RAM (fetchGifBytes holds
// the bytes once before transferring them to the worker) and CPU time —
// a GIF any bigger is almost certainly mislabeled content. This is a
// sanity bound, not the real memory limiter (that's GIF_MAX_PATCH_BYTES).
export const GIF_MAX_INPUT_BYTES = 25 * 1024 * 1024

// Safety valve: the *real* memory limiter. gifuct's decompressFrames()
// materializes every frame's RGBA patch at once (each patch is
// dims.width * dims.height * 4 bytes), so a 200-frame full-frame GIF can
// spike to hundreds of MB in the worker. Computed from parseGIF's frame
// metadata BEFORE decompression, so a monster never even gets allocated.
// 120 MB covers normal shareable GIFs (a 640x480 100-frame ≈ 123 MB) and
// leaves headroom inside a short-lived worker we terminate afterwards.
export const GIF_MAX_PATCH_BYTES = 120 * 1024 * 1024

// Safety valve: total composed pixels across all frames. Guards against
// multi-hundred-frame monsters pinning the worker's CPU time, mirroring
// the patch gate from the RAM side (an all-full-frame GIF hits both).
export const GIF_MAX_PIXEL_WORK = 300 * 1000 * 1000

// Estimated encoded-output ceiling: bitrate (capped at 8 Mbps) times
// duration. ~1 minute of footage at the encoder's ceiling. Stops "GIFs"
// that are really videos from chewing disk quota (and, on the in-memory
// fallback path, a whole output buffer in the worker).
export const GIF_MAX_OUTPUT_ESTIMATE_BYTES = 96 * 1024 * 1024

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

  // `hasAlpha` is authoritative, so run one dry composition pass at
  // creation: any composed frame containing a pixel with alpha < 255 (a
  // disposal-2 clear, an area no frame ever draws, or a semi-transparent
  // patch) means the encoder must flatten that frame onto a background
  // because VP9/AV1 have no alpha channel in WebM. The cursor and buffer
  // are rewound afterward; the real pass replays identically.
  for (let i = 0; i < frames.length; i++) {
    composeNext()
    if (!hasAlpha && frameHasTransparency()) hasAlpha = true
  }
  index = -1
  prevDisposal = 0
  prevDims = null
  prevSnapshot = null

  // True when any pixel of the composed canvas has alpha < 255. Only the
  // real canvas counts: the padding row/column added for odd dimensions
  // is never drawn and must not count as user-visible transparency.
  function frameHasTransparency() {
    for (let y = 0; y < height; y++) {
      const start = y * paddedWidth * 4
      for (let x = 0; x < width; x++) {
        if (data[start + x * 4 + 3] !== 255) return true
      }
    }
    return false
  }

  function clearRegion(rect) {
    for (let y = 0; y < rect.height; y++) {
      const start = ((rect.top + y) * paddedWidth + rect.left) * 4
      data.fill(0, start, start + rect.width * 4)
    }
  }

  function drawPatch(patch, rect) {
    const srcStride = rect.width
    for (let y = 0; y < rect.height; y++) {
      const srcStart = y * srcStride * 4
      const dstStart = ((rect.top + y) * paddedWidth + rect.left) * 4
      for (let x = 0; x < rect.width; x++) {
        const sp = srcStart + x * 4
        // A transparent GIF pixel is "don't draw", not "erase": it leaves
        // the underlying canvas untouched so earlier frames' content shows
        // through (delta-encoded stickers rely on this heavily). GIFs only
        // carry one-bit alpha; a partial alpha pixel is copied as-is.
        if (patch[sp + 3] === 0) continue
        const dp = dstStart + x * 4
        data[dp] = patch[sp]
        data[dp + 1] = patch[sp + 1]
        data[dp + 2] = patch[sp + 2]
        data[dp + 3] = patch[sp + 3]
      }
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
    if (rect) drawPatch(frame.patch, rect)

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

// WebM/AV1 have no alpha channel, so transparent GIF pixels are blended
// onto a background (white by default — what most light themes show).
// Fully opaque frames skip this entirely, so it's a no-op in the common
// case. A future setting could let users pick the flatten color.
export function flattenAlphaFrame(data, r = 255, g = 255, b = 255) {
  for (let p = 0; p < data.length; p += 4) {
    const a = data[p + 3]
    if (a === 255) continue
    const src = a / 255
    const bg = 1 - src
    data[p] = Math.round(data[p] * src + r * bg)
    data[p + 1] = Math.round(data[p + 1] * src + g * bg)
    data[p + 2] = Math.round(data[p + 2] * src + b * bg)
    data[p + 3] = 255
  }
  return data
}

// Browser globals the encode loop needs, resolved once. OffscreenCanvas
// is worker-safe; a document canvas is the main-thread fallback when
// something ever runs the pipeline outside a worker.
function defaultDeps() {
  return {
    ImageDataCtor: ImageData,
    CanvasCtor: typeof OffscreenCanvas !== 'undefined'
      ? OffscreenCanvas
      : typeof document !== 'undefined'
        ? (() => document.createElement('canvas'))
        : undefined,
    VideoEncoder: typeof globalThis !== 'undefined' ? globalThis.VideoEncoder : undefined,
    VideoFrame: typeof globalThis !== 'undefined' ? globalThis.VideoFrame : undefined,
    MuxerCtor: Muxer,
    ArrayBufferTarget,
    FileSystemWritableFileStreamTarget,
  }
}

// The actual encode loop, shared by the in-memory (blob) and on-disk
// (OPFS) paths. `buildMuxer` wires the target so the exact same frames
// can land in an ArrayBuffer or stream to a file.
async function encodeFramesToContainer(source, D, buildMuxer) {
  if (source.frameCount === 0) throw new GifConversionError('empty', 'GIF has no drawable frames')
  // Transparent GIFs are allowed through: their frames are flattened onto
  // a background in the encode loop below (see flattenAlphaFrame).

  const totalPixelWork = source.width * source.height * source.frameCount
  if (totalPixelWork > GIF_MAX_PIXEL_WORK) {
    throw new GifConversionError('too-large', 'GIF animation is too large to convert')
  }

  const width = source.paddedWidth
  const height = source.paddedHeight
  const totalDelayMs = source.delayMs.reduce((a, b) => a + b, 0)
  const bitrate = bitrateFor(width, height, source.frameCount, totalDelayMs)

  // Reject a degenerate output before the first frame encodes: at the
  // bitrate ceiling (~8 Mbps) this is just bitrate * duration / 8.
  // Catches "GIFs" that are really multi-minute videos.
  const estimatedBytes = Math.ceil((bitrate * totalDelayMs) / 8000)
  if (estimatedBytes > GIF_MAX_OUTPUT_ESTIMATE_BYTES) {
    throw new GifConversionError('too-large', 'Converted video would be too large')
  }

  const codec = await pickCodec(D.VideoEncoder, { width, height, bitrate, framerate: 24 })
  if (!codec) throw new GifConversionError('unsupported', 'No AV1/VP9 encoding support')

  const muxer = buildMuxer(codec, width, height, source.frameCount > 0 && totalDelayMs > 0
    ? (source.frameCount * 1000) / totalDelayMs
    : undefined)

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
    if (source.hasAlpha) flattenAlphaFrame(imageData.data)
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
  return { muxer, codec, width: source.width, height: source.height, frameCount: source.frameCount, durationMs: totalDelayMs }
}

// Encodes a composed frame source (as produced by createGifFrameSource)
// into a WebM blob. `deps` defaults to the browser globals; tests inject
// fakes for VideoEncoder/VideoFrame/ImageData and the muxer.
export async function encodeFramesToWebm(source, deps) {
  const D = deps || defaultDeps()
  const { muxer, codec, width, height, frameCount, durationMs } = await encodeFramesToContainer(source, D, (codec, width, height, frameRate) =>
    new D.MuxerCtor({
      target: new D.ArrayBufferTarget(),
      video: {
        // Matroska/WebM CodecID (V_AV1 / V_VP9), not the RFC codec string.
        codec: codec === GIF_CODEC_VP9 ? 'V_VP9' : 'V_AV1',
        width,
        height,
        frameRate,
      },
    })
  )
  const buffer = muxer.target.buffer
  if (!buffer || buffer.byteLength === 0) {
    throw new GifConversionError('encode', 'muxer produced no output')
  }
  return {
    blob: new Blob([buffer], { type: 'video/webm' }),
    codec,
    width,
    height,
    frameCount,
    durationMs,
  }
}

// Same encode loop, but the muxer streams straight into a
// FileSystemWritableFileStream (an OPFS file) so no output buffer ever
// exists — "files way larger than the available RAM" territory. The
// caller owns the writable: it created it, must close it after we return,
// and reads the final size from the file handle. `deps.fsWritable` is the
// stream; tests inject fakes for everything else.
export async function encodeFramesToWebmFile(source, deps) {
  const D = deps || defaultDeps()
  if (!D.fsWritable || typeof D.FileSystemWritableFileStreamTarget !== 'function') {
    throw new GifConversionError('opfs-unavailable', 'File system write target not available')
  }
  const writable = D.fsWritable
  const { codec, width, height, frameCount, durationMs } = await encodeFramesToContainer(source, D, (codec, width, height, frameRate) =>
    new D.MuxerCtor({
      target: new D.FileSystemWritableFileStreamTarget(writable),
      video: {
        // Matroska/WebM CodecID (V_AV1 / V_VP9), not the RFC codec string.
        codec: codec === GIF_CODEC_VP9 ? 'V_VP9' : 'V_AV1',
        width,
        height,
        frameRate,
      },
    })
  )
  return { codec, width, height, frameCount, durationMs }
}

// Full pipeline: GIF bytes -> parsed frames -> composed source -> WebM
// (in-memory blob; the OPFS path is gifBytesToWebmFile).
export function gifBytesToWebm(arrayBuffer, deps) {
  const source = gifBytesToFrameSource(arrayBuffer)
  return encodeFramesToWebm(source, deps)
}

// Full pipeline ending in an OPFS file: GIF bytes -> composed source ->
// WebM streamed into `fsWritable`. See encodeFramesToWebmFile for the
// ownership contract (caller closes the writable, reads the size).
export function gifBytesToWebmFile(arrayBuffer, fsWritable, deps) {
  const source = gifBytesToFrameSource(arrayBuffer)
  return encodeFramesToWebmFile(source, { ...(deps || defaultDeps()), fsWritable })
}

// Parse + compose without encoding. Exported for tests and for any caller
// that needs frame metadata (dimensions, delays, transparency) up front.
export function gifBytesToFrameSource(arrayBuffer) {
  const parsed = parseGIF(arrayBuffer)
  if (!parsed?.lsd) throw new GifConversionError('invalid', 'not a GIF')
  // Sum the frames' rect areas BEFORE decompressFrames runs: gifuct only
  // allocates pixel patches during decompression, so this is the cheapest
  // possible point to reject a RAM monster (frame dims live in the parsed
  // schema; the patches they'd become are width*height*4 bytes each).
  const patchBytes = (parsed.frames || []).reduce((sum, f) => {
    const d = f?.image?.descriptor
    return sum + (d?.width || 0) * (d?.height || 0) * 4
  }, 0)
  if (patchBytes > GIF_MAX_PATCH_BYTES) {
    throw new GifConversionError('too-large', 'GIF animation is too large to convert')
  }
  return createGifFrameSource(parsed)
}