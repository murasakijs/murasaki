import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { ButterflyMark } from "@/components/home/butterfly-mark";
import { localizeDocsHref } from "@/lib/localize-href";
import { localizedHomePath } from "@/lib/seo";
import { GitHubStarBadge } from "./github-star-badge";

interface FooterColumn {
  heading: string;
  links: { label: string; href: string }[];
}

interface SiteFooterProps {
  lang: string;
  columns: FooterColumn[];
  community: FooterColumn;
  license: string;
}

/**
 * The rich, columned footer replacing the (never-rendered) thin footer
 * fields stage 1 left unused. Docs/Guides/Building links are authored as
 * bare `/docs/...` paths in lib/home-content.ts and localized here via the
 * same `localizeDocsHref` helper the docs content itself uses; Community
 * links are already-absolute external URLs.
 */
export function SiteFooter({
  lang,
  columns,
  community,
  license,
}: SiteFooterProps) {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4">
          {columns.map((column) => (
            <div key={column.heading}>
              <h3 className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
                {column.heading}
              </h3>
              <ul className="mt-4 space-y-3">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={localizeDocsHref(link.href, lang) ?? link.href}
                      className="text-sm text-foreground/80 transition-colors hover:text-purple-600 dark:hover:text-purple-400"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <h3 className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
              {community.heading}
            </h3>
            <ul className="mt-4 space-y-3">
              {community.links.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-foreground/80 transition-colors hover:text-purple-600 dark:hover:text-purple-400"
                  >
                    {link.label}
                    <ExternalLink aria-hidden="true" className="size-3" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-16 flex flex-col items-center justify-between gap-6 border-t border-border pt-8 lg:flex-row">
          <Link
            href={localizedHomePath(lang)}
            className="flex items-center gap-2"
            aria-label="Murasaki home"
          >
            <ButterflyMark className="h-auto w-6" />
            <span className="font-display text-lg font-bold tracking-tight">
              Murasaki
            </span>
          </Link>
          <GitHubStarBadge lang={lang} />
          <p className="text-xs text-muted-foreground">{license}</p>
        </div>
      </div>
    </footer>
  );
}
