// Internal shared types (the public Metadata type is re-exported from index.ts).

import type { Metadata } from './index.ts'
import type { Component } from './jsx/types.ts'

export type AppComponent = Component

export type LayoutModule = {
  component: AppComponent
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
