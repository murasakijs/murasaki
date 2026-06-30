// Theme tokens — colors / radius / spacing / fontSize.
// Each token surfaces as a CSS custom property under :root, so a component
// can read it as `var(--murasaki-color-primary)` and the value updates live
// when the active theme switches.

export type Theme = {
  colors: {
    primary: string
    primaryFg: string
    primaryDeep: string
    secondary: string
    secondaryFg: string
    background: string
    surface: string
    surfaceMuted: string
    text: string
    textMuted: string
    border: string
    borderStrong: string
    danger: string
    dangerFg: string
    success: string
    accent: string
  }
  radius: {
    sm: string
    md: string
    lg: string
    pill: string
  }
  spacing: {
    xs: string
    sm: string
    md: string
    lg: string
    xl: string
  }
  font: {
    sizeXs: string
    sizeSm: string
    sizeMd: string
    sizeLg: string
    sizeXl: string
    family: string
    mono: string
  }
  shadow: {
    sm: string
    md: string
    lg: string
  }
}

// Default light theme — Murasaki purple palette.
export const defaultLightTheme: Theme = {
  colors: {
    primary: '#A855F7',
    primaryFg: '#ffffff',
    primaryDeep: '#7C3AED',
    secondary: 'rgba(168, 85, 247, 0.08)',
    secondaryFg: '#5B21B6',
    background: '#ffffff',
    surface: 'rgba(255,255,255,0.78)',
    surfaceMuted: 'rgba(168, 85, 247, 0.04)',
    text: '#1a0a33',
    textMuted: 'rgba(0,0,0,0.55)',
    border: 'rgba(0,0,0,0.06)',
    borderStrong: 'rgba(0,0,0,0.12)',
    danger: '#dc2626',
    dangerFg: '#ffffff',
    success: '#16a34a',
    accent: '#C084FC',
  },
  radius: {
    sm: '4px',
    md: '8px',
    lg: '12px',
    pill: '999px',
  },
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '20px',
    xl: '32px',
  },
  font: {
    sizeXs: '11px',
    sizeSm: '12px',
    sizeMd: '13px',
    sizeLg: '15px',
    sizeXl: '20px',
    family:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    mono: '"SF Mono", Menlo, monospace',
  },
  shadow: {
    sm: '0 1px 2px rgba(0,0,0,0.04)',
    md: '0 4px 12px rgba(168, 85, 247, 0.08)',
    lg: '0 24px 80px rgba(0,0,0,0.18)',
  },
}

// Default dark theme — same palette, inverted surfaces.
export const defaultDarkTheme: Theme = {
  ...defaultLightTheme,
  colors: {
    ...defaultLightTheme.colors,
    primary: '#C084FC',
    primaryFg: '#1a0a33',
    primaryDeep: '#A855F7',
    secondary: 'rgba(192, 132, 252, 0.16)',
    secondaryFg: '#d8b4fe',
    background: '#0a0612',
    surface: 'rgba(34, 22, 60, 0.78)',
    surfaceMuted: 'rgba(192, 132, 252, 0.08)',
    text: '#faf8ff',
    textMuted: 'rgba(255,255,255,0.55)',
    border: 'rgba(255,255,255,0.08)',
    borderStrong: 'rgba(255,255,255,0.16)',
    danger: '#ef4444',
    success: '#22c55e',
    accent: '#A855F7',
  },
}

// Convert a Theme into a CSS variable declaration block (single string).
// Keys flatten as `--murasaki-<group>-<key>`.
export function themeToCss(theme: Theme): string {
  let css = ''
  for (const [group, vars] of Object.entries(theme) as Array<
    [string, Record<string, string>]
  >) {
    for (const [k, v] of Object.entries(vars)) {
      css += `--murasaki-${group}-${kebab(k)}: ${v};`
    }
  }
  return css
}

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}

// Convenient token references for components (replace hardcoded literals).
export const T = {
  primary: 'var(--murasaki-colors-primary)',
  primaryFg: 'var(--murasaki-colors-primary-fg)',
  primaryDeep: 'var(--murasaki-colors-primary-deep)',
  secondary: 'var(--murasaki-colors-secondary)',
  secondaryFg: 'var(--murasaki-colors-secondary-fg)',
  background: 'var(--murasaki-colors-background)',
  surface: 'var(--murasaki-colors-surface)',
  surfaceMuted: 'var(--murasaki-colors-surface-muted)',
  text: 'var(--murasaki-colors-text)',
  textMuted: 'var(--murasaki-colors-text-muted)',
  border: 'var(--murasaki-colors-border)',
  borderStrong: 'var(--murasaki-colors-border-strong)',
  danger: 'var(--murasaki-colors-danger)',
  dangerFg: 'var(--murasaki-colors-danger-fg)',
  success: 'var(--murasaki-colors-success)',
  accent: 'var(--murasaki-colors-accent)',
  radiusSm: 'var(--murasaki-radius-sm)',
  radiusMd: 'var(--murasaki-radius-md)',
  radiusLg: 'var(--murasaki-radius-lg)',
  radiusPill: 'var(--murasaki-radius-pill)',
  spacingXs: 'var(--murasaki-spacing-xs)',
  spacingSm: 'var(--murasaki-spacing-sm)',
  spacingMd: 'var(--murasaki-spacing-md)',
  spacingLg: 'var(--murasaki-spacing-lg)',
  spacingXl: 'var(--murasaki-spacing-xl)',
  fontSizeXs: 'var(--murasaki-font-size-xs)',
  fontSizeSm: 'var(--murasaki-font-size-sm)',
  fontSizeMd: 'var(--murasaki-font-size-md)',
  fontSizeLg: 'var(--murasaki-font-size-lg)',
  fontSizeXl: 'var(--murasaki-font-size-xl)',
  fontFamily: 'var(--murasaki-font-family)',
  fontMono: 'var(--murasaki-font-mono)',
  shadowSm: 'var(--murasaki-shadow-sm)',
  shadowMd: 'var(--murasaki-shadow-md)',
  shadowLg: 'var(--murasaki-shadow-lg)',
}
