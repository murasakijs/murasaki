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

const TILT = ["-rotate-1", "rotate-[0.5deg]", "rotate-1"];

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
    <section className="relative overflow-hidden bg-[#f4eee3] py-24 text-[#1a1425] sm:py-32">
      {/* Ghost 紫 — same motif, inverted field. */}
      <span
        aria-hidden="true"
        className="lp-kanji pointer-events-none absolute -left-[8vw] top-1/2 -translate-y-1/2 select-none text-[46vw] font-bold leading-none text-purple-800/[0.06] sm:text-[32vw]"
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

        <div className="mt-16 grid gap-6 sm:grid-cols-3">
          {platforms.map((p, i) => (
            <m.div
              key={p.name}
              initial={{ opacity: 0, y: 36, rotate: 0 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.65, ease: EASE, delay: i * 0.1 }}
              className={`motion-reveal ${TILT[i % TILT.length]} rounded-2xl border p-7 ${
                p.available
                  ? "border-purple-700/25 bg-white shadow-[0_24px_60px_-24px_rgba(88,28,135,0.35)]"
                  : "border-dashed border-[#1a1425]/25 bg-white/40 opacity-70"
              }`}
            >
              <p
                className={`lp-display text-[clamp(1.4rem,2.6vw,2rem)] font-extrabold leading-none tracking-tight ${
                  p.available ? "text-purple-700" : "text-[#1a1425]/50"
                }`}
              >
                {EXT_BY_NAME[p.name] ?? p.name}
              </p>
              <p className="lp-sans mt-4 text-lg font-bold">{p.name}</p>
              <span
                className={`lp-mono mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] ${
                  p.available
                    ? "bg-purple-700/10 text-purple-800"
                    : "bg-[#1a1425]/10 text-[#1a1425]/60"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`size-1.5 rounded-full ${
                    p.available ? "bg-emerald-600" : "bg-[#1a1425]/30"
                  }`}
                />
                {p.status}
              </span>
              <p className="lp-sans mt-4 text-sm leading-relaxed text-[#1a1425]/65">
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
          className="motion-reveal lp-mono mt-12 text-xs uppercase tracking-[0.25em] text-[#1a1425]/50"
        >
          {caption}
        </m.p>
      </div>
    </section>
  );
}
