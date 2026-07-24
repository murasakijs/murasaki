import { forwardRef } from "react";
import {
  ProgressBar as AriaProgressBar,
  type ProgressBarProps as AriaProgressBarProps,
} from "react-aria-components";
import { cn } from "../lib/cn.js";

export type ProgressProps = AriaProgressBarProps;

export const Progress = forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, "aria-label": ariaLabel = "Progress", ...props }, ref) => (
    <AriaProgressBar
      ref={ref}
      aria-label={ariaLabel}
      className={cn(
        "relative h-4 w-full overflow-hidden rounded-full bg-secondary",
        className,
      )}
      {...props}
    >
      {({ percentage }) => (
        <div
          className="h-full bg-primary transition-[width]"
          style={{ width: `${percentage}%` }}
        />
      )}
    </AriaProgressBar>
  ),
);
Progress.displayName = "Progress";
