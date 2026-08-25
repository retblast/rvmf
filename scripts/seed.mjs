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
// content. Mitra's internal limiter also bites writes, so every
// interaction is retried patiently.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function patient(fn, label) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt === 5) throw err
      console.log(`${label} attempt ${attempt + 1} failed (${err.message}); waiting...`)
      await sleep(3000)
    }
  }
}

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
await patient(() => mitra.followAccount(instanceUrl, alice.token, bob.account.id), 'follow a->b')
await patient(() => mitra.followAccount(instanceUrl, bob.token, alice.account.id), 'follow b->a')
await patient(() => mitra.followAccount(instanceUrl, carol.token, alice.account.id), 'follow c->a')
await patient(() => mitra.followAccount(instanceUrl, carol.token, bob.account.id), 'follow c->b')

const root = await patient(() => mitra.postStatus(instanceUrl, alice.token,
  'Seeded root post from alice', { visibility: 'public' }), 'post root')
const rootReply = await patient(() => mitra.postStatus(instanceUrl, bob.token,
  'Reply from bob to the seeded root', { inReplyToId: root.id, visibility: 'public' }), 'post reply')
const second = await patient(() => mitra.postStatus(instanceUrl, bob.token,
  'Second seeded post from bob #testing', { visibility: 'public' }), 'post second')

// Interactions: bob boosts + favourites alice's root; carol favourites it too.
await patient(() => mitra.setReblogged(instanceUrl, bob.token, root.id, false), 'boost')
await patient(() => mitra.setFavourited(instanceUrl, bob.token, root.id, false), 'fav bob')
await patient(() => mitra.setFavourited(instanceUrl, carol.token, second.id, false), 'fav carol')

// Poll from alice; carol votes.
const pollPost = await patient(() => mitra.postStatus(instanceUrl, alice.token, 'Seeded poll: pick one', {
  visibility: 'public',
  poll: { options: ['yes', 'no'], expires_in: 86400, multiple: false },
}), 'post poll')
if (pollPost.poll) {
  await patient(() => mitra.votePoll(instanceUrl, carol.token, pollPost.poll.id, [0]).catch(() => {}), 'vote')
}

// A direct message for the Messages view.
await patient(() => mitra.postStatus(instanceUrl, bob.token, `Direct note to @${alice.account.acct}`, {
  visibility: 'direct',
}), 'post dm')

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

