# AGENTS.md — rvmf

Guidance for AI coding agents working in this repository.

## Project overview

**rvmf** (Retblast's Vibecoded Mitra Frontend) is a GNOME/Adwaita-styled web
client for [Mitra](https://mitra.social), a federated microblogging server
written in Rust.

Mitra is built on ActivityPub (part of the Fediverse), self-hosted and
lightweight (<50 MB RAM). Notable features: quote posts, custom emoji,
markdown-style post formatting, polls, groups, and paid content subscriptions
via Monero. Critically for this project, Mitra implements the **Mastodon
client API** — this client logs in via OAuth and consumes that API surface.

References:

- Mitra site: https://mitra.social
- Mitra source: https://codeberg.org/silverpill/mitra
- Mitra API docs (OpenAPI): https://codeberg.org/silverpill/mitra/src/branch/main/docs/openapi.yaml
- Mastodon API (shared surface): https://docs.joinmastodon.org/client/intro/

### API boundary

Code should stick to the common Mastodon-compatible API unless a
Mitra-specific feature is intentionally being used. Never hardcode instance
URLs — the user logs into arbitrary instances.

## Setup & commands

```sh
nix develop            # dev shell (flake provides everything)
npm install
npm run dev            # Vite dev server
npm run build          # production build -> dist/
npm run serve          # production server (node server.mjs)
npm test               # unit tests (Vitest + Testing Library, jsdom)
npm run lint           # ESLint over src/
npx playwright test    # e2e tests (e2e/specs) — slow, run on demand
```

## Commit discipline

**Commit after every meaningful change.** A meaningful change is one logical
unit that lints and tests clean on its own: one fix, one feature slice, one
refactor. Rules:

1. Before every commit: `npm run lint && npm test` must pass.
2. One concern per commit. Never bundle unrelated changes.
3. Never end a task with uncommitted work in the tree.
4. Commit message format, matching existing history:

   ```
   type: short summary — why/details
   ```

   Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`. Imperative
   summary; after the em-dash (—), explain *why* or what changed if the
   summary can't carry it. See `git log` for examples.
5. Push only when the user asks.

## Testing

- Unit tests are colocated with source: `*.test.js` next to the module
  (Vitest, jsdom, @testing-library/react).
- E2e tests live in `e2e/specs` (Playwright). Run them before finishing
  changes to UI behavior (navigation, threads, timelines); not required per
  commit.
- New features should come with tests. Test coverage is incomplete (see
  README TODOs) — don't treat "no existing test" as precedent.

## Code style

- ESM everywhere (`"type": "module"`), React 18 function components + hooks,
  plain JSX — no TypeScript.
- Formatting: 2-space indent, single quotes, no semicolons. Match the
  surrounding file.
- Theming: follow `docs/THEMING.md`. Colors come from Adwaita CSS custom
  properties (`--window-bg`, `--view-bg`, `--accent`, ...). Never hardcode
  color values in components.
- `server.mjs` is the standalone production server; keep it dependency-free
  (Node stdlib + local scripts only).

## Boundaries

- Never commit: `dist/`, `test-results/`, `result`, `.direnv/`, secrets.
- Don't hand-edit `package-lock.json` or `flake.lock`.
- Don't add dependencies without asking the user first.
