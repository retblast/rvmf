// On-device post translation, run entirely in the browser via Transformers.js +
// ONNX Runtime. Two selectable providers:
//
//   - "nllb-wasm" (default): Xenova/nllb-200-distilled-600M on the CPU (WASM).
//     fp32 weights (see the provider config: the quantized files are broken by
//     an onnxruntime-web optimizer regression), so a few GB, but garbage-free
//     and numerically safe on integrated GPUs/CPUs — the recommended path.
//   - "gemma-webgpu": onnx-community/translategemma-text-4b-it-ONNX on WebGPU.
//     Higher quality but ~3 GB and GPU-dependent; its fp16 WebGPU path is
//     prone to a known ONNX Runtime overflow that yields "<unusedN>" garbage,
//     so output is guarded and this is opt-in only.
//
// Nothing is imported or downloaded unless the user actually translates, and
// post text never leaves the device.
//
// Privacy + licensing note: both models are *faithful translation* models.
// They render the author's words rather than generating new content, and
// stay within their respective terms of use (TranslateGemma: Gemma license;
// NLLB: CC-BY-NC-4.0). Neither has a refusal/alignment layer, so edgy-but-legal
// text is translated as-is; generating harmful content is outside their purpose
// and terms and is not supported here.

import { resolveLanguageCode } from './languages.js'

const PROVIDERS = {
  'nllb-wasm': {
    label: 'CPU (NLLB)',
    task: 'translation',
    modelId: 'Xenova/nllb-200-distilled-600M',
    device: 'wasm',
    // Full-precision weights, on purpose: the repo's quantized "merged"
    // int4/int8 files hit a known onnxruntime-web graph-optimizer regression
    // (TransposeDQWeightsForMatMulNBits) that aborts session creation with
    // "Missing required scale: ...weight_merged_0_scale" (see transformers.js
    // #1635). fp32 avoids that quantized file, and ORT/wasm can't run fp16 so
    // fp32 is the correct CPU build. Belt-and-suspenders: drop the ORT graph
    // optimizer to 'basic' so the buggy QDQ fusion pass can't run at all,
    // regardless of which weights file is selected.
    dtype: 'fp32',
    session_options: { graphOptimizationLevel: 'basic' },
    requiresWebGPU: false,
  },
  'gemma-webgpu': {
    label: 'GPU (TranslateGemma)',
    task: 'text-generation',
    modelId: 'onnx-community/translategemma-text-4b-it-ONNX',
    device: 'webgpu',
    dtype: 'q4f16',
    requiresWebGPU: true,
  },
}

export const PROVIDER_IDS = Object.keys(PROVIDERS)
export const DEFAULT_PROVIDER = 'nllb-wasm'

// Cap inference so a slow/stalled GPU can't spin forever on "Translating…".
// Overridable in tests.
export const INFERENCE_TIMEOUT_MS = 120_000
export let inferenceTimeoutMs = INFERENCE_TIMEOUT_MS
export function setInferenceTimeoutMs(ms) { inferenceTimeoutMs = ms }

// One shared pipeline per provider — creating a second instance would re-download
// weights. Concurrent translate() calls for a provider await the same load.
const pipelinePromises = {}

// Transformers.js calls the progress_callback many times; keep the callback
// that should receive normalized progress here so a cached pipeline still
// reports to the *current* caller (the per-create closure would otherwise
// leak the first caller's callback forever).
let activeOnProgress = null

function exposeProgress(overall, file, ready) {
  activeOnProgress?.({ overall, file, ready })
}

function getPipeline(provider, onProgress) {
  activeOnProgress = onProgress
  if (!pipelinePromises[provider]) {
    pipelinePromises[provider] = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers')
      env.allowLocalModels = false
      const cfg = PROVIDERS[provider]
      let overall = null
      let file = null
      let ready = false
      let hasAggregate = false
      const options = {
        device: cfg.device,
        progress_callback: (e) => {
          if (e.status === 'progress_total') {
            hasAggregate = true
            overall = typeof e.progress === 'number'
              ? e.progress
              : (e.total ? Math.min(100, (e.loaded / e.total) * 100) : null)
          } else if (e.status === 'progress') {
            file = e.file
            if (!hasAggregate && e.total) {
              overall = Math.min(100, (e.loaded / e.total) * 100)
            }
          } else if (e.status === 'ready') {
            ready = true
            overall = 100
          } else {
            return
          }
          exposeProgress(overall, file, ready)
        },
      }
      if (cfg.dtype) options.dtype = cfg.dtype
      if (cfg.session_options) options.session_options = cfg.session_options
      return pipeline(cfg.task, cfg.modelId, options)
    })()
  }
  return pipelinePromises[provider]
}

// Reset a provider's cached pipeline (used by tests, and after a fatal load
// error so a follow-up attempt can retry). With no argument, resets all.
export function resetTranslator(provider) {
  if (provider && provider in pipelinePromises) {
    delete pipelinePromises[provider]
  } else if (!provider) {
    for (const key of Object.keys(pipelinePromises)) delete pipelinePromises[key]
  }
}

// A result dominated by "<unusedN>" placeholder tokens is the signature of the
// known ONNX Runtime WebGPU fp16 overflow (see microsoft/onnxruntime#26732),
// not a real translation — surface it as an error rather than showing garbage.
function isGarbage(untranslated, translated) {
  if (!translated) return true
  if (translated.length === 1) return false // single char passthrough
  const placeholderMatches = translated.match(/<unused\d+>/g) || []
  const placeholderChars = placeholderMatches.join('').length
  const ratio = placeholderChars / translated.length
  return ratio > 0.4
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error('Translation timed out — the model is still running or stalled.')),
        ms,
      )
    }),
  ])
}

/**
 * Translate `text` from `source` to `target` (both raw BCP-47/ISO tags or
 * canonical ids) using the given provider (default: the CPU NLLB model).
 * Resolves to the translated string.
 *
 * `onProgress`, if given, receives `{ overall, file, ready }` while the model
 * loads. Throws if the provider/model isn't available, the download fails,
 * inference times out, the output is garbled, or either language isn't
 * supported.
 */
export async function translateText(text, source, target, onProgress, provider = DEFAULT_PROVIDER) {
  const cfg = PROVIDERS[provider]
  if (!cfg) throw new Error(`Unknown translation provider: ${provider}`)

  const sourceCode = resolveLanguageCode(source, provider)
  const targetCode = resolveLanguageCode(target, provider)
  if (!sourceCode) throw new Error(`Unsupported source language: ${source}`)
  if (!targetCode) throw new Error(`Unsupported target language: ${target}`)

  // The 4B Gemma model only runs at a usable speed through the GPU. Turning on
  // a clear gate here is more honest than silently falling back to the CPU.
  if (cfg.requiresWebGPU && typeof navigator !== 'undefined' && !navigator.gpu) {
    throw new Error(
      'The GPU model needs a WebGPU-capable browser (Chrome/Edge, or Firefox with webgpu enabled).'
    )
  }

  const gen = await getPipeline(provider, onProgress)
  let output
  if (provider === 'nllb-wasm') {
    output = await withTimeout(
      gen(text, { src_lang: sourceCode, tgt_lang: targetCode, max_new_tokens: 384 }),
      inferenceTimeoutMs,
    )
  } else {
    // TranslateGemma chat template.
    output = await withTimeout(
      gen(
        [{
          role: 'user',
          content: [{
            type: 'text',
            source_lang_code: sourceCode,
            target_lang_code: targetCode,
            text,
          }],
        }],
        { max_new_tokens: 384 },
      ),
      inferenceTimeoutMs,
    )
  }

  const translated = provider === 'nllb-wasm'
    ? output?.[0]?.translation_text
    : output?.[0]?.generated_text?.at?.(-1)?.content

  if (typeof translated !== 'string' || isGarbage(text, translated)) {
    throw new Error(
      provider === 'gemma-webgpu'
        ? 'The GPU model produced garbled output (a known WebGPU fp16 issue). Try the CPU model instead.'
        : 'The translation model returned an empty or unusable result.'
    )
  }
  return translated
}
