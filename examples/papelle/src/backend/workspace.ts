'use main'

import type { LoadResult, Workspace } from '../domain/types'
import { readLatestQuarantine, readWorkspace, resetStoredWorkspace, validWorkspaceShape, writeWorkspace } from './store'
import { runtimeState } from './runtime'

function validateWorkspace(value: unknown): asserts value is Workspace {
  if (!validWorkspaceShape(value)) throw new TypeError('workspace contains invalid or out-of-bounds Papelle data')
}

export async function loadWorkspace(options: { forceEmpty?: boolean } = {}): Promise<LoadResult> {
  const { workspace, path, recoveryAvailable, recoveryReason } = readWorkspace(options.forceEmpty === true)
  return { workspace, storage: 'sqlite', databasePath: path, noSampleData: runtimeState().noSampleData || options.forceEmpty === true, recoveryAvailable, recoveryReason }
}

export async function saveWorkspace(workspace: Workspace): Promise<{ savedAt: string }> {
  validateWorkspace(workspace)
  writeWorkspace(workspace)
  return { savedAt: new Date().toISOString() }
}

export async function resetWorkspace(withSampleData = true): Promise<Workspace> {
  if (typeof withSampleData !== 'boolean') throw new TypeError('withSampleData must be boolean')
  return resetStoredWorkspace(withSampleData)
}

export async function loadQuarantinedWorkspace(): Promise<{ payload: string; reason: string; detectedAt: string } | null> {
  return readLatestQuarantine()
}
