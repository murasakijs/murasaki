"use client";

import { motion, useReducedMotion } from "motion/react";
import { ButterflyMark } from "@/components/home/butterfly-mark";

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

/**
 * A giant closing wordmark — "murasaki" in massive `.font-display` type
 * with the brand mark, echoing Hermes' giant "HERMES" close. The brand name
 * itself is never translated, so this renders identically in both locales
 * (the `ja` mincho cut still applies via `.font-display`'s `:lang(ja)`
 * override, since Zen Old Mincho's font file isn't actually subset to
 * exclude latin glyphs — see lib/fonts.ts).
 */
export function Wordmark() {
  const prefersReducedMotion = useReducedMotion();

  return (
    <section className="border-t border-border py-20 sm:py-28">
      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 0.7, ease: EASE_OUT_EXPO }}
        className="motion-reveal mx-auto flex max-w-5xl flex-col items-center gap-6 px-6 text-center"
      >
        <ButterflyMark className="h-auto w-10 sm:w-14" />
        <p className="font-display text-balance text-[3.25rem] leading-none font-bold tracking-tight sm:text-[6rem] md:text-[9rem]">
          murasaki
        </p>
      </motion.div>
    </section>
  );
}
