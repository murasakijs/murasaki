// Internal shared types (the public Metadata type is re-exported from index.ts).

import type { ComponentType, ReactNode } from 'react'
import type { Metadata } from './index.ts'

export type ReactComponent = ComponentType<{ children?: ReactNode }>

export type LayoutModule = {
  component: ReactComponent
  metadata?: Metadata
} | null

export type WindowConfig = {
  title: string
  width: number
  height: number
}

export type RenderResult = {
  html: string
  metadata?: Metadata
}
