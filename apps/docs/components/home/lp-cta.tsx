"use client";

import { ArrowRight } from "lucide-react";
import { m } from "motion/react";
import Link from "next/link";
import { CopyCommand } from "@/components/copy-command";
import { EASE } from "./lp-motion";

/**
 * Closing scene: the CTA under a colossal, near-invisible ghost 「紫」 —
 * per-word mask reveal on the heading, flat near-black field. Ends the page
 * on the same kanji it opened with.
 */
export function LpCta({
  heading,
  paragraph,
  installCommand,
  getStartedLabel,
  getStartedHref,
  githubLabel,
  githubHref,
}: {
  heading: string;
  paragraph: string;
  installCommand: string;
  getStartedLabel: string;
  getStartedHref: string;
  githubLabel: string;
  githubHref: string;
}) {
  // English headings mask-reveal word by word; Japanese (no spaces) reveals
  // as a single line.
  const words = /\s/.test(heading) ? heading.split(/\s+/) : [heading];

  return (
    <section className="relative overflow-hidden bg-[#0e0e10] py-32 text-white sm:py-44">
      <span
        aria-hidden="true"
        className="lp-kanji pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none text-[80vw] font-bold leading-none text-white/[0.04] sm:text-[44vw]"
      >
        紫
      </span>

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center px-6 text-center">
        {/* whileInView lives on the h2 (unclipped) and propagates to the
            clipped word spans — an observer on the clipped spans themselves
            would never fire (intersection ratio 0). */}
        <m.h2
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.5 }}
          transition={{ staggerChildren: 0.07 }}
          className="lp-display flex flex-wrap justify-center gap-x-[0.28em] text-[clamp(2.6rem,8vw,6.5rem)] font-extrabold leading-[0.95] tracking-tight"
        >
          {words.map((word, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: static heading, order never changes.
              key={i}
              className="inline-block overflow-hidden"
            >
              <m.span
                variants={{
                  hidden: { y: "112%" },
                  visible: {
                    y: "0%",
                    transition: { duration: 0.8, ease: EASE, delay: i * 0.07 },
                  },
                }}
                className="motion-reveal inline-block will-change-transform"
              >
                {word}
              </m.span>
            </span>
          ))}
        </m.h2>

        <m.p
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.6 }}
          transition={{ duration: 0.6, ease: EASE, delay: 0.25 }}
          className="motion-reveal lp-sans mt-6 max-w-2xl text-base leading-relaxed text-white/55 sm:text-lg"
        >
          {paragraph}
        </m.p>

        <m.div
          initial={{ opacity: 0, y: 22 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.6 }}
          transition={{ duration: 0.7, ease: EASE, delay: 0.4 }}
          className="motion-reveal mt-10 flex flex-col items-center gap-5"
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
              className="lp-sans inline-flex h-12 items-center rounded-full border border-white/25 px-7 font-semibold text-white/90 transition-colors hover:border-white/55"
            >
              {githubLabel}
            </a>
          </div>
        </m.div>
      </div>
    </section>
  );
}
