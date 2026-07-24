import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import type { ComponentPropsWithoutRef, HTMLAttributes } from "react";
import { Fragment, forwardRef } from "react";
import {
  Dialog as AriaDialog,
  type DialogProps as AriaDialogProps,
  Button,
  Heading,
  Modal,
  ModalOverlay,
  Text,
} from "react-aria-components";
import { cn } from "../lib/cn.js";
import {
  Dialog as Sheet,
  DialogClose as SheetClose,
  DialogTrigger as SheetTrigger,
} from "./dialog.js";

export { Sheet, SheetClose, SheetTrigger };
export const SheetPortal = Fragment;

export const SheetOverlay = ModalOverlay;

const sheetVariants = cva(
  "fixed z-50 gap-4 bg-background p-6 shadow-lg outline-none transition ease-in-out data-[exiting]:duration-300 data-[entering]:duration-500 data-[entering]:animate-in data-[exiting]:animate-out",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[exiting]:slide-out-to-top data-[entering]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 border-t data-[exiting]:slide-out-to-bottom data-[entering]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[exiting]:slide-out-to-left data-[entering]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4 border-l data-[exiting]:slide-out-to-right data-[entering]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  },
);

export interface SheetContentProps
  extends Omit<AriaDialogProps, "className">,
    VariantProps<typeof sheetVariants> {
  className?: string;
}

export const SheetContent = forwardRef<HTMLElement, SheetContentProps>(
  ({ side = "right", className, children, ...props }, ref) => (
    <ModalOverlay className="fixed inset-0 z-50 bg-black/80 data-[entering]:animate-in data-[exiting]:animate-out data-[exiting]:fade-out-0 data-[entering]:fade-in-0">
      <Modal className={cn(sheetVariants({ side }), className)}>
        <AriaDialog ref={ref} className="contents" {...props}>
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
    </ModalOverlay>
  ),
);
SheetContent.displayName = "SheetContent";

export function SheetHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col space-y-2 text-center sm:text-left",
        className,
      )}
      {...props}
    />
  );
}
SheetHeader.displayName = "SheetHeader";

export function SheetFooter({
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
SheetFooter.displayName = "SheetFooter";

export const SheetTitle = forwardRef<
  HTMLHeadingElement,
  ComponentPropsWithoutRef<typeof Heading>
>(({ className, ...props }, ref) => (
  <Heading
    ref={ref}
    slot="title"
    className={cn("text-lg font-semibold text-foreground", className)}
    {...props}
  />
));
SheetTitle.displayName = "SheetTitle";

export const SheetDescription = forwardRef<
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
SheetDescription.displayName = "SheetDescription";
