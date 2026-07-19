import type { ButtonHTMLAttributes, HTMLAttributes } from 'react'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>

export function cn(...values: Array<string | undefined | null | false>): string {
  return values.filter(Boolean).join(' ')
}

export function Button(props: ButtonProps) {
  return <button {...props} />
}

export function Progress({ value = 0, ...props }: HTMLAttributes<HTMLProgressElement> & { value?: number }) {
  return <progress max={100} value={value} {...props} />
}
