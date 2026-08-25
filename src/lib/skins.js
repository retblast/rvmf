// Skin system: Tier-1 token themes + optional additive CSS.
// A skin is { id, name, respectOsAccent?, tokens: {light,dark}, css? }.
// Tokens are CSS custom properties applied under [data-skin="<id>"];
// unknown tokens are ignored, missing tokens fall back to Adwaita
// defaults (the built-in baseline needs no manifest).

export const ADWAITA_TOKENS = {
  light: {
    '--window-bg': '#f6f5f4',
    '--view-bg': '#ffffff',
    '--headerbar-bg': '#ffffff',
    '--headerbar-border': '#d3d1d5',
    '--text-primary': '#1e1e1e',
    '--text-secondary': '#77767b',
    '--border': '#e0dfe3',
    '--border-strong': '#c8c6ca',
    '--hover-overlay': 'rgba(0, 0, 0, 0.05)',
    '--active-overlay': 'rgba(0, 0, 0, 0.08)',
    '--accent': '#3584e4',
    '--accent-fg': '#ffffff',
  },
  dark: {
    '--window-bg': '#242424',
    '--view-bg': '#1e1e1e',
    '--headerbar-bg': '#303030',
    '--headerbar-border': '#1c1c1c',
    '--text-primary': '#ffffff',
    '--text-secondary': '#9a9996',
    '--border': 'rgba(255, 255, 255, 0.09)',
    '--border-strong': 'rgba(255, 255, 255, 0.16)',
    '--hover-overlay': 'rgba(255, 255, 255, 0.07)',
    '--active-overlay': 'rgba(255, 255, 255, 0.1)',
    '--accent': '#78aeed',
    '--accent-fg': '#052044',
  },
}

export const SKINS = {
  adwaita: { id: 'adwaita', name: 'Adwaita', respectOsAccent: true },
  breeze: {
    id: 'breeze',
    name: 'KDE Breeze',
    respectOsAccent: false,
    tokens: {
      light: {
        '--window-bg': '#eff0f1',
        '--view-bg': '#fcfcfc',
        '--headerbar-bg': '#eff0f1',
        '--headerbar-border': '#b6b9be',
        '--text-primary': '#232629',
        '--text-secondary': '#7f8c8d',
        '--border': '#cfd3d7',
        '--border-strong': '#b6b9be',
        '--hover-overlay': 'rgba(35, 38, 41, 0.06)',
        '--active-overlay': 'rgba(35, 38, 41, 0.1)',
        '--accent': '#3daee9',
        '--accent-fg': '#fcfcfc',
      },
      dark: {
        '--window-bg': '#232629',
        '--view-bg': '#2a2e32',
        '--headerbar-bg': '#31363b',
        '--headerbar-border': '#1b1d20',
        '--text-primary': '#fcfcfc',
        '--text-secondary': '#bdc3c7',
        '--border': 'rgba(255, 255, 255, 0.12)',
        '--border-strong': 'rgba(255, 255, 255, 0.22)',
        '--hover-overlay': 'rgba(252, 252, 252, 0.08)',
        '--active-overlay': 'rgba(252, 252, 252, 0.12)',
        '--accent': '#3daee9',
        '--accent-fg': '#232629',
      },
    },
  },
}

// Validate an untrusted manifest (custom imports). Returns { ok, errors,
// skin } — skin is the normalized object when ok.
export function validateSkin(manifest) {
  const errors = []
  if (!manifest || typeof manifest !== 'object') return { ok: false, errors: ['not an object'] }
  const id = String(manifest.id || '').trim()
  if (!/^[a-z0-9-]{1,32}$/.test(id)) errors.push('id must be lowercase letters/digits/dashes')
  if (!manifest.name || typeof manifest.name !== 'string') errors.push('missing name')
  if (id === 'adwaita') errors.push('cannot shadow the built-in baseline')
  if (errors.length) return { ok: false, errors }

  const tokens = {}
  for (const scheme of ['light', 'dark']) {
    const set = manifest.tokens?.[scheme]
    if (set && typeof set === 'object') {
      const clean = {}
      for (const [key, value] of Object.entries(set)) {
        // Only custom-property-looking names, string values that look
        // like colors/images — anything else is dropped, not trusted.
        if (/^--[a-z0-9-]+$/.test(key) && typeof value === 'string' && value.length <= 200) {
          if (/^(#[0-9a-fA-F]{3,8}|rgb|rgba|hsl|hsla|color-mix|var\(|linear-gradient|transparent)/.test(value.trim())) {
            clean[key] = value
          }
        }
      }
      tokens[scheme] = clean
    }
  }

  let css = ''
  if (typeof manifest.css === 'string') {
    // Strip url()-based rules outright: CSS can't execute, but remote
    // urls are an exfiltration/tracking vector we don't want.
    if (/url\s*\(/i.test(manifest.css)) errors.push('css must not contain url()')
    else if (manifest.css.length <= 20_000) css = manifest.css
  }

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    errors,
    skin: {
      id,
      name: manifest.name.slice(0, 40),
      respectOsAccent: Boolean(manifest.respectOsAccent),
      tokens,
      css,
    },
  }
}

// Id-based lookup rather than a cached node: survives module reloads
// and React StrictMode double-mounts without duplicating <style> tags.
function ensureStyleElement() {
  let el = document.getElementById('rvmf-skin')
  if (!el) {
    el = document.createElement('style')
    el.id = 'rvmf-skin'
    document.head.appendChild(el)
  }
  return el
}

// Apply a skin id from the registry (or a validated custom object).
export function applySkin(skin) {
  const el = ensureStyleElement()
  if (!skin || skin.id === 'adwaita') {
    el.textContent = ''
    delete document.documentElement.dataset.skin
    return
  }
  document.documentElement.dataset.skin = skin.id
  let css = ''
  const emit = (selector, scheme) => {
    const set = skin.tokens?.[scheme]
    if (!set) return
    const decls = Object.entries(set).map(([k, v]) => `${k}: ${v};`).join(' ')
    css += `${selector} { ${decls} }\n`
  }
  emit(`[data-skin="${skin.id}"]`, 'light')
  emit(`[data-skin="${skin.id}"][data-theme="dark"]`, 'dark')
  if (skin.css) css += `[data-skin="${skin.id}"] { ${skin.css} }\n`
  el.textContent = css
}
