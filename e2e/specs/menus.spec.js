import { test, expect } from '@playwright/test'
import { loginAs } from '../helpers.js'

// Post menus must always be completely visible and above the page, no
// matter where the post sits. The old in-row dropdowns were
// position:absolute inside the overflow:hidden timeline list, so the
// topmost post's menu opened upward straight out of the clip box and
// vanished. These specs pin the regression: the menu portals to <body>,
// lands fully inside the viewport, and stacks above other rows.

test('the post options menu stays fully visible from any row', async ({ page }) => {
  await loginAs(page, 'bob')
  await page.goto('/')

  async function openMenuAndAssertInsideViewport() {
    await page.locator('.post-row').first().locator('button[aria-label="More options"]').click()
    const menu = page.locator('.boost-dropdown').last()
    await expect(menu).toBeVisible()

    // Portaled: no clipping ancestor can reach it
    expect(await menu.evaluate((el) => el.closest('.timeline-list'))).toBeNull()

    // Fully inside the viewport
    const inside = await menu.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth
    })
    expect(inside).toBe(true)

    // Stacks above page content, not under it
    expect(await menu.evaluate((el) => getComputedStyle(el).zIndex)).toBe('95')
    await page.keyboard.press('Escape')
  }

  // Topmost row — the reported case: the menu used to open upward out
  // of the clipped list and disappear.
  await openMenuAndAssertInsideViewport()

  // Scroll the timeline so the LAST row is the only one on screen and
  // repeat — the menu must flip or clamp, never clip.
  await page.mouse.move(200, 300)
  await page.mouse.wheel(0, 4000)
  await openMenuAndAssertInsideViewport()
})

test('the boost dropdown and reaction picker follow the same rules', async ({ page }) => {
  await loginAs(page, 'bob')
  await page.goto('/')
  // The seeded root is public — boostable. (The timeline's first row can
  // be a seeded DM, which has no boost trigger.)
  const row = page.locator('.post-row', { hasText: 'Seeded root post from alice' }).first()

  await row.locator('button[aria-label="Boost or quote"]').click()
  const boostMenu = page.locator('.boost-dropdown').last()
  await expect(boostMenu).toBeVisible()
  expect(await boostMenu.evaluate((el) => el.closest('.timeline-list'))).toBeNull()
  expect(await boostMenu.evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0)
  await page.keyboard.press('Escape')

  await row.locator('button[aria-label="React"]').click()
  const picker = page.locator('.reaction-picker').last()
  await expect(picker).toBeVisible()
  expect(await picker.evaluate((el) => el.closest('.timeline-list'))).toBeNull()
  expect(await picker.evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0)
  await page.keyboard.press('Escape')
})
