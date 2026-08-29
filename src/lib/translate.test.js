import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  translateText,
  resetTranslator,
  setInferenceTimeoutMs,
  setUnloadTimeoutMs,
  UNLOAD_TIMEOUT_MS,
  unloadProvider,
  PROVIDER_IDS,
  DEFAULT_PROVIDER,
} from './translate.js'

// Mock the heavy Transformers.js module so these tests exercise our
// orchestration (provider selection, language resolution, singleton, output
// parsing, garbage guard, timeout) without downloading a model or needing a GPU.
const pipeline = vi.fn()
const env = { allowLocalModels: true }
vi.mock('@huggingface/transformers', () => ({
  pipeline: (...args) => pipeline(...args),
  env,
}))

const NLLB_OUT = (text) => [{ translation_text: text }]
const GEMMA_OUT = (content) => [{ generated_text: [{ content }] }]

function captureGen(returnValueFactory) {
  let genArgs
  const gen = async (...args) => {
    genArgs = args
    return returnValueFactory()
  }
  return { gen, getArgs: () => genArgs }
}

beforeEach(() => {
  pipeline.mockReset()
  resetTranslator()
  setInferenceTimeoutMs(120_000)
  setUnloadTimeoutMs(UNLOAD_TIMEOUT_MS)
  // The gemma provider gates on WebGPU; satisfy it in jsdom so those tests can run.
  Object.defineProperty(navigator, 'gpu', { configurable: true, value: {} })
})

afterEach(() => {
  vi.restoreAllMocks()
  // Cancel any pending idle-release timers so they can't leak into other tests,
  // and drop cached pipelines so a scheduled dispose can't touch a later mock.
  for (const id of PROVIDER_IDS) unloadProvider(id)
})

describe('provider selection', () => {
  it('defaults to the CPU NLLB provider', () => {
    expect(DEFAULT_PROVIDER).toBe('nllb-wasm')
  })

  it('rejects an unknown provider', async () => {
    await expect(translateText('hi', 'en', 'ja', undefined, 'nope'))
      .rejects.toThrow(/Unknown translation provider/)
  })

  it('rejects unsupported source or target languages without loading a model', async () => {
    await expect(translateText('hi', 'xx', 'en')).rejects.toThrow(/source language/)
    await expect(translateText('hi', 'en', 'xx')).rejects.toThrow(/target language/)
    expect(pipeline).not.toHaveBeenCalled()
  })
})

describe('NLLB (default)', () => {
  it('builds the translation pipeline and parses translation_text', async () => {
    const { gen, getArgs } = captureGen(() => NLLB_OUT('こんにちは'))
    pipeline.mockResolvedValue(gen)

    const out = await translateText('hello', 'en', 'ja')
    expect(out).toBe('こんにちは')

    expect(pipeline).toHaveBeenCalledTimes(1)
    const [task, modelId, options] = pipeline.mock.calls[0]
    expect(task).toBe('translation')
    expect(modelId).toBe('Xenova/nllb-200-distilled-600M')
    expect(options.device).toBe('wasm')
    // Quantized int8 weights that fit the WASM heap (fp32 bad_allocs), with
    // the ORT graph optimizer dropped to 'basic' so the buggy
    // MatMulNBits/DequantizeLinear "Missing required scale" fusion is skipped.
    expect(options.dtype).toBe('q8')
    expect(options.session_options.graphOptimizationLevel).toBe('basic')

    const [text, opts] = getArgs()
    expect(text).toBe('hello')
    expect(opts.src_lang).toBe('eng_Latn')
    expect(opts.tgt_lang).toBe('jpn_Jpan')
    expect(opts.max_new_tokens).toBe(384)
  })

  it('throws when the model returns no translation', async () => {
    pipeline.mockImplementation(async () => captureGen(() => []).gen)
    await expect(translateText('a', 'en', 'ja')).rejects.toThrow(/empty or unusable/)
  })

  it('shares a single pipeline instance across calls', async () => {
    pipeline.mockImplementation(async () => captureGen(() => NLLB_OUT('x')).gen)
    await translateText('a', 'en', 'ja')
    await translateText('b', 'en', 'ja')
    expect(pipeline).toHaveBeenCalledTimes(1) // cached, not reloaded
  })
})

describe('TranslateGemma (optional GPU provider)', () => {
  it('uses the chat template and parses generated_text content', async () => {
    const { gen, getArgs } = captureGen(() => GEMMA_OUT('こんにちは'))
    pipeline.mockResolvedValue(gen)

    const out = await translateText('hello', 'en', 'ja', undefined, 'gemma-webgpu')
    expect(out).toBe('こんにちは')

    const [task, modelId, options] = pipeline.mock.calls[0]
    expect(task).toBe('text-generation')
    expect(modelId).toBe('onnx-community/translategemma-text-4b-it-ONNX')
    expect(options.device).toBe('webgpu')

    const [messages, opts] = getArgs()
    const content = messages[0].content[0]
    expect(content.source_lang_code).toBe('en')
    expect(content.target_lang_code).toBe('ja_JP')
    expect(content.text).toBe('hello')
    expect(opts.max_new_tokens).toBe(384)
  })

  it('rejects when the GPU produces <unusedN> garbage (known WebGPU fp16 issue)', async () => {
    const garbage = '<unused57>'.repeat(100)
    pipeline.mockImplementation(async () => captureGen(() => GEMMA_OUT(garbage)).gen)
    await expect(translateText('a', 'en', 'ja', undefined, 'gemma-webgpu'))
      .rejects.toThrow(/garbled/)
  })
})

describe('progress relay', () => {
  it('relays aggregate progress and readiness as { overall, file, ready }', async () => {
    let progressCb
    const { gen } = captureGen(() => NLLB_OUT('x'))
    pipeline.mockImplementation(async (_t, _m, opts) => {
      progressCb = opts.progress_callback
      return gen
    })
    const onProgress = vi.fn()
    await translateText('a', 'en', 'ja', onProgress)

    progressCb({ status: 'progress_total', name: 'm', progress: 42, loaded: 420, total: 1000 })
    expect(onProgress).toHaveBeenLastCalledWith({ overall: 42, file: null, ready: false })

    progressCb({ status: 'ready', task: 'translation', model: 'm' })
    expect(onProgress).toHaveBeenLastCalledWith({ overall: 100, file: null, ready: true })
  })

  it('falls back to per-file progress when no aggregate event fires', async () => {
    let progressCb
    const { gen } = captureGen(() => NLLB_OUT('x'))
    pipeline.mockImplementation(async (_t, _m, opts) => {
      progressCb = opts.progress_callback
      return gen
    })
    const onProgress = vi.fn()
    await translateText('a', 'en', 'ja', onProgress)

    progressCb({ status: 'progress', name: 'm', file: 'model.onnx', loaded: 250, total: 1000 })
    expect(onProgress).toHaveBeenLastCalledWith({ overall: 25, file: 'model.onnx', ready: false })
    progressCb({ status: 'progress', name: 'm', file: 'model.onnx', loaded: 500, total: 1000 })
    expect(onProgress).toHaveBeenLastCalledWith({ overall: 50, file: 'model.onnx', ready: false })
  })
})

describe('watchdog timeout', () => {
  it('rejects when inference never settles instead of hanging forever', async () => {
    const run = vi.fn(() => new Promise(() => {})) // never resolves
    pipeline.mockImplementation(async () => run)
    setInferenceTimeoutMs(20)

    await expect(translateText('a', 'en', 'ja')).rejects.toThrow(/timed out/)
  })
})

describe('cached pipelines are independent per provider', () => {
  it('loads each provider once and reuses it', async () => {
    // Return an output that both providers can parse into a valid string.
    const both = () => [{ translation_text: 'x', generated_text: [{ content: 'x' }] }]
    pipeline.mockImplementation(async () => captureGen(both).gen)
    await translateText('a', 'en', 'ja')
    await translateText('b', 'en', 'ja', undefined, 'gemma-webgpu')
    await translateText('c', 'en', 'ja')
    await translateText('d', 'en', 'ja', undefined, 'gemma-webgpu')
    // Two distinct providers -> two loads, both cached after the first.
    expect(pipeline).toHaveBeenCalledTimes(2)
  })
})

describe('idle model release (unload)', () => {
  // Build a pipeline whose callable also carries a `dispose` spy, so we can
  // assert Transformers.js's dispose hook is invoked on release.
  const disposably = () => {
    const dispose = vi.fn()
    const gen = async () => NLLB_OUT('x')
    gen.dispose = dispose
    return { gen, dispose }
  }

  it('unloadProvider disposes the model and lets the next call reload it', async () => {
    pipeline.mockImplementation(async () => disposably().gen)
    await translateText('a', 'en', 'ja')
    expect(pipeline).toHaveBeenCalledTimes(1)

    unloadProvider('nllb-wasm')

    // Cached pipeline was dropped, so the next translation re-creates it.
    await translateText('b', 'en', 'ja')
    expect(pipeline).toHaveBeenCalledTimes(2)
  })

  it('releases the model after the idle timeout once no further translation happens', async () => {
    const { gen, dispose } = disposably()
    pipeline.mockImplementation(async () => gen)
    setUnloadTimeoutMs(30)
    await translateText('a', 'en', 'ja')
    expect(dispose).not.toHaveBeenCalled()

    await new Promise((r) => setTimeout(r, 120)) // well past 30 ms with no activity
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('a fresh translation before the timeout resets the countdown', async () => {
    const { gen, dispose } = disposably()
    pipeline.mockImplementation(async () => gen)
    setUnloadTimeoutMs(80)
    await translateText('a', 'en', 'ja') // release scheduled ~t=80

    await new Promise((r) => setTimeout(r, 30))
    await translateText('b', 'en', 'ja') // reschedules release ~t=30+80=110

    // Still within the rescheduled window -> not released yet.
    await new Promise((r) => setTimeout(r, 60)) // ~t=90 (90 < 110)
    expect(dispose).not.toHaveBeenCalled()

    await new Promise((r) => setTimeout(r, 60)) // ~t=150 (150 > 110) -> released
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})
