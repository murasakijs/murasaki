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
      // `nav.children` is fumadocs-ui's supported "arbitrary content next to
      // the title" slot — rendered exactly ONCE, as a plain sibling inside
      // the header's <nav>, before the nav-items <ul>. This is why it's used
      // here instead of `links` (a `MainItemType` there has no className hook
      // to add the underline, and a `type: "custom"` item's `children` is
      // reused verbatim across BOTH the desktop header — a direct child of a
      // bare `<ul>`, requiring an `<li>` wrapper — and the mobile menu — a
      // child of a plain `<div>`, where that same `<li>` would be invalid
      // outside any list container. `nav.children` has no such list-context
      // duality, so a plain <Link> here is valid HTML everywhere it renders.
      children: (
        <Link
          href={`/${lang}/docs`}
          className="ml-4 text-sm font-medium underline underline-offset-4"
        >
          Docs
        </Link>
      ),
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
