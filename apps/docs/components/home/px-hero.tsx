"use client";

import { gsap } from "gsap";
import { ArrowRight, Star } from "lucide-react";
import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import { CopyCommand } from "@/components/copy-command";
import { ProductHuntBadge } from "./product-hunt-badge";
import { PixelButterfly } from "./px-pixel";

interface PxHeroProps {
  lang: string;
  eyebrow: string;
  headline: { prefix: string; highlight: string; suffix: string };
  getStartedLabel: string;
  getStartedHref: string;
  githubLabel: string;
  githubHref: string;
  installCommand: string;
  tategaki: string;
  scrollCue: string;
}

const BRAND = "Murasaki";

/**
 * Paper hero on a faint 16px pixel graph: the pixel butterfly assembles
 * itself cell by cell (GSAP, from scatter), the ink wordmark climbs out of
 * per-character masks, and 「紫」 sits as a watermark in the paper. Purple
 * appears exactly once — the primary button. All entrance animation is
 * `gsap.from`, so no-JS / reduced-motion render the finished layout.
 */
export function PxHero({
  lang,
  eyebrow,
  headline,
  getStartedLabel,
  getStartedHref,
  githubLabel,
  githubHref,
  installCommand,
  tategaki,
  scrollCue,
}: PxHeroProps) {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const ctx = gsap.context(() => {
        gsap.from("[data-hero-char]", {
          yPercent: 115,
          duration: 0.9,
          ease: "expo.out",
          stagger: 0.045,
          delay: 0.1,
        });
        gsap.from("[data-hero-eyebrow]", {
          opacity: 0,
          y: 12,
          duration: 0.6,
          ease: "power2.out",
        });
        gsap.from("[data-hero-tagline]", {
          yPercent: 110,
          duration: 0.8,
          ease: "expo.out",
          delay: 0.55,
        });
        gsap.from("[data-hero-actions]", {
          opacity: 0,
          y: 18,
          duration: 0.7,
          ease: "power2.out",
          delay: 0.8,
        });
        // The wordmark drifts up slightly as the hero scrolls away.
        gsap.to("[data-hero-title]", {
          yPercent: -14,
          ease: "none",
          scrollTrigger: {
            trigger: root,
            start: "top top",
            end: "bottom top",
            scrub: 0.5,
          },
        });
        // Scroll cue pulse.
        gsap.to("[data-hero-cue]", {
          scaleY: 0,
          transformOrigin: "top",
          duration: 1,
          ease: "steps(6)",
          repeat: -1,
          yoyo: true,
        });
      }, root);
      return () => ctx.revert();
    });
    return () => mm.revert();
  }, []);

  return (
    <section
      ref={ref}
      className="relative flex min-h-[92svh] items-center overflow-hidden bg-[#f4f2ed] text-[#111014]"
    >
      {/* Faint pixel graph paper. */}
      <div
        aria-hidden="true"
        className="px-grid pointer-events-none absolute inset-0 text-[#111014]/[0.05]"
      />

      {/* Ghost 紫 — a watermark in the paper. */}
      <span
        aria-hidden="true"
        className="lp-kanji pointer-events-none absolute -right-[6vw] top-[2vh] select-none text-[54vw] font-bold leading-none text-[#111014]/[0.045] sm:text-[40vw] lg:-top-[4vh] lg:text-[32vw]"
      >
        紫
      </span>

      {/* Tategaki rail. */}
      <span
        aria-hidden="true"
        className="lp-kanji lp-tategaki absolute right-6 top-24 hidden text-[12px] text-[#111014]/35 lg:block"
      >
        {tategaki}
      </span>

      {/* The pixel butterfly, assembling. */}
      <div className="pointer-events-none absolute right-[8vw] top-[14vh] w-40 sm:w-56 lg:right-[7vw] lg:top-[13vh] lg:w-72">
        <PixelButterfly className="h-auto w-full" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-24 pt-28">
        <p
          data-hero-eyebrow
          className="lp-pixel mb-8 text-[11px] uppercase tracking-[0.25em] text-[#111014]/55"
        >
          {eyebrow}
        </p>

        <h1 className="lp-display font-extrabold">
          <span
            data-hero-title
            className="block text-[clamp(4rem,16.5vw,15rem)] leading-[0.85] tracking-[-0.04em]"
          >
            {BRAND.split("").map((c, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: static string, order never changes.
                key={i}
                className="inline-block overflow-hidden align-bottom"
              >
                <span
                  data-hero-char
                  className="inline-block will-change-transform"
                >
                  {c}
                </span>
              </span>
            ))}
          </span>
          <span className="mt-10 block overflow-hidden">
            <span
              data-hero-tagline
              className="lp-display block max-w-2xl text-[clamp(1.3rem,2.8vw,2rem)] font-semibold leading-tight"
            >
              {/* Explicit joiner: `prefix` doesn't carry its own trailing
                  space (ja has an empty prefix and needs none). */}
              {headline.prefix && `${headline.prefix} `}
              {headline.highlight}
              {headline.suffix}
            </span>
          </span>
        </h1>

        <div
          data-hero-actions
          className="mt-9 flex flex-col items-center md:items-start"
        >
          <div className="flex flex-col items-center gap-5 md:flex-row">
            <CopyCommand command={installCommand} />
            <div className="flex items-center justify-center gap-3">
              <Link
                href={getStartedHref}
                className="lp-sans group inline-flex h-12 shrink-0 items-center gap-2 bg-[#7c3aed] px-5 font-semibold whitespace-nowrap text-white transition-colors hover:bg-[#6d28d9] sm:px-7"
              >
                {getStartedLabel}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <a
                href={githubHref}
                target="_blank"
                rel="noopener noreferrer"
                className="lp-sans group inline-flex h-12 shrink-0 items-center gap-2 border border-[#111014]/25 px-5 font-semibold whitespace-nowrap text-[#111014] transition-colors hover:border-[#111014]/60 sm:px-7"
              >
                <Star className="size-4 transition-colors group-hover:fill-current" />
                {githubLabel}
              </a>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-center gap-3 md:justify-start">
            <ProductHuntBadge
              lang={lang}
              variant="follow"
              showLaunchTimer
              accent
            />
          </div>
        </div>
      </div>

      {/* Scroll cue — pixel type, stepped pulse. */}
      <div
        aria-hidden="true"
        className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2"
      >
        <span className="lp-pixel text-[10px] uppercase tracking-[0.3em] text-[#111014]/45">
          {scrollCue}
        </span>
        <span data-hero-cue className="block h-8 w-[3px] bg-[#7c3aed]" />
      </div>
    </section>
  );
}
