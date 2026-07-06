"use client";

import { motion, useReducedMotion } from "motion/react";

interface ComparisonRow {
  label: string;
  murasaki: string;
  electron: string;
  tauri: string;
}

interface WhyMurasakiProps {
  eyebrow: string;
  heading: string;
  paragraph: string;
  tableHeadings: {
    feature: string;
    murasaki: string;
    electron: string;
    tauri: string;
  };
  rows: ComparisonRow[];
  statValue: string;
  statLabel: string;
  footnote: string;
}

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

/**
 * "Why murasaki": the existing comparison table against Electron/Tauri
 * (murasaki's column visually highlighted in purple), followed by the
 * "~1/5 the memory of Electron" pull-stat — always paired with its
 * `comparisonFootnote` caveat, never shown alone.
 */
export function WhyMurasaki({
  eyebrow,
  heading,
  paragraph,
  tableHeadings,
  rows,
  statValue,
  statLabel,
  footnote,
}: WhyMurasakiProps) {
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

      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, y: 32 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.15 }}
        transition={{ duration: 0.7, ease: EASE_OUT_EXPO, delay: 0.1 }}
        className="motion-reveal mt-14 overflow-x-auto"
      >
        <table className="w-full min-w-[36rem] table-fixed border-collapse text-left">
          <thead>
            <tr>
              <th
                scope="col"
                className="w-1/4 border-b border-border py-3 pr-4 align-bottom font-mono text-xs font-medium tracking-wide text-muted-foreground uppercase"
              >
                {tableHeadings.feature}
              </th>
              <th
                scope="col"
                className="w-1/4 rounded-t-lg border-x border-t border-purple-500/30 bg-purple-500/10 px-4 py-3 align-bottom font-mono text-xs font-medium tracking-wide text-purple-700 uppercase dark:text-purple-300"
              >
                {tableHeadings.murasaki}
              </th>
              <th
                scope="col"
                className="w-1/4 border-b border-border px-4 py-3 align-bottom font-mono text-xs font-medium tracking-wide text-muted-foreground uppercase"
              >
                {tableHeadings.electron}
              </th>
              <th
                scope="col"
                className="w-1/4 border-b border-border px-4 py-3 align-bottom font-mono text-xs font-medium tracking-wide text-muted-foreground uppercase"
              >
                {tableHeadings.tauri}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.label}>
                <td className="border-b border-border py-4 pr-4 text-sm font-medium">
                  {row.label}
                </td>
                <td
                  className={`border-x border-purple-500/30 bg-purple-500/5 px-4 py-4 text-sm font-semibold text-purple-700 dark:text-purple-300 ${
                    i === rows.length - 1 ? "rounded-b-lg border-b" : ""
                  }`}
                >
                  {row.murasaki}
                </td>
                <td className="border-b border-border px-4 py-4 text-sm text-muted-foreground">
                  {row.electron}
                </td>
                <td className="border-b border-border px-4 py-4 text-sm text-muted-foreground">
                  {row.tauri}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </motion.div>

      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 0.6, ease: EASE_OUT_EXPO, delay: 0.15 }}
        className="motion-reveal mt-20 text-center"
      >
        <p className="font-display text-balance text-7xl font-bold tracking-tight text-purple-600 sm:text-8xl md:text-9xl dark:text-purple-400">
          {statValue}
        </p>
        <p className="mt-4 text-lg text-balance text-muted-foreground">
          {statLabel}
        </p>
        <p className="mt-6 font-mono text-xs text-muted-foreground/70">
          {footnote}
        </p>
      </motion.div>
    </section>
  );
}
