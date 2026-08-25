import { createContext, useContext } from 'react'

// Tier-3 structural overrides: skins may replace whole components.
// Bundled skins only — third-party imports stay Tier-1 (CSS tokens).
// Contract per overridable name is documented in docs/THEMING.md.
export const UIContext = createContext({})
export const useUI = () => useContext(UIContext)
