import type { HTMLAttributes, ReactNode } from "react";
import { createContext, forwardRef, useContext } from "react";
import {
  Tooltip as AriaTooltip,
  type TooltipProps as AriaTooltipProps,
  TooltipTrigger as AriaTooltipTrigger,
  Button,
  type ButtonProps,
  type TooltipTriggerComponentProps,
} from "react-aria-components";
import { ariaClassName } from "../lib/react-aria.js";
import { Slot } from "../lib/slot.js";

const TooltipSettingsContext = createContext<{
  delay?: number;
  closeDelay?: number;
}>({});

export interface TooltipProviderProps extends HTMLAttributes<HTMLDivElement> {
  delayDuration?: number;
  skipDelayDuration?: number;
  children?: ReactNode;
}

export function TooltipProvider({
  delayDuration,
  skipDelayDuration,
  children,
}: TooltipProviderProps) {
  return (
    <TooltipSettingsContext.Provider
      value={{
        delay: delayDuration,
        closeDelay: skipDelayDuration,
      }}
    >
      {children}
    </TooltipSettingsContext.Provider>
  );
}

export interface TooltipProps
  extends Omit<TooltipTriggerComponentProps, "children"> {
  children?: ReactNode;
}

export function Tooltip({ children, ...props }: TooltipProps) {
  const settings = useContext(TooltipSettingsContext);
  return (
    <AriaTooltipTrigger {...settings} {...props}>
      {children}
    </AriaTooltipTrigger>
  );
}

interface TooltipTriggerProps extends Omit<ButtonProps, "children"> {
  asChild?: boolean;
  children?: ReactNode;
}

export const TooltipTrigger = forwardRef<
  HTMLButtonElement,
  TooltipTriggerProps
>(({ asChild, children, ...props }, ref) =>
  asChild ? (
    <Slot ref={ref} {...(props as Record<string, unknown>)}>
      {children}
    </Slot>
  ) : (
    <Button ref={ref} {...props}>
      {children}
    </Button>
  ),
);
TooltipTrigger.displayName = "TooltipTrigger";

export const TooltipPortal = ({ children }: { children?: ReactNode }) =>
  children;

export interface TooltipContentProps
  extends Omit<AriaTooltipProps, "offset" | "placement"> {
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
}

export const TooltipContent = forwardRef<HTMLDivElement, TooltipContentProps>(
  (
    { className, side = "top", align = "center", sideOffset = 8, ...props },
    ref,
  ) => {
    const placement = (
      align === "center" ? side : `${side} ${align}`
    ) as NonNullable<AriaTooltipProps["placement"]>;

    return (
      <AriaTooltip
        ref={ref}
        placement={placement}
        offset={sideOffset}
        className={ariaClassName(
          "z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md data-[entering]:animate-in data-[entering]:fade-in-0 data-[entering]:zoom-in-95 data-[exiting]:animate-out data-[exiting]:fade-out-0 data-[exiting]:zoom-out-95",
          className,
        )}
        {...props}
      />
    );
  },
);
TooltipContent.displayName = "TooltipContent";
