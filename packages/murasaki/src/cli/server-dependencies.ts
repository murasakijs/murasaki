import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { MurasakiConfig } from '../config.js'

export const SERVER_DEPENDENCIES_MANIFEST = 'runtime-dependencies.json'

export interface ServerDependenciesManifest {
  version: 1
  dependencies: string[]
}

export interface RuntimeBundleTarget {
  platform: 'darwin' | 'win32' | 'linux'
  arch: 'arm64' | 'x64'
}

interface PackageJson {
  name?: string
  main?: string
  module?: string
  exports?: unknown
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

const RESERVED_RESOURCE_NAMES = new Set([
  '.murasaki-runtime',
  'client',
  'server',
  'node_modules',
  'prod-server.mjs',
  'wire.mjs',
  'updater-engine.mjs',
  'murasaki-meta.json',
  'menu-locales.json',
  'node',
  'node.exe',
])

/** Returns the npm package part of a bare import, or null for local/virtual ids. */
export function packageNameFromImport(id: string): string | null {
  if (
    id.length === 0 ||
    id.startsWith('.') ||
    id.startsWith('/') ||
    id.startsWith('\0') ||
    id.startsWith('virtual:') ||
    id.startsWith('node:') ||
    id.startsWith('@/') ||
    id.startsWith('#') ||
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(id)
  ) {
    return null
  }
  const parts = id.split('/')
  return id.startsWith('@') ? (parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null) : parts[0]
}

export async function readServerDependenciesManifest(
  serverDir: string,
): Promise<ServerDependenciesManifest> {
  const path = join(serverDir, SERVER_DEPENDENCIES_MANIFEST)
  if (!existsSync(path)) return { version: 1, dependencies: [] }
  const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<ServerDependenciesManifest>
  if (
    parsed.version !== 1 ||
    !Array.isArray(parsed.dependencies) ||
    parsed.dependencies.some((value) => typeof value !== 'string')
  ) {
    throw new Error(`murasaki: invalid server dependency manifest at ${path}`)
  }
  return { version: 1, dependencies: [...new Set(parsed.dependencies)].sort() }
}

/**
 * Copy statically detected and explicitly configured Node runtime packages
 * into <resources>/node_modules. Packages are copied as real directories (no
 * pnpm/workspace symlinks), and conflicting transitive versions remain nested
 * below their parent package so Node's normal resolution semantics survive.
 */
export async function stageServerDependencies(
  projectRoot: string,
  serverDir: string,
  resourcesDir: string,
  config: MurasakiConfig,
  target?: RuntimeBundleTarget,
): Promise<string[]> {
  const manifest = await readServerDependenciesManifest(serverDir)
  const names = [...new Set([...manifest.dependencies, ...(config.bundle?.external ?? [])])].sort()
  if (names.length === 0) return []

  const nodeModulesDir = join(resourcesDir, 'node_modules')
  await mkdir(nodeModulesDir, { recursive: true })

  const roots = new Map<string, string>()
  for (const name of names) {
    if (name === '@murasakijs/native') continue
    const root = await resolveInstalledPackage(name, projectRoot, false)
    if (!root) {
      throw new Error(
        `murasaki: production dependency ${JSON.stringify(name)} is not installed. ` +
          'Declare it in dependencies (not only devDependencies), install it, and bundle again.',
      )
    }
    roots.set(name, root)
  }

  const copied = new Set<string>()
  for (const [name, root] of roots) {
    await copyPackageTree({
      name,
      sourceRoot: root,
      destination: join(nodeModulesDir, ...name.split('/')),
      projectRoot,
      topLevelRoots: roots,
      copied,
      ancestry: new Set(),
      target,
    })
  }
  if (roots.has('@prisma/client')) {
    await stagePrismaGeneratedClient(projectRoot, nodeModulesDir)
  }
  return [...roots.keys()]
}

interface CopyPackageOptions {
  name: string
  sourceRoot: string
  destination: string
  projectRoot: string
  topLevelRoots: Map<string, string>
  copied: Set<string>
  ancestry: Set<string>
  target?: RuntimeBundleTarget
}

async function copyPackageTree(options: CopyPackageOptions): Promise<void> {
  const sourceRoot = await realpath(options.sourceRoot)
  const destination = resolve(options.destination)
  const copyKey = `${sourceRoot}\0${destination}`
  if (options.copied.has(copyKey)) return
  options.copied.add(copyKey)
  if (options.target) {
    await assertNativeTargetCompatibility(options.name, sourceRoot, options.target)
  }
  const packageJson = await readPackageJson(sourceRoot)
  assertPackageRuntimeEntry(options.name, sourceRoot, packageJson)

  await mkdir(dirname(destination), { recursive: true })
  await cp(sourceRoot, destination, {
    recursive: true,
    dereference: true,
    force: true,
    filter: (source) => {
      const rel = relative(sourceRoot, source)
      if (rel === '') return true
      const top = rel.split(sep)[0]
      return top !== 'node_modules' && top !== '.git'
    },
  })

  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.optionalDependencies,
    ...packageJson.peerDependencies,
  }
  const optional = new Set([
    ...Object.keys(packageJson.optionalDependencies ?? {}),
    ...Object.entries(packageJson.peerDependenciesMeta ?? {})
      .filter(([, meta]) => meta.optional)
      .map(([name]) => name),
  ])
  const ancestry = new Set(options.ancestry).add(sourceRoot)

  for (const name of Object.keys(dependencies).sort()) {
    const dependencyRoot = await resolveInstalledPackage(name, sourceRoot, optional.has(name))
    if (!dependencyRoot) {
      if (optional.has(name)) continue
      throw new Error(
        `murasaki: ${JSON.stringify(packageJson.name ?? options.name)} requires production dependency ` +
          `${JSON.stringify(name)}, but it is not installed. Install a compatible version and bundle again.`,
      )
    }
    const normalizedRoot = await realpath(dependencyRoot)
    const topLevel = options.topLevelRoots.get(name)
    if (topLevel && (await realpath(topLevel)) === normalizedRoot) {
      // Node will find the already-staged top-level copy by walking upward.
      continue
    }
    if (ancestry.has(normalizedRoot)) {
      // Package-manager layouts hoist dependency cycles. Avoid recursing
      // forever; an ancestor/top-level copy is the canonical cycle target.
      continue
    }
    await copyPackageTree({
      name,
      sourceRoot: normalizedRoot,
      destination: join(destination, 'node_modules', ...name.split('/')),
      projectRoot: options.projectRoot,
      topLevelRoots: options.topLevelRoots,
      copied: options.copied,
      ancestry,
      target: options.target,
    })
  }
}

function assertPackageRuntimeEntry(
  packageName: string,
  packageRoot: string,
  packageJson: PackageJson,
): void {
  const candidates = packageEntryCandidates(packageJson)
  if (candidates.length === 0) return
  if (candidates.some((entry) => existsSync(resolve(packageRoot, entry)))) return
  throw new Error(
    `murasaki: production entry for ${JSON.stringify(packageName)} is missing. Expected one of: ` +
      `${candidates.join(', ')}. Build this workspace/package before running murasaki bundle.`,
  )
}

function packageEntryCandidates(packageJson: PackageJson): string[] {
  const candidates: string[] = []
  const rootExport =
    packageJson.exports && typeof packageJson.exports === 'object' && !Array.isArray(packageJson.exports)
      ? (packageJson.exports as Record<string, unknown>)['.'] ??
        (Object.keys(packageJson.exports as Record<string, unknown>).some((key) => key.startsWith('.'))
          ? undefined
          : packageJson.exports)
      : packageJson.exports
  collectRelativeExportTargets(rootExport, candidates)
  if (typeof packageJson.module === 'string' && packageJson.module.startsWith('.')) {
    candidates.push(packageJson.module)
  }
  if (typeof packageJson.main === 'string' && packageJson.main.startsWith('.')) {
    candidates.push(packageJson.main)
  }
  return [...new Set(candidates)]
}

function collectRelativeExportTargets(value: unknown, candidates: string[]): void {
  if (typeof value === 'string') {
    if (value.startsWith('./')) candidates.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectRelativeExportTargets(item, candidates)
    return
  }
  if (value && typeof value === 'object') {
    for (const [condition, target] of Object.entries(value)) {
      if (condition === 'types' || condition.startsWith('.')) continue
      collectRelativeExportTargets(target, candidates)
    }
  }
}

async function resolveInstalledPackage(
  name: string,
  fromDirectory: string,
  optional: boolean,
): Promise<string | null> {
  const anchor = join(fromDirectory, 'package.json')
  const require = createRequire(anchor)
  const searchPaths = require.resolve.paths(name) ?? []
  for (const searchPath of searchPaths) {
    const candidate = join(searchPath, ...name.split('/'))
    const packageJson = join(candidate, 'package.json')
    if (!existsSync(packageJson)) continue
    const parsed = await readPackageJson(candidate)
    if (parsed.name === name) return realpath(candidate)
  }
  if (optional) return null
  return null
}

async function stagePrismaGeneratedClient(
  projectRoot: string,
  nodeModulesDir: string,
): Promise<void> {
  const require = createRequire(join(projectRoot, 'package.json'))
  for (const searchPath of require.resolve.paths('@prisma/client') ?? []) {
    const generated = join(searchPath, '.prisma/client')
    if (!existsSync(join(generated, 'package.json'))) continue
    await cp(await realpath(generated), join(nodeModulesDir, '.prisma/client'), {
      recursive: true,
      dereference: true,
      force: true,
    })
    return
  }
}

async function assertNativeTargetCompatibility(
  packageName: string,
  packageRoot: string,
  target: RuntimeBundleTarget,
): Promise<void> {
  if (target.platform === process.platform && target.arch === process.arch) return
  const nativeFiles = await findFilesWithExtension(packageRoot, '.node')
  if (nativeFiles.length === 0) return

  const platformTokens =
    target.platform === 'win32' ? ['win32', 'windows'] : [target.platform]
  const hasTargetPrebuild = nativeFiles.some((file) => {
    const normalized = file.toLowerCase()
    return platformTokens.some((token) => normalized.includes(token)) && normalized.includes(target.arch)
  })
  if (!hasTargetPrebuild) {
    throw new Error(
      `murasaki: ${JSON.stringify(packageName)} contains native add-ons installed for ` +
        `${process.platform}-${process.arch}, but the bundle target is ${target.platform}-${target.arch}. ` +
        'Install dependencies for the target platform in CI (recommended), or use a package that ships target prebuilds.',
    )
  }
}

async function findFilesWithExtension(root: string, extension: string): Promise<string[]> {
  const files: string[] = []
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && entry.name.endsWith(extension)) files.push(path)
    }
  }
  await walk(root)
  return files
}

async function readPackageJson(packageRoot: string): Promise<PackageJson> {
  const path = join(packageRoot, 'package.json')
  try {
    return JSON.parse(await readFile(path, 'utf8')) as PackageJson
  } catch (error) {
    throw new Error(
      `murasaki: cannot read package metadata at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** Copy config.bundle.resources after validating they cannot overwrite runtime files. */
export async function stageBundleResources(
  projectRoot: string,
  resourcesDir: string,
  config: MurasakiConfig,
): Promise<string[]> {
  const staged: string[] = []
  for (const item of config.bundle?.resources ?? []) {
    const fromValue = typeof item === 'string' ? item : item.from
    const source = isAbsolute(fromValue) ? fromValue : resolve(projectRoot, fromValue)
    if (!existsSync(source)) {
      throw new Error(`murasaki: bundle resource not found: ${fromValue}`)
    }
    const toValue = typeof item === 'string' ? basename(source) : (item.to ?? basename(source))
    if (
      isAbsolute(toValue) ||
      toValue === '' ||
      toValue.split(/[\\/]+/).includes('..')
    ) {
      throw new Error(`murasaki: unsafe or reserved bundle resource destination: ${toValue}`)
    }
    const destination = resolve(resourcesDir, toValue)
    const relativeDestination = relative(resourcesDir, destination)
    const topLevelDestination = relativeDestination.split(sep)[0]
    if (
      relativeDestination === '' ||
      relativeDestination.startsWith('..') ||
      isAbsolute(relativeDestination) ||
      RESERVED_RESOURCE_NAMES.has(topLevelDestination)
    ) {
      throw new Error(`murasaki: unsafe or reserved bundle resource destination: ${toValue}`)
    }
    const sourceStat = await stat(source)
    if (sourceStat.isDirectory()) {
      await cp(source, destination, { recursive: true, dereference: true, force: true })
    } else {
      await mkdir(dirname(destination), { recursive: true })
      await cp(source, destination, { force: true })
    }
    staged.push(toValue)
  }
  return staged
}
