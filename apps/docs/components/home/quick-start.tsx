"use client";

import { motion, useReducedMotion } from "motion/react";
import { CopyCommand } from "@/components/copy-command";

interface Step {
  label: string;
  command: string;
}

interface QuickStartProps {
  eyebrow: string;
  heading: string;
  steps: Step[];
}

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

/**
 * "Ship in three commands" — a punchy recap of the real scaffold/dev/bundle
 * commands (content/docs/getting-started/quick-start.mdx), right before the
 * closing CTA band.
 */
export function QuickStart({ eyebrow, heading, steps }: QuickStartProps) {
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
      </motion.div>

      <div className="mx-auto mt-14 flex max-w-md flex-col gap-8">
        {steps.map((step, i) => (
          <motion.div
            key={step.label}
            initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{
              duration: 0.5,
              ease: EASE_OUT_EXPO,
              delay: prefersReducedMotion ? 0 : i * 0.1,
            }}
            className="motion-reveal flex items-center gap-5"
          >
            <span
              aria-hidden="true"
              className="font-display flex size-10 shrink-0 items-center justify-center rounded-full bg-purple-600 text-lg font-bold text-white"
            >
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="mb-1.5 text-sm font-medium text-muted-foreground">
                {step.label}
              </p>
              <CopyCommand command={step.command} />
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
