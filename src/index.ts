// murasaki — public API
//
// Import like:
//   import type { Metadata } from 'murasaki'
//   import { Link }            from 'murasaki'

export type { LinkProps } from './components/Link.tsx'
export { Link } from './components/Link.tsx'

// React Native–style layout primitives.
export { Row, Stack, Text, View } from './components/primitives.tsx'
export type { TextProps, ViewProps } from './components/primitives.tsx'

// Desktop-shaped components (macOS-first).
export {
  NoDrag,
  Pane,
  Sidebar,
  SidebarItem,
  StatusBar,
  TitleBar,
  Toolbar,
} from './components/desktop.tsx'

// UI components (Tier 1).
export {
  Button,
  Card,
  Input,
  List,
  ListItem,
  Modal,
  Textarea,
} from './components/ui.tsx'
export type { ButtonSize, ButtonVariant } from './components/ui.tsx'

// Form controls (Tier 2).
export { Checkbox, Radio, RadioGroup, Switch } from './components/forms.tsx'

// Overlay & navigation (Tier 2).
export {
  ContextMenu,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Tooltip,
} from './components/overlay.tsx'
export type { ContextMenuItem } from './components/overlay.tsx'

export type Metadata = {
  /** Default <title> for the app (overridden by <title> tag inside <head>) */
  title?: string
  /** <meta name="description"> */
  description?: string
  /** Initial window options (applied at first open; user can resize after) */
  window?: {
    /** Window title bar text (defaults to metadata.title) */
    title?: string
    /** Initial width in logical pixels */
    width?: number
    /** Initial height in logical pixels */
    height?: number
  }
}
