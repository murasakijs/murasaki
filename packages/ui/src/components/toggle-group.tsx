import type { VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";
import { createContext, forwardRef, useContext } from "react";
import {
  ToggleButton,
  ToggleButtonGroup,
  type ToggleButtonGroupProps,
  type ToggleButtonProps,
} from "react-aria-components";
import { cn } from "../lib/cn.js";
import { toggleVariants } from "./toggle.js";

const ToggleGroupContext = createContext<VariantProps<typeof toggleVariants>>({
  size: "default",
  variant: "default",
});

export interface ToggleGroupProps
  extends Omit<
      ToggleButtonGroupProps,
      | "selectionMode"
      | "selectedKeys"
      | "defaultSelectedKeys"
      | "onSelectionChange"
      | "children"
    >,
    VariantProps<typeof toggleVariants> {
  type: "single" | "multiple";
  value?: string | string[];
  defaultValue?: string | string[];
  onValueChange?: (value: string | string[]) => void;
  children?: ReactNode;
}

export const ToggleGroup = forwardRef<HTMLDivElement, ToggleGroupProps>(
  (
    {
      className,
      variant,
      size,
      type,
      value,
      defaultValue,
      onValueChange,
      children,
      ...props
    },
    ref,
  ) => {
    const selectedKeys =
      value === undefined
        ? undefined
        : new Set(Array.isArray(value) ? value : [value]);
    const defaultSelectedKeys =
      defaultValue === undefined
        ? undefined
        : new Set(Array.isArray(defaultValue) ? defaultValue : [defaultValue]);

    return (
      <ToggleButtonGroup
        ref={ref}
        selectionMode={type}
        selectedKeys={selectedKeys}
        defaultSelectedKeys={defaultSelectedKeys}
        onSelectionChange={(keys) => {
          const values = [...keys].map(String);
          onValueChange?.(type === "single" ? (values[0] ?? "") : values);
        }}
        className={cn("flex items-center justify-center gap-1", className)}
        {...props}
      >
        <ToggleGroupContext.Provider value={{ variant, size }}>
          {children}
        </ToggleGroupContext.Provider>
      </ToggleButtonGroup>
    );
  },
);
ToggleGroup.displayName = "ToggleGroup";

export interface ToggleGroupItemProps
  extends Omit<ToggleButtonProps, "id">,
    VariantProps<typeof toggleVariants> {
  value: string;
}

export const ToggleGroupItem = forwardRef<
  HTMLButtonElement,
  ToggleGroupItemProps
>(({ className, children, variant, size, value, ...props }, ref) => {
  const context = useContext(ToggleGroupContext);

  return (
    <ToggleButton
      ref={ref}
      id={value}
      className={cn(
        toggleVariants({
          variant: context.variant ?? variant,
          size: context.size ?? size,
        }),
        className,
      )}
      {...props}
    >
      {children}
    </ToggleButton>
  );
});
ToggleGroupItem.displayName = "ToggleGroupItem";
