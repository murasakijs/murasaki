import type { HTMLAttributes } from "react";
import { forwardRef } from "react";
import { cn } from "../lib/cn.js";
import { Button, type ButtonProps } from "./button.js";
import {
  DropdownMenuContent,
  type DropdownMenuContentProps,
  DropdownMenuCheckboxItem as MenubarCheckboxItem,
  DropdownMenuGroup as MenubarGroup,
  DropdownMenuItem as MenubarItem,
  DropdownMenuLabel as MenubarLabel,
  DropdownMenu as MenubarMenu,
  DropdownMenuPortal as MenubarPortal,
  DropdownMenuRadioGroup as MenubarRadioGroup,
  DropdownMenuRadioItem as MenubarRadioItem,
  DropdownMenuSeparator as MenubarSeparator,
  DropdownMenuShortcut as MenubarShortcut,
  DropdownMenuSub as MenubarSub,
  DropdownMenuSubContent as MenubarSubContent,
  DropdownMenuSubTrigger as MenubarSubTrigger,
} from "./dropdown-menu.js";

export const Menubar = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    role="menubar"
    className={cn(
      "flex h-10 items-center space-x-1 rounded-md border bg-background p-1",
      className,
    )}
    {...props}
  />
));
Menubar.displayName = "Menubar";

export const MenubarTrigger = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, ...props }, ref) => (
    <Button
      ref={ref}
      slot="trigger"
      className={cn(
        "flex cursor-default select-none items-center rounded-sm px-3 py-1.5 text-sm font-medium outline-none data-[focus-visible]:bg-accent data-[focus-visible]:text-accent-foreground data-[pressed]:bg-accent data-[pressed]:text-accent-foreground",
        className,
      )}
      {...props}
    />
  ),
);
MenubarTrigger.displayName = "MenubarTrigger";

export const MenubarContent = forwardRef<
  HTMLDivElement,
  DropdownMenuContentProps<object>
>(({ className, align = "start", sideOffset = 8, ...props }, ref) => (
  <DropdownMenuContent
    ref={ref}
    align={align}
    sideOffset={sideOffset}
    className={cn("min-w-[12rem]", className)}
    {...props}
  />
));
MenubarContent.displayName = "MenubarContent";

export {
  MenubarCheckboxItem,
  MenubarGroup,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarPortal,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
};
