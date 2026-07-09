import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
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
    // the landing into the documentation.
    links: [
      {
        text: "Docs",
        url: `/${lang}/docs`,
        active: "nested-url",
      },
    ],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
