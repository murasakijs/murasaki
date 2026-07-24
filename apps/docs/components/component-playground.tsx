"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  ButtonGroup,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  Kbd,
  KbdGroup,
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarShortcut,
  MenubarTrigger,
  NativeSelect,
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  ScrollArea,
  Slider,
  Spinner,
  Toaster,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from "@murasakijs/ui";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  FilePlus,
  FileText,
} from "lucide-react";
import { useState } from "react";
import { ComponentPreview } from "@/components/component-preview";

export type ComponentPlaygroundName =
  | "alert-dialog"
  | "breadcrumb"
  | "button-group"
  | "collapsible"
  | "command"
  | "context-menu"
  | "empty"
  | "field"
  | "hover-card"
  | "input-group"
  | "item"
  | "kbd"
  | "menubar"
  | "native-select"
  | "navigation-menu"
  | "pagination"
  | "scroll-area"
  | "slider"
  | "spinner"
  | "toast"
  | "toggle-group"
  | "toggle";

const demoCode: Record<ComponentPlaygroundName, string> = {
  "alert-dialog": `import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@murasakijs/ui";

<AlertDialog>
  <AlertDialogTrigger asChild>
    <Button variant="destructive">Delete project</Button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete this project?</AlertDialogTitle>
      <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction>Delete</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>`,
  breadcrumb: `import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink,
  BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from "@murasakijs/ui";

<Breadcrumb>
  <BreadcrumbList>
    <BreadcrumbItem><BreadcrumbLink href="#">Home</BreadcrumbLink></BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem><BreadcrumbPage>Settings</BreadcrumbPage></BreadcrumbItem>
  </BreadcrumbList>
</Breadcrumb>`,
  "button-group": `import { Button, ButtonGroup } from "@murasakijs/ui";

<ButtonGroup aria-label="Text alignment">
  <Button variant="outline">Left</Button>
  <Button variant="outline">Center</Button>
  <Button variant="outline">Right</Button>
</ButtonGroup>`,
  collapsible: `import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@murasakijs/ui";

<Collapsible>
  <CollapsibleTrigger asChild>
    <Button variant="outline">Advanced settings</Button>
  </CollapsibleTrigger>
  <CollapsibleContent className="mt-3 rounded-md border p-4">
    Settings shown on demand.
  </CollapsibleContent>
</Collapsible>`,
  command: `import {
  Command, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList, CommandShortcut,
} from "@murasakijs/ui";

<Command className="max-w-md rounded-lg border">
  <CommandInput placeholder="Type a command…" />
  <CommandList>
    <CommandEmpty>No results.</CommandEmpty>
    <CommandGroup heading="Navigation">
      <CommandItem>Open settings <CommandShortcut>⌘,</CommandShortcut></CommandItem>
    </CommandGroup>
  </CommandList>
</Command>`,
  "context-menu": `import {
  ContextMenu, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger,
} from "@murasakijs/ui";

<ContextMenu>
  <ContextMenuTrigger className="rounded-md border border-dashed p-10">
    Right-click this area
  </ContextMenuTrigger>
  <ContextMenuContent>
    <ContextMenuItem>Rename <ContextMenuShortcut>F2</ContextMenuShortcut></ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem>Delete</ContextMenuItem>
  </ContextMenuContent>
</ContextMenu>`,
  empty: `import {
  Button, Empty, EmptyContent, EmptyDescription,
  EmptyHeader, EmptyMedia, EmptyTitle,
} from "@murasakijs/ui";
import { FilePlus } from "lucide-react";

<Empty>
  <EmptyHeader>
    <EmptyMedia variant="icon"><FilePlus /></EmptyMedia>
    <EmptyTitle>No documents yet</EmptyTitle>
    <EmptyDescription>Create a document or import Markdown.</EmptyDescription>
  </EmptyHeader>
  <EmptyContent><Button>Create document</Button></EmptyContent>
</Empty>`,
  field: `import {
  Field, FieldDescription, FieldError, FieldLabel, Input,
} from "@murasakijs/ui";

<Field data-invalid>
  <FieldLabel htmlFor="demo-email">Email</FieldLabel>
  <Input id="demo-email" aria-invalid />
  <FieldDescription>Used for account recovery.</FieldDescription>
  <FieldError>Enter a valid email address.</FieldError>
</Field>`,
  "hover-card": `import {
  Button, HoverCard, HoverCardContent, HoverCardTrigger,
} from "@murasakijs/ui";

<HoverCard>
  <HoverCardTrigger asChild><Button variant="link">Murasaki Docs</Button></HoverCardTrigger>
  <HoverCardContent>Guides, API references, and examples.</HoverCardContent>
</HoverCard>`,
  "input-group": `import {
  InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput,
} from "@murasakijs/ui";

<InputGroup>
  <InputGroupAddon>https://</InputGroupAddon>
  <InputGroupInput aria-label="Domain" placeholder="example.com" />
  <InputGroupButton type="button">Copy</InputGroupButton>
</InputGroup>`,
  item: `import {
  Button, Item, ItemActions, ItemContent,
  ItemDescription, ItemMedia, ItemTitle,
} from "@murasakijs/ui";
import { FileText } from "lucide-react";

<Item variant="outline">
  <ItemMedia variant="icon"><FileText /></ItemMedia>
  <ItemContent>
    <ItemTitle>Release notes</ItemTitle>
    <ItemDescription>Updated five minutes ago</ItemDescription>
  </ItemContent>
  <ItemActions><Button variant="ghost">Open</Button></ItemActions>
</Item>`,
  kbd: `import { Kbd, KbdGroup } from "@murasakijs/ui";

<KbdGroup aria-label="Command K">
  <Kbd>⌘</Kbd><span aria-hidden="true">+</span><Kbd>K</Kbd>
</KbdGroup>`,
  menubar: `import {
  Menubar, MenubarContent, MenubarItem, MenubarMenu,
  MenubarShortcut, MenubarTrigger,
} from "@murasakijs/ui";

<Menubar>
  <MenubarMenu>
    <MenubarTrigger>File</MenubarTrigger>
    <MenubarContent>
      <MenubarItem>New window <MenubarShortcut>⌘N</MenubarShortcut></MenubarItem>
      <MenubarItem>Open… <MenubarShortcut>⌘O</MenubarShortcut></MenubarItem>
    </MenubarContent>
  </MenubarMenu>
</Menubar>`,
  "native-select": `import { Field, FieldLabel, NativeSelect } from "@murasakijs/ui";

<Field>
  <FieldLabel htmlFor="demo-language">Language</FieldLabel>
  <NativeSelect id="demo-language" defaultValue="en">
    <option value="en">English</option>
    <option value="ja">日本語</option>
  </NativeSelect>
</Field>`,
  "navigation-menu": `import {
  NavigationMenu, NavigationMenuContent, NavigationMenuItem,
  NavigationMenuLink, NavigationMenuList, NavigationMenuTrigger,
} from "@murasakijs/ui";

<NavigationMenu>
  <NavigationMenuList>
    <NavigationMenuItem>
      <NavigationMenuTrigger>Learn</NavigationMenuTrigger>
      <NavigationMenuContent>
        <NavigationMenuLink href="#">Documentation</NavigationMenuLink>
      </NavigationMenuContent>
    </NavigationMenuItem>
  </NavigationMenuList>
</NavigationMenu>`,
  pagination: `import {
  Pagination, PaginationContent, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from "@murasakijs/ui";

<Pagination>
  <PaginationContent>
    <PaginationItem><PaginationPrevious href="#" /></PaginationItem>
    <PaginationItem><PaginationLink href="#" isActive>2</PaginationLink></PaginationItem>
    <PaginationItem><PaginationNext href="#" /></PaginationItem>
  </PaginationContent>
</Pagination>`,
  "scroll-area": `import { ScrollArea } from "@murasakijs/ui";

<ScrollArea className="h-56 w-72 rounded-md border">
  <div className="space-y-3 p-4">
    {Array.from({ length: 12 }, (_, index) => (
      <p key={index}>Release note {index + 1}</p>
    ))}
  </div>
</ScrollArea>`,
  slider: `import { Slider } from "@murasakijs/ui";

<Slider
  aria-label="Volume"
  defaultValue={[40]}
  max={100}
  step={1}
  className="w-72"
/>`,
  spinner: `import { Button, Spinner } from "@murasakijs/ui";

<Button disabled>
  <Spinner aria-label="Saving" />
  Saving…
</Button>`,
  toast: `import { Button, Toaster, toast } from "@murasakijs/ui";

<>
  <Button onClick={() => toast({
    title: "Saved",
    description: "The workspace is available offline.",
  })}>
    Show toast
  </Button>
  <Toaster />
</>`,
  "toggle-group": `import { ToggleGroup, ToggleGroupItem } from "@murasakijs/ui";

<ToggleGroup type="single" defaultValue="left" aria-label="Text alignment">
  <ToggleGroupItem value="left" aria-label="Align left">Left</ToggleGroupItem>
  <ToggleGroupItem value="center" aria-label="Align center">Center</ToggleGroupItem>
  <ToggleGroupItem value="right" aria-label="Align right">Right</ToggleGroupItem>
</ToggleGroup>`,
  toggle: `import { Toggle } from "@murasakijs/ui";
import { Bold } from "lucide-react";

<Toggle aria-label="Toggle bold" variant="outline">
  <Bold className="size-4" />
</Toggle>`,
};

function ButtonGroupDemo() {
  const [alignment, setAlignment] = useState("left");

  return (
    <div className="space-y-3 text-center">
      <ButtonGroup aria-label="Text alignment">
        {[
          ["left", AlignLeft],
          ["center", AlignCenter],
          ["right", AlignRight],
        ].map(([value, Icon]) => (
          <Button
            key={value as string}
            type="button"
            variant={alignment === value ? "default" : "outline"}
            size="icon"
            aria-label={`Align ${value}`}
            onClick={() => setAlignment(value as string)}
          >
            <Icon className="size-4" />
          </Button>
        ))}
      </ButtonGroup>
      <p className="text-sm text-muted-foreground">Selected: {alignment}</p>
    </div>
  );
}

function EmptyDemo() {
  const [created, setCreated] = useState(false);

  if (created) {
    return (
      <div className="space-y-3 text-center">
        <FileText className="mx-auto size-8 text-primary" />
        <p className="font-medium">Untitled document created</p>
        <Button variant="outline" onClick={() => setCreated(false)}>
          Reset
        </Button>
      </div>
    );
  }

  return (
    <Empty className="max-w-md">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FilePlus aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>No documents yet</EmptyTitle>
        <EmptyDescription>
          Create a document or import Markdown.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={() => setCreated(true)}>Create document</Button>
      </EmptyContent>
    </Empty>
  );
}

function FieldDemo() {
  const [email, setEmail] = useState("");
  const invalid = email.length > 0 && !email.includes("@");

  return (
    <Field data-invalid={invalid} className="max-w-sm">
      <FieldLabel htmlFor="playground-email">Email</FieldLabel>
      <Input
        id="playground-email"
        value={email}
        placeholder="you@example.com"
        aria-invalid={invalid}
        aria-describedby="playground-email-help playground-email-error"
        onChange={(event) => setEmail(event.target.value)}
      />
      <FieldDescription id="playground-email-help">
        Used for account recovery.
      </FieldDescription>
      <FieldError id="playground-email-error">
        {invalid ? "Enter a valid email address." : null}
      </FieldError>
    </Field>
  );
}

function InputGroupDemo() {
  const [domain, setDomain] = useState("murasaki.ichi10.com");
  const [copied, setCopied] = useState(false);

  return (
    <div className="w-full max-w-md space-y-2">
      <InputGroup>
        <InputGroupAddon aria-hidden="true">https://</InputGroupAddon>
        <InputGroupInput
          aria-label="Domain"
          value={domain}
          onChange={(event) => {
            setDomain(event.target.value);
            setCopied(false);
          }}
        />
        <InputGroupButton type="button" onClick={() => setCopied(true)}>
          {copied ? "Copied" : "Copy"}
        </InputGroupButton>
      </InputGroup>
      <p className="text-xs text-muted-foreground">
        https://{domain || "example.com"}
      </p>
    </div>
  );
}

function ItemDemo() {
  const [opened, setOpened] = useState(false);

  return (
    <div className="w-full max-w-lg space-y-2">
      <Item variant="outline">
        <ItemMedia variant="icon">
          <FileText aria-hidden="true" />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Release notes</ItemTitle>
          <ItemDescription>Updated five minutes ago</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button variant="ghost" onClick={() => setOpened((value) => !value)}>
            {opened ? "Close" : "Open"}
          </Button>
        </ItemActions>
      </Item>
      {opened && (
        <p className="rounded-md bg-muted p-3 text-sm">
          Faster startup and improved updater reliability.
        </p>
      )}
    </div>
  );
}

function SpinnerDemo() {
  const [saving, setSaving] = useState(false);

  return (
    <Button
      disabled={saving}
      onClick={() => {
        setSaving(true);
        window.setTimeout(() => setSaving(false), 1000);
      }}
    >
      {saving && <Spinner aria-label="Saving" />}
      {saving ? "Saving…" : "Save changes"}
    </Button>
  );
}

function ToastDemo() {
  return (
    <>
      <Button
        onClick={() =>
          toast({
            title: "Saved",
            description: "The workspace is available offline.",
          })
        }
      >
        Show toast
      </Button>
      <Toaster />
    </>
  );
}

function Demo({ name }: { name: ComponentPlaygroundName }) {
  switch (name) {
    case "alert-dialog":
      return (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive">Delete project</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this project?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      );
    case "breadcrumb":
      return (
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="#playground">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Settings</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      );
    case "button-group":
      return <ButtonGroupDemo />;
    case "collapsible":
      return (
        <Collapsible className="w-full max-w-sm">
          <CollapsibleTrigger asChild>
            <Button variant="outline">Advanced settings</Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 rounded-md border p-4 text-sm">
            Settings shown on demand.
          </CollapsibleContent>
        </Collapsible>
      );
    case "command":
      return (
        <Command className="w-full max-w-md rounded-lg border">
          <CommandInput placeholder="Type a command…" />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup heading="Navigation">
              <CommandItem>
                Open settings <CommandShortcut>⌘,</CommandShortcut>
              </CommandItem>
              <CommandItem>
                New window <CommandShortcut>⌘N</CommandShortcut>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      );
    case "context-menu":
      return (
        <ContextMenu>
          <ContextMenuTrigger className="rounded-md border border-dashed p-10 text-sm">
            Right-click this area
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>
              Rename <ContextMenuShortcut>F2</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem>Delete</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      );
    case "empty":
      return <EmptyDemo />;
    case "field":
      return <FieldDemo />;
    case "hover-card":
      return (
        <HoverCard>
          <HoverCardTrigger asChild>
            <Button variant="link">Murasaki Docs</Button>
          </HoverCardTrigger>
          <HoverCardContent>
            Guides, API references, and examples.
          </HoverCardContent>
        </HoverCard>
      );
    case "input-group":
      return <InputGroupDemo />;
    case "item":
      return <ItemDemo />;
    case "kbd":
      return (
        <KbdGroup aria-label="Command K">
          <Kbd>⌘</Kbd>
          <span aria-hidden="true">+</span>
          <Kbd>K</Kbd>
        </KbdGroup>
      );
    case "menubar":
      return (
        <Menubar>
          <MenubarMenu>
            <MenubarTrigger>File</MenubarTrigger>
            <MenubarContent>
              <MenubarItem>
                New window <MenubarShortcut>⌘N</MenubarShortcut>
              </MenubarItem>
              <MenubarItem>
                Open… <MenubarShortcut>⌘O</MenubarShortcut>
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>
      );
    case "native-select":
      return (
        <Field className="max-w-xs">
          <FieldLabel htmlFor="playground-language">Language</FieldLabel>
          <NativeSelect id="playground-language" defaultValue="en">
            <option value="en">English</option>
            <option value="ja">日本語</option>
          </NativeSelect>
        </Field>
      );
    case "navigation-menu":
      return (
        <NavigationMenu>
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuTrigger>Learn</NavigationMenuTrigger>
              <NavigationMenuContent>
                <div className="w-64 p-3">
                  <NavigationMenuLink
                    href="#playground"
                    className="block rounded-md p-3 hover:bg-accent"
                  >
                    <div className="font-medium">Documentation</div>
                    <div className="text-sm text-muted-foreground">
                      Guides, APIs, and examples.
                    </div>
                  </NavigationMenuLink>
                </div>
              </NavigationMenuContent>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>
      );
    case "pagination":
      return (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious href="#playground" />
            </PaginationItem>
            <PaginationItem>
              <PaginationLink href="#playground" isActive>
                2
              </PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationNext href="#playground" />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      );
    case "scroll-area":
      return (
        <ScrollArea className="h-56 w-72 rounded-md border">
          <div className="space-y-3 p-4">
            {Array.from(
              { length: 12 },
              (_, index) => `Release note ${index + 1}`,
            ).map((note) => (
              <p key={note} className="text-sm">
                {note}
              </p>
            ))}
          </div>
        </ScrollArea>
      );
    case "slider":
      return (
        <Slider
          aria-label="Volume"
          defaultValue={[40]}
          max={100}
          step={1}
          className="w-72 max-w-full"
        />
      );
    case "spinner":
      return <SpinnerDemo />;
    case "toast":
      return <ToastDemo />;
    case "toggle-group":
      return (
        <ToggleGroup
          type="single"
          defaultValue="left"
          aria-label="Text alignment"
        >
          <ToggleGroupItem value="left" aria-label="Align left">
            <AlignLeft className="size-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="center" aria-label="Align center">
            <AlignCenter className="size-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="right" aria-label="Align right">
            <AlignRight className="size-4" />
          </ToggleGroupItem>
        </ToggleGroup>
      );
    case "toggle":
      return (
        <Toggle aria-label="Toggle bold" variant="outline">
          <Bold className="size-4" />
        </Toggle>
      );
  }
}

export function ComponentPlayground({
  name,
}: {
  name: ComponentPlaygroundName;
}) {
  return (
    <ComponentPreview code={demoCode[name]}>
      <Demo name={name} />
    </ComponentPreview>
  );
}
