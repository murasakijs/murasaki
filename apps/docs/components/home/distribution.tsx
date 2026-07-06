"use client";

import { motion, useReducedMotion } from "motion/react";

interface Step {
  label: string;
  command: string;
  note?: string;
}

interface Platform {
  name: string;
  status: string;
  available: boolean;
  description: string;
}

interface DistributionProps {
  eyebrow: string;
  heading: string;
  paragraph: string;
  steps: Step[];
  platforms: Platform[];
}

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

/**
 * "From dev to a signed .app" — a stepped flow of the real CLI commands
 * (content/docs/getting-started/quick-start.mdx +
 * content/docs/building/distribution.mdx), followed by per-platform status
 * cards. Bundling is macOS-only today, so Windows/Linux are explicitly
 * labeled "roadmap" rather than implied as shipping.
 */
export function Distribution({
  eyebrow,
  heading,
  paragraph,
  steps,
  platforms,
}: DistributionProps) {
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
        <p className="mt-4 text-balance text-muted-foreground">{paragraph}</p>
      </motion.div>

      <div className="mt-14 space-y-6">
        {steps.map((step, i) => (
          <motion.div
            key={step.label}
            initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{
              duration: 0.5,
              ease: EASE_OUT_EXPO,
              delay: prefersReducedMotion ? 0 : i * 0.06,
            }}
            className="motion-reveal flex flex-col gap-3 border-l-2 border-purple-500/30 py-1 pl-6 sm:flex-row sm:items-center sm:gap-6"
          >
            <div className="flex items-baseline gap-3 sm:w-40 sm:shrink-0">
              <span
                aria-hidden="true"
                className="font-mono text-xs text-purple-500 dark:text-purple-400"
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="font-display text-lg font-bold tracking-tight">
                {step.label}
              </h3>
            </div>
            <div className="min-w-0 flex-1">
              <code className="block overflow-x-auto rounded-lg bg-muted px-4 py-2.5 font-mono text-sm whitespace-pre">
                {step.command}
              </code>
              {step.note ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {step.note}
                </p>
              ) : null}
            </div>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.6, ease: EASE_OUT_EXPO }}
        className="motion-reveal mt-16 grid gap-4 sm:grid-cols-3"
      >
        {platforms.map((platform) => (
          <div
            key={platform.name}
            className="rounded-xl border border-border p-5"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-base font-bold tracking-tight">
                {platform.name}
              </h3>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[0.65rem] tracking-wide uppercase ${
                  platform.available
                    ? "bg-purple-500/10 text-purple-700 dark:text-purple-300"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {platform.status}
              </span>
            </div>
            <p className="mt-2.5 text-sm text-muted-foreground">
              {platform.description}
            </p>
          </div>
        ))}
      </motion.div>
    </section>
  );
}
