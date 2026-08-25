// Seeds the local Mitra fixture with known users and content so E2E
// specs can assert exact strings. Reuses the app's own API client —
// the same code paths a real session uses.
//
// Usage: node scripts/seed.mjs <instanceUrl>
import * as mitra from '../src/lib/mitra.js'

const instanceUrl = process.argv[2] || 'http://127.0.0.1:8383'
const PASSWORD = 'password-123'

// Users are created by e2e.sh via the Mitra CLI (the HTTP registration
// endpoint is rate-limited); this script only logs them in and populates
// content. Logins are also limiter-guarded, so retry patiently.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function makeUser(username) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return await mitra.loginWithPassword(instanceUrl, username, PASSWORD)
    } catch (err) {
      console.log(`login ${username} attempt ${attempt + 1} failed (${err.message}); waiting...`)
      await sleep(4000)
    }
  }
  throw new Error(`could not log in as ${username}`)
}

const alice = await makeUser('alice')
const bob = await makeUser('bob')
const carol = await makeUser('carol')

// Follow graph: alice <-> bob, plus carol follows both so her home
// timeline has content for the specs.
await mitra.followAccount(instanceUrl, alice.token, bob.account.id)
await mitra.followAccount(instanceUrl, bob.token, alice.account.id)
await mitra.followAccount(instanceUrl, carol.token, alice.account.id)
await mitra.followAccount(instanceUrl, carol.token, bob.account.id)

const root = await mitra.postStatus(instanceUrl, alice.token,
  'Seeded root post from alice', { visibility: 'public' })
await mitra.postStatus(instanceUrl, bob.token,
  'Reply from bob to the seeded root', { inReplyToId: root.id, visibility: 'public' })
const second = await mitra.postStatus(instanceUrl, bob.token,
  'Second seeded post from bob #testing', { visibility: 'public' })

// Interactions: bob boosts + favourites alice's root; carol favourites it too.
await mitra.setReblogged(instanceUrl, bob.token, root.id, false)
await mitra.setFavourited(instanceUrl, bob.token, root.id, false)
await mitra.setFavourited(instanceUrl, carol.token, second.id, false)

// Poll from alice; carol votes.
const pollPost = await mitra.postStatus(instanceUrl, alice.token, 'Seeded poll: pick one', {
  visibility: 'public',
  poll: { options: ['yes', 'no'], expires_in: 86400, multiple: false },
})
if (pollPost.poll) {
  await mitra.votePoll(instanceUrl, carol.token, pollPost.poll.id, [0]).catch(() => {})
}

// A direct message for the Messages view.
await mitra.postStatus(instanceUrl, bob.token, `Direct note to @${alice.account.acct}`, {
  visibility: 'direct',
})

console.log('seed complete')
const statePath = new URL('../e2e/.state/seed.json', import.meta.url)
const { mkdirSync, writeFileSync } = await import('node:fs')
mkdirSync(new URL('../e2e/.state/', import.meta.url), { recursive: true })
writeFileSync(statePath, JSON.stringify({
  instanceUrl,
  password: PASSWORD,
  users: { alice: alice.account.acct, bob: bob.account.acct, carol: carol.account.acct },
  sessions: {
    alice: { instanceUrl, token: alice.token, account: alice.account, maxCharacters: alice.maxCharacters },
    bob: { instanceUrl, token: bob.token, account: bob.account, maxCharacters: bob.maxCharacters },
    carol: { instanceUrl, token: carol.token, account: carol.account, maxCharacters: carol.maxCharacters },
  },
}, null, 2))
console.log(`state written to ${statePath.pathname}`)

