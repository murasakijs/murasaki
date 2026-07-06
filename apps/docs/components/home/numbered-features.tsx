"use client";

import { motion, useReducedMotion } from "motion/react";

interface Feature {
  title: string;
  description: string;
}

interface NumberedFeaturesProps {
  eyebrow: string;
  heading: string;
  description: string;
  features: Feature[];
}

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

/**
 * Hermes-style editorial numbered set — the 6 shipping features
 * (homeContent.*.features) as a single stacked list, each row a huge faint
 * mono numeral beside a serif title, staggered into view row by row.
 */
export function NumberedFeatures({
  eyebrow,
  heading,
  description,
  features,
}: NumberedFeaturesProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <section className="mx-auto w-full max-w-4xl px-6 py-16 sm:py-24">
      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 0.6, ease: EASE_OUT_EXPO }}
        className="motion-reveal mx-auto max-w-2xl text-center"
      >
        <span className="mb-5 inline-flex items-center rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 font-mono text-xs tracking-wide text-purple-700 uppercase dark:text-purple-300">
          {eyebrow}
        </span>
        <h2 className="font-display text-balance text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
          {heading}
        </h2>
        <p className="mt-4 text-balance text-muted-foreground">{description}</p>
      </motion.div>

      <div className="mt-14 divide-y divide-border border-t border-border">
        {features.map((feature, i) => (
          <motion.div
            key={feature.title}
            initial={prefersReducedMotion ? false : { opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{
              duration: 0.5,
              ease: EASE_OUT_EXPO,
              delay: prefersReducedMotion ? 0 : i * 0.06,
            }}
            className="motion-reveal grid grid-cols-[3rem_1fr] items-baseline gap-4 py-8 sm:grid-cols-[6rem_1fr] sm:gap-8 sm:py-10"
          >
            <span
              aria-hidden="true"
              className="font-mono text-3xl font-medium text-purple-500/25 tabular-nums sm:text-5xl dark:text-purple-400/25"
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <h3 className="font-display text-xl font-bold tracking-tight sm:text-2xl">
                {feature.title}
              </h3>
              <p className="mt-2 max-w-lg text-muted-foreground">
                {feature.description}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
