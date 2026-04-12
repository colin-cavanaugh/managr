/**
 * managr — Theme system
 *
 * Define color palettes as plain objects. The ThemeProvider injects them
 * as CSS custom properties so every CSS module can reference them.
 */

export interface ThemePalette {
  /** Primary brand color — buttons, links, active states */
  primary: string
  primaryHover: string
  primaryText: string

  /** Secondary accent — supporting actions, toggles */
  secondary: string
  secondaryHover: string
  secondaryText: string

  /** Semantic colors */
  success: string
  successText: string
  warning: string
  warningText: string
  danger: string
  dangerText: string
  info: string
  infoText: string

  /** Surfaces and backgrounds */
  bg: string
  bgRaised: string
  bgSunken: string
  bgOverlay: string

  /** Text */
  text: string
  textMuted: string
  textInverse: string

  /** Borders and dividers */
  border: string
  borderFocus: string

  /** Misc */
  shadow: string
  radius: string
  radiusLg: string
  fontFamily: string
}

/**
 * Charcoal Sand palette
 *   #222831 — deep charcoal navy
 *   #393E46 — slate gray
 *   #948979 — warm khaki
 *   #DFD0B8 — sand cream
 */

export const defaultTheme: ThemePalette = {
  primary: '#948979',
  primaryHover: '#7d7466',
  primaryText: '#222831',

  secondary: '#393E46',
  secondaryHover: '#2d3139',
  secondaryText: '#DFD0B8',

  success: '#6a8a5e',
  successText: '#222831',
  warning: '#c4a24e',
  warningText: '#222831',
  danger: '#a85454',
  dangerText: '#DFD0B8',
  info: '#948979',
  infoText: '#222831',

  bg: '#222831',
  bgRaised: '#2a303c',
  bgSunken: '#1a1e26',
  bgOverlay: 'rgba(34, 40, 49, 0.75)',

  text: '#DFD0B8',
  textMuted: '#948979',
  textInverse: '#222831',

  border: '#393E46',
  borderFocus: '#948979',

  shadow: '0 1px 3px rgba(0, 0, 0, 0.4)',
  radius: '6px',
  radiusLg: '10px',
  fontFamily: "'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
}

export const lightTheme: ThemePalette = {
  primary: '#393E46',
  primaryHover: '#222831',
  primaryText: '#DFD0B8',

  secondary: '#948979',
  secondaryHover: '#7d7466',
  secondaryText: '#222831',

  success: '#5a7a4e',
  successText: '#ffffff',
  warning: '#b08a2e',
  warningText: '#222831',
  danger: '#944040',
  dangerText: '#ffffff',
  info: '#393E46',
  infoText: '#DFD0B8',

  bg: '#DFD0B8',
  bgRaised: '#ebe0cc',
  bgSunken: '#cfc0a6',
  bgOverlay: 'rgba(57, 62, 70, 0.4)',

  text: '#222831',
  textMuted: '#6b6358',
  textInverse: '#DFD0B8',

  border: '#948979',
  borderFocus: '#393E46',

  shadow: '0 1px 3px rgba(34, 40, 49, 0.12)',
  radius: '6px',
  radiusLg: '10px',
  fontFamily: "'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
}

/**
 * Convert a ThemePalette into a flat map of CSS custom property names → values.
 * e.g. { primary: '#3b82f6' } → { '--mgr-primary': '#3b82f6' }
 */
export function themeToVars(theme: ThemePalette): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [key, value] of Object.entries(theme)) {
    const cssKey = '--mgr-' + key.replace(/([A-Z])/g, '-$1').toLowerCase()
    vars[cssKey] = value
  }
  return vars
}
