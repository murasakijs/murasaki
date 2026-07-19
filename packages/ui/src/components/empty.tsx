import { type VariantProps, cva } from 'class-variance-authority'
import { forwardRef } from 'react'
import type { HTMLAttributes } from 'react'
import { cn } from '../lib/cn.js'

export const Empty = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="empty"
      className={cn(
        'flex min-w-0 flex-1 flex-col items-center justify-center gap-6 rounded-lg border-dashed p-6 text-center text-balance md:p-12',
        className,
      )}
      {...props}
    />
  ),
)
Empty.displayName = 'Empty'

export const EmptyHeader = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="empty-header"
    className={cn(
      'flex max-w-sm flex-col items-center gap-2 text-center',
      className,
    )}
    {...props}
  />
))
EmptyHeader.displayName = 'EmptyHeader'

export const emptyMediaVariants = cva(
  "flex shrink-0 items-center justify-center mb-2 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        icon: "bg-muted text-foreground flex size-10 items-center justify-center rounded-lg [&_svg:not([class*='size-'])]:size-6",
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface EmptyMediaProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof emptyMediaVariants> {}

export const EmptyMedia = forwardRef<HTMLDivElement, EmptyMediaProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="empty-media"
      className={cn(emptyMediaVariants({ variant, className }))}
      {...props}
    />
  ),
)
EmptyMedia.displayName = 'EmptyMedia'

export const EmptyTitle = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="empty-title"
    className={cn('text-lg font-medium tracking-tight', className)}
    {...props}
  />
))
EmptyTitle.displayName = 'EmptyTitle'

export const EmptyDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    data-slot="empty-description"
    className={cn(
      "text-muted-foreground text-sm/relaxed [&>a]:underline [&>a]:underline-offset-4",
      className,
    )}
    {...props}
  />
))
EmptyDescription.displayName = 'EmptyDescription'

export const EmptyContent = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="empty-content"
    className={cn(
      'flex w-full max-w-sm min-w-0 flex-col items-center gap-4 text-sm text-balance',
      className,
    )}
    {...props}
  />
))
EmptyContent.displayName = 'EmptyContent'
