import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import { forwardRef } from 'react'
import type { ComponentProps, HTMLAttributes } from 'react'
import { buttonVariants } from './button.js'
import type { ButtonProps } from './button.js'
import { cn } from '../lib/cn.js'

export function Pagination({ className, ...props }: ComponentProps<'nav'>) {
  return (
    <nav
      role="navigation"
      aria-label="pagination"
      className={cn('mx-auto flex w-full justify-center', className)}
      {...props}
    />
  )
}
Pagination.displayName = 'Pagination'

export const PaginationContent = forwardRef<
  HTMLUListElement,
  HTMLAttributes<HTMLUListElement>
>(({ className, ...props }, ref) => (
  <ul
    ref={ref}
    className={cn('flex flex-row items-center gap-1', className)}
    {...props}
  />
))
PaginationContent.displayName = 'PaginationContent'

export const PaginationItem = forwardRef<
  HTMLLIElement,
  HTMLAttributes<HTMLLIElement>
>(({ className, ...props }, ref) => (
  <li ref={ref} className={cn('', className)} {...props} />
))
PaginationItem.displayName = 'PaginationItem'

export type PaginationLinkProps = {
  isActive?: boolean
} & Pick<ButtonProps, 'size'> &
  ComponentProps<'a'>

export function PaginationLink({
  className,
  isActive,
  size = 'icon',
  ...props
}: PaginationLinkProps) {
  return (
    <a
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        buttonVariants({
          variant: isActive ? 'outline' : 'ghost',
          size,
        }),
        className,
      )}
      {...props}
    />
  )
}
PaginationLink.displayName = 'PaginationLink'

export function PaginationPrevious({
  className,
  children = 'Previous',
  ...props
}: PaginationLinkProps) {
  return (
    <PaginationLink
      aria-label="Go to previous page"
      size="default"
      className={cn('gap-1 pl-2.5', className)}
      {...props}
    >
      <ChevronLeft className="h-4 w-4" />
      <span>{children}</span>
    </PaginationLink>
  )
}
PaginationPrevious.displayName = 'PaginationPrevious'

export function PaginationNext({
  className,
  children = 'Next',
  ...props
}: PaginationLinkProps) {
  return (
    <PaginationLink
      aria-label="Go to next page"
      size="default"
      className={cn('gap-1 pr-2.5', className)}
      {...props}
    >
      <span>{children}</span>
      <ChevronRight className="h-4 w-4" />
    </PaginationLink>
  )
}
PaginationNext.displayName = 'PaginationNext'

export function PaginationEllipsis({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      aria-hidden
      className={cn('flex h-9 w-9 items-center justify-center', className)}
      {...props}
    >
      <MoreHorizontal className="h-4 w-4" />
      <span className="sr-only">More pages</span>
    </span>
  )
}
PaginationEllipsis.displayName = 'PaginationEllipsis'
