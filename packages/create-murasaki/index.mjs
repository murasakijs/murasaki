#!/usr/bin/env node
// create-murasaki — Scaffolder for Murasaki apps.
// Usage: npm create murasaki@latest my-app

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import {
  getTelemetryPreference,
  recordCreateCompleted,
  setTelemetryEnabled,
} from './telemetry.mjs'

// ── ANSI truecolor (Oomurasaki palette) ────────────────────────────────
const BRIGHT = '\x1b[38;2;168;85;247m'
const DEEP   = '\x1b[38;2;91;33;182m'
const CREAM  = '\x1b[38;2;250;245;232m'
const DARK   = '\x1b[38;2;59;7;100m'
const DIM    = '\x1b[38;2;136;136;153m'
const GREEN  = '\x1b[38;2;76;175;80m'
const RED    = '\x1b[38;2;239;68;68m'
const BOLD   = '\x1b[1m'
const RESET  = '\x1b[0m'

const BG_BRIGHT = '\x1b[48;2;168;85;247m'
const BG_DEEP   = '\x1b[48;2;91;33;182m'
const BG_CREAM  = '\x1b[48;2;250;245;232m'
const BG_DARK   = '\x1b[48;2;59;7;100m'

const noColor = process.env.NO_COLOR || !process.stdout.isTTY
const c = (code) => (noColor ? '' : code)

// ── H4 butterfly grid (19 col × 12 row) ────────────────────────────────
const GRID = [
  '.....b.......b.....',
  '......b.....b......',
  '...bbbb.....bbbb...',
  '..bbbbbb...bbbbbb..',
  '.bbbbcbbb.bbbcbbbb.',
  '.bbbbbbbb.bbbbbbbb.',
  '..bbbbbbb.bbbbbbb..',
  '...bbbbb...bbbbb...',
  '...................',
  '.....ddd...ddd.....',
  '....ddddd.ddddd....',
  '.....dddd.dddd.....',
]
const FG_OF = { b: BRIGHT, d: DEEP, c: CREAM, k: DARK }
const BG_OF = { b: BG_BRIGHT, d: BG_DEEP, c: BG_CREAM, k: BG_DARK }
const GRID_WIDTH = GRID[0].length

function renderButterflyLines() {
  const out = []
  for (let r = 0; r < GRID.length; r += 2) {
    const top = GRID[r] || '.'.repeat(GRID_WIDTH)
    const bot = GRID[r + 1] || '.'.repeat(GRID_WIDTH)
    let line = ''
    for (let col = 0; col < GRID_WIDTH; col++) {
      const tCh = top[col]
      const bCh = bot[col]
      const tFg = FG_OF[tCh]
      const bFg = FG_OF[bCh]
      if (!tFg && !bFg) line += ' '
      else if (tFg && !bFg) line += c(tFg) + '▀' + c(RESET)
      else if (!tFg && bFg) line += c(bFg) + '▄' + c(RESET)
      else if (tCh === bCh) line += c(tFg) + '█' + c(RESET)
      else line += c(tFg) + c(BG_OF[bCh]) + '▀' + c(RESET)
    }
    out.push(line)
  }
  return out
}

// figlet -f standard murasaki  (kept verbatim so the "i" dot lines up with |_|)
const WORDMARK_LINES = [
  '                                     _    _ ',
  ' _ __ ___  _   _ _ __ __ _ ___  __ _| | _(_)',
  "| '_ ` _ \\| | | | '__/ _` / __|/ _` | |/ / |",
  '| | | | | | |_| | | | (_| \\__ \\ (_| |   <| |',
  '|_| |_| |_|\\__,_|_|  \\__,_|___/\\__,_|_|\\_\\_|',
]

function colorize(line, color, opts = {}) {
  return (opts.bold ? c(BOLD) : '') + c(color) + line + c(RESET)
}

function renderBanner() {
  const bf = renderButterflyLines()
  const wm = WORDMARK_LINES.map((l) => colorize(l, BRIGHT, { bold: true }))
  const gap = '   '
  const total = Math.max(bf.length, wm.length)
  const wmOffset = Math.max(0, Math.floor((bf.length - wm.length) / 2))
  const blankBf = ' '.repeat(GRID_WIDTH)
  const lines = []
  for (let i = 0; i < total; i++) {
    const bfLine = bf[i] !== undefined ? bf[i] : blankBf
    const wmIdx = i - wmOffset
    const wmLine = (wmIdx >= 0 && wmIdx < wm.length) ? wm[wmIdx] : ''
    lines.push('  ' + bfLine + gap + wmLine)
  }
  return lines.join('\n')
}

// ── Output helpers ─────────────────────────────────────────────────────
const log = (s) => process.stdout.write(s + '\n')

function isValidPackageName(name) {
  return /^[a-z0-9][a-z0-9._-]*$/.test(name)
}

function detectPackageManager() {
  const ua = process.env.npm_config_user_agent || ''
  if (ua.startsWith('pnpm')) return 'pnpm'
  if (ua.startsWith('yarn')) return 'yarn'
  if (ua.startsWith('bun'))  return 'bun'
  return 'npm'
}

function installArgs(pm) {
  // Note: no `--ignore-workspace` for pnpm — the scaffold ships its own
  // pnpm-workspace.yaml (which also carries the build-script allow-list), so
  // pnpm already treats the new app as its own root even inside a parent
  // workspace. `--ignore-workspace` would make pnpm skip that file's settings,
  // re-triggering ERR_PNPM_IGNORED_BUILDS.
  if (pm === 'pnpm') return ['install']
  return ['install']
}

// Async on purpose: the caller shows a spinner while this runs, and the
// spinner animates on a timer. A synchronous spawnSync would block the event
// loop for the whole install, freezing the spinner on its first frame — so we
// spawn and await instead, keeping the loop free to render frames.
function runInstall(targetDir, pm) {
  return new Promise((resolve) => {
    const child = spawn(pm, installArgs(pm), {
      cwd: targetDir,
      stdio: ['ignore', 'ignore', 'pipe'],   // capture stderr, keep the spinner clean
      shell: process.platform === 'win32',
    })
    let stderr = ''
    child.stderr?.on('data', (d) => { stderr += d })
    child.on('error', (err) => resolve({ status: 1, stderr: String(err?.message ?? err) }))
    child.on('close', (code) => resolve({ status: code ?? 1, stderr }))
  })
}

function hasGit() {
  const result = spawnSync('git', ['--version'], { stdio: 'ignore' })
  return !result.error && result.status === 0
}

function isInsideGitRepo(targetDir) {
  const result = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: targetDir,
    stdio: 'ignore',
  })
  return result.status === 0
}

function initGit(targetDir) {
  const run = (args) => spawnSync('git', args, { cwd: targetDir, stdio: 'ignore' })
  const init = run(['init'])
  if (init.status !== 0) {
    log(c(DIM) + '  → git init failed, skipping.' + c(RESET))
    return
  }
  run(['add', '-A'])
  const commit = run(['commit', '-m', 'Initial commit from create-murasaki'])
  if (commit.status !== 0) {
    log(c(DIM) + '  → git initialized, but the initial commit failed.' + c(RESET))
    return
  }
  log(c(GREEN) + '  ✔' + c(RESET) + ' Git initialized')
}

async function ask(message, defaultValue) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(`${c(BRIGHT)}?${c(RESET)} ${message} (${defaultValue}) `)
    return answer.trim() || defaultValue
  } finally {
    rl.close()
  }
}

async function promptForName() {
  while (true) {
    const name = await ask('Project name', 'my-app')
    if (isValidPackageName(name)) return name
    log(
      c(RED) +
        '  Use lowercase letters, digits, dot, hyphen, underscore. Start with a letter or digit.' +
        c(RESET),
    )
  }
}

async function promptForLinter() {
  log(`${c(BRIGHT)}?${c(RESET)} Which linter would you like to use?`)
  log(`  1) ${c(BOLD)}Biome${c(RESET)} — fast, single tool, recommended`)
  log(`  2) ${c(BOLD)}ESLint${c(RESET)} — classic, huge ecosystem`)
  log(`  3) ${c(BOLD)}None${c(RESET)} — add your own later`)
  const choices = new Map([
    ['1', 'biome'],
    ['biome', 'biome'],
    ['2', 'eslint'],
    ['eslint', 'eslint'],
    ['3', 'none'],
    ['none', 'none'],
  ])
  while (true) {
    const answer = (await ask('Choose 1–3', '1')).toLowerCase()
    const linter = choices.get(answer)
    if (linter) return linter
    log(c(RED) + '  Enter 1, 2, 3, biome, eslint, or none.' + c(RESET))
  }
}

async function promptForTelemetry() {
  log(
    c(DIM) +
      '  Sends only version, OS/arch, timestamp, and a random install ID. ' +
      'Details: https://murasaki.ichi10.com/docs/building/cli#murasaki-telemetry' +
      c(RESET),
  )
  const answer = (await ask('Share anonymous CLI usage to help improve Murasaki? y/N', 'N')).toLowerCase()
  return answer === 'y' || answer === 'yes'
}

function startSpinner(text) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  let frame = 0
  let timer
  if (process.stdout.isTTY) {
    process.stdout.write(`${frames[frame]} ${text}`)
    timer = setInterval(() => {
      frame = (frame + 1) % frames.length
      process.stdout.write(`\r${frames[frame]} ${text}`)
    }, 80)
  } else {
    log(`  ${text}...`)
  }

  const finish = (symbol, message) => {
    if (timer) clearInterval(timer)
    if (process.stdout.isTTY) process.stdout.write(`\r\x1b[2K${symbol} ${message}\n`)
    else log(`${symbol} ${message}`)
  }
  return {
    success: ({ text: message }) => finish('✔', message),
    error: ({ text: message }) => finish('✖', message),
  }
}

async function applyBiome(targetDir) {
  const biomeJson = `{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "includes": ["src/**/*.{ts,tsx,js,jsx}", "!**/node_modules", "!**/dist"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": { "preset": "recommended" }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "semicolons": "asNeeded",
      "trailingCommas": "all"
    }
  }
}
`
  await writeFile(join(targetDir, 'biome.json'), biomeJson)
  const pkgPath = join(targetDir, 'package.json')
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  pkg.scripts = pkg.scripts || {}
  pkg.scripts.lint = 'biome check .'
  pkg.scripts.format = 'biome format --write .'
  pkg.devDependencies = pkg.devDependencies || {}
  pkg.devDependencies['@biomejs/biome'] = '2.5.4'
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  // @biomejs/biome ships a native binary via a postinstall; it's already in the
  // template's pnpm-workspace.yaml build allow-list, so nothing else is needed.
}

async function applyEslint(targetDir) {
  const cfg = `import js from '@eslint/js'
import react from 'eslint-plugin-react'

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    plugins: { react },
    rules: { 'react/jsx-uses-react': 'off' },
  },
]
`
  await writeFile(join(targetDir, 'eslint.config.js'), cfg)
  const pkgPath = join(targetDir, 'package.json')
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  pkg.scripts = pkg.scripts || {}
  pkg.scripts.lint = 'eslint src'
  pkg.devDependencies = pkg.devDependencies || {}
  pkg.devDependencies['eslint'] = '^9.0.0'
  pkg.devDependencies['@eslint/js'] = '^9.0.0'
  pkg.devDependencies['eslint-plugin-react'] = '^7.35.0'
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
}

async function copyTemplate(templateDir, targetDir, appName) {
  await mkdir(targetDir, { recursive: true })
  await cp(templateDir, targetDir, {
    recursive: true,
    filter(src) {
      // Match against the path *inside* the template only. `src` is absolute,
      // and when create-murasaki is installed it lives under node_modules — so
      // checking the absolute path would exclude every template file. Slice off
      // templateDir first so an ancestor node_modules doesn't trigger this.
      const rel = src.slice(templateDir.length)
      return !/(?:^|\/)node_modules(?:\/|$)/.test(rel) && !/(?:^|\/)dist(?:\/|$)/.test(rel)
    },
  })

  const { rm } = await import('node:fs/promises')

  // Rename gitignore.tpl → .gitignore (npm strips leading dots)
  const gitignoreTpl = join(targetDir, 'gitignore.tpl')
  if (existsSync(gitignoreTpl)) {
    await cp(gitignoreTpl, join(targetDir, '.gitignore'))
    await rm(gitignoreTpl)
  }

  // Rename pnpm-workspace.yaml.tpl → pnpm-workspace.yaml. It ships as .tpl so a
  // stray workspace file doesn't confuse the create-murasaki monorepo itself;
  // in the scaffolded app it's the pnpm settings file (build-script allow-list).
  const pnpmWsTpl = join(targetDir, 'pnpm-workspace.yaml.tpl')
  if (existsSync(pnpmWsTpl)) {
    await cp(pnpmWsTpl, join(targetDir, 'pnpm-workspace.yaml'))
    await rm(pnpmWsTpl)
  }

  const pkgPath = join(targetDir, 'package.json')
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  pkg.name = appName
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
}

const LINTERS = ['biome', 'eslint', 'none']

/**
 * `--yes` / `-y` takes every default without asking, and `--linter <name>`
 * answers just that question — so the scaffolder can run unattended, from a
 * script or from CI. Without one of these it prompts, and a piped stdin makes
 * the prompt abort, which meant `npm create murasaki` simply couldn't be
 * automated.
 */
function parseArgs(argv) {
  let name
  let skipInstall = false
  let noGit = false
  let yes = false
  let linter
  let telemetry
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--skip-install') skipInstall = true
    else if (arg === '--no-git') noGit = true
    else if (arg === '--yes' || arg === '-y') yes = true
    else if (arg === '--telemetry') telemetry = true
    else if (arg === '--no-telemetry') telemetry = false
    else if (arg === '--linter') linter = argv[++i]
    else if (arg.startsWith('--linter=')) linter = arg.slice('--linter='.length)
    else if (!arg.startsWith('-') && name === undefined) name = arg
  }
  if (linter !== undefined && !LINTERS.includes(linter)) {
    log(c(RED) + `  ✗ --linter must be one of: ${LINTERS.join(', ')}` + c(RESET))
    process.exit(1)
  }
  return { name, skipInstall, noGit, yes, linter, telemetry }
}

async function readCliVersion(dir) {
  try {
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
    return pkg.version
  } catch {
    return null
  }
}

async function main() {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)

  const version = await readCliVersion(__dirname)
  process.stdout.write('\n' + renderBanner() + '\n')
  process.stdout.write(
    `  ${c(DIM)}create-murasaki${c(RESET)}${version ? ` ${c(BRIGHT)}v${version}${c(RESET)}` : ''}\n\n`,
  )

  const {
    name: argName,
    skipInstall,
    noGit,
    yes,
    linter: linterArg,
    telemetry: telemetryArg,
  } = parseArgs(process.argv.slice(2))

  const validName = argName && isValidPackageName(argName) ? argName : undefined
  const name = validName ?? (yes ? 'my-app' : await promptForName())
  const linter = linterArg ?? (yes ? 'biome' : await promptForLinter())
  const storedTelemetry = await getTelemetryPreference()
  const telemetry = telemetryArg ?? storedTelemetry ?? (yes ? false : await promptForTelemetry())

  const target = resolve(process.cwd(), name)
  if (existsSync(target)) {
    log(c(RED) + `  ✗ ${name} already exists.` + c(RESET))
    process.exit(1)
  }

  if (telemetryArg !== undefined || storedTelemetry === null) await setTelemetryEnabled(telemetry)

  const templateDir = join(__dirname, 'templates', 'default')
  await copyTemplate(templateDir, target, name)

  if (linter === 'biome') await applyBiome(target)
  else if (linter === 'eslint') await applyEslint(target)

  const pm = detectPackageManager()
  let installed = false
  if (!skipInstall) {
    const spinner = startSpinner('Installing dependencies')
    const res = await runInstall(target, pm)
    if (res.status === 0) {
      spinner.success({ text: 'Dependencies installed' })
      installed = true
    } else {
      spinner.error({ text: 'Install failed' })
      if (res.stderr) process.stderr.write('\n' + res.stderr.trim() + '\n')
      log(c(RED) + `  run it yourself:` + c(RESET))
      log(`      cd ${name} && ${pm} install`)
      process.exit(1)
    }
  }

  if (!noGit && hasGit() && !isInsideGitRepo(target)) {
    initGit(target)
  }

  log('')
  log(`${c(BRIGHT)}${c(BOLD)}🎉  Hello, Murasaki 🦋${c(RESET)}`)
  log('')
  log(`    cd ${name}`)
  if (!installed) log(`    ${pm} install`)
  log(`    ${pm} run dev`)
  log('')
  await recordCreateCompleted(version)
}

main().catch((err) => {
  if (err && err.name === 'ExitPromptError') {
    log('\n' + c(DIM) + '  Cancelled.' + c(RESET))
    process.exit(0)
  }
  console.error(err)
  process.exit(1)
})
