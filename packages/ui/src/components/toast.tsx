import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactElement,
  ReactNode,
} from "react";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn.js";

const ToastViewportContext = createContext<HTMLElement | null>(null);
const ToastCloseContext = createContext<(() => void) | null>(null);

export function ToastProvider({ children }: { children?: ReactNode }) {
  const [viewport, setViewport] = useState<HTMLElement | null>(null);
  return (
    <ToastViewportContext.Provider value={viewport}>
      <ToastViewportSetterContext.Provider value={setViewport}>
        {children}
      </ToastViewportSetterContext.Provider>
    </ToastViewportContext.Provider>
  );
}

const ToastViewportSetterContext = createContext<
  (node: HTMLElement | null) => void
>(() => {});

export const ToastViewport = forwardRef<
  HTMLOListElement,
  HTMLAttributes<HTMLOListElement>
>(({ className, ...props }, forwardedRef) => {
  const setViewport = useContext(ToastViewportSetterContext);
  return (
    <ol
      ref={(node) => {
        setViewport(node);
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      }}
      aria-label="Notifications"
      className={cn(
        "fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse gap-2 p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]",
        className,
      )}
      {...props}
    />
  );
});
ToastViewport.displayName = "ToastViewport";

export const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg transition-all animate-in fade-in-80 slide-in-from-top-full sm:slide-in-from-bottom-full",
  {
    variants: {
      variant: {
        default: "border bg-background text-foreground",
        destructive:
          "destructive group border-destructive bg-destructive text-destructive-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface ToastProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title">,
    VariantProps<typeof toastVariants> {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  duration?: number;
}

export const Toast = forwardRef<HTMLDivElement, ToastProps>(
  (
    {
      className,
      variant,
      open,
      defaultOpen = true,
      onOpenChange,
      duration = 5000,
      children,
      ...props
    },
    ref,
  ) => {
    const viewport = useContext(ToastViewportContext);
    const [internalOpen, setInternalOpen] = useState(defaultOpen);
    const visible = open ?? internalOpen;
    const close = useCallback(() => {
      if (open === undefined) setInternalOpen(false);
      onOpenChange?.(false);
    }, [open, onOpenChange]);

    useEffect(() => {
      if (!visible || duration === Number.POSITIVE_INFINITY) return;
      const timeout = setTimeout(close, duration);
      return () => clearTimeout(timeout);
    }, [visible, duration, close]);

    if (!visible || !viewport) return null;

    return createPortal(
      <ToastCloseContext.Provider value={close}>
        <li>
          <div
            ref={ref}
            role={variant === "destructive" ? "alert" : "status"}
            className={cn(toastVariants({ variant }), className)}
            {...props}
          >
            {children}
          </div>
        </li>
      </ToastCloseContext.Provider>,
      viewport,
    );
  },
);
Toast.displayName = "Toast";

export const ToastAction = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn(
      "inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
ToastAction.displayName = "ToastAction";

export const ToastClose = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, onClick, ...props }, ref) => {
  const close = useContext(ToastCloseContext);
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        "absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus-visible:ring-2 group-hover:opacity-100",
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) close?.();
      }}
      {...props}
    >
      <X className="h-4 w-4" />
      <span className="sr-only">Close</span>
    </button>
  );
});
ToastClose.displayName = "ToastClose";

export const ToastTitle = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm font-semibold", className)}
    {...props}
  />
));
ToastTitle.displayName = "ToastTitle";

export const ToastDescription = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("text-sm opacity-90", className)} {...props} />
));
ToastDescription.displayName = "ToastDescription";

export type ToastActionElement = ReactElement<typeof ToastAction>;
