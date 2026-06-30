// UI components — Tier 1 (Button, Card, Input, Textarea, Modal, List).
// macOS-style defaults; every component accepts className + style override.

import { jsx } from '../jsx/runtime.ts'
import type { Child } from '../jsx/types.ts'
import { T } from '../theme.ts'

// ── Button ─────────────────────────────────────────────────────────
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const BUTTON_BASE: Record<string, unknown> = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  borderRadius: T.radiusMd,
  fontFamily: 'inherit',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'background 0.12s, transform 0.06s, opacity 0.12s',
  border: '1px solid transparent',
  userSelect: 'none',
}

const SIZE: Record<ButtonSize, Record<string, unknown>> = {
  sm: { padding: `${T.spacingXs} ${T.spacingSm}`, fontSize: T.fontSizeSm },
  md: { padding: `${T.spacingSm} ${T.spacingMd}`, fontSize: T.fontSizeMd },
  lg: { padding: `${T.spacingMd} ${T.spacingLg}`, fontSize: T.fontSizeLg },
}

const VARIANT: Record<ButtonVariant, Record<string, unknown>> = {
  primary: {
    background: `linear-gradient(180deg, ${T.primary}, ${T.primaryDeep})`,
    color: T.primaryFg,
    boxShadow: T.shadowSm,
  },
  secondary: {
    background: T.secondary,
    color: T.secondaryFg,
    borderColor: T.borderStrong,
  },
  ghost: { background: 'transparent', color: T.secondaryFg },
  danger: {
    background: `linear-gradient(180deg, ${T.danger}, #b91c1c)`,
    color: T.dangerFg,
    boxShadow: T.shadowSm,
  },
}

export function Button(props: {
  children?: Child
  variant?: ButtonVariant
  size?: ButtonSize
  disabled?: boolean
  loading?: boolean
  onClick?: (e: Event) => void
  className?: string
  style?: Record<string, unknown>
  type?: 'button' | 'submit' | 'reset'
  [key: string]: unknown
}) {
  const variant = props.variant ?? 'primary'
  const size = props.size ?? 'md'
  const disabled = props.disabled || props.loading
  const style: Record<string, unknown> = {
    ...BUTTON_BASE,
    ...SIZE[size],
    ...VARIANT[variant],
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
    ...(props.style ?? {}),
  }
  const children = props.loading
    ? [jsx('span', { style: { display: 'inline-block' }, children: '⋯ ' }), props.children]
    : props.children
  return jsx('button', {
    type: props.type ?? 'button',
    className: props.className,
    onClick: disabled ? undefined : props.onClick,
    disabled,
    style,
    children,
  })
}

// ── Card ───────────────────────────────────────────────────────────
export function Card(props: {
  children?: Child
  className?: string
  padding?: number
  style?: Record<string, unknown>
}) {
  const style: Record<string, unknown> = {
    background: T.surface,
    border: `1px solid ${T.border}`,
    borderRadius: T.radiusLg,
    boxShadow: `${T.shadowSm}, ${T.shadowMd}`,
    padding: typeof props.padding === 'number' ? `${props.padding}px` : T.spacingLg,
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    color: T.text,
    ...(props.style ?? {}),
  }
  return jsx('div', { className: props.className, style, children: props.children })
}

// ── Input ──────────────────────────────────────────────────────────
const INPUT_BASE: Record<string, unknown> = {
  fontFamily: 'inherit',
  fontSize: T.fontSizeMd,
  padding: `${T.spacingSm} ${T.spacingMd}`,
  borderRadius: T.radiusMd,
  border: `1px solid ${T.borderStrong}`,
  background: T.surface,
  color: T.text,
  outline: 'none',
  transition: 'border-color 0.12s, box-shadow 0.12s',
  width: '100%',
}

export function Input(props: {
  value?: string
  defaultValue?: string
  placeholder?: string
  type?: string
  disabled?: boolean
  onInput?: (e: Event) => void
  onChange?: (e: Event) => void
  onKeyDown?: (e: Event) => void
  className?: string
  style?: Record<string, unknown>
  [key: string]: unknown
}) {
  const style: Record<string, unknown> = {
    ...INPUT_BASE,
    opacity: props.disabled ? 0.5 : 1,
    ...(props.style ?? {}),
  }
  return jsx('input', {
    type: props.type ?? 'text',
    value: props.value,
    defaultValue: props.defaultValue,
    placeholder: props.placeholder,
    disabled: props.disabled,
    onInput: props.onInput,
    onChange: props.onChange,
    onKeyDown: props.onKeyDown,
    className: props.className,
    style,
  })
}

// ── Textarea ───────────────────────────────────────────────────────
export function Textarea(props: {
  value?: string
  defaultValue?: string
  placeholder?: string
  rows?: number
  disabled?: boolean
  onInput?: (e: Event) => void
  onChange?: (e: Event) => void
  className?: string
  style?: Record<string, unknown>
  [key: string]: unknown
}) {
  const style: Record<string, unknown> = {
    ...INPUT_BASE,
    fontFamily: T.fontMono,
    fontSize: T.fontSizeSm,
    resize: 'vertical',
    opacity: props.disabled ? 0.5 : 1,
    ...(props.style ?? {}),
  }
  return jsx('textarea', {
    rows: props.rows ?? 4,
    value: props.value,
    defaultValue: props.defaultValue,
    placeholder: props.placeholder,
    disabled: props.disabled,
    onInput: props.onInput,
    onChange: props.onChange,
    className: props.className,
    style,
  })
}

// ── Modal ──────────────────────────────────────────────────────────
/**
 * Lightweight modal overlay. Renders nothing when `open` is false.
 * Use with useState for open/close state.
 *
 *   <Modal open={isOpen} onClose={() => setIsOpen(false)} title="Confirm">
 *     ...
 *   </Modal>
 */
export function Modal(props: {
  open: boolean
  children?: Child
  title?: string
  onClose?: () => void
  width?: number
  className?: string
  style?: Record<string, unknown>
}) {
  if (!props.open) return null

  const overlayStyle: Record<string, unknown> = {
    position: 'fixed',
    inset: '0',
    background: 'rgba(0,0,0,0.32)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    backdropFilter: 'blur(2px)',
  }
  const dialogStyle: Record<string, unknown> = {
    background: T.background,
    color: T.text,
    borderRadius: T.radiusLg,
    boxShadow: T.shadowLg,
    width: props.width ? `${props.width}px` : 'min(560px, 92vw)',
    maxHeight: '88vh',
    overflow: 'auto',
    padding: T.spacingXl,
    ...(props.style ?? {}),
  }
  const onOverlayClick = (e: Event) => {
    if (e.target === e.currentTarget && props.onClose) props.onClose()
  }
  const titleEl = props.title
    ? jsx('div', {
        style: { fontWeight: 600, fontSize: '15px', marginBottom: '12px' },
        children: props.title,
      })
    : null
  const closeBtn = props.onClose
    ? jsx('button', {
        onClick: props.onClose,
        style: {
          position: 'absolute',
          top: '12px',
          right: '12px',
          width: '24px',
          height: '24px',
          borderRadius: '999px',
          border: 'none',
          background: 'rgba(0,0,0,0.06)',
          cursor: 'pointer',
          fontSize: '14px',
          lineHeight: '1',
        },
        children: '✕',
      })
    : null
  return jsx('div', {
    style: overlayStyle,
    onClick: onOverlayClick,
    children: jsx('div', {
      style: { ...dialogStyle, position: 'relative' },
      className: props.className,
      children: [closeBtn, titleEl, props.children],
    }),
  })
}

// ── List ───────────────────────────────────────────────────────────
export function List(props: {
  children?: Child
  className?: string
  style?: Record<string, unknown>
}) {
  const style: Record<string, unknown> = {
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
    background: T.border,
    border: `1px solid ${T.border}`,
    borderRadius: T.radiusMd,
    overflow: 'hidden',
    ...(props.style ?? {}),
  }
  return jsx('div', { className: props.className, style, children: props.children })
}

export function ListItem(props: {
  children?: Child
  active?: boolean
  onClick?: (e: Event) => void
  className?: string
  style?: Record<string, unknown>
}) {
  const style: Record<string, unknown> = {
    padding: `${T.spacingSm} ${T.spacingMd}`,
    background: props.active ? T.secondary : T.surface,
    color: props.active ? T.secondaryFg : T.text,
    fontWeight: props.active ? 600 : 400,
    fontSize: T.fontSizeMd,
    cursor: props.onClick ? 'pointer' : 'default',
    transition: 'background 0.1s',
    ...(props.style ?? {}),
  }
  return jsx('div', {
    className: props.className,
    onClick: props.onClick,
    style,
    children: props.children,
  })
}
