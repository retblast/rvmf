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
  // immediately when the thread opens — the ghost is derived from context,
  // no animation delay.  Only in tiers where the timeline stays mounted:
  // narrow tier replaces the timeline with the thread view entirely.
  // (Assert by label text, not by the row: the collapsed ghost strips the
  // post's own text, so filtering the row by it finds nothing.)
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

// Opening a thread FROM a specific reply must focus that reply inside the
// panel: scrolled into view and marked persistently — not just flashed
// for the intro glow and forgotten.
test('opening a thread from a reply focuses that reply', async ({ page }) => {
  await loginAs(page, 'alice')
  await page.goto('/')

  // Bob's reply to alice's root sits in alice's home timeline (b->a follow).
  const row = page.locator('.post-row', { hasText: SEED.replyText }).first()
  await row.locator('.post-text').click()

  const panel = page.getByTestId('thread-root')
  // Root stays the focal post — the full thread opens, not a subtree.
  await expect(panel.getByText(SEED.rootText)).toBeVisible()

  const focused = panel.locator('.reply-row.focused-reply', { hasText: SEED.replyText })
  await expect(focused).toBeVisible()
  await expect(focused).toBeInViewport()

  // Focus persists past the old 2s glow window.
  await page.waitForTimeout(2500)
  await expect(focused).toBeVisible()
})

// Switching between posts from the timeline while the panel is open must
// move the ghost placeholder to the newly-clicked row immediately — no
// flicker, no 300ms timer gap.  (Wide tier only: narrow replaces the
// timeline.)
test('switching between timeline posts moves the ghost immediately', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'narrow', 'narrow tier replaces the timeline')

  await loginAs(page, 'bob')
  await page.goto('/')

  // Open the seeded root's thread.
  const rootRow = page.locator('.post-row', { hasText: SEED.rootText }).first()
  await rootRow.locator('.post-text').click()
  await expect(page.getByText('Viewing in thread').first()).toBeVisible()

  // Open a different post — the seeded second post from bob.
  const secondRow = page.locator('.post-row', { hasText: SEED.secondText }).first()
  await secondRow.locator('.post-text').click()

  // The ghost must now be on the second post's row (exactly one ghost
  // label visible, and it appears immediately — no timer delay).
  const ghostLabels = page.locator('.post-row.ghost .ghost-label')
  await expect(ghostLabels).toHaveCount(1)
  await expect(ghostLabels.first()).toBeVisible()

  // The root's row must have its full content back (not ghosted).
  const rootText = page.locator('.post-row', { hasText: SEED.rootText }).first()
  await expect(rootText.locator('.post-text')).toBeVisible()
})
