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
    // Primary links sit directly beside the wordmark. Their text stays visibly
    // underlined so they read as navigation rather than secondary buttons;
    // search, theme, language, and GitHub remain in the utility cluster on the
    // right. Only shown on the landing page — the docs pages pass docsLink:
    // false since they already have the sidebar.
    links: docsLink
      ? [
          {
            type: "main",
            text: (
              <span className="underline decoration-current underline-offset-4 transition-colors hover:decoration-fd-primary">
                Docs
              </span>
            ),
            url: localizedDocsPath(lang),
          },
          {
            type: "main",
            text: (
              <span className="underline decoration-current underline-offset-4 transition-colors hover:decoration-fd-primary">
                Changelog
              </span>
            ),
            url: localizedChangelogPath(lang),
          },
        ]
      : undefined,
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
