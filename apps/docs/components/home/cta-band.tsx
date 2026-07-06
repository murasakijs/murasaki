"use client";

import { ArrowRight } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { CopyCommand } from "@/components/copy-command";
import { ButterflyMark } from "@/components/home/butterfly-mark";
import { cn } from "@/lib/utils";

interface CtaBandProps {
  heading: string;
  paragraph: string;
  installCommand: string;
  getStartedLabel: string;
  getStartedHref: string;
}

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

/**
 * The closing full-bleed solid-purple CTA band — the site's boldest
 * "color field" moment after the thin band up in page.tsx, deliberately not
 * theme-reactive (white text on purple-600 in both light and dark).
 */
export function CtaBand({
  heading,
  paragraph,
  installCommand,
  getStartedLabel,
  getStartedHref,
}: CtaBandProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <section className="relative overflow-hidden bg-purple-600 py-24 sm:py-32">
      {/* A fixed white glow (not theme-reactive, unlike `.bg-hairline-rays`
          elsewhere) — this band stays identically purple/white in both
          themes. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 flex justify-center"
      >
        <div className="h-72 w-[40rem] rounded-full bg-white/10 blur-[100px]" />
      </div>

      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, y: 28 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 0.6, ease: EASE_OUT_EXPO }}
        className="motion-reveal relative mx-auto flex max-w-2xl flex-col items-center px-6 text-center text-white"
      >
        <span
          aria-hidden="true"
          className="mb-8 flex size-16 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/20"
        >
          <ButterflyMark className="h-auto w-9" />
        </span>
        <h2 className="font-display text-balance text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
          {heading}
        </h2>
        <p className="mt-5 max-w-lg text-balance text-white/80">{paragraph}</p>
        <div className="mt-9 w-full max-w-md">
          <CopyCommand command={installCommand} />
        </div>
        <Link
          href={getStartedHref}
          className={cn(
            "group/cta mt-6 inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-white px-4 text-sm font-medium text-purple-700 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.35)] transition-colors hover:bg-white/90",
          )}
        >
          {getStartedLabel}
          <ArrowRight
            aria-hidden="true"
            className="size-4 transition-transform motion-safe:group-hover/cta:translate-x-0.5"
          />
        </Link>
      </motion.div>
    </section>
  );
}
