import { Check, ChevronDown, ChevronUp } from "lucide-react";
import type {
  ComponentPropsWithoutRef,
  HTMLAttributes,
  ReactNode,
} from "react";
import { forwardRef } from "react";
import {
  Select as AriaSelect,
  type SelectProps as AriaSelectProps,
  SelectValue as AriaSelectValue,
  Button,
  type ButtonProps,
  Header,
  ListBox,
  ListBoxItem,
  type ListBoxItemProps,
  type ListBoxProps,
  ListBoxSection,
  type ListBoxSectionProps,
  Popover,
  type SelectValueProps,
  Separator,
  type SeparatorProps,
} from "react-aria-components";
import { cn } from "../lib/cn.js";
import { ariaClassName } from "../lib/react-aria.js";

export interface SelectProps
  extends Omit<
    AriaSelectProps<object>,
    "selectedKey" | "defaultSelectedKey" | "onSelectionChange"
  > {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

export function Select({
  value,
  defaultValue,
  onValueChange,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...props
}: SelectProps) {
  return (
    <AriaSelect
      aria-label={ariaLabel ?? (ariaLabelledBy ? undefined : "Select")}
      aria-labelledby={ariaLabelledBy}
      selectedKey={value}
      defaultSelectedKey={defaultValue}
      onSelectionChange={(key) => onValueChange?.(String(key))}
      {...props}
    />
  );
}

export const SelectGroup = ListBoxSection as <T extends object>(
  props: ListBoxSectionProps<T>,
) => ReactNode;

export interface MurasakiSelectValueProps extends SelectValueProps<object> {
  placeholder?: ReactNode;
}

export const SelectValue = forwardRef<
  HTMLSpanElement,
  MurasakiSelectValueProps
>(({ placeholder, children, ...props }, ref) => (
  <AriaSelectValue ref={ref} {...props}>
    {(values) => {
      if (typeof children === "function") return children(values);
      if (children !== undefined) return children;
      return values.isPlaceholder ? placeholder : values.selectedText;
    }}
  </AriaSelectValue>
));
SelectValue.displayName = "SelectValue";

export const SelectTrigger = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, children, ...props }, ref) => (
    <Button
      ref={ref}
      className={ariaClassName(
        "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-ring data-[focus-visible]:ring-offset-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 [&>span]:line-clamp-1",
        className,
      )}
      {...props}
    >
      {typeof children === "function" ? (
        (values) => (
          <>
            {children(values)}
            <ChevronDown className="h-4 w-4 opacity-50" />
          </>
        )
      ) : (
        <>
          {children}
          <ChevronDown className="h-4 w-4 opacity-50" />
        </>
      )}
    </Button>
  ),
);
SelectTrigger.displayName = "SelectTrigger";

export const SelectScrollUpButton = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    aria-hidden="true"
    className={cn("flex items-center justify-center py-1", className)}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </div>
));
SelectScrollUpButton.displayName = "SelectScrollUpButton";

export const SelectScrollDownButton = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    aria-hidden="true"
    className={cn("flex items-center justify-center py-1", className)}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </div>
));
SelectScrollDownButton.displayName = "SelectScrollDownButton";

export interface SelectContentProps<T extends object>
  extends Omit<ListBoxProps<T>, "className"> {
  className?: string;
  position?: "item-aligned" | "popper";
}

export const SelectContent = forwardRef<
  HTMLDivElement,
  SelectContentProps<object>
>(({ className, children, position: _position, ...props }, ref) => (
  <Popover className="relative z-50 max-h-96 min-w-[var(--trigger-width)] overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md data-[entering]:animate-in data-[exiting]:animate-out data-[exiting]:fade-out-0 data-[entering]:fade-in-0 data-[exiting]:zoom-out-95 data-[entering]:zoom-in-95">
    <SelectScrollUpButton />
    <ListBox ref={ref} className={cn("p-1 outline-none", className)} {...props}>
      {children}
    </ListBox>
    <SelectScrollDownButton />
  </Popover>
));
SelectContent.displayName = "SelectContent";

export const SelectLabel = forwardRef<
  HTMLElement,
  ComponentPropsWithoutRef<typeof Header>
>(({ className, ...props }, ref) => (
  <Header
    ref={ref}
    className={cn("py-1.5 pl-8 pr-2 text-sm font-semibold", className)}
    {...props}
  />
));
SelectLabel.displayName = "SelectLabel";

export interface SelectItemProps
  extends Omit<ListBoxItemProps<object>, "id" | "value"> {
  value: string;
}

export const SelectItem = forwardRef<HTMLDivElement, SelectItemProps>(
  ({ className, children, value, ...props }, ref) => (
    <ListBoxItem
      ref={ref}
      id={value}
      textValue={typeof children === "string" ? children : undefined}
      className={ariaClassName(
        "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none data-[focused]:bg-accent data-[focused]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      {(values) => (
        <>
          <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
            {values.isSelected && <Check className="h-4 w-4" />}
          </span>
          {typeof children === "function" ? children(values) : children}
        </>
      )}
    </ListBoxItem>
  ),
);
SelectItem.displayName = "SelectItem";

export const SelectSeparator = forwardRef<HTMLDivElement, SeparatorProps>(
  ({ className, ...props }, ref) => (
    <Separator
      ref={ref}
      className={cn("-mx-1 my-1 h-px bg-muted", className)}
      {...props}
    />
  ),
);
SelectSeparator.displayName = "SelectSeparator";
