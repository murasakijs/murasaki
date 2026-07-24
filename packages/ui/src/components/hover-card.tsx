import type {
  FocusEvent,
  HTMLAttributes,
  MouseEvent,
  MutableRefObject,
  ReactNode,
  RefObject,
} from "react";
import { createContext, forwardRef, useContext, useRef, useState } from "react";
import { Dialog, Popover, type PopoverProps } from "react-aria-components";
import { ariaClassName } from "../lib/react-aria.js";
import { Slot } from "../lib/slot.js";

const HoverCardContext = createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: RefObject<Element | null>;
} | null>(null);

export interface HoverCardProps {
  children?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  openDelay?: number;
  closeDelay?: number;
}

export function HoverCard({
  children,
  open,
  defaultOpen = false,
  onOpenChange,
  openDelay = 250,
  closeDelay = 150,
}: HoverCardProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const triggerRef = useRef<Element>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentOpen = open ?? internalOpen;

  const setOpen = (next: boolean) => {
    if (open === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };

  const schedule = (next: boolean) => {
    const timer = next ? openTimer : closeTimer;
    const otherTimer = next ? closeTimer : openTimer;
    if (otherTimer.current) clearTimeout(otherTimer.current);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => setOpen(next),
      next ? openDelay : closeDelay,
    );
  };

  return (
    <HoverCardContext.Provider
      value={{
        open: currentOpen,
        setOpen: (next) => schedule(next),
        triggerRef,
      }}
    >
      {children}
    </HoverCardContext.Provider>
  );
}

export interface HoverCardTriggerProps extends HTMLAttributes<HTMLElement> {
  asChild?: boolean;
}

export const HoverCardTrigger = forwardRef<HTMLElement, HoverCardTriggerProps>(
  (
    { asChild, onMouseEnter, onMouseLeave, onFocus, onBlur, ...props },
    forwardedRef,
  ) => {
    const context = useContext(HoverCardContext);
    const setRef = (node: HTMLElement | null) => {
      const triggerRef = context?.triggerRef as
        | MutableRefObject<Element | null>
        | undefined;
      if (triggerRef) triggerRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    };
    const handlers = {
      onMouseEnter: (event: MouseEvent<HTMLElement>) => {
        onMouseEnter?.(event);
        context?.setOpen(true);
      },
      onMouseLeave: (event: MouseEvent<HTMLElement>) => {
        onMouseLeave?.(event);
        context?.setOpen(false);
      },
      onFocus: (event: FocusEvent<HTMLElement>) => {
        onFocus?.(event);
        context?.setOpen(true);
      },
      onBlur: (event: FocusEvent<HTMLElement>) => {
        onBlur?.(event);
        context?.setOpen(false);
      },
    };

    return asChild ? (
      <Slot
        ref={setRef}
        {...handlers}
        {...(props as Record<string, unknown>)}
      />
    ) : (
      <button ref={setRef} type="button" {...handlers} {...props} />
    );
  },
);
HoverCardTrigger.displayName = "HoverCardTrigger";

export interface HoverCardContentProps
  extends Omit<PopoverProps, "isOpen" | "triggerRef" | "placement" | "offset"> {
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
}

export const HoverCardContent = forwardRef<HTMLElement, HoverCardContentProps>(
  (
    {
      className,
      align = "center",
      side = "bottom",
      sideOffset = 4,
      children,
      ...props
    },
    ref,
  ) => {
    const context = useContext(HoverCardContext);
    const placement = (
      align === "center" ? side : `${side} ${align}`
    ) as NonNullable<PopoverProps["placement"]>;

    return (
      <Popover
        ref={ref}
        isOpen={context?.open}
        onOpenChange={(next) => context?.setOpen(next)}
        triggerRef={context?.triggerRef}
        placement={placement}
        offset={sideOffset}
        className={ariaClassName(
          "z-50 w-64 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[entering]:animate-in data-[exiting]:animate-out data-[exiting]:fade-out-0 data-[entering]:fade-in-0 data-[exiting]:zoom-out-95 data-[entering]:zoom-in-95",
          className,
        )}
        {...props}
      >
        {(values) => (
          <Dialog className="outline-none">
            {typeof children === "function" ? children(values) : children}
          </Dialog>
        )}
      </Popover>
    );
  },
);
HoverCardContent.displayName = "HoverCardContent";
