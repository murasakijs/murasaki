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
    links: [
      {
        type: "custom",
        children: (
          <Link
            href={`/${lang}/docs`}
            className="text-sm font-medium underline underline-offset-4"
          >
            Docs
          </Link>
        ),
      },
    ],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
