import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";
import { forwardRef } from "react";
import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
} from "react-aria-components";
import { cn } from "../lib/cn.js";
import { Slot } from "../lib/slot.js";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3",
        lg: "h-11 px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends Omit<AriaButtonProps, "className" | "isDisabled" | "children">,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  className?: string;
  disabled?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, disabled, children, ...props },
    ref,
  ) => {
    const styles = cn(buttonVariants({ variant, size, className }));

    if (asChild) {
      const childProps = props as Record<string, unknown>;
      return (
        <Slot
          className={styles}
          ref={ref}
          aria-disabled={disabled || undefined}
          {...childProps}
        >
          {children}
        </Slot>
      );
    }

    return (
      <AriaButton ref={ref} className={styles} isDisabled={disabled} {...props}>
        {children}
      </AriaButton>
    );
  },
);
Button.displayName = "Button";
