// Feedback / indicator components — Badge, Avatar, Spinner, Progress, Toast.

import { useEffect, useState } from '../jsx/dom/runtime.ts'
import { Fragment, jsx } from '../jsx/runtime.ts'
import type { Child } from '../jsx/types.ts'
import { T } from '../theme.ts'

// ── Badge ──────────────────────────────────────────────────────────
export type BadgeVariant = 'primary' | 'secondary' | 'success' | 'danger' | 'neutral'

const BADGE_BG: Record<BadgeVariant, string> = {
  primary: T.primary,
  secondary: T.secondary,
  success: T.success,
  danger: T.danger,
  neutral: T.surfaceMuted,
}
const BADGE_FG: Record<BadgeVariant, string> = {
  primary: T.primaryFg,
  secondary: T.secondaryFg,
  success: '#ffffff',
  danger: T.dangerFg,
  neutral: T.textMuted,
}

export function Badge(props: {
  children?: Child
  variant?: BadgeVariant
  /** Tiny circle, no text. */
  dot?: boolean
  className?: string
  style?: Record<string, unknown>
}) {
  const variant = props.variant ?? 'primary'
  if (props.dot) {
    return jsx('span', {
      className: props.className,
      style: {
        display: 'inline-block',
        width: '8px',
        height: '8px',
        borderRadius: T.radiusPill,
        background: BADGE_BG[variant],
        ...(props.style ?? {}),
      },
    })
  }
  return jsx('span', {
    className: props.className,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      padding: `2px ${T.spacingSm}`,
      borderRadius: T.radiusPill,
      background: BADGE_BG[variant],
      color: BADGE_FG[variant],
      fontSize: T.fontSizeXs,
      fontWeight: 600,
      lineHeight: 1.4,
      ...(props.style ?? {}),
    },
    children: props.children,
  })
}

// ── Avatar ─────────────────────────────────────────────────────────
export function Avatar(props: {
  src?: string
  name?: string
  size?: number
  className?: string
  style?: Record<string, unknown>
}) {
  const size = props.size ?? 32
  const base: Record<string, unknown> = {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: T.radiusPill,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
    background: `linear-gradient(135deg, ${T.primary}, ${T.primaryDeep})`,
    color: T.primaryFg,
    fontSize: `${Math.round(size * 0.42)}px`,
    fontWeight: 600,
    userSelect: 'none',
    ...(props.style ?? {}),
  }
  if (props.src) {
    return jsx('img', {
      src: props.src,
      alt: props.name ?? '',
      className: props.className,
      style: base,
    })
  }
  const initial = (props.name ?? '?').trim().charAt(0).toUpperCase() || '?'
  return jsx('span', {
    className: props.className,
    style: base,
    children: initial,
  })
}

// ── Spinner ────────────────────────────────────────────────────────
export function Spinner(props: {
  size?: number
  color?: string
  className?: string
  style?: Record<string, unknown>
}) {
  const size = props.size ?? 16
  const color = props.color ?? T.primary
  // SVG-based: rotates via inline CSS animation keyframes injected once.
  const id = '__murasaki_spin_kf'
  if (typeof document !== 'undefined' && !document.getElementById(id)) {
    const s = document.createElement('style')
    s.id = id
    s.textContent = '@keyframes murasakiSpin{to{transform:rotate(360deg)}}'
    document.head.appendChild(s)
  }
  return jsx('span', {
    className: props.className,
    style: {
      display: 'inline-block',
      width: `${size}px`,
      height: `${size}px`,
      border: `${Math.max(2, size / 8)}px solid ${color}`,
      borderTopColor: 'transparent',
      borderRadius: T.radiusPill,
      animation: 'murasakiSpin 0.7s linear infinite',
      ...(props.style ?? {}),
    },
  })
}

// ── Progress ───────────────────────────────────────────────────────
export function Progress(props: {
  /** 0–100 (or 0–1; we auto-detect). Omit + set `indeterminate` for the loop. */
  value?: number
  max?: number
  indeterminate?: boolean
  height?: number
  className?: string
  style?: Record<string, unknown>
}) {
  const id = '__murasaki_progress_kf'
  if (typeof document !== 'undefined' && !document.getElementById(id)) {
    const s = document.createElement('style')
    s.id = id
    s.textContent =
      '@keyframes murasakiProgress{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}'
    document.head.appendChild(s)
  }
  const h = props.height ?? 6
  const track: Record<string, unknown> = {
    width: '100%',
    height: `${h}px`,
    borderRadius: T.radiusPill,
    background: T.border,
    overflow: 'hidden',
    position: 'relative',
    ...(props.style ?? {}),
  }
  if (props.indeterminate) {
    return jsx('div', {
      className: props.className,
      style: track,
      children: jsx('div', {
        style: {
          position: 'absolute',
          left: 0,
          top: 0,
          width: '25%',
          height: '100%',
          background: `linear-gradient(90deg, ${T.primary}, ${T.primaryDeep})`,
          borderRadius: T.radiusPill,
          animation: 'murasakiProgress 1.4s ease-in-out infinite',
        },
      }),
    })
  }
  const max = props.max ?? (typeof props.value === 'number' && props.value <= 1 ? 1 : 100)
  const v = Math.max(0, Math.min(max, props.value ?? 0))
  const pct = (v / max) * 100
  return jsx('div', {
    className: props.className,
    style: track,
    children: jsx('div', {
      style: {
        width: `${pct}%`,
        height: '100%',
        background: `linear-gradient(90deg, ${T.primary}, ${T.primaryDeep})`,
        borderRadius: T.radiusPill,
        transition: 'width 0.2s',
      },
    }),
  })
}

// ── Toast (in-app notification) ─────────────────────────────────────
export type ToastOptions = {
  title: string
  body?: string
  variant?: 'default' | 'success' | 'danger'
  /** Auto-dismiss in ms. 0 = manual dismiss only. Default 3000. */
  duration?: number
}

type ToastInstance = ToastOptions & { id: number }

let nextId = 1
const toastListeners = new Set<(t: ToastInstance) => void>()
const toastDismissListeners = new Set<(id: number) => void>()

/** Call from anywhere on the client to push a toast. */
export function toast(opts: ToastOptions): number {
  const id = nextId++
  const t: ToastInstance = { id, duration: 3000, variant: 'default', ...opts }
  toastListeners.forEach((fn) => fn(t))
  return id
}

export function dismissToast(id: number): void {
  toastDismissListeners.forEach((fn) => fn(id))
}

/** Hook version: identical to bare `toast()`, but ergonomic in components. */
export function useToast() {
  return { show: toast, dismiss: dismissToast }
}

/**
 * Mounts a fixed stack of toasts (bottom-right by default). Place once near
 * the root layout.
 *
 *   <ToastProvider />
 *   ...
 *   const t = useToast()
 *   t.show({ title: 'Saved' })
 */
export function ToastProvider(props: {
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'
  className?: string
  // NOTE: <ToastProvider>{children}</ToastProvider> is the natural way to
  // wrap the whole app with a toast host. Without this, the JSX runtime
  // silently dropped every child that lived under it — mount root and all.
  children?: Child
}) {
  const [items, setItems] = useState<ToastInstance[]>([])

  useEffect(() => {
    const add = (t: ToastInstance) => {
      setItems((prev) => [...prev, t])
      if (t.duration && t.duration > 0) {
        setTimeout(() => {
          setItems((prev) => prev.filter((x) => x.id !== t.id))
        }, t.duration)
      }
    }
    const remove = (id: number) => {
      setItems((prev) => prev.filter((x) => x.id !== id))
    }
    toastListeners.add(add)
    toastDismissListeners.add(remove)
    return () => {
      toastListeners.delete(add)
      toastDismissListeners.delete(remove)
    }
  }, [])

  const position = props.position ?? 'bottom-right'
  const corner: Record<string, unknown> = {
    position: 'fixed',
    zIndex: 3000,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '16px',
    pointerEvents: 'none',
    [position.startsWith('top') ? 'top' : 'bottom']: 0,
    [position.endsWith('right') ? 'right' : 'left']: 0,
    alignItems: position.endsWith('right') ? 'flex-end' : 'flex-start',
  }

  const cornerNode = jsx('div', {
    className: props.className,
    style: corner,
    children: items.map((t) =>
      jsx('div', {
        key: t.id,
        style: {
          pointerEvents: 'auto',
          minWidth: '240px',
          maxWidth: '360px',
          padding: `${T.spacingSm} ${T.spacingMd}`,
          borderRadius: T.radiusMd,
          background:
            t.variant === 'success'
              ? T.success
              : t.variant === 'danger'
                ? T.danger
                : T.background,
          color:
            t.variant === 'success' || t.variant === 'danger' ? '#fff' : T.text,
          border:
            t.variant === 'default' ? `1px solid ${T.border}` : 'transparent',
          boxShadow: T.shadowLg,
          cursor: 'pointer',
          fontSize: T.fontSizeMd,
        },
        onClick: () => dismissToast(t.id),
        children: [
          jsx('div', { style: { fontWeight: 600 }, children: t.title }),
          t.body
            ? jsx('div', {
                style: { fontSize: T.fontSizeSm, opacity: 0.85, marginTop: '2px' },
                children: t.body,
              })
            : null,
        ],
      }),
    ),
  })

  return jsx(Fragment, { children: [props.children, cornerNode] })
}
