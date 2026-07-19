'use main'

import {
  attachDocker,
  detachDocker,
  detachLocalLog,
  executeNetwork,
  executeScenario,
  importWorkspaceDocument,
  importLocalLog as importLocalLogSnapshot,
  listDocker,
  resetState,
  setMode,
  snapshot,
  updateWorkspace,
} from './runtime.ts'
import type { MockMode, RequestInput, RuntimeSnapshot, ScenarioResult, ScenarioStep, WorkspaceState } from '../lib/types.ts'

export async function getRuntimeSnapshot(): Promise<RuntimeSnapshot> {
  return snapshot()
}

export async function executeRequest(input: RequestInput) {
  return executeNetwork(input)
}

export async function runScenario(steps: ScenarioStep[]): Promise<ScenarioResult[]> {
  return executeScenario(steps)
}

export async function configureMock(mode: MockMode): Promise<RuntimeSnapshot> {
  return setMode(mode)
}

export async function importDocument(document: string): Promise<RuntimeSnapshot> {
  return importWorkspaceDocument(document)
}

export async function saveWorkspace(workspace: WorkspaceState): Promise<RuntimeSnapshot> {
  return updateWorkspace(workspace)
}

export async function getDockerContainers(): Promise<string[]> {
  return listDocker()
}

export async function followDockerContainer(container: string) {
  return attachDocker(container)
}

export async function stopDockerLogs() {
  return detachDocker()
}

export async function importLocalLog(name: string, content: string) {
  return importLocalLogSnapshot(name, content)
}

export async function stopLocalLog() {
  return detachLocalLog()
}

export async function resetWorkspace(): Promise<RuntimeSnapshot> {
  return resetState()
}
