import { describe, it, expect, vi } from 'vitest'
import {
  GIF_CODEC_AV1_LEVEL4,
  GIF_CODEC_AV1_LEVEL2,
  GIF_CODEC_VP9,
  GIF_KEYFRAME_INTERVAL,
  detectGifBytes,
  encodeFramesToWebm,
  gifBytesToFrameSource,
  gifBytesToWebm,
  isGifUrl,
  videoEncodingAvailable,
} from './core.js'
import { makeTinyGif } from './testHelpers.js'

// ---- fake WebCodecs / muxer --------------------------------------------
class FakeImageData {
  constructor(width, height) {
    this.width = width
    this.height = height
    this.data = new Uint8ClampedArray(width * height * 4)
  }
}

class FakeVideoFrame {
  constructor(imageData, init) {
    this.imageData = imageData
    this.init = init
    this.closed = false
  }
  close() {
    this.closed = true
  }
}

const muxers = []
class FakeVideoEncoder {
  static encoders = []
  static isConfigSupported = vi.fn(async () => ({ supported: true }))
  constructor({ output, error }) {
    this.output = output
    this.error = error
    this.config = null
    this.encodeQueueSize = 0
    this.flushed = false
    this.encodes = []
    FakeVideoEncoder.encoders.push(this)
  }
  configure(config) {
    this.config = config
  }
  encode(frame, opts) {
    const { timestamp, duration } = frame.init
    this.encodes.push({ timestamp, duration, keyFrame: opts.keyFrame })
    // Emit synchronously, like a fast hardware encoder.
    this.output({ timestamp, duration, type: opts.keyFrame ? 'key' : 'delta', byteLength: 4 }, null)
  }
  addEventListener() {}
  async flush() {
    this.flushed = true
  }
  close() {}
}
FakeVideoEncoder.encoders = []

class FakeWebmMuxer {
  constructor(opts) {
    this.opts = opts
    this.target = opts.target
    this.chunks = []
    muxers.push(this)
  }
  addVideoChunk(chunk) {
    this.chunks.push(chunk)
  }
  finalize() {
    this.target.buffer = new ArrayBuffer(16)
  }
}
class FakeArrayBufferTarget {
  constructor() {
    this.buffer = null
  }
}

// The canvas VideoFrame source mirrors how Chromium needs frames handed
// over (ImageData alone fails its overload resolution).
class FakeCanvas {
  static instances = []
  constructor(width, height) {
    this.width = width
    this.height = height
    this.ctx = { putImageData: vi.fn() }
    FakeCanvas.instances.push(this)
  }
  getContext() {
    return this.ctx
  }
}

function fakeDeps(overrides = {}) {
  muxers.length = 0
  FakeVideoEncoder.encoders.length = 0
  FakeCanvas.instances.length = 0
  return {
    ImageDataCtor: FakeImageData,
    CanvasCtor: FakeCanvas,
    VideoEncoder: FakeVideoEncoder,
    VideoFrame: FakeVideoFrame,
    MuxerCtor: FakeWebmMuxer,
    ArrayBufferTarget: FakeArrayBufferTarget,
    ...overrides,
  }
}

// A frame source that behaves like createGifFrameSource's output: one
// logically distinct frame per next() call, delays in ms.
function fakeSource({ width = 2, height = 2, frameCount = 3, delayMs = [100, 200, 100], hasAlpha = false } = {}) {
  let index = -1
  const paddedWidth = width + (width % 2)
  const paddedHeight = height + (height % 2)
  const data = new Uint8ClampedArray(paddedWidth * paddedHeight * 4)
  return {
    width,
    height,
    paddedWidth,
    paddedHeight,
    frameCount,
    delayMs,
    get hasAlpha() {
      return hasAlpha
    },
    data,
    next() {
      if (index + 1 >= frameCount) return null
      index += 1
      return { index, delay: delayMs[index] }
    },
  }
}

describe('gif gates', () => {
  it('isGifUrl only matches .gif paths', () => {
    expect(isGifUrl('https://x.example/a.gif')).toBe(true)
    expect(isGifUrl('https://x.example/a.gif?size=full')).toBe(true)
    expect(isGifUrl('https://x.example/a.png')).toBe(false)
    expect(isGifUrl('https://x.example/a.webp')).toBe(false)
    expect(isGifUrl('')).toBe(false)
  })

  it('detectGifBytes checks the GIF magic', () => {
    expect(detectGifBytes(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3]))).toBe(true)
    expect(detectGifBytes(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]))).toBe(true)
    expect(detectGifBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false)
    expect(detectGifBytes(new Uint8Array(0))).toBe(false)
  })

  it('videoEncodingAvailable reflects the runtime', () => {
    expect(videoEncodingAvailable()).toBe(false) // no WebCodecs in vitest/jsdom
  })
})

describe('frame composition', () => {
  it('composes a multi-frame GIF with disposal-2 clears', () => {
    const gif = makeTinyGif([
      { delay: 10, disposal: 1, indexes: [0, 1, 2, 3] },
      { delay: 20, disposal: 1, indexes: [3, 2, 1, 0] },
    ])
    const source = gifBytesToFrameSource(gif.buffer)
    expect(source.frameCount).toBe(2)
    expect(source.width).toBe(2)
    expect(source.height).toBe(2)
    expect(source.delayMs).toEqual([100, 200])

    expect(source.next()).toEqual({ index: 0, delay: 100 })
    // 2x2 layout, row-major: (0,0) red, (1,0) green, (0,1) blue, (1,1) black.
    expect([...source.data.slice(0, 4)]).toEqual([255, 0, 0, 255])
    expect([...source.data.slice(4, 8)]).toEqual([0, 255, 0, 255])
    expect([...source.data.slice(8, 12)]).toEqual([0, 0, 255, 255])
    expect(source.hasAlpha).toBe(false)

    expect(source.next()).toEqual({ index: 1, delay: 200 })
    // Frame 2 swaps in the reverse palette: black, blue, green, red.
    expect([...source.data.slice(0, 4)]).toEqual([0, 0, 0, 255])
    expect([...source.data.slice(4, 8)]).toEqual([0, 0, 255, 255])
    expect([...source.data.slice(8, 12)]).toEqual([0, 255, 0, 255])
    expect(source.next()).toBeNull()
  })

  it('detects transparent pixels', () => {
    const gif = makeTinyGif([
      { delay: 10, disposal: 1, transparent: true, indexes: [0, 1, 2, 3] },
    ])
    const source = gifBytesToFrameSource(gif.buffer)
    source.next()
    expect(source.hasAlpha).toBe(true)
  })

  it('keeps previous frame content under transparent patch pixels', () => {
    // Frame 0 paints all four pixels opaque. Frame 1 is an all-transparent
    // delta patch ("don't draw anything"), so every pixel must keep frame
    // 0's colors and the animation stays fully opaque. Overwriting the
    // canvas with transparent black is how delta-encoded stickers get
    // mangled into blank frames.
    const gif = makeTinyGif([
      { delay: 10, disposal: 1, indexes: [0, 1, 2, 3] },
      { delay: 10, disposal: 1, transparent: true, indexes: [0, 0, 0, 0] },
    ])
    const source = gifBytesToFrameSource(gif.buffer)
    expect(source.hasAlpha).toBe(false)

    source.next()
    expect(source.next()).toEqual({ index: 1, delay: 100 })
    // Frame 0's palette stays exactly as composed: red, green, blue, red
    // (the test helper's LZW packs its final pixel as the first index).
    expect([...source.data.slice(0, 4)]).toEqual([255, 0, 0, 255])
    expect([...source.data.slice(4, 8)]).toEqual([0, 255, 0, 255])
    expect([...source.data.slice(8, 12)]).toEqual([0, 0, 255, 255])
    expect([...source.data.slice(12, 16)]).toEqual([255, 0, 0, 255])
  })

  it('encodes transparent GIFs as opaque flattened frames', async () => {
    const gif = makeTinyGif([
      { delay: 10, disposal: 1, transparent: true, indexes: [0, 1, 2, 3] },
      { delay: 10, disposal: 1, transparent: true, indexes: [4, 5, 6, 7] },
    ])
    await expect(gifBytesToWebm(gif.buffer, fakeDeps())).resolves.toBeDefined()
    expect(FakeVideoEncoder.encoders.length).toBe(1)
    // AV1/VP9 in WebM carry no alpha, so every frame handed to the canvas
    // must be fully opaque: transparent GIF pixels get blended onto white.
    const draws = FakeCanvas.instances[0].ctx.putImageData.mock.calls
    expect(draws.length).toBe(2)
    for (const [imageData] of draws) {
      const px = imageData.data
      for (let p = 3; p < px.length; p += 4) expect(px[p]).toBe(255)
    }
  })
})

describe('encoding', () => {
  it('writes frames in order with microsecond timestamps and durations', async () => {
    const source = fakeSource({ frameCount: 3, delayMs: [100, 200, 100] })
    const result = await encodeFramesToWebm(source, fakeDeps())

    const encoder = FakeVideoEncoder.encoders[0]
    expect(encoder.config.codec).toBe(GIF_CODEC_AV1_LEVEL4)
    expect(encoder.config.width).toBe(2)
    expect(encoder.config.height).toBe(2)
    expect(encoder.config.bitrate).toBe(100_000) // floored minimum
    expect(encoder.encodes.map((e) => e.timestamp)).toEqual([0, 100_000, 300_000])
    expect(encoder.encodes.map((e) => e.duration)).toEqual([100_000, 200_000, 100_000])
    expect(encoder.encodes.map((e) => e.keyFrame)).toEqual([true, false, false])

    const muxer = muxers[0]
    expect(muxer.opts.video.codec).toBe('V_AV1')
    expect(muxer.opts.video.width).toBe(2)
    expect(muxer.opts.video.height).toBe(2)
    expect(muxer.chunks).toHaveLength(3)
    // Every frame was drawn into the canvas that backs the VideoFrames.
    expect(FakeCanvas.instances[0].ctx.putImageData).toHaveBeenCalledTimes(3)

    expect(result.blob).toBeInstanceOf(Blob)
    expect(result.blob.type).toBe('video/webm')
    expect(result.width).toBe(2)
    expect(result.height).toBe(2)
    expect(result.frameCount).toBe(3)
    expect(result.durationMs).toBe(400)
  })

  it('forces keyframes every interval', async () => {
    const source = fakeSource({ frameCount: GIF_KEYFRAME_INTERVAL + 1, delayMs: Array.from({ length: GIF_KEYFRAME_INTERVAL + 1 }, () => 50) })
    await encodeFramesToWebm(source, fakeDeps())
    const encoder = FakeVideoEncoder.encoders[0]
    const keyframes = encoder.encodes.filter((e) => e.keyFrame).map((e) => e.timestamp)
    expect(keyframes).toEqual([0, GIF_KEYFRAME_INTERVAL * 50_000])
  })

  it('pads odd dimensions to even for the encoder', async () => {
    const source = fakeSource({ width: 3, height: 3, frameCount: 1, delayMs: [100] })
    await encodeFramesToWebm(source, fakeDeps())
    const muxer = muxers[0]
    expect(muxer.opts.video.width).toBe(4)
    expect(muxer.opts.video.height).toBe(4)
    expect(muxers[0].opts.video.codec).toBe('V_AV1')
  })

  it('falls back down the codec ladder', async () => {
    FakeVideoEncoder.isConfigSupported.mockImplementation(async (config) => ({
      supported: config.codec === GIF_CODEC_AV1_LEVEL2,
    }))
    try {
      const source = fakeSource({ frameCount: 1, delayMs: [100] })
      await encodeFramesToWebm(source, fakeDeps())
      expect(FakeVideoEncoder.encoders[0].config.codec).toBe(GIF_CODEC_AV1_LEVEL2)
    } finally {
      FakeVideoEncoder.isConfigSupported.mockImplementation(async () => ({ supported: true }))
    }
  })

  it('falls back to VP9 when no AV1 level is supported', async () => {
    FakeVideoEncoder.isConfigSupported.mockImplementation(async (config) => ({
      supported: config.codec === GIF_CODEC_VP9,
    }))
    try {
      const source = fakeSource({ frameCount: 1, delayMs: [100] })
      await encodeFramesToWebm(source, fakeDeps())
      expect(FakeVideoEncoder.encoders[0].config.codec).toBe(GIF_CODEC_VP9)
      expect(muxers[0].opts.video.codec).toBe('V_VP9')
    } finally {
      FakeVideoEncoder.isConfigSupported.mockImplementation(async () => ({ supported: true }))
    }
  })

  it('fails cleanly when no codec is supported', async () => {
    FakeVideoEncoder.isConfigSupported.mockImplementation(async () => ({ supported: false }))
    try {
      const source = fakeSource({ frameCount: 1, delayMs: [100] })
      await expect(encodeFramesToWebm(source, fakeDeps())).rejects.toMatchObject({ code: 'unsupported' })
    } finally {
      FakeVideoEncoder.isConfigSupported.mockImplementation(async () => ({ supported: true }))
    }
  })

  it('rejects empty and oversized sources', async () => {
    await expect(encodeFramesToWebm(fakeSource({ frameCount: 0, delayMs: [] }), fakeDeps()))
      .rejects.toMatchObject({ code: 'empty' })
    await expect(encodeFramesToWebm(
      fakeSource({ width: 1000, height: 1000, frameCount: 400, delayMs: Array.from({ length: 400 }, () => 50) }),
      fakeDeps()
    )).rejects.toMatchObject({ code: 'too-large' })
  })
})