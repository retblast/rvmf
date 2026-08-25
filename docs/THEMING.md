# Theming rvmf — Skin Package Reference

Skins change rvmf's look-and-feel without touching app logic. Two tiers:

- **Tier 1 (token skins)**: a JSON manifest of design tokens. Safe, importable, ideal for LLM authorship.
- **Tier 2 (component overrides)**: bundled-only React component replacements for radical redesigns. Documented contract lives in `src/ui/` as components migrate behind it.

## Tier 1: Token skin manifest

```json
{
  "id": "breeze",
  "name": "KDE Breeze",
  "respectOsAccent": false,
  "tokens": {
    "light": { "--window-bg": "#eff0f1", "--accent": "#3daee9" },
    "dark":  { "--window-bg": "#232629", "--accent": "#3daee9" }
  },
  "css": ""
}
```

### Rules

- `id`: lowercase letters/digits/dashes, max 32 chars, cannot be `adwaita` (the baseline).
- `tokens.light` / `tokens.dark`: keys must be CSS custom properties (`--kebab-name`); values must be color/gradient strings (`#hex`, `rgb()`, `hsl()`, `color-mix()`, `var(...)`, gradients). Everything else is silently dropped.
- Both schemes are optional; missing values inherit the Adwaita baseline.
- `css` (optional): additive rules scoped under `[data-skin="<id>"]` automatically. Max 20 KB. **No `url()`** — remote references are rejected.
- `respectOsAccent`: when true, "Use System Accent Color" still applies; when false (non-GNOME skins), the skin owns the accent.

## Token reference

| Token | Meaning | Where you see it |
|---|---|---|
| `--window-bg` | App background | page background, popovers |
| `--view-bg` | Content surfaces | cards, boxed lists, dialogs |
| `--headerbar-bg` / `--headerbar-border` | Top bar | header bar |
| `--text-primary` | Main text | posts, headings |
| `--text-secondary` | Muted text | timestamps, handles, hints |
| `--border` / `--border-strength→--border-strong` | Hairlines & strong borders | rows, inputs, dropdowns |
| `--hover-overlay` / `--active-overlay` | Interaction tints | hovers, pressed states (rgba recommended) |
| `--accent` / `--accent-fg` | Brand color + its text | active states, switches, suggested buttons |

Additional tokens exist beyond this table (radii, destructive colors) — read
`src/adwaita.css :root` for the full live list. Unknown keys are ignored safely.

## Type scale (do not fight it)

Font sizes use rem and follow the user's browser text-size setting:
`1rem` post bodies/composer · `.875rem` names/inputs · `.8125rem` chrome ·
`.75rem` buttons/captions · `.6875rem` badges (floor). Skins should not set font sizes.

## Worked example: making links green

```json
{
  "id": "green-links",
  "name": "Green Links",
  "tokens": {
    "light": { "--accent": "#2ec27e" },
    "dark": { "--accent": "#57e389" }
  }
}
```

## Applying

Built-in skins: Settings → Appearance → Style. Custom manifests: import UI
(roadmap) or paste into `src/lib/skins.js` registry during development.
Selection syncs to your account via settings sync.

## Contract stability

Token names are a versioned contract (`contractVersion: 1`). Renames will be
avoided within a version; deprecations get announced in release notes.
Tier-2 class-name-based CSS is best-effort and may break between releases.
