"use client";

import { m } from "motion/react";
import type { HomeContent } from "@/lib/home-content";
import { EASE, MaskReveal, SceneLabel } from "./lp-motion";

/**
 * Three commands, set like a terminal transcript at display scale — the
 * whole pitch is that shipping is this short, so the section is exactly
 * three lines long.
 */
export function LpQuickstart({
  eyebrow,
  heading,
  steps,
}: {
  eyebrow: string;
  heading: string;
  steps: HomeContent["quickStart"]["steps"];
}) {
  return (
    <section className="relative bg-[#0b0a12] py-24 text-purple-50 sm:py-32">
      <div className="mx-auto w-full max-w-6xl px-6">
        <SceneLabel index="06" code={eyebrow} />

        <MaskReveal
          as="h2"
          className="lp-display mt-6 max-w-4xl text-[clamp(2.2rem,6vw,4.5rem)] font-extrabold leading-[0.95] tracking-tight"
        >
          {heading}
        </MaskReveal>

        <div className="mt-14 border-t border-white/10">
          {steps.map((step, i) => (
            <m.div
              key={step.command}
              initial={{ opacity: 0, x: -32 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, amount: 0.5 }}
              transition={{ duration: 0.6, ease: EASE, delay: i * 0.08 }}
              className="motion-reveal flex flex-col gap-2 border-b border-white/10 py-8 sm:flex-row sm:items-baseline sm:gap-8"
            >
              <span className="lp-mono flex items-baseline gap-3 text-[11px] uppercase tracking-[0.3em] text-purple-300/60 sm:w-40 sm:shrink-0">
                <span aria-hidden="true" className="text-purple-400">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {step.label}
              </span>
              <code className="lp-mono block overflow-x-auto text-[clamp(1rem,2.6vw,1.7rem)] font-medium tracking-tight whitespace-pre">
                <span
                  aria-hidden="true"
                  className="select-none text-purple-400"
                >
                  ${" "}
                </span>
                {step.command}
              </code>
            </m.div>
          ))}
        </div>
      </div>
    </section>
  );
}
