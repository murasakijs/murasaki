"use client";

import { gsap } from "gsap";
import { useLayoutEffect, useRef } from "react";
import type { HomeContent } from "@/lib/home-content";

const EXT_BY_NAME: Record<string, string> = {
  macOS: ".app / .dmg",
  Windows: ".zip / .exe / .msi",
  Linux: ".AppImage",
};

/**
 * "This is what you ship." — the installer artifacts as three hairline
 * columns on paper. Purple marks the platforms that ship today; the
 * roadmap column is dimmed. Flat text and rules only.
 */
export function PxArtifacts({
  heading,
  caption,
  platforms,
}: {
  heading: string;
  caption: string;
  platforms: HomeContent["distribution"]["platforms"];
}) {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const ctx = gsap.context(() => {
        gsap.from("[data-ar-heading]", {
          yPercent: 110,
          duration: 0.8,
          ease: "expo.out",
          scrollTrigger: { trigger: root, start: "top 75%" },
        });
        gsap.from("[data-ar-col]", {
          opacity: 0,
          y: 24,
          duration: 0.65,
          ease: "power2.out",
          stagger: 0.09,
          scrollTrigger: { trigger: "[data-ar-grid]", start: "top 85%" },
        });
      }, root);
      return () => ctx.revert();
    });
    return () => mm.revert();
  }, []);

  return (
    <section
      ref={ref}
      className="relative overflow-hidden bg-[#f4f2ed] py-24 text-[#111014] sm:py-32"
    >
      {/* Ghost 紫 — same watermark, other edge. */}
      <span
        aria-hidden="true"
        className="lp-kanji pointer-events-none absolute -left-[8vw] top-1/2 -translate-y-1/2 select-none text-[44vw] font-bold leading-none text-[#111014]/[0.04] sm:text-[28vw]"
      >
        紫
      </span>

      <div className="relative mx-auto w-full max-w-6xl px-6">
        <p className="lp-pixel text-[11px] uppercase tracking-[0.25em] text-[#111014]/50">
          <span className="text-[#7c3aed]">06</span> · Artifacts
        </p>

        <div className="mt-6 overflow-hidden">
          <h2
            data-ar-heading
            className="lp-display max-w-4xl text-[clamp(2.4rem,7vw,5.5rem)] font-extrabold leading-[0.92] tracking-tight"
          >
            {heading}
          </h2>
        </div>

        <div
          data-ar-grid
          className="mt-16 grid gap-x-10 gap-y-12 border-t border-[#111014]/15 pt-12 sm:grid-cols-3"
        >
          {platforms.map((p) => (
            <div
              key={p.name}
              data-ar-col
              className={p.available ? "" : "opacity-45"}
            >
              <p
                className={`lp-display text-[clamp(1.5rem,2.8vw,2.2rem)] font-extrabold leading-none tracking-tight ${
                  p.available ? "text-[#7c3aed]" : "text-[#111014]/60"
                }`}
              >
                {EXT_BY_NAME[p.name] ?? p.name}
              </p>
              <p className="lp-sans mt-4 text-lg font-bold">{p.name}</p>
              <p className="lp-pixel mt-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-[#111014]/50">
                <span
                  aria-hidden="true"
                  className={`size-1.5 ${
                    p.available ? "bg-[#7c3aed]" : "bg-[#111014]/25"
                  }`}
                />
                {p.status}
              </p>
              <p className="lp-sans mt-4 text-sm leading-relaxed text-[#111014]/55">
                {p.description}
              </p>
            </div>
          ))}
        </div>

        <p className="lp-mono mt-12 text-xs uppercase tracking-[0.25em] text-[#111014]/45">
          {caption}
        </p>
      </div>
    </section>
  );
}
