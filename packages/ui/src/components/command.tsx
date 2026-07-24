import { Search } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { Children, forwardRef, isValidElement, useId } from "react";
import {
  ComboBox,
  type ComboBoxProps,
  Header,
  Input,
  type InputProps,
  ListBox,
  ListBoxItem,
  type ListBoxItemProps,
  type ListBoxProps,
  ListBoxSection,
  Separator,
  type SeparatorProps,
} from "react-aria-components";
import { cn } from "../lib/cn.js";
import { ariaClassName } from "../lib/react-aria.js";
import { Dialog, DialogContent, type DialogProps } from "./dialog.js";

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join(" ");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return nodeText(node.props.children);
  }
  return "";
}

export interface CommandProps extends Omit<ComboBoxProps<object>, "children"> {
  children?: ReactNode;
}

export const Command = forwardRef<HTMLDivElement, CommandProps>(
  (
    {
      className,
      children,
      defaultFilter,
      "aria-label": ariaLabel,
      "aria-labelledby": ariaLabelledBy,
      ...props
    },
    ref,
  ) => (
    <ComboBox
      ref={ref}
      menuTrigger="input"
      allowsCustomValue
      aria-label={ariaLabel ?? (ariaLabelledBy ? undefined : "Command menu")}
      aria-labelledby={ariaLabelledBy}
      defaultFilter={
        defaultFilter ??
        ((textValue, inputValue) =>
          textValue
            .toLocaleLowerCase()
            .includes(inputValue.toLocaleLowerCase()))
      }
      className={ariaClassName(
        "flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </ComboBox>
  ),
);
Command.displayName = "Command";

export function CommandDialog({ children, ...props }: DialogProps) {
  return (
    <Dialog {...props}>
      <DialogContent className="overflow-hidden p-0">
        <Command>{children}</Command>
      </DialogContent>
    </Dialog>
  );
}

export const CommandInput = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <div className="flex items-center border-b px-3">
      <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
      <Input
        ref={ref}
        className={cn(
          "flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    </div>
  ),
);
CommandInput.displayName = "CommandInput";

export const CommandEmpty = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("py-6 text-center text-sm", className)}
    {...props}
  />
));
CommandEmpty.displayName = "CommandEmpty";

export interface CommandListProps
  extends Omit<ListBoxProps<object>, "children"> {
  children?: ReactNode;
}

export const CommandList = forwardRef<HTMLDivElement, CommandListProps>(
  ({ className, children, ...props }, ref) => {
    const childArray = Children.toArray(children);
    const empty = childArray.find(
      (child) => isValidElement(child) && child.type === CommandEmpty,
    );
    const items = childArray.filter(
      (child) => !(isValidElement(child) && child.type === CommandEmpty),
    );

    return (
      <ListBox
        ref={ref}
        className={ariaClassName(
          "max-h-[300px] overflow-y-auto overflow-x-hidden outline-none",
          className,
        )}
        renderEmptyState={() =>
          isValidElement<{ children?: ReactNode }>(empty)
            ? empty.props.children
            : "No results."
        }
        {...props}
      >
        {items}
      </ListBox>
    );
  },
);
CommandList.displayName = "CommandList";

export interface CommandGroupProps extends HTMLAttributes<HTMLElement> {
  heading?: ReactNode;
}

export const CommandGroup = forwardRef<HTMLElement, CommandGroupProps>(
  ({ className, heading, children, ...props }, ref) => (
    <ListBoxSection
      ref={ref}
      className={cn("overflow-hidden p-1 text-foreground", className)}
      {...props}
    >
      {heading && (
        <Header className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          {heading}
        </Header>
      )}
      {children}
    </ListBoxSection>
  ),
);
CommandGroup.displayName = "CommandGroup";

export const CommandSeparator = forwardRef<HTMLDivElement, SeparatorProps>(
  ({ className, ...props }, ref) => (
    <Separator
      ref={ref}
      className={cn("-mx-1 h-px bg-border", className)}
      {...props}
    />
  ),
);
CommandSeparator.displayName = "CommandSeparator";

export interface CommandItemProps
  extends Omit<ListBoxItemProps<object>, "id" | "value"> {
  value?: string;
  disabled?: boolean;
  onSelect?: (value: string) => void;
}

export const CommandItem = forwardRef<HTMLDivElement, CommandItemProps>(
  (
    { className, value, disabled, onSelect, onAction, children, ...props },
    ref,
  ) => {
    const generatedId = useId();
    const readableText =
      value ??
      (typeof children === "function" ? "" : nodeText(children).trim());
    const itemValue = readableText || generatedId;

    return (
      <ListBoxItem
        ref={ref}
        id={itemValue}
        textValue={readableText || undefined}
        isDisabled={disabled}
        className={ariaClassName(
          "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled]:pointer-events-none data-[selected]:bg-accent data-[selected]:text-accent-foreground data-[focused]:bg-accent data-[disabled]:opacity-50",
          className,
        )}
        onAction={() => {
          onSelect?.(itemValue);
          onAction?.();
        }}
        {...props}
      >
        {children}
      </ListBoxItem>
    );
  },
);
CommandItem.displayName = "CommandItem";

export function CommandShortcut({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
CommandShortcut.displayName = "CommandShortcut";
