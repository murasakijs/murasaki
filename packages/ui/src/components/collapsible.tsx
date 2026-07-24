import type { CSSProperties, ReactNode } from "react";
import { forwardRef } from "react";
import {
  Button,
  type ButtonProps,
  Disclosure,
  DisclosurePanel,
  type DisclosurePanelProps,
  type DisclosureProps,
} from "react-aria-components";
import { ariaClassName } from "../lib/react-aria.js";
import { Slot } from "../lib/slot.js";

export interface CollapsibleProps
  extends Omit<DisclosureProps, "isExpanded" | "defaultExpanded"> {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const Collapsible = forwardRef<HTMLDivElement, CollapsibleProps>(
  ({ open, defaultOpen, onOpenChange, ...props }, ref) => (
    <Disclosure
      ref={ref}
      isExpanded={open}
      defaultExpanded={defaultOpen}
      onExpandedChange={onOpenChange}
      {...props}
    />
  ),
);
Collapsible.displayName = "Collapsible";

export interface CollapsibleTriggerProps
  extends Omit<ButtonProps, "slot" | "style"> {
  asChild?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
}

export const CollapsibleTrigger = forwardRef<
  HTMLButtonElement,
  CollapsibleTriggerProps
>(({ asChild, children, className, ...props }, ref) => {
  if (asChild) {
    return (
      <Slot
        ref={ref}
        slot="trigger"
        className={typeof className === "string" ? className : undefined}
        {...props}
      >
        {children}
      </Slot>
    );
  }

  return (
    <Button ref={ref} slot="trigger" className={className} {...props}>
      {children}
    </Button>
  );
});
CollapsibleTrigger.displayName = "CollapsibleTrigger";

export const CollapsibleContent = forwardRef<
  HTMLDivElement,
  DisclosurePanelProps
>(({ className, ...props }, ref) => (
  <DisclosurePanel
    ref={ref}
    className={ariaClassName("", className)}
    {...props}
  />
));
CollapsibleContent.displayName = "CollapsibleContent";
