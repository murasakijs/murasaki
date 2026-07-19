import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const workflowDirectory = new URL('../.github/workflows/', import.meta.url)
const files = (await readdir(workflowDirectory))
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort()
const violations = []

for (const file of files) {
  const source = await readFile(new URL(file, workflowDirectory), 'utf8')
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const match = /^\s*-\s+uses:\s*([^\s#]+)/.exec(line)
    if (!match || match[1].startsWith('./')) continue
    const separator = match[1].lastIndexOf('@')
    const ref = separator === -1 ? '' : match[1].slice(separator + 1)
    if (!/^[0-9a-f]{40}$/.test(ref)) {
      violations.push(`${join('.github/workflows', file)}:${index + 1}: ${match[1]}`)
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(
    `GitHub Actions must use immutable 40-character commit SHAs:\n${violations.join('\n')}\n`,
  )
  process.exitCode = 1
} else {
  process.stdout.write(`Verified immutable action references in ${files.length} workflows.\n`)
}
