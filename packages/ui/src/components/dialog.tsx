import { X } from "lucide-react";
import type {
  ComponentPropsWithoutRef,
  HTMLAttributes,
  ReactNode,
  RefAttributes,
} from "react";
import { Fragment, forwardRef } from "react";
import {
  Dialog as AriaDialog,
  type DialogProps as AriaDialogProps,
  DialogTrigger as AriaDialogTrigger,
  type DialogTriggerProps as AriaDialogTriggerProps,
  Button,
  type ButtonProps,
  Heading,
  Modal,
  ModalOverlay,
  type ModalOverlayProps,
  Text,
} from "react-aria-components";
import { cn } from "../lib/cn.js";
import { Slot } from "../lib/slot.js";

export interface DialogProps
  extends Omit<AriaDialogTriggerProps, "isOpen" | "defaultOpen"> {
  open?: boolean;
  defaultOpen?: boolean;
}

export function Dialog({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: DialogProps) {
  return (
    <AriaDialogTrigger
      isOpen={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      {...props}
    />
  );
}

interface TriggerProps extends Omit<ButtonProps, "slot" | "children"> {
  asChild?: boolean;
  children?: ReactNode;
}

export const DialogTrigger = forwardRef<HTMLButtonElement, TriggerProps>(
  ({ asChild, children, ...props }, ref) =>
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
DialogTrigger.displayName = "DialogTrigger";

export const DialogPortal = Fragment;

export const DialogClose = forwardRef<HTMLButtonElement, TriggerProps>(
  ({ asChild, children, ...props }, ref) =>
    asChild ? (
      <Slot ref={ref} slot="close" {...(props as Record<string, unknown>)}>
        {children}
      </Slot>
    ) : (
      <Button ref={ref} slot="close" {...props}>
        {children}
      </Button>
    ),
);
DialogClose.displayName = "DialogClose";

const overlayStyles =
  "fixed inset-0 z-50 flex items-center justify-center bg-black/80 data-[entering]:animate-in data-[exiting]:animate-out data-[exiting]:fade-out-0 data-[entering]:fade-in-0";

export const DialogOverlay = forwardRef<HTMLDivElement, ModalOverlayProps>(
  ({ className, ...props }, ref) => (
    <ModalOverlay
      ref={ref}
      className={(values) =>
        cn(
          overlayStyles,
          values.defaultClassName,
          typeof className === "function" ? className(values) : className,
        )
      }
      {...props}
    />
  ),
);
DialogOverlay.displayName = "DialogOverlay";

export interface DialogContentProps
  extends Omit<AriaDialogProps, "className">,
    RefAttributes<HTMLElement> {
  className?: string;
}

export const DialogContent = forwardRef<HTMLElement, DialogContentProps>(
  ({ className, children, ...props }, ref) => (
    <DialogOverlay>
      <Modal
        className={cn(
          "relative w-full max-w-lg data-[entering]:animate-in data-[exiting]:animate-out data-[exiting]:fade-out-0 data-[entering]:fade-in-0 data-[exiting]:zoom-out-95 data-[entering]:zoom-in-95",
          className,
        )}
      >
        <AriaDialog
          ref={ref}
          data-state="open"
          className="relative grid gap-4 border bg-background p-6 shadow-lg outline-none sm:rounded-lg"
          {...props}
        >
          {(values) => (
            <>
              {typeof children === "function" ? children(values) : children}
              <Button
                slot="close"
                className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </Button>
            </>
          )}
        </AriaDialog>
      </Modal>
    </DialogOverlay>
  ),
);
DialogContent.displayName = "DialogContent";

export function DialogHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col space-y-1.5 text-center sm:text-left",
        className,
      )}
      {...props}
    />
  );
}
DialogHeader.displayName = "DialogHeader";

export function DialogFooter({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
        className,
      )}
      {...props}
    />
  );
}
DialogFooter.displayName = "DialogFooter";

export const DialogTitle = forwardRef<
  HTMLHeadingElement,
  ComponentPropsWithoutRef<typeof Heading>
>(({ className, ...props }, ref) => (
  <Heading
    ref={ref}
    slot="title"
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = forwardRef<
  HTMLElement,
  ComponentPropsWithoutRef<typeof Text>
>(({ className, ...props }, ref) => (
  <Text
    ref={ref}
    slot="description"
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = "DialogDescription";
