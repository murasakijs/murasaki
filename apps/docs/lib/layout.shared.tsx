import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { ButterflyMark } from "@/components/home/butterfly-mark";
import {
  localizedChangelogPath,
  localizedDocsPath,
  localizedHomePath,
} from "./seo";
import { appName, gitConfig } from "./shared";

export function baseOptions(
  lang: string,
  // The docs pages already sit under /docs with the full sidebar, so the
  // header "Docs" link is redundant there — it's only useful from the
  // landing page. Callers on the docs side pass `docsLink: false`.
  { docsLink = true }: { docsLink?: boolean } = {},
): BaseLayoutProps {
  return {
    nav: {
      // JSX supported — pixel-butterfly mark + wordmark
      title: (
        <span className="inline-flex items-center gap-2 font-semibold">
          <ButterflyMark className="h-5 w-auto" />
          {appName}
        </span>
      ),
      url: localizedHomePath(lang),
    },
    // A `type: "button"` link renders as a real fumadocs secondary button in a
    // valid <li>, and `secondary: true` places it in the header's right-hand
    // cluster alongside search / theme / language (rather than out by the
    // logo). Only shown on the landing page — the docs pages pass
    // docsLink: false since they already have the sidebar.
    links: docsLink
      ? [
          {
            type: "button",
            secondary: true,
            text: "Docs",
            url: localizedDocsPath(lang),
          },
          {
            type: "button",
            secondary: true,
            text: "Changelog",
            url: localizedChangelogPath(lang),
          },
        ]
      : undefined,
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
