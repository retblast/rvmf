// Builds a minimal valid GIF89a for tests. One palette (red, green, blue,
// black), 2x2 canvas, each frame described by { delay, disposal,
// transparent, pixels }. LZW output for a 2x2 image never exceeds the
// 3-bit literal codes (4 = clear, 5 = end), which is all the decoder
// needs to reconstruct `pixels`.
export function makeTinyGif(frames) {
  const setup = (frame) => ({
    delay: 10,
    disposal: 1,
    transparent: false,
    indexes: [0, 1, 2, 3],
    ...frame,
  })
  const palette = [
    [255, 0, 0], [0, 255, 0], [0, 0, 255], [0, 0, 0],
  ]
  const bytes = []
  bytes.push(...'GIF89a'.split('').map((c) => c.charCodeAt(0)))
  // Logical screen descriptor: 2x2, global color table present with
  // 2^(1+1) = 4 entries.
  bytes.push(2, 0, 2, 0, 0x81, 0, 0)
  for (const [r, g, b] of palette) bytes.push(r, g, b)

  for (const raw of frames) {
    const f = setup(raw)
    // Graphic control extension.
    bytes.push(0x21, 0xf9, 0x04)
    const gcePacked = (f.transparent ? 1 : 0) | ((f.disposal & 7) << 2)
    bytes.push(gcePacked, f.delay & 0xff, (f.delay >> 8) & 0xff)
    bytes.push(f.transparent ? 0 : 0, 0x00)
    // Image descriptor covering the full 2x2 canvas.
    bytes.push(0x2c, 0, 0, 0, 0, 2, 0, 2, 0, 0x00)
    // LZW: 3-bit codes starting with clear (4) and ending with EOI (5).
    bytes.push(2)
    const codes = [4, ...f.indexes, 5]
    const bits = []
    for (const c of codes) {
      for (let i = 0; i < 3; i++) bits.push((c >> i) & 1)
    }
    const data = []
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0
      for (let j = 0; j < 8; j++) {
        if (bits[i + j]) byte |= 1 << j
      }
      data.push(byte)
    }
    bytes.push(data.length, ...data, 0x00)
  }
  bytes.push(0x3b)
  return new Uint8Array(bytes)
}

// Same canvas/color table as makeTinyGif, but with an oversized payload
// (valid magic at the front) so the byte-size gates can be exercised.
export function makeLargeGifBytes(size) {
  const bytes = new Uint8Array(size)
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0)
  return bytes
}