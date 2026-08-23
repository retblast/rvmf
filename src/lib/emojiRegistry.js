import * as mitra from './mitra'

// Instance-wide custom-emoji registry (/api/v1/custom_emojis), cached per
// session. Used as a rescue path when an embedded emoji URL is dead: the
// registry may hold fresher URLs than what old posts/profiles reference
// (e.g. after an admin re-uploaded or pruned media).
const registries = new Map() // instanceUrl -> Promise<Map<shortcode, url>>

export function lookupEmojiUrl(instanceUrl, shortcode) {
  if (!registries.has(instanceUrl)) {
    registries.set(
      instanceUrl,
      mitra
        .fetchCustomEmojis(instanceUrl)
        .then((list) => {
          const map = new Map()
          for (const emoji of list || []) {
            map.set(emoji.shortcode, emoji.static_url || emoji.url)
          }
          return map
        })
        .catch(() => {
          registries.delete(instanceUrl)
          return new Map()
        })
    )
  }
  return registries.get(instanceUrl).then((map) => map.get(shortcode) || null)
}
