import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Unit/component tests live beside the code they cover (*.test.*). E2E
// specs are separate (e2e/, run by Playwright) and don't share this
// config.
export default defineConfig({
  plugins: [react()],
  test: {
    // Unit/component tests only, and only from src/ — Playwright owns
    // e2e/specs, and .direnv store copies must never be scanned.
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    css: false,
  },
})
