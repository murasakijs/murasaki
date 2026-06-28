// scripts/print-logo.mjs
// CLI logo prototyping — run with: node scripts/print-logo.mjs
//
// Pick the variant that looks best in your terminal, then we'll bake
// it into create-murasaki and the murasaki CLI.

// ── colors ──────────────────────────────────────────────────────────────
const BRIGHT = '\x1b[38;2;168;85;247m'   // #A855F7
const DEEP   = '\x1b[38;2;91;33;182m'    // #5B21B6
const DARK   = '\x1b[38;2;59;7;100m'     // #3B0764
const MUTED  = '\x1b[38;5;245m'
const BOLD   = '\x1b[1m'
const DIM    = '\x1b[2m'
const RESET  = '\x1b[0m'

// ── A: Diamond crystals, Tall-Short-Tall ────────────────────────────────
const variantA = `
${BRIGHT}    ◆          ◆${RESET}
${BRIGHT}   ◆◆◆        ◆◆◆${RESET}
${BRIGHT}  ◆◆◆◆◆   ◆   ◆◆◆◆◆${RESET}
${DEEP}  ◆◆◆◆◆  ◆◆◆  ◆◆◆◆◆${RESET}
${DEEP}   ◆◆◆    ◆    ◆◆◆${RESET}
${DARK}    ◆          ◆${RESET}
`

// ── B: Block crystals (denser) ──────────────────────────────────────────
const variantB = `
${BRIGHT}   ▲           ▲${RESET}
${BRIGHT}  ▲▲▲    ▲    ▲▲▲${RESET}
${BRIGHT} ▲▲▲▲▲  ▲▲▲  ▲▲▲▲▲${RESET}
${DEEP} ▲▲▲▲▲  ▲▲▲  ▲▲▲▲▲${RESET}
${DEEP}  ▼▼▼    ▼    ▼▼▼${RESET}
${DARK}   ▼           ▼${RESET}
`

// ── C: Compact (one row, decorative dots) ───────────────────────────────
const variantC = `${BRIGHT}◆${DEEP}◇${BRIGHT}◆${RESET}  ${BOLD}murasaki${RESET}  ${DIM}🟣${RESET}`

// ── D: With wordmark (recommended for create-murasaki banner) ────────────
const variantD = `
${BRIGHT}   ◆          ◆${RESET}
${BRIGHT}  ◆◆◆        ◆◆◆${RESET}      ${BOLD}murasaki${RESET}
${BRIGHT} ◆◆◆◆◆   ◆   ◆◆◆◆◆${RESET}    ${MUTED}desktop apps for Next.js developers${RESET}
${DEEP} ◆◆◆◆◆  ◆◆◆  ◆◆◆◆◆${RESET}
${DEEP}  ◆◆◆    ◆    ◆◆◆${RESET}
${DARK}   ◆          ◆${RESET}
`

// ── E: Half-block + gradient feel ───────────────────────────────────────
const variantE = `
${BRIGHT}  ▟▙        ▟▙${RESET}
${BRIGHT} ▟██▙  ▟▙  ▟██▙${RESET}
${DEEP} ████  ██  ████${RESET}
${DEEP}  ▜█▛  ▜▛  ▜█▛${RESET}
${DARK}   ▀          ▀${RESET}
`

console.log('\n─── A: Diamond crystals (Tall-Short-Tall) ──────────────')
console.log(variantA)
console.log('─── B: Block crystals (denser) ─────────────────────────')
console.log(variantB)
console.log('─── C: Compact one-line ────────────────────────────────')
console.log('\n' + variantC + '\n')
console.log('─── D: With wordmark + tagline (banner) ────────────────')
console.log(variantD)
console.log('─── E: Half-block gradient ─────────────────────────────')
console.log(variantE)
