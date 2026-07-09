"use client";

import { m } from "motion/react";
import type { HomeContent } from "@/lib/home-content";
import { EASE, MaskReveal, SceneLabel } from "./lp-motion";

/**
 * "This is what you ship." — the page's single LIGHT color-field: a warm
 * cream scene (deliberate contrast against the purple dark everywhere else)
 * holding the three installer artifacts as slightly-tilted spec cards.
 * Deliberately theme-independent, like the dark scenes.
 */

const EXT_BY_NAME: Record<string, string> = {
  macOS: ".app / .dmg",
  Windows: ".zip / .exe / .msi",
  Linux: ".AppImage",
};

export function LpShip({
  heading,
  caption,
  platforms,
}: {
  heading: string;
  caption: string;
  platforms: HomeContent["distribution"]["platforms"];
}) {
  return (
    <section className="relative overflow-hidden bg-[#f4f2ed] py-24 text-[#111014] sm:py-32">
      {/* Ghost 紫 — same motif, inverted field. */}
      <span
        aria-hidden="true"
        className="lp-kanji pointer-events-none absolute -left-[8vw] top-1/2 -translate-y-1/2 select-none text-[46vw] font-bold leading-none text-[#111014]/[0.04] sm:text-[30vw]"
      >
        紫
      </span>

      <div className="relative mx-auto w-full max-w-6xl px-6">
        <SceneLabel index="05" code="ARTIFACTS" tone="light" />

        <MaskReveal
          as="h2"
          className="lp-display mt-6 max-w-4xl text-[clamp(2.4rem,7vw,5.5rem)] font-extrabold leading-[0.92] tracking-tight"
        >
          {heading}
        </MaskReveal>

        <div className="mt-16 grid gap-x-10 gap-y-12 border-t border-[#111014]/15 pt-12 sm:grid-cols-3">
          {platforms.map((p, i) => (
            <m.div
              key={p.name}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.6, ease: EASE, delay: i * 0.08 }}
              className={`motion-reveal ${p.available ? "" : "opacity-45"}`}
            >
              <p
                className={`lp-display text-[clamp(1.5rem,2.8vw,2.2rem)] font-extrabold leading-none tracking-tight ${
                  p.available ? "text-[#7c3aed]" : "text-[#111014]/60"
                }`}
              >
                {EXT_BY_NAME[p.name] ?? p.name}
              </p>
              <p className="lp-sans mt-4 text-lg font-bold">{p.name}</p>
              <p className="lp-mono mt-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-[#111014]/50">
                <span
                  aria-hidden="true"
                  className={`size-1.5 rounded-full ${
                    p.available ? "bg-[#7c3aed]" : "bg-[#111014]/25"
                  }`}
                />
                {p.status}
              </p>
              <p className="lp-sans mt-4 text-sm leading-relaxed text-[#111014]/55">
                {p.description}
              </p>
            </m.div>
          ))}
        </div>

        <m.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, amount: 0.6 }}
          transition={{ duration: 0.7, ease: EASE, delay: 0.3 }}
          className="motion-reveal lp-mono mt-12 text-xs uppercase tracking-[0.25em] text-[#111014]/45"
        >
          {caption}
        </m.p>
      </div>
    </section>
  );
}
