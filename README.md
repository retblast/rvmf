# Mitra Frontend (GNOME/Adwaita Style)

A GNOME/Adwaita-styled Mitra (ActivityPub) client built with React 18 + Vite 5. Uses the Adwaita design language throughout — header bar with pill-style view switcher, flat divided timeline lists framed in cards, overlay scrollbars, and accent-colored active states. Theme follows your OS light/dark preference automatically, with a manual three-way toggle (System / Light / Dark) in settings.

Logs into a real Mitra or Mastodon-compatible instance via OAuth and loads your actual home timeline.

## Features

### Core

- **OAuth login** — standard authorization code flow. You enter credentials on the instance's own page; your password is never seen or stored by this app.
- **Home timeline** with boost unwrapping, infinite scroll (IntersectionObserver), and per-post favouriting/boosting.
- **Thread view** — every post opens a slide-out panel (medium tier) or permanent column (wide tier) with the full ancestor + descendant tree from `/context`, built into a nested tree client-side. Auto-refreshes every 5 seconds.
- **Explore** — federated and local public timelines with a toggle.
- **Notifications** — follows, follow requests (accept/reject), boosts, favourites, mentions, emoji reactions. Auto-refreshes every 5 seconds when visible. Always reloads on tab switch.

### Compose & Reply

- **New post** — modal dialog with character count (server-reported `max_characters` from `/api/v2/instance`, default 500), content warning toggle, visibility selector (Public / Unlisted / Followers only / Direct), media upload (up to 4 files with live thumbnails), image paste from clipboard, and Ctrl+Enter to submit.
- **Reply** — inline composer inside the thread panel. Inherits the parent post's visibility. Shows a preview of the post being replied to. Stays open in the thread after posting and scrolls to the new reply with a highlight animation.
- **Quote** — boost dropdown includes a "Quote" option that opens the compose dialog with the quoted post attached.

### Posts & Interactions

- **Media** — images, video, GIFV, audio playback. Hover previews (toggleable in settings), full-screen lightbox with keyboard navigation (arrow keys), sensitive content blur with click-to-reveal.
- **Polls** — display results with vote counts and progress bars, vote on active polls.
- **Emoji reactions** — Pleroma/Akkoma `emoji_reactions` support with a reaction picker (common emoji + custom server emoji). Custom emoji render inline with hover-to-zoom.
- **Boost dropdown** — boost or quote a post, with boosted state indicated.
- **Post options menu** — copy link, delete own posts, mute account, block account.

### User Profiles

- **Profile view** — click any username, handle, or avatar to open the profile. Shows header image, avatar overlapping the banner, display name, handle, bio (HTML rendered), and stats (posts / following / followers).
- **Follow indicators** — "Mutual" badge when both users follow each other, "Follows you" badge when the viewed user follows you.
- **Follow / unfollow** button on other users' profiles.
- **Posts / Media tabs** with infinite scroll.
- **Back to timeline** button overlaid on the header image with a translucent scrim.

### Settings

- **Media hover previews** — toggle on/off, persisted to localStorage.
- **Theme** — System / Light / Dark three-way toggle, persisted to localStorage. Uses `@media (prefers-color-scheme)` for system mode and `[data-theme]` attributes for manual overrides.
- **Sent from** — configurable client name (default "Mitra"). This is the `client_name` used in the OAuth app registration, which the server displays as "posted via X" on your posts. Changing it clears the cached app credentials and logs you out so the next login re-registers with the new name.

### Layout & UX

- **Three responsive tiers:**
  - **Wide** (≥1400px) — 3-column grid: notifications | timeline | thread. All columns always visible.
  - **Medium** (900–1399px) — timeline with a sliding thread panel from the right (CSS transition, 0 → `min(460px, 40vw)`).
  - **Narrow** (<900px) — thread replaces the timeline in-place with a back button.
- **Keyboard accessible** — focus-visible outlines on all interactive elements.
- **Overlay scrollbars** — Adwaita-style thin scrollbars that appear on hover.
- **Animated thread loading** — Framer Motion stagger animations for ancestors (converge down), focal post (slide from left), and replies (converge up).

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

## Project structure

```
src/
  App.jsx              All UI components (header bar, timeline, post rows,
                       thread panel, notifications, compose dialog, profile
                       view, reaction picker, media lightbox, polls, etc.)
                       and all app state (timeline, notifications, side panel,
                       profile view, layout tier). ~2900 lines.

  LoginView.jsx        Login screen — instance URL input + login button.

  useMitraSession.js   React hook for auth state. Handles OAuth redirect
                       detection (?code= param), session persistence in
                       localStorage, and fetching instance config on
                       first login or when maxCharacters is missing.

  lib/
    mitra.js           API client. OAuth flow (registerApp, beginLogin,
                       completeLogin), timeline endpoints (home, public,
                       context), status actions (post, favourite, boost,
                       delete, vote poll, reactions), account actions
                       (follow, unfollow, mute, block, relationships,
                       fetch account/statuses), media upload with polling,
                       and utility functions (custom emojis, instance info).
                       All calls go through apiFetch() which handles JSON
                       parsing, error wrapping, and 204 No Content.

  adwaita.css          Design tokens (CSS custom properties for colors,
                       radii, fonts), light/dark/system theme rules,
                       and component styles (headerbar, view switcher,
                       post rows, thread panel, compose dialog, media
                       grid, lightbox, reactions, polls, profile view,
                       settings menu, overlay scrollbars, etc.).

  main.jsx             React entry point — renders <App /> into #root.
```

## API endpoints used

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/v1/apps` | POST | Register OAuth app |
| `/oauth/token` | POST | Exchange auth code for token |
| `/api/v1/accounts/verify_credentials` | GET | Get current user info |
| `/api/v2/instance` | GET | Get instance config (character limit) |
| `/api/v1/timelines/home` | GET | Home timeline (paginated) |
| `/api/v1/timelines/public` | GET | Public timeline (federated/local) |
| `/api/v1/statuses/:id/context` | GET | Thread ancestors + descendants |
| `/api/v1/statuses` | POST | Create post / reply |
| `/api/v1/statuses/:id` | DELETE | Delete own post |
| `/api/v1/statuses/:id/favourite` | POST | Favourite / unfavourite |
| `/api/v1/statuses/:id/reblog` | POST | Boost / unboost |
| `/api/v1/polls/:id/votes` | POST | Vote on poll |
| `/api/v1/pleroma/statuses/:id/reactions/:emoji` | PUT/DELETE | Add/remove reaction |
| `/api/v1/accounts/:id` | GET | Fetch user profile |
| `/api/v1/accounts/:id/statuses` | GET | Fetch user's posts |
| `/api/v1/accounts/relationships` | GET | Check follow relationships |
| `/api/v1/accounts/:id/follow` | POST | Follow account |
| `/api/v1/accounts/:id/unfollow` | POST | Unfollow account |
| `/api/v1/accounts/:id/mute` | POST | Mute account |
| `/api/v1/accounts/:id/block` | POST | Block account |
| `/api/v1/notifications` | GET | Fetch notifications |
| `/api/v1/follow_requests/:id/authorize` | POST | Accept follow request |
| `/api/v1/follow_requests/:id/reject` | POST | Reject follow request |
| `/api/v2/media` | POST | Upload media attachment |
| `/api/v1/media/:id` | GET | Poll upload status |
| `/api/v1/custom_emojis` | GET | Fetch custom emoji list |
