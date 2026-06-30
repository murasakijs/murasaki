// Form controls — Switch, Checkbox, Radio.

import { jsx } from '../jsx/runtime.ts'
import type { Child } from '../jsx/types.ts'

// ── Switch (macOS-style toggle) ──────────────────────────────────────
export function Switch(props: {
  checked: boolean
  onChange?: (checked: boolean) => void
  label?: Child
  disabled?: boolean
  className?: string
  style?: Record<string, unknown>
}) {
  const w = 38
  const h = 22
  const track: Record<string, unknown> = {
    position: 'relative',
    display: 'inline-block',
    width: `${w}px`,
    height: `${h}px`,
    borderRadius: `${h}px`,
    background: props.checked ? '#A855F7' : 'rgba(0,0,0,0.18)',
    transition: 'background 0.15s',
    cursor: props.disabled ? 'not-allowed' : 'pointer',
    opacity: props.disabled ? 0.5 : 1,
    flexShrink: 0,
  }
  const thumb: Record<string, unknown> = {
    position: 'absolute',
    top: '2px',
    left: props.checked ? `${w - h + 2}px` : '2px',
    width: `${h - 4}px`,
    height: `${h - 4}px`,
    borderRadius: '999px',
    background: '#fff',
    boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
    transition: 'left 0.15s',
  }
  const wrap: Record<string, unknown> = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
    userSelect: 'none',
    ...(props.style ?? {}),
  }
  const onClick = () => {
    if (props.disabled) return
    props.onChange?.(!props.checked)
  }
  return jsx('label', {
    className: props.className,
    style: wrap,
    onClick,
    children: [
      jsx('span', { style: track, children: jsx('span', { style: thumb }) }),
      props.label != null ? jsx('span', { children: props.label }) : null,
    ],
  })
}

// ── Checkbox ────────────────────────────────────────────────────────
export function Checkbox(props: {
  checked: boolean
  onChange?: (checked: boolean) => void
  label?: Child
  disabled?: boolean
  className?: string
  style?: Record<string, unknown>
}) {
  const box: Record<string, unknown> = {
    width: '16px',
    height: '16px',
    borderRadius: '4px',
    border: props.checked ? '1px solid #A855F7' : '1px solid rgba(0,0,0,0.3)',
    background: props.checked ? '#A855F7' : '#fff',
    color: '#fff',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '11px',
    fontWeight: 700,
    flexShrink: 0,
    transition: 'background 0.1s, border-color 0.1s',
  }
  const wrap: Record<string, unknown> = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
    userSelect: 'none',
    cursor: props.disabled ? 'not-allowed' : 'pointer',
    opacity: props.disabled ? 0.5 : 1,
    ...(props.style ?? {}),
  }
  const onClick = () => {
    if (props.disabled) return
    props.onChange?.(!props.checked)
  }
  return jsx('label', {
    className: props.className,
    style: wrap,
    onClick,
    children: [
      jsx('span', { style: box, children: props.checked ? '✓' : '' }),
      props.label != null ? jsx('span', { children: props.label }) : null,
    ],
  })
}

// ── Radio + RadioGroup ─────────────────────────────────────────────
// Radio works standalone (uncontrolled) or inside a RadioGroup (controlled).
// RadioGroup holds the active value and passes its setter to children.

const RADIO_GROUP_PROPS = '__murasakiRadioGroup'

type RadioGroupContext = {
  value: string
  onChange?: (v: string) => void
  name?: string
}

export function RadioGroup(props: {
  value: string
  onChange?: (v: string) => void
  name?: string
  children?: Child
  className?: string
  style?: Record<string, unknown>
}) {
  // Inject context via prop walk (no real React context yet). We attach
  // the group state to a wrapper div via a data attribute the child Radios
  // will read at click time. Simpler: pass via closure on each child.
  // For MVP we use a runtime convention: children Radios receive value/onChange
  // via props.groupValue / groupChange when nested.
  const ctx: RadioGroupContext = {
    value: props.value,
    onChange: props.onChange,
    name: props.name,
  }
  return jsx('div', {
    className: props.className,
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      ...(props.style ?? {}),
    },
    // Stash for child Radios that opt in.
    [RADIO_GROUP_PROPS]: ctx,
    children: props.children,
  })
}

export function Radio(props: {
  value: string
  checked?: boolean
  onChange?: (v: string) => void
  // Optional group context, set by RadioGroup
  groupValue?: string
  groupChange?: (v: string) => void
  label?: Child
  disabled?: boolean
  className?: string
  style?: Record<string, unknown>
}) {
  const active = props.groupValue !== undefined ? props.groupValue === props.value : !!props.checked
  const handle = () => {
    if (props.disabled) return
    props.groupChange?.(props.value)
    props.onChange?.(props.value)
  }
  const dot: Record<string, unknown> = {
    width: '16px',
    height: '16px',
    borderRadius: '999px',
    border: active ? '5px solid #A855F7' : '1px solid rgba(0,0,0,0.3)',
    background: '#fff',
    flexShrink: 0,
    transition: 'border 0.1s',
  }
  const wrap: Record<string, unknown> = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
    userSelect: 'none',
    cursor: props.disabled ? 'not-allowed' : 'pointer',
    opacity: props.disabled ? 0.5 : 1,
    ...(props.style ?? {}),
  }
  return jsx('label', {
    className: props.className,
    style: wrap,
    onClick: handle,
    children: [
      jsx('span', { style: dot }),
      props.label != null ? jsx('span', { children: props.label }) : null,
    ],
  })
}
