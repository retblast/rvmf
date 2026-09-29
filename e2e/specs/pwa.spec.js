import { test, expect } from '@playwright/test'

// PWA surface: the service worker activates, the manifest parses with
// icons, and every icon URL it advertises actually resolves. Together
// with the manifest's standalone display + icons this is the exact
// criteria checklist browsers gate installability on.
test('registers the service worker and serves a complete manifest', async ({ page }) => {
  await page.goto('/')

  const scriptUrl = await page.evaluate(() =>
    navigator.serviceWorker.ready.then((reg) => reg.active?.scriptURL || '')
  )
  expect(scriptUrl).toContain('/sw.js')

  const manifest = await page.evaluate(async () => {
    const res = await fetch('/manifest.webmanifest')
    return res.ok ? res.json() : null
  })
  expect(manifest?.name).toBe('rvmf')
  expect(manifest.display).toBe('standalone')
  expect(manifest.icons?.length).toBeGreaterThan(0)

  for (const icon of manifest.icons) {
    const ok = await page.evaluate(async (src) => (await fetch(src)).ok, icon.src)
    expect(ok, `manifest icon ${icon.src} must resolve`).toBe(true)
  }
})
