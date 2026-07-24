import type { HTMLAttributes } from "react";
import { forwardRef } from "react";
import { cn } from "../lib/cn.js";

export const ScrollArea = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("relative overflow-auto", className)} {...props}>
    <div className="min-h-full min-w-full rounded-[inherit]">{children}</div>
  </div>
));
ScrollArea.displayName = "ScrollArea";

export interface ScrollBarProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical";
}

export const ScrollBar = forwardRef<HTMLDivElement, ScrollBarProps>(
  ({ className, orientation = "vertical", ...props }, ref) => (
    <div
      ref={ref}
      aria-hidden="true"
      data-orientation={orientation}
      className={cn("pointer-events-none hidden", className)}
      {...props}
    />
  ),
);
ScrollBar.displayName = "ScrollBar";
