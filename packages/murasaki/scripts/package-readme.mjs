import { copyFile, readFile, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(packageRoot, '..', '..', 'README.md')
const destination = resolve(packageRoot, 'README.md')
const mode = process.argv[2]

if (mode === 'sync') {
  await copyFile(source, destination)
} else if (mode === 'clean') {
  // Never delete a hand-maintained package README. The temporary file is
  // removed only when it still exactly matches the canonical root README.
  const [canonical, packaged] = await Promise.all([
    readFile(source),
    readFile(destination).catch(() => null),
  ])
  if (packaged?.equals(canonical)) await rm(destination)
} else {
  throw new Error('usage: package-readme.mjs <sync|clean>')
}
