import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { ToggleButton, type ToggleButtonProps } from "react-aria-components";
import { cn } from "../lib/cn.js";

export const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium ring-offset-background transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-ring data-[focus-visible]:ring-offset-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[selected]:bg-accent data-[selected]:text-accent-foreground",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline:
          "border border-input bg-transparent hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        default: "h-10 min-w-10 px-3",
        sm: "h-9 min-w-9 px-2.5",
        lg: "h-11 min-w-11 px-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ToggleProps
  extends Omit<
      ToggleButtonProps,
      "isSelected" | "defaultSelected" | "onChange"
    >,
    VariantProps<typeof toggleVariants> {
  pressed?: boolean;
  defaultPressed?: boolean;
  onPressedChange?: (pressed: boolean) => void;
  disabled?: boolean;
}

export const Toggle = forwardRef<HTMLButtonElement, ToggleProps>(
  (
    {
      className,
      variant,
      size,
      pressed,
      defaultPressed,
      onPressedChange,
      disabled,
      ...props
    },
    ref,
  ) => (
    <ToggleButton
      ref={ref}
      isSelected={pressed}
      defaultSelected={defaultPressed}
      onChange={onPressedChange}
      isDisabled={disabled}
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  ),
);
Toggle.displayName = "Toggle";
