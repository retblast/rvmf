# Mitra frontend (GNOME/Adwaita style)

A GNOME-styled Mitra (ActivityPub) client. Header bar with an Adwaita view
switcher (Home / Notifications / Explore) and a flat, divided timeline list
framed in a card, matching the GTK4 list-view treatment used by apps like
Tuba and Fractal. Theme follows your OS light/dark setting automatically.

Logs into a real Mitra instance and loads your actual home timeline —
no more mock data.

## How login works

Mitra speaks a Mastodon-compatible API. This app uses the standard OAuth
**authorization code** flow — the same one clients like Phanpy use:

1. On first login to an instance, the app registers itself
   (`POST /api/v1/apps`) and caches the returned `client_id`/`client_secret`
   in `localStorage`.
2. Your browser is redirected to `{instance}/oauth/authorize`, a page
   **hosted and rendered by your Mitra instance itself**. You type your
   username and password there, not in this app.
3. The instance redirects back here with a one-time `code`, which gets
   exchanged for an access token (`POST /oauth/token`).
4. The token and your account info are stored in `localStorage` so you
   stay logged in across reloads.

Your password is never seen by, sent to, or stored by this app's code —
it only ever goes to your instance, on the instance's own page.

**CORS note:** as of Mitra 5.0 (March 2026), instances allow cross-origin
requests from any origin by default, so this should just work. If you're
on an older or reconfigured instance and the *first* step fails with a
network error, the instance needs `http_cors_allow_all: true` (or an
allowlist entry for this origin) in `config.yaml`.

## Run it

### With Nix (flake)

```bash
nix develop
npm run dev
```

`nix develop` drops you into a shell with Node 22 + npm and runs
`npm install` automatically on first entry. If you use direnv, `direnv allow`
once and it activates on `cd` from then on.

The flake's `packages.default` (`nix build`) is there for a production
build, but its `npmDepsHash` is a placeholder (`lib.fakeHash`) — Nix will
tell you the real hash on first build failure; paste it in and rebuild.
That step isn't needed for `nix develop`, only for `nix build`.

### Without Nix

```bash
npm install
npm run dev
```

Then open the printed local URL (defaults to http://localhost:5173).

## Structure

- `src/App.jsx` — layout and components (header bar, view switcher, timeline, post rows, compose dialog)
- `src/LoginView.jsx` — login screen (just the instance address — credentials happen on the instance's own page)
- `src/useMitraSession.js` — auth state, persisted to `localStorage`, and handling the OAuth redirect back from the instance
- `src/lib/mitra.js` — the API client (OAuth authorization_code flow + Mastodon-compatible REST calls)
- `src/adwaita.css` — design tokens (Adwaita color values, light/dark) and component styles
- `src/main.jsx` — React entry point

## What's wired up

- Login against a real instance (OAuth authorization_code flow — you log in on the instance's own page)
- Home timeline, loaded from `/api/v1/timelines/home`, with boosts correctly unwrapped (shows the original post + a "so-and-so boosted" line, not an empty post from the booster)
- Favourite / boost, calling the real endpoints and updating counts live
- Posting a new status via the compose dialog, with media attachments (see below) and, for replies, the parent post's visibility (see below)
- Replies, via `/api/v1/statuses/:id/context` — **all threads now open the same way: the slide-out panel, always**, at every depth (the OP, a reply, a reply to a reply). There's no more inline accordion in the timeline itself.
  - `/context` returns the *entire* descendant tree in one call, not just direct replies — this app now builds that into a real nested tree client-side (`buildReplyTree` in `App.jsx`) and renders it fully expanded, rather than lazily fetching one level at a time. That's the fix for replies/ancestors not fully showing before.
  - Every open refetches fresh rather than relying on a stale cache, so what's shown is actually current
  - Clicking a reply's body re-opens the panel focused on it specifically (fresh ancestors, in case there's more context above what's already visible)
- Media attachments: images, video, GIFs (Mastodon-style silent looping "gifv"), and audio, on both top-level posts and replies at any depth
  - Images and video open a larger preview that follows the cursor on hover, before you even click
  - Images open full-size in a lightbox on click
  - Multiple images/video in one post lay out in a grid (1/2/3/4-up)
  - Posts marked sensitive show a blurred content-warning overlay with the spoiler text, click to reveal
  - Attachment types this doesn't recognize fall back to a plain download-style link
- **Uploading your own media** when composing or replying: an attach button opens a file picker (up to 4 files), each uploads immediately on selection (`POST /api/v2/media`, polling `/api/v1/media/:id` if the server needs to process it first — video/audio transcoding), with live thumbnails and per-file remove buttons. Submit is disabled while anything's still uploading.
- Replying to a post, via a dedicated reply-compose panel (`in_reply_to_id` on `/api/v1/statuses`):
  - Click a post's reply bubble to open the composer, at any depth
  - Click *on the post itself* (not the bubble) to view its existing thread instead
  - **The reply inherits the parent post's visibility** (public/unlisted/followers-only/direct) rather than always posting public — shown as "Replying as: ⟨level⟩" in the composer
  - A successful reply drops straight into that thread's already-loaded tree, if it was loaded, so you see it immediately without a refetch
- Full thread context (`ancestors` + `descendants` from `/context`): opening any status always shows both what it was replying to and its own replies — not just an isolated post with no context, regardless of where you opened it from (timeline, notifications, or deeper in a thread)
- `@mentions` in post text render as real links to the mentioned account's profile page, and so does any other bare URL in the text (matched generically, not just @mentions — this was the actual bug behind links "not being detected": only mentions were ever linkified before, so a plain pasted URL just sat there as flat text). Long URLs are shortened for display (`pixiv.net/en/artworks/148558639` rather than the full string) while the real link still goes to the full URL. Matched against the status's `mentions` array plus a generic URL pattern, not by re-rendering the original HTML — still no `dangerouslySetInnerHTML` anywhere
- Explore, via `/api/v1/timelines/public`: a toggle between the federated feed (everything the instance knows about) and the local-only feed (`?local=true`, just this instance's accounts). Each is fetched and cached independently the first time you switch to it; the refresh button reloads whichever one is showing
- Window-width-aware layout, three tiers:
  - **Wide** (≥1400px, roughly a maximized window): a real 3-pane layout — notifications as a permanent left column, timeline in the center, and an opened thread as a permanent right column. Columns are proportionally sized (`minmax()` + `fr` units, not fixed pixel widths) so they actually grow with the window instead of stranding all the extra space in one column. The center column's reading-width cap is also lifted here specifically — it fills the full column instead of sitting as a narrow strip with wasted margin on both sides, since at this tier the column itself is already sized appropriately by the grid. The header's Notifications tab disappears here since it's no longer needed.
  - **Medium** (900–1400px): Notifications is a header tab, and an opened thread slides in from the right over the timeline — width scales with viewport (`min(460px, 40vw)`) rather than a fixed value — with the "peek drawer" reveal: a spring-eased slide with a darker, recessed tray, the same visual language as iOS's long-press quick-action reveal. Ancestors and replies converge on the focal post from opposite directions (ancestors down from above, replies up from below) as it opens.
  - **Narrow** (<900px): no room for a third column at all, so an opened thread (or the reply composer) replaces the timeline in the same content area instead of sliding in, with a back arrow to return.
  - All three tiers share the exact same thread-view component (`ThreadPanelContent`) — column, slide-out, and in-place are just three different wrappers around identical content, so ancestors/replies/media/compose behave identically everywhere
- Reply rows have full parity with the main timeline: same action row (reply/boost/favourite/monero/more), all functional — not a stripped-down version. Favouriting or boosting a reply updates it in place wherever it's showing (the panel's tree, or a notification's own status). **Ancestors are the same component too now** — they're rendered as full reply items (`ThreadReply`), not a separate bare-bones version, so clicking one refocuses the panel on it just like clicking any reply does, and they have the same working action buttons
- A settings menu (gear icon, top right) with a toggle for media hover previews, persisted to `localStorage`. Content-warning-blurred media never shows the hover preview regardless of that setting — that gate was missing before, which meant hovering an unrevealed sensitive image showed it at full size anyway, defeating the blur
- Client-side handling for quarantined local media and a related text-rendering bug:
  - `htmlToPlainText` now inserts real line breaks at `<p>`/`<div>`/`<li>`/`<br>` boundaries before extracting text. Mastodon-API content is typically one `<p>` per paragraph, and naive `.textContent` extraction collapsed those boundaries with zero space — the "link runs into the surrounding text" symptom was this, not a parsing failure on any specific link.
  - Separately: some instance admins disable inline embedding of remote media as a moderation measure, which can leave images as bare links in post text instead of proper attachments. Any bare image-file link whose domain matches the instance you're logged into gets pulled back out and rendered as a real attachment — behind the same content-warning blur as genuinely sensitive media, since there's no way to know *why* inline images were disabled for it, and hiding-by-default is the safer choice either way
- Scrollbars styled to match Adwaita's overlay scrollbars: invisible until you hover the scrollable area, then a thin rounded thumb fades in over the content rather than reserving permanent gutter space (Firefox and WebKit both covered)
- Notifications, via `/api/v1/notifications`:
  - Follows, follow requests, boosts, favourites, and mentions all render with the right icon and phrasing
  - Boosts/favourites/mentions show the actual post via the same component used everywhere else in the app — so it's fully interactive: media, content warnings, and thread-opening all work exactly like they do in the timeline
  - Follow requests get real Accept/Reject buttons (`/api/v1/follow_requests/:id/authorize|reject`)
  - At the wide tier this is a permanent column and loads on login; at medium/narrow it's a header tab and loads the first time you open it. The header refresh button reloads whichever list is currently relevant.
- Logout (clears the stored session; cached app credentials for the
  instance are kept so next login skips re-registering the app)

## Not wired up yet

- Monero tips and the "more options" menu are still inert
- Hashtags aren't linked, only @mentions — same idea, just not implemented yet
- Post content is rendered as plain text (HTML from remote posts is
  stripped rather than rendered, to avoid injecting untrusted markup —
  worth revisiting with a proper sanitizer if you want inline links/emoji beyond @mentions)
- The quarantined-media detection matches on the *domain* of an image link (does it point back at your own instance), not on any actual "this was quarantined" signal from the API — Mastodon-API doesn't expose why an image is inline vs. a bare link, so this is a heuristic, not a certainty
- The 1400px/900px layout breakpoints are starting guesses, not measured against any particular screen — worth adjusting the `WIDE_BREAKPOINT`/`NARROW_BREAKPOINT` constants near the top of `App.jsx` once you've actually resized the window and see how the three tiers feel
