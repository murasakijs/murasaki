import { GitPullRequestArrow } from "lucide-react";

// The open-source colophon under each doc page — sits above fumadocs'
// auto-generated prev/next pagination. A "contribute on GitHub" link (edit
// the very file you're reading) plus, when known, the file's last commit
// date. Server component: pure presentational, copy localized inline for the
// two locales rather than through fumadocs' i18n text table so the wording
// ("Improve this page") and the date format are fully controlled here.

const COPY = {
  en: {
    contribute: "Improve this page on GitHub",
    updated: (date: string) => `Last updated on ${date}`,
  },
  ja: {
    contribute: "GitHub でこのページを改善",
    updated: (date: string) => `最終更新: ${date}`,
  },
} as const;

export function DocPageFooter({
  lang,
  editUrl,
  isoDate,
}: {
  lang: string;
  editUrl: string;
  /** ISO commit date for this file, or undefined when git history is absent. */
  isoDate?: string;
}) {
  const t = COPY[lang as keyof typeof COPY] ?? COPY.en;
  const formatted = isoDate
    ? new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(new Date(isoDate))
    : null;

  return (
    <div className="mt-10 flex flex-col gap-3 border-t pt-6 text-sm sm:flex-row sm:items-center sm:justify-between">
      <a
        href={editUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex w-fit items-center gap-2 font-medium text-fd-muted-foreground transition-colors hover:text-fd-foreground"
      >
        <GitPullRequestArrow className="size-4" />
        {t.contribute}
      </a>
      {formatted && (
        <time
          dateTime={isoDate}
          className="text-fd-muted-foreground tabular-nums"
        >
          {t.updated(formatted)}
        </time>
      )}
    </div>
  );
}
