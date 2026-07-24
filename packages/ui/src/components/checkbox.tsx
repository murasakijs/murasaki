import { Check, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { forwardRef } from "react";
import {
  Checkbox as AriaCheckbox,
  type CheckboxProps as AriaCheckboxProps,
} from "react-aria-components";
import { ariaClassName } from "../lib/react-aria.js";

export interface CheckboxProps
  extends Omit<
    AriaCheckboxProps,
    "isSelected" | "defaultSelected" | "onChange" | "children"
  > {
  checked?: boolean | "indeterminate";
  defaultChecked?: boolean | "indeterminate";
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  children?: ReactNode;
}

export const Checkbox = forwardRef<HTMLLabelElement, CheckboxProps>(
  (
    {
      className,
      checked,
      defaultChecked,
      onCheckedChange,
      disabled,
      children,
      ...props
    },
    ref,
  ) => (
    <AriaCheckbox
      ref={ref}
      isSelected={checked === "indeterminate" ? undefined : checked}
      defaultSelected={
        defaultChecked === "indeterminate" ? undefined : defaultChecked
      }
      isIndeterminate={
        checked === "indeterminate" || defaultChecked === "indeterminate"
      }
      onChange={onCheckedChange}
      isDisabled={disabled}
      className={ariaClassName(
        "peer inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-primary text-primary-foreground shadow-sm outline-none transition-colors data-[focus-visible]:ring-1 data-[focus-visible]:ring-ring data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[selected]:bg-primary data-[indeterminate]:bg-primary",
        className,
      )}
      {...props}
    >
      {({ isIndeterminate, isSelected }) => (
        <>
          {isIndeterminate ? (
            <Minus className="size-3.5" aria-hidden="true" />
          ) : isSelected ? (
            <Check className="size-3.5" aria-hidden="true" />
          ) : null}
          {children}
        </>
      )}
    </AriaCheckbox>
  ),
);
Checkbox.displayName = "Checkbox";
