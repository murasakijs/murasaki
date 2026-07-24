import { forwardRef } from "react";
import {
  Label as AriaLabel,
  type LabelProps as AriaLabelProps,
} from "react-aria-components";
import { cn } from "../lib/cn.js";

export const Label = forwardRef<HTMLLabelElement, AriaLabelProps>(
  ({ className, ...props }, ref) => (
    <AriaLabel
      ref={ref}
      className={cn(
        "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className,
      )}
      {...props}
    />
  ),
);
Label.displayName = "Label";
