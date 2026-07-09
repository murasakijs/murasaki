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
  const heads = [t.tableHeadings.murasaki, t.tableHeadings.electron, t.tableHeadings.tauri];

  return (
    <section className="relative bg-[#0e0b18] py-24 text-purple-50 sm:py-32">
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
            initial={{ opacity: 0, scale: 0.92, filter: "blur(6px)" }}
            whileInView={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            viewport={{ once: true, amount: 0.6 }}
            transition={{ duration: 0.8, ease: EASE, delay: 0.2 }}
            className="motion-reveal mt-12"
          >
            <p className="lp-display bg-gradient-to-br from-purple-300 via-purple-400 to-fuchsia-500 bg-clip-text text-[clamp(4.5rem,10vw,8rem)] font-extrabold leading-none tracking-tight text-transparent drop-shadow-[0_0_40px_rgba(168,85,247,0.35)]">
              {t.statValue}
            </p>
            <p className="lp-sans mt-2 max-w-xs text-sm text-purple-200/70">
              {t.statLabel}
            </p>
            <p className="lp-mono mt-4 max-w-xs text-[11px] leading-relaxed text-purple-300/40">
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
              className="motion-reveal border-b border-white/10 py-7 first:border-t"
            >
              <p className="lp-mono text-[10px] uppercase tracking-[0.3em] text-purple-300/60">
                {String(i + 1).padStart(2, "0")} · {row.label}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {[row.murasaki, row.electron, row.tauri].map((value, col) => (
                  <div
                    key={heads[col]}
                    className={
                      col === 0
                        ? "rounded-lg border-l-2 border-purple-500 bg-purple-500/[0.07] px-4 py-3"
                        : "px-4 py-3"
                    }
                  >
                    <p
                      className={`lp-mono text-[10px] uppercase tracking-[0.25em] ${
                        col === 0 ? "text-purple-300" : "text-purple-200/40"
                      }`}
                    >
                      {heads[col]}
                    </p>
                    <p
                      className={`lp-sans mt-1.5 text-sm leading-snug ${
                        col === 0
                          ? "font-semibold text-purple-50"
                          : "text-purple-200/55"
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
