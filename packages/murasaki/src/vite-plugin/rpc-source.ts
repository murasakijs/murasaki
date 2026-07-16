import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export type RpcDirective = 'use server' | 'use main'

/** Resolve an untrusted renderer module id only when it stays below srcDir. */
export function resolveRpcSource(
  encodedId: string,
  projectRoot: string,
  srcDir: string,
): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(encodedId)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const source = resolve(projectRoot, decoded)
  const fromSrc = relative(resolve(srcDir), source)
  if (fromSrc === '' || fromSrc === '..' || fromSrc.startsWith(`..${sep}`) || isAbsolute(fromSrc)) {
    return null
  }
  return source
}

/** Match the same first-non-empty-line directive contract as production bundling. */
export function sourceHasRpcDirective(source: string, directive: RpcDirective): boolean {
  const firstLine = source.split('\n').find((line) => line.trim().length > 0)?.trim()
  return firstLine === `'${directive}'`
    || firstLine === `'${directive}';`
    || firstLine === `"${directive}"`
    || firstLine === `"${directive}";`
}

export async function fileHasRpcDirective(path: string, directive: RpcDirective): Promise<boolean> {
  try {
    return sourceHasRpcDirective(await readFile(path, 'utf8'), directive)
  } catch {
    return false
  }
}

export function isSafeRpcExportName(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name)
}
