// Minimal pure-JS blurhash decoder (83-encoded, the only variant
// servers emit). Decodes to an RGBA pixel buffer for drawing into a
// small canvas that CSS scales up as a loading placeholder.

function decode83(str) {
  let value = 0
  for (let i = 0; i < str.length; i++) {
    const c = str[i]
    const digit = c >= '0' && c <= '9'
      ? c.charCodeAt(0) - 48
      : c >= 'A' && c <= 'Z'
        ? c.charCodeAt(0) - 65 + 10
        : c >= 'a' && c <= 'z'
          ? c.charCodeAt(0) - 97 + 36
          : c === '#'
            ? 62
            : 63
    value = value * 83 + digit
  }
  return value
}

function sRGBtoLinear(value) {
  const v = value / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function linearTosRGB(value) {
  const v = Math.max(0, Math.min(1, value))
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
  return Math.round(s * 255)
}

function signPow(value, exp) {
  return Math.sign(value) * Math.pow(Math.abs(value), exp)
}

function decodeDC(value) {
  return [
    sRGBtoLinear((value >> 16) & 255),
    sRGBtoLinear((value >> 8) & 255),
    sRGBtoLinear(value & 255),
  ]
}

function decodeAC(value, maximumValue) {
  const quantR = Math.floor(value / (19 * 19))
  const quantG = Math.floor(value / 19) % 19
  const quantB = value % 19
  return [
    signPow((quantR - 9) / 9, 2) * maximumValue,
    signPow((quantG - 9) / 9, 2) * maximumValue,
    signPow((quantB - 9) / 9, 2) * maximumValue,
  ]
}

// Returns { width, height, rgba: Uint8ClampedArray } or null if the
// hash is malformed.
export function decodeBlurhash(hash, width = 32, height = 32) {
  if (typeof hash !== 'string' || hash.length < 6) return null
  try {
    const sizeFlag = decode83(hash[0])
    const numY = Math.floor(sizeFlag / 9) + 1
    const numX = (sizeFlag % 9) + 1
    if (hash.length < 4 + numX * numY * 2 - 4) return null

    const quantizedMax = decode83(hash[1])
    const maximumValue = (quantizedMax + 1) / 166

    const colors = []
    for (let i = 0; i < numX * numY; i++) {
      const encoded = i === 0
        ? decode83(hash.substring(2, 6))
        : decode83(hash.substring(4 + i * 2, 6 + i * 2))
      colors.push(i === 0 ? decodeDC(encoded) : decodeAC(encoded, maximumValue))
    }

    const rgba = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0
        let g = 0
        let b = 0
        for (let j = 0; j < numY; j++) {
          for (let i = 0; i < numX; i++) {
            const basis = Math.cos((Math.PI * x * i) / width) * Math.cos((Math.PI * y * j) / height)
            const color = colors[j * numX + i]
            r += color[0] * basis
            g += color[1] * basis
            b += color[2] * basis
          }
        }
        const idx = 4 * (y * width + x)
        rgba[idx] = linearTosRGB(r)
        rgba[idx + 1] = linearTosRGB(g)
        rgba[idx + 2] = linearTosRGB(b)
        rgba[idx + 3] = 255
      }
    }
    return { width, height, rgba }
  } catch {
    return null
  }
}
