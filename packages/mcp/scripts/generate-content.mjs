import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(packageRoot, '../..')
const docsRoot = join(repoRoot, 'apps/docs/content/docs')
const outputRoot = join(packageRoot, 'content')

try {
  await stat(docsRoot)
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
  await Promise.all(['docs.json', 'capabilities.json', 'config-schema.json', 'recipes.json']
    .map((name) => readFile(join(outputRoot, name), 'utf8').then(JSON.parse)))
  process.stdout.write('Murasaki source tree is unavailable; validated packaged MCP knowledge.\n')
  process.exit(0)
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  }))
  return nested.flat()
}

function parseFrontmatter(source) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source)
  const values = {}
  if (!match) return { values, body: source }
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    const raw = line.slice(separator + 1).trim()
    values[key] = raw.replace(/^(["'])(.*)\1$/, '$2')
  }
  return { values, body: source.slice(match[0].length) }
}

function cleanMdx(source) {
  const lines = source.split('\n')
  const output = []
  let fenced = false
  let importing = false
  for (const line of lines) {
    if (/^\s*```/.test(line)) fenced = !fenced
    if (!fenced && /^\s*import\s/.test(line)) importing = true
    if (importing) {
      if (/;\s*$/.test(line) || /\sfrom\s+["'][^"']+["']\s*;?\s*$/.test(line)) importing = false
      continue
    }
    if (!fenced && /^\s*export\s+(default\s+)?(const|function|class)\s/.test(line)) continue
    if (!fenced && /^\s*<\/?[A-Z][^>]*>\s*$/.test(line)) continue
    output.push(line.replace(/<\/?(?:Callout|Cards|Steps|Tabs|Tab)[^>]*>/g, ''))
  }
  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function docIdentity(path) {
  const rel = relative(docsRoot, path).replaceAll('\\', '/')
  const locale = rel.endsWith('.ja.mdx') ? 'ja' : 'en'
  let slug = rel.replace(/\.ja\.mdx$|\.mdx$/, '')
  if (slug.endsWith('/index')) slug = slug.slice(0, -'/index'.length)
  if (slug === 'index') slug = ''
  return { locale, slug }
}

const files = (await walk(docsRoot)).filter((path) => path.endsWith('.mdx')).sort()
const documents = []
for (const path of files) {
  const raw = await readFile(path, 'utf8')
  const { values, body } = parseFrontmatter(raw)
  const { locale, slug } = docIdentity(path)
  documents.push({
    locale,
    slug,
    title: values.title ?? slug.split('/').at(-1) ?? 'Murasaki',
    description: values.description ?? '',
    url: `https://murasaki.ichi10.com/${locale === 'ja' ? 'ja/' : ''}docs${slug ? `/${slug}` : ''}`,
    content: cleanMdx(body),
  })
}

const capabilities = JSON.parse(await readFile(join(repoRoot, 'packages/murasaki/capabilities.json'), 'utf8'))
const recipes = [
  ['routing', 'guides/routing'],
  ['server-actions', 'guides/server-actions'],
  ['api-routes', 'guides/api-routes'],
  ['native-context-menu', 'guides/context-menu'],
  ['application-menu', 'guides/app-menu'],
  ['multi-window-permissions', 'guides/windows'],
  ['node-main-lifecycle', 'guides/node-main'],
  ['tray-icon', 'guides/native-apis'],
  ['global-shortcuts', 'guides/native-apis'],
  ['system-permissions', 'guides/native-apis'],
  ['auto-update', 'guides/auto-update'],
  ['deep-links-and-file-associations', 'guides/deep-links'],
  ['configuration', 'building/configuration'],
  ['security-and-csp', 'building/security'],
  ['package-and-distribute', 'building/distribution'],
].map(([id, slug]) => ({ id, slug }))

await mkdir(outputRoot, { recursive: true })
await Promise.all([
  writeFile(join(outputRoot, 'docs.json'), `${JSON.stringify({ schemaVersion: 1, documents }, null, 2)}\n`),
  writeFile(join(outputRoot, 'capabilities.json'), `${JSON.stringify(capabilities, null, 2)}\n`),
  writeFile(join(outputRoot, 'recipes.json'), `${JSON.stringify({ schemaVersion: 1, recipes }, null, 2)}\n`),
])

process.stderr.write(`generated ${documents.length} MCP documentation records and ${capabilities.features.length} capabilities\n`)
