import { test, expect } from '@playwright/test'
import { loginAs, SEED } from '../helpers.js'

// Wide tier: thread lives in a permanent third column. Open the seeded
// root's thread, reply inline, and see the reply land in the tree.
test('open a thread and post an inline reply', async ({ page }, testInfo) => {
  await loginAs(page, 'bob')
  await page.goto('/')

  const row = page.locator('.post-row', { hasText: SEED.rootText }).first()
  await row.locator('.post-text').click()

  // Timeline post collapses to a ghost placeholder ("Viewing in thread")
  // after the slide animation — but only in tiers where the timeline stays
  // mounted.  Narrow tier replaces the timeline with the thread view
  // entirely.  (Assert by label text, not by the row: the collapsed ghost
  // strips the post's own text, so filtering the row by it finds nothing.)
  if (testInfo.project.name !== 'narrow') {
    await expect(page.getByText('Viewing in thread').first()).toBeVisible()
  }

  // Focal post shows in the panel with its seeded replies beneath
  const panel = page.getByTestId('thread-root')
  await expect(panel.getByText(SEED.rootText)).toBeVisible()
  await expect(panel.getByText(SEED.replyText)).toBeVisible()
  await expect(panel.getByText(SEED.nestedReplyText)).toBeVisible()

  // Inline reply composer under the focal post
  const replyText = `e2e reply ${Date.now().toString(36)}`
  await panel.getByRole('button', { name: 'Reply' }).first().click()
  await panel.getByPlaceholder(/reply to/i).fill(replyText)
  await panel.locator('.inline-reply-composer').getByRole('button', { name: /^reply$/i }).click()

  await expect(panel.getByText(replyText)).toBeVisible()
})

// Clicking a mid-thread reply must NOT collapse the panel to that reply's
// own subtree — the whole conversation stays visible, and the clicked
// reply is highlighted in place.
test('clicking a mid-thread reply keeps the full thread visible', async ({ page }) => {
  await loginAs(page, 'carol')
  await page.goto('/')

  const row = page.locator('.post-row', { hasText: SEED.rootText }).first()
  await row.locator('.post-text').click()

  const panel = page.getByTestId('thread-root')
  await expect(panel.getByText(SEED.rootText)).toBeVisible()
  await expect(panel.getByText(SEED.nestedReplyText)).toBeVisible()

  // Click the nested reply (second-level, so a real mid-thread post).
  const nested = panel.getByText(SEED.nestedReplyText)
  await nested.click()

  // The whole thread must still be present — root, first-level reply,
  // sibling branch, and the clicked reply itself.
  await expect(panel.getByText(SEED.rootText)).toBeVisible()
  await expect(panel.getByText(SEED.replyText)).toBeVisible()
  await expect(panel.getByText(SEED.siblingReplyText)).toBeVisible()
  await expect(panel.getByText(SEED.nestedReplyText)).toBeVisible()
})
