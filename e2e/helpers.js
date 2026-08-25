import { readFileSync } from 'node:fs'

// Shared helpers for E2E specs. The seed script writes session objects
// to e2e/.state/seed.json; injecting one into localStorage is the fast,
// reliable path into an authenticated app — the full UI login flow has
// its own dedicated spec.
export function loginAs(page, username) {
  const state = JSON.parse(readFileSync(new URL('./.state/seed.json', import.meta.url), 'utf8'))
  const session = state.sessions[username]
  if (!session) throw new Error(`no seeded session for ${username}`)
  return page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: 'rvmf-session', value: JSON.stringify(session) }
  )
}

// Post text asserted across specs — keep in sync with scripts/seed.mjs.
export const SEED = {
  rootText: 'Seeded root post from alice',
  replyText: 'Reply from bob to the seeded root',
  secondText: 'Second seeded post from bob #testing',
}
