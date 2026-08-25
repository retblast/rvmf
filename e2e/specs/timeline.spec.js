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

  // The click can land on a rate-limited server; retry the whole
  // click-and-verify cycle rather than assuming the first POST stuck.
  await expect(async () => {
    await rows.first().getByRole('button', { name: 'Favorite' }).click()
    for (const btn of await rows.locator('[data-favourited]').all()) {
      const attr = await btn.getAttribute('data-favourited')
      if (attr !== after) throw new Error(`expected ${after}, got ${attr}`)
    }
  }).toPass({ timeout: 15_000 })
})

test('boosting shows in the boost trigger state', async ({ page }) => {
  await loginAs(page, 'alice')
  await page.goto('/')

  const row = page.locator('.post-row', { hasText: SEED.secondText }).first()
  await expect(row).toBeVisible()

  const trigger = row.getByRole('button', { name: /boost or quote/i })

  // Transition-based (projects share one seeded instance) and
  // self-healing against rate-limited writes: each pass reads the
  // current state, opens the dropdown, and clicks toward the target.
  async function driveTo(target) {
    await expect(async () => {
      const current = await trigger.getAttribute('data-reblogged')
      if (current === target) return
      await trigger.click() // opens (or closes) the dropdown
      const itemName = target === 'true' ? /^boost$/i : /^unboost$/i
      const item = row.getByRole('button', { name: itemName })
      // A previous pass may have left the dropdown closed — reopen once.
      if (!(await item.isVisible().catch(() => false))) {
        await trigger.click()
      }
      await item.click()
      const now = await trigger.getAttribute('data-reblogged')
      if (now !== target) throw new Error(`reblogged=${now}, want ${target}`)
    }).toPass({ timeout: 20_000 })
  }

  await driveTo('true')
  await expect(trigger).toHaveAttribute('data-reblogged', 'true')
  await driveTo('false')
})
