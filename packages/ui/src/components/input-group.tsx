import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes, InputHTMLAttributes } from "react";
import { forwardRef } from "react";
import { cn } from "../lib/cn.js";
import { Button, type ButtonProps } from "./button.js";

export const InputGroup = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="input-group"
    className={cn(
      "relative flex w-full items-center rounded-md border border-input bg-background transition-[color,box-shadow] focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background has-[input:disabled]:opacity-50",
      className,
    )}
    {...props}
  />
));
InputGroup.displayName = "InputGroup";

export const inputGroupAddonVariants = cva(
  "flex items-center gap-2 text-muted-foreground [&>svg:not([class*='size-'])]:size-4 [&>kbd]:rounded-sm",
  {
    variants: {
      align: {
        "inline-start": "pl-3",
        "inline-end": "pr-3",
      },
    },
    defaultVariants: {
      align: "inline-start",
    },
  },
);

export interface InputGroupAddonProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof inputGroupAddonVariants> {}

export const InputGroupAddon = forwardRef<HTMLDivElement, InputGroupAddonProps>(
  ({ className, align, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="input-group-addon"
      className={cn(inputGroupAddonVariants({ align, className }))}
      {...props}
    />
  ),
);
InputGroupAddon.displayName = "InputGroupAddon";

export type InputGroupInputProps = InputHTMLAttributes<HTMLInputElement>;

export const InputGroupInput = forwardRef<
  HTMLInputElement,
  InputGroupInputProps
>(({ className, type, ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    data-slot="input-group-input"
    className={cn(
      "flex h-10 w-full bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed",
      className,
    )}
    {...props}
  />
));
InputGroupInput.displayName = "InputGroupInput";

export const InputGroupText = forwardRef<
  HTMLSpanElement,
  HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    data-slot="input-group-text"
    className={cn(
      "text-muted-foreground flex items-center gap-2 text-sm",
      className,
    )}
    {...props}
  />
));
InputGroupText.displayName = "InputGroupText";

export const InputGroupButton = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "ghost", size = "sm", ...props }, ref) => (
    <Button
      ref={ref}
      data-slot="input-group-button"
      variant={variant}
      size={size}
      className={cn("text-sm shadow-none", className)}
      {...props}
    />
  ),
);
InputGroupButton.displayName = "InputGroupButton";
