import type { HTMLAttributes, ReactNode } from "react";
import { forwardRef } from "react";
import {
  Popover as AriaPopover,
  type PopoverProps as AriaPopoverProps,
  Button,
  type ButtonProps,
  Dialog,
  DialogTrigger,
  type DialogTriggerProps,
} from "react-aria-components";
import { ariaClassName } from "../lib/react-aria.js";
import { Slot } from "../lib/slot.js";

export interface PopoverProps
  extends Omit<DialogTriggerProps, "isOpen" | "defaultOpen"> {
  open?: boolean;
  defaultOpen?: boolean;
}

export function Popover({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: PopoverProps) {
  return (
    <DialogTrigger
      isOpen={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      {...props}
    />
  );
}

interface PopoverTriggerProps extends Omit<ButtonProps, "slot" | "children"> {
  asChild?: boolean;
  children?: ReactNode;
}

export const PopoverTrigger = forwardRef<
  HTMLButtonElement,
  PopoverTriggerProps
>(({ asChild, children, ...props }, ref) =>
  asChild ? (
    <Slot ref={ref} slot="trigger" {...(props as Record<string, unknown>)}>
      {children}
    </Slot>
  ) : (
    <Button ref={ref} slot="trigger" {...props}>
      {children}
    </Button>
  ),
);
PopoverTrigger.displayName = "PopoverTrigger";

export const PopoverAnchor = forwardRef<
  HTMLSpanElement,
  HTMLAttributes<HTMLSpanElement>
>((props, ref) => <span ref={ref} {...props} />);
PopoverAnchor.displayName = "PopoverAnchor";

export interface PopoverContentProps
  extends Omit<AriaPopoverProps, "placement" | "offset"> {
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
}

export const PopoverContent = forwardRef<HTMLElement, PopoverContentProps>(
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
    const placement = (
      align === "center" ? side : `${side} ${align}`
    ) as NonNullable<AriaPopoverProps["placement"]>;

    return (
      <AriaPopover
        ref={ref}
        placement={placement}
        offset={sideOffset}
        className={ariaClassName(
          "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[entering]:animate-in data-[exiting]:animate-out data-[exiting]:fade-out-0 data-[entering]:fade-in-0 data-[exiting]:zoom-out-95 data-[entering]:zoom-in-95",
          className,
        )}
        {...props}
      >
        {(values) => (
          <Dialog className="outline-none">
            {typeof children === "function" ? children(values) : children}
          </Dialog>
        )}
      </AriaPopover>
    );
  },
);
PopoverContent.displayName = "PopoverContent";
