export type Locale = 'en' | 'ja'
export type BlockType = 'heading' | 'paragraph' | 'check' | 'callout' | 'attachment'
export type DatabaseView = 'table' | 'board' | 'calendar'

export interface Attachment {
  id: string
  name: string
  mime: string
  size: number
  dataUrl: string
}

export interface Block {
  id: string
  type: BlockType
  text: string
  checked?: boolean
  attachment?: Attachment
  updatedAt?: string
}

export interface Page {
  id: string
  parentId: string | null
  title: string
  icon: string
  tags: string[]
  blocks: Block[]
  favorite: boolean
  updatedAt: string
  sample?: boolean
}

export interface DatabaseItem {
  id: string
  title: string
  owner: string
  due: string
  status: 'Not started' | 'In progress' | 'Done'
  tags: string[]
  updatedAt?: string
  sample?: boolean
}

export interface Workspace {
  version: 1
  locale: Locale
  selectedPageId: string | null
  pages: Page[]
  database: DatabaseItem[]
  databaseView: DatabaseView
  sampleData: boolean
  updatedAt: string
  revision: number
  trash: Page[]
}

export interface LoadResult {
  workspace: Workspace
  storage: 'sqlite' | 'memory'
  databasePath: string | null
  noSampleData: boolean
  recoveryAvailable: boolean
  recoveryReason: string | null
}
