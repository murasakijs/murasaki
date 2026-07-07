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
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
