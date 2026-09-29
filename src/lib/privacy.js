// Privacy mode: masks the logged-in user's identity at display sites.
//
// `maskAccount` returns a display-safe shallow copy when the account IS
// the current user and masking is enabled; everyone else passes through
// untouched (same reference — the app's fairness rule: only you are
// hidden). The copy keeps `id` (and `url`) so profile navigation,
// relationship checks, and other logic keep working — only the strings a
// person could read are replaced.

export const MASKED_NAME = 'You'
export const MASKED_USERNAME = 'you'

export function maskAccount(account, selfId, enabled) {
  if (!enabled || !account || account.id == null) return account
  if (account.id !== selfId) return account
  return {
    ...account,
    display_name: MASKED_NAME,
    username: MASKED_USERNAME,
    acct: MASKED_USERNAME,
    avatar: null,
    avatar_static: null,
    // Bio and profile fields routinely carry real names/links — they go
    // with the identity, not with the user's content.
    note: '',
    fields: [],
  }
}
