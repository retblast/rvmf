import { test, expect } from '@playwright/test'
import { loginAs, SEED } from '../helpers.js'

// Wide tier: thread lives in a permanent third column. Open the seeded
// root's thread, reply inline, and see the reply land in the tree.
test('open a thread and post an inline reply', async ({ page }) => {
  await loginAs(page, 'bob')
  await page.goto('/')

  const row = page.locator('.post-row', { hasText: SEED.rootText }).first()
  await row.locator('.post-text').click()

  // Focal post shows in the panel with its seeded reply beneath
  const panel = page.getByTestId('thread-root')
  await expect(panel.getByText(SEED.rootText)).toBeVisible()
  await expect(panel.getByText(SEED.replyText)).toBeVisible()

  // Inline reply composer under the focal post
  const replyText = `e2e reply ${Date.now().toString(36)}`
  await panel.getByRole('button', { name: 'Reply' }).first().click()
  await panel.getByPlaceholder(/reply to/i).fill(replyText)
  await panel.locator('.inline-reply-composer').getByRole('button', { name: /^reply$/i }).click()

  await expect(panel.getByText(replyText)).toBeVisible()
})
