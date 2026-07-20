"use client";

import { gsap } from "gsap";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useLayoutEffect, useRef } from "react";
import type { ChangelogEntry } from "@/lib/changelog";

/**
 * Changelog surfaces on the marketing site: a compact latest-3 timeline on
 * the landing page (`PxChangelogSection`) and the full-history renderer used
 * by `/changelog` (`ChangelogTimeline`). Both share the paper/ink system —
 * hairline rules, no cards/shadows — and `InlineMarkdown`, a tiny renderer
 * for the inline code, bold, and link subset the changelog's own prose
 * uses (no external Markdown dependency).
 */

const INLINE_RE = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;

/** Renders literal text plus exactly `code`, **bold**, and [text](url) —
 * everything else stays plain text (React escapes it for free). */
export function InlineMarkdown({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of text.matchAll(INLINE_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push(text.slice(lastIndex, index));

    const [full, code, bold, linkText, href] = match;
    if (code !== undefined) {
      nodes.push(
        <code
          key={key++}
          className="lp-mono bg-[#111014]/[0.06] px-1 py-0.5 text-[0.9em]"
        >
          {code}
        </code>,
      );
    } else if (bold !== undefined) {
      nodes.push(
        <strong key={key++} className="font-bold">
          {bold}
        </strong>,
      );
    } else if (linkText !== undefined && href !== undefined) {
      const external = /^https?:\/\//.test(href);
      nodes.push(
        <a
          key={key++}
          href={href}
          className="underline decoration-[#111014]/30 underline-offset-2 hover:decoration-current"
          {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
        >
          {linkText}
        </a>,
      );
    }
    lastIndex = index + full.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));

  return <>{nodes}</>;
}

/** The compact excerpt shown per entry on the landing page: the first intro
 * paragraph, or — for patch entries with no intro (e.g. 0.55.4) — the first
 * bullet of the first section. */
function excerptFor(entry: ChangelogEntry): string {
  return entry.intro[0] ?? entry.sections[0]?.items[0] ?? "";
}

export function PxChangelogSection({
  eyebrow,
  heading,
  viewAllLabel,
  viewAllHref,
  entries,
}: {
  eyebrow: string;
  heading: string;
  viewAllLabel: string;
  viewAllHref: string;
  entries: ChangelogEntry[];
}) {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const ctx = gsap.context(() => {
        gsap.from("[data-cl-heading]", {
          yPercent: 110,
          duration: 0.8,
          ease: "expo.out",
          scrollTrigger: { trigger: root, start: "top 75%" },
        });
        for (const row of gsap.utils.toArray<HTMLElement>("[data-cl-row]")) {
          gsap.from(row, {
            opacity: 0,
            y: 24,
            duration: 0.6,
            ease: "power2.out",
            scrollTrigger: { trigger: row, start: "top 90%" },
          });
        }
      }, root);
      return () => ctx.revert();
    });
    return () => mm.revert();
  }, []);

  return (
    <section
      ref={ref}
      className="relative bg-[#f4f2ed] py-24 text-[#111014] sm:py-32"
    >
      <div className="mx-auto w-full max-w-6xl px-6">
        <p className="lp-pixel text-[11px] uppercase tracking-[0.25em] text-[#111014]/50">
          <span className="text-[#7c3aed]">09</span> · {eyebrow}
        </p>

        <div className="mt-6 overflow-hidden">
          <h2
            data-cl-heading
            className="lp-display max-w-4xl text-[clamp(2.2rem,6vw,4.5rem)] font-extrabold leading-[0.95] tracking-tight"
          >
            {heading}
          </h2>
        </div>

        <ol className="mt-16 border-l border-[#111014]/15">
          {entries.map((entry) => (
            <li
              key={entry.version}
              data-cl-row
              className="relative py-8 pl-8 first:pt-0"
            >
              <span
                aria-hidden="true"
                className="absolute top-2 left-0 size-2 -translate-x-1/2 bg-[#7c3aed]"
              />
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="lp-display text-2xl font-extrabold tracking-tight sm:text-3xl">
                  v{entry.version}
                </span>
                <span className="lp-mono text-xs tracking-[0.2em] text-[#111014]/45 uppercase">
                  {entry.date}
                </span>
              </div>
              <p className="lp-sans mt-2 text-base font-bold sm:text-lg">
                {entry.title}
              </p>
              <p className="lp-sans mt-2 max-w-2xl text-sm leading-relaxed text-[#111014]/60 sm:text-base">
                <InlineMarkdown text={excerptFor(entry)} />
              </p>
            </li>
          ))}
        </ol>

        <Link
          href={viewAllHref}
          className="lp-sans group mt-14 inline-flex items-center gap-2 text-sm font-semibold text-[#7c3aed] transition-colors hover:text-[#5b21b6] sm:text-base"
        >
          {viewAllLabel}
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </section>
  );
}

/** Category label color: restrained ink for most kinds, the site's one
 * purple accent for `breaking` — no new color introduced. */
function categoryLabelClassName(
  kind: ChangelogEntry["sections"][number]["kind"],
) {
  return kind === "breaking" ? "text-[#7c3aed]" : "text-[#111014]/45";
}

export function ChangelogTimeline({ entries }: { entries: ChangelogEntry[] }) {
  return (
    <section className="bg-[#f4f2ed] pb-24 text-[#111014] sm:pb-32">
      <div className="mx-auto w-full max-w-3xl px-6">
        <div className="border-t border-[#111014]/15">
          {entries.map((entry) => {
            const anchor = `v${entry.version.replaceAll(".", "-")}`;
            return (
              <article
                key={entry.version}
                id={anchor}
                className="scroll-mt-20 border-b border-[#111014]/15 py-14 first:pt-10"
              >
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <h2 className="lp-display text-3xl font-extrabold tracking-tight sm:text-4xl">
                    <a href={`#${anchor}`} className="hover:text-[#7c3aed]">
                      v{entry.version}
                    </a>
                  </h2>
                  <span className="lp-mono text-xs tracking-[0.2em] text-[#111014]/45 uppercase">
                    {entry.date}
                  </span>
                </div>
                <p className="lp-sans mt-2 text-lg font-bold sm:text-xl">
                  {entry.title}
                </p>

                {entry.intro.map((paragraph, i) => (
                  <p
                    // biome-ignore lint/suspicious/noArrayIndexKey: static content parsed from the changelog file.
                    key={i}
                    className="lp-sans mt-5 max-w-2xl text-sm leading-relaxed text-[#111014]/65 sm:text-base"
                  >
                    <InlineMarkdown text={paragraph} />
                  </p>
                ))}

                {entry.sections.map((section, i) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: static content parsed from the changelog file.
                    key={i}
                    className="mt-8"
                  >
                    {section.label && (
                      <p
                        className={`lp-pixel text-[11px] tracking-[0.25em] uppercase ${categoryLabelClassName(section.kind)}`}
                      >
                        {section.label}
                      </p>
                    )}
                    <ul
                      className={section.label ? "mt-3 space-y-2" : "space-y-2"}
                    >
                      {section.items.map((item, j) => (
                        <li
                          // biome-ignore lint/suspicious/noArrayIndexKey: static content parsed from the changelog file.
                          key={j}
                          className="lp-sans flex gap-2.5 text-sm leading-relaxed text-[#111014]/75 sm:text-base"
                        >
                          <span
                            aria-hidden="true"
                            className="mt-[0.6em] size-1 shrink-0 bg-[#111014]/30"
                          />
                          <span>
                            <InlineMarkdown text={item} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}

                {entry.outro.map((paragraph, i) => (
                  <p
                    // biome-ignore lint/suspicious/noArrayIndexKey: static content parsed from the changelog file.
                    key={i}
                    className="lp-sans mt-6 max-w-2xl text-sm leading-relaxed text-[#111014]/60 sm:text-base"
                  >
                    <InlineMarkdown text={paragraph} />
                  </p>
                ))}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
