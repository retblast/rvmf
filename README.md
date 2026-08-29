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
- Media downloads: report partial success — `downloadAllMedia` currently swallows per-file failures, so a post where only some attachments save still says "Media saved". Add a count (e.g. "3 of 5 saved") before the reusable helper is lifted to an account-level sweep.

## Features

### Core

- **Home timeline** with boost unwrapping, infinite scroll (IntersectionObserver), per-post favouriting/boosting/bookmarking, and pull-to-refresh. Visible posts poll for fresh state every 5 seconds, so counts and flags stay live everywhere at once.
- **Thread view** — every post opens a thread panel (slide-out at medium width, permanent column when wide, in-place swap on narrow) with the full ancestor + descendant tree from `/context`, built into a nested tree client-side. Auto-refreshes every 5 seconds (tree *and* the focal post). Replies compose inline beneath any post in the thread; after posting, the reply is inserted into the tree immediately and scrolled into view. Remote threads can pull missing replies from their origin server.
- **Explore** — federated and local public timelines, plus a profile directory ("People") with infinite scroll.
- **Search** — debounced search across people, posts, and hashtags (`/api/v2/search`), with display tabs that filter results. Works around Mitra's untyped-search parser by sending typed requests per category.
- **Notifications** — follows, follow requests (accept/reject), boosts, favourites, mentions, emoji reactions, quotes, edits. Auto-refreshes every 5 seconds while visible. Unread badge driven by the server-side markers API so the read position syncs across devices. Clear-all supported. Filter chips hide categories client-side (Mitra has no `exclude_types` param); hidden categories never count as read.
- **Messages** — direct-message inbox: one row per conversation with participants and a snippet of the latest post. Clicking opens that post's thread. An "All DMs" tab shows the flat timeline of every direct-visibility post.
- **Lists** — create, rename, delete lists (Mitra custom feeds); add/remove members from any profile; per-list timelines.
- **Groups** — browse followed and moderated groups, open their timelines, post directly into a group, create new ones, edit descriptions, browse members (admin badges), and delete groups (type-to-confirm).
- **Favourites** — dedicated favourites view with infinite scroll; un-favouriting removes the row.
- **Bookmarks** — dedicated bookmarks view with infinite scroll; unbookmarking removes the row.
- **Hashtags** — hashtag links inside posts open the tag's public feed inline, with back navigation.

### Compose & Reply

- **New post** — modal dialog with server-reported character limit (`max_characters` from `/api/v2/instance`, default 500), optional title, language tag, content warning toggle, visibility selector (Public / Unlisted / Followers only / Subscribers / Direct — non-standard values still display), media upload (up to 4 files with live thumbnails and per-file alt-text editing, uploads start immediately and are tracked independently), image paste from clipboard, emoji picker, and Ctrl+Enter to submit.
- **Markdown preview** — toggleable server-rendered preview (`/statuses/preview`) in the compose, reply, and edit dialogs, rendered through the same safe rich-text pipeline as post bodies.
- **Polls** — build polls in the composer: 2–8 options, duration presets, multiple-choice support. Polls and media attachments are mutually exclusive.
- **Emoji & mentions** — `:shortcode:` autocomplete plus an `@` account autocomplete backed by `/accounts/search`; a picker with common unicode emoji and your instance's custom emoji. Custom emoji render inline everywhere (names, post text, reactions).
- **Idempotent posting** — every draft carries an `Idempotency-Key`, so double-submits and retry-after-timeout can't create duplicate posts.
- **Reply** — inline composer inside the thread panel beneath the target post. Inherits the parent post's visibility by default; conversation-type parents lock visibility entirely. Shows a preview of the post being replied to.
- **Quote** — boost dropdown includes a "Quote" option that opens the compose dialog with the quoted post attached.
- **Group posting** — "Post to this group" addresses the composer at a group (`group_id`), with context shown in the dialog.
- **Default visibility** — seeded from server preferences (`posting:default:visibility`) and persisted back via `update_credentials`, so it applies across devices and clients.
- **Signup** — create an account on the instance from the login screen (username, password, invite code when required) and land straight in your timeline via the password grant — no redirect.

### Posts & Interactions

- **Media** — images, video, GIFV, audio playback. Full-screen lightbox with keyboard navigation (arrows, Escape) and alt text shown as a caption. Sensitive content blur with click-to-reveal; alt text also appears on thumbnail hover.
- **Media resilience** — images decode from blurhash placeholders while loading; remote media falls back through signed-proxy URL decoding, original-origin recovery, and ActivityPub document lookup when proxies break. The dev server proxies all media to sidestep CORS (and survives flaky connections without dying).
- **Who favourited / boosted** — count badges open popovers listing the accounts behind them.
- **Quarantined-image recovery** — when an instance disables inline embedding of remote media, image links are extracted back out of the post text (markdown-wrapped or bare) and rendered as blurred attachments again.
- **Polls** — vote on active polls; results show percentages, your choices highlighted, voter counts, and time remaining.
- **Emoji reactions** — Pleroma/Akkoma-style `emoji_reactions` with a picker (common emoji + custom server emoji).
- **Boost dropdown** — boost or quote; boosts are hidden for followers-only/direct/subscribers posts since servers reject them.
- **Edit & delete own posts** — editing loads the raw source (not rendered HTML) and PUTs it back; edited posts show an "(edited)" marker.
- **IPFS pinning** — save own public posts to IPFS when the instance has the integration; pinned posts offer a copy-CID action.
- **Cross-copy state sync** — acting on a post updates every place it appears in a list, including inside other people's boost wrappers.
- **Pin/unpin own posts** to your profile.
- **Post options menu** — copy link, mute account, block account.
- **Hide/show media** per post without leaving the timeline.

### On-device translation

- **Enabled from settings** — a "Translate Foreign Posts" toggle in the settings menu (default **off**). Turning it on the first time shows a confirmation explaining that a model will be downloaded, so the heavy download is never a surprise.
- With it on, every post (timeline rows and thread replies) gains a small **translate toggle** among its action buttons (next to like/favourite etc.). Tapping it swaps the post to an on-device translation; tapping again (or the "show original" ✕) swaps back. Because Fediverse language tags are often missing or wrong, the button is **always available** rather than gated on a language-mismatch heuristic — you decide what to translate. The target language comes from your browser's `navigator.language`.
- The source language is resolved by falling back in order: an explicit pick from the UI, then the post's language tag, then a conservative **script-based guess** (kana → Japanese, Hangul → Korean, Han → Chinese, Cyrillic → Russian, Devanagari → Hindi, Arabic, Hebrew, Thai, Tamil, Greek, …). When nothing resolves, a **source-language picker** appears instead of an error. Because a wrong source yields a bad translation, any detected source is surfaced as a small correctable dropdown in the translated header — it's never trusted silently.
- Translation runs **entirely in your browser** over Transformers.js + ONNX Runtime Web; no part of the post ever reaches a translation server. Two providers are selectable via radio buttons in settings, so you pick the right engineering trade-off for your hardware:
  - **NLLB (default, CPU)** — Meta's `nllb-200-distilled-600M` on **WebAssembly**, loaded with **fp32 weights** and with the ORT graph optimizer dropped to `basic` (the repo's quantized "merged" files plus a buggy onnxruntime-web QDQ fusion pass can abort session creation with "Missing required scale … weight_merged_0_scale", so we sidestep both). No GPU required, works in every browser, at the cost of a larger one-time download (~3–5 GB fp32). (Licensed **CC-BY-NC-4.0** — fine for personal use, not for commercial redistribution.)
  - **TranslateGemma (optional, GPU)** — Google's `Translategemma 4B` quantized (`q4f16`) on **WebGPU**. Higher quality but needs a WebGPU-capable browser and ~3 GB of VRAM; on some Intel iGPUs it can hit a known fp16 overflow that yields `<unusedN>` garbage, which the app detects and rejects with a clear error instead of showing broken text.
- Everything is **opt-in and lazy**: a model is only downloaded on the first actual translation (served from the same origin as the app), so it takes a while that once; later translations reuse the cached model. A determinate progress bar shows the download, switching to an indeterminate "Translating…" bar during inference. Inference is guarded by a ~2-minute watchdog that reports a stall rather than spinning forever.
- Translated text renders through the same safe, link/mention-aware rich-text pipeline as normal posts, with a "show original" close affordance. The TranslateGemma option requires a **WebGPU-capable browser** (Chrome/Edge, or Firefox with WebGPU enabled); unsupported browsers get a clear error instead of a broken spinner. The default NLLB option needs no special browser support at all.

### Profiles

- **Profile view** — header banner, overlapping avatar, display name (with custom emoji), handle, bio, stats, and follow indicators ("Mutual", "Follows you").
- **People lists** — followers / following / subscribers counts open paginated panels; on your own profile you can silently remove followers.
- **Follow tuning** — after following someone, toggle whether their reposts and replies appear in your home timeline.
- **Follow / unfollow**, plus a per-profile list-membership dropdown (membership resolved via a single `/accounts/:id/lists` call).
- **Tabs** — Posts (top-level), Posts & Replies, Pinned, Media — all with infinite scroll. Remote profiles get a "load older posts from origin" backfill button.
- **Edit profile** (own) — avatar/header upload (base64), display name, bio, protected/bot toggles, and up to 6 profile fields.

### Account management

Reached from the settings menu:

- **Password change**.
- **Active sessions** — every OAuth token logged into the account, current one pinned on top; revoke any (revoking the current one logs out). Logging out also revokes the token server-side.
- **Sent follow requests** — pending outgoing requests to protected accounts.
- **Portability** — export follows/followers as CSV, import them back, manage aliases, and move followers to a new account (type-to-confirm; irreversible).
- **Delete account** — type-to-confirm wipe of the account and all its posts; logs out afterward.

### Settings

- **Fetch media directly** — route media through blob fetching with caching (on by default), or fall back to plain proxied URLs.
- **Mark all media as sensitive** — strict mode that blurs everything; sub-toggle lets hover previews peek behind CWs (muted video peek included).
- **Use system accent color** — inherits the OS/browser accent, ignoring known browser default blues so nothing gets painted over pointlessly.
- **Theme** — System / Light / Dark three-way toggle.
- **Settings sync** — display preferences (theme, media handling, notification filters) push to your account and backfill fresh devices; local values always win on a device you've touched.
- **Sent from** — configurable client name used in OAuth registration ("posted via X"); changing it re-registers the app on next login.
- **Muted accounts** manager with one-click unmute.
- Server notification policy and instance domain blocks displayed read-only.

### Layout & UX

- **Three responsive tiers:**
  - **Wide** (≥1400px) — 3-column grid: notifications | content | thread. All always visible.
  - **Medium** (900–1399px) — content area plus a sliding thread panel from the right.
  - **Narrow** (<900px) — thread replaces the content in-place with a back button.
- **Escape closes the topmost popup**, innermost first (pickers → dropdowns → dialogs → panel).
- **Flaky-connection resilience** — every API request carries a timeout (20s reads, 60s writes); read requests auto-retry with backoff on network errors and 429/5xx; uploads get 5 minutes. While the browser is offline, all polling pauses behind an amber banner, and reconnecting refreshes the current view immediately. Failed loads offer Retry buttons.
- **Instance identity** — tab title ("rvmf on \<host\>"), favicon, and headerbar icon follow the logged-in instance; the login screen recognizes instances as you type and shows their favicon.
- **Error boundaries** — one broken section degrades to a local "Try again" instead of blanking the app.
- **Animated thread loading** — Framer Motion staggers ancestors converging down toward the focal post, replies converging up.
- Keyboard-accessible throughout (`focus-visible` outlines), Adwaita-style overlay scrollbars.

## Testing

- **`npm test`** — Vitest unit/component tests: the pure libraries (rich-text rendering, quarantined-image recovery, reply trees, storage migration, blurhash, emoji filtering, TranslateGemma language mapping + translation orchestration) and key component behaviors (composer validation, visibility handling, cross-copy status merging, the reusable confirm dialog).
- **`nix run .#e2e`** — full E2E suite against a real backend, fully hermetic:
  1. throwaway PostgreSQL in a temp dir
  2. a pinned real Mitra server (upstream release deb extracted by the flake — `packages.mitra`)
  3. users + posts + replies + boosts + favourites + a poll seeded *through the app's own API client*
  4. production build served under `vite preview`
  5. Playwright specs across both layout tiers (wide/narrow): signup+auto-login, timeline render, favourite/boost state syncing across boost-wrapper copies, thread open + inline reply, markdown preview, notification filter chips
- Specs follow a strict selector policy: roles and labels first, `data-*` attributes second, never CSS classes. `RVMF_KEEP=1` preserves the fixture workspace for debugging; `SKIP_TESTS=1` + `E2E_HOLD=<seconds>` hold the stack open for manual poking.
- **CI** (`.github/workflows/ci.yml`) runs three jobs on every push/PR: lint+unit, the same E2E chain against the pinned Mitra deb on a clean runner, and `nix build` / `nix flake check`.

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

## Deployment (hosting under a subdomain)

rvmf is a static Single-Page App plus a tiny Node server. The server (`server.mjs`) serves the built bundle *and* the `/media-proxy` endpoint, so a single reverse-proxy rule can put the whole thing online at the root of a subdomain (e.g. `rvmf.domain.com`).

Because every path the app uses — fingerprinted assets (`/assets/...`), the media proxy (`/media-proxy`), and the OAuth redirect URI (built from `window.location.origin`) — is root-relative, **subdomain hosting needs no path-prefix or `base` configuration**. Point a subdomain at your host, proxy it to `server.mjs`, done.

### Prerequisites

- **Node.js 22+** and **npm** — that's it. No Nix, no container needed, works on any distro (systemd below is optional and shown only as a common example).
- A domain whose DNS you can configure, and a host (VPS, home server) with ports 80/443 reachable and a reverse proxy installed.

### 1. Build and run

```bash
npm ci            # install dependencies
npm run build     # compile into dist/
npm run serve     # production server on 0.0.0.0:4173
```

The server is configured by environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `0.0.0.0` | Interface to bind (behind a reverse proxy, `0.0.0.0` or the loopback is fine) |
| `PORT` | `4173` | Port to listen on (set a nonstandard one if you like) |
| `RVMF_DIST` | `./dist` | Directory holding the built bundle |

A minimal systemd unit for keeping it alive (adjust the path to where you cloned the repo):

```ini
[Unit]
Description=rvmf frontend
After=network.target

[Service]
WorkingDirectory=/opt/rvmf
ExecStart=/usr/bin/npm run serve
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Don't expose port `4173` publicly on its own. Keep it bound to loopback (or firewall it off) and let the reverse proxy below be the only thing talking to it.

### 2. Point DNS at your host

Add a record for `rvmf.domain.com` that resolves to your host — an `A` record with the host's IPv4 (or `AAAA` for IPv6, or a `CNAME` if the box already has a name). Wait for it to propagate.

### 3. Reverse proxy to the server

The proxy terminates TLS in front of the Node server and forwards `/`, `/assets/...`, and `/media-proxy` to it. Both examples below send **the entire subdomain** through — that is what makes remote media keep working, because the media proxy shares the same origin as the page.

#### Caddy

Caddy needs no certificate setup — it provisions and renews Let's Encrypt certs automatically. It also passes `Host` through and adds `X-Forwarded-For`/`X-Forwarded-Proto` itself, so this one block is all you need:

```caddyfile
rvmf.domain.com {
    reverse_proxy 127.0.0.1:4173
}
```

That single `reverse_proxy` line covers static assets, SPA deep links, and `/media-proxy` — the whole origin flows through untouched.

#### nginx

nginx needs the forwarding headers declared explicitly. With a single `location /` catch-all, assets, deep links, and the media proxy all reach the server unchanged:

```nginx
server {
    listen 80;
    server_name rvmf.domain.com;

    location / {
        proxy_pass http://127.0.0.1:4173;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Terminate TLS and redirect HTTP to HTTPS with certbot (or your CA of choice):

```bash
sudo certbot --nginx -d rvmf.domain.com
```

### How the media proxy works behind the proxy

The browser can't fetch fediverse media directly (CORS forbids it), so the app pulls images/video/audio through its own origin at `/media-proxy?url=<encoded>`. Since the reverse proxy forwards the entire subdomain, those requests reach `server.mjs` on the same origin as the page, and the proxy returns the upstream bytes with permissive CORS. The `Authorization` header the browser adds toward its own origin flows through the proxy to the media host intact.

Because requests keep the `Host` header of your subdomain, everything stays same-origin — which is exactly what the app's `window.location.origin`-derived redirect URI and media fetcher assume. So: keep the whole subdomain proxied to `server.mjs`, and every feature (timelines, compose, media, media downloads) works unchanged.

### Gotchas

- **Serve over HTTPS.** The OAuth redirect URI comes from `window.location.origin`. If the browser sees `http://`, login redirects will use the wrong scheme. Caddy handles this automatically; with nginx, make sure requests are served on 443 (as in the certbot step above).
- **This is subdomain hosting, not sub-path hosting.** Hosting under a *path* (e.g. `domain.com/rvmf/`) is a different story — it would need a Vite `base`, path-aware media-proxy routing, and redirect-URI handling. If you want that, it's future work; the examples above assume the subdomain root.

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
                     hook + thumbnail strip with alt-text editing, poll
                     draft state + editor, visibility/language selects,
                     markdown preview hook + pane, char counter,
                     parent-post previews.

    ReplyComposer.jsx  Inline reply composer sharing the compose building
                     blocks.

    ThreadPanel.jsx    Thread content shared by all three layout tiers:
                     ancestors, focal post, nested reply tree, inline
                     composers, staggered animations.

    ProfileView.jsx    Profile header, follow state + tuning, badges,
                     people lists (followers/following/subscribers),
                     tabs, infinite-scroll statuses, origin backfill,
                     per-profile lists menu.

    ProfileEdit.jsx    Own-profile editor: images, bio, flags, fields.

    SearchView.jsx     Debounced search across accounts, statuses,
                     hashtags with category tabs.

    HashtagFeed.jsx    Public timeline for one hashtag.

    ListsView.jsx      List CRUD + per-list feed.

    GroupsView.jsx     Followed/moderated groups, group feeds, group
                     posting, creation, and management (description,
                     members, deletion).

    ConversationsView.jsx  Direct-message inbox.

    FavouritesView.jsx Favourited posts with infinite scroll.

    MutedAccountsView.jsx  Muted accounts with unmute.

    AccountSettingsView.jsx  Password change, session revocation, sent
                     follow requests, portability card (export/import
                     CSV, aliases, follower migration), account deletion.

    Emoji.jsx          Emoji autocomplete hook, dropdown, picker,
                     shortcode tables.

    Mention.jsx        @mention autocomplete hook + dropdown backed by
                     /accounts/search.

    InstanceIcon.jsx   Instance favicon with fallback glyph.

    ErrorBoundary.jsx  Per-section crash containment.

    ConfirmDialog.jsx  Reusable confirm modal (reuses the dialog chrome);
                      used to gate heavy opt-in actions like enabling
                      on-device translation.

  lib/
    mitra.js           API client. Everything the app does against the
                     instance lives here, through apiFetch() which adds
                     request timeouts and read retries, handles JSON
                     parsing, error wrapping, and 204 No Content.

    storage.js         localStorage/sessionStorage wrapper under the
                     rvmf- key prefix, with a one-time migration from
                     the old mitra-* keys.

    render.jsx         HTML-to-plaintext conversion preserving links as
                     markdown tokens, safe rich-text rendering (mentions,
                     hashtags, URLs, custom emoji — no dangerouslySetInnerHTML),
                     reply tree helpers, Mitra signed-proxy URL decoding,
                     quarantined-image recovery.

    translate.js       On-device translation wrapper — lazily loaded,
                     provider-selectable singleton pipelines (NLLB on WASM by
                     default, optional TranslateGemma on WebGPU q4f16) that
                     take a plain-text post and return its translated text.
                     Includes a WebGPU <unusedN> garbage guard and a watchdog
                     timeout. Never imported or run until a user requests a
                     translation.

    languages.js       Provider vocabularies (NLLB FLORES-200 + TranslateGemma
                     locales), a canonical ISO-639-1 layer, and resolvers that
                     map BCP-47/status/navigator.language tags onto each
                     model's exact codes, plus the source-language script
                     detection used when translating a post.

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
| `/oauth/token` | POST | Exchange auth code for token (or password grant after signup) |
| `/oauth/revoke` | POST | Invalidate token on logout |
| `/api/v1/accounts` | POST | Create account (invite-code capable) |
| `/api/v1/timelines/direct` | GET | Flat direct-post timeline ("All DMs") |
| `/api/v1/statuses/:id/make_permanent` | POST | Pin post to IPFS |
| `/api/v1/settings/client_config` | POST | Sync client settings to the account |
| `/api/v1/instance/domain_blocks` | GET | Instance block list (read-only display) |
| `/api/v1/accounts/verify_credentials` | GET | Get current user info |
| `/api/v2/instance` | GET | Instance config (character limit) |
| `/api/v1/instance` | GET | Instance recognition on login screen |
| `/api/v1/timelines/home` | GET | Home timeline (paginated) |
| `/api/v1/timelines/public` | GET | Public timeline (federated/local) |
| `/api/v1/timelines/tag/:hashtag` | GET | Hashtag feed |
| `/api/v1/timelines/list/:id` | GET | List timeline |
| `/api/v1/timelines/group/:id` | GET | Group timeline |
| `/api/v1/statuses/:id/context` | GET | Thread ancestors + descendants |
| `/api/v1/statuses/:id` | GET | Single post (focal-post refresh) |
| `/api/v1/statuses?id[]=` | GET | Batch fetch posts (live timeline polling) |
| `/api/v1/statuses/:id/source` | GET | Raw source for editing |
| `/api/v1/statuses/:id/favourited_by` | GET | Who favourited |
| `/api/v1/statuses/:id/reblogged_by` | GET | Who boosted |
| `/api/v1/statuses/:id/load_conversation` | POST | Pull remote replies from origin |
| `/api/v1/statuses` | POST | Create post/reply (title, language, `group_id`; supports `Idempotency-Key`) |
| `/api/v1/statuses/preview` | POST | Server-rendered markdown preview |
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
| `/api/v1/favourites` | GET | Favourited posts (paginated) |
| `/api/v1/custom_emojis` | GET | Custom emoji list |
| `/api/v2/search` | GET | Search accounts/statuses/hashtags |
| `/api/v1/accounts/search` | GET | Username lookup (@autocomplete) |
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
| `/api/v1/groups/followed` | GET | Followed/moderated groups (`filter`) |
| `/api/v1/groups` | POST | Create group |
| `/api/v1/groups/:id` | PATCH | Update group description |
| `/api/v1/groups/:id` | DELETE | Delete group |
| `/api/v1/groups/:id/source` | GET | Group description source (for editing) |
| `/api/v1/groups/:id/members` | GET | Group members + affiliations |
| `/api/v1/directory` | GET | Profile directory (Explore > People) |
| `/api/v1/conversations` | GET | DM conversations |
| `/api/v1/mutes` | GET | Muted accounts (paginated) |
| `/api/v1/accounts/:id/mute` | POST | Mute account |
| `/api/v1/accounts/:id/unmute` | POST | Unmute account |
| `/api/v1/accounts/:id/block` | POST | Block account |
| `/api/v1/accounts/:id/follow` | POST | Follow account (reblogs/replies options) |
| `/api/v1/accounts/:id/unfollow` | POST | Unfollow account |
| `/api/v1/accounts/:id/remove_from_followers` | POST | Silently remove a follower |
| `/api/v1/accounts/:id/followers` | GET | Followers (paginated) |
| `/api/v1/accounts/:id/following` | GET | Following (paginated) |
| `/api/v1/accounts/:id/subscribers` | GET | Subscribers with expiry |
| `/api/v1/accounts/:id/lists` | GET | Which of your lists contain this account |
| `/api/v1/accounts/:id/load_activities` | POST | Backfill remote profile from origin |
| `/api/v1/follow_requests/outgoing` | GET | Pending sent follow requests |
| `/api/v1/accounts/:id` | GET | Fetch profile |
| `/api/v1/accounts/:id/statuses` | GET | Profile statuses (tabs/pagination) |
| `/api/v1/accounts/relationships` | GET | Follow relationships |
| `/api/v1/accounts/lookup` | GET | Resolve acct to account |
| `/api/v1/accounts/update_credentials` | PATCH | Update own profile (also default visibility) |
| `/api/v2/media` | POST | Upload media attachment |
| `/api/v1/media/:id` | GET | Poll upload status / resolve URLs |
| `/api/v1/media/:id` | PUT | Update alt text / description |
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
