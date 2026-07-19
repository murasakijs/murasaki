import type { Locale, Page, Workspace } from './types'

export function createEmptyWorkspace(locale?: Locale): Workspace
export function createSampleWorkspace(locale?: Locale): Workspace
export function markdownFromPage(page: Page): string
export function pageFromMarkdown(source: string, id?: string): Page
export function backlinksForPage(workspace: Workspace, page: Page): Page[]
export function searchWorkspace(workspace: Workspace, query: string): Page[]
export function normalizeWorkspace(value: Workspace): Workspace
export function mergeWorkspaces(base: Workspace, local: Workspace, remote: Workspace): Workspace
export function trashPageTree(workspace: Workspace, pageId: string): Workspace
export function restoreTrashedPages(workspace: Workspace, pageIds?: string[]): Workspace
