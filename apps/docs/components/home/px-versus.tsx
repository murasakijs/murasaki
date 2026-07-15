"use client";

import { gsap } from "gsap";
import { useLayoutEffect, useRef } from "react";
import type { HomeContent } from "@/lib/home-content";

/**
 * The comparison, with the memory claim made LITERAL in pixels: Electron is
 * a bar of 25 ink cells, Murasaki is 5 purple cells — one fifth, drawn in
 * the brand's own pixel unit and filled cell by cell on scroll (stepped
 * ease, like a loading bar from 1989). A sticky rail holds the argument
 * while the aligned comparison columns scroll past.
 */
export function PxVersus({
  t,
  rows,
  footnote,
}: {
  t: HomeContent["whyMurasaki"];
  rows: HomeContent["comparisonRows"];
  footnote: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const heads = [
    t.tableHeadings.murasaki,
    t.tableHeadings.electron,
    t.tableHeadings.tauri,
  ];

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const ctx = gsap.context(() => {
        gsap.from("[data-vs-heading]", {
          yPercent: 110,
          duration: 0.8,
          ease: "expo.out",
          scrollTrigger: { trigger: root, start: "top 75%" },
        });
        // The pixel bars fill cell by cell, stepped.
        gsap.from("[data-vs-cell-e]", {
          opacity: 0,
          scale: 0,
          transformOrigin: "center",
          stagger: 0.03,
          duration: 0.2,
          ease: "steps(1)",
          scrollTrigger: { trigger: "[data-vs-bars]", start: "top 80%" },
        });
        gsap.from("[data-vs-cell-m]", {
          opacity: 0,
          scale: 0,
          transformOrigin: "center",
          stagger: 0.1,
          duration: 0.2,
          ease: "steps(1)",
          delay: 0.8,
          scrollTrigger: { trigger: "[data-vs-bars]", start: "top 80%" },
        });
        gsap.from("[data-vs-stat]", {
          opacity: 0,
          y: 16,
          duration: 0.6,
          ease: "power2.out",
          delay: 1.3,
          scrollTrigger: { trigger: "[data-vs-bars]", start: "top 80%" },
        });
        for (const row of gsap.utils.toArray<HTMLElement>("[data-vs-row]")) {
          gsap.from(row, {
            opacity: 0,
            y: 24,
            duration: 0.6,
            ease: "power2.out",
            scrollTrigger: { trigger: row, start: "top 88%" },
          });
        }
      }, root);
      return () => ctx.revert();
    });
    return () => mm.revert();
  }, []);

  return (
    <section
      ref={ref}
      className="relative bg-[#f4f2ed] py-24 text-[#111014] sm:py-32"
    >
      <div className="mx-auto grid w-full max-w-6xl gap-14 px-6 lg:grid-cols-[1fr_1.4fr]">
        {/* Sticky rail. */}
        <div className="min-w-0 lg:sticky lg:top-28 lg:self-start">
          <p className="lp-pixel text-[11px] uppercase tracking-[0.25em] text-[#111014]/50">
            <span className="text-[#7c3aed]">05</span> · vs Electron / Tauri
          </p>

          <div className="mt-6 overflow-hidden">
            <h2
              data-vs-heading
              className="lp-display text-[clamp(2.2rem,5vw,3.8rem)] font-extrabold leading-[0.95] tracking-tight"
            >
              {t.heading}
            </h2>
          </div>

          <p className="lp-sans mt-5 max-w-md text-base leading-relaxed text-[#111014]/55">
            {t.paragraph}
          </p>

          {/* The 1/5 claim as pixel bars. */}
          <div data-vs-bars className="mt-12">
            <p className="lp-pixel text-[10px] uppercase tracking-[0.25em] text-[#111014]/45">
              {t.tableHeadings.electron}
            </p>
            <div className="mt-2 flex gap-1">
              {Array.from({ length: 25 }, (_, i) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: identical cells.
                  key={i}
                  data-vs-cell-e
                  className="size-3 bg-[#111014]/25"
                />
              ))}
            </div>
            <p className="lp-pixel mt-4 text-[10px] uppercase tracking-[0.25em] text-[#7c3aed]">
              {t.tableHeadings.murasaki}
            </p>
            <div className="mt-2 flex gap-1">
              {Array.from({ length: 5 }, (_, i) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: identical cells.
                  key={i}
                  data-vs-cell-m
                  className="size-3 bg-[#7c3aed]"
                />
              ))}
            </div>

            <div data-vs-stat className="mt-8">
              <p className="lp-display text-[clamp(4rem,9vw,7rem)] font-extrabold leading-none tracking-tight text-[#7c3aed]">
                {t.statValue}
              </p>
              <p className="lp-sans mt-3 max-w-xs text-sm text-[#111014]/60">
                {t.statLabel}
              </p>
              <p className="lp-mono mt-4 max-w-xs text-[11px] leading-relaxed text-[#111014]/40">
                {footnote}
              </p>
            </div>
          </div>
        </div>

        {/* Aligned comparison columns. */}
        <div className="min-w-0">
          {rows.map((row, i) => (
            <div
              key={row.label}
              data-vs-row
              className="border-b border-[#111014]/15 py-7 first:border-t"
            >
              <p className="lp-pixel text-[10px] uppercase tracking-[0.25em] text-[#111014]/45">
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
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
