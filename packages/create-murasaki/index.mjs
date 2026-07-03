#!/usr/bin/env node
// create-murasaki — Scaffolder for Murasaki apps.
// Usage: npm create murasaki@latest my-app

import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { input, select } from '@inquirer/prompts'
import { createSpinner } from 'nanospinner'

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
  if (pm === 'pnpm') return ['install', '--ignore-workspace']
  return ['install']
}

// Async on purpose: the caller shows a nanospinner while this runs, and the
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

async function promptForName() {
  return input({
    message: 'Project name',
    default: 'my-app',
    validate(v) {
      const t = (v || '').trim()
      if (!t) return 'Please enter a project name.'
      if (!isValidPackageName(t)) return 'Use lowercase letters, digits, dot, hyphen, underscore. Start with a letter or digit.'
      return true
    },
  })
}

async function promptForLinter() {
  return select({
    message: 'Which linter would you like to use?',
    default: 'biome',
    choices: [
      { value: 'biome', name: 'Biome', description: 'fast, single tool, recommended' },
      { value: 'eslint', name: 'ESLint', description: 'classic, huge ecosystem' },
      { value: 'none', name: 'None', description: 'add your own later' },
    ],
  })
}

async function applyBiome(targetDir) {
  const biomeJson = `{
  "$schema": "https://biomejs.dev/schemas/2.5.1/schema.json",
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
    "rules": { "recommended": true }
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
  pkg.devDependencies['@biomejs/biome'] = '^2.5.1'
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
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

  // Rename gitignore.tpl → .gitignore (npm strips leading dots)
  const gitignoreTpl = join(targetDir, 'gitignore.tpl')
  if (existsSync(gitignoreTpl)) {
    await cp(gitignoreTpl, join(targetDir, '.gitignore'))
    const { rm } = await import('node:fs/promises')
    await rm(gitignoreTpl)
  }

  const pkgPath = join(targetDir, 'package.json')
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  pkg.name = appName
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
}

function parseArgs(argv) {
  let name
  let skipInstall = false
  let noGit = false
  for (const arg of argv) {
    if (arg === '--skip-install') skipInstall = true
    else if (arg === '--no-git') noGit = true
    else if (!arg.startsWith('-') && name === undefined) name = arg
  }
  return { name, skipInstall, noGit }
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

  const { name: argName, skipInstall, noGit } = parseArgs(process.argv.slice(2))
  const name = argName && isValidPackageName(argName) ? argName : await promptForName()
  const linter = await promptForLinter()

  const target = resolve(process.cwd(), name)
  if (existsSync(target)) {
    log(c(RED) + `  ✗ ${name} already exists.` + c(RESET))
    process.exit(1)
  }

  const templateDir = join(__dirname, 'templates', 'default')
  await copyTemplate(templateDir, target, name)

  if (linter === 'biome') await applyBiome(target)
  else if (linter === 'eslint') await applyEslint(target)

  const pm = detectPackageManager()
  let installed = false
  if (!skipInstall) {
    const spinner = createSpinner('Installing dependencies').start()
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
}

main().catch((err) => {
  if (err && err.name === 'ExitPromptError') {
    log('\n' + c(DIM) + '  Cancelled.' + c(RESET))
    process.exit(0)
  }
  console.error(err)
  process.exit(1)
})
