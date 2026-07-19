import { Slot } from '@radix-ui/react-slot'
import { type VariantProps, cva } from 'class-variance-authority'
import { forwardRef } from 'react'
import type {
  ComponentPropsWithoutRef,
  ElementRef,
  HTMLAttributes,
} from 'react'
import { cn } from '../lib/cn.js'
import { Separator } from './separator.js'

export const buttonGroupVariants = cva(
  'flex w-fit items-stretch [&>*]:rounded-none [&>*:first-child]:rounded-l-md [&>*:last-child]:rounded-r-md',
  {
    variants: {
      orientation: {
        horizontal: '',
        vertical:
          'flex-col [&>*:first-child]:rounded-t-md [&>*:first-child]:rounded-l-none [&>*:last-child]:rounded-b-md [&>*:last-child]:rounded-r-none',
      },
    },
    defaultVariants: {
      orientation: 'horizontal',
    },
  },
)

export interface ButtonGroupProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof buttonGroupVariants> {}

export const ButtonGroup = forwardRef<HTMLDivElement, ButtonGroupProps>(
  ({ className, orientation, ...props }, ref) => (
    <div
      ref={ref}
      role="group"
      data-slot="button-group"
      className={cn(buttonGroupVariants({ orientation, className }))}
      {...props}
    />
  ),
)
ButtonGroup.displayName = 'ButtonGroup'

export interface ButtonGroupTextProps extends ComponentPropsWithoutRef<'div'> {
  asChild?: boolean
}

export const ButtonGroupText = forwardRef<HTMLDivElement, ButtonGroupTextProps>(
  ({ asChild, className, ...props }, ref) => {
    const Comp = asChild ? Slot : 'div'
    return (
      <Comp
        ref={ref}
        data-slot="button-group-text"
        className={cn(
          'flex items-center gap-2 rounded-md border border-input bg-muted px-3 text-sm font-medium text-muted-foreground',
          className,
        )}
        {...props}
      />
    )
  },
)
ButtonGroupText.displayName = 'ButtonGroupText'

export const ButtonGroupSeparator = forwardRef<
  ElementRef<typeof Separator>,
  ComponentPropsWithoutRef<typeof Separator>
>(({ className, orientation = 'vertical', ...props }, ref) => (
  <Separator
    ref={ref}
    data-slot="button-group-separator"
    orientation={orientation}
    className={cn('!my-1 !h-auto self-stretch bg-input', className)}
    {...props}
  />
))
ButtonGroupSeparator.displayName = 'ButtonGroupSeparator'
