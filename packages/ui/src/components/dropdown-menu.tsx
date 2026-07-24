import { Check, ChevronRight, Circle } from "lucide-react";
import type {
  ComponentPropsWithoutRef,
  HTMLAttributes,
  ReactNode,
} from "react";
import { createContext, Fragment, forwardRef, useContext } from "react";
import {
  Button,
  type ButtonProps,
  Header,
  Menu,
  MenuItem,
  type MenuItemProps,
  type MenuProps,
  MenuSection,
  type MenuSectionProps,
  MenuTrigger,
  type MenuTriggerProps,
  Popover,
  type PopoverProps,
  Separator,
  type SeparatorProps,
  SubmenuTrigger,
} from "react-aria-components";
import { cn } from "../lib/cn.js";
import { ariaClassName } from "../lib/react-aria.js";
import { Slot } from "../lib/slot.js";

export interface DropdownMenuProps extends MenuTriggerProps {}
export const DropdownMenu = MenuTrigger;

interface DropdownMenuTriggerProps
  extends Omit<ButtonProps, "children" | "slot"> {
  asChild?: boolean;
  children?: ReactNode;
}

export const DropdownMenuTrigger = forwardRef<
  HTMLButtonElement,
  DropdownMenuTriggerProps
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
DropdownMenuTrigger.displayName = "DropdownMenuTrigger";

export const DropdownMenuGroup = MenuSection as <T extends object>(
  props: MenuSectionProps<T>,
) => ReactNode;

export const DropdownMenuPortal = Fragment;
export const DropdownMenuSub = SubmenuTrigger;

const RadioValueContext = createContext<string | undefined>(undefined);

export function DropdownMenuRadioGroup({
  value,
  children,
}: {
  value?: string;
  onValueChange?: (value: string) => void;
  children?: ReactNode;
}) {
  return (
    <RadioValueContext.Provider value={value}>
      {children}
    </RadioValueContext.Provider>
  );
}

export interface DropdownMenuContentProps<T extends object>
  extends Omit<MenuProps<T>, "className"> {
  className?: string;
  sideOffset?: number;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
}

export const DropdownMenuContent = forwardRef<
  HTMLDivElement,
  DropdownMenuContentProps<object>
>(
  (
    { className, sideOffset = 4, align = "start", side = "bottom", ...props },
    ref,
  ) => {
    const placement = (
      align === "center" ? side : `${side} ${align}`
    ) as NonNullable<PopoverProps["placement"]>;

    return (
      <Popover
        placement={placement}
        offset={sideOffset}
        className="z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[entering]:animate-in data-[exiting]:animate-out data-[exiting]:fade-out-0 data-[entering]:fade-in-0 data-[exiting]:zoom-out-95 data-[entering]:zoom-in-95"
      >
        <Menu ref={ref} className={cn("outline-none", className)} {...props} />
      </Popover>
    );
  },
);
DropdownMenuContent.displayName = "DropdownMenuContent";

export interface DropdownMenuItemProps
  extends Omit<MenuItemProps<object>, "value"> {
  inset?: boolean;
  onSelect?: () => void;
}

export const DropdownMenuItem = forwardRef<
  HTMLDivElement,
  DropdownMenuItemProps
>(({ className, inset, onSelect, onAction, ...props }, ref) => (
  <MenuItem
    ref={ref}
    className={ariaClassName(
      cn(
        "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors data-[focused]:bg-accent data-[focused]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        inset && "pl-8",
      ),
      className,
    )}
    onAction={() => {
      onSelect?.();
      onAction?.();
    }}
    {...props}
  />
));
DropdownMenuItem.displayName = "DropdownMenuItem";

export interface DropdownMenuCheckboxItemProps extends DropdownMenuItemProps {
  checked?: boolean | "indeterminate";
  onCheckedChange?: (checked: boolean) => void;
}

export const DropdownMenuCheckboxItem = forwardRef<
  HTMLDivElement,
  DropdownMenuCheckboxItemProps
>(
  (
    { className, children, checked, onCheckedChange, onAction, ...props },
    ref,
  ) => (
    <MenuItem
      ref={ref}
      aria-checked={checked === "indeterminate" ? "mixed" : checked}
      className={ariaClassName(
        "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors data-[focused]:bg-accent data-[focused]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      onAction={() => {
        onCheckedChange?.(checked !== true);
        onAction?.();
      }}
      {...props}
    >
      {(values) => (
        <>
          <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
            {checked && <Check className="h-4 w-4" />}
          </span>
          {typeof children === "function" ? children(values) : children}
        </>
      )}
    </MenuItem>
  ),
);
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem";

export interface DropdownMenuRadioItemProps extends DropdownMenuItemProps {
  value: string;
}

export const DropdownMenuRadioItem = forwardRef<
  HTMLDivElement,
  DropdownMenuRadioItemProps
>(({ className, children, value, ...props }, ref) => {
  const selectedValue = useContext(RadioValueContext);
  const checked = selectedValue === value;

  return (
    <MenuItem
      ref={ref}
      id={value}
      aria-checked={checked}
      className={ariaClassName(
        "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors data-[focused]:bg-accent data-[focused]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      {(values) => (
        <>
          <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
            {checked && <Circle className="h-2 w-2 fill-current" />}
          </span>
          {typeof children === "function" ? children(values) : children}
        </>
      )}
    </MenuItem>
  );
});
DropdownMenuRadioItem.displayName = "DropdownMenuRadioItem";

export const DropdownMenuLabel = forwardRef<
  HTMLElement,
  ComponentPropsWithoutRef<typeof Header> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <Header
    ref={ref}
    className={cn(
      "px-2 py-1.5 text-sm font-semibold",
      inset && "pl-8",
      className,
    )}
    {...props}
  />
));
DropdownMenuLabel.displayName = "DropdownMenuLabel";

export const DropdownMenuSeparator = forwardRef<HTMLDivElement, SeparatorProps>(
  ({ className, ...props }, ref) => (
    <Separator
      ref={ref}
      className={cn("-mx-1 my-1 h-px bg-muted", className)}
      {...props}
    />
  ),
);
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";

export function DropdownMenuShortcut({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("ml-auto text-xs tracking-widest opacity-60", className)}
      {...props}
    />
  );
}
DropdownMenuShortcut.displayName = "DropdownMenuShortcut";

export const DropdownMenuSubTrigger = forwardRef<
  HTMLDivElement,
  DropdownMenuItemProps
>(({ className, inset, children, ...props }, ref) => (
  <MenuItem
    ref={ref}
    className={ariaClassName(
      cn(
        "flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[focused]:bg-accent data-[open]:bg-accent",
        inset && "pl-8",
      ),
      className,
    )}
    {...props}
  >
    {(values) => (
      <>
        {typeof children === "function" ? children(values) : children}
        <ChevronRight className="ml-auto h-4 w-4" />
      </>
    )}
  </MenuItem>
));
DropdownMenuSubTrigger.displayName = "DropdownMenuSubTrigger";

export const DropdownMenuSubContent = DropdownMenuContent;
