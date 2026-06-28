// ANSI truecolor palette (Oomurasaki) + helper.

export const BRIGHT = '\x1b[38;2;168;85;247m'
export const DEEP = '\x1b[38;2;91;33;182m'
export const CREAM = '\x1b[38;2;250;245;232m'
export const DARK = '\x1b[38;2;59;7;100m'
export const DIM = '\x1b[38;2;136;136;153m'
export const GREEN = '\x1b[38;2;76;175;80m'
export const RED = '\x1b[38;2;239;68;68m'
export const BOLD = '\x1b[1m'
export const RESET = '\x1b[0m'

export const noColor = Boolean(process.env.NO_COLOR) || !process.stdout.isTTY

/** Wrap an ANSI escape; returns '' if colors are disabled. */
export const c = (code: string): string => (noColor ? '' : code)
