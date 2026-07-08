import type { ButtonHTMLAttributes, HTMLAttributes, MouseEvent, ReactNode } from 'react'
import { cn } from '../lib/cn.js'

export interface TitleBarProps {
  title?: string
  children?: ReactNode
  onMinimize?: () => void
  onToggleMaximize?: () => void
  onClose?: () => void
  onStartDrag?: (e: MouseEvent) => void
  platform?: 'win32' | 'darwin' | 'linux'
  className?: string
}

/**
 * Wraps interactive content so it doesn't trigger the title bar's drag
 * region (mousedown) or its double-click-to-maximize when clicked.
 */
function NoDrag({ className, onMouseDown, onDoubleClick, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={className}
      onMouseDown={(e) => {
        e.stopPropagation()
        onMouseDown?.(e)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onDoubleClick?.(e)
      }}
      {...props}
    />
  )
}

function TitleBarButton({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-8 w-11 items-center justify-center text-foreground/80 outline-none hover:bg-muted hover:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

export function TitleBar({
  title,
  children,
  onMinimize,
  onToggleMaximize,
  onClose,
  onStartDrag,
  platform: _platform,
  className,
}: TitleBarProps) {
  return (
    <div
      className={cn(
        'flex h-8 shrink-0 select-none items-center border-b border-border bg-background text-sm',
        className,
      )}
      onMouseDown={onStartDrag}
      onDoubleClick={onToggleMaximize}
    >
      <NoDrag className="flex items-center">
        {title && (
          <span className="px-3 text-muted-foreground">{title}</span>
        )}
        {children}
      </NoDrag>

      <div className="flex-1" />

      <NoDrag className="flex items-center">
        <TitleBarButton aria-label="Minimize" onClick={onMinimize}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1" />
          </svg>
        </TitleBarButton>
        <TitleBarButton aria-label="Maximize" onClick={onToggleMaximize}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect
              x="0.5"
              y="0.5"
              width="9"
              height="9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        </TitleBarButton>
        <TitleBarButton
          aria-label="Close"
          className="hover:bg-red-600 hover:text-white"
          onClick={onClose}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1" />
            <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </TitleBarButton>
      </NoDrag>
    </div>
  )
}
TitleBar.displayName = 'TitleBar'
