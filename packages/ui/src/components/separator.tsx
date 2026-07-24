import { forwardRef } from "react";
import {
  Separator as AriaSeparator,
  type SeparatorProps as AriaSeparatorProps,
} from "react-aria-components";
import { cn } from "../lib/cn.js";

export interface SeparatorProps extends AriaSeparatorProps {
  decorative?: boolean;
}

export const Separator = forwardRef<HTMLElement, SeparatorProps>(
  (
    { className, orientation = "horizontal", decorative = true, ...props },
    ref,
  ) => (
    <AriaSeparator
      ref={ref}
      orientation={orientation}
      aria-hidden={decorative || undefined}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      {...props}
    />
  ),
);
Separator.displayName = "Separator";
