import { Loader2 } from 'lucide-react'
import { forwardRef } from 'react'
import type { ComponentPropsWithoutRef } from 'react'
import { cn } from '../lib/cn.js'

export type SpinnerProps = ComponentPropsWithoutRef<'svg'>

export const Spinner = forwardRef<SVGSVGElement, SpinnerProps>(
  ({ className, ...props }, ref) => (
    <Loader2
      ref={ref}
      role="status"
      aria-label="Loading"
      className={cn('size-4 animate-spin', className)}
      {...props}
    />
  ),
)
Spinner.displayName = 'Spinner'
