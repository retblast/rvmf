import { test, expect } from '@playwright/test'
import { loginAs } from '../helpers.js'

// The privacy-mode zero-leak audit. Toggles "Hide My Identity" on as the
// logged-in user and then sweeps every surface an onlooker could glance
// at — home timeline, own profile, notifications, messages — asserting
// the user's handle appears NOWHERE in the DOM. Any future surface that
// renders identity without going through the mask fails this spec.

// The app picks its layout tier by viewport width; phones and the
// 'narrow' desktop project all run the narrow tier where Notifications
// is a header tab instead of the wide tier's permanent column.
const isNarrowTier = (testInfo) => {
  const vw = testInfo.project.use.viewport?.width
  return vw !== undefined && vw <= 900
}

test('privacy mode hides the user everywhere', async ({ page }, testInfo) => {
  await loginAs(page, 'alice')
  await page.goto('/')

  // Toggle the mode on via settings.
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('switch', { name: 'Hide My Identity' }).click()
  await page.keyboard.press('Escape')

  // No trace of the handle anywhere on the page.
  async function expectNoLeaks() {
    await expect(page.getByText('@alice')).toHaveCount(0)
  }

  // 1) Home timeline: alice's own seeded posts must render masked.
  await expectNoLeaks()
  await expect(page.getByText('You').first()).toBeVisible()
  await expect(page.getByText('@you').first()).toBeVisible()

  // 2) The tab must not name the instance either.
  expect(await page.title()).toBe('rvmf')

  // 3) Notifications: carol's seeded mention ping lands there with the
  //    handle inside the content — the render pipeline must show @you.
  if (isNarrowTier(testInfo)) {
    await page.getByRole('button', { name: /notifications/i }).click()
  }
  await expect(page.getByText(/mentioned you/i).first()).toBeVisible()
  await expectNoLeaks()

  // 4) Messages: the seeded DM's snippet contains the handle.
  await page.getByRole('button', { name: 'Messages' }).click()
  await expectNoLeaks()

  // 5) Own profile, last: once the profile is open it overlays the
  //    narrow-tier views, so every tab sweep happens before it. Back to
  //    the timeline first, then click the masked author on alice's row.
  await page.getByRole('button', { name: 'Home' }).click()
  await page.locator('.post-row', { hasText: 'Seeded root post from alice' }).first().locator('.post-name').click()
  await expect(page.locator('.profile-display-name')).toHaveText('You')
  await expect(page.locator('.profile-handle')).toHaveText('@you')
  await expectNoLeaks()
})
