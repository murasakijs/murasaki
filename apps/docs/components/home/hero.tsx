"use client";

import { ArrowRight } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { CopyCommand } from "@/components/copy-command";
import { ButterflyMark } from "@/components/home/butterfly-mark";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface HeroProps {
  lang: string;
  eyebrow: string;
  headline: { prefix: string; highlight: string; suffix: string };
  subhead: string;
  getStartedLabel: string;
  getStartedHref: string;
  githubLabel: string;
  githubHref: string;
  installCommand: string;
}

export function Hero({
  lang,
  eyebrow,
  headline,
  subhead,
  getStartedLabel,
  getStartedHref,
  githubLabel,
  githubHref,
  installCommand,
}: HeroProps) {
  const prefersReducedMotion = useReducedMotion();

  const container = {
    hidden: { opacity: prefersReducedMotion ? 1 : 0 },
    show: {
      opacity: 1,
      transition: prefersReducedMotion
        ? { duration: 0 }
        : { staggerChildren: 0.12, delayChildren: 0.1 },
    },
  };

  const item = prefersReducedMotion
    ? { hidden: { opacity: 1 }, show: { opacity: 1 } }
    : {
        hidden: { opacity: 0, y: 16 },
        show: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] as const },
        },
      };

  return (
    <section className="relative overflow-hidden pb-20 sm:pb-28">
      {/* Dot-grid backdrop, faded out toward the edges. */}
      <div
        aria-hidden="true"
        className="bg-grid-dot pointer-events-none absolute inset-0 -z-30 opacity-70 [mask-image:radial-gradient(ellipse_60%_55%_at_50%_0%,black,transparent_70%)] dark:opacity-100"
      />
      {/* Faint radiating hairlines behind the butterfly mark. */}
      <div
        aria-hidden="true"
        className="bg-hairline-rays pointer-events-none absolute inset-x-0 top-0 -z-20 h-[40rem] [mask-image:radial-gradient(circle_at_50%_14%,black,transparent_58%)]"
      />
      {/* Purple glow, blurred and centered behind the headline. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-40 -z-10 flex justify-center"
      >
        <div className="h-[28rem] w-[50rem] rounded-full bg-purple-500/15 blur-[100px] dark:bg-purple-500/25" />
      </div>
      {/* The brand mark, floating. Sized/positioned to clear the eyebrow
          pill below with margin to spare even at the top of its float
          animation — see the content wrapper's `pt-*` just below. */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-4 -z-10 flex justify-center sm:top-2"
        animate={prefersReducedMotion ? undefined : { y: [0, -10, 0] }}
        transition={
          prefersReducedMotion
            ? undefined
            : {
                duration: 7,
                repeat: Number.POSITIVE_INFINITY,
                ease: "easeInOut",
              }
        }
      >
        <ButterflyMark className="h-auto w-32 drop-shadow-[0_0_48px_rgba(168,85,247,0.4)] sm:w-44" />
      </motion.div>

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="motion-reveal mx-auto flex max-w-3xl flex-col items-center px-6 pt-36 text-center sm:pt-40"
      >
        <motion.span
          variants={item}
          className="motion-reveal mb-6 inline-flex items-center rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 font-mono text-xs tracking-wide text-purple-700 uppercase dark:text-purple-300"
        >
          {eyebrow}
        </motion.span>
        <motion.h1
          variants={item}
          className={cn(
            "motion-reveal font-display text-balance leading-[1.05] font-bold tracking-tight",
            lang === "ja"
              ? "text-5xl sm:text-6xl md:text-7xl"
              : "text-6xl sm:text-7xl md:text-8xl",
          )}
        >
          {headline.prefix}
          {headline.prefix ? " " : ""}
          <span className="bg-gradient-to-r from-purple-600 to-purple-500 bg-clip-text text-transparent dark:from-purple-400 dark:to-purple-300">
            {headline.highlight}
          </span>
          {headline.suffix}
        </motion.h1>
        <motion.p
          variants={item}
          className="motion-reveal mt-6 max-w-xl text-balance text-lg text-muted-foreground"
        >
          {subhead}
        </motion.p>
        <motion.div
          variants={item}
          className="motion-reveal mt-9 flex flex-wrap items-center justify-center gap-3"
        >
          <Link
            href={getStartedHref}
            className={cn(
              buttonVariants({ size: "lg" }),
              "group/cta bg-purple-600 text-white shadow-[0_1px_0_0_rgba(255,255,255,0.1)_inset,0_8px_24px_-8px_rgba(168,85,247,0.6)] hover:bg-purple-500",
            )}
          >
            {getStartedLabel}
            <ArrowRight
              data-icon="inline-end"
              aria-hidden="true"
              className="size-4 transition-transform motion-safe:group-hover/cta:translate-x-0.5"
            />
          </Link>
          <a
            href={githubHref}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "outline", size: "lg" })}
          >
            {githubLabel}
          </a>
        </motion.div>
        <motion.div
          variants={item}
          className="motion-reveal mt-10 w-full max-w-md"
        >
          <CopyCommand command={installCommand} />
        </motion.div>
      </motion.div>
    </section>
  );
}
