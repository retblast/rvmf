// On-device post translation backed by Google's TranslateGemma model, run
// entirely in the browser via Transformers.js + ONNX Runtime Web (WebGPU).
//
// The model is large (~3 GB quantized) and is downloaded from the Hugging
// Face Hub on first use, so everything here is lazy: nothing is imported or
// downloaded unless the user actually asks for a translation. There is no
// server round-trip — post text never leaves the device.
//
// Privacy + licensing note: the model (`onnx-community/translategemma-...`)
// is a faithful translation model. It renders the author's words rather than
// generating new content, and stays within the Gemma Terms of Use. Unlike a
// chat assistant it has no refusal/alignment layer, so there is nothing to
// "jailbreak" for legitimate fidelity — profanity and edgy-but-legal text are
// translated as-is. Generating harmful content is outside both the model's
// purpose and the terms under which it's used, and is not supported here.

import { resolveModelCode } from './languages.js'

const MODEL_ID = 'onnx-community/translategemma-text-4b-it-ONNX'
// Quantized dtype keeps the download at ~3 GB and makes WebGPU inference
// tractable on consumer hardware. fp16/fp32 would be higher quality but
// far heavier and slower in the browser.
const DTYPE = 'q4f16'

// A single shared translator instance — creating a second pipeline would
// re-download the weights. The module-level promise means concurrent
// translate() calls all await the same load.
let pipelinePromise = null

// Returns the live pipeline singleton, initializing on first use. `onProgress`
// (if given) is fed a normalized `{ overall, file, ready }` object:
//   - `overall` (number 0–100 | null): the download percentage. Prefers the
//     *aggregate* `progress_total` event (which fills smoothly 0→100 across
//     all files); if that event is missing (older/other Transformers.js
//     builds), it falls back to the current file's own percentage so the bar
//     still advances during the download instead of hanging on an empty
//     indeterminate state.
//   - `file` (string | null): the file currently being downloaded.
//   - `ready` (boolean): true once the pipeline is loaded, i.e. the download
//     is finished and inference is running.
async function getPipeline(onProgress) {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      // The heavy ONNX runtime + model loader is imported on demand so the
      // main bundle stays small; users who never translate never ship it.
      const { pipeline, env } = await import('@huggingface/transformers')
      // Only ever fetch from the Hub — never probe local/relative model
      // paths the way the library can in some setups.
      env.allowLocalModels = false
      let overall = null
      let file = null
      let ready = false
      let hasAggregate = false
      return pipeline('text-generation', MODEL_ID, {
        device: 'webgpu',
        dtype: DTYPE,
        progress_callback: (e) => {
          if (e.status === 'progress_total') {
            hasAggregate = true
            overall = typeof e.progress === 'number'
              ? e.progress
              : (e.total ? Math.min(100, (e.loaded / e.total) * 100) : null)
          } else if (e.status === 'progress') {
            file = e.file
            // No aggregate event available: fall back to this file's own
            // progress so the bar still moves. (The bar resets per file, but
            // the weights file dominates the download, so it reads well.)
            if (!hasAggregate && e.total) {
              overall = Math.min(100, (e.loaded / e.total) * 100)
            }
          } else if (e.status === 'ready') {
            ready = true
            overall = 100
          } else {
            return
          }
          onProgress?.({ overall, file, ready })
        },
      })
    })()
  }
  return pipelinePromise
}

// Reset the cached pipeline (used by tests, and after a fatal load error so
// a follow-up attempt can retry).
export function resetTranslator() {
  pipelinePromise = null
}

/**
 * Translate `text` from `sourceLang` to `targetLang` (both raw BCP-47/ISO
 * tags, resolved internally to model codes). Resolves to the translated
 * string.
 *
 * `onProgress`, if given, receives `{ overall, file, ready }` while the model
 * loads: `overall` is the aggregate 0–100 download percentage, `file` the
 * file currently downloading, and `ready` true once the model is loaded and
 * inference is running.
 *
 * Throws if the model is unsupported on the device, the download fails, or
 * either language isn't in the model's vocabulary.
 */
export async function translateText(text, sourceLang, targetLang, onProgress) {
  const sourceCode = resolveModelCode(sourceLang)
  const targetCode = resolveModelCode(targetLang)
  if (!sourceCode) throw new Error(`Unsupported source language: ${sourceLang}`)
  if (!targetCode) throw new Error(`Unsupported target language: ${targetLang}`)

  const gen = await getPipeline(onProgress)
  const output = await gen(
    [{
      role: 'user',
      content: [{
        type: 'text',
        source_lang_code: sourceCode,
        target_lang_code: targetCode,
        text,
      }],
    }],
    { max_new_tokens: 1024 },
  )
  const last = output[0]?.generated_text?.at?.(-1)
  const translated = last?.content
  if (typeof translated !== 'string') {
    throw new Error('TranslateGemma returned an empty result')
  }
  return translated
}
