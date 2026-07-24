import {
  Children,
  cloneElement,
  forwardRef,
  type HTMLAttributes,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { cn } from "./cn.js";

type SlotElementProps = HTMLAttributes<HTMLElement> & {
  children?: ReactNode;
};

function composeEventHandlers(
  childHandler: unknown,
  slotHandler: unknown,
): ((event: unknown) => void) | undefined {
  if (typeof childHandler !== "function" && typeof slotHandler !== "function") {
    return undefined;
  }

  return (event) => {
    if (typeof childHandler === "function") childHandler(event);
    if (
      !(event as { defaultPrevented?: boolean }).defaultPrevented &&
      typeof slotHandler === "function"
    ) {
      slotHandler(event);
    }
  };
}

export const Slot = forwardRef<HTMLElement, SlotElementProps>(
  ({ children, className, style, ...slotProps }, forwardedRef) => {
    const child = Children.only(children);
    if (!isValidElement(child)) return null;

    const childElement = child as ReactElement<
      Record<string, unknown> & {
        className?: string;
        style?: HTMLAttributes<HTMLElement>["style"];
        ref?: Ref<HTMLElement>;
      }
    >;
    const mergedProps: Record<string, unknown> = {
      ...slotProps,
      ...childElement.props,
      className: cn(className, childElement.props.className),
      style: { ...style, ...childElement.props.style },
      ref: forwardedRef ?? childElement.props.ref,
    };

    for (const key of Object.keys(slotProps)) {
      if (key.startsWith("on")) {
        mergedProps[key] = composeEventHandlers(
          childElement.props[key],
          slotProps[key as keyof typeof slotProps],
        );
      }
    }

    return cloneElement(childElement, mergedProps);
  },
);
Slot.displayName = "Slot";
