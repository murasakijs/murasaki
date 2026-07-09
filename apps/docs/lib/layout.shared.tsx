import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import Link from "next/link";
import { ButterflyMark } from "@/components/home/butterfly-mark";
import { appName, gitConfig } from "./shared";

export function baseOptions(lang: string): BaseLayoutProps {
  return {
    nav: {
      // JSX supported — pixel-butterfly mark + wordmark
      title: (
        <span className="inline-flex items-center gap-2 font-semibold">
          <ButterflyMark className="h-5 w-auto" />
          {appName}
        </span>
      ),
      url: `/${lang}`,
    },
    // Rendered in the navbar next to (left of) the search box — the way from
    // the landing into the documentation. `type: "custom"` (rather than a
    // plain MainItemType) because that type has no `className`/style hook —
    // rendering our own <Link> is the only way to add the underline.
    //
    // The desktop navbar (fumadocs-ui's Header) maps nav items as direct
    // children of a bare `<ul>`; every other item type resolves to Radix's
    // `NavigationMenuItem` (a real `<li>`), but a "custom" item's `children`
    // is returned as-is with no wrapper — so `children` itself MUST be an
    // `<li>`, or the desktop nav renders an invalid `<ul><a>…` (no `<li>`).
    // The mobile menu wraps "custom" children in a `<div>` instead, where a
    // stray `<li>` is harmless (browsers still let it participate in flex
    // layout as a block-level element).
    links: [
      {
        type: "custom",
        children: (
          <li>
            <Link
              href={`/${lang}/docs`}
              className="text-sm font-medium underline underline-offset-4"
            >
              Docs
            </Link>
          </li>
        ),
      },
    ],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
