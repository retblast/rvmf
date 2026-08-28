import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { translateText, resetTranslator } from './translate.js'

// Mock the heavy Transformers.js module so these tests exercise our
// orchestration (language resolution, singleton, output parsing) without
// downloading a multi-GB model or requiring a GPU.
const pipeline = vi.fn()
const env = { allowLocalModels: true }
vi.mock('@huggingface/transformers', () => ({
  pipeline: (...args) => pipeline(...args),
  env,
}))

function genReturning(content) {
  return async function gen() {
    return [{ generated_text: content }]
  }
}

beforeEach(() => {
  pipeline.mockReset()
  resetTranslator()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('translateText', () => {
  it('rejects unsupported source or target languages without loading the model', async () => {
    await expect(translateText('hi', 'xx', 'en')).rejects.toThrow(/source language/)
    await expect(translateText('hi', 'ja', 'xx')).rejects.toThrow(/target language/)
    expect(pipeline).not.toHaveBeenCalled()
  })

  it('sends the TranslateGemma prompt and parses the chat output', async () => {
    let messagesArg, optsArg
    const gen = async function gen(messages, opts) {
      messagesArg = messages
      optsArg = opts
      return [{ generated_text: [{ content: 'こんにちは' }] }]
    }
    pipeline.mockResolvedValue(gen)

    const out = await translateText('hello', 'en', 'ja')
    expect(out).toBe('こんにちは')

    expect(pipeline).toHaveBeenCalledTimes(1)
    const [task, modelId, options] = pipeline.mock.calls[0]
    expect(task).toBe('text-generation')
    expect(modelId).toBe('onnx-community/translategemma-text-4b-it-ONNX')
    expect(options.device).toBe('webgpu')
    expect(options.dtype).toBeTruthy()
    expect(typeof options.progress_callback).toBe('function')

    expect(messagesArg[0].role).toBe('user')
    const content = messagesArg[0].content[0]
    expect(content.type).toBe('text')
    expect(content.source_lang_code).toBe('en')
    expect(content.target_lang_code).toBe('ja_JP')
    expect(content.text).toBe('hello')
    expect(optsArg.max_new_tokens).toBe(1024)
  })

  it('shares a single pipeline instance across calls', async () => {
    pipeline.mockImplementation(async () => genReturning([{ content: 'x' }]))
    await translateText('a', 'en', 'ja')
    await translateText('b', 'en', 'ja')
    expect(pipeline).toHaveBeenCalledTimes(1) // cached, not reloaded
  })

  it('throws when the model returns no content', async () => {
    pipeline.mockImplementation(async () => genReturning([]))
    await expect(translateText('a', 'en', 'ja')).rejects.toThrow(/empty result/)
  })

  it('relays aggregate download progress and readiness as { overall, file, ready }', async () => {
    let progressCb
    pipeline.mockImplementation(async (_t, _m, opts) => {
      progressCb = opts.progress_callback
      return genReturning([{ content: 'x' }])
    })
    const onProgress = vi.fn()
    await translateText('a', 'en', 'ja', onProgress)

    // Aggregate download progress (smooth 0–100 across all files).
    progressCb({ status: 'progress_total', name: 'm', progress: 42, loaded: 420, total: 1000, files: {} })
    expect(onProgress).toHaveBeenLastCalledWith({ overall: 42, file: null, ready: false })

    // Per-file event only updates the "current file" label; overall is kept.
    progressCb({ status: 'progress', name: 'm', file: 'model.onnx', progress: 7, loaded: 70, total: 1000 })
    expect(onProgress).toHaveBeenLastCalledWith({ overall: 42, file: 'model.onnx', ready: false })

    // Ready: download finished, inference is running → 100% + ready flag.
    progressCb({ status: 'ready', task: 'text-generation', model: 'm' })
    expect(onProgress).toHaveBeenLastCalledWith({ overall: 100, file: 'model.onnx', ready: true })
  })

  it('falls back to per-file progress when no aggregate event fires', async () => {
    let progressCb
    pipeline.mockImplementation(async (_t, _m, opts) => {
      progressCb = opts.progress_callback
      return genReturning([{ content: 'x' }])
    })
    const onProgress = vi.fn()
    await translateText('a', 'en', 'ja', onProgress)

    // Only per-file events arrive (no progress_total): each forwards its own
    // file progress so the bar still moves instead of hanging on indeterminate.
    progressCb({ status: 'progress', name: 'm', file: 'model.onnx', loaded: 250, total: 1000 })
    expect(onProgress).toHaveBeenLastCalledWith({ overall: 25, file: 'model.onnx', ready: false })

    progressCb({ status: 'progress', name: 'm', file: 'model.onnx', loaded: 500, total: 1000 })
    expect(onProgress).toHaveBeenLastCalledWith({ overall: 50, file: 'model.onnx', ready: false })

    progressCb({ status: 'ready', task: 'text-generation', model: 'm' })
    expect(onProgress).toHaveBeenLastCalledWith({ overall: 100, file: 'model.onnx', ready: true })
  })
})
