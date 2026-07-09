"use client";

import { m } from "motion/react";
import type { HomeContent } from "@/lib/home-content";
import { EASE, MaskReveal, SceneLabel } from "./lp-motion";

/**
 * The comparison — a sticky editorial rail (heading + the giant ~1/5 memory
 * stat) that holds position while the Murasaki/Electron/Tauri rows scroll
 * past it. Murasaki's column is the only one allowed any color.
 */
export function LpVersus({
  t,
  rows,
  footnote,
}: {
  t: HomeContent["whyMurasaki"];
  rows: HomeContent["comparisonRows"];
  footnote: string;
}) {
  const heads = [
    t.tableHeadings.murasaki,
    t.tableHeadings.electron,
    t.tableHeadings.tauri,
  ];

  return (
    <section className="relative bg-[#f4f2ed] py-24 pb-32 text-[#111014] sm:py-32">
      <div className="mx-auto grid w-full max-w-6xl gap-14 px-6 lg:grid-cols-[1fr_1.4fr]">
        {/* Sticky rail. */}
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SceneLabel index="04" code="VS ELECTRON / TAURI" />
          <MaskReveal
            as="h2"
            className="lp-display mt-6 text-[clamp(2.2rem,5vw,3.8rem)] font-extrabold leading-[0.95] tracking-tight"
          >
            {t.heading}
          </MaskReveal>
          <m.p
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{ duration: 0.6, ease: EASE, delay: 0.15 }}
            className="motion-reveal lp-sans mt-5 max-w-md text-base leading-relaxed text-purple-200/70"
          >
            {t.paragraph}
          </m.p>

          <m.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.6 }}
            transition={{ duration: 0.7, ease: EASE, delay: 0.15 }}
            className="motion-reveal mt-12"
          >
            <p className="lp-display text-[clamp(4.5rem,10vw,8rem)] font-extrabold leading-none tracking-tight text-[#7c3aed]">
              {t.statValue}
            </p>
            <p className="lp-sans mt-3 max-w-xs text-sm text-[#111014]/60">
              {t.statLabel}
            </p>
            <p className="lp-mono mt-4 max-w-xs text-[11px] leading-relaxed text-[#111014]/40">
              {footnote}
            </p>
          </m.div>
        </div>

        {/* Rows. */}
        <div className="min-w-0">
          {rows.map((row, i) => (
            <m.div
              key={row.label}
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.35 }}
              transition={{ duration: 0.6, ease: EASE, delay: 0.05 }}
              className="motion-reveal border-b border-[#111014]/15 py-7 first:border-t"
            >
              <p className="lp-mono text-[10px] uppercase tracking-[0.3em] text-[#111014]/45">
                {String(i + 1).padStart(2, "0")} · {row.label}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {[row.murasaki, row.electron, row.tauri].map((value, col) => (
                  <div key={heads[col]}>
                    <p
                      className={`lp-mono text-[10px] uppercase tracking-[0.25em] ${
                        col === 0 ? "text-[#7c3aed]" : "text-[#111014]/35"
                      }`}
                    >
                      {heads[col]}
                    </p>
                    <p
                      className={`lp-sans mt-1.5 text-sm leading-snug ${
                        col === 0
                          ? "font-semibold text-[#111014]"
                          : "text-[#111014]/50"
                      }`}
                    >
                      {value}
                    </p>
                  </div>
                ))}
              </div>
            </m.div>
          ))}
        </div>
      </div>
    </section>
  );
}
