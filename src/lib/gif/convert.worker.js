// Web Worker that runs the GIF decode/compose/encode pipeline off the
// main thread. Message protocol (see lib/gif/convert.js):
//   in:  { id, arrayBuffer, cacheKey? }
//   out: { id, ok: true, result }  |  { id, ok: false, error }
// The result reports where the WebM landed:
//   storedIn: 'opfs' -> { codec, width, height, frameCount, durationMs,
//                          storedIn, blobBytes } (file already on disk)
//   storedIn: 'idb'  -> same + a Blob (the in-memory fallback path)
import { gifBytesToWebm, gifBytesToWebmFile, GifConversionError } from './core.js'

// OPFS gif cache directory name — keep in sync with cache.js.
const GIF_STORE_DIR = 'rvmf-gifs'

function opfsWriterAvailable() {
  return typeof navigator !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function' &&
    typeof FileSystemWritableFileStream !== 'undefined'
}

// Stream the conversion straight into an OPFS file. The muxer writes as
// it encodes, so no output buffer ever exists; the file only becomes
// visible (atomically, last-closer-wins across tabs) once the writable
// is closed. The final size is read back from the handle — metadata
// without loading the bytes.
async function convertToOpfs(arrayBuffer, cacheKey) {
  const root = await navigator.storage.getDirectory()
  const dir = await root.getDirectoryHandle(GIF_STORE_DIR, { create: true })
  const handle = await dir.getFileHandle(cacheKey, { create: true })
  const writable = await handle.createWritable()
  try {
    const result = await gifBytesToWebmFile(arrayBuffer, writable)
    await writable.close()
    const file = await handle.getFile()
    return { ...result, storedIn: 'opfs', blobBytes: file.size }
  } catch (err) {
    try { await writable.abort() } catch { /* already closed */ }
    throw err
  }
}

async function convertWithCache(arrayBuffer, cacheKey) {
  if (cacheKey && opfsWriterAvailable()) {
    try {
      return await convertToOpfs(arrayBuffer, cacheKey)
    } catch (err) {
      // Only environmental OPFS failures fall back to the in-memory path;
      // real conversion errors (too-large etc.) must propagate — the
      // in-memory path would fail identically.
      if (err instanceof GifConversionError) throw err
      console.debug('[gif] opfs write failed, falling back to in-memory', err)
    }
  }
  const result = await gifBytesToWebm(arrayBuffer)
  return { ...result, storedIn: 'idb', blobBytes: result.blob.size }
}

self.onmessage = async (e) => {
  const { id, arrayBuffer, cacheKey } = e.data || {}
  try {
    const result = await convertWithCache(arrayBuffer, cacheKey || null)
    self.postMessage({ id, ok: true, result })
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.code || err?.message || 'conversion failed' })
  }
}