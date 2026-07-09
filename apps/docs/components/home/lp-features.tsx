"use client";

import { m } from "motion/react";
import type { HomeContent } from "@/lib/home-content";
import { EASE, MaskReveal, SceneLabel } from "./lp-motion";

/**
 * Feature index — the six shipping features as an editorial contents page:
 * huge outlined Bricolage numerals (fill on hover), hairline dividers, mask
 * reveals. No cards, no icons — type does all the work.
 */
export function LpFeatures({
  eyebrow,
  heading,
  intro,
  features,
}: {
  eyebrow: string;
  heading: string;
  intro: string;
  features: HomeContent["features"];
}) {
  return (
    <section className="relative bg-[#0b0a12] py-24 text-purple-50 sm:py-32">
      <div className="mx-auto w-full max-w-6xl px-6">
        <SceneLabel index="03" code={eyebrow} />

        <MaskReveal
          as="h2"
          className="lp-display mt-6 max-w-4xl text-[clamp(2.2rem,6vw,4.5rem)] font-extrabold leading-[0.95] tracking-tight"
        >
          {heading}
        </MaskReveal>

        <m.p
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.6, ease: EASE, delay: 0.15 }}
          className="motion-reveal lp-sans mt-5 max-w-2xl text-base leading-relaxed text-purple-200/70 sm:text-lg"
        >
          {intro}
        </m.p>

        <div className="mt-16 border-t border-white/10">
          {features.map((f, i) => (
            <m.div
              key={f.title}
              initial={{ opacity: 0, y: 26 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.35 }}
              transition={{ duration: 0.6, ease: EASE, delay: (i % 2) * 0.06 }}
              className="lp-row motion-reveal group grid grid-cols-[auto_1fr] items-baseline gap-x-6 gap-y-2 border-b border-white/10 py-8 transition-colors hover:bg-white/[0.03] sm:grid-cols-[7rem_1fr_1.2fr] sm:gap-x-10 sm:py-10"
            >
              <span
                aria-hidden="true"
                className="lp-display lp-outline-number text-[clamp(2.6rem,6vw,5rem)] font-extrabold leading-none"
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="lp-display text-xl font-bold leading-tight sm:text-2xl lg:text-3xl">
                {f.title}
              </h3>
              <p className="lp-sans col-span-2 text-sm leading-relaxed text-purple-200/60 sm:col-span-1 sm:text-base">
                {f.description}
              </p>
            </m.div>
          ))}
        </div>
      </div>
    </section>
  );
}
