import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const STATE = Symbol.for('papelle.runtime.v1')
type RuntimeState = { dataRoot: string; noSampleData: boolean; workspaceId: 'primary' | 'empty-session' }

function state(): RuntimeState {
  const root = globalThis as typeof globalThis & { [STATE]?: RuntimeState }
  root[STATE] ??= { dataRoot: join(tmpdir(), 'papelle-development'), noSampleData: false, workspaceId: 'primary' }
  mkdirSync(root[STATE].dataRoot, { recursive: true })
  return root[STATE]
}

export function configureRuntime(dataRoot: string, noSampleData: boolean): void {
  const root = globalThis as typeof globalThis & { [STATE]?: RuntimeState }
  root[STATE] = { dataRoot, noSampleData, workspaceId: noSampleData ? 'empty-session' : 'primary' }
  mkdirSync(dataRoot, { recursive: true })
}

export function runtimeState(): RuntimeState {
  return state()
}

export function selectWorkspaceSlot(empty: boolean): void {
  state().workspaceId = empty ? 'empty-session' : 'primary'
}
