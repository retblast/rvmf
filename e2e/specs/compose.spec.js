import { test, expect } from '@playwright/test'
import { loginAs } from '../helpers.js'

test('markdown preview renders before posting', async ({ page }) => {
  await loginAs(page, 'carol')
  await page.goto('/')

  const unique = `e2e compose ${Date.now().toString(36)}`
  await page.getByRole('button', { name: /new post/i }).click()

  const textarea = page.getByPlaceholder(/what's on your mind/i)
  await textarea.fill(`**bold** ${unique}`)

  // Preview pane shows server-rendered output
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  const preview = page.locator('.compose-preview')
  await expect(preview.getByText('Preview')).toBeVisible()
  await expect(preview).toContainText('bold')
  await expect(preview).toContainText(unique)

  // Post it and it lands at the top of the home timeline
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(page.locator('.post-row').first()).toContainText(unique)
})
