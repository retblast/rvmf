# Mitra Frontend (GNOME/Adwaita Style)

A GNOME-styled Mitra (ActivityPub) client built with React + Vite. Header bar with an Adwaita view switcher (Home / Notifications / Explore) and a flat, divided timeline list framed in a card, matching the GTK4 list-view treatment used by apps like Tuba and Fractal. Theme follows your OS light/dark setting automatically.

Logs into a real Mitra instance and loads your actual home timeline.

## Features

- **Login** via standard OAuth authorization code flow — you enter credentials on the instance's own page, never in this app
- **Home timeline** with boost unwrapping, infinite scroll, and per-post favouriting/boosting
- **Threaded replies** — every post opens the same slide-out panel with full ancestor + descendant tree from `/context`, built into a nested tree client-side
- **Compose** with character count (500 limit), content warning toggle, visibility selector (public/unlisted/private/direct), media upload (up to 4 files, live thumbnails), and image paste from clipboard
- **Media** — images, video, GIFV, audio; hover previews (toggleable in settings), full lightbox, sensitive content blur with click-to-reveal
- **Polls** — display results with vote counts, vote on active polls
- **Emoji reactions** — pleroma.emoji_reactions support with reaction picker (common + custom emoji)
- **Notifications** — follows, follow requests (accept/reject), boosts, favourites, mentions, emoji reactions; always refreshes on tab switch
- **Post options** — copy link, delete own posts, mute/block other accounts
- **Boost dropdown** — boost or quote a post
- **Explore** — federated and local public timelines
- **Dark/light/system theme** — three-way toggle in settings, persisted to localStorage
- **Responsive layout** — three tiers (wide 3-pane, medium slide-out panel, narrow in-place thread)
- **Keyboard accessible** — focus-visible styles on all interactive elements

## How login works

Mitra speaks a Mastodon-compatible API. This app uses the standard OAuth **authorization code** flow:

1. On first login, the app registers itself (`POST /api/v1/apps`) and caches credentials in `localStorage`
2. Your browser is redirected to `{instance}/oauth/authorize` — a page hosted by your Mitra instance
3. The instance redirects back with a one-time `code`, exchanged for an access token
4. The token and account info are stored in `localStorage`

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

## Structure

- `src/App.jsx` — all components (header bar, timeline, posts, compose, thread panel, notifications, etc.)
- `src/LoginView.jsx` — login screen
- `src/useMitraSession.js` — auth state and OAuth redirect handling
- `src/lib/mitra.js` — API client (OAuth flow + Mastodon-compatible REST calls)
- `src/adwaita.css` — design tokens and component styles (light/dark themes)
- `src/main.jsx` — React entry point
