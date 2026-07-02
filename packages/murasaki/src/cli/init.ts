import { execSync, spawnSync } from 'node:child_process'
import pc from 'picocolors'

/**
 * Optional: install Rust toolchain for people who want to hack on the
 * native binding. End users of murasaki never need this — prebuild
 * packages come down from npm.
 */
export default async function init(_argv: string[]) {
  const has = safeSync('rustc --version')
  if (has) {
    process.stdout.write(
      `\n  ${pc.green('✓')} rustc found ${pc.gray('(' + has.trim() + ')')}\n\n`,
    )
    return
  }
  process.stdout.write(
    `\n  ${pc.yellow('!')} Rust not found. Install with:\n\n    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh\n\n  Then re-run \`murasaki init\`.\n\n`,
  )
}

function safeSync(cmd: string): string | null {
  try {
    const [bin, ...rest] = cmd.split(' ')
    const r = spawnSync(bin!, rest, { encoding: 'utf8' })
    return r.status === 0 ? r.stdout : null
  } catch {
    return null
  }
}
