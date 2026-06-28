// Banner + status output for the dev runner.

import { projectRoot, VERSION, WEBVIEW_ENGINE } from '../env.ts'
import { BOLD, BRIGHT, c, DIM, GREEN, RED, RESET } from './colors.ts'

const out = (s: string) => process.stdout.write(s)

export function printBanner(winTitle: string, winSize: { width: number; height: number }) {
  out('\n')
  out(`   ${c(BOLD)}${c(BRIGHT)}🦋 Murasaki${c(RESET)} ${c(DIM)}${VERSION}${c(RESET)}\n\n`)
  out(`   ${c(DIM)}-${c(RESET)} ${c(DIM)}Project    ${c(RESET)}${projectRoot}\n`)
  out(
    `   ${c(DIM)}-${c(RESET)} ${c(DIM)}Window     ${c(RESET)}${winTitle} ${c(DIM)}(${winSize.width}×${winSize.height})${c(RESET)}\n`,
  )
  out(`   ${c(DIM)}-${c(RESET)} ${c(DIM)}Webview    ${c(RESET)}${WEBVIEW_ENGINE}\n`)
  out(`   ${c(DIM)}-${c(RESET)} ${c(DIM)}Runtime    ${c(RESET)}Node ${process.version}\n`)
  out(
    `   ${c(DIM)}-${c(RESET)} ${c(DIM)}Mode       ${c(RESET)}development ${c(DIM)}(HMR active)${c(RESET)}\n\n`,
  )
}

export function printShortcuts() {
  out(
    `   ${c(DIM)}Shortcuts  ${c(RESET)}${c(BOLD)}o${c(RESET)} ${c(DIM)}open${c(RESET)}   ${c(BOLD)}r${c(RESET)} ${c(DIM)}restart${c(RESET)}   ${c(BOLD)}q${c(RESET)} ${c(DIM)}quit${c(RESET)}\n\n`,
  )
}

export const printStarting = () => out(` ${c(DIM)}○${c(RESET)} Starting...\n`)
export const printReady = (ms: number) =>
  out(
    ` ${c(GREEN)}${c(BOLD)}✓${c(RESET)} ${c(BOLD)}Ready${c(RESET)} ${c(DIM)}in ${ms}ms${c(RESET)}\n`,
  )
export const printOpened = () => out(` ${c(GREEN)}${c(BOLD)}✓${c(RESET)} Window opened\n`)
export const printClosed = () =>
  out(
    ` ${c(DIM)}○${c(RESET)} Window closed   ${c(DIM)}— press ${c(RESET)}${c(BOLD)}o${c(RESET)}${c(DIM)} to re-open, ${c(RESET)}${c(BOLD)}q${c(RESET)}${c(DIM)} to quit${c(RESET)}\n`,
  )
export const printReloaded = (file: string) =>
  out(` ${c(BRIGHT)}${c(BOLD)}↻${c(RESET)} Reloaded ${c(DIM)}${file}${c(RESET)}\n`)
export const printBye = () => out(`\n ${c(DIM)}Bye 🦋${c(RESET)}\n\n`)
export const printHint = (msg: string) => out(` ${c(DIM)}· ${msg}${c(RESET)}\n`)
export const printError = (msg: string) => out(` ${c(RED)}${c(BOLD)}✗${c(RESET)} ${msg}\n`)
