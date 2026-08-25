import { describe, it, expect, beforeEach, vi } from 'vitest'

// storage.js runs its legacy migration at import time, so each test
// seeds state first and re-imports the module fresh.
async function freshStorage() {
  vi.resetModules()
  return import('./storage.js')
}

describe('storage wrapper', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('stores and reads under the rvmf- prefix', async () => {
    const s = await freshStorage()
    s.storageSet('theme-mode', 'dark')
    expect(localStorage.getItem('rvmf-theme-mode')).toBe('dark')
    expect(s.storageGet('theme-mode')).toBe('dark')
  })

  it('returns the fallback for missing keys', async () => {
    const s = await freshStorage()
    expect(s.storageGet('nope')).toBe(null)
    expect(s.storageGet('nope', 'system')).toBe('system')
  })

  it('migrates legacy mitra-* keys once, then deletes them', async () => {
    localStorage.setItem('mitra-theme-mode', 'dark')
    localStorage.setItem('mitra-use-os-accent', 'false')
    // app credentials carry the instance URL in the key itself
    localStorage.setItem('mitra-app:https://inst.example', '{"clientId":"x"}')

    const s = await freshStorage()
    expect(s.storageGet('theme-mode')).toBe('dark')
    expect(localStorage.getItem('rvmf-app:https://inst.example')).toBe('{"clientId":"x"}')

    // legacy keys are gone after the move
    expect(localStorage.getItem('mitra-theme-mode')).toBe(null)
    expect(localStorage.getItem('mitra-use-os-accent')).toBe(null)

    // a second import must not resurrect anything weird
    const s2 = await freshStorage()
    expect(s2.storageGet('theme-mode')).toBe('dark')
  })

  it('never overwrites an existing new-prefixed value during migration', async () => {
    localStorage.setItem('mitra-theme-mode', 'dark')
    localStorage.setItem('rvmf-theme-mode', 'light')
    await freshStorage()
    expect(localStorage.getItem('rvmf-theme-mode')).toBe('light')
    expect(localStorage.getItem('mitra-theme-mode')).toBe(null)
  })
})
