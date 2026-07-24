import { forwardRef } from "react";
import {
  Tabs as AriaTabs,
  type TabsProps as AriaTabsProps,
  Tab,
  TabList,
  type TabListProps,
  TabPanel,
  type TabPanelProps,
  type TabProps,
} from "react-aria-components";
import { ariaClassName } from "../lib/react-aria.js";

export interface TabsProps
  extends Omit<
    AriaTabsProps,
    "selectedKey" | "defaultSelectedKey" | "onSelectionChange"
  > {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

export const Tabs = forwardRef<HTMLDivElement, TabsProps>(
  ({ value, defaultValue, onValueChange, ...props }, ref) => (
    <AriaTabs
      ref={ref}
      selectedKey={value}
      defaultSelectedKey={defaultValue}
      onSelectionChange={(key) => onValueChange?.(String(key))}
      {...props}
    />
  ),
);
Tabs.displayName = "Tabs";

export const TabsList = forwardRef<HTMLDivElement, TabListProps<object>>(
  ({ className, ...props }, ref) => (
    <TabList
      ref={ref}
      className={ariaClassName(
        "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
        className,
      )}
      {...props}
    />
  ),
);
TabsList.displayName = "TabsList";

export interface TabsTriggerProps extends Omit<TabProps, "id"> {
  value: string;
  disabled?: boolean;
}

export const TabsTrigger = forwardRef<HTMLDivElement, TabsTriggerProps>(
  ({ className, value, disabled, ...props }, ref) => (
    <Tab
      ref={ref}
      id={value}
      isDisabled={disabled}
      className={ariaClassName(
        "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background outline-none transition-all data-[focus-visible]:ring-2 data-[focus-visible]:ring-ring data-[focus-visible]:ring-offset-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[selected]:bg-background data-[selected]:text-foreground data-[selected]:shadow-sm",
        className,
      )}
      {...props}
    />
  ),
);
TabsTrigger.displayName = "TabsTrigger";

export interface TabsContentProps extends Omit<TabPanelProps, "id"> {
  value: string;
}

export const TabsContent = forwardRef<HTMLDivElement, TabsContentProps>(
  ({ className, value, ...props }, ref) => (
    <TabPanel
      ref={ref}
      id={value}
      className={ariaClassName(
        "mt-2 ring-offset-background outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-ring data-[focus-visible]:ring-offset-2",
        className,
      )}
      {...props}
    />
  ),
);
TabsContent.displayName = "TabsContent";
