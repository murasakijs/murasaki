import { ChevronDown } from "lucide-react";
import { forwardRef } from "react";
import type { Key } from "react-aria-components";
import {
  Button,
  type ButtonProps,
  Disclosure,
  DisclosureGroup,
  type DisclosureGroupProps,
  DisclosurePanel,
  type DisclosurePanelProps,
  type DisclosureProps,
  Heading,
} from "react-aria-components";
import { ariaClassName } from "../lib/react-aria.js";

export interface AccordionProps
  extends Omit<
    DisclosureGroupProps,
    | "expandedKeys"
    | "defaultExpandedKeys"
    | "onExpandedChange"
    | "allowsMultipleExpanded"
  > {
  type?: "single" | "multiple";
  value?: string | string[];
  defaultValue?: string | string[];
  onValueChange?: (value: string | string[]) => void;
  collapsible?: boolean;
}

export const Accordion = forwardRef<HTMLDivElement, AccordionProps>(
  (
    {
      type = "single",
      value,
      defaultValue,
      onValueChange,
      collapsible: _collapsible,
      ...props
    },
    ref,
  ) => {
    const toKeys = (input?: string | string[]) =>
      input === undefined
        ? undefined
        : new Set(Array.isArray(input) ? input : [input]);

    return (
      <DisclosureGroup
        ref={ref}
        allowsMultipleExpanded={type === "multiple"}
        expandedKeys={toKeys(value)}
        defaultExpandedKeys={toKeys(defaultValue)}
        onExpandedChange={(keys) => {
          const values = [...keys].map(String);
          onValueChange?.(type === "multiple" ? values : (values[0] ?? ""));
        }}
        {...props}
      />
    );
  },
);
Accordion.displayName = "Accordion";

export interface AccordionItemProps extends Omit<DisclosureProps, "id"> {
  value: string;
}

export const AccordionItem = forwardRef<HTMLDivElement, AccordionItemProps>(
  ({ className, value, ...props }, ref) => (
    <Disclosure
      ref={ref}
      id={value as Key}
      className={ariaClassName("border-b", className)}
      {...props}
    />
  ),
);
AccordionItem.displayName = "AccordionItem";

export const AccordionTrigger = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, children, ...props }, ref) => (
    <Heading className="flex">
      <Button
        ref={ref}
        slot="trigger"
        className={ariaClassName(
          "group flex flex-1 items-center justify-between py-4 font-medium transition-all hover:underline",
          className,
        )}
        {...props}
      >
        {typeof children === "function" ? (
          (values) => (
            <>
              {children(values)}
              <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[expanded]:rotate-180" />
            </>
          )
        ) : (
          <>
            {children}
            <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[expanded]:rotate-180" />
          </>
        )}
      </Button>
    </Heading>
  ),
);
AccordionTrigger.displayName = "AccordionTrigger";

export const AccordionContent = forwardRef<
  HTMLDivElement,
  DisclosurePanelProps
>(({ className, children, ...props }, ref) => (
  <DisclosurePanel
    ref={ref}
    className={ariaClassName(
      "overflow-hidden text-sm data-[entering]:animate-accordion-down data-[exiting]:animate-accordion-up",
      className,
    )}
    {...props}
  >
    <div className="pb-4 pt-0">{children}</div>
  </DisclosurePanel>
));
AccordionContent.displayName = "AccordionContent";
