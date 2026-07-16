import { readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let knowledgePromise

async function readJson(name) {
  return JSON.parse(await readFile(join(packageRoot, 'content', name), 'utf8'))
}

export function loadKnowledge() {
  knowledgePromise ??= Promise.all([
    readJson('docs.json'),
    readJson('capabilities.json'),
    readJson('config-schema.json'),
    readJson('recipes.json'),
  ]).then(([docs, capabilities, configSchema, recipes]) => ({ docs, capabilities, configSchema, recipes }))
  return knowledgePromise
}

function tokens(value) {
  const normalized = value.toLocaleLowerCase().normalize('NFKC')
  const words = normalized.match(/[\p{L}\p{N}_@./-]+/gu) ?? []
  return [...new Set([normalized.trim(), ...words].filter(Boolean))]
}

function excerpt(content, queryTokens, maxLength = 520) {
  const normalized = content.toLocaleLowerCase().normalize('NFKC')
  const positions = queryTokens.map((token) => normalized.indexOf(token)).filter((position) => position >= 0)
  const start = positions.length > 0 ? Math.max(0, Math.min(...positions) - 120) : 0
  const value = content.slice(start, start + maxLength).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${value}${start + maxLength < content.length ? '…' : ''}`
}

export async function searchDocs({ query, locale = 'en', limit = 5 }) {
  const { docs } = await loadKnowledge()
  const queryTokens = tokens(query)
  const selected = docs.documents
    .filter((document) => locale === 'all' || document.locale === locale)
    .map((document) => {
      const title = document.title.toLocaleLowerCase().normalize('NFKC')
      const description = document.description.toLocaleLowerCase().normalize('NFKC')
      const content = document.content.toLocaleLowerCase().normalize('NFKC')
      const score = queryTokens.reduce((total, token) => {
        if (!token) return total
        return total
          + (title.includes(token) ? 12 : 0)
          + (description.includes(token) ? 6 : 0)
          + (content.includes(token) ? 1 : 0)
      }, 0)
      return { document, score }
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.document.slug.localeCompare(b.document.slug))
    .slice(0, Math.min(Math.max(limit, 1), 20))

  return {
    query,
    locale,
    results: selected.map(({ document, score }) => ({
      title: document.title,
      slug: document.slug,
      locale: document.locale,
      url: document.url,
      score,
      excerpt: excerpt(document.content, queryTokens),
    })),
  }
}

export async function getApiReference({ symbol, featureId, limit = 30 } = {}) {
  const { capabilities } = await loadKnowledge()
  const needle = symbol?.toLocaleLowerCase().normalize('NFKC')
  const matches = capabilities.features.filter((feature) => {
    if (featureId && feature.id !== featureId) return false
    if (!needle) return true
    return feature.apiSymbols.some((candidate) => candidate.toLocaleLowerCase().normalize('NFKC').includes(needle))
  }).slice(0, Math.min(Math.max(limit, 1), 100))

  return {
    frameworkVersion: capabilities.frameworkVersion,
    query: { symbol: symbol ?? null, featureId: featureId ?? null },
    features: matches.map((feature) => ({
      id: feature.id,
      category: feature.category,
      maturity: feature.status,
      platforms: feature.platforms,
      apiSymbols: feature.apiSymbols,
      limitations: feature.limitations,
      docsUrl: `https://murasaki.ichi10.com${feature.docsSlug}`,
      evidence: feature.testEvidence,
    })),
  }
}

function decodePath(path) {
  if (!path) return []
  if (path.startsWith('/')) return path.slice(1).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
  return path.split('.').filter(Boolean)
}

export async function getConfigSchema({ path } = {}) {
  const { configSchema } = await loadKnowledge()
  let current = configSchema
  const traversed = []
  for (const segment of decodePath(path)) {
    const next = current?.properties?.[segment]
    if (!next) {
      return {
        found: false,
        path: traversed.join('.'),
        requestedPath: path,
        availableProperties: Object.keys(current?.properties ?? {}),
      }
    }
    current = next
    traversed.push(segment)
  }
  return { found: true, path: traversed.join('.'), schema: current }
}

export async function listRecipes({ locale = 'en' } = {}) {
  const { docs, recipes } = await loadKnowledge()
  return {
    locale,
    recipes: recipes.recipes.map((recipe) => {
      const document = docs.documents.find((candidate) => candidate.slug === recipe.slug && candidate.locale === locale)
        ?? docs.documents.find((candidate) => candidate.slug === recipe.slug && candidate.locale === 'en')
      return {
        id: recipe.id,
        title: document?.title ?? recipe.id,
        description: document?.description ?? '',
        locale: document?.locale ?? 'en',
        url: document?.url ?? null,
      }
    }),
  }
}

export async function getRecipe({ id, locale = 'en' }) {
  const { docs, recipes } = await loadKnowledge()
  const recipe = recipes.recipes.find((candidate) => candidate.id === id)
  if (!recipe) return { found: false, id, available: recipes.recipes.map((candidate) => candidate.id) }
  const document = docs.documents.find((candidate) => candidate.slug === recipe.slug && candidate.locale === locale)
    ?? docs.documents.find((candidate) => candidate.slug === recipe.slug && candidate.locale === 'en')
  if (!document) return { found: false, id, reason: `Documentation page ${recipe.slug} is unavailable.` }
  return { found: true, id, ...document }
}

export async function checkCompatibility({ features, platform }) {
  const { capabilities } = await loadKnowledge()
  const results = features.map((id) => {
    const feature = capabilities.features.find((candidate) => candidate.id === id)
    if (!feature) return { id, verdict: 'unknown', reason: 'Feature ID is not present in the canonical capability manifest.' }
    const platformStatus = feature.platforms[platform]
    const verdict = platformStatus === 'supported' && feature.status === 'stable'
      ? 'supported'
      : platformStatus === 'unsupported'
        ? 'unsupported'
        : platformStatus === 'planned' || feature.status === 'planned'
          ? 'planned'
          : 'limited'
    return {
      id,
      verdict,
      maturity: feature.status,
      platformStatus,
      limitations: feature.limitations,
      docsUrl: `https://murasaki.ichi10.com${feature.docsSlug}`,
    }
  })
  const overall = results.some((result) => result.verdict === 'unsupported')
    ? 'unsupported'
    : results.some((result) => result.verdict === 'unknown')
      ? 'unknown'
      : results.some((result) => result.verdict === 'planned')
        ? 'planned'
        : results.some((result) => result.verdict === 'limited')
          ? 'limited'
          : 'supported'
  return { frameworkVersion: capabilities.frameworkVersion, platform, overall, results }
}

async function exists(path) {
  try {
    return await stat(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function firstExisting(root, candidates) {
  for (const candidate of candidates) {
    if (await exists(join(root, candidate))) return candidate
  }
  return null
}

export async function doctor({ projectPath = process.cwd() } = {}) {
  const root = resolve(projectPath)
  const rootStat = await exists(root)
  if (!rootStat?.isDirectory()) return { projectPath: root, overall: 'fail', checks: [{ id: 'project', status: 'fail', message: 'Project directory does not exist.' }] }

  const checks = []
  const packagePath = join(root, 'package.json')
  let packageJson
  try {
    packageJson = JSON.parse(await readFile(packagePath, 'utf8'))
    checks.push({ id: 'package-json', status: 'pass', message: 'package.json is valid JSON.' })
  } catch (error) {
    checks.push({ id: 'package-json', status: 'fail', message: `Cannot read package.json: ${error instanceof Error ? error.message : String(error)}` })
  }

  if (packageJson) {
    const dependencyVersion = packageJson.dependencies?.murasaki ?? packageJson.devDependencies?.murasaki
    checks.push(dependencyVersion
      ? { id: 'murasaki-dependency', status: 'pass', message: `murasaki dependency is ${dependencyVersion}.` }
      : { id: 'murasaki-dependency', status: 'fail', message: 'murasaki is missing from dependencies and devDependencies.' })
    const scripts = packageJson.scripts ?? {}
    checks.push(scripts.dev?.includes('murasaki')
      ? { id: 'dev-script', status: 'pass', message: `dev script: ${scripts.dev}` }
      : { id: 'dev-script', status: 'warn', message: 'No dev script invoking murasaki was found.' })
  }

  const config = await firstExisting(root, ['murasaki.config.ts', 'murasaki.config.mts', 'murasaki.config.js', 'murasaki.config.mjs'])
  checks.push(config
    ? { id: 'config', status: 'pass', message: `Found ${config}.` }
    : { id: 'config', status: 'fail', message: 'No supported murasaki.config file was found.' })

  const layout = await firstExisting(root, ['src/app/layout.tsx', 'src/app/layout.jsx', 'src/app/layout.ts', 'src/app/layout.js'])
  const page = await firstExisting(root, ['src/app/page.tsx', 'src/app/page.jsx', 'src/app/page.ts', 'src/app/page.js'])
  checks.push(layout && page
    ? { id: 'app-router', status: 'pass', message: `Found ${layout} and ${page}.` }
    : { id: 'app-router', status: 'fail', message: 'Expected src/app/layout.* and src/app/page.* entry files.' })

  const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number)
  const supportedNode = (nodeMajor === 20 && nodeMinor >= 19) || nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 12)
  checks.push(supportedNode
    ? { id: 'node', status: 'pass', message: `Node ${process.versions.node} satisfies murasaki's supported engine range.` }
    : { id: 'node', status: 'fail', message: `Node ${process.versions.node} is outside murasaki's supported range (^20.19.0 or >=22.12.0).` })

  const overall = checks.some((check) => check.status === 'fail') ? 'fail' : checks.some((check) => check.status === 'warn') ? 'warn' : 'pass'
  return { projectPath: root, overall, checks }
}
