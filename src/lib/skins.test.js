import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SKINS, validateSkin, applySkin } from './skins.js'

describe('validateSkin', () => {
  it('accepts a valid manifest and normalizes it', () => {
    const { ok, skin } = validateSkin({
      id: 'test-skin',
      name: 'Test',
      tokens: { light: { '--accent': '#ff0000' }, dark: { '--window-bg': '#111111' } },
      css: '.post-row { border-width: 2px; }',
    })
    expect(ok).toBe(true)
    expect(skin.id).toBe('test-skin')
    expect(skin.tokens.light['--accent']).toBe('#ff0000')
    expect(skin.css).toContain('border-width')
  })

  it('rejects bad ids and shadowing the built-in baseline', () => {
    expect(validateSkin({ id: 'Bad Id!', name: 'x' }).ok).toBe(false)
    expect(validateSkin({ id: 'adwaita', name: 'x' }).ok).toBe(false)
    expect(validateSkin(null).ok).toBe(false)
    expect(validateSkin({ name: 'no id' }).ok).toBe(false)
  })

  it('drops non-color token values instead of trusting them', () => {
    const { ok, skin } = validateSkin({
      id: 'sneaky',
      name: 'Sneaky',
      tokens: { light: { '--accent': 'javascript:alert(1)', '--ok': '#00aa00', 'not-a-prop': 'red' } },
    })
    expect(ok).toBe(true)
    expect(skin.tokens.light['--accent']).toBeUndefined()
    expect(skin.tokens.light['--ok']).toBe('#00aa00')
    expect(skin.tokens.light['not-a-prop']).toBeUndefined()
  })

  it('rejects url() in extra css (exfiltration vector)', () => {
    const { ok } = validateSkin({
      id: 'urls', name: 'URLs',
      css: '.post-row { background: url(https://evil.example/pixel.png); }',
    })
    expect(ok).toBe(false)
  })

  it('registry exposes breeze with both schemes', () => {
    expect(SKINS.breeze.tokens.light['--accent']).toBeDefined()
    expect(SKINS.breeze.tokens.dark['--window-bg']).toBeDefined()
  })
})

describe('applySkin', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-skin')
    vi.resetModules()
  })

  it('sets data-skin and injects scheme-scoped tokens', async () => {
    const mod = await import('./skins.js')
    mod.applySkin(mod.SKINS.breeze)
    expect(document.documentElement.dataset.skin).toBe('breeze')
    const css = document.getElementById('rvmf-skin').textContent
    expect(css).toContain('[data-skin="breeze"]')
    expect(css).toContain('--accent: #3daee9')
  })

  it('adwaita clears everything back to baseline', async () => {
    const mod = await import('./skins.js')
    mod.applySkin(mod.SKINS.breeze)
    mod.applySkin(mod.SKINS.adwaita)
    expect(document.documentElement.dataset.skin).toBeUndefined()
    expect(document.getElementById('rvmf-skin').textContent).toBe('')
  })
})
