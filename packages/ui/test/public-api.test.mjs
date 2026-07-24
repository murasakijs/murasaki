import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as UI from "../dist/index.js";

const publicComponents = [
  "Accordion",
  "Alert",
  "AlertDialog",
  "Avatar",
  "Badge",
  "Breadcrumb",
  "Button",
  "ButtonGroup",
  "Card",
  "Checkbox",
  "Collapsible",
  "Command",
  "ContextMenu",
  "Dialog",
  "DropdownMenu",
  "Empty",
  "Field",
  "HoverCard",
  "Input",
  "InputGroup",
  "Item",
  "Kbd",
  "Label",
  "Menubar",
  "NativeSelect",
  "NavigationMenu",
  "Pagination",
  "Popover",
  "Progress",
  "RadioGroup",
  "ScrollArea",
  "Select",
  "Separator",
  "Sheet",
  "Skeleton",
  "Slider",
  "Spinner",
  "Switch",
  "Table",
  "Tabs",
  "Textarea",
  "Toast",
  "Toaster",
  "Toggle",
  "ToggleGroup",
  "Tooltip",
];

test("the documented component families are exported from the package root", () => {
  for (const name of publicComponents) {
    assert.ok(
      typeof UI[name] === "function" || typeof UI[name] === "object",
      `${name} is missing from @murasakijs/ui`,
    );
  }
  assert.equal(typeof UI.cn, "function");
  assert.equal(typeof UI.buttonVariants, "function");
  assert.equal(typeof UI.toast, "function");
});

test("the UI package depends on React Aria rather than Radix or cmdk", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const dependencies = Object.keys(packageJson.dependencies ?? {});

  assert.ok(dependencies.includes("react-aria-components"));
  assert.equal(
    dependencies.some((name) => name.startsWith("@radix-ui/")),
    false,
  );
  assert.equal(dependencies.includes("cmdk"), false);
});

test("semantic primitives render on the server without a DOM", () => {
  const html = renderToStaticMarkup(
    h(
      UI.Card,
      { "data-testid": "card" },
      h(
        UI.CardHeader,
        null,
        h(UI.CardTitle, null, "Release status"),
        h(UI.CardDescription, null, "Ready for review"),
      ),
      h(
        UI.CardContent,
        null,
        h(UI.Label, { htmlFor: "release-name" }, "Name"),
        h(UI.Input, { id: "release-name", defaultValue: "Murasaki" }),
        h(
          UI.Alert,
          null,
          h(UI.AlertTitle, null, "Signed"),
          h(UI.AlertDescription, null, "Nested code verified"),
        ),
      ),
      h(UI.CardFooter, null, h(UI.Button, { type: "button" }, "Publish")),
    ),
  );

  assert.match(html, /data-testid="card"/);
  assert.match(html, /<label[^>]*for="release-name"/);
  assert.match(html, /<input[^>]*id="release-name"/);
  assert.match(html, /role="alert"/);
  assert.match(html, /<button[^>]*type="button"/);
});

test("navigation and tab primitives preserve baseline ARIA semantics during SSR", () => {
  const html = renderToStaticMarkup(
    h(
      "div",
      null,
      h(
        UI.Breadcrumb,
        { "aria-label": "Breadcrumb" },
        h(
          UI.BreadcrumbList,
          null,
          h(
            UI.BreadcrumbItem,
            null,
            h(UI.BreadcrumbLink, { href: "/" }, "Home"),
          ),
          h(UI.BreadcrumbSeparator, null),
          h(UI.BreadcrumbItem, null, h(UI.BreadcrumbPage, null, "Docs")),
        ),
      ),
      h(
        UI.Tabs,
        { defaultValue: "preview" },
        h(
          UI.TabsList,
          null,
          h(UI.TabsTrigger, { value: "preview" }, "Preview"),
          h(UI.TabsTrigger, { value: "code" }, "Code"),
        ),
        h(UI.TabsContent, { value: "preview" }, "Rendered"),
        h(UI.TabsContent, { value: "code" }, "Source"),
      ),
    ),
  );

  assert.match(html, /<nav[^>]*aria-label="Breadcrumb"/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /role="tab"/);
  assert.match(html, /role="tabpanel"/);
});
