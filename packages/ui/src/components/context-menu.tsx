import type {
  ButtonHTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Menu, type MenuProps } from "react-aria-components";
import { cn } from "../lib/cn.js";
import { Slot } from "../lib/slot.js";
import {
  DropdownMenuCheckboxItem as ContextMenuCheckboxItem,
  DropdownMenuGroup as ContextMenuGroup,
  DropdownMenuItem as ContextMenuItem,
  DropdownMenuLabel as ContextMenuLabel,
  DropdownMenuPortal as ContextMenuPortal,
  DropdownMenuRadioGroup as ContextMenuRadioGroup,
  DropdownMenuRadioItem as ContextMenuRadioItem,
  DropdownMenuSeparator as ContextMenuSeparator,
  DropdownMenuShortcut as ContextMenuShortcut,
  DropdownMenuSub as ContextMenuSub,
  DropdownMenuSubContent as ContextMenuSubContent,
  DropdownMenuSubTrigger as ContextMenuSubTrigger,
} from "./dropdown-menu.js";

const ContextMenuState = createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
  point: { x: number; y: number };
  setPoint: (point: { x: number; y: number }) => void;
} | null>(null);

export interface ContextMenuProps {
  children?: ReactNode;
  onOpenChange?: (open: boolean) => void;
}

export function ContextMenu({ children, onOpenChange }: ContextMenuProps) {
  const [open, setOpenState] = useState(false);
  const [point, setPoint] = useState({ x: 0, y: 0 });
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };

  return (
    <ContextMenuState.Provider value={{ open, setOpen, point, setPoint }}>
      {children}
    </ContextMenuState.Provider>
  );
}

export interface ContextMenuTriggerProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

export const ContextMenuTrigger = forwardRef<
  HTMLButtonElement,
  ContextMenuTriggerProps
>(({ asChild, onContextMenu, onKeyDown, ...props }, ref) => {
  const state = useContext(ContextMenuState);
  const handleContextMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    onContextMenu?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    state?.setPoint({ x: event.clientX, y: event.clientY });
    state?.setOpen(true);
  };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (
      (event.shiftKey && event.key === "F10") ||
      event.key === "ContextMenu"
    ) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      state?.setPoint({ x: rect.left, y: rect.bottom });
      state?.setOpen(true);
    }
  };

  if (asChild) {
    return (
      <Slot
        ref={ref}
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyDown}
        {...(props as Record<string, unknown>)}
      />
    );
  }

  return (
    <button
      ref={ref}
      type="button"
      onContextMenu={handleContextMenu}
      onKeyDown={handleKeyDown}
      {...props}
    />
  );
});
ContextMenuTrigger.displayName = "ContextMenuTrigger";

export interface ContextMenuContentProps<T extends object>
  extends Omit<MenuProps<T>, "className"> {
  className?: string;
}

export const ContextMenuContent = forwardRef<
  HTMLDivElement,
  ContextMenuContentProps<object>
>(({ className, onAction, ...props }, ref) => {
  const state = useContext(ContextMenuState);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!state?.open) return;
    const close = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        state.setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") state.setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [state]);

  if (!state?.open) return null;

  return (
    <div
      ref={containerRef}
      className="fixed z-50"
      style={{ left: state.point.x, top: state.point.y }}
    >
      <Menu
        ref={ref}
        autoFocus="first"
        className={cn(
          "min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none",
          className,
        )}
        onAction={(key, event) => {
          onAction?.(key, event);
          state.setOpen(false);
        }}
        {...props}
      />
    </div>
  );
});
ContextMenuContent.displayName = "ContextMenuContent";

export {
  ContextMenuCheckboxItem,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
};
