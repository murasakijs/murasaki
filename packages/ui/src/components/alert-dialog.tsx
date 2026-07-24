import type { ComponentPropsWithoutRef, HTMLAttributes } from "react";
import { forwardRef } from "react";
import { cn } from "../lib/cn.js";
import { Button, buttonVariants } from "./button.js";
import {
  Dialog as AlertDialog,
  DialogOverlay as AlertDialogOverlay,
  DialogPortal as AlertDialogPortal,
  DialogTrigger as AlertDialogTrigger,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./dialog.js";

export {
  AlertDialog,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTrigger,
};

export const AlertDialogContent = forwardRef<
  HTMLElement,
  ComponentPropsWithoutRef<typeof DialogContent>
>((props, ref) => <DialogContent ref={ref} role="alertdialog" {...props} />);
AlertDialogContent.displayName = "AlertDialogContent";

export function AlertDialogHeader({
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
AlertDialogHeader.displayName = "AlertDialogHeader";

export function AlertDialogFooter({
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
AlertDialogFooter.displayName = "AlertDialogFooter";

export const AlertDialogTitle = DialogTitle;
export const AlertDialogDescription = DialogDescription;

export const AlertDialogAction = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof Button>
>(({ className, ...props }, ref) => (
  <DialogClose asChild>
    <Button ref={ref} className={cn(buttonVariants(), className)} {...props} />
  </DialogClose>
));
AlertDialogAction.displayName = "AlertDialogAction";

export const AlertDialogCancel = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof Button>
>(({ className, ...props }, ref) => (
  <DialogClose asChild>
    <Button
      ref={ref}
      variant="outline"
      className={cn("mt-2 sm:mt-0", className)}
      {...props}
    />
  </DialogClose>
));
AlertDialogCancel.displayName = "AlertDialogCancel";
