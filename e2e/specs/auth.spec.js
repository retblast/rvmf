import { test, expect } from '@playwright/test'

// Exercises the full signup UI: instance recognition, form validation,
// account creation, and the password-grant auto-login landing.
// Username is unique per run so re-seeded instances don't collide.

const INSTANCE = process.env.E2E_INSTANCE || 'http://127.0.0.1:8383'

test('signup creates an account and lands in the timeline', async ({ page }) => {
  const username = `e2e-${Date.now().toString(36)}`
  await page.goto('/')

  // Login screen is up
  await expect(page.getByRole('heading', { name: /sign in to your instance/i })).toBeVisible()

  // Switch to signup mode
  await page.getByRole('button', { name: /create an account/i }).click()
  await expect(page.getByRole('heading', { name: /create your account/i })).toBeVisible()

  await page.getByPlaceholder('mitra.example.social').fill(INSTANCE)
  await page.getByPlaceholder('lowercase_name').fill(username)
  await page.locator('input[type="password"]').nth(0).fill('password-123')
  await page.locator('input[type="password"]').nth(1).fill('password-123')

  await page.getByRole('button', { name: /create account$/i }).click()

  // Auto-login drops us straight into the app
  await expect(page.getByText('Home timeline')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: /new post/i })).toBeVisible()
})

test('mismatched passwords are rejected client-side', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /create an account/i }).click()
  await page.getByPlaceholder('mitra.example.social').fill(INSTANCE.replace(/^https?:\/\//, ''))
  await page.getByPlaceholder('lowercase_name').fill('nomatch')
  await page.locator('input[type="password"]').nth(0).fill('password-123')
  await page.locator('input[type="password"]').nth(1).fill('different')
  await page.getByRole('button', { name: /create account$/i }).click()
  await expect(page.getByText(/don't match/i)).toBeVisible()
})
