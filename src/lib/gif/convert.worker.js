// Web Worker that runs the GIF decode/compose/encode pipeline off the
// main thread. Message protocol (see lib/gif/convert.js):
//   in:  { id, arrayBuffer }
//   out: { id, ok: true, result }  |  { id, ok: false, error }
// The result carries a Blob (structured-cloneable) plus metadata.
import { gifBytesToWebm } from './core.js'

self.onmessage = async (e) => {
  const { id, arrayBuffer } = e.data || {}
  try {
    const result = await gifBytesToWebm(arrayBuffer)
    self.postMessage({ id, ok: true, result })
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.code || err?.message || 'conversion failed' })
  }
}