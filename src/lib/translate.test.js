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
// orchestration (provider selection, prompt building, singleton, output
// parsing, garbage guard, timeout) without downloading a model or needing a GPU.
const pipeline = vi.fn()
const env = { allowLocalModels: true }
const AutoProcessor = { from_pretrained: vi.fn() }
const Gemma4ForConditionalGeneration = { from_pretrained: vi.fn() }
vi.mock('@huggingface/transformers', () => ({
  pipeline: (...args) => pipeline(...args),
  env,
  AutoProcessor,
  Gemma4ForConditionalGeneration,
}))

const QWEN_OUT = (content) => [{ generated_text: [{ content }] }]

function captureGen(returnValueFactory) {
  let genArgs
  const gen = async (...args) => {
    genArgs = args
    return returnValueFactory()
  }
  return { gen, getArgs: () => genArgs }
}

// Arrange the class-level Gemma 4 API (AutoProcessor + model) so the runner
// path can be exercised; returns the spied processor/model. The real
// Processor is a callable (it proxies to `_call`), so the mock is a vi.fn
// with the processor methods attached.
function gemma4Ready({ decoded = 'こんにちは' } = {}) {
  const processor = vi.fn(async () => ({ input_ids: { dims: [1, 8] } }))
  processor.apply_chat_template = vi.fn(() => 'templated-prompt')
  processor.batch_decode = vi.fn(() => [decoded])
  processor.dispose = vi.fn()
  const model = {
    // Mock tensor: the runner slices off the prompt prefix (returning itself)
    // and hands it to batch_decode.
    generate: vi.fn(async () => {
      const generated = { slice: vi.fn(() => generated) }
      return generated
    }),
    dispose: vi.fn(),
  }
  AutoProcessor.from_pretrained.mockResolvedValue(processor)
  Gemma4ForConditionalGeneration.from_pretrained.mockResolvedValue(model)
  return { processor, model }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  pipeline.mockReset()
  AutoProcessor.from_pretrained.mockReset()
  Gemma4ForConditionalGeneration.from_pretrained.mockReset()
  resetTranslator()
  setInferenceTimeoutMs(120_000)
  setUnloadTimeoutMs(UNLOAD_TIMEOUT_MS)
  // The gemma4 provider gates on WebGPU; satisfy it in jsdom so those tests can run.
  Object.defineProperty(navigator, 'gpu', { configurable: true, value: {} })
})

afterEach(() => {
  vi.restoreAllMocks()
  // Cancel any pending idle-release timers so they can't leak into other tests,
  // and drop cached generators so a scheduled dispose can't touch a later mock.
  for (const id of PROVIDER_IDS) unloadProvider(id)
})

describe('provider selection', () => {
  it('defaults to the CPU Qwen provider', () => {
    expect(DEFAULT_PROVIDER).toBe('qwen-cpu')
  })

  it('rejects an unknown provider', async () => {
    await expect(translateText('hi', 'ja', 'en', undefined, 'nope'))
      .rejects.toThrow(/Unknown translation provider/)
  })

  it('rejects an unsupported target language without loading a model', async () => {
    await expect(translateText('hi', 'ja', 'xx')).rejects.toThrow(/target language/)
    expect(pipeline).not.toHaveBeenCalled()
    expect(AutoProcessor.from_pretrained).not.toHaveBeenCalled()
  })
})

describe('Qwen (CPU default)', () => {
  it('builds the text-generation pipeline and parses the chat output', async () => {
    const { gen, getArgs } = captureGen(() => QWEN_OUT('こんにちは'))
    pipeline.mockResolvedValue(gen)

    const out = await translateText('hello', 'ja', 'en')
    expect(out).toBe('こんにちは')

    expect(pipeline).toHaveBeenCalledTimes(1)
    const [task, modelId, options] = pipeline.mock.calls[0]
    expect(task).toBe('text-generation')
    expect(modelId).toBe('onnx-community/Qwen3-0.6B-ONNX')
    expect(options.device).toBe('wasm')
    // int8 weights that fit the ~2 GB WASM heap.
    expect(options.dtype).toBe('q8')

    const [messages, opts] = getArgs()
    expect(messages[0].role).toBe('system')
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toContain('Translate the following text into English.')
    expect(messages[1].content).toContain('hello')
    // Deterministic, faithful-output generation.
    expect(opts.max_new_tokens).toBe(384)
    expect(opts.do_sample).toBe(false)
    // Qwen3 thinks by default; the off-switch must ride in the pipeline's
    // tokenizer kwargs (a plain top-level key is swallowed by model.generate).
    expect(opts.tokenizer_encode_kwargs).toEqual({ enable_thinking: false })
  })

  it('strips any reasoning channel that still comes back', async () => {
    const { gen } = captureGen(() =>
      QWEN_OUT('<|start_of_reasoning|>The user wants a greeting.\n<|end_of_reasoning|>こんにちは')
    )
    pipeline.mockResolvedValue(gen)

    await expect(translateText('hello', 'ja', 'en')).resolves.toBe('こんにちは')
  })

  it('strips response-channel wrappers and a template hint echo', async () => {
    const { gen } = captureGen(() =>
      QWEN_OUT('thinking\n\nresponse\n\n<|start_of_response|>こんにちは<|end_of_response|>')
    )
    pipeline.mockResolvedValue(gen)

    await expect(translateText('hello', 'ja', 'en')).resolves.toBe('こんにちは')
  })

  it('ignores the source language entirely (no model language codes in the prompt)', async () => {
    const { gen } = captureGen(() => QWEN_OUT('ok'))
    pipeline.mockResolvedValue(gen)

    // An unsupported source tag used to abort NLLB/TranslateGemma; an
    // instruction model reads the source from the text, so it must not matter.
    await expect(translateText('hi', 'xx', 'en')).resolves.toBe('ok')
  })

  it('works without WebGPU', async () => {
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined })
    pipeline.mockResolvedValue(captureGen(() => QWEN_OUT('x')).gen)

    await expect(translateText('a', 'ja', 'en')).resolves.toBe('x')
  })

  it('throws when the model returns no usable output', async () => {
    pipeline.mockImplementation(async () => captureGen(() => []).gen)
    await expect(translateText('a', 'ja', 'en')).rejects.toThrow(/empty or unusable/)
  })
})

describe('Gemma 4 (optional GPU provider)', () => {
  it('loads the class-level processor + model, applies the chat template, and decodes', async () => {
    const { processor, model } = gemma4Ready({ decoded: 'こんにちは' })

    const out = await translateText('hello', 'ja', 'en', undefined, 'gemma4-webgpu')
    expect(out).toBe('こんにちは')

    expect(AutoProcessor.from_pretrained).toHaveBeenCalledTimes(1)
    expect(AutoProcessor.from_pretrained).toHaveBeenCalledWith(
      'onnx-community/gemma-4-E2B-it-ONNX',
      expect.objectContaining({ progress_callback: expect.any(Function) }),
    )
    expect(Gemma4ForConditionalGeneration.from_pretrained).toHaveBeenCalledTimes(1)
    expect(Gemma4ForConditionalGeneration.from_pretrained).toHaveBeenCalledWith(
      'onnx-community/gemma-4-E2B-it-ONNX',
      expect.objectContaining({ device: 'webgpu', dtype: 'q4f16' }),
    )

    const messages = processor.apply_chat_template.mock.calls[0][0]
    expect(messages[1].content).toContain('Translate the following text into English.')
    expect(messages[1].content).toContain('hello')
    expect(processor.apply_chat_template).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ enable_thinking: false, add_generation_prompt: true }),
    )
    expect(processor).toHaveBeenCalledWith(
      'templated-prompt',
      null,
      null,
      expect.objectContaining({ add_special_tokens: false }),
    )
    expect(model.generate).toHaveBeenCalledWith(
      expect.objectContaining({ do_sample: false, max_new_tokens: 384 }),
    )
    expect(processor.batch_decode).toHaveBeenCalledWith(expect.anything(), { skip_special_tokens: true })
  })

  it('rejects without WebGPU instead of silently falling back to the CPU', async () => {
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined })

    await expect(translateText('a', 'ja', 'en', undefined, 'gemma4-webgpu'))
      .rejects.toThrow(/WebGPU/)
    expect(AutoProcessor.from_pretrained).not.toHaveBeenCalled()
  })

  it('rejects <unusedN> garbage (known WebGPU quant/overflow issue)', async () => {
    gemma4Ready({ decoded: '<unused57>'.repeat(100) })

    await expect(translateText('a', 'ja', 'en', undefined, 'gemma4-webgpu'))
      .rejects.toThrow(/garbled/)
  })

  it('unloadProvider disposes the model and processor', async () => {
    const { processor, model } = gemma4Ready({ decoded: 'x' })
    await translateText('a', 'ja', 'en', undefined, 'gemma4-webgpu')

    unloadProvider('gemma4-webgpu')
    await flush()
    expect(model.dispose).toHaveBeenCalledTimes(1)
    expect(processor.dispose).toHaveBeenCalledTimes(1)
  })
})

describe('progress relay', () => {
  it('relays aggregate progress and readiness as { overall, file, ready }', async () => {
    let progressCb
    const { gen } = captureGen(() => QWEN_OUT('x'))
    pipeline.mockImplementation(async (_t, _m, opts) => {
      progressCb = opts.progress_callback
      return gen
    })
    const onProgress = vi.fn()
    await translateText('a', 'ja', 'en', onProgress)

    progressCb({ status: 'progress_total', name: 'm', progress: 42, loaded: 420, total: 1000 })
    expect(onProgress).toHaveBeenLastCalledWith({ overall: 42, file: null, ready: false })

    progressCb({ status: 'ready', task: 'text-generation', model: 'm' })
    expect(onProgress).toHaveBeenLastCalledWith({ overall: 100, file: null, ready: true })
  })

  it('falls back to per-file progress when no aggregate event fires', async () => {
    let progressCb
    const { gen } = captureGen(() => QWEN_OUT('x'))
    pipeline.mockImplementation(async (_t, _m, opts) => {
      progressCb = opts.progress_callback
      return gen
    })
    const onProgress = vi.fn()
    await translateText('a', 'ja', 'en', onProgress)

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

    await expect(translateText('a', 'ja', 'en')).rejects.toThrow(/timed out/)
  })
})

describe('cached generators are independent per provider', () => {
  it('loads each provider once and reuses it', async () => {
    pipeline.mockImplementation(async () => captureGen(() => QWEN_OUT('x')).gen)
    gemma4Ready({ decoded: 'x' })

    await translateText('a', 'ja', 'en')
    await translateText('b', 'ja', 'en', undefined, 'gemma4-webgpu')
    await translateText('c', 'ja', 'en')
    await translateText('d', 'ja', 'en', undefined, 'gemma4-webgpu')

    // Qwen: one pipeline load. Gemma 4: one processor + one model load.
    expect(pipeline).toHaveBeenCalledTimes(1)
    expect(AutoProcessor.from_pretrained).toHaveBeenCalledTimes(1)
    expect(Gemma4ForConditionalGeneration.from_pretrained).toHaveBeenCalledTimes(1)
  })
})

describe('idle model release (unload)', () => {
  // Build a generator whose callable also carries a `dispose` spy, so we can
  // assert Transformers.js's dispose hook is invoked on release.
  const disposably = () => {
    const dispose = vi.fn()
    const gen = async () => QWEN_OUT('x')
    gen.dispose = dispose
    return { gen, dispose }
  }

  it('unloadProvider disposes the model and lets the next call reload it', async () => {
    pipeline.mockImplementation(async () => disposably().gen)
    await translateText('a', 'ja', 'en')
    expect(pipeline).toHaveBeenCalledTimes(1)

    unloadProvider('qwen-cpu')

    // Cached generator was dropped, so the next translation re-creates it.
    await translateText('b', 'ja', 'en')
    expect(pipeline).toHaveBeenCalledTimes(2)
  })

  it('releases the model after the idle timeout once no further translation happens', async () => {
    const { gen, dispose } = disposably()
    pipeline.mockImplementation(async () => gen)
    setUnloadTimeoutMs(30)
    await translateText('a', 'ja', 'en')
    expect(dispose).not.toHaveBeenCalled()

    await new Promise((r) => setTimeout(r, 120)) // well past 30 ms with no activity
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('a fresh translation before the timeout resets the countdown', async () => {
    const { gen, dispose } = disposably()
    pipeline.mockImplementation(async () => gen)
    setUnloadTimeoutMs(80)
    await translateText('a', 'ja', 'en') // release scheduled ~t=80

    await new Promise((r) => setTimeout(r, 30))
    await translateText('b', 'ja', 'en') // reschedules release ~t=30+80=110

    // Still within the rescheduled window -> not released yet.
    await new Promise((r) => setTimeout(r, 60)) // ~t=90 (90 < 110)
    expect(dispose).not.toHaveBeenCalled()

    await new Promise((r) => setTimeout(r, 60)) // ~t=150 (150 > 110) -> released
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})