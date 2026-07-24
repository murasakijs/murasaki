import { cva, type VariantProps } from "class-variance-authority";
import type {
  ComponentPropsWithoutRef,
  ElementRef,
  HTMLAttributes,
} from "react";
import { forwardRef } from "react";
import { cn } from "../lib/cn.js";
import { Slot } from "../lib/slot.js";
import { Separator } from "./separator.js";

export const ItemGroup = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="item-group"
    className={cn("flex w-full flex-col", className)}
    {...props}
  />
));
ItemGroup.displayName = "ItemGroup";

export const ItemSeparator = forwardRef<
  ElementRef<typeof Separator>,
  ComponentPropsWithoutRef<typeof Separator>
>(({ className, orientation = "horizontal", ...props }, ref) => (
  <Separator
    ref={ref}
    data-slot="item-separator"
    orientation={orientation}
    className={cn("my-0", className)}
    {...props}
  />
));
ItemSeparator.displayName = "ItemSeparator";

export const itemVariants = cva(
  "group/item flex w-full items-center rounded-md border border-transparent text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border-border",
        muted: "bg-muted/50",
      },
      size: {
        default: "gap-4 p-4",
        sm: "gap-2.5 px-4 py-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ItemProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof itemVariants> {
  asChild?: boolean;
}

export const Item = forwardRef<HTMLDivElement, ItemProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "div";
    return (
      <Comp
        ref={ref}
        data-slot="item"
        className={cn(itemVariants({ variant, size, className }))}
        {...props}
      />
    );
  },
);
Item.displayName = "Item";

export const itemMediaVariants = cva(
  "flex shrink-0 items-center justify-center gap-2 [&_svg]:pointer-events-none group-has-[[data-slot=item-description]]/item:self-start [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "size-8 rounded-sm border border-input bg-muted [&_svg:not([class*='size-'])]:size-4",
        image:
          "size-10 overflow-hidden rounded-sm [&_img]:size-full [&_img]:object-cover",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface ItemMediaProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof itemMediaVariants> {}

export const ItemMedia = forwardRef<HTMLDivElement, ItemMediaProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="item-media"
      className={cn(itemMediaVariants({ variant, className }))}
      {...props}
    />
  ),
);
ItemMedia.displayName = "ItemMedia";

export const ItemContent = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="item-content"
    className={cn(
      "flex flex-1 flex-col gap-1 [&+[data-slot=item-content]]:flex-none",
      className,
    )}
    {...props}
  />
));
ItemContent.displayName = "ItemContent";

export const ItemTitle = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="item-title"
    className={cn(
      "flex w-fit items-center gap-2 text-sm font-medium leading-snug",
      className,
    )}
    {...props}
  />
));
ItemTitle.displayName = "ItemTitle";

export const ItemDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    data-slot="item-description"
    className={cn(
      "text-muted-foreground line-clamp-2 text-sm font-normal leading-normal [&>a]:underline [&>a]:underline-offset-4",
      className,
    )}
    {...props}
  />
));
ItemDescription.displayName = "ItemDescription";

export const ItemActions = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="item-actions"
    className={cn("flex items-center gap-2", className)}
    {...props}
  />
));
ItemActions.displayName = "ItemActions";

export const ItemHeader = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="item-header"
    className={cn(
      "flex basis-full items-center justify-between gap-2",
      className,
    )}
    {...props}
  />
));
ItemHeader.displayName = "ItemHeader";

export const ItemFooter = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="item-footer"
    className={cn(
      "flex basis-full items-center justify-between gap-2",
      className,
    )}
    {...props}
  />
));
ItemFooter.displayName = "ItemFooter";
