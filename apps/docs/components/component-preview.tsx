import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import type { ReactNode } from "react";

/**
 * shadcn-style live component preview for MDX docs pages: a "Preview" tab
 * renders the real `@murasakijs/ui` component (children), a "Code" tab shows
 * its syntax-highlighted source (the `code` string passed in by the page).
 * Registered globally in components/mdx.tsx so MDX pages can use
 * `<ComponentPreview>` without a per-file import.
 */
export function ComponentPreview({
  code,
  children,
  lang = "tsx",
}: {
  code: string;
  children: ReactNode;
  lang?: string;
}) {
  return (
    <Tabs items={["Preview", "Code"]} className="not-prose">
      <Tab value="Preview">
        <div className="flex min-h-[340px] w-full items-center justify-center rounded-lg border bg-background p-10">
          {children}
        </div>
      </Tab>
      <Tab value="Code">
        <DynamicCodeBlock lang={lang} code={code} />
      </Tab>
    </Tabs>
  );
}
