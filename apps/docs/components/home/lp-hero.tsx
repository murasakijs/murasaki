"use client";

import { ArrowRight } from "lucide-react";
import { m, useReducedMotion, useScroll, useTransform } from "motion/react";
import Link from "next/link";
import { useRef } from "react";
import { CopyCommand } from "@/components/copy-command";
import { LpMesh } from "./lp-backdrop";
import { EASE } from "./lp-motion";

interface LpHeroProps {
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

// Per-character mask reveal for the giant wordmark.
const charContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05, delayChildren: 0.2 } },
};
const char = {
  hidden: { y: "112%" },
  visible: { y: "0%", transition: { duration: 0.9, ease: EASE } },
};

/**
 * Type IS the hero: a viewport-scaled "Murasaki" (Bricolage Grotesque,
 * revealed character by character, then breathing its variable weight)
 * overlapped by a ghost 「紫」 (Zen Old Mincho) parallaxing behind it, over a
 * drifting mesh-gradient field. The whole block scale/fade-scrubs as you
 * scroll away — the "settle" moment before the marquee band.
 */
export function LpHero({
  eyebrow,
  headline,
  getStartedLabel,
  getStartedHref,
  githubLabel,
  githubHref,
  installCommand,
  tategaki,
  scrollCue,
}: LpHeroProps) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const scale = useTransform(scrollYProgress, [0, 1], [1, 0.94]);
  const opacity = useTransform(scrollYProgress, [0, 0.85], [1, 0.15]);
  const kanjiY = useTransform(scrollYProgress, [0, 1], ["0%", "22%"]);

  return (
    <section
      ref={ref}
      className="relative flex min-h-[94svh] items-center overflow-hidden bg-[#0b0a12] text-purple-50"
    >
      <LpMesh variant="hero" />

      {/* Ghost 紫 — the kanji as a landscape, not a label. */}
      <m.span
        aria-hidden="true"
        style={reduce ? undefined : { y: kanjiY }}
        className="lp-kanji pointer-events-none absolute -right-[4vw] -top-[2vh] select-none text-[58vw] font-bold leading-none text-purple-500/[0.13] sm:text-[44vw] lg:-top-[8vh] lg:text-[36vw]"
      >
        紫
      </m.span>

      {/* Tategaki rail — vertical Japanese colophon on the right edge. */}
      <span
        aria-hidden="true"
        className="lp-kanji lp-tategaki absolute right-5 top-24 hidden text-[13px] text-purple-200/50 lg:block"
      >
        {tategaki}
      </span>

      <m.div
        style={reduce ? undefined : { scale, opacity }}
        className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-24 pt-28"
      >
        <m.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
          className="motion-reveal lp-mono mb-6 flex items-center gap-3 text-[11px] uppercase tracking-[0.3em] text-purple-300/80"
        >
          <span aria-hidden="true" className="h-px w-10 bg-purple-400/60" />
          {eyebrow}
        </m.p>

        <h1 className="lp-display font-extrabold">
          <span className="sr-only">{BRAND}</span>
          <m.span
            aria-hidden="true"
            variants={charContainer}
            initial="hidden"
            animate="visible"
            className="motion-reveal block text-[clamp(4rem,16.5vw,15rem)] leading-[0.85] tracking-[-0.04em] text-purple-50"
          >
            {/* Variable-weight "breathe" on the settled wordmark. */}
            <m.span
              className="block"
              animate={
                reduce
                  ? undefined
                  : {
                      fontVariationSettings: [
                        '"opsz" 96, "wght" 800',
                        '"opsz" 96, "wght" 560',
                        '"opsz" 96, "wght" 800',
                      ],
                    }
              }
              transition={{
                duration: 7,
                repeat: Number.POSITIVE_INFINITY,
                ease: "easeInOut",
                delay: 1.6,
              }}
            >
              {BRAND.split("").map((c, i) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: static string, order never changes.
                  key={i}
                  className="inline-block overflow-hidden align-bottom"
                >
                  <m.span variants={char} className="inline-block will-change-transform">
                    {c}
                  </m.span>
                </span>
              ))}
            </m.span>
          </m.span>
        </h1>

        <div className="mt-8 overflow-hidden">
          <m.p
            initial={{ y: "110%" }}
            animate={{ y: "0%" }}
            transition={{ duration: 0.8, ease: EASE, delay: 0.7 }}
            className="motion-reveal lp-display max-w-3xl text-[clamp(1.35rem,3.2vw,2.3rem)] font-semibold leading-tight text-purple-100/90"
          >
            {/* Explicit joiner: `prefix` doesn't carry its own trailing
                space (ja has an empty prefix and needs none). */}
            {headline.prefix && `${headline.prefix} `}
            <span className="text-purple-400">{headline.highlight}</span>
            {headline.suffix}
          </m.p>
        </div>

        <m.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE, delay: 1.0 }}
          className="motion-reveal mt-10 flex flex-col items-start gap-5 sm:flex-row sm:items-center"
        >
          <CopyCommand command={installCommand} />
          <div className="flex items-center gap-3">
            <Link
              href={getStartedHref}
              className="lp-sans group inline-flex h-12 items-center gap-2 rounded-full bg-purple-600 px-7 font-semibold text-white shadow-[0_0_32px_-6px_rgba(168,85,247,0.7)] transition-colors hover:bg-purple-500"
            >
              {getStartedLabel}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a
              href={githubHref}
              target="_blank"
              rel="noopener noreferrer"
              className="lp-sans inline-flex h-12 items-center rounded-full border border-purple-300/30 px-7 font-semibold text-purple-100 transition-colors hover:border-purple-300/60 hover:bg-purple-400/10"
            >
              {githubLabel}
            </a>
          </div>
        </m.div>
      </m.div>

      {/* Scroll cue. */}
      <div
        aria-hidden="true"
        className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2"
      >
        <span className="lp-mono text-[10px] uppercase tracking-[0.4em] text-purple-300/60">
          {scrollCue}
        </span>
        <m.span
          className="block h-10 w-px origin-top bg-gradient-to-b from-purple-400/80 to-transparent"
          animate={reduce ? undefined : { scaleY: [0, 1, 0] }}
          transition={{
            duration: 2,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
          }}
        />
      </div>
    </section>
  );
}
