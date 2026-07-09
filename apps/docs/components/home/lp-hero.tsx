"use client";

import { ArrowRight } from "lucide-react";
import { m, useReducedMotion, useScroll, useTransform } from "motion/react";
import Link from "next/link";
import { useRef } from "react";
import { CopyCommand } from "@/components/copy-command";
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
  visible: { transition: { staggerChildren: 0.045, delayChildren: 0.15 } },
};
const char = {
  hidden: { y: "112%" },
  visible: { y: "0%", transition: { duration: 0.9, ease: EASE } },
};

/**
 * Editorial hero on a paper field: near-black display type is the entire
 * visual, 「紫」 sits behind it as a barely-there ghost, and purple appears
 * exactly once — on the primary button. No gradients, no glows, no cards.
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
  const kanjiY = useTransform(scrollYProgress, [0, 1], ["0%", "14%"]);

  return (
    <section
      ref={ref}
      className="relative flex min-h-[92svh] items-center overflow-hidden bg-[#f4f2ed] text-[#111014]"
    >
      {/* Ghost 紫 — a watermark in the paper, not a light show. */}
      <m.span
        aria-hidden="true"
        style={reduce ? undefined : { y: kanjiY }}
        className="lp-kanji pointer-events-none absolute -right-[6vw] top-[1vh] select-none text-[56vw] font-bold leading-none text-[#111014]/[0.045] sm:text-[42vw] lg:-top-[6vh] lg:text-[34vw]"
      >
        紫
      </m.span>

      {/* Tategaki rail — the one Japanese grace note. */}
      <span
        aria-hidden="true"
        className="lp-kanji lp-tategaki absolute right-6 top-24 hidden text-[12px] text-[#111014]/35 lg:block"
      >
        {tategaki}
      </span>

      <div className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-24 pt-28">
        <m.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
          className="motion-reveal lp-mono mb-8 text-[11px] uppercase tracking-[0.3em] text-[#111014]/50"
        >
          {eyebrow}
        </m.p>

        <h1 className="lp-display font-extrabold">
          <span className="sr-only">{BRAND}</span>
          <m.span
            aria-hidden="true"
            variants={charContainer}
            initial="hidden"
            animate="visible"
            className="motion-reveal block text-[clamp(4rem,16.5vw,15rem)] leading-[0.85] tracking-[-0.04em]"
          >
            {BRAND.split("").map((c, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: static string, order never changes.
                key={i}
                className="inline-block overflow-hidden align-bottom"
              >
                <m.span
                  variants={char}
                  className="inline-block will-change-transform"
                >
                  {c}
                </m.span>
              </span>
            ))}
          </m.span>
        </h1>

        <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="overflow-hidden">
              <m.p
                initial={{ y: "110%" }}
                animate={{ y: "0%" }}
                transition={{ duration: 0.8, ease: EASE, delay: 0.6 }}
                className="motion-reveal lp-display max-w-2xl text-[clamp(1.3rem,2.8vw,2rem)] font-semibold leading-tight"
              >
                {/* Explicit joiner: `prefix` doesn't carry its own trailing
                    space (ja has an empty prefix and needs none). */}
                {headline.prefix && `${headline.prefix} `}
                {headline.highlight}
                {headline.suffix}
              </m.p>
            </div>

            <m.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: EASE, delay: 0.85 }}
              className="motion-reveal mt-9 flex flex-col items-start gap-5 sm:flex-row sm:items-center"
            >
              <CopyCommand command={installCommand} />
              <div className="flex items-center gap-3">
                <Link
                  href={getStartedHref}
                  className="lp-sans group inline-flex h-12 items-center gap-2 rounded-full bg-[#7c3aed] px-7 font-semibold text-white transition-colors hover:bg-[#6d28d9]"
                >
                  {getStartedLabel}
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
                <a
                  href={githubHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lp-sans inline-flex h-12 items-center rounded-full border border-[#111014]/20 px-7 font-semibold text-[#111014] transition-colors hover:border-[#111014]/50"
                >
                  {githubLabel}
                </a>
              </div>
            </m.div>
          </div>
        </div>
      </div>

      {/* Scroll cue. */}
      <div
        aria-hidden="true"
        className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2"
      >
        <span className="lp-mono text-[10px] uppercase tracking-[0.4em] text-[#111014]/40">
          {scrollCue}
        </span>
        <m.span
          className="block h-10 w-px origin-top bg-[#111014]/30"
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
