import * as LabelPrimitive from '@radix-ui/react-label'
import { type VariantProps, cva } from 'class-variance-authority'
import { forwardRef } from 'react'
import type {
  ComponentPropsWithoutRef,
  ElementRef,
  HTMLAttributes,
} from 'react'
import { cn } from '../lib/cn.js'

export const FieldGroup = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="field-group"
    className={cn('flex w-full flex-col gap-6', className)}
    {...props}
  />
))
FieldGroup.displayName = 'FieldGroup'

const fieldVariants = cva(
  'flex w-full gap-3 data-[invalid=true]:text-destructive',
  {
    variants: {
      orientation: {
        vertical: 'flex-col',
        horizontal: 'flex-row items-center',
      },
    },
    defaultVariants: {
      orientation: 'vertical',
    },
  },
)

export interface FieldProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof fieldVariants> {}

export const Field = forwardRef<HTMLDivElement, FieldProps>(
  ({ className, orientation, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="field"
      className={cn(fieldVariants({ orientation, className }))}
      {...props}
    />
  ),
)
Field.displayName = 'Field'

export const FieldLabel = forwardRef<
  ElementRef<typeof LabelPrimitive.Root>,
  ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    data-slot="field-label"
    className={cn(
      'flex w-fit items-center gap-2 text-sm leading-snug font-medium select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
      className,
    )}
    {...props}
  />
))
FieldLabel.displayName = LabelPrimitive.Root.displayName

export const FieldDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    data-slot="field-description"
    className={cn(
      'text-muted-foreground text-sm leading-normal font-normal',
      className,
    )}
    {...props}
  />
))
FieldDescription.displayName = 'FieldDescription'

export const FieldError = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => {
  if (!children) {
    return null
  }

  return (
    <div
      ref={ref}
      role="alert"
      data-slot="field-error"
      className={cn('text-destructive text-sm font-normal', className)}
      {...props}
    >
      {children}
    </div>
  )
})
FieldError.displayName = 'FieldError'
