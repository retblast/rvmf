# rvmf — Retblast's Vibecoded Mitra Frontend

A GNOME/Adwaita-styled Mitra (ActivityPub) client built with React 18 + Vite 5. Uses the Adwaita design language throughout — header bar with pill-style view switcher, flat divided timeline lists framed in cards, overlay scrollbars, and accent-colored active states. Theme follows your OS light/dark preference automatically, with a manual three-way toggle (System / Light / Dark) in settings.

Logs into a real Mitra or Mastodon-compatible instance via OAuth and loads your actual home timeline.

## Why

I built this project because I had stumbled upon the fediverse (need to host an instance someday...) and, because I like Rust, decided to search if there was a server impementation that was written in Rust, and Mitra is exactly that.

There's multiple compatible frontends but most of them don't functionally or aesthetically really please me, and I also remembered that there's this cool thing called "vibecoding" (this project is completely vibecoded, btw) that I haven't really done as a standalone project yet. So, I decided to build this for myself. I also use Linux (NixOS) with GNOME as my DE, so I decided to style it somewhat after Adwaita, GNOME's UI/UX (which I actually need to reconcile eventually haha) language.

Now, there's a little story on how I built it:

- Claude Sonnet 5 built the first iterations of the project (I hadn't used version control yet)
- ChatGPT 5.6 Luna fixed one bug
- Afterwards, I used OpenCode with the Big Pickle and Ox Alpha Free (Unlimited) models

A key theme is that I don't have money for a subscription to any service, so all the LLMs/services I've used are on their respective Free tiers.

## TODO

- Testing using the Nix flake. Deploy a local Mitra instance, fill it with various kinds of data, to test the UI (been doing it manually... not very fun.)
- Make the LLMs eat up the GNOME HIG and whatever related resources to overhaul the look and feel of the app.
- Wire up testing for all the features we have

## Features

### Core

- **Home timeline** with boost unwrapping, infinite scroll (IntersectionObserver), per-post favouriting/boosting/bookmarking, and pull-to-refresh.
- **Thread view** — every post opens a thread panel (slide-out at medium width, permanent column when wide, in-place swap on narrow) with the full ancestor + descendant tree from `/context`, built into a nested tree client-side. Auto-refreshes every 5 seconds. Replies compose inline beneath the post being replied to; after posting, the reply is inserted into the tree immediately and scrolled into view.
- **Explore** — federated and local public timelines, plus a profile directory ("People") with infinite scroll.
- **Search** — debounced search across people, posts, and hashtags (`/api/v2/search`), with display tabs that filter results. Works around Mitra's untyped-search parser by sending typed requests per category.
- **Notifications** — follows, follow requests (accept/reject), boosts, favourites, mentions, emoji reactions, quotes, edits. Auto-refreshes every 5 seconds while visible. Unread badge driven by the server-side markers API so the read position syncs across devices. Clear-all supported.
- **Messages** — direct-message inbox: one row per conversation with participants and a snippet of the latest post. Clicking opens that post's thread.
- **Lists** — create, rename, delete lists (Mitra custom feeds); add/remove members from any profile; per-list timelines.
- **Groups** — browse your followed groups, open their timelines, and create new ones.
- **Bookmarks** — dedicated bookmarks view with infinite scroll; unbookmarking removes the row.
- **Hashtags** — hashtag links inside posts open the tag's public feed inline, with back navigation.

### Compose & Reply

- **New post** — modal dialog with server-reported character limit (`max_characters` from `/api/v2/instance`, default 500), content warning toggle, visibility selector (Public / Unlisted / Followers only / Direct — non-standard values like `subscribers` still display), media upload (up to 4 files with live thumbnails, uploads start immediately and are tracked independently), image paste from clipboard, emoji picker, and Ctrl+Enter to submit.
- **Polls** — build polls in the composer: 2–8 options, duration presets, multiple-choice support. Polls and media attachments are mutually exclusive.
- **Emoji** — `:shortcode:` autocomplete while typing, plus a picker with common unicode emoji and your instance's custom emoji. Custom emoji render inline everywhere (names, post text, reactions).
- **Idempotent posting** — every draft carries an `Idempotency-Key`, so double-submits and retry-after-timeout can't create duplicate posts.
- **Reply** — inline composer inside the thread panel beneath the target post. Inherits the parent post's visibility by default. Shows a preview of the post being replied to.
- **Quote** — boost dropdown includes a "Quote" option that opens the compose dialog with the quoted post attached.
- **Default visibility** — seeded from server preferences (`posting:default:visibility`) and persisted back via `update_credentials`, so it applies across devices and clients.

### Posts & Interactions

- **Media** — images, video, GIFV, audio playback. Full-screen lightbox with keyboard navigation (arrows, Escape). Sensitive content blur with click-to-reveal.
- **Media resilience** — images decode from blurhash placeholders while loading; remote media falls back through signed-proxy URL decoding, original-origin recovery, and ActivityPub document lookup when proxies break. The dev server proxies all media to sidestep CORS.
- **Quarantined-image recovery** — when an instance disables inline embedding of remote media, image links are extracted back out of the post text and rendered as blurred attachments again.
- **Polls** — vote on active polls; results show percentages, your choices highlighted, voter counts, and time remaining.
- **Emoji reactions** — Pleroma/Akkoma-style `emoji_reactions` with a picker (common emoji + custom server emoji).
- **Boost dropdown** — boost or quote; boosts are hidden for followers-only/direct/subscribers posts since servers reject them.
- **Edit & delete own posts** — editing loads the raw source (not rendered HTML) and PUTs it back; edited posts show an "(edited)" marker.
- **Pin/unpin own posts** to your profile.
- **Post options menu** — copy link, mute account, block account.
- **Hide/show media** per post without leaving the timeline.

### Profiles

- **Profile view** — header banner, overlapping avatar, display name (with custom emoji), handle, bio, stats, and follow indicators ("Mutual", "Follows you").
- **Follow / unfollow**, plus a per-profile list-membership dropdown (checkboxes for each of your lists).
- **Tabs** — Posts (top-level), Posts & Replies, Pinned, Media — all with infinite scroll.
- **Edit profile** (own) — avatar/header upload (base64), display name, bio, protected/bot toggles, and up to 6 profile fields.

### Account management

Reached from the settings menu:

- **Password change**.
- **Active sessions** — every OAuth token logged into the account, current one pinned on top; revoke any (revoking the current one logs out).
- **Portability** — export follows/followers as CSV, import them back, manage aliases, and move followers to a new account (type-to-confirm; irreversible).

### Settings

- **Fetch media directly** — route media through blob fetching with caching (on by default), or fall back to plain proxied URLs.
- **Mark all media as sensitive** — strict mode that blurs everything; sub-toggle lets hover previews peek behind CWs (muted video peek included).
- **Use system accent color** — inherits the OS/browser accent, ignoring known browser default blues so nothing gets painted over pointlessly.
- **Theme** — System / Light / Dark three-way toggle.
- **Sent from** — configurable client name used in OAuth registration ("posted via X"); changing it re-registers the app on next login.
- **Muted accounts** manager with one-click unmute.
- Server notification policy displayed read-only.

### Layout & UX

- **Three responsive tiers:**
  - **Wide** (≥1400px) — 3-column grid: notifications | content | thread. All always visible.
  - **Medium** (900–1399px) — content area plus a sliding thread panel from the right.
  - **Narrow** (<900px) — thread replaces the content in-place with a back button.
- **Escape closes the topmost popup**, innermost first (pickers → dropdowns → dialogs → panel).
- **Instance identity** — tab favicon and headerbar icon follow the logged-in instance; the login screen recognizes instances as you type and shows their favicon.
- **Error boundaries** — one broken section degrades to a local "Try again" instead of blanking the app.
- **Animated thread loading** — Framer Motion staggers ancestors converging down toward the focal post, replies converging up.
- Keyboard-accessible throughout (`focus-visible` outlines), Adwaita-style overlay scrollbars.

## How login works

Mitra speaks a Mastodon-compatible API. This app uses the standard OAuth **authorization code** flow:

1. On first login, the app registers itself (`POST /api/v1/apps`) with the configured client name and caches credentials in `localStorage`
2. Your browser is redirected to `{instance}/oauth/authorize` — a page hosted by your Mitra instance
3. The instance redirects back with a one-time `code`, exchanged for an access token
4. The token, account info, and server-reported character limit are stored in `localStorage`

Your password is never seen by or stored in this app.

**CORS note:** as of Mitra 5.0 (March 2026), instances allow cross-origin requests by default.

## Run it

### With Nix (flake)

```bash
nix develop
npm run dev
```

### Without Nix

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

The dev server also runs a `/media-proxy` middleware (with SSRF guards) that fetches remote media with CORS headers, forwarding Authorization headers upstream.

## Project structure

```
src/
  App.jsx              Root component and all app state: view switching,
                       timelines, notifications + read markers, side panel,
                       settings, layout tiers (~1600 lines).

  hooks.js             Cross-cutting React hooks and contexts: app settings
                       context, single-reaction-picker context, blob-caching
                       media fetcher (LRU cache, negative cache for dead
                       URLs, inflight dedupe), layout tier detection,
                       pull-to-refresh, close-on-Escape.

  useMitraSession.js   Auth state hook. Handles OAuth redirect detection
                       (?code= param), session persistence, instance config
                       fetch on restore.

  LoginView.jsx        Login screen — instance URL input with live
                       instance recognition and favicon preview.

  main.jsx             Entry point — renders <App /> and applies the OS
                       accent color.

  components/
    Post.jsx           PostRow (timeline rows incl. boost unwrapping),
                     ThreadReply (one reply at any depth, full action
                     row), NotificationRow, QuoteCard, PollCard,
                     BoostDropdown, PostOptionsMenu, ReactionChips,
                     ReactionPicker.

    Media.jsx          Avatar (initials fallback), ProxiedImg (media
                     escalation ladder: origin -> proxy -> emoji registry ->
                     placeholder), MediaGrid with CW blur + spoiler peek,
                     blurhash placeholders, MediaLightbox.

    Compose.jsx        ComposeDialog (new post), EditDialog, media upload
                     hook + thumbnail strip, poll draft state + editor,
                     visibility select, char counter, parent-post previews.

    ReplyComposer.jsx  Inline reply composer sharing the compose building
                     blocks.

    ThreadPanel.jsx    Thread content shared by all three layout tiers:
                     ancestors, focal post, nested reply tree, inline
                     composers, staggered animations.

    ProfileView.jsx    Profile header, follow state, badges, tabs,
                     infinite-scroll statuses, per-profile lists menu.

    ProfileEdit.jsx    Own-profile editor: images, bio, flags, fields.

    SearchView.jsx     Debounced search across accounts, statuses,
                     hashtags with category tabs.

    HashtagFeed.jsx    Public timeline for one hashtag.

    ListsView.jsx      List CRUD + per-list feed.

    GroupsView.jsx     Followed groups, group feeds, group creation.

    ConversationsView.jsx  Direct-message inbox.

    MutedAccountsView.jsx  Muted accounts with unmute.

    AccountSettingsView.jsx  Password change, session revocation,
                     portability card (export/import CSV, aliases,
                     follower migration).

    Emoji.jsx          Emoji autocomplete hook, dropdown, picker,
                     shortcode tables.

    InstanceIcon.jsx   Instance favicon with fallback glyph.

    ErrorBoundary.jsx  Per-section crash containment.

  lib/
    mitra.js           API client. Everything the app does against the
                     instance lives here, through apiFetch() which handles
                     JSON parsing, error wrapping, and 204 No Content.

    render.jsx         HTML-to-plaintext conversion preserving links as
                     markdown tokens, safe rich-text rendering (mentions,
                     hashtags, URLs, custom emoji — no dangerouslySetInnerHTML),
                     reply tree helpers, Mitra signed-proxy URL decoding,
                     quarantined-image recovery.

    blurhash.js        Minimal pure-JS blurhash decoder for placeholders.

    osAccent.js        OS/browser accent color detection and application;
                     ignores known browser default blues.

    emojiRegistry.js   Per-instance custom-emoji registry cache, used to
                     rescue dead emoji URLs.

  adwaita.css          Design tokens, light/dark/system themes, OS accent
                       overrides, and all component styles.
```

## API endpoints used

All calls go through the client in `src/lib/mitra.js`.

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/v1/apps` | POST | Register OAuth app |
| `/oauth/token` | POST | Exchange auth code for token |
| `/api/v1/accounts/verify_credentials` | GET | Get current user info |
| `/api/v2/instance` | GET | Instance config (character limit) |
| `/api/v1/instance` | GET | Instance recognition on login screen |
| `/api/v1/timelines/home` | GET | Home timeline (paginated) |
| `/api/v1/timelines/public` | GET | Public timeline (federated/local) |
| `/api/v1/timelines/tag/:hashtag` | GET | Hashtag feed |
| `/api/v1/timelines/list/:id` | GET | List timeline |
| `/api/v1/timelines/group/:id` | GET | Group timeline |
| `/api/v1/statuses/:id/context` | GET | Thread ancestors + descendants |
| `/api/v1/statuses/:id/source` | GET | Raw source for editing |
| `/api/v1/statuses` | POST | Create post/reply (supports `Idempotency-Key`) |
| `/api/v1/statuses/:id` | PUT | Edit post text |
| `/api/v1/statuses/:id` | DELETE | Delete own post |
| `/api/v1/statuses/:id/favourite` | POST | Favourite |
| `/api/v1/statuses/:id/unfavourite` | POST | Unfavourite |
| `/api/v1/statuses/:id/reblog` | POST | Boost |
| `/api/v1/statuses/:id/unreblog` | POST | Unboost |
| `/api/v1/statuses/:id/bookmark` | POST | Bookmark |
| `/api/v1/statuses/:id/unbookmark` | POST | Unbookmark |
| `/api/v1/statuses/:id/pin` | POST | Pin to profile |
| `/api/v1/statuses/:id/pin` | DELETE | Unpin from profile |
| `/api/v1/pleroma/statuses/:id/reactions/:emoji` | PUT | Add emoji reaction |
| `/api/v1/pleroma/statuses/:id/reactions/:emoji` | DELETE | Remove emoji reaction |
| `/api/v1/polls/:id/votes` | POST | Vote on poll |
| `/api/v1/bookmarks` | GET | Bookmarks (paginated) |
| `/api/v1/custom_emojis` | GET | Custom emoji list |
| `/api/v2/search` | GET | Search accounts/statuses/hashtags |
| `/api/v1/markers` | GET | Read positions (notifications) |
| `/api/v1/markers` | POST | Update read positions |
| `/api/v1/notifications` | GET | Notifications |
| `/api/v1/notifications` | DELETE | Clear all notifications |
| `/api/v2/notifications/policy` | GET | Server filter policy (read-only display) |
| `/api/v1/follow_requests/:id/authorize` | POST | Accept follow request |
| `/api/v1/follow_requests/:id/reject` | POST | Reject follow request |
| `/api/v1/lists` | GET | List all lists |
| `/api/v1/lists` | POST | Create list |
| `/api/v1/lists/:id` | PUT | Rename list |
| `/api/v1/lists/:id` | DELETE | Delete list |
| `/api/v1/lists/:id/accounts?limit=0` | GET | List members |
| `/api/v1/lists/:id/accounts` | POST | Add members |
| `/api/v1/lists/:id/accounts` | DELETE | Remove members |
| `/api/v1/groups/followed` | GET | Followed groups |
| `/api/v1/groups` | POST | Create group |
| `/api/v1/directory` | GET | Profile directory (Explore > People) |
| `/api/v1/conversations` | GET | DM conversations |
| `/api/v1/mutes` | GET | Muted accounts (paginated) |
| `/api/v1/accounts/:id/mute` | POST | Mute account |
| `/api/v1/accounts/:id/unmute` | POST | Unmute account |
| `/api/v1/accounts/:id/block` | POST | Block account |
| `/api/v1/accounts/:id/follow` | POST | Follow account |
| `/api/v1/accounts/:id/unfollow` | POST | Unfollow account |
| `/api/v1/accounts/:id` | GET | Fetch profile |
| `/api/v1/accounts/:id/statuses` | GET | Profile statuses (tabs/pagination) |
| `/api/v1/accounts/relationships` | GET | Follow relationships |
| `/api/v1/accounts/lookup` | GET | Resolve acct to account |
| `/api/v1/accounts/update_credentials` | PATCH | Update own profile (also default visibility) |
| `/api/v2/media` | POST | Upload media attachment |
| `/api/v1/media/:id` | GET | Poll upload status / resolve URLs |
| `/api/v1/preferences` | GET | Posting defaults |
| `/api/v1/settings/change_password` | POST | Change password |
| `/api/v1/settings/sessions` | GET | Active sessions |
| `/api/v1/settings/sessions/:id` | DELETE | Revoke session |
| `/api/v1/settings/export_follows` | GET | Export follows CSV |
| `/api/v1/settings/export_followers` | GET | Export followers CSV |
| `/api/v1/settings/import_follows` | POST | Import follows CSV |
| `/api/v1/settings/import_followers` | POST | Import followers CSV |
| `/api/v1/settings/aliases` | POST | Add alias |
| `/api/v1/settings/aliases/remove` | POST | Remove alias |
| `/api/v1/settings/move_followers` | POST | Move followers (migration) |
| `/api/v1/settings/delete_account` | POST | Delete account (type-to-confirm; logs out after) |
