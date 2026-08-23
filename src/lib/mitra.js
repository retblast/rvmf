const APP_STORAGE_PREFIX = 'mitra-app:'
const PENDING_LOGIN_KEY = 'mitra-pending-login'

export function normalizeInstanceUrl(input) {
  let url = input.trim()
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`
  }
  return url.replace(/\/+$/, '')
}

function getRedirectUri() {
  return `${window.location.origin}${window.location.pathname}`
}

async function apiFetch(instanceUrl, path, options = {}) {
  let res
  try {
    res = await fetch(`${instanceUrl}${path}`, options)
  } catch {
    throw new Error(
      "Couldn't reach that instance. Check the address, and that it allows requests from this origin (CORS)."
    )
  }

  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = body.error_description || body.error || detail
    } catch {
      // response wasn't JSON, keep statusText
    }
    throw new Error(`${detail} (${res.status})`)
  }

  if (res.status === 204) return null
  return res.json()
}

function loadAppCredentials(instanceUrl) {
  try {
    const raw = localStorage.getItem(APP_STORAGE_PREFIX + instanceUrl)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveAppCredentials(instanceUrl, creds) {
  localStorage.setItem(APP_STORAGE_PREFIX + instanceUrl, JSON.stringify(creds))
}

const CLIENT_NAME_KEY = 'mitra-client-name'

export function getClientName() {
  try {
    return localStorage.getItem(CLIENT_NAME_KEY) || 'Mitra'
  } catch {
    return 'Mitra'
  }
}

export function setClientName(name) {
  const trimmed = (name || 'Mitra').trim() || 'Mitra'
  localStorage.setItem(CLIENT_NAME_KEY, trimmed)
}

export function clearAppCredentials(instanceUrl) {
  localStorage.removeItem(APP_STORAGE_PREFIX + instanceUrl)
}

async function registerApp(instanceUrl, redirectUri) {
  const app = await apiFetch(instanceUrl, '/api/v1/apps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: getClientName(),
      redirect_uris: redirectUri,
      scopes: 'read write',
    }),
  })
  return { clientId: app.client_id, clientSecret: app.client_secret, redirectUri }
}

async function getOrRegisterApp(instanceUrl, redirectUri) {
  const cached = loadAppCredentials(instanceUrl)
  if (cached && cached.redirectUri === redirectUri) return cached
  const creds = await registerApp(instanceUrl, redirectUri)
  saveAppCredentials(instanceUrl, creds)
  return creds
}

/**
 * Step 1: register (or reuse) an app registration, then navigate the
 * browser to the instance's own hosted login page. The instance handles
 * the username/password entirely on its own origin — this app never sees
 * either.
 */
export async function beginLogin(rawInstanceUrl) {
  const instanceUrl = normalizeInstanceUrl(rawInstanceUrl)
  const redirectUri = getRedirectUri()
  const appCreds = await getOrRegisterApp(instanceUrl, redirectUri)

  sessionStorage.setItem(
    PENDING_LOGIN_KEY,
    JSON.stringify({ instanceUrl, clientId: appCreds.clientId, clientSecret: appCreds.clientSecret })
  )

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: appCreds.clientId,
    redirect_uri: redirectUri,
    scope: 'read write',
  })
  window.location.href = `${instanceUrl}/oauth/authorize?${params.toString()}`
}

export function getPendingLogin() {
  try {
    const raw = sessionStorage.getItem(PENDING_LOGIN_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function clearPendingLogin() {
  sessionStorage.removeItem(PENDING_LOGIN_KEY)
}

/**
 * Step 2: called after the instance redirects back here with ?code=...
 * Exchanges the code for an access token.
 */
export async function completeLogin(code) {
  const pending = getPendingLogin()
  if (!pending) {
    throw new Error('No login was in progress. Please start again.')
  }
  const { instanceUrl, clientId, clientSecret } = pending

  const tokenRes = await apiFetch(instanceUrl, '/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getRedirectUri(),
    }).toString(),
  })

  const token = tokenRes.access_token
  const [account, instance] = await Promise.all([
    apiFetch(instanceUrl, '/api/v1/accounts/verify_credentials', {
      headers: { Authorization: `Bearer ${token}` },
    }),
    fetchInstance(instanceUrl).catch(() => null),
  ])

  clearPendingLogin()
  const maxCharacters = instance?.configuration?.statuses?.max_characters || 500
  return { instanceUrl, token, account, maxCharacters }
}

export function fetchHomeTimeline(instanceUrl, token, { max_id } = {}) {
  const params = new URLSearchParams({ limit: '10' })
  if (max_id) params.set('max_id', max_id)
  return apiFetch(instanceUrl, `/api/v1/timelines/home?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function fetchPublicTimeline(instanceUrl, token, local, { max_id } = {}) {
  const params = new URLSearchParams({ limit: '30' })
  if (local) params.set('local', 'true')
  if (max_id) params.set('max_id', max_id)
  return apiFetch(instanceUrl, `/api/v1/timelines/public?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function fetchContext(instanceUrl, token, statusId) {
  return apiFetch(instanceUrl, `/api/v1/statuses/${statusId}/context`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function fetchNotifications(instanceUrl, token) {
  return apiFetch(instanceUrl, '/api/v1/notifications?limit=30', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// Read-position sync. timelines: array like ['home', 'notifications'].
export function fetchMarkers(instanceUrl, token, timelines) {
  const params = timelines.map((t) => `timeline[]=${t}`).join('&')
  return apiFetch(instanceUrl, `/api/v1/markers?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// data: { home?: { last_read_id }, notifications?: { last_read_id } }
export function updateMarker(instanceUrl, token, data) {
  return apiFetch(instanceUrl, '/api/v1/markers', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })
}

export function respondFollowRequest(instanceUrl, token, accountId, action) {
  // action: 'authorize' | 'reject'
  return apiFetch(instanceUrl, `/api/v1/follow_requests/${accountId}/${action}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function postStatus(instanceUrl, token, text, options = {}) {
  const { inReplyToId, visibility = 'public', mediaIds, quoteId, spoilerText, poll, idempotencyKey } = options
  const body = { status: text, visibility }
  if (inReplyToId) body.in_reply_to_id = inReplyToId
  if (quoteId) body.quote_id = quoteId
  if (mediaIds && mediaIds.length > 0) body.media_ids = mediaIds
  if (poll) body.poll = poll // { options: [...], expires_in (seconds), multiple }
  if (spoilerText) {
    body.sensitive = true
    body.spoiler_text = spoilerText
  }
  return apiFetch(instanceUrl, '/api/v1/statuses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // Same key = same post: protects against double-submits and
      // retry-after-timeout duplicates. Per draft, not per attempt.
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  })
}

/**
 * Uploads a file as a media attachment, for use in a later postStatus()
 * call via mediaIds. Uses the v2 endpoint, which can respond 202 while
 * still processing (video/audio transcoding) rather than handing back a
 * ready attachment immediately — in that case this polls the v1 status
 * endpoint briefly until it's ready.
 */
export async function uploadMedia(instanceUrl, token, file, description) {
  const form = new FormData()
  form.append('file', file)
  if (description) form.append('description', description)

  let res
  try {
    res = await fetch(`${instanceUrl}/api/v2/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
  } catch {
    throw new Error("Couldn't reach the instance to upload this file.")
  }

  if (!res.ok && res.status !== 202) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = body.error || detail
    } catch {
      // response wasn't JSON, keep statusText
    }
    throw new Error(`Upload failed: ${detail} (${res.status})`)
  }

  let attachment = await res.json()

  if (res.status === 202) {
    let ready = false
    let permanentFailure = false
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1200))
      let pollRes
      try {
        pollRes = await fetch(`${instanceUrl}/api/v1/media/${attachment.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      } catch {
        continue // transient network error — retry
      }
      if (pollRes.status === 200) {
        attachment = await pollRes.json()
        ready = true
        break
      }
      if (pollRes.status >= 400) {
        // 404 etc. won't resolve by retrying — stop early.
        permanentFailure = true
        break
      }
      // 202/206 — still processing, keep polling until attempts run out
    }
    if (!ready) {
      throw new Error(
        permanentFailure
          ? 'Upload failed on the server side.'
          : 'Upload is still processing. Please try again shortly.'
      )
    }
  }

  return attachment
}

export function setFavourited(instanceUrl, token, id, favourited) {
  const action = favourited ? 'unfavourite' : 'favourite'
  return apiFetch(instanceUrl, `/api/v1/statuses/${id}/${action}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function setReblogged(instanceUrl, token, id, reblogged) {
  const action = reblogged ? 'unreblog' : 'reblog'
  return apiFetch(instanceUrl, `/api/v1/statuses/${id}/${action}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function setBookmarked(instanceUrl, token, id, bookmarked) {
  const action = bookmarked ? 'unbookmark' : 'bookmark'
  return apiFetch(instanceUrl, `/api/v1/statuses/${id}/${action}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function fetchBookmarks(instanceUrl, token, { max_id } = {}) {
  const params = new URLSearchParams({ limit: '20' })
  if (max_id) params.set('max_id', max_id)
  return apiFetch(instanceUrl, `/api/v1/bookmarks?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function addReaction(instanceUrl, token, statusId, emoji) {
  return apiFetch(instanceUrl, `/api/v1/pleroma/statuses/${statusId}/reactions/${encodeURIComponent(emoji)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function removeReaction(instanceUrl, token, statusId, emoji) {
  return apiFetch(instanceUrl, `/api/v1/pleroma/statuses/${statusId}/reactions/${encodeURIComponent(emoji)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function fetchCustomEmojis(instanceUrl) {
  return apiFetch(instanceUrl, '/api/v1/custom_emojis')
}

export function fetchInstance(instanceUrl) {
  return apiFetch(instanceUrl, '/api/v2/instance')
}

// Returns { accounts, statuses, hashtags } — `type` narrows to
// 'accounts' | 'statuses' | null for everything.
export function search(instanceUrl, token, q, { type, limit = 20, offset = 0 } = {}) {
  const params = new URLSearchParams({ q, limit: String(limit), offset: String(offset) })
  if (type) params.set('type', type)
  return apiFetch(instanceUrl, `/api/v2/search?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// Public feed of posts carrying a given hashtag
export function fetchHashtagTimeline(instanceUrl, token, hashtag, { max_id } = {}) {
  const params = new URLSearchParams({ limit: '20' })
  if (max_id) params.set('max_id', max_id)
  return apiFetch(instanceUrl, `/api/v1/timelines/tag/${encodeURIComponent(hashtag)}?${params.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

// ---- Lists (Mitra "custom feeds", Mastodon-list-shaped) ----

export function fetchLists(instanceUrl, token) {
  return apiFetch(instanceUrl, '/api/v1/lists', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function createList(instanceUrl, token, title) {
  return apiFetch(instanceUrl, '/api/v1/lists', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title }),
  })
}

export function updateList(instanceUrl, token, id, title) {
  return apiFetch(instanceUrl, `/api/v1/lists/${id}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title }),
  })
}

export function deleteList(instanceUrl, token, id) {
  return apiFetch(instanceUrl, `/api/v1/lists/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function fetchListAccounts(instanceUrl, token, id) {
  // limit=0 means "all members"
  return apiFetch(instanceUrl, `/api/v1/lists/${id}/accounts?limit=0`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function addAccountsToList(instanceUrl, token, id, accountIds) {
  return apiFetch(instanceUrl, `/api/v1/lists/${id}/accounts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ account_ids: accountIds }),
  })
}

export function removeAccountsFromList(instanceUrl, token, id, accountIds) {
  const params = accountIds.map((id2) => `account_ids[]=${id2}`).join('&')
  return apiFetch(instanceUrl, `/api/v1/lists/${id}/accounts?${params}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function fetchListTimeline(instanceUrl, token, listId, { max_id } = {}) {
  const params = new URLSearchParams({ limit: '20' })
  if (max_id) params.set('max_id', max_id)
  return apiFetch(instanceUrl, `/api/v1/timelines/list/${listId}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// ---- Groups ----

// filter: 'admin' | 'member' — omit for all affiliated groups
export function fetchFollowedGroups(instanceUrl, token, { filter, offset = 0, limit = 40 } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (filter) params.set('filter', filter)
  return apiFetch(instanceUrl, `/api/v1/groups/followed?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function createGroup(instanceUrl, token, name, description) {
  const body = { name }
  if (description) body.description = description
  return apiFetch(instanceUrl, '/api/v1/groups', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

export function fetchGroupTimeline(instanceUrl, token, groupId, { max_id } = {}) {
  const params = new URLSearchParams({ limit: '20' })
  if (max_id) params.set('max_id', max_id)
  return apiFetch(instanceUrl, `/api/v1/timelines/group/${groupId}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// Read-only on Mitra: which remote notifications the instance filters out
export function fetchNotificationPolicy(instanceUrl, token) {
  return apiFetch(instanceUrl, '/api/v2/notifications/policy', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// Profile directory — returns Account[]. order: 'active' | 'new'
export function fetchDirectory(instanceUrl, token, { local = false, order = 'active', offset = 0, limit = 20 } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset), order })
  if (local) params.set('local', 'true')
  return apiFetch(instanceUrl, `/api/v1/directory?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function votePoll(instanceUrl, token, pollId, choices) {
  return apiFetch(instanceUrl, `/api/v1/polls/${pollId}/votes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ choices }),
  })
}

// Server-side posting defaults (SharedClientConfig). The visibility
// here seeds new posts and syncs across devices.
export function fetchPreferences(instanceUrl, token) {
  return apiFetch(instanceUrl, '/api/v1/preferences', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// Direct-message inbox: one entry per conversation thread, with
// participants and the most recent post. Read-only — Mitra has no
// delete/mark-read conversation endpoints.
export function fetchConversations(instanceUrl, token, { max_id } = {}) {
  const params = new URLSearchParams()
  if (max_id) params.set('max_id', max_id)
  const qs = params.toString()
  return apiFetch(instanceUrl, `/api/v1/conversations${qs ? `?${qs}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function deleteStatus(instanceUrl, token, id) {
  return apiFetch(instanceUrl, `/api/v1/statuses/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

// Pin/unpin one of the user's own posts to their profile.
export function setPinned(instanceUrl, token, id, pinned) {
  return apiFetch(instanceUrl, `/api/v1/statuses/${id}/${pinned ? 'pin' : 'unpin'}`, {
    method: pinned ? 'POST' : 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

// Raw source of a post as it was written — needed for editing, since the
// rendered content is HTML.
export function fetchStatusSource(instanceUrl, token, id) {
  return apiFetch(instanceUrl, `/api/v1/statuses/${id}/source`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// Mitra's StatusUpdateForm only takes status text (+ title/language/
// media_ids/sensitive); there is no spoiler_text field, so content
// warnings can't be changed through edits.
export function editStatus(instanceUrl, token, id, text) {
  return apiFetch(instanceUrl, `/api/v1/statuses/${id}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: text }),
  })
}

// --- Account portability ---

async function apiText(instanceUrl, path, options = {}) {
  let res
  try {
    res = await fetch(`${instanceUrl}${path}`, options)
  } catch {
    throw new Error("Couldn't reach that instance.")
  }
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.text()
}

export function exportFollowsCsv(instanceUrl, token) {
  return apiText(instanceUrl, '/api/v1/settings/export_follows', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function exportFollowersCsv(instanceUrl, token) {
  return apiText(instanceUrl, '/api/v1/settings/export_followers', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

function postSettingsJson(instanceUrl, token, path, body) {
  return apiFetch(instanceUrl, path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

export function importFollowsCsv(instanceUrl, token, csv) {
  return postSettingsJson(instanceUrl, token, '/api/v1/settings/import_follows', { follows_csv: csv })
}

export function importFollowersCsv(instanceUrl, token, csv) {
  return postSettingsJson(instanceUrl, token, '/api/v1/settings/import_followers', { followers_csv: csv })
}

export function addAlias(instanceUrl, token, acct) {
  return postSettingsJson(instanceUrl, token, '/api/v1/settings/aliases', { acct })
}

export function removeAlias(instanceUrl, token, actorId) {
  return postSettingsJson(instanceUrl, token, '/api/v1/settings/aliases/remove', { actor_id: actorId })
}

// Ask followers of this account to re-follow the target account
// (account migration). Irreversible.
export function moveFollowers(instanceUrl, token, targetAcct) {
  return postSettingsJson(instanceUrl, token, '/api/v1/settings/move_followers', { target_acct: targetAcct })
}

export function deleteAccount(instanceUrl, token) {
  return apiFetch(instanceUrl, '/api/v1/settings/delete_account', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
}

// --- Account security (settings module) ---

// Active OAuth tokens ("sessions"), oldest last. is_current marks the
// token this request was made with.
export function fetchSessions(instanceUrl, token) {
  return apiFetch(instanceUrl, '/api/v1/settings/sessions', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// Revoke a session by its token id. Revoking the current one logs out.
export function revokeSession(instanceUrl, token, sessionId) {
  return apiFetch(instanceUrl, `/api/v1/settings/sessions/${sessionId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function changePassword(instanceUrl, token, newPassword) {
  return apiFetch(instanceUrl, '/api/v1/settings/change_password', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ new_password: newPassword }),
  })
}

// Wipe every notification for the current account. Irreversible.
export function clearNotifications(instanceUrl, token) {
  return apiFetch(instanceUrl, '/api/v1/notifications', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function muteAccount(instanceUrl, token, accountId) {
  return apiFetch(instanceUrl, `/api/v1/accounts/${accountId}/mute`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function unmuteAccount(instanceUrl, token, accountId) {
  return apiFetch(instanceUrl, `/api/v1/accounts/${accountId}/unmute`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function fetchMutes(instanceUrl, token, { max_id } = {}) {
  const params = new URLSearchParams({ limit: '40' })
  if (max_id) params.set('max_id', max_id)
  return apiFetch(instanceUrl, `/api/v1/mutes?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function blockAccount(instanceUrl, token, accountId) {
  return apiFetch(instanceUrl, `/api/v1/accounts/${accountId}/block`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function fetchAccount(instanceUrl, accountId) {
  return apiFetch(instanceUrl, `/api/v1/accounts/${accountId}`)
}

// Partial profile update. Image fields (avatar/header) take raw base64
// strings plus a matching *_media_type; an empty string removes the
// image. fields_attributes is [{ name, value }].
export function updateCredentials(instanceUrl, token, fields) {
  return apiFetch(instanceUrl, '/api/v1/accounts/update_credentials', {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(fields),
  })
}

// Resolve an acct ("user" or "user@domain") to a full Account
export function lookupAccount(instanceUrl, token, acct) {
  const params = new URLSearchParams({ acct })
  return apiFetch(instanceUrl, `/api/v1/accounts/lookup?${params.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

export function fetchAccountStatuses(instanceUrl, token, accountId, { onlyMedia = false, excludeReplies = false, excludeReblogs = false, pinned = false, max_id } = {}) {
  const params = new URLSearchParams({ limit: '20' })
  if (onlyMedia) params.set('only_media', 'true')
  if (excludeReblogs) params.set('exclude_reblogs', 'true')
  if (pinned) params.set('pinned', 'true')
  if (max_id) params.set('max_id', max_id)
  // For replies: Mastodon includes replies by default when the param is absent,
  // but some servers (Mitra) default to excluding them. Send the param explicitly.
  params.set('exclude_replies', excludeReplies ? 'true' : 'false')
  return apiFetch(instanceUrl, `/api/v1/accounts/${accountId}/statuses?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function fetchRelationships(instanceUrl, token, accountIds) {
  const params = accountIds.map((id) => `id[]=${id}`).join('&')
  return apiFetch(instanceUrl, `/api/v1/accounts/relationships?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function followAccount(instanceUrl, token, accountId) {
  return apiFetch(instanceUrl, `/api/v1/accounts/${accountId}/follow`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function unfollowAccount(instanceUrl, token, accountId) {
  return apiFetch(instanceUrl, `/api/v1/accounts/${accountId}/unfollow`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function fetchMediaAttachment(instanceUrl, token, mediaId) {
  return apiFetch(instanceUrl, `/api/v1/media/${mediaId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}
