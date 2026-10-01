import { test, expect } from '@playwright/test'
import { loginAs } from '../helpers.js'

// The Stealth (X-look) skin must swap the chrome without breaking the
// role-based contract: every header action keeps its accessible name
// (specs and screen readers navigate by role+name), the browser tab
// reads as X, and the phone tier's overflow views move behind the
// settings menu. Layout assertions are tier-aware, mirroring the
// app's own breakpoints (wide >=1400, medium 900-1399, narrow <900).

const isNarrowTier = (testInfo) => {
  const vw = testInfo.project.use.viewport?.width
  return vw !== undefined && vw <= 900
}

test('stealth skin swaps the chrome and keeps the accessible contract', async ({ page }, testInfo) => {
  await loginAs(page, 'alice')
  await page.goto('/')

  // Switch to the skin via settings
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByLabel('Style').selectOption('stealth-x')
  await page.keyboard.press('Escape')

  // The tab disguises itself: title and favicon are skin-owned
  expect(await page.title()).toBe('𝕏')
  const iconHref = await page.evaluate(() => document.querySelector("link[rel~='icon']").href)
  expect(iconHref).toContain('/icons/x-favicon.svg')

  if (isNarrowTier(testInfo)) {
    // Phone tier: top bar + bottom tab bar with a center Post button
    await expect(page.getByRole('button', { name: 'New post' })).toBeVisible()
    await page.getByRole('button', { name: 'Explore' }).click()
    await expect(page.locator('.x-topbar-title')).toHaveText('Explore')

    // Overflow views (Bookmarks/Lists/Groups) live behind the settings menu
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('button', { name: 'Bookmarks' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()
    await page.keyboard.press('Escape')
  } else {
    // Wide tier: the rail replaces the header bar
    await expect(page.locator('.x-rail')).toBeVisible()
    await expect(page.getByRole('button', { name: 'New post' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible()

    // Rail navigation keeps working and marks the active view
    await page.getByRole('button', { name: 'Explore' }).click()
    await expect(page.getByRole('button', { name: 'Explore' })).toHaveAttribute('aria-current', 'page')

    // Medium tier (resize into 900-1399): the rail collapses to icons —
    // visible labels hide but accessible names survive via aria-label
    await page.setViewportSize({ width: 1000, height: 900 })
    await expect(page.locator('.x-rail')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Explore' })).toBeVisible()
    await expect(page.locator('.x-rail .view-label').first()).toBeHidden()
  }
})

test('privacy masking survives the skin', async ({ page }, testInfo) => {
  await loginAs(page, 'alice')
  await page.goto('/')

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByLabel('Style').selectOption('stealth-x')
  await page.getByRole('switch', { name: 'Hide My Identity' }).click()
  await page.keyboard.press('Escape')

  // The real handle appears nowhere under the skin
  await expect(page.getByText('@alice')).toHaveCount(0)

  // Wide/medium: the rail chip shows the masked identity explicitly
  if (!isNarrowTier(testInfo)) {
    await expect(page.locator('.x-account-chip')).toContainText('You')
    await expect(page.locator('.x-account-chip')).toContainText('@you')
  }
})

test('stealth skin shows the thread pane only while a thread is open', async ({ page }) => {
  test.skip(!(test.info().project.use.viewport?.width >= 1400), 'wide tier only — medium/narrow already collapse the pane')

  await loginAs(page, 'bob')
  await page.goto('/')

  // Switch to the skin
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByLabel('Style').selectOption('stealth-x')
  await page.keyboard.press('Escape')

  // No thread open: no third column — the feed centers between the
  // rail and the notifications sidebar
  await expect(page.locator('.thread-column')).toHaveCount(0)

  // Opening a thread brings the pane in as a new column
  await page.locator('.post-row', { hasText: 'Seeded root post from alice' }).first().locator('.post-text').click()
  const pane = page.getByTestId('thread-root')
  await expect(pane).toBeVisible()
  await expect(page.locator('.thread-column')).toHaveCount(1)

  // The pane's left-side back button closes it — back to the centered
  // two-column layout
  await page.getByRole('button', { name: 'Back to notifications' }).click()
  await expect(page.locator('.thread-column')).toHaveCount(0)
  await expect(pane).toHaveCount(0)
})
