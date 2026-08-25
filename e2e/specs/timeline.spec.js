import { test, expect } from '@playwright/test'
import { loginAs, SEED } from '../helpers.js'

// The seeded timeline contains alice's root post twice: once as her own
// post, once inside bob's boost wrapper. Favouriting one copy must flip
// the state on every copy — the cross-copy sync contract.
test('favouriting one copy updates the boost-wrapper copy', async ({ page }) => {
  await loginAs(page, 'carol')
  await page.goto('/')

  const rows = page.locator('.post-row', { hasText: SEED.rootText })
  await expect(rows).toHaveCount(2)

  // Transition-based: prior state depends on spec order (projects share
  // one seeded instance), so click and assert that EVERY copy flips
  // together — the cross-copy contract, independent of starting state.
  const before = await rows.first().locator('[data-favourited]').getAttribute('data-favourited')
  const after = before === 'true' ? 'false' : 'true'

  await rows.first().getByRole('button', { name: 'Favorite' }).click()
  for (const btn of await rows.locator('[data-favourited]').all()) {
    await expect(btn).toHaveAttribute('data-favourited', after)
  }
})

test('boosting shows in the boost trigger state', async ({ page }) => {
  await loginAs(page, 'alice')
  await page.goto('/')

  const row = page.locator('.post-row', { hasText: SEED.secondText }).first()
  await expect(row).toBeVisible()

  const boost = row.getByRole('button', { name: /boost or quote/i })
  await expect(boost).toHaveAttribute('data-reblogged', 'false')

  await boost.click()
  await row.getByRole('button', { name: /^boost$/i }).click()
  await expect(boost).toHaveAttribute('data-reblogged', 'true')

  // Undo it to keep the fixture close to its seeded shape
  await boost.click()
  await row.getByRole('button', { name: /^unboost$/i }).click()
  await expect(boost).toHaveAttribute('data-reblogged', 'false')
})
