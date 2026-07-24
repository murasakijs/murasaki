import { Circle } from "lucide-react";
import type { ReactNode } from "react";
import { forwardRef } from "react";
import {
  Radio as AriaRadio,
  RadioGroup as AriaRadioGroup,
  type RadioGroupProps as AriaRadioGroupProps,
  type RadioProps as AriaRadioProps,
} from "react-aria-components";
import { ariaClassName } from "../lib/react-aria.js";

export interface RadioGroupProps extends Omit<AriaRadioGroupProps, "onChange"> {
  onValueChange?: (value: string) => void;
  disabled?: boolean;
}

export const RadioGroup = forwardRef<HTMLDivElement, RadioGroupProps>(
  ({ className, onValueChange, disabled, ...props }, ref) => (
    <AriaRadioGroup
      ref={ref}
      className={ariaClassName("grid gap-2", className)}
      onChange={onValueChange}
      isDisabled={disabled}
      {...props}
    />
  ),
);
RadioGroup.displayName = "RadioGroup";

export interface RadioGroupItemProps extends Omit<AriaRadioProps, "children"> {
  disabled?: boolean;
  children?: ReactNode;
}

export const RadioGroupItem = forwardRef<HTMLLabelElement, RadioGroupItemProps>(
  ({ className, disabled, children, ...props }, ref) => (
    <AriaRadio
      ref={ref}
      isDisabled={disabled}
      className={ariaClassName(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-primary text-primary shadow-sm outline-none data-[focus-visible]:ring-1 data-[focus-visible]:ring-ring data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      {({ isSelected }) => (
        <>
          {isSelected && (
            <Circle
              className="size-2.5 fill-current text-current"
              aria-hidden="true"
            />
          )}
          {children}
        </>
      )}
    </AriaRadio>
  ),
);
RadioGroupItem.displayName = "RadioGroupItem";
