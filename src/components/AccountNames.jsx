// The text half of the avatar + name + handle trio that every account
// list renders — explore, search, group members, muted accounts, profile
// people lists, the favourite/boost popovers, the mention autocomplete,
// account settings. One home for the pattern means identity or privacy
// display changes stay one-file instead of eight.

export function AccountNames({ account, clickable = false }) {
  const nameClass = `post-name${clickable ? ' clickable' : ''}`
  return (
    <>
      <span className={nameClass}>{account.display_name || account.username}</span>
      <span className="post-handle">@{account.acct || account.username}</span>
    </>
  )
}
