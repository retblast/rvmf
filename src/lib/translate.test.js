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

  it('relays progress events for the weight download', async () => {
    let progressCb
    pipeline.mockImplementation(async (_t, _m, opts) => {
      progressCb = opts.progress_callback
      return genReturning([{ content: 'x' }])
    })
    const onProgress = vi.fn()
    await translateText('a', 'en', 'ja', onProgress)
    progressCb({ status: 'progress', file: 'model.onnx', loaded: 50, total: 100 })
    expect(onProgress).toHaveBeenCalledWith({ file: 'model.onnx', loaded: 50, total: 100 })
  })
})
