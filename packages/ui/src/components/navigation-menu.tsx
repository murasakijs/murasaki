import { cva } from "class-variance-authority";
import { ChevronDown } from "lucide-react";
import type { HTMLAttributes, LiHTMLAttributes } from "react";
import { createContext, forwardRef, useContext, useState } from "react";
import {
  Button,
  type ButtonProps,
  Link,
  type LinkProps,
} from "react-aria-components";
import { cn } from "../lib/cn.js";
import { ariaClassName } from "../lib/react-aria.js";

const NavigationItemContext = createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
} | null>(null);

export const NavigationMenu = forwardRef<
  HTMLElement,
  HTMLAttributes<HTMLElement>
>(({ className, ...props }, ref) => (
  <nav
    ref={ref}
    className={cn(
      "relative z-10 flex max-w-max flex-1 items-center justify-center",
      className,
    )}
    {...props}
  />
));
NavigationMenu.displayName = "NavigationMenu";

export const NavigationMenuList = forwardRef<
  HTMLUListElement,
  HTMLAttributes<HTMLUListElement>
>(({ className, ...props }, ref) => (
  <ul
    ref={ref}
    className={cn(
      "group flex flex-1 list-none items-center justify-center space-x-1",
      className,
    )}
    {...props}
  />
));
NavigationMenuList.displayName = "NavigationMenuList";

export const NavigationMenuItem = forwardRef<
  HTMLLIElement,
  LiHTMLAttributes<HTMLLIElement>
>(({ className, children, ...props }, ref) => {
  const [open, setOpen] = useState(false);
  return (
    <NavigationItemContext.Provider value={{ open, setOpen }}>
      <li ref={ref} className={cn("relative", className)} {...props}>
        {children}
      </li>
    </NavigationItemContext.Provider>
  );
});
NavigationMenuItem.displayName = "NavigationMenuItem";

export const navigationMenuTriggerStyle = cva(
  "group inline-flex h-10 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[pressed]:bg-accent/50",
);

export const NavigationMenuTrigger = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, children, onPress, onHoverStart, ...props }, ref) => {
    const context = useContext(NavigationItemContext);
    return (
      <Button
        ref={ref}
        aria-expanded={context?.open}
        className={ariaClassName(
          cn(navigationMenuTriggerStyle(), "group", className),
        )}
        onPress={(event) => {
          context?.setOpen(!context.open);
          onPress?.(event);
        }}
        onHoverStart={(event) => {
          context?.setOpen(true);
          onHoverStart?.(event);
        }}
        {...props}
      >
        {typeof children === "function" ? (
          (values) => (
            <>
              {children(values)}
              <ChevronDown
                className={cn(
                  "relative top-px ml-1 h-3 w-3 transition duration-200",
                  context?.open && "rotate-180",
                )}
                aria-hidden="true"
              />
            </>
          )
        ) : (
          <>
            {children}{" "}
            <ChevronDown
              className={cn(
                "relative top-px ml-1 h-3 w-3 transition duration-200",
                context?.open && "rotate-180",
              )}
              aria-hidden="true"
            />
          </>
        )}
      </Button>
    );
  },
);
NavigationMenuTrigger.displayName = "NavigationMenuTrigger";

export const NavigationMenuContent = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const context = useContext(NavigationItemContext);
  if (!context?.open) return null;

  return (
    <div
      ref={ref}
      className={cn(
        "absolute left-0 top-full mt-1.5 w-max rounded-md border bg-popover p-2 text-popover-foreground shadow-lg",
        className,
      )}
      {...props}
    />
  );
});
NavigationMenuContent.displayName = "NavigationMenuContent";

export const NavigationMenuLink = forwardRef<HTMLAnchorElement, LinkProps>(
  ({ className, ...props }, ref) => (
    <Link
      ref={ref}
      className={ariaClassName(
        "block select-none rounded-md p-3 leading-none no-underline outline-none transition-colors data-[hovered]:bg-accent data-[hovered]:text-accent-foreground data-[focus-visible]:ring-2 data-[focus-visible]:ring-ring",
        className,
      )}
      {...props}
    />
  ),
);
NavigationMenuLink.displayName = "NavigationMenuLink";

export const NavigationMenuViewport = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("contents", className)} {...props} />
));
NavigationMenuViewport.displayName = "NavigationMenuViewport";

export const NavigationMenuIndicator = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    aria-hidden="true"
    className={cn(
      "absolute top-full z-[1] flex h-1.5 items-end justify-center overflow-hidden",
      className,
    )}
    {...props}
  >
    <div className="relative top-[60%] h-2 w-2 rotate-45 rounded-tl-sm bg-border shadow-md" />
  </div>
));
NavigationMenuIndicator.displayName = "NavigationMenuIndicator";
