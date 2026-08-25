import { defineConfig, devices } from '@playwright/test'

// Selector policy for every spec: getByRole/getByLabel/getByPlaceholder
// first, data-testid/data-* attributes second. Never CSS classes —
// those are styling, not API.
export default defineConfig({
  testDir: './e2e/specs',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // One retry in CI absorbs rare scheduler flakes; local runs stay honest.
  retries: process.env.CI ? 1 : 0,
  workers: 1, // shared seeded instance; keep runs deterministic
  use: {
    baseURL: `http://127.0.0.1:${process.env.E2E_PREVIEW_PORT || 4173}`,
    trace: 'retain-on-failure',
    reducedMotion: 'reduce', // kill Framer Motion choreography
    // On NixOS the downloaded browser build can't find system libs;
    // the flake's e2e app points this at the nixpkgs chromium instead.
    ...(process.env.CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.CHROMIUM_PATH } }
      : {}),
  },
  projects: [
    // The app has three layout tiers; exercise the two that differ most.
    { name: 'wide', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'narrow', use: { ...devices['Desktop Chrome'], viewport: { width: 780, height: 900 } } },
  ],
})
