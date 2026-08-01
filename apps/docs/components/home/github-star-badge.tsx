import { Star } from "lucide-react";

interface GitHubStarBadgeProps {
  lang: string;
  accent?: boolean;
  className?: string;
}

const GITHUB_REPOSITORY = "https://github.com/murasakijs/murasaki";

/** GitHub star CTA shared by the landing-page hero and footer. */
export function GitHubStarBadge({
  lang,
  accent = false,
  className,
}: GitHubStarBadgeProps) {
  const label =
    lang === "ja" ? "GitHubでMurasakiにスター" : "Star Murasaki on GitHub";

  return (
    <span
      className={`inline-flex max-w-full items-center gap-3 ${className ?? ""}`}
    >
      {accent ? (
        <span
          aria-hidden="true"
          className="hidden h-[54px] w-1 shrink-0 bg-[#7c3aed] md:block"
        />
      ) : null}

      <a
        href={GITHUB_REPOSITORY}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
        className="group inline-flex h-[54px] w-[250px] max-w-full items-stretch overflow-hidden rounded-xl border border-[#d0d7de] bg-white text-[#111014] shadow-sm transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-[#7c3aed] hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#7c3aed]"
      >
        <span className="flex min-w-0 flex-1 items-center gap-3 px-4">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-7 shrink-0 fill-current"
          >
            <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.28-5.27-5.69 0-1.26.45-2.29 1.18-3.09-.12-.29-.51-1.47.11-3.05 0 0 .96-.31 3.16 1.18A10.93 10.93 0 0 1 12 6.12c.98 0 1.95.13 2.87.39 2.19-1.49 3.15-1.18 3.15-1.18.63 1.58.23 2.76.12 3.05.73.8 1.17 1.83 1.17 3.09 0 4.42-2.71 5.39-5.29 5.68.42.36.79 1.07.79 2.16v3.24c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
          </svg>
          <span className="min-w-0 text-left leading-none">
            <span className="lp-pixel block truncate text-[8px] tracking-[0.16em] text-[#57606a] uppercase">
              Star Murasaki
            </span>
            <span className="lp-sans mt-1 block truncate text-[17px] font-bold tracking-tight">
              on GitHub
            </span>
          </span>
        </span>

        <span className="flex w-[52px] shrink-0 items-center justify-center border-l border-[#d0d7de] bg-[#f6f8fa] transition-colors group-hover:bg-[#f3e8ff]">
          <Star
            aria-hidden="true"
            className="size-5 fill-[#7c3aed] text-[#7c3aed] transition-transform group-hover:scale-110"
          />
        </span>
      </a>
    </span>
  );
}
