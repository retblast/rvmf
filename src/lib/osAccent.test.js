import { describe, it, expect, beforeEach } from 'vitest'
import { applyOsAccent, osAccentPreferred } from './osAccent.js'

describe('osAccent', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to preferring the OS accent', () => {
    expect(osAccentPreferred()).toBe(true)
  })

  it('reads the persisted preference', async () => {
    localStorage.setItem('rvmf-use-os-accent', 'false')
    // storage migration runs at import; osAccent reads through it
    vi.resetModules()
    const mod = await import('./osAccent.js')
    expect(mod.osAccentPreferred()).toBe(false)
    localStorage.setItem('rvmf-use-os-accent', 'true')
  })

  it('disabling removes accent classes and custom properties', () => {
    document.documentElement.classList.add('os-accent')
    const applied = applyOsAccent(false)
    expect(applied).toBe(false)
    expect(document.documentElement.classList.contains('os-accent')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--os-accent')).toBe('')
  })

  // jsdom answers the AccentColor probe with its own hardcoded blue
  // (rgb(0, 153, 255)) — not one of our known-default entries — so the
  // enable path fires here. Assert the contract instead of the browser
  // quirk: "applied" and the custom property must always agree, and a
  // disabled call must clean everything up.
  it('keeps the applied state and the custom properties consistent', () => {
    const applied = applyOsAccent(true)
    const prop = document.documentElement.style.getPropertyValue('--os-accent')
    expect(applied).toBe(prop !== '')
    if (applied) {
      expect(document.documentElement.classList.contains('os-accent')).toBe(true)
      expect(document.documentElement.style.getPropertyValue('--os-accent-fg')).not.toBe('')
    }
  })
})
