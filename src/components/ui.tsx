// UI components — Tier 1 (Button, Card, Input, Textarea, Modal, List).
// macOS-style defaults; every component accepts className + style override.

import { jsx } from '../jsx/runtime.ts'
import type { Child } from '../jsx/types.ts'

// ── Button ─────────────────────────────────────────────────────────
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const BUTTON_BASE: Record<string, unknown> = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  borderRadius: '8px',
  fontFamily: 'inherit',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'background 0.12s, transform 0.06s, opacity 0.12s',
  border: '1px solid transparent',
  userSelect: 'none',
}

const SIZE: Record<ButtonSize, Record<string, unknown>> = {
  sm: { padding: '4px 10px', fontSize: '12px' },
  md: { padding: '8px 14px', fontSize: '13px' },
  lg: { padding: '10px 20px', fontSize: '15px' },
}

const VARIANT: Record<ButtonVariant, Record<string, unknown>> = {
  primary: {
    background: 'linear-gradient(180deg, #A855F7, #7C3AED)',
    color: '#fff',
    boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
  },
  secondary: {
    background: 'rgba(168, 85, 247, 0.08)',
    color: '#5B21B6',
    borderColor: 'rgba(168, 85, 247, 0.22)',
  },
  ghost: { background: 'transparent', color: '#5B21B6' },
  danger: {
    background: 'linear-gradient(180deg, #ef4444, #b91c1c)',
    color: '#fff',
    boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
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
    background: 'rgba(255,255,255,0.65)',
    border: '1px solid rgba(0,0,0,0.06)',
    borderRadius: '12px',
    boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(168,85,247,0.04)',
    padding: typeof props.padding === 'number' ? `${props.padding}px` : '20px',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    ...(props.style ?? {}),
  }
  return jsx('div', { className: props.className, style, children: props.children })
}

// ── Input ──────────────────────────────────────────────────────────
const INPUT_BASE: Record<string, unknown> = {
  fontFamily: 'inherit',
  fontSize: '13px',
  padding: '8px 12px',
  borderRadius: '8px',
  border: '1px solid rgba(0,0,0,0.12)',
  background: 'rgba(255,255,255,0.8)',
  color: 'inherit',
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
    fontFamily: '"SF Mono", Menlo, monospace',
    fontSize: '12.5px',
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
    background: '#fff',
    borderRadius: '14px',
    boxShadow: '0 24px 80px rgba(0,0,0,0.24)',
    width: props.width ? `${props.width}px` : 'min(560px, 92vw)',
    maxHeight: '88vh',
    overflow: 'auto',
    padding: '24px',
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
    background: 'rgba(0,0,0,0.04)',
    border: '1px solid rgba(0,0,0,0.06)',
    borderRadius: '10px',
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
    padding: '10px 14px',
    background: props.active ? 'rgba(168, 85, 247, 0.14)' : 'rgba(255,255,255,0.9)',
    color: props.active ? '#5B21B6' : 'inherit',
    fontWeight: props.active ? 600 : 400,
    fontSize: '13px',
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
