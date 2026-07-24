import type { ReactNode } from "react";
import { forwardRef } from "react";
import {
  Switch as AriaSwitch,
  type SwitchProps as AriaSwitchProps,
} from "react-aria-components";
import { ariaClassName } from "../lib/react-aria.js";

export interface SwitchProps
  extends Omit<
    AriaSwitchProps,
    "isSelected" | "defaultSelected" | "onChange" | "children"
  > {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  children?: ReactNode;
}

export const Switch = forwardRef<HTMLLabelElement, SwitchProps>(
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
    <AriaSwitch
      ref={ref}
      isSelected={checked}
      defaultSelected={defaultChecked}
      onChange={onCheckedChange}
      isDisabled={disabled}
      className={ariaClassName(
        "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-input outline-none transition-colors data-[selected]:bg-primary data-[focus-visible]:ring-2 data-[focus-visible]:ring-ring data-[focus-visible]:ring-offset-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      {({ isSelected }) => (
        <>
          <span
            className={`pointer-events-none block size-5 rounded-full bg-background shadow-lg transition-transform ${
              isSelected ? "translate-x-5" : "translate-x-0"
            }`}
          />
          {children}
        </>
      )}
    </AriaSwitch>
  ),
);
Switch.displayName = "Switch";
