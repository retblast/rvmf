import { test, expect } from '@playwright/test'
import { loginAs, SEED } from '../helpers.js'

// Notification filter chips hide categories client-side. Runs on the
// narrow tier only, where Notifications is a header tab.
test('filter chips hide notification categories', async ({ page }) => {
  test.skip(test.info().project.name !== 'narrow', 'notifications tab is narrow-tier UI')

  await loginAs(page, 'alice')
  await page.goto('/')

  // alice has favourite notifications from the seed (bob + carol)
  await page.getByRole('button', { name: /notifications/i }).click()
  const favNotifs = page.locator('.notif-row').filter({ hasText: 'favourited your post' })
  await expect(favNotifs.first()).toBeVisible()

  // Toggle Favourites off -> those rows vanish
  await page.getByRole('button', { name: 'Favourites' }).click()
  await expect(page.locator('.notif-row').filter({ hasText: 'favourited your post' })).toHaveCount(0)

  // Back on -> they return
  await page.getByRole('button', { name: 'Favourites' }).click()
  await expect(favNotifs.first()).toBeVisible()
})
