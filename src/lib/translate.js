// On-device post translation, run entirely in the browser via Transformers.js +
// ONNX Runtime. Two selectable providers, both *instruction* models that
// translate "into {target}" without needing the source language:
//
//   - "qwen-cpu" (default): onnx-community/Qwen3-0.6B-ONNX on the CPU (WASM).
//     ~600 MB int8 weights — small enough for the ~2 GB WASM heap, no special
//     browser APIs needed. Slower than NLLB was, but the model reads the source
//     from the text, so wrong/missing language tags can no longer corrupt output.
//   - "gemma4-webgpu": onnx-community/gemma-4-E2B-it-ONNX on WebGPU. Best
//     quality (Gemma 4 E2B, 140+ languages) but ~3.4 GB and GPU-dependent.
//     Loaded class-level (AutoProcessor + Gemma4ForConditionalGeneration)
//     because the export is multimodal and transformers.js's 'any-to-any'
//     pipeline expects image/audio inputs.
//
// Because neither model is a controlled-source translator, there is no source
// language detection, no source picker, and no per-provider language codes —
// a post's language tag is only ever used as a cosmetic "Translated from …"
// label. Nothing is imported or downloaded unless the user actually translates,
// and post text never leaves the device.
//
// Privacy + licensing note: both models are instruction-tuned LLMs used here
// as *faithful translation* engines. They render the author's words rather
// than generating new content, and both are under permissive terms (Gemma 4:
// Apache-2.0; Qwen3: Apache-2.0).

import { canonicalizeLanguage, canonicalLangName } from './languages.js'

export const PROVIDERS = {
  'qwen-cpu': {
    label: 'CPU (Qwen)',
    uiLabel: 'CPU (Qwen) — no source language needed',
    task: 'text-generation',
    modelId: 'onnx-community/Qwen3-0.6B-ONNX',
    device: 'wasm',
    // int8 weights (~600 MB): quantized fp32 doesn't fit the WASM heap and
    // aborts session creation with std::bad_alloc (ERROR_CODE 6). Small +
    // reliable on the CPU, which is the point of this provider.
    dtype: 'q8',
    requiresWebGPU: false,
  },
  'gemma4-webgpu': {
    label: 'GPU (Gemma 4)',
    uiLabel: 'GPU (Gemma 4) — best quality, needs WebGPU',
    modelId: 'onnx-community/gemma-4-E2B-it-ONNX',
    device: 'webgpu',
    dtype: 'q4f16',
    requiresWebGPU: true,
  },
}

export const PROVIDER_IDS = Object.keys(PROVIDERS)
export const DEFAULT_PROVIDER = 'qwen-cpu'

// Cap inference so a slow/stalled GPU can't spin forever on "Translating…".
// Overridable in tests.
export const INFERENCE_TIMEOUT_MS = 120_000
export let inferenceTimeoutMs = INFERENCE_TIMEOUT_MS
export function setInferenceTimeoutMs(ms) { inferenceTimeoutMs = ms }

// ---- Heap-pressure notice -------------------------------------------------
// The model pipelines pin hundreds of MB to GBs of WASM/GPU heap for the
// whole time the page is open. After a successful translation we check what
// Chromium's memory API reports and, when the page is genuinely heavy, tell
// the user that only a reload returns that memory. Best-effort: every
// failure mode degrades to a quieter one-time hint, never an error.

export const TRANSLATION_HEAP_HINT_KEY = 'rvmf-translation-heap-hint'
// measureUserAgentSpecificMemory() lives behind a permission gesture or
// cross-origin isolation; anything over ~600 MB of page footprint is the
// model doing the heavy lifting, not the app.
export const TRANSLATION_HEAP_WARN_MB = 600

export function canMeasurePageMemory() {
  return typeof performance !== 'undefined' &&
    typeof performance.measureUserAgentSpecificMemory === 'function'
}

// Returns a user-facing message, or null when there's nothing worth saying.
// Chromium: report the measured footprint when it clears the warning bar.
// Anywhere else (or when measurement is denied): show the stated estimate
// exactly once per browser, guarded by localStorage, so a user who can't
// measure isn't nagged on every translation.
export async function translationPressureNotice() {
  if (canMeasurePageMemory()) {
    try {
      const entry = await performance.measureUserAgentSpecificMemory()
      const mb = Math.round(entry.bytes / (1024 * 1024))
      if (mb > TRANSLATION_HEAP_WARN_MB) {
        return `Translation is using ~${mb.toLocaleString()} MB of this page's memory — normal for the on-device model, but only a reload returns it fully.`
      }
      // Measured and fine: say nothing (and don't fall through to the
      // one-time hint — this browser can measure, so it doesn't need it).
      return null
    } catch {
      // Measurement denied: fall through to the one-time hint.
    }
  }
  if (typeof localStorage === 'undefined') return null
  if (localStorage.getItem(TRANSLATION_HEAP_HINT_KEY)) return null
  localStorage.setItem(TRANSLATION_HEAP_HINT_KEY, '1')
  return "On-device translation keeps the model's memory (~1.3 GB) busy while this page is open — reloading returns it fully. (One-time note.)"
}

// Release the model after this long without a translation, so its (large)
// memory — Qwen q8 ~1.3 GB+ in the WASM heap, or Gemma 4 ~3.4 GB of VRAM —
// isn't pinned for the whole page session. Overridable in tests.
export const UNLOAD_TIMEOUT_MS = 10_000
export let unloadTimeoutMs = UNLOAD_TIMEOUT_MS
export function setUnloadTimeoutMs(ms) { unloadTimeoutMs = ms }

// One shared generator per provider — creating a second instance would
// re-download weights. Concurrent translate() calls await the same load.
const pipelinePromises = {}

// Idle-unload bookkeeping.
let unloadTimer = null

function cancelUnload() {
  if (unloadTimer) {
    clearTimeout(unloadTimer)
    unloadTimer = null
  }
}

function scheduleUnload(provider) {
  cancelUnload()
  unloadTimer = setTimeout(() => {
    unloadTimer = null
    unloadProvider(provider)
  }, unloadTimeoutMs)
}

/**
 * Release a provider's loaded model: dispose its ONNX session(s) and forget
 * the cached generator so the memory is reclaimed and the next translation
 * reloads it. Best-effort and re-entrant (safe to call repeatedly / while
 * loading).
 */
export function unloadProvider(provider) {
  cancelUnload()
  const pending = pipelinePromises[provider]
  if (pending !== undefined) {
    pending
      .then((gen) => {
        if (gen?.dispose) {
          try { gen.dispose() } catch { /* already freed */ }
        }
      })
      .catch(() => { /* load failed; nothing to dispose */ })
  }
  resetTranslator(provider)
}

// Transformers.js calls the progress_callback many times; keep the callback
// that should receive normalized progress here so a cached generator still
// reports to the *current* caller (a closure would otherwise leak the first
// caller's callback forever).
let activeOnProgress = null

function exposeProgress(overall, file, ready) {
  activeOnProgress?.({ overall, file, ready })
}

function makeProgressHandler() {
  let overall = null
  let file = null
  let ready = false
  let hasAggregate = false
  return (e) => {
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
  }
}

/**
 * Load (and cache) the generator for a provider:
 *
 *   - Qwen: a standard transformers.js pipeline whose call takes chat
 *     messages and resolves to `[{ generated_text: [{ content }] }]`.
 *   - Gemma 4: a runner wrapping the class-level API (there's no usable
 *     pipeline for this multimodal export) that applies the chat template,
 *     generates text-only, decodes, and resolves to the translated string.
 *
 * Both are callable as `gen(messages, options)` and both carry a `dispose`
 * so idle release can reclaim their memory.
 */
function getGenerator(provider, onProgress) {
  activeOnProgress = onProgress
  if (!pipelinePromises[provider]) {
    pipelinePromises[provider] = (async () => {
      const { env, pipeline, AutoProcessor, Gemma4ForConditionalGeneration } =
        await import('@huggingface/transformers')
      env.allowLocalModels = false
      const cfg = PROVIDERS[provider]
      const progress_callback = makeProgressHandler()

      if (provider === 'gemma4-webgpu') {
        const processor = await AutoProcessor.from_pretrained(cfg.modelId, { progress_callback })
        const model = await Gemma4ForConditionalGeneration.from_pretrained(cfg.modelId, {
          dtype: cfg.dtype,
          device: cfg.device,
          progress_callback,
        })
        const runner = async (messages, opts) => {
          const prompt = processor.apply_chat_template(messages, {
            enable_thinking: false, // no reasoning preamble in translations
            add_generation_prompt: true,
          })
          // Text-only inputs; the vision/audio encoders download but stay idle
          // (~270 MB of the ~3.4 GB — unavoidable in the ONNX export).
          const inputs = await processor(prompt, null, null, { add_special_tokens: false })
          const outputs = await model.generate({ ...inputs, ...opts })
          const decoded = processor.batch_decode(
            outputs.slice(null, [inputs.input_ids.dims.at(-1), null]),
            { skip_special_tokens: true },
          )
          return decoded[0] ?? ''
        }
        runner.dispose = () => {
          try { model.dispose() } catch { /* already freed */ }
          try { processor.dispose?.() } catch { /* already freed */ }
        }
        return runner
      }

      const options = { device: cfg.device, progress_callback }
      if (cfg.dtype) options.dtype = cfg.dtype
      if (cfg.session_options) options.session_options = cfg.session_options
      return pipeline(cfg.task, cfg.modelId, options)
    })()
  }
  return pipelinePromises[provider]
}

// Reset a provider's cached generator (used by tests, and after a fatal load
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

// The system prompt for both instruct translators: a strict, faithful-machine
// posture so the model never adds commentary, quotes, or extra scaffolding.
const TRANSLATE_SYSTEM_PROMPT =
  'You are a machine translation engine. Preserve the meaning, tone, and formatting ' +
  'of the source. Output ONLY the translation — no explanations, no quotes, no commentary.'

// Qwen3 can self-select a "reasoning" channel (training-default behavior).
// Best answer: disable it via the model's chat-template flag — the ONNX
// community template turns thinking off when `enable_thinking` is explicitly
// false — which the text-generation pipeline only forwards if it rides in
// `tokenizer_encode_kwargs` (any other option key is swallowed by
// `model.generate`). That template switch is a *prompt-level hint* rather than
// a hard gate, so this strip is the safety net for any reasoning text that
// still comes back: channel markers, the template's literal `thinking /
// response` hint echo, and response-channel wrappers.
function stripThinking(translated) {
  if (!translated) return translated
  let s = translated
  s = s.replace(/<\|\s*start_of_reasoning\s*\|>[\s\S]*?<\|\s*end_of_reasoning\s*\|>/g, '')
  s = s.replace(/^\s*thinking\s*\n+\s*response\s*\n+/i, '')
  s = s.replace(/<\|\s*start_of_response\s*\|>/g, '')
  s = s.replace(/<\|\s*end_of_response\s*\|>/g, '')
  return s.trim()
}

/**
 * Translate `text` into `target` (a raw BCP-47/ISO tag or canonical id) using
 * the given provider (default: the CPU Qwen model). `source` is accepted for
 * API continuity but never used — both providers are instruction models that
 * read the source language from the text itself, which is what makes a
 * missing or wrong status language tag harmless instead of corrupting output.
 * Resolves to the translated string.
 *
 * `onProgress`, if given, receives `{ overall, file, ready }` while the model
 * loads. Throws if the provider/model isn't available, the download fails,
 * inference times out, the output is garbled, or the target isn't supported.
 */
export async function translateText(text, source, target, onProgress, provider = DEFAULT_PROVIDER) {
  const cfg = PROVIDERS[provider]
  if (!cfg) throw new Error(`Unknown translation provider: ${provider}`)

  // The target must be one of the app's supported languages so the prompt is
  // deterministic (canonical id -> English name, e.g. "ja" -> "Japanese").
  const targetCode = canonicalizeLanguage(target)
  if (!targetCode) throw new Error(`Unsupported target language: ${target}`)

  // The Gemma 4 model only runs at a usable speed through the GPU. Turning on
  // a clear gate here is more honest than silently falling back to the CPU.
  if (cfg.requiresWebGPU && typeof navigator !== 'undefined' && !navigator.gpu) {
    throw new Error(
      'The GPU model needs a WebGPU-capable browser (Chrome/Edge, or Firefox with webgpu enabled).'
    )
  }

  const gen = await getGenerator(provider, onProgress)
  const messages = [
    { role: 'system', content: TRANSLATE_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Translate the following text into ${canonicalLangName(targetCode)}.\n\n${text}`,
    },
  ]
  const options = { max_new_tokens: 384, do_sample: false }

  let translated
  if (provider === 'gemma4-webgpu') {
    // The Gemma 4 runner decodes to a plain string itself.
    translated = await withTimeout(gen(messages, options), inferenceTimeoutMs)
  } else {
    // Qwen3 thinks by default; the chat-template off-switch only works if the
    // flag is forwarded through the pipeline's tokenizer kwargs (plain option
    // keys are silently routed to model.generate and ignored). The strip then
    // cleans any reasoning text the hint didn't prevent.
    const output = await withTimeout(
      gen(messages, { ...options, tokenizer_encode_kwargs: { enable_thinking: false } }),
      inferenceTimeoutMs
    )
    translated = stripThinking(output?.[0]?.generated_text?.at?.(-1)?.content)
  }

  try {
    if (typeof translated !== 'string' || isGarbage(text, translated)) {
      throw new Error(
        provider === 'gemma4-webgpu'
          ? 'The GPU model produced garbled output (a known WebGPU issue). Try the CPU model instead.'
          : 'The translation model returned an empty or unusable result.'
      )
    }
    return translated
  } finally {
    // Translation happened — restart the idle countdown. If nothing else
    // translates within unloadTimeoutMs, the model is disposed and released.
    scheduleUnload(provider)
  }
}
